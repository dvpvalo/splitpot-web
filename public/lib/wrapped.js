// Splitpot Wrapped: a period of the group's games told as a short run of story cards, made
// to be posted in the group chat. Pure: every word on every card is decided here, so the web
// (views/wrapped.js) and the phone (share/WrappedCard.kt) only draw it, and the Kotlin port
// (data/Wrapped.kt) is checked against the same cases in logic.test.js / WrappedTest.kt.
//
// A card: {key, title, big, tone, name, lines[], rows[]}. tone colours `big`: up / down /
// gold. rows is the podium: {rank, name, value, tone}.

import { formatMoney } from './money.js'
import { attendanceFor, groupTotals, hallOfFame } from './insights.js'
import { standingsFor } from './stats.js'
import { shortDate } from './time.js'

const ORDINALS = ['1st', '2nd', '3rd']
export const ordinal = (n) => ORDINALS[n - 1] ?? `${n}th`
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`
const toneOf = (cents) => (cents > 0 ? 'up' : cents < 0 ? 'down' : 'gold')

/**
 * The cards for one currency and one period (`season` as seasonsIn makes them: a 'YYYY-MM'
 * key, or null for all time). Null when the period has no finished game. A card whose record
 * nobody holds (no winner, no rebuy) is left out rather than drawn empty.
 */
export function wrappedFor(nights, currency, season) {
  const totals = groupTotals(nights, currency, season)
  if (!totals) return null
  const fame = hallOfFame(nights, currency, season)
  const money = (c, signed = false) => formatMoney(c, currency, signed)
  const scoped = nights.filter((n) => n.currency === currency
    && (season?.key == null || n.playedOn.startsWith(season.key)))
  const board = standingsFor(scoped, { key: null })
  const cards = []

  cards.push({
    key: 'cover', title: season?.key == null ? 'The story so far' : `${season.label}, wrapped`,
    big: String(totals.games), tone: 'gold', name: totals.games === 1 ? 'game played' : 'games played',
    lines: [plural(totals.players, 'player'), `${money(totals.totalCents)} across the table`,
      `${money(totals.changedHandsCents)} changed hands`],
    rows: [],
  })

  const potGame = totals.pots.find((p) => p.gameName === fame.pot.gameName && p.playedOn === fame.pot.playedOn)
  cards.push({
    key: 'pot', title: 'The biggest night', big: money(fame.pot.cents), tone: 'gold', name: fame.pot.gameName,
    lines: [shortDate(fame.pot.playedOn), plural(potGame?.players ?? 0, 'player')], rows: [],
  })

  if (fame.win) {
    cards.push({
      key: 'win', title: 'Biggest single win', big: money(fame.win.cents, true), tone: 'up', name: fame.win.playerName,
      lines: [`${fame.win.gameName} · ${shortDate(fame.win.playedOn)}`], rows: [],
    })
  }
  if (fame.loss) {
    cards.push({
      key: 'loss', title: 'Toughest night', big: money(fame.loss.cents, true), tone: 'down', name: fame.loss.playerName,
      lines: [`${fame.loss.gameName} · ${shortDate(fame.loss.playedOn)}`], rows: [],
    })
  }

  // Most rebuys over the whole period, not in one night: the habit, not the accident.
  const rebuys = new Map()
  for (const n of scoped) {
    if (!Number.isFinite(n.buyinCount) || n.buyinCount < 2) continue
    const r = rebuys.get(n.playerId) ?? { name: n.playerName, count: 0, games: 0 }
    r.count += n.buyinCount - 1
    r.games++
    rebuys.set(n.playerId, r)
  }
  const king = [...rebuys.values()].sort((a, b) => b.count - a.count || a.games - b.games
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))[0]
  if (king) {
    cards.push({
      key: 'rebuy', title: 'Most likely to rebuy', big: String(king.count), tone: 'gold', name: king.name,
      lines: [`${king.count === 1 ? 'rebuy' : 'rebuys'} across ${plural(king.games, 'game')}`], rows: [],
    })
  }

  // The host is at every game by definition, so the regular is the best of everyone else.
  const att = attendanceFor(nights, currency, season)
  const regular = att.rows.find((r) => !r.isSelf)
  if (att.games >= 2 && regular) {
    cards.push({
      key: 'regular', title: regular.games === att.games ? 'Never missed a game' : 'The regular',
      big: `${regular.games}/${att.games}`, tone: 'gold', name: regular.playerName,
      lines: [regular.streak >= 2 ? `${regular.streak} in a row and counting` : `${regular.pct}% of games`], rows: [],
    })
  }

  cards.push({
    key: 'podium', title: 'Top of the table', big: '', tone: 'gold', name: '', lines: [],
    rows: board.slice(0, 3).map((p, i) => ({ rank: i + 1, name: p.playerName, value: money(p.netCents, true), tone: toneOf(p.netCents) })),
  })

  const champ = board[0]
  const meAt = board.findIndex((p) => p.isSelf)
  const me = board[meAt]
  cards.push({
    key: 'end', title: season?.key == null ? 'The all-time winner' : `The winner of ${season.label}`, big: money(champ.netCents, true), tone: toneOf(champ.netCents),
    name: champ.playerName,
    lines: [
      ...(me === champ ? ["That's you. Take a bow."] : []),
      ...(me && me !== champ ? [`You finished ${ordinal(meAt + 1)} of ${board.length}, ${money(me.netCents, true)}`] : []),
      'See you at the table.',
    ],
    rows: [],
  })
  return cards
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Whether Home should offer last month's Wrapped: the calendar month before `today`
 * ('YYYY-MM-DD'), if it had a finished game, in the currency most of its games were played
 * in. {season, currency} or null. Whether it was already played is the caller's to remember.
 */
export function wrappedDue(nights, today) {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1]
  const key = `${py}-${String(pm).padStart(2, '0')}`
  const currencyOf = new Map()
  for (const n of nights) if (n.playedOn.startsWith(key)) currencyOf.set(n.gameId, n.currency)
  if (currencyOf.size === 0) return null
  const count = new Map()
  for (const c of currencyOf.values()) count.set(c, (count.get(c) ?? 0) + 1)
  // Most games wins; a tie goes to the currency seen first.
  const currency = [...count].reduce((best, x) => (x[1] > best[1] ? x : best))[0]
  return { season: { label: `${MONTH_LABELS[pm - 1]} ${py}`, key }, currency }
}
