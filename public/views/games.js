// The bare game list. Phase 1 reads and renders, and does nothing else on purpose:
// with no write path in existence, signing in as the wrong Google account can only ever
// show an empty list. That is the whole point of proving the identity here.

import { games } from '../db.js'
import { shortDate } from '../lib/time.js'
import { button, clear, el, mount, showError } from '../ui.js'
import { signOut } from '../auth.js'

const STATUS_LABEL = { live: 'Live', settled: 'Settled', draft: 'Draft' }

export function gamesView() {
  const root = el('main', 'screen')
  const head = el('header', 'screen-head')
  mount(head, el('h1', 'title', 'Games'), button('Sign out', () => signOut(), 'btn-link'))
  root.appendChild(head)

  const list = el('div', 'list')
  root.appendChild(list)

  const load = async () => {
    clear(list)
    list.appendChild(el('p', 'muted', 'Loading…'))
    try {
      const rows = await games()
      clear(list)
      if (rows.length === 0) {
        mount(list,
          el('p', 'muted', 'No games yet.'),
          el('p', 'muted small', 'If you expected to see games here, you may be signed in '
            + 'with a different Google account than the one the app uses.'),
        )
        return
      }
      for (const g of rows) list.appendChild(gameRow(g))
    } catch (e) {
      clear(list)
      showError(`Could not load games: ${e.message ?? e}`, load)
    }
  }

  load()
  return root
}

function gameRow(g) {
  const row = el('article', 'row')
  const main = el('div', 'row-main')
  // el() sets textContent, so a game name is never parsed as markup.
  mount(main, el('h2', 'row-title', g.name), el('p', 'row-sub', shortDate(g.played_on)))
  const tag = el('span', `tag tag-${g.status}`, STATUS_LABEL[g.status] ?? g.status)
  mount(row, main, tag)
  return row
}
