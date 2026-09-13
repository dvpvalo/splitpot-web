// The live table: seats, the in-play meter, the timeline, the settlement, and the two ways
// money gets logged - the one-tap rebuy on a seat row, and the keypad sheet behind it.
//
// Every write here is awaited against the server before anything redraws. A failure raises a
// banner naming the player and the amount, with Retry; it never fails quietly.

import { addEntry, gameDetail, standingsOf } from '../db.js'
import { formatMoney, settle } from '../lib/money.js'
import { durationLabel, longDate, parseInstant, relativeLabel } from '../lib/time.js'
import { button, clear, clearBanner, el, money, mount, showError } from '../ui.js'
import { playerSheet } from './playersheet.js'

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
        seatSection(detail, load),
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

function seatSection(detail, reload) {
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
      for (const s of detail.seats) panel.appendChild(seatRow(s, detail, reload))
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

function seatRow(seat, detail, reload) {
  const { game } = detail
  const row = el('button', 'row row-tappable')
  row.type = 'button'
  const main = el('div', 'row-main')
  const nameLine = el('h3', 'row-title', seat.player.name + (seat.player.is_self ? ' (You)' : ''))
  let sub = `Buy-in ${formatMoney(seat.buyInCents, game.currency)}`
  if (seat.hasCashedOut) sub += ` · Cash-out ${formatMoney(seat.cashOutCents, game.currency)}`
  mount(main, nameLine, el('p', 'row-sub', sub))

  const right = el('div', 'row-right')
  right.appendChild(money(seat.netCents, game.currency, true))

  // Only once they have bought in and not yet cashed out: a "rebuy" needs a previous amount
  // to repeat, and reopening a cashed-out player is a decision that deserves the full sheet.
  const repeat = seat.lastBuyInCents
  if (game.status === 'live' && repeat && !seat.hasCashedOut) {
    const again = button(`+ ${formatMoney(repeat, game.currency)}`,
      (ev) => { ev.stopPropagation(); rebuy(again, seat, detail, repeat, reload) }, 'btn-rebuy')
    right.appendChild(again)
  }

  row.addEventListener('click', () => playerSheet(seat, detail, reload))
  mount(row, monogram(seat.player), main, right)
  return row
}

/** One tap, one buy-in. Still awaited against the server before anything redraws. */
async function rebuy(btn, seat, detail, amountCents, reload) {
  const label = btn.textContent
  btn.disabled = true
  btn.textContent = '…'
  clearBanner()
  try {
    await addEntry({
      gameId: detail.game.id,
      gamePlayerId: seat.gamePlayerId,
      kind: 'buyin',
      amountCents,
    })
    await reload()
  } catch (e) {
    btn.disabled = false
    btn.textContent = label
    showError(
      `Rebuy of ${formatMoney(amountCents, detail.game.currency)} for ${seat.player.name} `
      + `was NOT saved: ${e.message ?? e}`,
      () => rebuy(btn, seat, detail, amountCents, reload),
    )
  }
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

/**
 * A LIVE game previews with settle(); a finished one renders the STORED rows.
 *
 * Not the same thing, and the difference is the whole reason finishing a game writes
 * settlements down: those are the numbers the players were shown and agreed on. Recomputing
 * them on every render would let them drift the moment anyone reopens the game and corrects
 * an entry — and it would silently lose the paid ticks, which live only on the stored rows.
 */
function settlementSection(detail) {
  const wrap = el('div', 'stack-tight')
  const live = detail.game.status === 'live'
  wrap.appendChild(el('h2', 'section-label',
    live ? 'Current settlement · live preview' : 'Settlement'))

  const rows = live ? previewRows(detail) : storedRows(detail)

  if (rows.length === 0) {
    wrap.appendChild(el('p', 'muted', "Nothing to settle — everyone's square."))
    return wrap
  }

  const list = el('div', 'list')
  for (const r of rows) {
    const row = el('div', 'row')
    const main = el('div', 'row-main')
    mount(main, el('h4', 'row-title', `${r.fromName} pays ${r.toName}`))
    if (r.paid) main.appendChild(el('p', 'row-sub', 'Paid'))
    const amount = el('span', `money money-${r.paid ? 'flat' : 'down'}`,
      formatMoney(r.amountCents, detail.game.currency))
    mount(row, main, amount)
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

/** The live preview runs the SAME settle() that finishing the game will commit. */
const previewRows = (detail) => settle(standingsOf(detail))
  .map((t) => ({ ...t, paid: false }))

function storedRows(detail) {
  const nameOf = new Map(detail.seats.map((s) => [s.player.id, s.player.name]))
  return [...detail.settlements]
    .sort((a, b) => b.amount_cents - a.amount_cents)
    .map((s) => ({
      fromName: nameOf.get(s.from_player_id) ?? 'Removed player',
      toName: nameOf.get(s.to_player_id) ?? 'Removed player',
      amountCents: s.amount_cents,
      paid: s.status === 'paid',
    }))
}
