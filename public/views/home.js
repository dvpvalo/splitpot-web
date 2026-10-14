// Home IS the table: the live game if there is one, otherwise last night plus who owes.
// There is no separate overview screen, on the web for the same reason there isn't one on
// the phone - it was a list of links to the two things you actually wanted.

import {
  cancelInvite, createInvite, hostStats, openInvite, pendingSettlements, players, startInvite,
} from '../db.js'
import { longDate } from '../lib/time.js'
import { formatMoney } from '../lib/money.js'
import { inviteMessage, inviteTime } from '../lib/share.js'
import { wrappedDue, wrappedFor } from '../lib/wrapped.js'
import {
  button, clear, clearBanner, el, money, mount, screenTitle, sheet, showError, showNotice,
} from '../ui.js'
import { wrappedEntry } from './wrapped.js'

export function homeView() {
  const root = el('main', 'screen')
  root.appendChild(screenTitle('Splitpot', greeting(new Date().getHours())))
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
      // Same for the next game: an invite that will not load leaves Home as it was.
      const invite = await openInvite().catch(() => null)

      const live = stats.games.find((g) => g.status === 'live')
      const lastNight = stats.games.find((g) => g.status !== 'live')

      clear(body)
      body.appendChild(live ? liveCard(live) : noGameCard())
      if (!live) {
        const start = el('a', 'btn btn-primary btn-link-solid', 'New game')
        start.href = '#/new'
        body.appendChild(start)
        body.appendChild(invite ? inviteCard(invite, load) : planLink(load))
        mount(body, wrappedReady(stats.nights))
      }
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

/** The title on Home: said the way you would say it, by the clock on the host's phone. */
export function greeting(hour) {
  if (hour < 5) return 'Late one tonight'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

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
  if (pendingCount === 0) {
    return mount(el('div', 'card'),
      el('h3', 'card-title', "Everyone's square"),
      el('p', 'muted', 'Nothing outstanding across your games.'))
  }
  // Every debt from every game on one screen, combined into as few payments as it takes.
  const card = el('a', 'card')
  card.href = '#/settle'
  return mount(card,
    el('h3', 'card-title', `${pendingCount} still to pay`),
    el('p', 'muted', 'Settle up everything at once, in as few payments as it takes.'),
    el('span', 'btn btn-link-solid', 'Settle up'))
}

// ---------- last month's Wrapped ----------

const seenKey = (key) => `splitpot_wrapped_seen_${key}`

/** Last month's Wrapped, until it has been played once on this device. */
function wrappedReady(nights) {
  const due = wrappedDue(nights, isoToday())
  if (!due) return null
  try {
    if (localStorage.getItem(seenKey(due.season.key)) === '1') return null
  } catch { /* storage blocked: offer it; playing it just will not be remembered */ }
  const cards = wrappedFor(nights, due.currency, due.season)
  if (!cards) return null
  const entry = wrappedEntry(cards, `${due.season.label} Wrapped is ready`, due.season.label, () => {
    try { localStorage.setItem(seenKey(due.season.key), '1') } catch { /* see above */ }
    entry.remove()
  })
  return entry
}

function isoToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- the next game ----------

/** No invite out: a quiet way to start one. */
function planLink(reload) {
  return button('Plan the next game', () => planSheet(reload), 'btn-link home-plan')
}

/** The invite that is out: when, where, who is coming, and the three things to do with it. */
function inviteCard(invite, reload) {
  const replies = invite.invite_replies ?? []
  const count = (a) => replies.filter((r) => r.answer === a).length
  const card = el('div', 'card stack-tight')
  mount(card,
    el('span', 'tag', 'Next game'),
    el('h2', 'card-title', invite.title),
    el('p', 'muted', [inviteTime(new Date(invite.starts_at)), invite.location].filter(Boolean).join(' · ')),
    el('p', 'home-rsvp', replies.length === 0
      ? 'No replies yet'
      : `${count('in')} in · ${count('maybe')} maybe · ${count('out')} out`),
  )
  const start = button('Start this game', async () => {
    const going = count('in')
    const seat = going ? ` and seat the ${going} ${going === 1 ? 'player' : 'players'} who said In` : ''
    if (!confirm(`Start "${invite.title}" now${seat}?`)) return
    start.disabled = true
    clearBanner()
    try {
      const game = await startInvite(invite)
      location.hash = `#/game/${game.id}`
    } catch (e) {
      start.disabled = false
      showError(`The game was NOT fully set up: ${e.message ?? e}`, reload)
    }
  }, 'btn btn-primary')
  mount(card,
    start,
    mount(el('div', 'home-pair'),
      button('Share invite', () => shareInvite(invite), 'btn'),
      button('See replies', () => repliesSheet(invite, reload), 'btn')),
  )
  return card
}

async function shareInvite(invite) {
  const text = inviteMessage({
    title: invite.title, startsAt: new Date(invite.starts_at), location: invite.location, slug: invite.slug,
  })
  try {
    if (navigator.share) {
      await navigator.share({ text })
      return
    }
    await navigator.clipboard.writeText(text)
    showNotice('Invite copied. Paste it in the group.')
  } catch (e) {
    if (e?.name === 'AbortError') return
    showError(`Could not share the invite: ${e.message ?? e}`)
  }
}

/** "Poker night", a day, a time, a place. Creating it opens the share sheet straight away. */
function planSheet(reload) {
  const body = el('div', 'sheet-body')
  const title = el('input', 'field')
  title.maxLength = 60
  title.value = 'Poker night'
  const day = el('input', 'field')
  day.type = 'date'
  day.value = isoToday()
  const time = el('input', 'field')
  time.type = 'time'
  time.value = '21:00'
  const place = el('input', 'field')
  place.maxLength = 80
  place.placeholder = 'Whose place?'

  const create = button('Create and share', async () => {
    const name = title.value.trim()
    const startsAt = new Date(`${day.value}T${time.value || '21:00'}`)
    if (!name || Number.isNaN(startsAt.getTime())) {
      showError('Give the game a name and a day.')
      return
    }
    create.disabled = true
    clearBanner()
    try {
      const invite = await createInvite({ title: name, startsAt, location: place.value })
      dlg.close()
      await shareInvite(invite)
      await reload()
    } catch (e) {
      create.disabled = false
      showError(`The invite was NOT created: ${e.message ?? e}`)
    }
  }, 'btn btn-primary')

  mount(body,
    el('p', 'muted', 'One link for the group. Everyone taps their name and says In, Maybe or Out.'),
    field('Name', title),
    mount(el('div', 'home-pair'), field('Day', day), field('Time', time)),
    field('Place (optional)', place),
    create,
  )
  const dlg = sheet('Plan the next game', body)
}

/** Who said what, and the way to call it off. */
async function repliesSheet(invite, reload) {
  const body = el('div', 'sheet-body')
  const dlg = sheet(invite.title, body)
  body.appendChild(el('p', 'muted', 'Loading…'))
  let roster
  try {
    roster = await players()
  } catch (e) {
    dlg.close()
    showError(`Could not load your players: ${e.message ?? e}`)
    return
  }
  clear(body)
  const answerOf = new Map((invite.invite_replies ?? []).map((r) => [r.player_id, r.answer]))
  for (const [answer, label] of [['in', 'In'], ['maybe', 'Maybe'], ['out', 'Out'], [undefined, 'No reply yet']]) {
    // Retired players are not invited, so they are not "no reply yet" either.
    const names = roster.filter((p) => answerOf.get(p.id) === answer && (answer || !p.retired)).map((p) => p.name)
    if (names.length === 0) continue
    mount(body, el('h3', 'section-label', `${label} · ${names.length}`), el('p', null, names.join(', ')))
  }
  body.appendChild(button('Cancel this invite', async () => {
    if (!confirm(`Cancel "${invite.title}"? The link will stop working.`)) return
    clearBanner()
    try {
      await cancelInvite(invite.id)
      dlg.close()
      await reload()
    } catch (e) {
      showError(`The invite was NOT cancelled: ${e.message ?? e}`)
    }
  }, 'btn-link home-cancel'))
}

function field(label, input) {
  return mount(el('label', 'field-wrap'), el('span', 'field-label', label), input)
}
