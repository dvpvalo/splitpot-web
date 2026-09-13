// People: the leaderboard, the season chips above it, and the records sheet behind each row.
// Players and leaderboard are one screen here, as on the phone.

import { hostStats } from '../db.js'
import { formatMoney } from '../lib/money.js'
import { recordsFor, seasonsIn, standingsFor, streakLabel } from '../lib/stats.js'
import { shortDate } from '../lib/time.js'
import { button, clear, el, money, mount, sheet, showError } from '../ui.js'

export function peopleView() {
  const root = el('main', 'screen')
  root.appendChild(el('h1', 'title', 'People'))
  const body = el('div', 'stack')
  root.appendChild(body)

  const load = async () => {
    clear(body)
    body.appendChild(el('p', 'muted', 'Loading…'))
    try {
      const stats = await hostStats()
      clear(body)

      // Built from finished nights, NOT the server's `players` table. That table includes
      // live games, so mid-game it showed the whole table deep in the red - everyone has
      // bought in and nobody has cashed out. Same fix as the phone's.
      const nights = stats.nights ?? []
      if (nights.length === 0) {
        body.appendChild(el('p', 'muted', 'No finished games yet.'))
        return
      }

      const seasons = seasonsIn(nights)
      let active = seasons[0]

      const chips = el('div', 'chips')
      const table = el('div', 'list')

      const draw = () => {
        clear(chips)
        for (const s of seasons) {
          const chip = button(s.label, () => { active = s; draw() },
            `chip${s.key === active.key ? ' chip-on' : ''}`)
          chip.setAttribute('aria-pressed', String(s.key === active.key))
          chips.appendChild(chip)
        }
        clear(table)
        for (const row of standingsFor(nights, active)) {
          table.appendChild(leaderRow(row, nights))
        }
      }

      draw()
      mount(body, chips, table)
    } catch (e) {
      clear(body)
      showError(`Could not load people: ${e.message ?? e}`, load)
    }
  }

  load()
  return root
}

function leaderRow(row, nights) {
  const el_ = el('button', 'row row-tappable')
  el_.type = 'button'
  const main = el('div', 'row-main')
  mount(main,
    el('h3', 'row-title', row.playerName + (row.isSelf ? ' (you)' : '')),
    el('p', 'row-sub', `${row.games} ${row.games === 1 ? 'night' : 'nights'} · `
      + `in ${formatMoney(row.inCents, row.currency)} · `
      + `out ${formatMoney(row.outCents, row.currency)}`),
  )
  mount(el_, main, money(row.netCents, row.currency, true))
  el_.addEventListener('click', () => recordsSheet(row, nights))
  return el_
}

function recordsSheet(row, nights) {
  const r = recordsFor(nights, row.playerId, row.currency)
  const content = el('div', 'sheet-body')

  content.appendChild(el('p', 'streak', streakLabel(r.streak)))

  const tiles = el('div', 'tiles')
  if (r.best) tiles.appendChild(extremeTile('Best night', r.best, row.currency))
  if (r.worst) tiles.appendChild(extremeTile('Worst night', r.worst, row.currency))
  content.appendChild(tiles)

  content.appendChild(el('h3', 'section-label', 'Every night'))
  const list = el('div', 'list')
  for (const n of r.nights) {
    const line = el('div', 'row')
    const main = el('div', 'row-main')
    mount(main, el('h4', 'row-title', n.gameName), el('p', 'row-sub', shortDate(n.playedOn)))
    mount(line, main, money(n.netCents, n.currency, true))
    list.appendChild(line)
  }
  content.appendChild(list)

  sheet(row.playerName, content)
}

function extremeTile(label, night, currency) {
  const tile = el('div', 'tile')
  mount(tile,
    money(night.netCents, currency, true),
    el('p', 'tile-label', label),
    el('p', 'tile-sub', shortDate(night.playedOn)),
  )
  return tile
}
