// The settle-up as a picture, for the group chat. A port of share/SettlementCard.kt: same
// 1080px card, same felt-and-brass inks, same rows, so a picture shared from the browser and
// one shared from the phone look alike in the group.
//
// One image with a row per payment, not one per player: WhatsApp treats six images as six
// messages. Drawn onto a canvas rather than screenshotting the page, so it looks the same
// whatever theme the host is using.

import { formatMoney } from './money.js'
import { longDate } from './time.js'

/** One printed row: what it says on the left, the money on the right. */
export function settlementLines(transfers, currency) {
  if (transfers.length === 0) return [["Everyone's square", '']]
  return transfers.map((t) => [`${t.fromName}  →  ${t.toName}`, formatMoney(t.amountCents, currency)])
}

const W = 1080
const PAD = 64
const ROW = 104
const INK = {
  felt: '#0B1F18', card: '#10291F', line: '#1C3B2E', brass: '#C9A227', bone: '#F2EFE6', muted: '#8FA79B',
}
const DISPLAY = "'Bungee', system-ui, sans-serif"
const BODY = 'system-ui, -apple-system, Roboto, sans-serif'

/** Draws the card onto a new canvas and returns it. `game` is the db row (snake_case). */
export async function settlementCard(game, transfers, players, potCents) {
  // The wordmark face is a web font; draw before it loads and the title falls back silently.
  try { await document.fonts.load(`58px ${DISPLAY}`) } catch { /* fallback face is fine */ }
  const rows = settlementLines(transfers, game.currency)
  const headerH = 300
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = headerH + rows.length * ROW + 110
  const c = canvas.getContext('2d')
  c.fillStyle = INK.felt
  c.fillRect(0, 0, W, canvas.height)

  splitChip(c, W - PAD - 52, PAD + 52, 52)

  c.textBaseline = 'alphabetic'
  c.fillStyle = INK.bone
  c.font = `58px ${DISPLAY}`
  c.fillText(ellipsize(c, game.name.toUpperCase(), W - PAD * 2 - 140), PAD, PAD + 62)

  c.fillStyle = INK.muted
  c.font = `34px ${BODY}`
  c.fillText(`${longDate(game.played_on)}  ·  ${players} players  ·  pot ${formatMoney(potCents, game.currency)}`,
    PAD, PAD + 118)

  c.fillStyle = INK.brass
  c.font = `bold 30px ${BODY}`
  c.fillText(transfers.length === 0 ? 'SETTLED' : 'WHO PAYS WHOM', PAD, headerH - 40)

  let y = headerH
  rows.forEach(([left, right], i) => {
    if (i % 2 === 0) { c.fillStyle = INK.card; c.fillRect(0, y, W, ROW) }
    c.fillStyle = INK.line
    c.fillRect(0, y + ROW - 1, W, 1)
    c.fillStyle = INK.bone
    c.font = `42px ${BODY}`
    c.fillText(ellipsize(c, left, W - PAD * 2 - 300), PAD, y + ROW / 2 + 15)
    if (right) {
      c.fillStyle = INK.brass
      c.font = `bold 46px ${BODY}`
      c.fillText(right, W - PAD - c.measureText(right).width, y + ROW / 2 + 16)
    }
    y += ROW
  })

  c.fillStyle = INK.muted
  c.font = `30px ${BODY}`
  c.fillText('Full ledger link in this message', PAD, y + 70)
  c.fillStyle = INK.brass
  c.font = `34px ${DISPLAY}`
  c.fillText('SPLITPOT', W - PAD - c.measureText('SPLITPOT').width, y + 70)
  return canvas
}

/** The launcher mark: two half-discs with brass rims and bone faces, pulled apart on a tilt. */
function splitChip(c, cx, cy, r) {
  c.save()
  c.translate(cx, cy)
  c.rotate((-28 * Math.PI) / 180)
  const gap = r * 0.16
  const rad = (d) => (d * Math.PI) / 180
  for (const [side, start, notches] of [[-1, 90, [220, 270, 320]], [1, 270, [40, 90, 140]]]) {
    const dx = side * gap
    c.beginPath()
    c.moveTo(dx, 0)
    c.arc(dx, 0, r, rad(start), rad(start + 180))
    c.closePath()
    c.fillStyle = INK.bone
    c.fill()
    c.beginPath()
    c.arc(dx, 0, r, rad(start), rad(start + 180))
    c.lineWidth = r * 0.22
    c.strokeStyle = INK.brass
    c.stroke()
    c.strokeStyle = INK.felt
    c.lineWidth = r * 0.2
    for (const a of notches) {
      c.save()
      c.translate(dx, 0)
      c.rotate(rad(a))
      c.beginPath()
      c.moveTo(0, -r * 1.06)
      c.lineTo(0, -r * 0.74)
      c.stroke()
      c.restore()
    }
  }
  c.restore()
}

function ellipsize(c, text, max) {
  if (c.measureText(text).width <= max) return text
  let end = text.length
  while (end > 1 && c.measureText(text.slice(0, end) + '…').width > max) end--
  return text.slice(0, end) + '…'
}
