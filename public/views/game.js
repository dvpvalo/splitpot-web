// The live table: seats, the in-play meter, the timeline, the settlement, and the two ways
// money gets logged - the one-tap rebuy on a seat row, and the keypad sheet behind it.
//
// Every write here is awaited against the server before anything redraws. A failure raises a
// banner naming the player and the amount, with Retry; it never fails quietly.

import {
  addEntry, deleteGame, finishGame, gameChanges, gameDetail, players,
  reopenGame, seatPlayer, setSettlementPaid, standingsOf,
} from '../db.js'
import {
  advanced, blindsAtLevel, clockLabel, isPaused, newClock, nextLevel,
  paused as pauseClock, remaining, resumed,
} from '../lib/clock.js'
import { formatMoney, settle } from '../lib/money.js'
import {
  clock as storedClock, clockEnabled, dealer as storedDealer, dealerEnabled, forgetGame,
  levelMinutes, saveClock, setDealer,
} from '../lib/tools.js'
import { durationLabel, longDate, parseInstant, relativeLabel } from '../lib/time.js'
import {
  button, clear, clearBanner, el, money, monogram, mount, sheet, showError, showNotice,
} from '../ui.js'
import { ledgerMessage, ledgerUrl } from '../lib/share.js'
import { playerSheet } from './playersheet.js'

export function gameView(gameId) {
  const root = el('main', 'screen')
  const body = el('div', 'stack')
  root.appendChild(body)

  // Which panel is open lives out here so it survives a repaint. A buy-in arriving from the
  // phone must not throw the host back to Players while they are reading the Timeline.
  const ui = { showing: 'players' }

  // Built ONCE, outside load(), and re-mounted on every repaint. A card rebuilt per render
  // would start a new one-second interval each time a buy-in arrived from the phone, and the
  // old ones would keep ticking against detached nodes.
  const clockCard = clockEnabled() ? blindClock(gameId) : null

  const load = async (quiet = false) => {
    if (!quiet) {
      clear(body)
      body.appendChild(el('p', 'muted', 'Loading…'))
    }
    try {
      const detail = await gameDetail(gameId)
      clear(body)
      // Off means ABSENT, not greyed out: a host who never switched the clock on pays no
      // pixels for it. Same rule as the phone.
      if (clockCard && detail.game.status === 'live') clockCard.update(detail)
      mount(body,
        header(detail),
        meter(detail),
        clockCard && detail.game.status === 'live' ? clockCard : null,
        seatSection(detail, () => load(true), ui),
        settlementSection(detail, () => load(true)),
        actionsSection(detail, () => load(true)),
      )
    } catch (e) {
      // A failed background refresh must never blank a table that is already on screen and
      // being read at an actual table. The visible numbers stay; the next event retries.
      if (quiet) return
      clear(body)
      showError(`Could not load that game: ${e.message ?? e}`, () => load())
    }
  }

  // One buy-in can produce more than one event, and a burst must not become a burst of
  // fetches. Coalesce into a single refresh.
  let timer = null
  const refresh = () => {
    clearTimeout(timer)
    timer = setTimeout(() => load(true), 150)
  }

  const unsubscribe = gameChanges(gameId, refresh)
  // main.js calls this before swapping screens; without it every visit leaks a channel.
  root.destroy = () => {
    clearTimeout(timer)
    clockCard?.stop()
    unsubscribe()
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

/**
 * Seats and timeline. One at a time on a phone, both at once from ~900px up.
 *
 * BOTH panels are always built and CSS decides which are shown - no JS breakpoint, no resize
 * listener, and rotating a tablet needs no re-render. A landscape tablet is the one layout
 * where the timeline genuinely earns its own column; on a phone it would halve two lists that
 * are already narrow.
 */
function seatSection(detail, reload, ui) {
  const wrap = el('div', 'stack-tight seats')
  const tabs = el('div', 'pills')
  const panels = el('div', 'panels')

  const column = (label) => {
    const col = el('div', 'panel')
    col.appendChild(el('h3', 'section-label panel-label', label))
    const list = el('div', 'list')
    col.appendChild(list)
    return [col, list]
  }
  const [playersCol, playersList] = column('Players')
  const [timelineCol, timelineList] = column('Timeline')
  mount(panels, playersCol, timelineCol)

  const draw = () => {
    clear(tabs)
    for (const [key, label] of [['players', 'Players'], ['timeline', 'Timeline']]) {
      const b = button(label, () => { ui.showing = key; draw() }, `chip${ui.showing === key ? ' chip-on' : ''}`)
      b.setAttribute('aria-pressed', String(ui.showing === key))
      tabs.appendChild(b)
    }

    clear(playersList)
    if (detail.seats.length === 0) playersList.appendChild(el('p', 'muted', 'Nobody seated yet.'))
    const showDealer = dealerEnabled() && detail.game.status === 'live' && detail.seats.length > 0
    if (showDealer) playersList.appendChild(dealerRow(detail, draw))
    const holder = showDealer ? storedDealer(detail.game.id) : null
    for (const s of detail.seats) playersList.appendChild(seatRow(s, detail, reload, holder))

    clear(timelineList)
    timeline(detail).forEach((row) => timelineList.appendChild(row))

    playersCol.className = `panel${ui.showing === 'players' ? '' : ' panel-off'}`
    timelineCol.className = `panel${ui.showing === 'timeline' ? '' : ' panel-off'}`
  }

  draw()
  mount(wrap, tabs, panels)
  return wrap
}

function seatRow(seat, detail, reload, dealerSeatId = null) {
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
  if (seat.gamePlayerId === dealerSeatId) {
    row.insertBefore(el('span', 'dealer-badge', 'D'), right)
  }
  return row
}

/**
 * Who deals next. One button that moves round seat order, which is the whole feature - a
 * dealer button is a physical disc being slid one seat to the left, and anything more than
 * that is a screen nobody asked for.
 *
 * Local to this browser, like the clock: it means nothing to the ledger and nothing to the
 * players, and it has to work with no signal. Redraws the seat list in place rather than
 * refetching - passing the button once a hand is not worth a round trip.
 */
function dealerRow(detail, redraw) {
  const gameId = detail.game.id
  const seats = detail.seats
  const current = seats.find((s) => s.gamePlayerId === storedDealer(gameId)) ?? null

  const row = el('div', 'row')
  const main = el('div', 'row-main')
  mount(main,
    el('h3', 'row-title', 'Dealer'),
    el('p', 'row-sub', current ? current.player.name : 'Nobody has the button yet.'),
  )

  const pass = button(current ? 'Pass' : 'Set dealer', () => {
    const at = seats.findIndex((s) => s.gamePlayerId === current?.gamePlayerId)
    // -1 (nobody yet) lands on seat 0, which is what "Set dealer" should do.
    setDealer(gameId, seats[(at + 1) % seats.length].gamePlayerId)
    redraw()
  }, 'btn-rebuy')

  return mount(row, main, pass)
}

/**
 * The blind clock: what level it is, what the blinds are, and how long is left.
 *
 * The countdown is DERIVED from a stored wall-clock time on every tick, never counted down
 * in memory. Close the tab for two levels and it reopens two levels on, which is what
 * happens at a table; a timer that resumed where it stopped would be quietly wrong all night.
 *
 * The node is returned with update() and stop() so the view can keep one of these alive
 * across repaints instead of building a new interval every time a buy-in arrives.
 */
function blindClock(gameId) {
  const wrap = el('section', 'card clock-card')
  let state = storedClock(gameId)
  let game = null

  const head = el('div', 'clock-head')
  const time = el('p', 'clock-time')
  const sub = el('p', 'clock-sub')
  const actions = el('div', 'clock-actions')
  mount(head, el('h3', 'card-title', 'Blind clock'))
  mount(wrap, head, time, sub, actions)

  const levelMillis = () => levelMinutes() * 60_000

  const set = (next) => {
    state = next
    saveClock(gameId, next)
    draw()
  }

  const act = (label, run) => button(label, run, 'btn')

  function draw() {
    const millis = levelMillis()
    const now = Date.now()

    // Roll forward FIRST, so a tab reopened after two levels shows level three rather than
    // counting the old level down from wherever it was.
    if (state && !isPaused(state)) {
      const rolled = advanced(state, millis, now)
      if (rolled !== state) {
        state = rolled
        saveClock(gameId, rolled)
      }
    }

    clear(actions)
    if (!state) {
      time.textContent = clockLabel(millis)
      time.className = 'clock-time muted'
      sub.textContent = `${millis / 60_000}-minute levels. Blinds double each one.`
      actions.appendChild(act('Start the clock', () => set(newClock(Date.now()))))
      return
    }

    const left = remaining(state, millis, now)
    time.textContent = clockLabel(left)
    // The last minute is the one anyone looks up for.
    time.className = `clock-time${left <= 60_000 && !isPaused(state) ? ' clock-time-low' : ''}`

    const blinds = game && blindsAtLevel(game.small_blind_cents, game.big_blind_cents, state.level)
    sub.textContent = `Level ${state.level}`
      + (blinds ? ` · ${formatMoney(blinds[0], game.currency)}/${formatMoney(blinds[1], game.currency)}` : '')
      + (isPaused(state) ? ' · paused' : '')

    mount(actions,
      act(isPaused(state) ? 'Resume' : 'Pause', () => set(
        isPaused(state) ? resumed(state, Date.now()) : pauseClock(state, levelMillis(), Date.now()),
      )),
      act('Next', () => set(nextLevel(state, Date.now()))),
      act('Stop', () => set(null)),
    )
  }

  // One tick a second. It only ever recomputes from the wall clock, so a missed tick - a
  // backgrounded tab, a sleeping laptop - costs nothing but a stale reading until the next.
  const ticking = setInterval(draw, 1000)

  wrap.update = (detail) => { game = detail.game; draw() }
  wrap.stop = () => clearInterval(ticking)
  draw()
  return wrap
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
function settlementSection(detail, reload) {
  const wrap = el('div', 'stack-tight')
  const live = detail.game.status === 'live'
  wrap.appendChild(el('h2', 'section-label',
    live ? 'Current settlement · live preview' : 'Settlement'))

  const rows = live ? previewRows(detail) : storedRows(detail)

  if (rows.length === 0) {
    wrap.appendChild(el('p', 'muted', "Nothing to settle — everyone's square."))
  } else {
    const list = el('div', 'list')
    for (const r of rows) {
      const row = el('div', 'row')
      const main = el('div', 'row-main')
      mount(main, el('h4', 'row-title', `${r.fromName} pays ${r.toName}`))
      if (r.paid) main.appendChild(el('p', 'row-sub', 'Paid'))
      const right = el('div', 'row-right')
      right.appendChild(el('span', `money money-${r.paid ? 'flat' : 'down'}`,
        formatMoney(r.amountCents, detail.game.currency)))
      // Only a stored row can be ticked; a live preview has no row to tick yet.
      if (r.id) right.appendChild(paidToggle(r, reload))
      mount(row, main, right)
      list.appendChild(row)
    }
    wrap.appendChild(list)
  }

  if (live && detail.inPlayCents !== 0) {
    wrap.appendChild(el('p', 'muted small',
      `${formatMoney(detail.inPlayCents, detail.game.currency)} still in play. `
      + 'The preview settles only what has been cashed out.'))
  }

  // Deliberately OUTSIDE the branch above: a reopened game where everyone is square has no
  // preview rows at all, and that is exactly when a forgotten payment would go missing.
  if (live) wrap.appendChild(alreadyPaid(detail))

  return wrap
}

/**
 * Payments recorded against the PREVIOUS settlement of a game that has since been reopened.
 *
 * A live game renders the computed preview, which has no paid state, so without this a
 * payment someone has already handed over simply vanishes from the screen until the game is
 * finished again. The row is still in the database — this says so, and names who, because
 * "has Yash actually paid me yet" is the question being asked at the table.
 */
function alreadyPaid(detail) {
  const wrap = el('div', 'stack-tight')
  const paid = detail.settlements.filter((s) => s.status === 'paid')
  if (paid.length === 0) return wrap

  const nameOf = new Map(detail.seats.map((s) => [s.player.id, s.player.name]))
  wrap.appendChild(el('h3', 'section-label', 'Already paid'))
  wrap.appendChild(el('p', 'muted small',
    'Recorded against this game\u2019s previous settlement and still on record. '
    + 'Finishing again is what replaces them.'))

  const list = el('div', 'list')
  for (const s of [...paid].sort((a, b) => b.amount_cents - a.amount_cents)) {
    const row = el('div', 'row row-quiet')
    const main = el('div', 'row-main')
    mount(main, el('h4', 'row-title',
      `${nameOf.get(s.from_player_id) ?? 'Removed player'} paid `
      + `${nameOf.get(s.to_player_id) ?? 'Removed player'}`))
    mount(row, main, el('span', 'money money-flat',
      formatMoney(s.amount_cents, detail.game.currency)))
    list.appendChild(row)
  }
  wrap.appendChild(list)
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
      id: s.id,
      fromName: nameOf.get(s.from_player_id) ?? 'Removed player',
      toName: nameOf.get(s.to_player_id) ?? 'Removed player',
      amountCents: s.amount_cents,
      paid: s.status === 'paid',
    }))
}


function paidToggle(row, reload) {
  const btn = button(row.paid ? 'Paid' : 'Mark paid', async () => {
    btn.disabled = true
    clearBanner()
    try {
      await setSettlementPaid(row.id, !row.paid)
      await reload()
    } catch (e) {
      btn.disabled = false
      showError(`Could not change that payment: ${e.message ?? e}`)
    }
  }, `btn-rebuy${row.paid ? ' btn-on' : ''}`)
  btn.setAttribute('aria-pressed', String(row.paid))
  return btn
}

/** Finishing, reopening, sharing, deleting, and seating someone new. */
function actionsSection(detail, reload) {
  const { game } = detail
  const wrap = el('div', 'stack-tight actions')
  const paidCount = detail.settlements.filter((s) => s.status === 'paid').length

  if (game.status === 'live') {
    wrap.appendChild(button('Add a player', () => seatSheet(detail, reload), 'btn'))

    const finish = button('Finish & settle', async () => {
      // Finishing REPLACES the stored settlement, so a second finish destroys paid ticks.
      // Never do that without saying how many.
      const warning = paidCount > 0
        ? `\n\nThis replaces the stored settlement and CLEARS ${paidCount} paid `
          + `${paidCount === 1 ? 'tick' : 'ticks'}.`
        : ''
      const stillOut = detail.inPlayCents !== 0
        ? `${formatMoney(detail.inPlayCents, game.currency)} is still in play `
          + '- not everyone has cashed out.\n\nFinish anyway?'
        : `Finish "${game.name}" and settle up?`
      if (!confirm(stillOut + warning)) return

      finish.disabled = true
      finish.textContent = 'Settling...'
      clearBanner()
      try {
        await finishGame(game.id)
        await reload()
      } catch (e) {
        finish.disabled = false
        finish.textContent = 'Finish & settle'
        showError(`The game was NOT settled: ${e.message ?? e}`)
      }
    }, 'btn btn-primary')
    wrap.appendChild(finish)
  } else {
    const reopen = button('Reopen this game', async () => {
      const note = paidCount > 0
        ? `\n\nThe ${paidCount} paid ${paidCount === 1 ? 'tick survives' : 'ticks survive'} `
          + 'reopening. Finishing a second time is what replaces them.'
        : ''
      if (!confirm(`Put "${game.name}" back into play?` + note)) return
      reopen.disabled = true
      clearBanner()
      try {
        await reopenGame(game.id)
        await reload()
      } catch (e) {
        reopen.disabled = false
        showError(`Could not reopen that game: ${e.message ?? e}`)
      }
    }, 'btn-link')
    wrap.appendChild(reopen)
  }

  if (game.ledger_slug) {
    wrap.appendChild(button('Share ledger', () => shareLedger(game), 'btn'))
  }

  const del = button('Delete this game', async () => {
    if (!confirm(`Delete "${game.name}"?\n\nEvery buy-in, cash-out and settlement for it is `
      + 'removed permanently. This cannot be undone.')) return
    del.disabled = true
    clearBanner()
    try {
      await deleteGame(game.id)
      // The clock and the button live in THIS browser, so nothing else will ever prune them.
      // The phone had the same leak and it was fixed there in passing.
      forgetGame(game.id)
      location.hash = '#/history'
    } catch (e) {
      del.disabled = false
      showError(`Could not delete that game: ${e.message ?? e}`)
    }
  }, 'btn-link btn-danger')
  wrap.appendChild(del)

  return wrap
}

/**
 * Hands off to the OS share sheet where there is one, the clipboard where there is not.
 * This never sends anything: the host picks the app and presses send themselves.
 */
async function shareLedger(game) {
  const text = ledgerMessage({ name: game.name, ledgerSlug: game.ledger_slug })
  try {
    if (navigator.share) {
      await navigator.share({ text, url: ledgerUrl({ ledgerSlug: game.ledger_slug }) })
      return
    }
    await navigator.clipboard.writeText(text)
    showNotice('Link copied to the clipboard.')
  } catch (e) {
    // AbortError just means the host closed the share sheet. That is not a failure.
    if (e && e.name === 'AbortError') return
    showError(`Could not share that link: ${e.message ?? e}`)
  }
}

/** Seat someone from the roster. Anyone already at the table is not offered again. */
async function seatSheet(detail, reload) {
  const body = el('div', 'sheet-body')
  const dlg = sheet('Add a player', body)
  body.appendChild(el('p', 'muted', 'Loading...'))
  try {
    const roster = await players()
    const seated = new Set(detail.seats.map((s) => s.player.id))
    const free = roster.filter((p) => !seated.has(p.id))
    clear(body)
    if (free.length === 0) {
      body.appendChild(el('p', 'muted', 'Everyone in your list is already at this table.'))
      return
    }
    const list = el('div', 'list')
    for (const p of free) {
      const btn = button(p.name, async () => {
        btn.disabled = true
        clearBanner()
        try {
          await seatPlayer(detail.game.id, p.id, detail.seats.length)
          dlg.close()
          await reload()
        } catch (e) {
          btn.disabled = false
          showError(`${p.name} was NOT seated: ${e.message ?? e}`)
        }
      }, 'btn')
      list.appendChild(btn)
    }
    body.appendChild(list)
  } catch (e) {
    clear(body)
    body.appendChild(el('p', 'muted', `Could not load your players: ${e.message ?? e}`))
  }
}
