// The keypad sheet: the thing that gets tapped 70 times a night.
//
// Quick chips first, keypad second. The chips are the whole point - a host at a real table
// taps "Again" rather than typing 200 for the ninth time.

import { addEntry, deleteEntry, unseatPlayer } from '../db.js'
import { formatAmount, formatMoney, minorUnitDigits, parseMoney } from '../lib/money.js'
import { parseInstant, relativeLabel } from '../lib/time.js'
import { button, clear, clearBanner, el, money, mount, sheet, showError } from '../ui.js'

/** Quick-add chips, in the game's own currency. */
const QUICK_AMOUNTS = [20, 50, 100, 200]

export function playerSheet(seat, detail, onSaved) {
  const { game } = detail
  const currency = game.currency
  const digits = minorUnitDigits(currency)
  const scale = 10 ** digits
  const live = game.status === 'live'

  let mode = 'buyin'
  let typed = ''

  const body = el('div', 'sheet-body')
  const amountLine = el('p', 'amount-display')
  const chips = el('div', 'chips')
  const pad = el('div', 'keypad')
  const modes = el('div', 'pills')
  const submit = button('', () => save(), 'btn btn-primary')
  const note = el('p', 'muted small')

  const cents = () => parseMoney(typed, currency)

  const quickChips = () => {
    const repeat = seat.lastBuyInCents
    const defaults = QUICK_AMOUNTS.map((n) => [formatMoney(n * scale, currency), n * scale])
    if (mode === 'cashout') {
      // Cash-outs are usually "everything in front of them", so offer that first.
      const offered = []
      if (seat.buyInCents > 0) offered.push(['Their buy-in', seat.buyInCents])
      if (repeat) offered.push(['Last buy-in', repeat])
      return offered.length ? offered : defaults
    }
    if (!repeat) return defaults
    return [['Again', repeat], ...defaults.slice(0, 3)]
  }

  const draw = () => {
    clear(modes)
    for (const [key, label] of [['buyin', 'Buy-in'], ['cashout', 'Cash-out']]) {
      const b = button(label, () => { mode = key; typed = ''; draw() },
        `chip${mode === key ? ' chip-on' : ''}`)
      b.setAttribute('aria-pressed', String(mode === key))
      b.disabled = !live
      modes.appendChild(b)
    }

    amountLine.textContent = typed === ''
      ? formatMoney(0, currency)
      : formatMoney(cents() ?? 0, currency)

    clear(chips)
    for (const [label, value] of quickChips()) {
      const chip = button(label, () => { typed = formatAmount(value, currency); draw() },
        `chip${cents() === value ? ' chip-on' : ''}`)
      chip.disabled = !live
      chips.appendChild(chip)
    }

    const amount = cents()
    submit.textContent = (mode === 'buyin' ? 'Add buy-in ' : 'Record cash-out ')
      + formatMoney(amount ?? 0, currency)
    submit.disabled = !live || !amount || amount <= 0

    note.textContent = live ? '' : 'This game is finished. Reopen it to make changes.'
  }

  const save = async () => {
    const amount = cents()
    if (!amount || amount <= 0) return
    submit.disabled = true
    submit.textContent = 'Saving…'
    clearBanner()
    try {
      await addEntry({
        gameId: game.id,
        gamePlayerId: seat.gamePlayerId,
        kind: mode,
        amountCents: amount,
      })
      // Only now is it real. Nothing above rendered it as saved.
      typed = ''
      dlg.close()
      await onSaved()
    } catch (e) {
      // The typed amount is deliberately kept so a retry is one tap, not a retype.
      showError(
        `${mode === 'buyin' ? 'Buy-in' : 'Cash-out'} of ${formatMoney(amount, currency)} `
        + `for ${seat.player.name} was NOT saved: ${e.message ?? e}`,
        () => save(),
      )
      draw()
    }
  }

  buildKeypad(pad, digits > 0, (key) => {
    if (key === 'back') typed = typed.slice(0, -1)
    else if (key === '.') { if (!typed.includes('.')) typed = (typed || '0') + '.' }
    else typed += key
    draw()
  })

  mount(body,
    el('p', 'sheet-sub', `Buy-in ${formatMoney(seat.buyInCents, currency)}`
      + (seat.hasCashedOut ? ` · Cash-out ${formatMoney(seat.cashOutCents, currency)}` : '')),
    modes, amountLine, chips, pad, submit, note,
    history(seat, detail, onSaved, () => dlg.close()),
    removeSeat(seat, detail, onSaved, () => dlg.close()),
  )

  draw()
  const dlg = sheet(seat.player.name, body)
  return dlg
}

function buildKeypad(pad, allowDecimal, onKey) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', allowDecimal ? '.' : '', '0', 'back']
  for (const k of keys) {
    if (k === '') { pad.appendChild(el('span')); continue }
    const b = button(k === 'back' ? '⌫' : k, () => onKey(k), 'key')
    if (k === 'back') b.setAttribute('aria-label', 'Delete last digit')
    pad.appendChild(b)
  }
}

function history(seat, detail, onSaved, close) {
  const mine = detail.entries.filter((e) => e.game_player_id === seat.gamePlayerId)
  const wrap = el('div', 'stack-tight')
  if (mine.length === 0) return wrap
  wrap.appendChild(el('h3', 'section-label', 'This game'))
  const now = new Date()
  const live = detail.game.status === 'live'
  const list = el('div', 'list')
  for (const e of [...mine].reverse()) {
    const row = el('div', 'row')
    const main = el('div', 'row-main')
    mount(main,
      el('h4', 'row-title', e.kind === 'buyin' ? 'Buy-in' : 'Cash-out'),
      el('p', 'row-sub', relativeLabel(parseInstant(e.created_at), now)),
    )
    const right = el('div', 'row-right')
    right.appendChild(money(
      e.kind === 'buyin' ? -e.amount_cents : e.amount_cents, detail.game.currency, true,
    ))
    if (live) right.appendChild(removeEntry(e, seat, detail, onSaved, close))
    mount(row, main, right)
    list.appendChild(row)
  }
  wrap.appendChild(list)
  return wrap
}

/**
 * Deleting a mis-tap, with an undo rather than a confirm.
 *
 * A confirm on every correction would be a second tap 70 times a night. Undo is the right
 * shape here because the entry can be recreated exactly - it is an amount and a kind, and
 * nothing else about it is unique. The only thing that changes is created_at, which moves the
 * row to the end of the timeline; that is worth saying rather than hiding.
 */
function removeEntry(entry, seat, detail, onSaved, close) {
  const btn = button('Delete', async () => {
    btn.disabled = true
    clearBanner()
    try {
      await deleteEntry(entry.id)
      close()
      await onSaved()
      const label = formatMoney(entry.amount_cents, detail.game.currency)
      const kind = entry.kind === 'buyin' ? 'Buy-in' : 'Cash-out'
      showUndo(`${kind} of ${label} for ${seat.player.name} deleted.`, async () => {
        await addEntry({
          gameId: detail.game.id,
          gamePlayerId: seat.gamePlayerId,
          kind: entry.kind,
          amountCents: entry.amount_cents,
        })
        await onSaved()
      })
    } catch (e) {
      btn.disabled = false
      showError(`That entry was NOT deleted: ${e.message ?? e}`)
    }
  }, 'btn-rebuy btn-danger')
  btn.setAttribute('aria-label', 'Delete this entry')
  return btn
}

function showUndo(message, undo) {
  const bar = document.getElementById('banner')
  clear(bar)
  bar.className = 'banner banner-notice'
  bar.appendChild(el('span', null, message))
  const btn = button('Undo', async () => {
    btn.disabled = true
    try {
      await undo()
      clearBanner()
    } catch (e) {
      showError(`Could not undo that: ${e.message ?? e}`)
    }
  }, 'btn-inline')
  bar.appendChild(btn)
  bar.hidden = false
}

/**
 * Taking a seat back off the table. Blocked once they have money on it, because unseating
 * would orphan their entries: the seat row goes, the entries stay, and the game's totals
 * stop matching the sum of its players.
 */
function removeSeat(seat, detail, onSaved, close) {
  const wrap = el('div', 'stack-tight')
  if (detail.game.status !== 'live') return wrap
  const hasMoney = seat.buyInCents > 0 || seat.cashOutCents > 0

  const btn = button('Remove from game', async () => {
    if (!confirm(`Take ${seat.player.name} off this table?`)) return
    btn.disabled = true
    clearBanner()
    try {
      await unseatPlayer(seat.gamePlayerId)
      close()
      await onSaved()
    } catch (e) {
      btn.disabled = false
      showError(`${seat.player.name} was NOT removed: ${e.message ?? e}`)
    }
  }, 'btn-link btn-danger')

  if (hasMoney) {
    btn.disabled = true
    wrap.appendChild(el('p', 'muted small',
      'Delete their buy-ins and cash-outs above before taking them off the table.'))
  }
  wrap.appendChild(btn)
  return wrap
}
