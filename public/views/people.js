// People: the leaderboard, the season chips above it, the records sheet behind each row, and
// the contact book underneath. Players and leaderboard are one screen here, as on the phone.

import { addPlayer, deletePlayer, hostStats, playerGameCount, players, updatePlayer } from '../db.js'
import { formatMoney } from '../lib/money.js'
import { recordsFor, seasonsIn, standingsFor, streakLabel } from '../lib/stats.js'
import { shortDate } from '../lib/time.js'
import { button, clear, clearBanner, el, money, monogram, mount, sheet, showError } from '../ui.js'

/**
 * The faces on offer. Deliberately a short fixed list rather than the emoji keyboard: a
 * picker you scroll once beats one you have to search while people wait to be dealt in.
 */
const AVATARS = [
  '🃏', '♠️', '♥️', '♣️', '♦️',
  '😎', '🤠', '🤖', '👻', '👹',
  '🦁', '🐨', '🦊', '🐳', '🦅',
  '🍕', '🍺', '💰', '🔥', '🎯',
]

const PAYMENT_TYPES = [
  ['none', 'None'],
  ['bank', 'Bank transfer'],
  ['paypal', 'PayPal'],
  ['revolut', 'Revolut'],
  ['venmo', 'Venmo'],
  ['cashapp', 'Cash App'],
  ['other', 'Other'],
]

const typeLabel = (wire) => PAYMENT_TYPES.find(([w]) => w === wire)?.[1] ?? 'None'

export function peopleView() {
  const root = el('main', 'screen')
  root.appendChild(el('h1', 'title', 'People'))
  const body = el('div', 'stack')
  root.appendChild(body)

  const load = async () => {
    clear(body)
    body.appendChild(el('p', 'muted', 'Loading…'))
    try {
      // One pass for both halves of the screen: the leaderboard needs the stats, the contact
      // book needs the roster, and the leaderboard's faces come from the roster too.
      const [stats, roster] = await Promise.all([hostStats(), players()])
      clear(body)
      mount(body, leaderboard(stats, roster), contactBook(roster, load))
    } catch (e) {
      clear(body)
      showError(`Could not load people: ${e.message ?? e}`, load)
    }
  }

  load()
  return root
}

function leaderboard(stats, roster) {
  const wrap = el('div', 'stack')

  // Built from finished nights, NOT the server's `players` table. That table includes live
  // games, so mid-game it showed the whole table deep in the red - everyone has bought in
  // and nobody has cashed out. Same fix as the phone's.
  const nights = stats.nights ?? []
  if (nights.length === 0) {
    wrap.appendChild(el('p', 'muted', 'No finished games yet.'))
    return wrap
  }

  const byId = new Map(roster.map((p) => [p.id, p]))
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
      table.appendChild(leaderRow(row, nights, byId.get(row.playerId)))
    }
  }

  draw()
  return mount(wrap, chips, table)
}

function leaderRow(row, nights, player) {
  const el_ = el('button', 'row row-tappable')
  el_.type = 'button'
  const main = el('div', 'row-main')
  mount(main,
    el('h3', 'row-title', row.playerName + (row.isSelf ? ' (you)' : '')),
    el('p', 'row-sub', `${row.games} ${row.games === 1 ? 'night' : 'nights'} · `
      + `in ${formatMoney(row.inCents, row.currency)} · `
      + `out ${formatMoney(row.outCents, row.currency)}`),
  )
  mount(el_,
    monogram(player ?? { name: row.playerName }),
    main,
    money(row.netCents, row.currency, true),
  )
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

// ---------- the contact book ----------

/** Everyone the host can seat, whether or not they have ever played. */
function contactBook(roster, reload) {
  const wrap = el('div', 'stack')
  wrap.appendChild(el('h2', 'section-label', 'Your players'))

  if (roster.length === 0) {
    wrap.appendChild(el('p', 'muted', 'Nobody yet. Add the people you play with.'))
  } else {
    const list = el('div', 'list')
    for (const p of roster) {
      const row = el('button', 'row row-tappable')
      row.type = 'button'
      const main = el('div', 'row-main')
      mount(main, el('h3', 'row-title', p.name + (p.is_self ? ' (you)' : '')))
      if (p.payment_type && p.payment_type !== 'none' && p.payment_details) {
        main.appendChild(el('p', 'row-sub', `${typeLabel(p.payment_type)} · ${p.payment_details}`))
      }
      mount(row, monogram(p), main)
      row.addEventListener('click', () => playerEditSheet(p, reload))
      list.appendChild(row)
    }
    wrap.appendChild(list)
  }

  wrap.appendChild(button('Add a player', () => playerEditSheet(null, reload), 'btn'))
  return wrap
}

function playerEditSheet(existing, reload) {
  const body = el('div', 'sheet-body')

  const nameInput = el('input')
  nameInput.className = 'field'
  nameInput.maxLength = 60
  nameInput.placeholder = 'Full name'
  nameInput.value = existing?.name ?? ''

  let avatar = existing?.avatar ?? null

  const faceWrap = el('div', 'avatar-row')
  const choices = el('div', 'chips')
  const drawFace = () => {
    clear(faceWrap)
    faceWrap.appendChild(monogram({ name: nameInput.value || '?', avatar }, 'monogram monogram-lg'))
    faceWrap.appendChild(choices)
  }
  for (const option of AVATARS) {
    const chip = button(option, () => {
      // Tapping the one already chosen clears it, so there is no separate "none" button.
      avatar = avatar === option ? null : option
      drawChoices()
      drawFace()
    }, 'chip chip-face')
    chip.setAttribute('aria-label', `Use ${option}`)
    choices.appendChild(chip)
  }
  const drawChoices = () => {
    for (const chip of choices.children) {
      const on = chip.textContent === avatar
      chip.className = `chip chip-face${on ? ' chip-on' : ''}`
      chip.setAttribute('aria-pressed', String(on))
    }
  }
  drawChoices()
  drawFace()
  nameInput.addEventListener('input', drawFace)

  const typeSelect = el('select')
  typeSelect.className = 'field'
  for (const [wire, label] of PAYMENT_TYPES) {
    const opt = el('option', null, label)
    opt.value = wire
    typeSelect.appendChild(opt)
  }
  typeSelect.value = existing?.payment_type ?? 'none'

  const detailsInput = el('input')
  detailsInput.className = 'field'
  detailsInput.maxLength = 120
  detailsInput.placeholder = 'Sort code and account, @handle, UPI id…'
  detailsInput.value = existing?.payment_details ?? ''

  const detailsWrap = field('Details', detailsInput)
  const syncDetails = () => { detailsWrap.hidden = typeSelect.value === 'none' }
  typeSelect.addEventListener('change', syncDetails)
  syncDetails()

  const save = button(existing ? 'Save changes' : 'Add player', () => submit(), 'btn btn-primary')

  const submit = async () => {
    const name = nameInput.value.trim()
    if (!name) return
    save.disabled = true
    save.textContent = 'Saving…'
    clearBanner()
    const fields = {
      name,
      paymentType: typeSelect.value,
      // "None" means no details, whatever is still sitting in the box.
      paymentDetails: typeSelect.value === 'none' ? null : detailsInput.value,
      avatar,
    }
    try {
      if (existing) await updatePlayer(existing.id, fields)
      else await addPlayer(fields)
      dlg.close()
      await reload()
    } catch (e) {
      save.disabled = false
      save.textContent = existing ? 'Save changes' : 'Add player'
      showError(`${name} was NOT saved: ${e.message ?? e}`)
    }
  }

  mount(body,
    field('Full name', nameInput),
    el('h3', 'section-label', 'Picture (optional)'),
    el('p', 'muted small', 'Makes them easier to spot at a busy table. Initials if you skip it.'),
    faceWrap,
    el('h3', 'section-label', 'Payment details (optional)'),
    el('p', 'muted small', 'Only shown on the ledger if this player is owed money.'),
    field('Type', typeSelect),
    detailsWrap,
    save,
  )
  if (existing) body.appendChild(removePlayer(existing, reload, () => dlg.close()))

  const dlg = sheet(existing ? `Edit ${existing.name}` : 'Add a player', body)
  return dlg
}

/**
 * Deleting from the contact book, guarded by the game count.
 *
 * The delete CASCADES in the database - it has to, so account deletion works - so removing
 * someone who has played would erase them from every past game and quietly change results
 * the host has already shown people. Checked at the tap rather than at every sheet open:
 * one round trip on the rare action beats one on the common one.
 */
function removePlayer(player, reload, close) {
  const wrap = el('div', 'stack-tight actions')
  const note = el('p', 'muted small')

  const btn = button('Delete player', async () => {
    btn.disabled = true
    note.textContent = 'Checking…'
    clearBanner()
    try {
      const games = await playerGameCount(player.id)
      if (games > 0) {
        note.textContent = `${player.name} has played ${games} `
          + `${games === 1 ? 'game' : 'games'}. Deleting them would remove them from those `
          + 'games too, so it is blocked.'
        return
      }
      note.textContent = ''
      if (!confirm(`Delete ${player.name}?\n\n`
        + "They'll be removed from your list. This can't be undone.")) return
      await deletePlayer(player.id)
      close()
      await reload()
    } catch (e) {
      note.textContent = ''
      showError(`${player.name} was NOT deleted: ${e.message ?? e}`)
    } finally {
      btn.disabled = false
    }
  }, 'btn-link btn-danger')

  return mount(wrap, btn, note)
}

function field(label, input) {
  const wrap = el('label', 'field-wrap')
  mount(wrap, el('span', 'field-label', label), input)
  return wrap
}
