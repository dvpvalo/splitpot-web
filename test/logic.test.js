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
import { historyUrl, resultsMessage } from '../public/lib/share.js'

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
import { RACK_MAX, SEAT_H, SEAT_W, pileLabel, rackEdges, seatName, tableLayout } from '../public/lib/table.js'

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
