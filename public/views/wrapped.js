// Splitpot Wrapped: the story viewer and the cards it draws. The words come from
// lib/wrapped.js; this only paints them, at story size (1080x1920), the same layout as
// share/WrappedCard.kt so a card posted from the browser and one from the phone look alike.

import { button, clear, el, mount, showError, showNotice } from '../ui.js'

export const W = 1080
export const H = 1920
export const PAD = 96
export const DISPLAY = "'Bungee', system-ui, sans-serif"
export const SERIF = "Georgia, 'Times New Roman', serif"
export const BODY = 'system-ui, -apple-system, Roboto, sans-serif'

/** Each card its own room colour, so swiping through reads as moving on. */
export const BACKDROPS = {
  cover: '#0F3B2C', pot: '#4A1428', win: '#0E4D3A', loss: '#4D1414',
  rebuy: '#142A4D', regular: '#33194D', podium: '#0C3340', end: '#4D3A0F',
}
export const TONES = { up: '#4ADE80', down: '#FF6B81', gold: '#F2B45A' }
export const BONE = '#F2EFE6'
export const MUTED = '#B9C2BC'
const MEDALS = ['#F2B45A', '#C9CED6', '#C9875A']

/** Paints one card onto a new canvas. */
export async function drawWrappedCard(card, periodLabel, index, count) {
  try { await document.fonts.load(`80px ${DISPLAY}`) } catch { /* fallback face is fine */ }
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const c = canvas.getContext('2d')
  backdrop(c, BACKDROPS[card.key] ?? BACKDROPS.cover)

  c.textBaseline = 'alphabetic'
  c.fillStyle = TONES.gold
  c.font = `bold 34px ${BODY}`
  c.fillText(spaced('SPLITPOT WRAPPED'), PAD, 170)
  c.fillStyle = MUTED
  c.font = `36px ${BODY}`
  c.fillText(`${periodLabel}  ·  ${index + 1} of ${count}`, PAD, 225)

  c.fillStyle = BONE
  c.font = `bold 84px ${SERIF}`
  let y = 560
  for (const line of wrap(c, card.title, W - PAD * 2)) { c.fillText(line, PAD, y); y += 100 }

  if (card.rows.length) {
    y += 80
    card.rows.forEach((r, i) => {
      c.fillStyle = MEDALS[i] ?? MUTED
      c.beginPath()
      c.arc(PAD + 60, y + 40, 60, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#0D0E10'
      c.font = `64px ${DISPLAY}`
      const rank = String(r.rank)
      c.fillText(rank, PAD + 60 - c.measureText(rank).width / 2, y + 64)
      c.fillStyle = BONE
      c.font = `bold 60px ${BODY}`
      c.fillText(ellipsize(c, r.name, W - PAD * 2 - 160), PAD + 160, y + 20)
      c.fillStyle = TONES[r.tone] ?? BONE
      c.font = `60px ${DISPLAY}`
      c.fillText(r.value, PAD + 160, y + 100)
      y += 220
    })
  } else {
    y += 260
    if (card.big) {
      c.fillStyle = TONES[card.tone] ?? BONE
      let size = 230
      c.font = `${size}px ${DISPLAY}`
      while (size > 80 && c.measureText(card.big).width > W - PAD * 2) {
        size -= 10
        c.font = `${size}px ${DISPLAY}`
      }
      c.fillText(card.big, PAD, y)
      y += 130
    }
    c.fillStyle = BONE
    c.font = `bold 72px ${BODY}`
    c.fillText(ellipsize(c, card.name, W - PAD * 2), PAD, y)
    y += 100
    c.fillStyle = MUTED
    c.font = `46px ${BODY}`
    for (const text of card.lines) {
      for (const line of wrap(c, text, W - PAD * 2)) { c.fillText(line, PAD, y); y += 66 }
    }
  }

  signOff(c, await markImage())
  return canvas
}

/** The room: a colour fading to near-black, and a chip's edge, very faint, low on the right. */
export function backdrop(c, colour) {
  const bg = c.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, colour)
  bg.addColorStop(1, '#070B09')
  c.fillStyle = bg
  c.fillRect(0, 0, W, H)
  c.strokeStyle = 'rgb(255 255 255 / 0.06)'
  for (const [r, w, dash] of [[420, 40, [60, 46]], [330, 6, []], [250, 6, []]]) {
    c.lineWidth = w
    c.setLineDash(dash)
    c.beginPath()
    c.arc(W - 40, H - 520, r, 0, Math.PI * 2)
    c.stroke()
  }
  c.setLineDash([])
}

/** The mark, the wordmark and the strapline along the foot of every story card. */
export function signOff(c, mark) {
  if (mark) {
    const [x, y, size] = [PAD, H - 250, 110]
    c.save()
    c.beginPath()
    c.roundRect(x, y, size, size, size * 0.22)
    c.clip()
    c.drawImage(mark, x, y, size, size)
    c.restore()
  }
  c.fillStyle = TONES.gold
  c.font = `52px ${DISPLAY}`
  c.fillText('SPLITPOT', PAD + 140, H - 190)
  c.fillStyle = MUTED
  c.font = `34px ${BODY}`
  c.fillText("Run your poker games. We'll handle the money.", PAD + 140, H - 145)
}

/**
 * The gold "<title> · Play" card that opens the story: under the Insights period picker, and
 * on Home when last month's Wrapped is ready. `onPlayed` runs once the story has opened.
 */
export function wrappedEntry(cards, title, periodLabel, onPlayed = () => {}) {
  const entry = el('button', 'card wrapped-entry')
  entry.type = 'button'
  const star = el('span', 'ins-glyph ins-glyph-accent')
  star.setAttribute('aria-hidden', 'true')
  // Constant markup, never data.
  star.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/></svg>'
  mount(entry,
    star,
    mount(el('span', 'wrapped-entry-text'),
      el('span', 'wrapped-entry-title', title),
      el('span', 'ins-sub', `${cards.length} cards to share with the group`)),
    el('span', 'wrapped-entry-play', 'Play'),
  )
  entry.addEventListener('click', async () => {
    entry.disabled = true
    try {
      await openWrapped(cards, periodLabel)
      onPlayed()
    } catch (e) {
      showError(`Could not open Wrapped: ${e.message ?? e}`)
    } finally {
      entry.disabled = false
    }
  })
  return entry
}

/**
 * The story: one card at a time, tap the right side for the next and the left to go back,
 * share the one showing or all of them. Every picture is drawn when the viewer opens, not
 * on tap, because a share sheet has to open while the tap still counts as a gesture.
 */
export async function openWrapped(cards, periodLabel) {
  const canvases = await Promise.all(cards.map((card, i) => drawWrappedCard(card, periodLabel, i, cards.length)))
  const files = await Promise.all(canvases.map(async (cv, i) => {
    const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/png'))
    return new File([blob], `splitpot-wrapped-${i + 1}.png`, { type: 'image/png' })
  }))

  const root = el('div', 'wrapped')
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', `${periodLabel} Wrapped`)
  const bars = el('div', 'wrapped-bars')
  const stage = el('div', 'wrapped-stage')
  const foot = el('div', 'wrapped-foot')
  let at = 0

  const show = () => {
    clear(bars)
    cards.forEach((_, i) => bars.appendChild(el('span', i <= at ? 'on' : null)))
    clear(stage)
    const img = canvases[at]
    img.className = 'wrapped-card'
    img.setAttribute('role', 'img')
    img.setAttribute('aria-label', [cards[at].title, cards[at].big, cards[at].name, ...cards[at].lines,
      ...cards[at].rows.map((r) => `${r.rank}. ${r.name} ${r.value}`)].filter(Boolean).join('. '))
    stage.appendChild(img)
  }
  const step = (d) => {
    at = Math.max(0, Math.min(cards.length - 1, at + d))
    show()
  }
  const close = () => {
    document.removeEventListener('keydown', keys)
    root.remove()
  }
  const keys = (e) => {
    if (e.key === 'ArrowRight') step(1)
    else if (e.key === 'ArrowLeft') step(-1)
    else if (e.key === 'Escape') close()
  }
  stage.addEventListener('click', (e) => {
    const box = stage.getBoundingClientRect()
    step(e.clientX - box.left < box.width / 3 ? -1 : 1)
  })
  document.addEventListener('keydown', keys)

  const closeBtn = button('✕', close, 'btn wrapped-close')
  closeBtn.setAttribute('aria-label', 'Close')
  mount(foot,
    button('Share this card', () => share([files[at]]), 'btn btn-primary'),
    button('Share all', () => share(files), 'btn'),
  )
  mount(root, bars, closeBtn, stage, foot)
  document.body.appendChild(root)
  show()
}

export async function share(files, text = 'Our poker nights, wrapped. Made with Splitpot.') {
  try {
    if (navigator.canShare?.({ files })) {
      await navigator.share({ files, text })
      return
    }
  } catch (e) {
    if (e?.name === 'AbortError') return
    if (e?.name !== 'NotAllowedError') {
      showError(`Could not share that: ${e.message ?? e}`)
      return
    }
  }
  // Desktops cannot hand files to an app: save them instead, and say so.
  for (const file of files) {
    const url = URL.createObjectURL(file)
    const a = el('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  const what = files[0]?.type.startsWith('video/') ? 'Video' : files.length === 1 ? 'Picture' : 'Pictures'
  showNotice(`${what} saved. Attach ${files.length === 1 ? 'it' : 'them'} in the chat.`)
}

export const spaced = (s) => s.split('').join(' ')

function wrap(c, text, max) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (line && c.measureText(next).width > max) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

export function ellipsize(c, text, max) {
  if (c.measureText(text).width <= max) return text
  let end = text.length
  while (end > 1 && c.measureText(text.slice(0, end) + '…').width > max) end--
  return text.slice(0, end) + '…'
}

// Loaded once and kept: the race draws it on every frame, which cannot wait on a decode.
let markLoad = null
export function markImage() {
  markLoad ??= (async () => {
    const img = new Image()
    img.src = new URL('../icon.svg', import.meta.url).href
    try { await img.decode(); return img } catch { return null }
  })()
  return markLoad
}
