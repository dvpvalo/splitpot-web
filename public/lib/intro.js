// The first-run intro's animated table: one made-up game night played out in twelve beats,
// from the first buy-in, through paying up by UPI, to the standings. Pure - it only says what is on the table at each beat,
// and the view animates between them. Ported line for line to data/IntroDemo.kt, so the
// website and the phone tell the same story with the same numbers.
//
// The settle-up arrows come from the real settle(), not a drawing: if the demo says
// "2 payments", that is what the app would actually ask for.

import { UPI_ENABLED, settle } from './money.js'

export const DEMO_SEATS = [
  { id: 'A', name: 'Arjun' },
  { id: 'S', name: 'Sana' },
  { id: 'D', name: 'Dev' },
  { id: 'K', name: 'Kabir' },
]

/**
 * When each beat starts, in ms from the top of the loop. With UPI on, two more beats sit
 * between the settle-up arrows and the standings: the Pay button, then the tick.
 */
const BEATS = {
  plain: { ms: [0, 600, 1100, 1600, 2100, 2900, 3900, 5600, 7600, 10000], loop: 13500 },
  upi: { ms: [0, 600, 1100, 1600, 2100, 2900, 3900, 5600, 7600, 9600, 11200, 12800], loop: 16500 },
}
export const demoBeats = (upi = UPI_ENABLED) => (upi ? BEATS.upi : BEATS.plain)

const BUY_IN = 50000
/** Where the night ends: Sana rebought and lost, the rest are up or level. Sums to zero. */
const RESULTS = [50000, -75000, 25000, 0]

/** The payments that square the demo night, as {from, to, cents} seat indexes. */
export const DEMO_TRANSFERS = settle(DEMO_SEATS.map((s, i) => ({ playerId: s.id, name: s.name, netCents: RESULTS[i] })))
  .map((t) => ({
    from: DEMO_SEATS.findIndex((s) => s.id === t.fromId),
    to: DEMO_SEATS.findIndex((s) => s.id === t.toId),
    cents: t.amountCents,
  }))

/** The standings card at the end: a season of these nights, invented, summing to zero. */
export const DEMO_STANDINGS = [
  { name: 'Arjun', games: 12, netCents: 475000 },
  { name: 'Dev', games: 11, netCents: 200000 },
  { name: 'Kabir', games: 9, netCents: -125000 },
  { name: 'Sana', games: 12, netCents: -550000 },
]

/**
 * Everything on the table at one beat. `tags` holds one entry per seat, null when the seat
 * shows nothing yet: { cents, kind } where kind is buyin | rebuy | up | down | flat.
 */
export function demoAt(beat, upi = UPI_ENABLED) {
  const standingsFrom = upi ? 11 : 9
  const over = beat >= 7
  const tags = DEMO_SEATS.map((_, i) => {
    if (over) {
      const net = RESULTS[i]
      return { cents: net, kind: net > 0 ? 'up' : net < 0 ? 'down' : 'flat' }
    }
    if (beat < i + 1) return null
    if (i === 1 && beat >= 6) return { cents: BUY_IN, kind: 'rebuy' }
    return { cents: BUY_IN, kind: 'buyin' }
  })
  const seated = Math.min(beat, 4)
  return {
    tags,
    potCents: beat >= 6 ? BUY_IN * 5 : BUY_IN * seated,
    centre: beat >= 8 ? 'settle' : over ? 'over' : 'pot',
    cards: beat === 5 || beat === 6,
    arrows: beat >= 8,
    // The biggest settle-up, paid by UPI: the Pay button, then the tick.
    pay: upi && beat === 9 ? 'ask' : upi && beat === 10 ? 'paid' : null,
    standings: beat >= standingsFrom,
    caption: captionAt(beat, standingsFrom),
  }
}

function captionAt(beat, standingsFrom) {
  if (beat >= standingsFrom) return 'Every night adds to your standings'
  if (beat >= 10) return 'Paid and ticked off. No chasing anyone.'
  if (beat >= 9) return 'Tap Pay: UPI opens with the amount filled in'
  if (beat >= 8) return `Everyone square in ${DEMO_TRANSFERS.length} payments`
  if (beat >= 7) return 'The game ends. Stacks are counted.'
  if (beat >= 6) return 'A rebuy is one tap'
  return 'Splitpot logs every buy-in for you'
}

/** Which beat is showing `ms` into the loop. */
export function beatAt(ms, upi = UPI_ENABLED) {
  const { ms: starts, loop } = demoBeats(upi)
  const t = ((ms % loop) + loop) % loop
  let beat = 0
  starts.forEach((start, i) => { if (t >= start) beat = i })
  return beat
}
