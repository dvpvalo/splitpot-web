// Port of data/PlayerRecords.kt. Spec: PlayerRecordsTest.kt and SeasonsTest.kt.
//
// A PlayerNight here is the same shape host_stats returns, camelCased:
// { playerId, playerName, isSelf, gameId, gameName, playedOn, startedAt, currency,
//   inCents, outCents, netCents }

/**
 * Kotlin's maxByOrNull/minByOrNull return the FIRST extreme. A reduce with >= or <= would
 * keep the LAST one instead, and a best-night tie would silently flip to the older game.
 * Strict comparison only.
 */
function pick(list, better) {
  if (list.length === 0) return null
  let chosen = list[0]
  for (const n of list) if (better(n.netCents, chosen.netCents)) chosen = n
  return chosen
}

/**
 * What a player's nights add up to: best, worst, and whether they are on a run.
 *
 * Currency is not optional. A "best night" comparing one currency against another is the
 * same bug the leaderboard already avoids by keeping a row per currency.
 *
 * A level night - exactly zero - ends a streak rather than extending it. Someone who broke
 * even did not win, and calling it a win would overstate a run to the person reading it.
 */
export function recordsFor(nights, playerId, currency) {
  // The server orders these, but a record that silently depends on someone else's ORDER BY
  // is a record that breaks quietly. Sort here too; the list is small.
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  const ordered = nights
    .filter((n) => n.playerId === playerId && n.currency === currency)
    .sort((a, b) => cmp(b.playedOn, a.playedOn) || cmp(b.startedAt ?? '', a.startedAt ?? ''))

  const latest = ordered[0]?.netCents ?? 0
  let streak = 0
  if (latest !== 0) {
    const up = latest > 0
    let run = 0
    for (const n of ordered) {
      if (n.netCents === 0 || n.netCents > 0 !== up) break
      run++
    }
    streak = up ? run : -run
  }

  return {
    best: pick(ordered, (a, b) => a > b),
    worst: pick(ordered, (a, b) => a < b),
    streak,
    nights: ordered,
    hasAny: ordered.length > 0,
  }
}

/** "3 wins in a row" - the phrase shown under the player's name. */
export function streakLabel(streak) {
  if (streak >= 2) return `${streak} wins in a row`
  if (streak === 1) return 'Won their last one'
  if (streak === -1) return 'Lost their last one'
  if (streak <= -2) return `${-streak} losses in a row`
  return 'No run going'
}

// ---------- seasons ----------

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * "All time" first, then every month with a finished game in it, newest first.
 *
 * Read out of the games actually played, so there is never a chip leading to an empty table
 * and never a date picker.
 */
export function seasonsIn(nights) {
  const months = [...new Set(nights.map((n) => n.playedOn.slice(0, 7)))]
    .filter((m) => m.length === 7)
    .sort()
    .reverse()
  return [
    { label: 'All time', key: null },
    ...months.map((key) => {
      const month = Number(key.slice(5))
      const label = month >= 1 && month <= 12
        ? `${MONTH_NAMES[month - 1]} ${key.slice(0, 4)}`
        : key
      return { label, key }
    }),
  ]
}

/**
 * The leaderboard for one season, rebuilt in the browser from the nights already fetched.
 *
 * Same shape and ordering as the server's all-time table, so the row that draws it does not
 * care which season it is showing. Grouped by player AND currency: a total that added one
 * currency to another would be a fiction.
 */
export function standingsFor(nights, season) {
  const groups = new Map()
  for (const n of nights) {
    if (season.key !== null && !n.playedOn.startsWith(season.key)) continue
    const key = `${n.playerId} ${n.currency}`
    const row = groups.get(key)
    if (row) {
      row.games++
      row.inCents += n.inCents
      row.outCents += n.outCents
      row.netCents += n.netCents
    } else {
      groups.set(key, {
        playerId: n.playerId,
        playerName: n.playerName,
        isSelf: n.isSelf,
        currency: n.currency,
        games: 1,
        inCents: n.inCents,
        outCents: n.outCents,
        netCents: n.netCents,
      })
    }
  }
  return [...groups.values()].sort((a, b) => b.netCents - a.netCents)
}
