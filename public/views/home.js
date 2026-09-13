// Home IS the table: the live game if there is one, otherwise last night plus who owes.
// There is no separate overview screen, on the web for the same reason there isn't one on
// the phone - it was a list of links to the two things you actually wanted.

import { hostStats, pendingSettlements } from '../db.js'
import { longDate } from '../lib/time.js'
import { formatMoney } from '../lib/money.js'
import { clear, el, money, mount, showError } from '../ui.js'

export function homeView() {
  const root = el('main', 'screen')
  root.appendChild(el('h1', 'title', 'Splitpot'))
  const body = el('div', 'stack')
  root.appendChild(body)

  const load = async () => {
    clear(body)
    body.appendChild(el('p', 'muted', 'Loading…'))
    try {
      const stats = await hostStats()
      // A failure to count pending settlements must not take the whole screen down - it is
      // the least important line on it.
      const pending = await pendingSettlements().then((r) => r.length).catch(() => null)

      const live = stats.games.find((g) => g.status === 'live')
      const lastNight = stats.games.find((g) => g.status !== 'live')

      clear(body)
      body.appendChild(live ? liveCard(live) : noGameCard())
      if (lastNight) mount(body, sectionLabel('Last night'), lastNightCard(lastNight))
      if (pending !== null) mount(body, sectionLabel('Who owes what'), owedCard(pending))
    } catch (e) {
      clear(body)
      showError(`Could not load your games: ${e.message ?? e}`, load)
    }
  }

  load()
  return root
}

const sectionLabel = (text) => el('h2', 'section-label', text)

function liveCard(g) {
  const card = el('a', 'card card-live')
  card.href = `#/game/${g.gameId}`
  mount(card,
    el('span', 'tag tag-live', 'Live'),
    el('h2', 'card-title', g.gameName),
    el('p', 'muted', `${g.players} players · pot ${formatMoney(g.potCents, g.currency)}`),
  )
  return card
}

function noGameCard() {
  const card = el('div', 'card')
  mount(card,
    el('h2', 'card-title', 'No game running'),
    el('p', 'muted', 'Deal one in and start logging buy-ins.'),
  )
  return card
}

function lastNightCard(g) {
  const card = el('a', 'card row')
  card.href = `#/game/${g.gameId}`
  const main = el('div', 'row-main')
  mount(main,
    el('h3', 'row-title', g.gameName),
    el('p', 'row-sub', `${longDate(g.playedOn)} · ${g.players} players · `
      + `pot ${formatMoney(g.potCents, g.currency)}`),
  )
  const right = el('div', 'row-right')
  mount(right, money(g.myNetCents, g.currency, true), el('p', 'row-sub', 'your result'))
  mount(card, main, right)
  return card
}

function owedCard(pendingCount) {
  const card = el('div', 'card')
  mount(card,
    el('h3', 'card-title', pendingCount === 0 ? "Everyone's square" : `${pendingCount} still to pay`),
    el('p', 'muted', pendingCount === 0
      ? 'Nothing outstanding across your games.'
      : 'Open the game to mark them paid.'),
  )
  return card
}
