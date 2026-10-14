// Port of app/src/test/java/com/splitpot/app/SettlementTest.kt, assertion for assertion,
// plus the traps a naive JS port falls into that the JVM cannot.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  currencySymbol, formatAmount, formatMoney, parseMoney, settle,
} from '../public/lib/money.js'
import { recordsFor, seasonsIn, standingsFor, streakLabel } from '../public/lib/stats.js'
import {
  advanced, blindsAtLevel, clockLabel, isPaused, nextLevel,
  parse as parseClock, paused as pauseClock, remaining, resumed,
  serialise as serialiseClock,
} from '../public/lib/clock.js'
import { MAX, parsePresets, remove, upsert } from '../public/lib/presets.js'
import {
  durationLabel, longDate, parseInstant, relativeLabel, shortDate,
} from '../public/lib/time.js'
import { historyUrl, joinHint, playerCardMessage, resultsMessage } from '../public/lib/share.js'

const s = (name, net) => ({ playerId: name, name, netCents: net })

/** Everyone ends up square: each player's net is exactly cancelled by the transfers. */
function assertConserves(standings, transfers) {
  const delta = new Map(standings.map((x) => [x.playerId, x.netCents]))
  for (const t of transfers) {
    delta.set(t.fromId, delta.get(t.fromId) + t.amountCents)
    delta.set(t.toId, delta.get(t.toId) - t.amountCents)
  }
  for (const [id, left] of delta) assert.equal(left, 0, `${id} not settled`)
  assert.ok(transfers.every((t) => t.amountCents > 0), 'no transfer may be <= 0')
  assert.ok(transfers.every((t) => t.fromId !== t.toId), 'nobody pays themselves')
}

test('the reference game settles to one payment', () => {
  // Darsh in 100 out 50, Soham in 100 out 150, Tanish in 100 out 100
  const standings = [s('Darsh', -5000), s('Soham', 5000), s('Tanish', 0)]
  const t = settle(standings)
  assert.equal(t.length, 1)
  assert.equal(t[0].fromName, 'Darsh')
  assert.equal(t[0].toName, 'Soham')
  assert.equal(t[0].amountCents, 5000)
  assertConserves(standings, t)
})

test('at most n-1 transfers and everyone lands on zero', () => {
  const standings = [s('a', -12300), s('b', 4500), s('c', -800), s('d', 7000), s('e', 1600)]
  const t = settle(standings)
  assertConserves(standings, t)
  assert.ok(t.length <= standings.length - 1, `expected <= 4 transfers, got ${t.length}`)
})

test('an all-square table needs no payments', () => {
  assert.deepEqual(settle([s('a', 0), s('b', 0)]), [])
})

test('money still in play is left unsettled rather than forced onto anyone', () => {
  // 200 bought in, only 150 cashed out: 50 unaccounted for.
  const t = settle([s('a', -10000), s('b', 5000)])
  assert.equal(t.length, 1)
  assert.equal(t[0].amountCents, 5000)   // only the matchable part moves
  assert.ok(t.every((x) => x.amountCents > 0))
})

test('splitting one loser across several winners conserves every penny', () => {
  const standings = [s('whale', -30000), s('w1', 10000), s('w2', 10000), s('w3', 10000)]
  const t = settle(standings)
  assert.equal(t.length, 3)
  assertConserves(standings, t)
})

test('odd pennies do not vanish', () => {
  const standings = [s('a', -3333), s('b', 1111), s('c', 1111), s('d', 1111)]
  assertConserves(standings, settle(standings))
})

test('settlement output is deterministic', () => {
  const standings = [s('a', -5000), s('b', 2500), s('c', 2500)]
  assert.deepEqual(settle(standings), settle([...standings].reverse()))
})

test('settle does not mutate the caller’s array', () => {
  // .filter() copies, but a future "optimisation" to .sort() in place would reorder the
  // caller's list. The live table renders from that same array.
  const standings = [s('a', -5000), s('b', 2500), s('c', 2500)]
  const order = standings.map((x) => x.playerId)
  settle(standings)
  assert.deepEqual(standings.map((x) => x.playerId), order)
})

test('money formats the way the reference app shows it', () => {
  assert.equal(formatMoney(0, 'GBP'), '£0')
  assert.equal(formatMoney(10000, 'GBP'), '£100')
  assert.equal(formatMoney(1250, 'GBP'), '£12.50')
  assert.equal(formatMoney(-5000, 'GBP'), '-£50')
  assert.equal(formatMoney(5000, 'GBP', true), '+£50')
  assert.equal(formatMoney(125000, 'GBP'), '£1,250')
  assert.equal(formatMoney(500, 'JPY'), '¥500')   // zero-decimal currency
})

test('the real settlement card figures, in the host’s own currency', () => {
  // Pulled off the phone 6 Sep 2026 and checked against the settlement screen.
  assert.equal(formatMoney(18900, 'INR'), '₹189')
  assert.equal(formatMoney(1100, 'INR'), '₹11')
  assert.equal(formatMoney(3800, 'INR'), '₹38')
  assert.equal(formatMoney(500, 'INR'), '₹5')
})

test('an unknown currency falls back to the code and a space', () => {
  assert.equal(currencySymbol('SEK'), 'SEK ')
  assert.equal(formatMoney(1250, 'SEK'), 'SEK 12.50')
})

test('amount parsing rejects junk and handles decimals', () => {
  assert.equal(parseMoney('20', 'GBP'), 2000)
  assert.equal(parseMoney('12.50', 'GBP'), 1250)
  assert.equal(parseMoney('1,250', 'GBP'), 125000)
  assert.equal(parseMoney('500', 'JPY'), 500)
  assert.equal(parseMoney('', 'GBP'), null)
  assert.equal(parseMoney('abc', 'GBP'), null)
  assert.equal(parseMoney('-5', 'GBP'), null)
})

test('parsing never goes through a float', () => {
  // The naive port: Math.round(parseFloat("1.005") * 100) === 100, because the double
  // nearest 1.005 is 1.00499999999999989. Kotlin's BigDecimal HALF_UP gives 101.
  assert.equal(Math.round(parseFloat('1.005') * 100), 100, 'the trap still exists')
  assert.equal(parseMoney('1.005', 'GBP'), 101)
  assert.equal(parseMoney('0.005', 'GBP'), 1)
  assert.equal(parseMoney('0.004', 'GBP'), 0)
  assert.equal(parseMoney('12.5', 'JPY'), 13)   // zero-decimal rounds at the unit
})

test('parsing tolerates what a real keypad produces', () => {
  assert.equal(parseMoney('  20  ', 'GBP'), 2000)
  assert.equal(parseMoney('£12.50', 'GBP'), 1250)
  assert.equal(parseMoney('₹1,250', 'INR'), 125000)
  assert.equal(parseMoney('.5', 'GBP'), 50)
  assert.equal(parseMoney('20.', 'GBP'), 2000)
  assert.equal(parseMoney('.', 'GBP'), null)
  assert.equal(parseMoney('1.2.3', 'GBP'), null)
  assert.equal(parseMoney('1e3', 'GBP'), null)   // deliberately stricter than BigDecimal
})

test('editable amounts round-trip through parse without drift', () => {
  // formatAmount feeds an editable field that is typed straight back into parseMoney.
  // If these two ever disagree, a saved default silently changes when you reopen it.
  for (const cents of [0, 5, 50, 500, 1250, 125000]) {
    assert.equal(parseMoney(formatAmount(cents, 'GBP'), 'GBP'), cents)
  }
  for (const cents of [0, 5, 500, 125000]) {
    assert.equal(parseMoney(formatAmount(cents, 'JPY'), 'JPY'), cents)
  }
  // no thousands separators or trailing zeros that a number keyboard cannot reproduce
  assert.equal(formatAmount(125000, 'GBP'), '1250')
  assert.equal(formatAmount(1250, 'GBP'), '12.50')   // keeps minor units, still round-trips
})

// ===================== PlayerRecordsTest.kt =====================
// The fixture is the host's real data as of 6 Sep 2026 (the `nights` key of host_stats).

const night = (player, date, net, currency = 'INR') => ({
  playerId: player, playerName: player, isSelf: false,
  gameId: `g-${date}`, gameName: `Game ${date}`,
  playedOn: date, startedAt: `${date}T20:00:00Z`, currency,
  inCents: 0, outCents: 0, netCents: net,
})

// Darsh, newest first: -115, +189, +333, -200
const darsh = [
  night('darsh', '2026-09-05', -11500),
  night('darsh', '2026-09-03', 18900),
  night('darsh', '2026-09-02', 33300),
  night('darsh', '2026-09-01', -20000),
]

test('best and worst are the extremes, not the newest', () => {
  const r = recordsFor(darsh, 'darsh', 'INR')
  assert.equal(r.best.netCents, 33300)
  assert.equal(r.worst.netCents, -20000)
})

test('streak counts back from the most recent night', () => {
  // Lost the latest, won the two before: a losing streak of exactly one.
  assert.equal(recordsFor(darsh, 'darsh', 'INR').streak, -1)
  // Drop that night and the two wins behind it become the current run.
  assert.equal(recordsFor(darsh.slice(1), 'darsh', 'INR').streak, 2)
})

test('rows arriving out of order still read newest-first', () => {
  const shuffled = [...darsh].sort((a, b) => (a.playedOn < b.playedOn ? -1 : 1)) // wrong way round
  const r = recordsFor(shuffled, 'darsh', 'INR')
  assert.equal(r.nights[0].playedOn, '2026-09-05')
  assert.equal(r.streak, -1)
})

test('a level night ends a run rather than extending it', () => {
  const levelLatest = [
    night('p', '2026-09-05', 0),
    ...darsh.slice(1).map((n) => ({ ...n, playerId: 'p' })),
  ]
  assert.equal(recordsFor(levelLatest, 'p', 'INR').streak, 0)

  // And a zero in the middle stops the count there instead of being read as a loss.
  const zeroInside = [
    night('p', '2026-09-05', -100),
    night('p', '2026-09-04', 0),
    night('p', '2026-09-03', -100),
  ]
  assert.equal(recordsFor(zeroInside, 'p', 'INR').streak, -1)
})

test('another currency is a different set of records entirely', () => {
  const mixed = [...darsh, night('darsh', '2026-09-04', 500000, 'GBP')]
  const inr = recordsFor(mixed, 'darsh', 'INR')
  assert.equal(inr.best.netCents, 33300)
  assert.equal(inr.nights.length, 4)

  const gbp = recordsFor(mixed, 'darsh', 'GBP')
  assert.equal(gbp.nights.length, 1)
  assert.equal(gbp.best.netCents, 500000)
})

test('a player with no finished nights has no records', () => {
  const r = recordsFor(darsh, 'nobody', 'INR')
  assert.equal(r.best, null)
  assert.equal(r.worst, null)
  assert.equal(r.streak, 0)
  assert.ok(!r.hasAny)
})

test('a tied best night keeps the newer one, as maxByOrNull does', () => {
  // Kotlin returns the FIRST extreme and the list is newest-first. Reducing with >= instead
  // of > would silently hand back the older game, and nothing else would look wrong.
  const tied = [night('p', '2026-09-05', 5000), night('p', '2026-09-01', 5000)]
  assert.equal(recordsFor(tied, 'p', 'INR').best.playedOn, '2026-09-05')
  assert.equal(recordsFor(tied, 'p', 'INR').worst.playedOn, '2026-09-05')
})

test('streak labels read like a person wrote them', () => {
  assert.equal(streakLabel(3), '3 wins in a row')
  assert.equal(streakLabel(1), 'Won their last one')
  assert.equal(streakLabel(0), 'No run going')
  assert.equal(streakLabel(-1), 'Lost their last one')
  assert.equal(streakLabel(-2), '2 losses in a row')
})

// ===================== SeasonsTest.kt =====================

const sNight = (player, date, inC, outC, currency = 'INR') => ({
  ...night(player, date, outC - inC, currency),
  playerName: player.charAt(0).toUpperCase() + player.slice(1),
  inCents: inC, outCents: outC,
})

const seasonNights = [
  sNight('a', '2026-09-05', 20000, 8500),    // -115
  sNight('b', '2026-09-05', 20000, 71500),   // +515
  sNight('a', '2026-08-20', 10000, 28900),   // +189
  sNight('b', '2026-08-20', 10000, 5000),    // -50
]

test('seasons come from the months actually played, newest first', () => {
  const seasons = seasonsIn(seasonNights)
  assert.deepEqual(seasons.map((s) => s.label), ['All time', 'Sep 2026', 'Aug 2026'])
  assert.deepEqual(seasons.map((s) => s.key), [null, '2026-09', '2026-08'])
})

test('no games means all time and nothing else', () => {
  assert.deepEqual(seasonsIn([]).map((s) => s.label), ['All time'])
})

test('a month shows only that month, ordered by who is up', () => {
  const sep = standingsFor(seasonNights, { label: 'Sep 2026', key: '2026-09' })
  assert.deepEqual(sep.map((r) => r.playerName), ['B', 'A'])
  assert.equal(sep[0].netCents, 51500)
  assert.equal(sep[1].netCents, -11500)
  assert.equal(sep[0].games, 1)
})

test('all time totals every night for a player', () => {
  const all = standingsFor(seasonNights, { label: 'All time', key: null })
  const b = all.find((r) => r.playerName === 'B')
  assert.equal(b.games, 2)
  assert.equal(b.inCents, 30000)
  assert.equal(b.outCents, 76500)
  assert.equal(b.netCents, 46500)
})

test('a second currency is a separate row, never added in', () => {
  const mixed = [...seasonNights, sNight('a', '2026-09-11', 5000, 9000, 'GBP')]
  const sep = standingsFor(mixed, { label: 'Sep 2026', key: '2026-09' })
  const aRows = sep.filter((r) => r.playerName === 'A')
  assert.equal(aRows.length, 2)
  assert.ok(aRows.some((r) => r.currency === 'INR' && r.netCents === -11500))
  assert.ok(aRows.some((r) => r.currency === 'GBP' && r.netCents === 4000))
})

test('a month with no games for a player leaves them out entirely', () => {
  const only = seasonNights.filter((n) => n.playerId === 'a')
  const sep = standingsFor(only, { label: 'Sep 2026', key: '2026-09' })
  assert.equal(sep.length, 1)
  assert.equal(sep[0].playerName, 'A')
})

// ===================== BlindClockTest.kt =====================

const LEVEL = 20 * 60 * 1000   // a 20-minute level
const START = 1_000_000

test('a running level counts down', () => {
  const c = { level: 1, levelStartedAt: START, pausedElapsed: null }
  assert.equal(remaining(c, LEVEL, START), LEVEL)
  assert.equal(remaining(c, LEVEL, START + 5000), LEVEL - 5000)
})

test('time passing while the tab was closed still advances the level', () => {
  const c = { level: 1, levelStartedAt: START, pausedElapsed: null }
  // Tab closed for 50 minutes: two whole levels went by, and level three is ten minutes in.
  // A clock that resumed where it left off would be wrong by two levels.
  const now = START + 50 * 60 * 1000
  const after = advanced(c, LEVEL, now)
  assert.equal(after.level, 3)
  assert.equal(remaining(after, LEVEL, now), 10 * 60 * 1000)
})

test('a level boundary lands exactly on the next level', () => {
  const c = { level: 4, levelStartedAt: START, pausedElapsed: null }
  const after = advanced(c, LEVEL, START + LEVEL)
  assert.equal(after.level, 5)
  assert.equal(remaining(after, LEVEL, START + LEVEL), LEVEL)
})

test('pausing stops the clock no matter how long you leave it', () => {
  const paused = { level: 2, levelStartedAt: START, pausedElapsed: 3 * 60 * 1000 }
  assert.ok(isPaused(paused))
  // An hour later it still has the same time left, and has not changed level.
  assert.equal(remaining(paused, LEVEL, START + 60 * 60 * 1000), 17 * 60 * 1000)
  assert.deepEqual(advanced(paused, LEVEL, START + 60 * 60 * 1000), paused)
})

test('pause then resume an hour later keeps the same time left', () => {
  const c = { level: 2, levelStartedAt: START, pausedElapsed: null }
  const at = START + 3 * 60 * 1000
  const stopped = pauseClock(c, LEVEL, at)
  assert.ok(isPaused(stopped))
  assert.equal(remaining(stopped, LEVEL, at), 17 * 60 * 1000)

  // The whole point: real time passing while paused must buy nothing and cost nothing.
  const later = at + 60 * 60 * 1000
  const running = resumed(stopped, later)
  assert.equal(isPaused(running), false)
  assert.equal(remaining(running, LEVEL, later), 17 * 60 * 1000)
  assert.equal(running.level, 2)
})

test('pausing a level that already overran stores the level, not more', () => {
  const c = { level: 1, levelStartedAt: START, pausedElapsed: null }
  const stopped = pauseClock(c, LEVEL, START + 10 * LEVEL)
  assert.equal(stopped.pausedElapsed, LEVEL)
  assert.equal(remaining(stopped, LEVEL, START + 99 * LEVEL), 0)
})

test('pausing an already paused clock changes nothing', () => {
  const stopped = { level: 2, levelStartedAt: START, pausedElapsed: 1000 }
  assert.deepEqual(pauseClock(stopped, LEVEL, START + 999_999), stopped)
})

test('next level by hand starts a full level, running, from now', () => {
  const stopped = { level: 2, levelStartedAt: START, pausedElapsed: 1000 }
  const next = nextLevel(stopped, START + 5000)
  assert.equal(next.level, 3)
  assert.equal(isPaused(next), false)
  assert.equal(remaining(next, LEVEL, START + 5000), LEVEL)
})

test('remaining never goes negative', () => {
  const c = { level: 1, levelStartedAt: START, pausedElapsed: null }
  assert.equal(remaining(c, LEVEL, START + 10 * LEVEL), 0)
})

test('blinds double each level and stop before they overflow', () => {
  assert.deepEqual(blindsAtLevel(500, 500, 1), [500, 500])
  assert.deepEqual(blindsAtLevel(500, 500, 2), [1000, 1000])
  assert.deepEqual(blindsAtLevel(500, 500, 4), [4000, 4000])
  // Clamped at 12 doublings, so a clock left running overnight prints a big number rather
  // than a negative one. `1 << 12` would be fine but `1 << 31` wraps: JS bitwise is 32-bit.
  assert.deepEqual(blindsAtLevel(500, 500, 13), blindsAtLevel(500, 500, 99))
  assert.ok(blindsAtLevel(500, 500, 99)[0] > 0)
  assert.ok(blindsAtLevel(500, 500, 99)[0] > (1 << 31))   // the trap, stated
  // A game with no stakes recorded has nothing to double.
  assert.equal(blindsAtLevel(null, null, 3), null)
})

test('the label rounds up so it never shows a minute early', () => {
  assert.equal(clockLabel(20 * 60 * 1000), '20:00')
  assert.equal(clockLabel(59_500), '1:00')   // not "0:59"
  assert.equal(clockLabel(6_200), '0:07')
  assert.equal(clockLabel(0), '0:00')
})

test('clock state survives being written to storage and read back', () => {
  for (const original of [
    { level: 3, levelStartedAt: START, pausedElapsed: null },
    { level: 1, levelStartedAt: START, pausedElapsed: 42_000 },
  ]) {
    assert.deepEqual(parseClock(serialiseClock(original)), original)
  }
  assert.equal(parseClock('rubbish'), null)
  // Number('') is 0, so an empty field must be rejected rather than read as level 0.
  assert.equal(parseClock('||'), null)
  assert.equal(parseClock('1|x|-1'), null)
})

// ===================== GamePresetsTest.kt =====================

const preset = (name, sb = 500, bb = 500) => ({
  name, gameType: 'cash', smallBlindCents: sb, bigBlindCents: bb, currency: 'INR', location: null,
})

test('saving the same name twice edits it', () => {
  const once = upsert([preset('Friday', 200, 200)], preset('Friday', 500, 500))
  assert.equal(once.length, 1)
  assert.equal(once[0].smallBlindCents, 500)
})

test('name match ignores case and surrounding space', () => {
  assert.equal(upsert([preset('Friday')], preset('  friday  ')).length, 1)
})

test('newest first, and the row stops at MAX', () => {
  let list = []
  for (let i = 0; i < MAX + 2; i++) list = upsert(list, preset(`Game ${i}`))
  assert.equal(list.length, MAX)
  assert.equal(list[0].name, `Game ${MAX + 1}`)
  // The two oldest fell off, not the ones just saved.
  assert.ok(!list.some((p) => p.name === 'Game 0'))
})

test('a corrupt store reads as no presets, not a crash', () => {
  assert.deepEqual(parsePresets('{ this is not json'), [])
  assert.deepEqual(parsePresets(null), [])
  assert.deepEqual(parsePresets('{"not":"an array"}'), [])
  assert.deepEqual(parsePresets('[{"no":"name"}]'), [])
})

test('a preset round-trips through storage with its symbols intact', () => {
  const saved = [preset('Friday ₹5/₹5')]
  const back = parsePresets(JSON.stringify(saved))
  assert.equal(back[0].name, 'Friday ₹5/₹5')
  assert.equal(back[0].bigBlindCents, 500)
  assert.equal(back[0].currency, 'INR')
  assert.deepEqual(remove(back, 'friday ₹5/₹5'), [])
})

// ===================== TimeText.kt =====================
// No Kotlin test existed for these; the date ones earn one because of the timezone trap.

test('the timestamps Postgres actually returns parse', () => {
  const at = parseInstant('2026-08-31T12:38:29.764517+00:00')
  assert.equal(at.getTime(), Date.UTC(2026, 7, 31, 12, 38, 29, 764))
  assert.equal(parseInstant(null), null)
  assert.equal(parseInstant('not a date'), null)
})

test('a calendar date names the right weekday from any timezone', () => {
  // new Date('2026-08-31').getDay() reads the UTC midnight in LOCAL time, so anywhere west
  // of UTC it would say Sunday. Both formatters build and read in UTC.
  assert.equal(longDate('2026-08-31'), 'Monday, 31 August 2026')
  assert.equal(shortDate('2026-09-03'), '3 Sep 2026')
  assert.equal(longDate('nonsense'), 'nonsense')
  assert.equal(shortDate('2026-02-31'), '2026-02-31')   // not a real date, handed back as-is
})

test('durations and relative times read like the app', () => {
  const from = new Date('2026-09-05T20:00:00Z')
  const mins = (n) => new Date(from.getTime() + n * 60_000)
  assert.equal(durationLabel(from, null, mins(0)), '0m')
  assert.equal(durationLabel(from, null, mins(47)), '47m')
  assert.equal(durationLabel(from, null, mins(192)), '3h 12m')
  assert.equal(durationLabel(from, mins(90), mins(999)), '1h 30m')   // `to` wins over now
  assert.equal(durationLabel(null, null, mins(10)), '0m')

  assert.equal(relativeLabel(from, mins(0.5)), 'Just now')
  assert.equal(relativeLabel(from, mins(4)), '4m ago')
  assert.equal(relativeLabel(from, mins(120)), '2h ago')
  assert.equal(relativeLabel(from, mins(60 * 24 * 3)), '3d ago')
  assert.equal(relativeLabel(null, mins(1)), '')
})

// ===================== Share.kt =====================

test('the results message is the one people paste into WhatsApp', () => {
  const game = { name: 'Friday', currency: 'INR', ledgerSlug: 'abc123' }
  const t = [{ fromName: 'Darsh', toName: 'Soham', amountCents: 18900 }]
  assert.equal(
    resultsMessage(game, t),
    'Friday — final results\n\n'
    + 'Darsh pays Soham ₹189\n\n'
    + 'Full ledger: https://dvpvalo.github.io/splitpot-ledger/?g=abc123\n',
  )
  assert.ok(resultsMessage(game, []).includes("Everyone's square. Nothing to settle."))
  assert.equal(historyUrl('slug9'), 'https://dvpvalo.github.io/splitpot-ledger/history.html?h=slug9')
})

// ---------- the oval table ----------
import {
  RACK_MAX, SEAT_H, SEAT_W, pileLabel, rackEdges, seatName, shuffled, stackCheck, stackVerdict, tableLayout,
} from '../public/lib/table.js'

test('seats never overlap, from an empty table to a full one, phone to desktop', () => {
  for (const width of [343, 358, 560, 640]) {
    for (let count = 1; count <= 11; count++) {
      const { seats, height } = tableLayout(count, width)
      assert.equal(seats.length, count)
      for (const s of seats) {
        assert.ok(s.x - SEAT_W / 2 >= -0.5 && s.x + SEAT_W / 2 <= width + 0.5, `seat off the side at ${width}/${count}`)
        assert.ok(s.y - SEAT_H / 2 >= -0.5 && s.y + SEAT_H / 2 <= height + 0.5, `seat off the end at ${width}/${count}`)
      }
      for (let i = 0; i < seats.length; i++) {
        for (let j = i + 1; j < seats.length; j++) {
          const apart = Math.abs(seats[i].x - seats[j].x) >= SEAT_W - 0.5
            || Math.abs(seats[i].y - seats[j].y) >= SEAT_H - 0.5
          assert.ok(apart, `seats ${i} and ${j} collide at ${width}px with ${count}`)
        }
      }
    }
  }
})

test('the first seat is at the head of the table', () => {
  const { seats, width } = tableLayout(6, 358)
  assert.ok(Math.abs(seats[0].x - width / 2) < 1)
  assert.ok(seats.every((s) => s.y >= seats[0].y))
})

test('pile label groups chips, biggest first', () => {
  const f = (v) => `₹${v / 100}`
  assert.equal(pileLabel([10000, 5000, 10000], f), '2 × ₹100 + ₹50')
  assert.equal(pileLabel([], f), '')
})

test('racks scale to the deepest player and never draw money as nothing', () => {
  const r = rackEdges([
    { buyInCents: 60000, cashOutCents: 0 },
    { buyInCents: 20000, cashOutCents: 35000 },
    { buyInCents: 500, cashOutCents: 0 },
    { buyInCents: 0, cashOutCents: 0 },
  ])
  assert.deepEqual(r[0], { in: RACK_MAX, out: 0 })
  assert.equal(r[2].in, 1)
  assert.deepEqual(r[3], { in: 0, out: 0 })
  for (const x of r) assert.ok(x.in + x.out <= RACK_MAX)
  assert.ok(r[1].out > 0 && r[1].in > 0)
  assert.deepEqual(rackEdges([]), [])
})

test('seat names shorten to a first name and an initial', () => {
  assert.equal(seatName('Soham Agarwal'), 'Soham A.')
  assert.equal(seatName('  Darsh  '), 'Darsh')
  assert.equal(seatName('Ana Maria Lopez'), 'Ana L.')
})

test('settlement card rows: one per payment, or a single square line', async () => {
  const { settlementLines } = await import('../public/lib/card.js')
  assert.deepEqual(settlementLines([], 'INR'), [["Everyone's square", '']])
  const rows = settlementLines([{ fromName: 'Yash', toName: 'Yashraj', amountCents: 20000 }], 'INR')
  assert.equal(rows.length, 1)
  assert.equal(rows[0][0], 'Yash  →  Yashraj')
  assert.ok(rows[0][1].includes('200'))
})

// ---------- insights (port: InsightsTest.kt) ----------

const inight = (playerId, gameId, playedOn, netCents, buyinCount = 1, currency = 'INR') => ({
  playerId, playerName: playerId, isSelf: playerId === 'me', gameId, gameName: gameId,
  playedOn, startedAt: `${playedOn}T20:00:00Z`, currency, inCents: 0, outCents: 0, netCents, buyinCount,
})

test('insights: totals, win rate, running trend and form', async () => {
  const { insightsFor } = await import('../public/lib/insights.js')
  const nights = [
    inight('me', 'g1', '2026-09-01', 500),
    inight('me', 'g2', '2026-09-02', -200, 2),
    inight('me', 'g3', '2026-09-03', 0),
    inight('me', 'g4', '2026-09-05', 300, 3),
    inight('me', 'gx', '2026-09-06', 9999, 1, 'GBP'), // other currency: never mixed in
    inight('dan', 'g1', '2026-09-01', -500),
  ]
  const r = insightsFor(nights, 'me', 'INR')
  assert.equal(r.games, 4)
  assert.equal(r.wins, 2)
  assert.equal(r.losses, 1)
  assert.equal(r.level, 1)
  assert.equal(r.netCents, 600)
  assert.equal(r.winRate, 50)
  assert.equal(r.avgCents, 200, '₹1.50 a game rounds to a whole rupee')
  assert.deepEqual(r.trend.map((t) => t.runningCents), [500, 300, 300, 600])
  assert.deepEqual(r.form, ['up', 'flat', 'down', 'up'])
  assert.equal(r.longestWin, 1, 'a level night breaks a winning run')
  assert.equal(r.best.gameId, 'g1')
  assert.equal(r.worst.gameId, 'g2')
  assert.deepEqual(r.rebuy, { gamesPct: 50, perGame: 0.8, nights: 2, after: 50, without: 50 })
})

test('insights: empty, seasons, and no made-up figures', async () => {
  const { insightsFor } = await import('../public/lib/insights.js')
  const empty = insightsFor([], 'me', 'INR')
  assert.equal(empty.games, 0)
  assert.equal(empty.winRate, null)
  assert.equal(empty.bestWeekday, null)
  assert.equal(empty.rebuy, null)

  const nights = [inight('me', 'a', '2026-08-30', 100), inight('me', 'b', '2026-09-04', -50)]
  assert.equal(insightsFor(nights, 'me', 'INR', { key: '2026-09' }).games, 1)
  assert.equal(insightsFor(nights, 'me', 'INR', { key: null }).games, 2)

  // A server without buyin_count gives no rebuy figure rather than 0%.
  const old = nights.map(({ buyinCount, ...n }) => n)
  assert.equal(insightsFor(old, 'me', 'INR').rebuy, null)
  // Never rebought: the rate is 0%, and "after a rebuy" has nothing to say.
  assert.deepEqual(insightsFor(nights, 'me', 'INR').rebuy, { gamesPct: 0, perGame: 0, nights: 0, after: null, without: 50 })
})

test('insights: best weekday needs two weekdays and averages them', async () => {
  const { insightsFor, weekdayOf } = await import('../public/lib/insights.js')
  assert.equal(weekdayOf('2026-10-02'), 5) // a Friday
  const fridaysOnly = [inight('me', 'a', '2026-10-02', 100), inight('me', 'b', '2026-09-25', 100)]
  assert.equal(insightsFor(fridaysOnly, 'me', 'INR').bestWeekday, null)
  const mixed = [
    inight('me', 'a', '2026-10-02', 300), // Fri
    inight('me', 'b', '2026-09-25', -100), // Fri  -> avg 100
    inight('me', 'c', '2026-09-30', 150), // Wed  -> avg 150
  ]
  assert.deepEqual(insightsFor(mixed, 'me', 'INR').bestWeekday, { label: 'Wednesdays', nights: 1, avgCents: 200 })
})

test('insights: longest winning run counts oldest to newest', async () => {
  const { insightsFor } = await import('../public/lib/insights.js')
  const nights = ['01', '02', '03', '04', '05'].map((d, i) =>
    inight('me', `g${d}`, `2026-09-${d}`, [10, 10, -5, 10, 10][i]))
  nights.push(inight('me', 'g06', '2026-09-06', 10))
  assert.equal(insightsFor(nights, 'me', 'INR').longestWin, 3)
})

test('head to head: only nights both played, ties count for nobody', async () => {
  const { headToHead } = await import('../public/lib/insights.js')
  const nights = [
    inight('me', 'g1', '2026-09-01', 500), inight('dan', 'g1', '2026-09-01', -500),
    inight('me', 'g2', '2026-09-02', -100), inight('dan', 'g2', '2026-09-02', 300),
    inight('me', 'g3', '2026-09-03', 0), inight('dan', 'g3', '2026-09-03', 0),
    inight('me', 'g4', '2026-09-04', 999), // dan absent
  ]
  assert.deepEqual(headToHead(nights, 'me', 'dan', 'INR'), {
    together: 3, aAhead: 1, bAhead: 1, aNetCents: 400, bNetCents: -200,
  })
})

test('insights: game length ignores games left open, and splits short from long', async () => {
  const { insightsFor, hoursOf } = await import('../public/lib/insights.js')
  const at = (n, start, end) => ({ ...n, startedAt: start, finishedAt: end })
  assert.equal(hoursOf(at({}, '2026-09-01T15:00:00Z', '2026-09-02T12:00:00Z')), null, '21h was left open')
  assert.equal(hoursOf(at({}, '2026-09-01T15:00:00Z', '2026-09-01T17:30:00Z')), 2.5)
  assert.equal(hoursOf(at({}, '2026-09-01T15:00:00Z', null)), null)
  const nights = [
    at(inight('me', 'a', '2026-09-01', 1000), '2026-09-01T15:00:00Z', '2026-09-01T17:00:00Z'), // 2h up
    at(inight('me', 'b', '2026-09-02', -400), '2026-09-02T15:00:00Z', '2026-09-02T19:00:00Z'), // 4h down
    at(inight('me', 'c', '2026-09-03', 300), '2026-09-03T15:00:00Z', '2026-09-04T15:00:00Z'), // left open
  ]
  const r = insightsFor(nights, 'me', 'INR')
  assert.equal(r.time.games, 2)
  assert.equal(r.time.hours, 6)
  assert.equal(r.time.longestHours, 4)
  assert.equal(r.time.perHourCents, 100, '₹6 over 6 hours, rounded to whole rupees')
  assert.deepEqual(r.shortLong, { first: { games: 1, pct: 100 }, second: { games: 1, pct: 0 } })
})

test('insights: deep dive, money, bust rate, months and buy-in size', async () => {
  const { insightsFor } = await import('../public/lib/insights.js')
  const n = (g, d, net, inC, outC, first) => ({ ...inight('me', g, d, net), inCents: inC, outCents: outC, firstBuyinCents: first })
  const nights = [
    n('a', '2026-08-10', 2000, 1000, 3000, 1000),
    n('b', '2026-08-20', -1000, 1000, 0, 1000),
    n('c', '2026-09-05', -3000, 3000, 0, 2000),
    n('d', '2026-09-12', 500, 2000, 2500, 2000),
  ]
  const r = insightsFor(nights, 'me', 'INR')
  assert.equal(r.deepDive.typicalCents, -200, 'median of -3000,-1000,500,2000 is -250, rounded to whole rupees')
  assert.equal(r.deepDive.avgWinCents, 1300, '(2000 + 500) / 2, rounded to whole rupees')
  assert.equal(r.deepDive.avgLossCents, -2000)
  assert.deepEqual(r.deepDive.last5, { games: 4, netCents: -1500, wins: 2, losses: 2 })
  assert.deepEqual(r.money, { inCents: 7000, outCents: 5500, roi: -21 })
  assert.deepEqual(r.bust, { nights: 2, pct: 50 })
  assert.deepEqual(r.months.rows.map((m) => [m.label, m.netCents]), [['Aug 2026', 1000], ['Sep 2026', -2500]])
  assert.equal(r.months.best.label, 'Aug 2026')
  assert.equal(r.months.worst.label, 'Sep 2026')
  assert.deepEqual(r.buyInSize, { small: { cents: 1000, games: 2, pct: 50 }, big: { cents: 2000, games: 2, pct: 50 } })
})

test('insights: table size, rank, trend by month, rivals and the comparison', async () => {
  const { insightsFor, trendBy, rivalsFor, comparisonSeries } = await import('../public/lib/insights.js')
  const seat = (p, g, d, net) => inight(p, g, d, net)
  const nights = [
    // g1: a big table (6), me up
    ...['me', 'a', 'b', 'c', 'd', 'e'].map((p, i) => seat(p, 'g1', '2026-08-01', [600, -100, -100, -100, -100, -200][i])),
    // g2, g3: small tables, me down then up
    seat('me', 'g2', '2026-08-15', -300), seat('a', 'g2', '2026-08-15', 300),
    seat('me', 'g3', '2026-09-02', 100), seat('a', 'g3', '2026-09-02', -100),
  ]
  const r = insightsFor(nights, 'me', 'INR')
  assert.deepEqual(r.tables, { first: { games: 2, pct: 50 }, second: { games: 1, pct: 100 } })
  assert.deepEqual(r.rank, { position: 1, of: 6 })
  assert.deepEqual(trendBy(r.trend, 'month').map((t) => [t.gameName, t.netCents, t.runningCents, t.games]),
    [['Aug 2026', 300, 300, 2], ['Sep 2026', 100, 400, 1]])
  assert.deepEqual(trendBy(r.trend, 'year').map((t) => t.runningCents), [400])

  const { rivals, nemesis, favourite } = rivalsFor(nights, 'me', 'INR')
  assert.equal(rivals[0].playerId, 'a', 'most games together first')
  assert.equal(nemesis, null, 'I lead a 2-1 and beat everyone else: nobody has the edge on me')
  assert.equal(favourite.playerId, 'a')

  const cmpd = comparisonSeries(nights, ['me', 'b'], 'INR')
  assert.deepEqual(cmpd.games.map((g) => g.gameId), ['g1', 'g2', 'g3'])
  assert.deepEqual(cmpd.series[0].values, [600, 300, 400])
  assert.deepEqual(cmpd.series[1].values, [-100, -100, -100], 'level through games they sat out')
})

test('chart helpers: ticks include zero, axis labels are compact', async () => {
  const { niceTicks, compactMoney, hoursLabel } = await import('../public/lib/insights.js')
  assert.deepEqual(niceTicks(-250000, 600000), [-250000, 0, 250000, 500000, 750000])
  assert.deepEqual(niceTicks(100, 900), [0, 250, 500, 750, 1000])
  assert.equal(compactMoney(600000, 'INR'), '₹6k')
  assert.equal(compactMoney(150000, 'INR'), '₹1.5k')
  assert.equal(compactMoney(-300000, 'INR'), '-₹3k')
  assert.equal(compactMoney(50000, 'INR'), '₹500')
  assert.equal(hoursLabel(3.5), '3h 30m')
  assert.equal(hoursLabel(5), '5h')
})

test('sample nights: every made-up game sums to zero', async () => {
  const { sampleNights } = await import('../public/lib/insights.js')
  const games = new Map()
  for (const n of sampleNights()) {
    games.set(n.gameId, (games.get(n.gameId) ?? 0) + n.netCents)
    assert.equal(n.outCents - n.inCents, n.netCents)
    assert.ok(n.outCents >= 0)
  }
  assert.equal(games.size, 8)
  for (const total of games.values()) assert.equal(total, 0)
})

// ---------- the intro (port: IntroDemoTest.kt) ----------

test('intro demo: buy-ins arrive one seat at a time, then the rebuy, then results', async () => {
  const { demoAt } = await import('../public/lib/intro.js')
  assert.deepEqual(demoAt(0).tags, [null, null, null, null])
  assert.equal(demoAt(0).potCents, 0)
  assert.deepEqual(demoAt(2).tags.map((t) => t?.kind ?? null), ['buyin', 'buyin', null, null])
  assert.equal(demoAt(4).potCents, 200000)
  assert.ok(demoAt(5).cards)
  assert.equal(demoAt(6).tags[1].kind, 'rebuy')
  assert.equal(demoAt(6).potCents, 250000)
  const over = demoAt(7)
  assert.equal(over.centre, 'over')
  assert.deepEqual(over.tags.map((t) => t.kind), ['up', 'down', 'up', 'flat'])
  assert.equal(over.tags.reduce((s, t) => s + t.cents, 0), 0, 'the demo night sums to zero')
  assert.ok(demoAt(8).arrows && !demoAt(8).standings && demoAt(8).pay === null)
  // UPI held back (UPI_ENABLED false): straight from the arrows to the standings.
  assert.ok(demoAt(9).standings && demoAt(9).pay === null)
  // With UPI on, the Pay button and the tick come first.
  assert.deepEqual([demoAt(9, true).pay, demoAt(10, true).pay, demoAt(11, true).pay], ['ask', 'paid', null])
  assert.ok(!demoAt(10, true).standings && demoAt(11, true).standings)
  assert.equal(demoAt(9, true).caption, 'Tap Pay: UPI opens with the amount filled in')
  assert.equal(demoAt(9).caption, 'Every night adds to your standings')
})

test('intro demo: the settle-ups are what settle() really asks for', async () => {
  const { DEMO_TRANSFERS, DEMO_STANDINGS, demoAt } = await import('../public/lib/intro.js')
  assert.deepEqual(DEMO_TRANSFERS.map((t) => [t.from, t.to, t.cents]).sort(), [[1, 0, 50000], [1, 2, 25000]])
  assert.equal(demoAt(8).caption, 'Everyone square in 2 payments')
  assert.equal(DEMO_STANDINGS.reduce((s, r) => s + r.netCents, 0), 0)
})

test('intro demo: the clock maps to beats and loops', async () => {
  const { beatAt, demoBeats } = await import('../public/lib/intro.js')
  const DEMO_LOOP_MS = demoBeats(false).loop
  assert.equal(beatAt(0), 0)
  assert.equal(beatAt(650), 1)
  assert.equal(beatAt(5600), 7)
  assert.equal(beatAt(12000), 9)
  assert.equal(beatAt(10000, true), 9)
  assert.equal(beatAt(12000, true), 10)
  assert.equal(beatAt(13000, true), 11)
  assert.equal(demoBeats(true).loop, 16500)
  assert.equal(beatAt(DEMO_LOOP_MS + 650), 1)
})

test('game names get a capital first letter and nothing else changes', async () => {
  globalThis.document ??= undefined
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../public/views/newgame.js', import.meta.url), 'utf8'))
  const body = src.slice(src.indexOf('export function capitalizeFirst'))
  const capitalizeFirst = new Function(`${body.replace('export ', '')}; return capitalizeFirst`)()
  assert.equal(capitalizeFirst('maithil'), 'Maithil')
  assert.equal(capitalizeFirst('yashraj 200 kk'), 'Yashraj 200 kk')
  assert.equal(capitalizeFirst('Friday'), 'Friday')
  assert.equal(capitalizeFirst('200 kk'), '200 kk')
  assert.equal(capitalizeFirst(''), '')
})

// ---------- insights round 3 (port: InsightsTest.kt) ----------

// Five games, every one summing to zero. G5 sat open 20h, so it has no believable length.
const grow = (playerId, gameId, playedOn, start, hours, inCents, outCents, buyinCount) => ({
  playerId, playerName: playerId, isSelf: playerId === 'me', gameId, gameName: gameId, playedOn,
  startedAt: `${playedOn}T${start}:00:00Z`,
  finishedAt: new Date(Date.parse(`${playedOn}T${start}:00:00Z`) + hours * 3_600_000).toISOString(),
  currency: 'INR', inCents, outCents, netCents: outCents - inCents, buyinCount, firstBuyinCents: 100,
})
const group = [
  grow('me', 'G1', '2026-09-01', '20', 3, 100, 300, 1), grow('dan', 'G1', '2026-09-01', '20', 3, 200, 0, 2),
  grow('me', 'G2', '2026-09-03', '20', 3, 300, 0, 3), grow('dan', 'G2', '2026-09-03', '20', 3, 100, 400, 1),
  grow('eve', 'G2', '2026-09-03', '20', 3, 100, 100, 1),
  grow('me', 'G3', '2026-09-08', '20', 5, 300, 700, 3), grow('eve', 'G3', '2026-09-08', '20', 5, 100, 0, 1),
  grow('dan', 'G3', '2026-09-08', '20', 5, 300, 0, 3),
  grow('me', 'G4', '2026-10-02', '18', 3, 100, 250, 1), grow('eve', 'G4', '2026-10-02', '18', 3, 200, 50, 2),
  grow('dan', 'G5', '2026-10-02', '21', 20, 100, 200, 1), grow('eve', 'G5', '2026-10-02', '21', 20, 100, 0, 1),
]

test('insights 3: result calendar runs month by month, Monday first', async () => {
  const { insightsFor } = await import('../public/lib/insights.js')
  const cal = insightsFor(group, 'me', 'INR').calendar
  assert.deepEqual(cal.map((m) => [m.key, m.lead, m.days.length, m.netCents, m.games]),
    [['2026-09', 1, 30, 300, 3], ['2026-10', 3, 31, 150, 1]], '1 Sep 2026 is a Tuesday, 1 Oct a Thursday')
  assert.deepEqual(cal[0].days.filter((d) => d.netCents !== null).map((d) => [d.day, d.netCents]), [[1, 200], [3, -300], [8, 400]])
})

test('insights 3: results spread in buy-ins, and the swing', async () => {
  const { insightsFor } = await import('../public/lib/insights.js')
  const s = insightsFor(group, 'me', 'INR').spread
  assert.deepEqual(s.bands.map((b) => b.count), [1, 0, 0, 1, 2], '+2 buy-ins is a big win, -3 a big loss')
  // Each night in its own buy-in: +₹10 at a ₹5 table is 2 buy-ins, -₹10 at a ₹10 table is 1.
  const mixed = [inight('me', 'a', '2026-09-01', 1000), inight('me', 'b', '2026-09-02', -1000), inight('me', 'c', '2026-09-03', 0)]
  mixed[0].firstBuyinCents = 500
  mixed[1].firstBuyinCents = 1000
  mixed[2].firstBuyinCents = 1000
  assert.deepEqual(insightsFor(mixed, 'me', 'INR').spread.bands.map((b) => b.count), [0, 1, 1, 0, 1])
  assert.equal(s.swing, 2.6)
  assert.equal(s.style, 'Wild')
  assert.equal(insightsFor(group.slice(0, 2), 'me', 'INR').spread, null, 'under three games: no spread')
})

test('insights 3: badges, with the day each was earned', async () => {
  const { badgesFor } = await import('../public/lib/insights.js')
  const b = Object.fromEntries(badgesFor(group, 'me', 'INR').map((x) => [x.key, x]))
  assert.equal(b['first-win'].on, '2026-09-01')
  assert.equal(b['hat-trick'].earned, false, 'win, loss, win, win is not three in a row')
  assert.equal(b.top.on, '2026-09-01')
  assert.equal(b.comeback.on, '2026-09-08')
  assert.equal(b['big-night'].on, '2026-09-08')
  assert.deepEqual(b.regular.progress, { have: 4, need: 10 })
  assert.equal(b.shark.earned, false)
  assert.deepEqual(b.shark.progress, { have: 4, need: 10 }, '₹4.50 up on ₹1 buy-ins is 4 buy-ins')
})

test('insights 3: rank over time counts games they sat out', async () => {
  const { rankHistory, rankTicks } = await import('../public/lib/insights.js')
  const r = rankHistory(group, 'me', 'INR')
  assert.deepEqual(r.map((x) => x.rank), [1, 3, 1, 1, 1])
  assert.deepEqual(r.map((x) => x.of), [2, 3, 3, 3, 3])
  assert.deepEqual(r.map((x) => x.played), [true, true, true, true, false])
  assert.deepEqual(rankTicks(4), [1, 2, 3, 4])
  assert.deepEqual(rankTicks(13), [1, 4, 7, 10, 13])
})

test('insights 3: hall of fame, the oldest holder keeps a tie', async () => {
  const { hallOfFame } = await import('../public/lib/insights.js')
  const h = hallOfFame(group, 'INR')
  assert.deepEqual([h.pot.gameName, h.pot.cents], ['G3', 700])
  assert.deepEqual([h.win.playerName, h.win.cents], ['me', 400])
  assert.deepEqual([h.loss.playerName, h.loss.gameName, h.loss.cents], ['me', 'G2', -300])
  assert.deepEqual([h.rebuys.playerName, h.rebuys.gameName, h.rebuys.count], ['me', 'G2', 2])
  assert.deepEqual([h.longest.gameName, h.longest.hours], ['G3', 5], 'G5 sat open 20h and is not a record')
  assert.deepEqual([h.table.gameName, h.table.players], ['G2', 3])
  assert.equal(hallOfFame(group, 'GBP'), null)
})

test('insights 3: attendance, group totals and the head-to-head grid', async () => {
  const { attendanceFor, groupTotals, h2hGrid } = await import('../public/lib/insights.js')
  const a = attendanceFor(group, 'INR')
  assert.equal(a.games, 5)
  assert.deepEqual(a.rows.map((r) => [r.playerName, r.games, r.pct, r.streak]),
    [['eve', 4, 80, 4], ['dan', 4, 80, 1], ['me', 4, 80, 0]], 'eve sat in G2-G5, the last four in a row')
  const t = groupTotals(group, 'INR')
  assert.deepEqual([t.games, t.players, t.totalCents, t.changedHandsCents, t.avgPotCents, t.avgPlayers], [5, 3, 2000, 1150, 400, 2.4])
  assert.deepEqual(t.pots.map((p) => p.potCents), [300, 500, 700, 300, 200])
  const g = h2hGrid(group, 'INR', null, 2)
  assert.deepEqual(g.players.map((p) => p.playerName), ['eve', 'dan'])
  assert.deepEqual(g.cells[0][1], { together: 3, ahead: 1, behind: 2 })
  assert.deepEqual(g.cells[1][0], { together: 3, ahead: 2, behind: 1 })
  assert.equal(g.cells[0][0], null)
  assert.equal(g.more, 1)
})

test('upi: links only for a real id in rupees, amount always two places', async () => {
  const { isUpiId, upiLink, upiIdOf } = await import('../public/lib/money.js')
  assert.ok(isUpiId('yash.mour@okhdfcbank'))
  assert.ok(isUpiId(' 9876543210@ybl '))
  for (const bad of ['', 'yash', '@ybl', 'yash@', 'ya sh@ybl', 'yash@1bank', null]) assert.ok(!isUpiId(bad), String(bad))
  assert.equal(
    upiLink({ upiId: 'yash@ybl', name: 'Yash Mour', cents: 2400, currency: 'INR', note: 'Splitpot: Taniyaaa' }),
    'upi://pay?pa=yash@ybl&pn=Yash%20Mour&am=24.00&cu=INR&tn=Splitpot%3A%20Taniyaaa')
  assert.equal(upiLink({ upiId: 'yash@ybl', name: 'Y', cents: 105, currency: 'INR' }), 'upi://pay?pa=yash@ybl&pn=Y&am=1.05&cu=INR')
  assert.equal(upiLink({ upiId: 'yash@ybl', name: 'Y', cents: 2400, currency: 'GBP' }), null)
  assert.equal(upiLink({ upiId: 'yash@ybl', name: 'Y', cents: 0, currency: 'INR' }), null)
  assert.equal(upiIdOf({ payment_type: 'upi', payment_details: ' yash@ybl ' }), 'yash@ybl')
  assert.equal(upiIdOf({ payment_type: 'bank', payment_details: 'yash@ybl' }), null)
})

test('settle across games: the host’s real nine debts', async () => {
  const { settleAcross } = await import('../public/lib/money.js')
  const r = (id, from, to, cents) => ({ id, fromId: from, fromName: from, toId: to, toName: to, amountCents: cents })
  // Every pending settlement on 9 Oct 2026, three games.
  const rows = [
    r(1, 'vir', 'Krishit', 7500), r(2, 'vir', 'Darsh', 67500), r(3, 'Maithil', 'Darsh', 150000),
    r(4, 'Soham', 'Darsh', 6900),
    r(5, 'Vaibhav', 'Soham', 2700), r(6, 'Vaibhav', 'Yashraj', 7300), r(7, 'Tanish', 'Yash', 20000),
    r(8, 'Darsh', 'Yash', 10700), r(9, 'Darsh', 'Soham', 9300),
  ]
  const s = settleAcross(rows)
  // Simplifying would also take 8, but have Tanish pay three people - so pairwise wins the tie.
  assert.equal(s.simplified, false)
  assert.equal(s.debts, 9)
  assert.equal(s.payments.length, 8)
  const ds = s.payments.find((p) => p.fromId === 'Darsh' && p.toId === 'Soham')
  assert.deepEqual([ds.amountCents, ds.ids.sort()], [2400, [4, 9]])
  assert.equal(s.payments.flatMap((p) => p.ids).length, 9, 'every debt belongs to one payment')
})

test('settle across games: a chain collapses, a wash is kept to be cleared', async () => {
  const { settleAcross } = await import('../public/lib/money.js')
  const r = (id, from, to, cents) => ({ id, fromId: from, fromName: from, toId: to, toName: to, amountCents: cents })
  const chain = settleAcross([r(1, 'a', 'b', 100), r(2, 'b', 'c', 100), r(3, 'c', 'd', 100)])
  assert.equal(chain.simplified, true)
  assert.deepEqual(chain.payments.map((p) => [p.fromId, p.toId, p.amountCents, p.ids]), [['a', 'd', 100, null]])
  const wash = settleAcross([r(1, 'a', 'b', 500), r(2, 'b', 'a', 500)])
  assert.deepEqual(wash.payments.map((p) => [p.amountCents, p.ids]), [[0, [1, 2]]])
  assert.deepEqual(settleAcross([]).payments, [])
})

test('wrapped: every card for all time, worded as it is drawn', async () => {
  const { wrappedFor } = await import('../public/lib/wrapped.js')
  const cards = wrappedFor(group, 'INR', { label: 'All time', key: null })
  assert.deepEqual(cards.map((c) => [c.key, c.title, c.big, c.name]), [
    ['cover', 'The story so far', '5', 'games played'],
    ['pot', 'The biggest night', '₹7', 'G3'],
    ['win', 'Biggest single win', '+₹4', 'me'],
    ['loss', 'Toughest night', '-₹3', 'me'], // tied with dan's G3: the older one keeps it
    ['rebuy', 'Most likely to rebuy', '4', 'me'],
    ['regular', 'The regular', '4/5', 'eve'],
    ['podium', 'Top of the table', '', ''],
    ['end', 'The all-time winner', '+₹4.50', 'me'],
  ])
  assert.deepEqual(cards[0].lines, ['3 players', '₹20 across the table', '₹11.50 changed hands'])
  assert.deepEqual(cards[1].lines, ['8 Sep 2026', '3 players'])
  assert.deepEqual(cards[3].lines, ['G2 · 3 Sep 2026'])
  assert.deepEqual(cards[4].lines, ['rebuys across 2 games'])
  assert.deepEqual(cards[5].lines, ['4 in a row and counting'])
  assert.deepEqual(cards[6].rows, [
    { rank: 1, name: 'me', value: '+₹4.50', tone: 'up' },
    { rank: 2, name: 'dan', value: '-₹1', tone: 'down' },
    { rank: 3, name: 'eve', value: '-₹3.50', tone: 'down' },
  ])
  assert.deepEqual(cards[7].lines, ["That's you. Take a bow.", 'See you at the table.'])
})

test('wrapped: one month, someone else on top, and nothing to wrap', async () => {
  const { wrappedFor } = await import('../public/lib/wrapped.js')
  const sep = wrappedFor(group, 'INR', { label: 'Sep 2026', key: '2026-09' })
  assert.equal(sep[0].title, 'Sep 2026, wrapped')
  const regular = sep.find((c) => c.key === 'regular')
  assert.deepEqual([regular.title, regular.big, regular.name], ['Never missed a game', '3/3', 'dan'])
  const oct = wrappedFor(group.filter((n) => n.playerId !== 'me'), 'INR', { label: 'Oct 2026', key: '2026-10' })
  const end = oct.at(-1)
  assert.deepEqual([end.title, end.name, end.lines], ['The winner of Oct 2026', 'dan', ['See you at the table.']])
  assert.equal(oct.some((c) => c.key === 'rebuy'), true)
  assert.equal(wrappedFor(group, 'GBP', { label: 'All time', key: null }), null)
  const asEve = group.map((n) => ({ ...n, isSelf: n.playerId === 'eve' }))
  const eve = wrappedFor(asEve, 'INR', { label: 'All time', key: null }).at(-1)
  assert.deepEqual(eve.lines, ['You finished 3rd of 3, -₹3.50', 'See you at the table.'])
})

test('reminders: one night, two nights netted, and a simplified payment', async () => {
  const { reminderMessage } = await import('../public/lib/share.js')
  const gameOf = new Map([
    ['s7', { gameName: 'taniyaaa', playedOn: '2026-10-08', ledgerSlug: 'f119abcdef' }],
    ['s4', { gameName: 'tanish', playedOn: '2026-10-02', ledgerSlug: 'd2b2abcdef' }],
    ['s9', { gameName: 'taniyaaa', playedOn: '2026-10-08', ledgerSlug: 'f119abcdef' }],
  ])
  assert.equal(
    reminderMessage({ fromName: 'Tanish Mehta', toName: 'Yash Mour', amountCents: 20000, ids: ['s7'] }, gameOf, 'INR'),
    'Hi Tanish, quick reminder from our poker nights: you still owe Yash Mour ₹200 (taniyaaa, 8 Oct).\n'
    + 'Full ledger: https://dvpvalo.github.io/splitpot-ledger/?g=f119abcdef')
  // The host's real pair: 93 owed on the 8th, 69 owed back on the 2nd, so 24 - newest ledger.
  assert.equal(
    reminderMessage({ fromName: 'Darsh', toName: 'Soham Agarwal', amountCents: 2400, ids: ['s9', 's4'] }, gameOf, 'INR'),
    'Hi Darsh, quick reminder from our poker nights: you still owe Soham Agarwal ₹24 (tanish, 2 Oct and taniyaaa, 8 Oct).\n'
    + 'Full ledger: https://dvpvalo.github.io/splitpot-ledger/?g=f119abcdef')
  assert.equal(
    reminderMessage({ fromName: 'a', toName: 'd', amountCents: 100, ids: null }, gameOf, 'INR'),
    'Hi a, quick reminder from our poker nights: you still owe d ₹1 from our recent games.')
})

test('wrapped on Home: last calendar month, most-played currency, January wraps the year', async () => {
  const { wrappedDue } = await import('../public/lib/wrapped.js')
  assert.deepEqual(wrappedDue(group, '2026-10-12'), { season: { label: 'Sep 2026', key: '2026-09' }, currency: 'INR' })
  assert.equal(wrappedDue(group, '2026-09-30'), null, 'nothing played in August')
  const gbp = (id, on) => ({ ...group[0], gameId: id, playedOn: on, currency: 'GBP' })
  const dec = [gbp('x', '2026-12-01'), gbp('y', '2026-12-05'), { ...group[0], gameId: 'z', playedOn: '2026-12-09' }]
  assert.deepEqual(wrappedDue(dec, '2027-01-02'), { season: { label: 'Dec 2026', key: '2026-12' }, currency: 'GBP' })
})

test('invites: the time reads like a person wrote it, and the group message', async () => {
  const { inviteMessage, inviteTime } = await import('../public/lib/share.js')
  assert.equal(inviteTime(new Date(2026, 9, 16, 21, 0)), 'Fri 16 Oct, 9:00 pm')
  assert.equal(inviteTime(new Date(2026, 9, 17, 0, 5)), 'Sat 17 Oct, 12:05 am')
  assert.equal(inviteTime(new Date(2026, 9, 17, 12, 30)), 'Sat 17 Oct, 12:30 pm')
  assert.equal(
    inviteMessage({ title: 'Poker night', startsAt: new Date(2026, 9, 16, 21, 0), location: "Maithil's place", slug: 'abc123xyz' }),
    "Poker night · Fri 16 Oct, 9:00 pm · Maithil's place\nIn or out? Tap your name: https://dvpvalo.github.io/splitpot-ledger/invite.html?i=abc123xyz")
  assert.equal(
    inviteMessage({ title: 'Poker night', startsAt: new Date(2026, 9, 16, 21, 0), location: null, slug: 's' }).split('\n')[0],
    'Poker night · Fri 16 Oct, 9:00 pm')
})

test('shuffle seats: Fisher-Yates, same seats, never the order it started in', () => {
  const seq = (...r) => { let i = 0; return () => r[i++ % r.length] }
  assert.deepEqual(shuffled(['a', 'b', 'c', 'd'], seq(0)), ['b', 'c', 'd', 'a'])
  // 0.999 picks j = i every time, which moves nobody: that draw is thrown away and redone.
  assert.deepEqual(shuffled(['a', 'b', 'c', 'd'], seq(0.999, 0.999, 0.999, 0, 0, 0)), ['b', 'c', 'd', 'a'])
  assert.deepEqual(shuffled(['solo']), ['solo'])
  const out = shuffled([1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5, 6, 7, 8])
  assert.notDeepEqual(out, [1, 2, 3, 4, 5, 6, 7, 8])
})

test('join hint names the players page, or only the camera when the game has no code', () => {
  assert.equal(joinHint('K7QMXR'), 'Scan with the camera, or open dvpvalo.github.io/splitpot-ledger and type the code.')
  assert.equal(joinHint(null), 'Scan with the camera to open the live ledger.')
})

test('stack counts: counted against what is on the table, cashed-out seats left out', () => {
  const seats = [
    { gamePlayerId: 'a', hasCashedOut: false }, { gamePlayerId: 'b', hasCashedOut: false },
    { gamePlayerId: 'c', hasCashedOut: true },
  ]
  const half = stackCheck([{ game_player_id: 'a', amount_cents: 90000 }, { game_player_id: 'c', amount_cents: 5000 }], seats, 150000)
  assert.deepEqual([half.counted, half.of, half.countedCents, half.diffCents], [1, 2, 90000, null])
  assert.deepEqual(half.missing.map((s) => s.gamePlayerId), ['b'])
  assert.equal(half.counts.length, 1)
  const all = stackCheck([{ game_player_id: 'a', amount_cents: 90000 }, { game_player_id: 'b', amount_cents: 40000 }], seats, 150000)
  assert.deepEqual([all.counted, all.of, all.diffCents, all.missing.length], [2, 2, -20000, 0])
  const f = (c) => `₹${c / 100}`
  assert.equal(stackVerdict(all.diffCents, f), '₹200 short')
  assert.equal(stackVerdict(3000, f), '₹30 over')
  assert.equal(stackVerdict(0, f), 'Adds up ✓')
})

test('player card link lives on the app, so it can read the same insights code', () => {
  assert.equal(playerCardMessage('Yash Mour', 'abc123xyz'), "Yash Mour's poker card\nhttps://splitpot.pages.dev/player.html?p=abc123xyz")
})

test('season race: running totals game by game, top first, one colour each all the way', async () => {
  const { raceFrames, raceAt, raceDuration } = await import('../public/lib/insights.js')
  const f = raceFrames(group, 'INR')
  assert.deepEqual(f.map((x) => [x.gameId, x.index, x.of]), [['G1', 1, 5], ['G2', 2, 5], ['G3', 3, 5], ['G4', 4, 5], ['G5', 5, 5]])
  assert.deepEqual(f.map((x) => x.rows.map((r) => `${r.playerId}${r.totalCents}`)), [
    ['me200', 'dan-200'], ['dan100', 'eve0', 'me-100'], ['me300', 'eve-100', 'dan-200'],
    ['me450', 'dan-200', 'eve-250'], ['me450', 'dan-100', 'eve-350'],
  ])
  assert.deepEqual(f[4].rows.map((r) => [r.playerId, r.colour]), [['me', 1], ['dan', 0], ['eve', 2]], 'dan sat down first by name, eve a game later')
  const oct = raceFrames(group, 'INR', { key: '2026-10' })
  assert.deepEqual(oct.map((x) => x.rows.map((r) => `${r.playerId}${r.totalCents}`)), [['me150', 'eve-150'], ['me150', 'dan100', 'eve-250']])
  assert.deepEqual([raceAt(0, 5), raceAt(450, 5), raceAt(1000, 5), raceAt(1200, 5), raceAt(6100, 5)], [0, 0.5, 1, 1, 5])
  assert.equal(raceDuration(5), 8000)
})

// ---------- dealer's choice (port of VariantsTest.kt) ----------

import {
  DEFAULT_GAMES, parseGames, removeGame, ruleLines, spinPick, upsertGame,
} from '../public/lib/variants.js'

test('games: nothing stored or junk stored reads as the defaults, an emptied list stays empty', () => {
  assert.deepEqual(parseGames(null), DEFAULT_GAMES)
  assert.deepEqual(parseGames('{oops'), DEFAULT_GAMES)
  assert.deepEqual(parseGames('{"name":"PLO"}'), DEFAULT_GAMES)
  assert.deepEqual(parseGames('[]'), [])
  assert.deepEqual(parseGames('[{"name":"  Fruits "},{"name":""},{"rules":"x"},null]'),
    [{ name: 'Fruits', rules: '' }])
})

test('games: edit in place, add at the end, a rename never leaves a name twice', () => {
  const list = [{ name: 'PLO', rules: '' }, { name: 'Fruits', rules: '' }, { name: 'Saddam', rules: '' }]
  assert.deepEqual(upsertGame(list, 'fruits', { name: 'Fruits', rules: 'a' }).map((g) => g.rules), ['', 'a', ''])
  assert.deepEqual(upsertGame(list, null, { name: ' Big O ', rules: '' }).map((g) => g.name),
    ['PLO', 'Fruits', 'Saddam', 'Big O'])
  assert.deepEqual(upsertGame(list, 'Fruits', { name: 'saddam', rules: '' }).map((g) => g.name), ['PLO', 'saddam'])
  assert.deepEqual(removeGame(list, 'FRUITS').map((g) => g.name), ['PLO', 'Saddam'])
})

test('games: a spin never lands on the game being played, unless it is the only one', () => {
  const names = ['A', 'B', 'C']
  for (const r of [0, 0.34, 0.5, 0.99, 1]) assert.notEqual(spinPick(names, 'B', () => r), 'B')
  assert.equal(spinPick(['A'], 'A', () => 0.5), 'A')
  assert.equal(spinPick([], null), null)
  assert.equal(spinPick(names, null, () => 0.99), 'C')
})

test('games: rules split one per line, blanks and typed bullets dropped', () => {
  assert.deepEqual(ruleLines('- one\n\n  • two  \n*three\n'), ['one', 'two', 'three'])
  assert.deepEqual(ruleLines(''), [])
  // Every built-in has rules except the house games, which are the host's to write.
  const blank = DEFAULT_GAMES.filter((g) => ruleLines(g.rules).length === 0).map((g) => g.name)
  assert.deepEqual(blank, ['3 Patti poker', 'Fruits', 'Saddam'])
})
