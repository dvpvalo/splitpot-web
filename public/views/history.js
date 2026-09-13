// Every night, newest first. Games and past games merged into one list, as on the phone.

import { hostStats } from '../db.js'
import { formatMoney } from '../lib/money.js'
import { shortDate } from '../lib/time.js'
import { clear, el, money, mount, showError } from '../ui.js'

export function historyView() {
  const root = el('main', 'screen')
  root.appendChild(el('h1', 'title', 'History'))
  const body = el('div', 'stack')
  root.appendChild(body)

  const load = async () => {
    clear(body)
    body.appendChild(el('p', 'muted', 'Loading…'))
    try {
      const stats = await hostStats()
      clear(body)

      if (stats.games.length === 0) {
        body.appendChild(el('p', 'muted', 'No games yet.'))
        return
      }

      // Built from `nights`, NOT from stats.players. On the phone HistoryScreen still reads
      // stats.players for the host's own summary, which includes live games - so mid-game
      // History and People disagree about the host's total. Known there, not copied here.
      const summary = summarise(stats.nights)
      if (summary.length) {
        body.appendChild(el('h2', 'section-label', 'Your totals'))
        const tiles = el('div', 'tiles')
        for (const s of summary) tiles.appendChild(totalTile(s))
        body.appendChild(tiles)
      }

      body.appendChild(el('h2', 'section-label', 'Every night'))
      const list = el('div', 'list')
      for (const g of stats.games) list.appendChild(gameRow(g))
      body.appendChild(list)
    } catch (e) {
      clear(body)
      showError(`Could not load history: ${e.message ?? e}`, load)
    }
  }

  load()
  return root
}

/** The host's own finished nights, per currency. Never summed across currencies. */
function summarise(nights) {
  const mine = new Map()
  for (const n of nights) {
    if (!n.isSelf) continue
    const row = mine.get(n.currency) ?? { currency: n.currency, games: 0, netCents: 0 }
    row.games++
    row.netCents += n.netCents
    mine.set(n.currency, row)
  }
  return [...mine.values()]
}

function totalTile(s) {
  const tile = el('div', 'tile')
  mount(tile,
    money(s.netCents, s.currency, true),
    el('p', 'tile-label', `${s.games} ${s.games === 1 ? 'night' : 'nights'}`),
  )
  return tile
}

function gameRow(g) {
  const row = el('a', 'row')
  row.href = `#/game/${g.gameId}`
  const main = el('div', 'row-main')
  mount(main,
    el('h3', 'row-title', g.gameName),
    el('p', 'row-sub', `${shortDate(g.playedOn)} · ${g.players} players · `
      + `pot ${formatMoney(g.potCents, g.currency)}`),
  )
  const right = el('div', 'row-right')
  if (g.status === 'live') {
    right.appendChild(el('span', 'tag tag-live', 'Live'))
  } else {
    right.appendChild(money(g.myNetCents, g.currency, true))
  }
  mount(row, main, right)
  return row
}
