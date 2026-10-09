// Insights: everything one player's finished nights add up to, and the group comparisons on
// the All-time standings tab. Pure, so it is tested in logic.test.js and ported line for line
// to data/Insights.kt.
//
// Built on the same PlayerNight rows as records and seasons (host_stats -> nights), so it
// costs no extra fetch and works from whatever is cached. One player, one currency, one season
// at a time: a figure that adds rupees to pounds is a fiction.

import { currencySymbol, minorUnitDigits } from './money.js'
import { recordsFor, standingsFor } from './stats.js'

const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A game "longer" than this was left open, not played: finished_at is when someone pressed
 * Finish, and in the real data two of nine games sat open overnight (21h and 27h). Those are
 * left out of every time figure rather than dragging the hourly rate to nothing.
 * ponytail: a fixed cut-off; a per-host "usual length" would catch shorter mistakes too.
 */
export const LEFT_OPEN_HOURS = 12

/** Short vs long games are split here, in hours. */
export const LONG_GAME_HOURS = 3

/** Six or more seated counts as a big table. */
export const BIG_TABLE = 6

/** Day of the week of a 'YYYY-MM-DD' played_on, read as a calendar date, never a local time. */
export function weekdayOf(playedOn) {
  const [y, m, d] = playedOn.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * An average, rounded to a whole rupee (pound, dollar...). Nobody reads "₹101.54 a game" and
 * learns more than from "₹102", and paise only ever appear in an average, never a buy-in.
 */
export function roundToMajor(cents, currency) {
  const unit = 10 ** minorUnitDigits(currency)
  return Math.round(cents / unit) * unit
}

/** Hours between start and finish, or null when either is missing or the game was left open. */
export function hoursOf(n) {
  if (!n.startedAt || !n.finishedAt) return null
  const ms = Date.parse(n.finishedAt) - Date.parse(n.startedAt)
  if (!(ms > 0)) return null
  const h = ms / 3_600_000
  return h > LEFT_OPEN_HOURS ? null : h
}

const pct = (part, whole) => (whole ? Math.round((part * 100) / whole) : null)
const inSeason = (n, season) => !season || season.key === null || n.playedOn.startsWith(season.key)
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
/** Oldest first, the way a chart reads. */
const chronological = (a, b) => cmp(a.playedOn, b.playedOn) || cmp(a.startedAt ?? '', b.startedAt ?? '')

/** Currencies a player has finished nights in, most-played first. */
export function currenciesFor(nights, playerId) {
  const counts = new Map()
  for (const n of nights) {
    if (n.playerId === playerId) counts.set(n.currency, (counts.get(n.currency) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
}

/** The middle night, the "typical result". Even counts average the two middle ones. */
function median(values) {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** How many of these nights finished up, as {games, pct}. */
const upRate = (rows) => ({ games: rows.length, pct: pct(rows.filter((n) => n.netCents > 0).length, rows.length) })

export function insightsFor(nights, playerId, currency, season = null) {
  const scoped = nights.filter((n) => inSeason(n, season))
  // Newest first, with best/worst/streak, exactly as the records sheet computes them.
  const rec = recordsFor(scoped, playerId, currency)
  const newest = rec.nights
  const oldest = [...newest].reverse()

  const games = newest.length
  const wins = newest.filter((n) => n.netCents > 0).length
  const losses = newest.filter((n) => n.netCents < 0).length
  const netCents = newest.reduce((s, n) => s + n.netCents, 0)
  const inCents = newest.reduce((s, n) => s + n.inCents, 0)
  const outCents = newest.reduce((s, n) => s + n.outCents, 0)

  let running = 0
  const trend = oldest.map((n) => {
    running += n.netCents
    return { gameId: n.gameId, gameName: n.gameName, playedOn: n.playedOn, netCents: n.netCents, runningCents: running }
  })

  // Longest run of winning nights, oldest to newest. A level night breaks it, as for streaks.
  let longestWin = 0
  let run = 0
  for (const n of oldest) {
    run = n.netCents > 0 ? run + 1 : 0
    if (run > longestWin) longestWin = run
  }

  const winsOnly = newest.filter((n) => n.netCents > 0).map((n) => n.netCents)
  const lossesOnly = newest.filter((n) => n.netCents < 0).map((n) => n.netCents)
  const mean = (xs) => (xs.length ? roundToMajor(xs.reduce((s, x) => s + x, 0) / xs.length, currency) : null)
  const last5 = newest.slice(0, 5)

  // Everyone's rows for these games, to know how many sat at each table.
  const tableSize = new Map()
  for (const n of nights) tableSize.set(n.gameId, (tableSize.get(n.gameId) ?? 0) + 1)

  const standings = standingsFor(scoped.filter((n) => n.currency === currency), season ?? { key: null })
  const rankAt = standings.findIndex((s) => s.playerId === playerId)

  return {
    games,
    wins,
    losses,
    level: games - wins - losses,
    netCents,
    winRate: pct(wins, games),
    avgCents: games ? roundToMajor(netCents / games, currency) : 0,
    rank: rankAt >= 0 ? { position: rankAt + 1, of: standings.length } : null,
    money: { inCents, outCents, roi: inCents ? pct(netCents, inCents) : null },
    bust: games ? { nights: newest.filter((n) => n.outCents === 0).length, pct: pct(newest.filter((n) => n.outCents === 0).length, games) } : null,
    trend,
    form: newest.slice(0, 10).map((n) => (n.netCents > 0 ? 'up' : n.netCents < 0 ? 'down' : 'flat')),
    best: rec.best,
    worst: rec.worst,
    streak: rec.streak,
    longestWin,
    bestWeekday: bestWeekday(newest, currency),
    rebuy: rebuyFigures(newest),
    time: timeFigures(newest, currency),
    shortLong: split(newest, (n) => hoursOf(n), (h) => h < LONG_GAME_HOURS),
    tables: split(newest, (n) => tableSize.get(n.gameId), (size) => size < BIG_TABLE),
    buyInSize: buyInSize(newest),
    months: monthsOf(oldest),
    deepDive: {
      typicalCents: games ? roundToMajor(median(newest.map((n) => n.netCents)), currency) : 0,
      avgWinCents: mean(winsOnly),
      avgLossCents: mean(lossesOnly),
      last5: {
        games: last5.length,
        netCents: last5.reduce((s, n) => s + n.netCents, 0),
        wins: last5.filter((n) => n.netCents > 0).length,
        losses: last5.filter((n) => n.netCents < 0).length,
      },
    },
    recent: newest,
  }
}

/**
 * Splits nights in two by some measure (game length, table size) and gives the up-rate of
 * each half. Null unless both halves have a night: "75% / -" is not a comparison.
 */
function split(nights, measure, isFirst) {
  const measured = nights.map((n) => [n, measure(n)]).filter(([, m]) => m !== null && m !== undefined)
  const a = measured.filter(([, m]) => isFirst(m)).map(([n]) => n)
  const b = measured.filter(([, m]) => !isFirst(m)).map(([n]) => n)
  if (a.length === 0 || b.length === 0) return null
  return { first: upRate(a), second: upRate(b) }
}

/**
 * The weekday with the best average night. Null until they have played on at least two
 * different weekdays - "your best day is Friday" means nothing when every game was a Friday.
 * Ties go to the day with more nights behind it, then to the earlier day of the week.
 */
function bestWeekday(nights, currency) {
  const days = new Map()
  for (const n of nights) {
    const d = weekdayOf(n.playedOn)
    const row = days.get(d) ?? { day: d, nights: 0, netCents: 0 }
    row.nights++
    row.netCents += n.netCents
    days.set(d, row)
  }
  if (days.size < 2) return null
  let best = null
  for (const row of [...days.values()].sort((a, b) => a.day - b.day)) {
    const avg = row.netCents / row.nights
    const bestAvg = best ? best.netCents / best.nights : -Infinity
    if (avg > bestAvg || (avg === bestAvg && row.nights > best.nights)) best = row
  }
  return { label: WEEKDAYS[best.day], nights: best.nights, avgCents: roundToMajor(best.netCents / best.nights, currency) }
}

/**
 * Rebuys: how often they rebuy, and whether it pays. Null when the server predates
 * buyin_count - never a made-up 0%. `after` is null when they never rebought, `without` is
 * null when they always did.
 */
function rebuyFigures(nights) {
  if (nights.length === 0 || nights.some((n) => n.buyinCount === undefined || n.buyinCount === null)) return null
  const rebought = nights.filter((n) => n.buyinCount >= 2)
  const clean = nights.filter((n) => n.buyinCount < 2)
  const extra = nights.reduce((s, n) => s + Math.max(0, n.buyinCount - 1), 0)
  return {
    gamesPct: pct(rebought.length, nights.length),
    perGame: Math.round((extra / nights.length) * 10) / 10,
    nights: rebought.length,
    after: rebought.length ? pct(rebought.filter((n) => n.netCents > 0).length, rebought.length) : null,
    without: clean.length ? pct(clean.filter((n) => n.netCents > 0).length, clean.length) : null,
  }
}

/** Time at the table, from the games with a believable length only. Null with none. */
function timeFigures(nights, currency) {
  const timed = nights.map((n) => [n, hoursOf(n)]).filter(([, h]) => h !== null)
  if (timed.length === 0) return null
  const hours = timed.reduce((s, [, h]) => s + h, 0)
  const net = timed.reduce((s, [n]) => s + n.netCents, 0)
  return {
    games: timed.length,
    hours,
    avgHours: hours / timed.length,
    longestHours: Math.max(...timed.map(([, h]) => h)),
    perHourCents: roundToMajor(net / hours, currency),
  }
}

/**
 * Win rate at their smallest opening buy-in against their biggest. Null unless they have
 * bought in at two different sizes. Older rows without first_buyin_cents are skipped.
 */
function buyInSize(nights) {
  const sized = nights.filter((n) => Number.isFinite(n.firstBuyinCents) && n.firstBuyinCents > 0)
  const sizes = [...new Set(sized.map((n) => n.firstBuyinCents))].sort((a, b) => a - b)
  if (sizes.length < 2) return null
  const at = (c) => ({ cents: c, ...upRate(sized.filter((n) => n.firstBuyinCents === c)) })
  return { small: at(sizes[0]), big: at(sizes.at(-1)) }
}

/** Each calendar month's total, oldest first, with the best and worst picked out. */
function monthsOf(oldest) {
  const rows = []
  for (const n of oldest) {
    const key = n.playedOn.slice(0, 7)
    let row = rows.at(-1)
    if (!row || row.key !== key) {
      row = { key, label: `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`, netCents: 0 }
      rows.push(row)
    }
    row.netCents += n.netCents
  }
  if (rows.length === 0) return null
  // First extreme wins a tie, as everywhere else here.
  let best = rows[0]
  let worst = rows[0]
  for (const r of rows) {
    if (r.netCents > best.netCents) best = r
    if (r.netCents < worst.netCents) worst = r
  }
  return { rows, best, worst }
}

/**
 * The trend regrouped by month or year: one point per period, at the running total as it
 * stood when that period ended. 'session' returns the trend untouched.
 */
export function trendBy(trend, view) {
  if (view === 'session') return trend
  const width = view === 'year' ? 4 : 7
  const out = []
  for (const t of trend) {
    const key = t.playedOn.slice(0, width)
    const last = out.at(-1)
    if (last && last.key === key) {
      last.netCents += t.netCents
      last.runningCents = t.runningCents
      last.games++
    } else {
      const label = view === 'year' ? key : `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`
      out.push({ key, gameName: label, playedOn: t.playedOn, netCents: t.netCents, runningCents: t.runningCents, games: 1 })
    }
  }
  return out
}

/**
 * Two players over the nights they BOTH sat in. "Ahead" means finished with the better
 * result that night; an exact tie counts for neither.
 */
export function headToHead(nights, aId, bId, currency, season = null) {
  const byGame = new Map()
  for (const n of nights) {
    if (n.currency !== currency || !inSeason(n, season)) continue
    if (n.playerId !== aId && n.playerId !== bId) continue
    const g = byGame.get(n.gameId) ?? {}
    g[n.playerId === aId ? 'a' : 'b'] = n.netCents
    byGame.set(n.gameId, g)
  }
  const out = { together: 0, aAhead: 0, bAhead: 0, aNetCents: 0, bNetCents: 0 }
  for (const g of byGame.values()) {
    if (g.a === undefined || g.b === undefined) continue
    out.together++
    out.aNetCents += g.a
    out.bNetCents += g.b
    if (g.a > g.b) out.aAhead++
    else if (g.b > g.a) out.bAhead++
  }
  return out
}

/**
 * Everyone this player has shared a table with in the period, most games together first,
 * plus the one they most often finish behind (nemesis) and most often beat (favourite).
 * Either is null when nobody has the edge on them, or they on nobody.
 */
export function rivalsFor(nights, playerId, currency, season = null) {
  const names = new Map()
  for (const n of nights) if (!names.has(n.playerId)) names.set(n.playerId, { name: n.playerName, isSelf: n.isSelf })
  const rivals = [...names.keys()]
    .filter((id) => id !== playerId)
    .map((id) => ({ playerId: id, ...names.get(id), h: headToHead(nights, playerId, id, currency, season) }))
    .filter((r) => r.h.together > 0)
    .sort((a, b) => b.h.together - a.h.together)
  const edge = (r) => r.h.bAhead - r.h.aAhead
  const pick = (score) => {
    let best = null
    for (const r of rivals) {
      const s = score(r)
      if (s > 0 && (!best || s > score(best) || (s === score(best) && r.h.together > best.h.together))) best = r
    }
    return best
  }
  return { rivals, nemesis: pick(edge), favourite: pick((r) => -edge(r)) }
}

/**
 * The comparison chart on the standings tab: every finished game in the period on one axis,
 * oldest first, and each chosen player's running total across it. A player who sat a game
 * out stays level through it rather than dropping out of the chart.
 */
export function comparisonSeries(nights, playerIds, currency, season = null) {
  const scoped = nights.filter((n) => n.currency === currency && inSeason(n, season))
  const games = []
  const seen = new Set()
  for (const n of [...scoped].sort(chronological)) {
    if (seen.has(n.gameId)) continue
    seen.add(n.gameId)
    games.push({ gameId: n.gameId, gameName: n.gameName, playedOn: n.playedOn })
  }
  const series = playerIds.map((id) => {
    const net = new Map(scoped.filter((n) => n.playerId === id).map((n) => [n.gameId, n.netCents]))
    let total = 0
    const name = scoped.find((n) => n.playerId === id)?.playerName ?? '?'
    return { playerId: id, name, values: games.map((g) => (total += net.get(g.gameId) ?? 0)) }
  })
  return { games, series }
}

// ---------- chart helpers ----------

/**
 * Round-number gridlines covering lo..hi, always including zero: 1, 2, 2.5 or 5 times a
 * power of ten, about `count` of them.
 */
export function niceTicks(lo, hi, count = 5) {
  const low = Math.min(0, lo)
  const high = Math.max(0, hi)
  const raw = (high - low) / Math.max(1, count - 1) || 1
  const exp = 10 ** Math.floor(Math.log10(raw))
  const f = raw / exp
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp
  const ticks = []
  for (let v = Math.floor(low / step) * step; v <= Math.ceil(high / step) * step + step / 2; v += step) {
    ticks.push(Math.round(v))
  }
  return ticks
}

/** "₹6k", "₹1.5k", "₹500", "-₹3k" - an axis label, never a figure anyone settles up on. */
export function compactMoney(cents, currency) {
  const v = Math.abs(cents) / 10 ** minorUnitDigits(currency)
  const sign = cents < 0 ? '-' : ''
  const body = v >= 1000 ? `${trim(v / 1000)}k` : trim(v)
  return `${sign}${currencySymbol(currency)}${body}`
}

const trim = (x) => String(Math.round(x * 10) / 10)

/** "3h 30m" from fractional hours. */
export function hoursLabel(h) {
  const total = Math.round(h * 60)
  const hh = Math.floor(total / 60)
  const mm = total % 60
  return hh === 0 ? `${mm}m` : mm === 0 ? `${hh}h` : `${hh}h ${mm}m`
}

// ---------- sample data ----------

/**
 * What a host with no finished games sees, clearly marked as a sample: eight made-up nights
 * at a five-handed table, every game summing to zero like a real one. Shared with the phone
 * (Insights.kt builds the same rows), so both show the same example.
 */
const SAMPLE_PLAYERS = ['You', 'Sam', 'Priya', 'Leo', 'Nina']
const SAMPLE_GAMES = [
  ['2026-08-07', 'Friday game', 3.5, [1500, -1000, 500, -1000, null]],
  ['2026-08-15', 'Saturday game', 4, [-500, 2000, -1000, -500, null]],
  ['2026-08-21', 'Friday game', 3, [2500, -1500, -1000, null, null]],
  ['2026-08-29', 'Saturday game', 5, [-2000, 500, 1000, 500, null]],
  ['2026-09-05', 'Saturday game', 2.5, [1500, -500, null, -1500, 500]],
  ['2026-09-11', 'Friday game', 3, [1000, 1500, -1000, null, -1500]],
  ['2026-09-25', 'Friday game', 2, [-3000, 1000, 2000, null, null]],
  ['2026-10-02', 'Friday game', 3.5, [2000, -500, -500, -1000, null]],
]

export function sampleNights() {
  const out = []
  SAMPLE_GAMES.forEach(([date, name, hours, nets], g) => {
    const startedAt = `${date}T14:30:00.000Z`
    const finishedAt = new Date(Date.parse(startedAt) + hours * 3_600_000).toISOString()
    nets.forEach((net, p) => {
      if (net === null) return
      // Losers bought in as often as it took to lose that much; some winners rebought too.
      const buyins = net < 0 ? Math.max(1, Math.ceil((-net + 1) / 1000)) : g % 2 === 0 && p % 2 === 0 ? 2 : 1
      const inCents = buyins * 100000
      out.push({
        playerId: `sample-${p}`, playerName: SAMPLE_PLAYERS[p], isSelf: p === 0,
        gameId: `sample-g${g}`, gameName: name, playedOn: date, startedAt, finishedAt,
        currency: 'INR', inCents, outCents: inCents + net * 100, netCents: net * 100,
        buyinCount: buyins, firstBuyinCents: 100000,
      })
    })
  })
  return out.reverse()
}
