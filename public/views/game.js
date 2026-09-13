// The live table. Read-only in this pass: seats, the in-play meter, the timeline, and the
// settlement preview. Nothing here writes - the keypad sheet and addEntry land next.

import { gameDetail, standingsOf } from '../db.js'
import { formatMoney, settle } from '../lib/money.js'
import { durationLabel, longDate, parseInstant, relativeLabel } from '../lib/time.js'
import { button, clear, el, money, mount, showError } from '../ui.js'

export function gameView(gameId) {
  const root = el('main', 'screen')
  const body = el('div', 'stack')
  root.appendChild(body)

  const load = async () => {
    clear(body)
    body.appendChild(el('p', 'muted', 'Loading…'))
    try {
      const detail = await gameDetail(gameId)
      clear(body)
      mount(body,
        header(detail),
        meter(detail),
        seatSection(detail),
        settlementSection(detail),
      )
    } catch (e) {
      clear(body)
      showError(`Could not load that game: ${e.message ?? e}`, load)
    }
  }

  load()
  return root
}

function header({ game }) {
  const head = el('header', 'screen-head')
  const left = el('div')
  mount(left,
    el('h1', 'title', game.name),
    el('p', 'row-sub', longDate(game.played_on) + (game.location ? ` · ${game.location}` : '')),
  )
  mount(head, left, el('span', `tag tag-${game.status}`, game.status === 'live' ? 'Live' : 'Settled'))
  return head
}

/**
 * How much of the money on the table has been cashed out. The one in-play meter replaced two
 * rows of stat tiles: at a table the only question is whether the night is squared up yet.
 */
function meter(detail) {
  const { game, buyInCents, cashOutCents, seats } = detail
  const wrap = el('div', 'stack-tight')

  const fraction = buyInCents > 0 ? Math.min(Math.max(cashOutCents / buyInCents, 0), 1) : 0
  const track = el('div', 'meter')
  const fill = el('div', `meter-fill${fraction >= 1 ? ' meter-done' : ''}`)
  fill.style.width = `${fraction * 100}%`
  track.appendChild(fill)
  track.setAttribute('role', 'progressbar')
  track.setAttribute('aria-valuenow', String(Math.round(fraction * 100)))
  track.setAttribute('aria-valuemin', '0')
  track.setAttribute('aria-valuemax', '100')
  track.setAttribute('aria-label', 'Cashed out so far')

  const seatWord = seats.length === 1 ? 'seat' : 'seats'
  const duration = durationLabel(
    parseInstant(game.started_at), parseInstant(game.finished_at), new Date(),
  )
  mount(wrap, track, el('p', 'row-sub',
    `in ${formatMoney(buyInCents, game.currency)}`
    + ` · out ${formatMoney(cashOutCents, game.currency)}`
    + ` · ${seats.length} ${seatWord} · ${duration}`))
  return wrap
}

function seatSection(detail) {
  const wrap = el('div', 'stack-tight')
  const tabs = el('div', 'pills')
  const panel = el('div', 'list')

  let showing = 'players'
  const draw = () => {
    clear(tabs)
    for (const [key, label] of [['players', 'Players'], ['timeline', 'Timeline']]) {
      const b = button(label, () => { showing = key; draw() }, `chip${showing === key ? ' chip-on' : ''}`)
      b.setAttribute('aria-pressed', String(showing === key))
      tabs.appendChild(b)
    }
    clear(panel)
    if (showing === 'players') {
      if (detail.seats.length === 0) panel.appendChild(el('p', 'muted', 'Nobody seated yet.'))
      for (const s of detail.seats) panel.appendChild(seatRow(s, detail.game))
    } else {
      timeline(detail).forEach((row) => panel.appendChild(row))
    }
  }

  draw()
  mount(wrap, tabs, panel)
  return wrap
}

function monogram(player) {
  // An emoji avatar if they picked one, otherwise initials - same rule as the phone.
  const initials = player.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('')
  return el('span', 'monogram', player.avatar || initials.toUpperCase())
}

function seatRow(seat, game) {
  const row = el('div', 'row')
  const main = el('div', 'row-main')
  const nameLine = el('h3', 'row-title', seat.player.name + (seat.player.is_self ? ' (You)' : ''))
  let sub = `Buy-in ${formatMoney(seat.buyInCents, game.currency)}`
  if (seat.hasCashedOut) sub += ` · Cash-out ${formatMoney(seat.cashOutCents, game.currency)}`
  mount(main, nameLine, el('p', 'row-sub', sub))
  mount(row, monogram(seat.player), main, money(seat.netCents, game.currency, true))
  return row
}

function timeline(detail) {
  const nameOf = new Map(detail.seats.map((s) => [s.gamePlayerId, s.player.name]))
  const now = new Date()
  // Newest first: the thing just entered is the thing being checked.
  return [...detail.entries].reverse().map((e) => {
    const row = el('div', 'row')
    const main = el('div', 'row-main')
    mount(main,
      el('h4', 'row-title', nameOf.get(e.game_player_id) ?? 'Removed player'),
      el('p', 'row-sub', (e.kind === 'buyin' ? 'Buy-in' : 'Cash-out')
        + ` · ${relativeLabel(parseInstant(e.created_at), now)}`),
    )
    // A buy-in is money onto the table and a cash-out is money off it, so the sign here is
    // the opposite of the entry's own direction.
    mount(row, main, money(e.kind === 'buyin' ? -e.amount_cents : e.amount_cents, detail.game.currency, true))
    return row
  })
}

/** The live preview runs the SAME settle() that finishing the game will commit. */
function settlementSection(detail) {
  const wrap = el('div', 'stack-tight')
  const live = detail.game.status === 'live'
  wrap.appendChild(el('h2', 'section-label',
    live ? 'Current settlement · live preview' : 'Settlement'))

  const transfers = settle(standingsOf(detail))
  if (transfers.length === 0) {
    wrap.appendChild(el('p', 'muted', "Nothing to settle - everyone's square."))
    return wrap
  }

  const list = el('div', 'list')
  for (const t of transfers) {
    const row = el('div', 'row')
    const main = el('div', 'row-main')
    mount(main, el('h4', 'row-title', `${t.fromName} pays ${t.toName}`))
    mount(row, main, el('span', 'money money-flat', formatMoney(t.amountCents, detail.game.currency)))
    list.appendChild(row)
  }
  wrap.appendChild(list)

  if (live && detail.inPlayCents !== 0) {
    wrap.appendChild(el('p', 'muted small',
      `${formatMoney(detail.inPlayCents, detail.game.currency)} still in play. `
      + 'The preview settles only what has been cashed out.'))
  }
  return wrap
}
