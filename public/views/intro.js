// The first-run intro: four steps, shown once per device, and again from Settings on request.
// Same steps, wording and animation as IntroScreen.kt on the phone.
//
//   1  Welcome - what the app is for, in three lines.
//   2  How it works - a game night played out on an animated table (lib/intro.js).
//   3  Your regulars - add the people you play with, or skip.
//   4  Ready - start a game, or go to Home.
//
// Nothing here blocks: every step after the first can be skipped, and the only write (adding
// a player) is the same call the People screen makes, with its failure shown.

import { addPlayer, players } from '../db.js'
import { DEMO_BEATS_MS, DEMO_LOOP_MS, DEMO_SEATS, DEMO_STANDINGS, DEMO_TRANSFERS, demoAt } from '../lib/intro.js'
import { formatMoney } from '../lib/money.js'
import { button, clear, clearBanner, el, mount, showError } from '../ui.js'
import { capitalizeFirst } from './newgame.js'

const KEY = 'splitpot_intro_seen'
const SVG = 'http://www.w3.org/2000/svg'
const STEPS = 4

/** True once the intro has been finished or skipped on this device. */
export function introSeen() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    // Storage blocked: show it never rather than every single launch.
    return true
  }
}

export function markIntroSeen() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* nothing to remember it in; introSeen() already says true */
  }
}

/** `finish(target)` is called with '#/new' or '#/' when the host leaves the intro. */
export function introView(finish) {
  const root = el('main', 'screen intro')
  let step = 0
  let stopDemo = null

  const render = () => {
    stopDemo?.()
    stopDemo = null
    clear(root)

    const head = el('div', 'intro-head')
    const bar = el('div', 'intro-bar')
    const fill = el('span', 'intro-fill')
    fill.style.width = `${((step + 1) / STEPS) * 100}%`
    bar.appendChild(fill)
    mount(head, mount(el('div', 'intro-brand'), logo('intro-mark'), el('span', null, 'Splitpot')),
      bar, el('p', 'intro-count', `${step + 1} of ${STEPS}`))
    root.appendChild(head)

    const body = el('div', 'intro-body')
    root.appendChild(body)
    const foot = el('div', 'intro-foot')
    root.appendChild(foot)

    const next = () => { step++; render() }
    const back = step > 0 ? button('‹ Back', () => { step--; render() }, 'btn-link intro-back') : el('span')

    if (step === 0) {
      mount(body,
        el('p', 'eyebrow', 'Built for home games'),
        el('h1', 'title intro-title', 'Run the game. We do the maths.'),
        el('p', 'ins-sub', 'From the first buy-in to the last payment, on one phone.'),
        feature('Every buy-in and rebuy, logged in a tap'),
        feature('Who pays whom, worked out at the end'),
        feature('No spreadsheet. No arguing over the numbers.'),
        el('p', 'intro-free', '✓ Free, every feature, no card needed'),
      )
      mount(foot, back, button('Continue ›', next, 'btn btn-primary intro-next'))
    } else if (step === 1) {
      const demo = demoTable()
      stopDemo = demo.stop
      mount(body,
        el('p', 'eyebrow', 'How it works'),
        el('h1', 'title intro-title', 'From first buy-in to settle-up'),
        el('p', 'ins-sub', 'Everything is recorded as it happens.'),
        demo.node,
      )
      mount(foot, back, button('Continue ›', next, 'btn btn-primary intro-next'))
    } else if (step === 2) {
      mount(body,
        el('p', 'eyebrow', 'Your table'),
        el('h1', 'title intro-title', 'Who do you usually play with?'),
        el('p', 'ins-sub', 'Add your regulars now and they are one tap away when a game starts. Nobody else needs the app.'),
        regulars(),
      )
      mount(foot, back,
        mount(el('div', 'intro-pair'), button('Skip', next, 'btn-link'), button('Continue ›', next, 'btn btn-primary intro-next')))
    } else {
      mount(body,
        el('p', 'eyebrow', 'Ready to host'),
        mount(el('div', 'intro-ready'), logo('intro-chip'), el('h1', 'title intro-title intro-center', 'Your table is ready.'),
          el('p', 'ins-sub intro-center', 'Start a game now, or come back when the cards come out.')),
      )
      mount(foot, back,
        mount(el('div', 'intro-pair'),
          button('Go to Home', () => finish('#/'), 'btn intro-next'),
          button('Start a game ›', () => finish('#/new'), 'btn btn-primary intro-next')))
    }

    // Leave from any step - the intro is never in the way of a game about to start.
    if (step < STEPS - 1) {
      root.appendChild(button('Skip the intro', () => finish('#/'), 'btn-link intro-skip'))
    }
  }

  render()
  root.destroy = () => stopDemo?.()
  return root
}

function feature(text) {
  return mount(el('div', 'intro-feature'), el('span', 'intro-tick', '✓'), el('span', null, text))
}

// ---------- step 3: regulars ----------

function regulars() {
  const wrap = el('div', 'stack-tight intro-regulars')
  const list = el('div', 'chips intro-chips')
  const input = el('input', 'field')
  input.placeholder = 'Type a name'
  input.autocapitalize = 'words'
  input.maxLength = 60
  const add = el('button', 'btn btn-primary intro-add', 'Add')
  add.type = 'submit'
  const row = mount(el('form', 'intro-addrow'), input, add)

  const show = (roster) => {
    clear(list)
    const others = roster.filter((p) => !p.is_self)
    if (others.length === 0) list.appendChild(el('p', 'muted small', 'Nobody yet.'))
    for (const p of others) list.appendChild(el('span', 'chip chip-static', p.name))
  }

  let roster = []
  players().then((r) => { roster = r; show(roster) }).catch(() => show([]))

  row.addEventListener('submit', async (e) => {
    e.preventDefault()
    const name = capitalizeFirst(input.value.trim())
    if (!name) return
    if (roster.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      input.value = ''
      return
    }
    add.disabled = true
    clearBanner()
    try {
      const p = await addPlayer({ name })
      roster = [...roster, p]
      show(roster)
      input.value = ''
      input.focus()
    } catch (err) {
      showError(`Could not add ${name}: ${err.message ?? err}`)
    } finally {
      add.disabled = false
    }
  })

  return mount(wrap, row, list)
}

// ---------- step 2: the animated table ----------

// The table's own coordinates. Seats sit just off the corners of the oval.
const W = 320
const H = 280
const SEAT_XY = [[56, 62], [264, 62], [56, 218], [264, 218]]
const CENTRE = [160, 140]
const CARDS = [['A', '♠', false], ['K', '♥', true], ['7', '♦', true], ['7', '♣', false], ['2', '♠', false]]

const pct = (v, of) => `${(v / of) * 100}%`

/**
 * A settle-up arrow from one seat to another, bowed away from the table's centre so it never
 * runs through the middle where the "2 settle-ups" label sits. Same geometry as the phone.
 */
export function arrowPath(from, to) {
  const [x0, y0] = SEAT_XY[from]
  const [x2, y2] = SEAT_XY[to]
  const mx = (x0 + x2) / 2
  const my = (y0 + y2) / 2
  let px = -(y2 - y0)
  let py = x2 - x0
  const len = Math.hypot(px, py) || 1
  px /= len
  py /= len
  // Point the bow away from the centre. A line straight through the centre bows below it,
  // clear of the "2 settle-ups" label sitting there.
  const away = (mx - CENTRE[0]) * px + (my - CENTRE[1]) * py
  const sign = Math.abs(away) < 1 ? (py > 0 ? 1 : -1) : Math.sign(away)
  const cx = mx + sign * px * 70
  const cy = my + sign * py * 70
  const trim = (ax, ay, bx, by, d) => {
    const l = Math.hypot(bx - ax, by - ay) || 1
    return [ax + ((bx - ax) / l) * d, ay + ((by - ay) / l) * d]
  }
  const [sx, sy] = trim(x0, y0, cx, cy, 26)
  const [ex, ey] = trim(x2, y2, cx, cy, 30)
  // The curve's own midpoint, for the amount label.
  const lx = 0.25 * sx + 0.5 * cx + 0.25 * ex
  const ly = 0.25 * sy + 0.5 * cy + 0.25 * ey
  return { d: `M${sx.toFixed(1)},${sy.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`, label: [lx, ly] }
}

/** The animated table. `fixedBeat` freezes it on one beat (design/harness/intro.html). */
export function demoTable(fixedBeat = null) {
  const wrap = el('div', 'demo-wrap')
  const box = el('div', 'demo')
  box.setAttribute('role', 'img')
  box.setAttribute('aria-label', 'A game night played out: four buy-ins, a rebuy, the results, two settle-up payments, then the standings.')
  const felt = el('div', 'demo-felt')

  const cards = el('div', 'demo-cards')
  CARDS.forEach(([rank, suit, red], i) => {
    const c = el('span', `demo-card${red ? ' demo-red' : ''}`, `${rank}${suit}`)
    c.style.transitionDelay = `${i * 90}ms`
    cards.appendChild(c)
  })

  const centre = el('div', 'demo-centre')

  const seats = DEMO_SEATS.map((s, i) => {
    const [x, y] = SEAT_XY[i]
    const seat = el('div', 'demo-seat', s.id)
    seat.style.left = pct(x, W)
    seat.style.top = pct(y, H)
    const base = `demo-tag ${y < H / 2 ? 'demo-tag-up' : 'demo-tag-down'}`
    const tag = el('span', base)
    tag.dataset.base = base
    tag.style.left = pct(x, W)
    tag.style.top = pct(y < H / 2 ? y - 40 : y + 40, H)
    return { seat, tag }
  })

  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svg.setAttribute('class', 'demo-arrows')
  svg.innerHTML = '<defs><marker id="demo-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>'
  for (const t of DEMO_TRANSFERS) {
    const { d, label } = arrowPath(t.from, t.to)
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('d', d)
    path.setAttribute('class', 'demo-arrow')
    path.setAttribute('marker-end', 'url(#demo-head)')
    path.setAttribute('pathLength', '1')
    svg.appendChild(path)
    const text = document.createElementNS(SVG, 'text')
    text.setAttribute('x', label[0].toFixed(1))
    text.setAttribute('y', label[1].toFixed(1))
    text.setAttribute('class', 'demo-arrow-label')
    text.setAttribute('text-anchor', 'middle')
    text.textContent = formatMoney(t.cents, 'INR')
    svg.appendChild(text)
  }

  const standings = el('div', 'demo-standings')
  mount(standings, el('p', 'ins-label ins-label-plain', 'All-time standings'))
  const tbl = el('div', 'demo-lb')
  DEMO_STANDINGS.forEach((r, i) => {
    const tone = r.netCents > 0 ? 'up' : r.netCents < 0 ? 'down' : 'flat'
    mount(tbl, mount(el('div', 'demo-lb-row'),
      el('span', 'muted', String(i + 1)), el('span', 'demo-lb-name', r.name),
      el('span', 'muted', `${r.games} games`), el('span', `money money-${tone}`, formatMoney(r.netCents, 'INR', true))))
  })
  standings.appendChild(tbl)

  mount(box, felt, cards, centre, svg, ...seats.flatMap((s) => [s.seat, s.tag]), standings)
  const caption = el('p', 'demo-caption')
  caption.setAttribute('aria-live', 'polite')
  mount(wrap, box, caption)

  const apply = (beat) => {
    const s = demoAt(beat)
    s.tags.forEach((t, i) => {
      const tag = seats[i].tag
      if (!t) { tag.className = tag.dataset.base; return }
      const text = t.kind === 'buyin' ? `+${formatMoney(t.cents, 'INR')} buy-in`
        : t.kind === 'rebuy' ? `+${formatMoney(t.cents, 'INR')} rebuy`
          : formatMoney(t.cents, 'INR', t.kind !== 'flat')
      tag.textContent = text
      tag.className = `${tag.dataset.base} demo-on demo-${t.kind}`
    })
    cards.classList.toggle('demo-on', s.cards)
    clear(centre)
    if (s.centre === 'pot') {
      mount(centre, mount(el('span', 'demo-pot'), el('span', 'demo-pot-label', 'POT'), el('span', null, formatMoney(s.potCents, 'INR'))))
    } else {
      centre.appendChild(el('span', 'demo-over', s.centre === 'over' ? 'Game over' : `${DEMO_TRANSFERS.length} settle-ups`))
    }
    svg.classList.toggle('demo-on', s.arrows)
    standings.classList.toggle('demo-on', s.standings)
    box.classList.toggle('demo-dim', s.standings)
    if (caption.textContent !== s.caption) {
      caption.classList.remove('demo-caption-in')
      void caption.offsetWidth
      caption.textContent = s.caption
      caption.classList.add('demo-caption-in')
    }
  }

  // One timer per beat, re-armed each loop. Cleared the moment the step is left.
  let timer = null
  let beat = 0
  if (fixedBeat !== null) {
    apply(fixedBeat)
    return { node: wrap, stop: () => {} }
  }
  const tick = () => {
    apply(beat)
    const now = DEMO_BEATS_MS[beat]
    const nextBeat = (beat + 1) % DEMO_BEATS_MS.length
    const wait = nextBeat === 0 ? DEMO_LOOP_MS - now : DEMO_BEATS_MS[nextBeat] - now
    beat = nextBeat
    timer = setTimeout(tick, wait)
  }
  tick()

  return { node: wrap, stop: () => clearTimeout(timer) }
}

/** The Splitpot mark (tools/logo.py writes icon.svg). Decorative: the wordmark says the name. */
function logo(cls) {
  const img = el('img', cls)
  img.src = 'icon.svg'
  img.alt = ''
  return img
}
