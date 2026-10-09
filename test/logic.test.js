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
  assert.ok(demoAt(8).arrows && !demoAt(8).standings)
  assert.ok(demoAt(9).standings)
})

test('intro demo: the settle-ups are what settle() really asks for', async () => {
  const { DEMO_TRANSFERS, DEMO_STANDINGS, demoAt } = await import('../public/lib/intro.js')
  assert.deepEqual(DEMO_TRANSFERS.map((t) => [t.from, t.to, t.cents]).sort(), [[1, 0, 50000], [1, 2, 25000]])
  assert.equal(demoAt(8).caption, 'Everyone square in 2 payments')
  assert.equal(DEMO_STANDINGS.reduce((s, r) => s + r.netCents, 0), 0)
})

test('intro demo: the clock maps to beats and loops', async () => {
  const { beatAt, DEMO_LOOP_MS } = await import('../public/lib/intro.js')
  assert.equal(beatAt(0), 0)
  assert.equal(beatAt(650), 1)
  assert.equal(beatAt(5600), 7)
  assert.equal(beatAt(12000), 9)
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
