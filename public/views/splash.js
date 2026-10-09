// The opening: the logo builds itself - the table settles in, the four seats pop round it, the
// ace and king land, the gold settle-up arrow draws across - then SPLITPOT rises in and it
// fades into the app. A port of SplashScreen.kt: same parts, timeline and easing, both from
// tools/logo.py (lib/logoart.js = LogoArt.kt).
//
// Once per tab: a website gets reloaded far more than an app is cold-started, and a 3.8s
// wait on every refresh would be a tax, not a welcome.

import { LOGO_LAYERS, SPLASH, SPLASH_FADE_MS, SPLASH_HOLD_MS, SPLASH_VIEW, SPLASH_WORDS_MS } from '../lib/logoart.js'
import { el, mount } from '../ui.js'

const SEEN = 'splitpot_splash_seen'
const SVG = 'http://www.w3.org/2000/svg'

const progress = (ms, start, dur) => Math.min(1, Math.max(0, (ms - start) / dur))
const cubicOut = (p) => 1 - (1 - p) ** 3
/** Overshoots a little and settles: the seats land like chips put down on the rail. */
function backOut(p) {
  const c1 = 1.70158
  const x = p - 1
  return 1 + (c1 + 1) * x ** 3 + c1 * x ** 2
}

/** The logo as SVG, plus a function that poses every part at `ms` into the opening. */
export function splashLogo() {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', `${SPLASH_VIEW[0]} ${SPLASH_VIEW[1]} ${SPLASH_VIEW[2]} ${SPLASH_VIEW[2]}`)
  svg.setAttribute('class', 'splash-logo')
  svg.setAttribute('aria-hidden', 'true')

  const parts = LOGO_LAYERS.map((layer) => {
    const outer = document.createElementNS(SVG, 'g')
    const inner = document.createElementNS(SVG, 'g')
    const [deg, rx, ry] = layer.rotate
    if (deg) inner.setAttribute('transform', `rotate(${deg} ${rx} ${ry})`)
    const paths = layer.paths.map((p) => {
      const path = document.createElementNS(SVG, 'path')
      path.setAttribute('d', p.d)
      path.setAttribute('fill', p.fill ?? 'none')
      if (p.stroke) {
        path.setAttribute('stroke', p.stroke)
        path.setAttribute('stroke-width', p.width)
        if (p.round) path.setAttribute('stroke-linecap', 'round')
      }
      if (p.alpha !== 1) path.setAttribute('opacity', p.alpha)
      inner.appendChild(path)
      return path
    })
    outer.appendChild(inner)
    svg.appendChild(outer)
    if (layer.part === 'arrow') {
      paths[0].setAttribute('pathLength', '1')
      paths[0].setAttribute('stroke-dasharray', '1 1')
    }
    return { layer, outer, paths }
  })

  function pose(ms) {
    for (const { layer, outer, paths } of parts) {
      const t = SPLASH[layer.part]
      const p = progress(ms, t.start, t.dur)
      outer.style.visibility = p > 0 ? 'visible' : 'hidden'
      if (layer.part === 'arrow') {
        paths[0].setAttribute('stroke-dashoffset', String(1 - cubicOut(p)))
        paths[1].setAttribute('opacity', String(Math.min(1, Math.max(0, (p - 0.75) / 0.25))))
        continue
      }
      const seat = layer.part.startsWith('seat')
      const k = seat ? backOut(p) : cubicOut(p)
      const grow = layer.part === 'table' ? 0.82 + 0.18 * k : layer.part === 'cards' ? 1.25 - 0.25 * k : k
      const dy = layer.part === 'cards' ? -8 * (1 - k) : 0
      outer.setAttribute('transform',
        `translate(0 ${dy}) translate(${t.px} ${t.py}) scale(${grow}) translate(${-t.px} ${-t.py})`)
      outer.setAttribute('opacity', String(seat ? Math.min(1, p * 3) : p))
    }
  }

  return { svg, pose }
}

/**
 * Covers the page with the opening, unless this tab has already seen it. `ready()` says
 * whether the app underneath has finished restoring the session; if not, the finished logo
 * holds until it has.
 */
export function playSplash(ready) {
  try { if (sessionStorage.getItem(SEEN)) return } catch { /* storage blocked: just play it */ }

  const { svg, pose } = splashLogo()
  const word = el('p', 'splash-word', 'SPLITPOT')
  const line = el('p', 'splash-line', 'dealing you in')
  const root = mount(el('div', 'splash'), mount(el('div', 'splash-inner'), svg, word, line))
  document.body.appendChild(root)

  const lift = (node, ms, at, px) => {
    const k = cubicOut(progress(ms, at, 500))
    node.style.opacity = String(k)
    node.style.transform = `translateY(${(1 - k) * px}px)`
  }
  const frame = (ms) => {
    pose(ms)
    lift(word, ms, SPLASH_WORDS_MS, 14)
    lift(line, ms, SPLASH_WORDS_MS + 250, 10)
  }
  frame(0)

  // Wall clock, not frame count: a dropped frame skips ahead rather than slowing the story.
  const t0 = performance.now()
  const tick = () => {
    const ms = Math.min(SPLASH_HOLD_MS, performance.now() - t0)
    frame(ms)
    if (ms < SPLASH_HOLD_MS) requestAnimationFrame(tick)
    else finish()
  }
  requestAnimationFrame(tick)

  function finish() {
    if (!ready()) { setTimeout(finish, 100); return }
    try { sessionStorage.setItem(SEEN, '1') } catch { /* fine */ }
    root.classList.add('splash-out')
    setTimeout(() => root.remove(), SPLASH_FADE_MS)
  }
}
