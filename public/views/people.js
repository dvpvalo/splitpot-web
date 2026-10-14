// People: the leaderboard, the season chips above it, the records sheet behind each row, and
// the contact book underneath. Players and leaderboard are one screen here, as on the phone.

import {
  addPlayer, deletePlayer, hostStats, mergePlayers, playerGameCount, players, setPlayerCard, setPlayerRetired,
  updatePlayer,
} from '../db.js'
import { UPI_ENABLED, formatMoney, isUpiId } from '../lib/money.js'
import { recordsFor, seasonsIn, standingsFor, streakLabel } from '../lib/stats.js'
import { shortDate } from '../lib/time.js'
import { button, clear, clearBanner, el, money, monogram, mount, screenTitle, sheet, showError, showNotice } from '../ui.js'
import { playerCardMessage, playerCardUrl } from '../lib/share.js'

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
  ['upi', 'UPI'],
  ['bank', 'Bank transfer'],
  ['paypal', 'PayPal'],
  ['revolut', 'Revolut'],
  ['venmo', 'Venmo'],
  ['cashapp', 'Cash App'],
  ['other', 'Other'],
]

const typeLabel = (wire) => PAYMENT_TYPES.find(([w]) => w === wire)?.[1] ?? 'None'
// Offered in the form only while UPI is switched on; a saved UPI player still reads right.
const OFFERED = PAYMENT_TYPES.filter(([w]) => w !== 'upi' || UPI_ENABLED)

export function peopleView() {
  const root = el('main', 'screen screen-wide')
  root.appendChild(screenTitle('Your table', 'People'))
  // Two lists that answer different questions - how everyone is doing, and who is in the
  // book. They sit side by side once there is room and stack when there is not.
  const body = el('div', 'stack split')
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
    const rowFor = (p) => {
      const row = el('button', 'row row-tappable')
      row.type = 'button'
      const main = el('div', 'row-main')
      mount(main, el('h3', 'row-title', p.name + (p.is_self ? ' (you)' : '')))
      if (p.payment_type && p.payment_type !== 'none' && p.payment_details) {
        main.appendChild(el('p', 'row-sub', `${typeLabel(p.payment_type)} · ${p.payment_details}`))
      }
      mount(row, monogram(p), main)
      row.addEventListener('click', () => playerEditSheet(p, reload))
      return row
    }
    const active = roster.filter((p) => !p.retired)
    const retired = roster.filter((p) => p.retired)
    wrap.appendChild(mount(el('div', 'list'), ...active.map(rowFor)))
    // Retired players stay in the book, out of the way, so they can be brought back.
    if (retired.length > 0) {
      mount(wrap, el('h2', 'section-label', 'Retired'),
        el('p', 'muted small', 'Not offered in Add players or invites. Their games stay.'),
        mount(el('div', 'list'), ...retired.map(rowFor)))
    }
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
  const kept = PAYMENT_TYPES.filter(([w]) => w === existing?.payment_type && !OFFERED.some(([o]) => o === w))
  for (const [wire, label] of [...OFFERED, ...kept]) {
    const opt = el('option', null, label)
    opt.value = wire
    typeSelect.appendChild(opt)
  }
  typeSelect.value = existing?.payment_type ?? 'none'

  const detailsInput = el('input')
  detailsInput.className = 'field'
  detailsInput.maxLength = 120
  detailsInput.value = existing?.payment_details ?? ''

  const detailsWrap = field('Details', detailsInput)
  const syncDetails = () => {
    detailsWrap.hidden = typeSelect.value === 'none'
    const upi = typeSelect.value === 'upi'
    // A UPI id gets a "Pay" button on every settle-up that pays this player.
    detailsInput.placeholder = upi ? 'UPI id, like name@okhdfcbank' : 'Sort code and account, @handle…'
    detailsInput.autocapitalize = upi ? 'off' : 'sentences'
    detailsInput.inputMode = upi ? 'email' : 'text'
  }
  typeSelect.addEventListener('change', syncDetails)
  syncDetails()

  const save = button(existing ? 'Save changes' : 'Add player', () => submit(), 'btn btn-primary')

  const submit = async () => {
    const name = nameInput.value.trim()
    if (!name) return
    if (typeSelect.value === 'upi' && !isUpiId(detailsInput.value)) {
      showError('That UPI id does not look right. It is name@bank, like yash@okhdfcbank.')
      detailsInput.focus()
      return
    }
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
    el('p', 'muted small', UPI_ENABLED
      ? 'Only shown on the ledger if this player is owed money. With a UPI id, whoever owes them gets a Pay button.'
      : 'Only shown on the ledger if this player is owed money.'),
    field('Type', typeSelect),
    detailsWrap,
    save,
  )
  if (existing) body.appendChild(cardSection(existing, reload))
  if (existing) body.appendChild(removePlayer(existing, reload, () => dlg.close()))
  if (existing && !existing.is_self) {
    body.appendChild(button('Same person as…', () => mergeSheet(existing, reload, () => dlg.close()), 'btn-link'))
  }

  const dlg = sheet(existing ? `Edit ${existing.name}` : 'Add a player', body)
  return dlg
}

/**
 * The player's public card: their record, badges and rivals at one link. OFF until switched
 * on, per player. ON asks first and says plainly what becomes visible; OFF never asks, since
 * that is the safe direction. Same rule as Share your standings in Settings.
 */
function cardSection(player, reload) {
  const wrap = el('div', 'stack-tight')
  let slug = player.card_slug ?? null
  const state = el('p', 'muted small')
  const links = el('div', 'stack-tight')
  const toggle = button('', () => flip(), 'btn')

  const draw = () => {
    toggle.textContent = slug ? 'Turn off player card' : 'Turn on player card'
    toggle.className = `btn${slug ? ' btn-on' : ''}`
    state.textContent = slug
      ? 'On. Turning it off makes the link dead immediately.'
      : 'Off. Nothing is shared until you turn this on.'
    clear(links)
    if (slug) mount(links, button('Share link', () => shareCard(player.name, slug), 'btn-link'), el('p', 'muted small', playerCardUrl(slug)))
  }

  const flip = async () => {
    const want = !slug
    if (want && !confirm(
      `Publish ${player.name}'s player card?\n\n`
      + `Anyone with the link sees every finished game ${player.name} has played: their results, `
      + 'badges, and the names of the people they played with and how they did against them. '
      + 'You can switch it off at any time.',
    )) return
    toggle.disabled = true
    clearBanner()
    try {
      slug = await setPlayerCard(player.id, want)
      player.card_slug = slug
      draw()
      reload()
    } catch (e) {
      showError(`That switch did NOT change: ${e.message ?? e}`)
    } finally {
      toggle.disabled = false
    }
  }

  draw()
  return mount(wrap,
    el('h3', 'section-label', 'Player card'),
    el('p', 'muted small', 'One link with their record, badges and rivals, to send them. No app, no account.'),
    state, toggle, links,
  )
}

/** Hands off to the OS share sheet where there is one, the clipboard where there is not. */
async function shareCard(name, slug) {
  const text = playerCardMessage(name, slug)
  try {
    if (navigator.share) {
      await navigator.share({ text, url: playerCardUrl(slug) })
      return
    }
    await navigator.clipboard.writeText(text)
    showNotice('Link copied to the clipboard.')
  } catch (e) {
    if (e && e.name === 'AbortError') return
    showError(`Could not share that link: ${e.message ?? e}`)
  }
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
          + (player.retired ? '' : ' Retire them instead to stop offering them.')
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

  // Retire: off the pickers, nothing else changes. Easy both ways, so no confirm.
  const retire = button(player.retired ? 'Bring back' : 'Retire', async () => {
    retire.disabled = true
    clearBanner()
    try {
      await setPlayerRetired(player.id, !player.retired)
      close()
      await reload()
    } catch (e) {
      retire.disabled = false
      showError(`${player.name} was NOT ${player.retired ? 'brought back' : 'retired'}: ${e.message ?? e}`)
    }
  }, 'btn')
  if (player.is_self) return mount(wrap, btn, note)
  return mount(wrap, retire, el('p', 'muted small', player.retired
    ? 'Retired: not offered in Add players or invites.'
    : 'Stopped coming? Retire them: off Add players and invites, every game they played stays.'), btn, note)
}

/**
 * Merge a duplicate ("Soham A.") into the real one ("Soham"): pick who they really are, confirm,
 * and every game of the duplicate becomes theirs. Can't be undone, so it always asks.
 */
async function mergeSheet(drop, reload, closeEditor) {
  const body = el('div', 'sheet-body')
  const dlg = sheet(`${drop.name} is really…`, body)
  body.appendChild(el('p', 'muted', 'Loading…'))
  let roster
  try {
    roster = (await players()).filter((p) => p.id !== drop.id)
  } catch (e) {
    dlg.close()
    showError(`Could not load your players: ${e.message ?? e}`)
    return
  }
  clear(body)
  body.appendChild(el('p', 'muted small',
    `Pick who ${drop.name} really is. Every game, buy-in and payment of ${drop.name} moves to them.`))
  const list = el('div', 'list')
  for (const keep of roster) {
    const row = el('button', 'row row-tappable')
    row.type = 'button'
    const main = el('div', 'row-main')
    main.appendChild(el('h3', 'row-title', keep.name + (keep.is_self ? ' (you)' : '')))
    mount(row, monogram(keep), main)
    row.addEventListener('click', async () => {
      if (!confirm(`Merge ${drop.name} into ${keep.name}?

`
        + `Every game, buy-in and payment of ${drop.name} becomes ${keep.name}'s, and `
        + `${drop.name} leaves your list. This can't be undone.`)) return
      row.disabled = true
      clearBanner()
      try {
        await mergePlayers(keep.id, drop.id)
        dlg.close()
        closeEditor()
        await reload()
      } catch (e) {
        row.disabled = false
        showError(`${drop.name} was NOT merged: ${e.message ?? e}`)
      }
    })
    list.appendChild(row)
  }
  body.appendChild(list)
}

function field(label, input) {
  const wrap = el('label', 'field-wrap')
  mount(wrap, el('span', 'field-label', label), input)
  return wrap
}
