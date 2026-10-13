// The season race: everyone's running total, game by game, as bars sliding into their new
// ranks. The frames come from lib/insights.js (raceFrames); this paints them at story size with
// the same room, type and sign-off as Wrapped, and shares them as a video where the browser can
// record one, or as a picture of the final standings where it cannot. Same as share/RaceCard.kt.

import { RACE_TOP, raceAt, raceDuration, roundToMajor } from '../lib/insights.js'
import { formatMoney } from '../lib/money.js'
import { shortDate } from '../lib/time.js'
import { button, clear, el, mount, showError } from '../ui.js'
import {
  BODY, BONE, DISPLAY, H, MUTED, PAD, SERIF, TONES, W, backdrop, ellipsize, markImage, share, signOff, spaced,
} from './wrapped.js'

/** One colour per player for the whole race, by the order they first sat down. */
// No green and no red: those mean up and down everywhere else, and a bar is a person, not a result.
export const RACE_COLOURS = ['#F2B45A', '#60A5FA', '#F472B6', '#A78BFA', '#2DD4BF', '#FB923C',
  '#E5E7EB', '#FACC15', '#38BDF8', '#C084FC', '#94A3B8', '#D6B98C']
const TOP = 470
const ROW = 140
const SHARE_TEXT = 'Our season, game by game. Made with Splitpot.'

/** Everyone on the board after `j` games (0 = before the first), keyed by player. */
function boardAt(frames, j) {
  const f = frames[j - 1]
  return new Map(f ? f.rows.map((r, i) => [r.playerId, { ...r, rank: i }]) : [])
}

/** Paints the race at position `t` (0..frames.length, fractional mid-move). */
export function drawRace(c, frames, t, periodLabel, currency, mark) {
  const n = frames.length
  backdrop(c, '#0C3340')
  c.textBaseline = 'alphabetic'
  c.fillStyle = TONES.gold
  c.font = `bold 34px ${BODY}`
  c.fillText(spaced('SEASON RACE'), PAD, 170)
  c.fillStyle = MUTED
  c.font = `36px ${BODY}`
  c.fillText(periodLabel, PAD, 225)

  const shown = frames[Math.min(Math.max(Math.ceil(t), 1), n) - 1]
  const done = t >= n
  c.fillStyle = BONE
  c.font = `bold 84px ${SERIF}`
  c.fillText(done ? 'Final standings' : `Game ${shown.index} of ${shown.of}`, PAD, 340)
  c.fillStyle = MUTED
  c.font = `40px ${BODY}`
  c.fillText(ellipsize(c, done ? `After ${n} ${n === 1 ? 'game' : 'games'}` : `${shown.gameName} · ${shortDate(shown.playedOn)}`, W - PAD * 2), PAD, 405)

  // One fixed scale for the whole race, so a bar's length always means the same money.
  let most = 0
  let least = 0
  for (const f of frames) for (const r of f.rows) { most = Math.max(most, r.totalCents); least = Math.min(least, r.totalCents) }
  const span = most - least || 1
  const area = W - PAD * 2
  const zeroX = PAD + (area * -least) / span

  const lo = Math.floor(t)
  const p = t - lo
  const from = boardAt(frames, lo)
  const to = boardAt(frames, Math.min(lo + 1, n))
  const ids = new Set([...from.keys(), ...to.keys()])
  const lerp = (a, b) => a + (b - a) * p

  // A faint zero line the bars grow out of.
  c.fillStyle = 'rgb(255 255 255 / 0.18)'
  c.fillRect(zeroX - 1, TOP + 50, 2, ROW * RACE_TOP - 40)

  for (const id of ids) {
    const a = from.get(id)
    const b = to.get(id)
    const row = b ?? a
    // Whole units while moving, so the figures tick over cleanly; exact once they land.
    const end = b?.totalCents ?? a.totalCents
    const value = p === 0 ? (a ?? b).totalCents : roundToMajor(lerp(a?.totalCents ?? 0, end), currency)
    const y = TOP + lerp(a?.rank ?? RACE_TOP, b?.rank ?? RACE_TOP) * ROW
    c.globalAlpha = a && b ? 1 : a ? 1 - p : p
    c.fillStyle = BONE
    c.font = `bold 44px ${BODY}`
    const amount = formatMoney(value, currency, true)
    c.font = `40px ${DISPLAY}`
    const amountW = c.measureText(amount).width
    c.font = `bold 44px ${BODY}`
    c.fillText(ellipsize(c, row.name, area - amountW - 30), PAD, y + 44)
    c.fillStyle = value > 0 ? TONES.up : value < 0 ? TONES.down : MUTED
    c.font = `40px ${DISPLAY}`
    c.fillText(amount, W - PAD - amountW, y + 44)
    const len = (area * Math.abs(value)) / span
    c.fillStyle = RACE_COLOURS[row.colour % RACE_COLOURS.length]
    c.beginPath()
    c.roundRect(value < 0 ? zeroX - len : zeroX, y + 62, Math.max(len, 6), 50, 12)
    c.fill()
    c.globalAlpha = 1
  }
  signOff(c, mark)
}

/** The gold "Season race · Play" card on the standings tab. Same look as Wrapped's. */
export function raceEntry(frames, periodLabel, currency) {
  const entry = el('button', 'card wrapped-entry')
  entry.type = 'button'
  const glyph = el('span', 'ins-glyph ins-glyph-accent')
  glyph.setAttribute('aria-hidden', 'true')
  // Constant markup, never data.
  glyph.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16M6 16v4M10 10v10M14 6v14M18 12v8"/></svg>'
  mount(entry, glyph,
    mount(el('span', 'wrapped-entry-text'),
      el('span', 'wrapped-entry-title', 'Season race'),
      el('span', 'ins-sub', `${frames.length} games, played back as a race`)),
    el('span', 'wrapped-entry-play', 'Play'))
  entry.addEventListener('click', async () => {
    entry.disabled = true
    try {
      await openRace(frames, periodLabel, currency)
    } catch (e) {
      showError(`Could not open the season race: ${e.message ?? e}`)
    } finally {
      entry.disabled = false
    }
  })
  return entry
}

/**
 * The MP4 type this browser can really record, or null. Asked by recording half a second, not
 * by isTypeSupported: some desktop builds say yes to H.264 and then hand back zero bytes.
 * MP4 only - WebM would not play everywhere the video gets sent.
 */
let probe = null
function recordableType() {
  probe ??= (async () => {
    for (const type of ['video/mp4;codecs=avc1', 'video/mp4']) {
      if (!window.MediaRecorder?.isTypeSupported?.(type)) continue
      try {
        const cv = document.createElement('canvas')
        cv.width = 64
        cv.height = 64
        const c = cv.getContext('2d')
        const rec = new MediaRecorder(cv.captureStream(30), { mimeType: type })
        let bytes = 0
        rec.ondataavailable = (e) => { bytes += e.data.size }
        const stopped = new Promise((r) => { rec.onstop = r })
        // No timeslice: with one, a recording this short can come back empty.
        rec.start()
        for (let i = 0; i < 18; i++) {
          c.fillStyle = `hsl(${i * 24} 60% 50%)`
          c.fillRect(0, 0, 64, 64)
          await new Promise((r) => setTimeout(r, 33))
        }
        rec.stop()
        await stopped
        if (bytes > 0) return type
      } catch { /* try the next */ }
    }
    return null
  })()
  return probe
}

/**
 * The race plays in a full-screen viewer (tap to replay). Sharing a video takes two taps: the
 * first records it in real time, the second shares it, because a share sheet will only open
 * straight after a tap and recording outlasts that.
 */
export async function openRace(frames, periodLabel, currency) {
  try { await document.fonts.load(`80px ${DISPLAY}`) } catch { /* fallback face is fine */ }
  const mark = await markImage()
  const n = frames.length
  const total = raceDuration(n)
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  canvas.className = 'wrapped-card'
  canvas.setAttribute('role', 'img')
  const last = frames[n - 1]
  canvas.setAttribute('aria-label', `Season race, ${periodLabel}. Final standings: `
    + last.rows.map((r, i) => `${i + 1}. ${r.name} ${formatMoney(r.totalCents, currency, true)}`).join(', '))
  const c = canvas.getContext('2d')

  // The fallback picture, ready before any tap for the same gesture reason.
  const finalCanvas = document.createElement('canvas')
  finalCanvas.width = W
  finalCanvas.height = H
  drawRace(finalCanvas.getContext('2d'), frames, n, periodLabel, currency, mark)
  const picture = await new Promise((resolve) => finalCanvas.toBlob(resolve, 'image/png'))
    .then((blob) => new File([blob], 'splitpot-season-race.png', { type: 'image/png' }))

  let raf = 0
  const play = () => {
    cancelAnimationFrame(raf)
    if (still) { drawRace(c, frames, n, periodLabel, currency, mark); return }
    const start = performance.now()
    const tick = (now) => {
      drawRace(c, frames, raceAt(now - start, n), periodLabel, currency, mark)
      if (now - start < total) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
  }

  const root = el('div', 'wrapped')
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', `${periodLabel} season race`)
  const stage = el('div', 'wrapped-stage')
  const foot = el('div', 'wrapped-foot')
  const close = () => {
    cancelAnimationFrame(raf)
    document.removeEventListener('keydown', keys)
    root.remove()
  }
  const keys = (e) => { if (e.key === 'Escape') close() }
  stage.addEventListener('click', play)
  document.addEventListener('keydown', keys)
  const closeBtn = button('✕', close, 'btn wrapped-close')
  closeBtn.setAttribute('aria-label', 'Close')

  let video = null
  const type = await recordableType()
  const videoBtn = type ? button('Make the video', async () => {
    if (video) { share([video], SHARE_TEXT); return }
    videoBtn.disabled = true
    try {
      video = await record(frames, periodLabel, currency, mark, type, (f) => { videoBtn.textContent = `Making the video… ${Math.round(f * 100)}%` })
      videoBtn.textContent = 'Share video'
    } catch (e) {
      videoBtn.textContent = 'Make the video'
      showError(`Could not make the video: ${e.message ?? e}. Share the picture instead.`)
    } finally {
      videoBtn.disabled = false
    }
  }, 'btn btn-primary') : null
  mount(foot, videoBtn, button('Share picture', () => share([picture], SHARE_TEXT), type ? 'btn' : 'btn btn-primary'))
  mount(stage, canvas)
  mount(root, closeBtn, stage, foot)
  document.body.appendChild(root)
  play()
}

/** Records the race in real time off its own canvas. Resolves to an MP4 file. */
async function record(frames, periodLabel, currency, mark, type, onProgress) {
  const n = frames.length
  const total = raceDuration(n)
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const c = cv.getContext('2d')
  drawRace(c, frames, 0, periodLabel, currency, mark)
  const rec = new MediaRecorder(cv.captureStream(30), { mimeType: type, videoBitsPerSecond: 6_000_000 })
  const chunks = []
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  const stopped = new Promise((resolve, reject) => { rec.onstop = resolve; rec.onerror = (e) => reject(e.error ?? e) })
  rec.start()
  const t0 = performance.now()
  // A timer, not animation frames: those stop when the tab is hidden, and the video would stall.
  await new Promise((resolve) => {
    const id = setInterval(() => {
      const ms = performance.now() - t0
      drawRace(c, frames, raceAt(ms, n), periodLabel, currency, mark)
      onProgress(Math.min(ms / total, 1))
      if (ms >= total) { clearInterval(id); resolve() }
    }, 1000 / 30)
  })
  rec.stop()
  await stopped
  if (!chunks.length) throw new Error('the recording came out empty')
  return new File([new Blob(chunks, { type: 'video/mp4' })], 'splitpot-season-race.mp4', { type: 'video/mp4' })
}
