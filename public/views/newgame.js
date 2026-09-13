// Create a game. Two taps if a preset exists, a short form if not.
//
// Presets are local (localStorage here, a JSON file on the phone) and deliberately so: a
// preset is six fields, and local means it works when a game is actually being created.

import { createGame, profile } from '../db.js'
import { formatAmount, formatMoney, parseMoney } from '../lib/money.js'
import { MAX, load as loadPresets, remove, save as savePresets, upsert } from '../lib/presets.js'
import { button, clear, clearBanner, el, mount, showError } from '../ui.js'

const CURRENCIES = ['GBP', 'INR', 'USD', 'EUR', 'AUD', 'CAD', 'JPY', 'ZAR']

export function newGameView() {
  const root = el('main', 'screen')
  mount(root, el('h1', 'title', 'Create a game'))

  const chips = el('div', 'chips')
  const form = el('form', 'stack')
  mount(root, chips, form)

  const field = (label, input) => {
    const wrap = el('label', 'field-wrap')
    mount(wrap, el('span', 'field-label', label), input)
    return wrap
  }

  const nameInput = el('input')
  nameInput.className = 'field'
  nameInput.placeholder = 'Friday Night Cash Game'
  nameInput.required = true

  const dateInput = el('input')
  dateInput.className = 'field'
  // A native date picker beats anything hand-rolled, and it is already localised.
  dateInput.type = 'date'
  dateInput.value = new Date().toISOString().slice(0, 10)

  const currencySelect = el('select')
  currencySelect.className = 'field'
  for (const c of CURRENCIES) {
    const opt = el('option', null, c)
    opt.value = c
    currencySelect.appendChild(opt)
  }

  const smallInput = el('input')
  smallInput.className = 'field'
  smallInput.inputMode = 'decimal'
  smallInput.placeholder = '5'

  const bigInput = el('input')
  bigInput.className = 'field'
  bigInput.inputMode = 'decimal'
  bigInput.placeholder = '5'

  const locationInput = el('input')
  locationInput.className = 'field'
  locationInput.placeholder = "John's place"

  const blinds = el('div', 'two-up')
  mount(blinds, field('Small blind', smallInput), field('Big blind', bigInput))

  const submit = el('button', 'btn btn-primary', 'Create game')
  submit.type = 'submit'

  mount(form,
    field('Game name', nameInput),
    field('Date', dateInput),
    field('Currency', currencySelect),
    blinds,
    field('Location (optional)', locationInput),
    submit,
  )

  // The host's defaults, so the common case is already filled in.
  profile().then((p) => {
    if (!p) return
    currencySelect.value = p.default_currency ?? 'GBP'
    const cur = currencySelect.value
    if (p.default_small_blind_cents != null && !smallInput.value) {
      smallInput.value = formatAmount(p.default_small_blind_cents, cur)
    }
    if (p.default_big_blind_cents != null && !bigInput.value) {
      bigInput.value = formatAmount(p.default_big_blind_cents, cur)
    }
  }).catch(() => { /* defaults are a convenience; the form works without them */ })

  const applyPreset = (p) => {
    nameInput.value = p.name
    currencySelect.value = p.currency
    smallInput.value = p.smallBlindCents == null ? '' : formatAmount(p.smallBlindCents, p.currency)
    bigInput.value = p.bigBlindCents == null ? '' : formatAmount(p.bigBlindCents, p.currency)
    locationInput.value = p.location ?? ''
  }

  const drawPresets = () => {
    clear(chips)
    const presets = loadPresets()
    if (presets.length === 0) return
    for (const p of presets) {
      const label = p.smallBlindCents != null
        ? `${p.name} · ${formatMoney(p.smallBlindCents, p.currency)}/${formatMoney(p.bigBlindCents ?? p.smallBlindCents, p.currency)}`
        : p.name
      const chip = button(label, () => applyPreset(p), 'chip')
      // Long-press equivalent: a plain right-click/context menu is not discoverable on a
      // phone, so deleting a preset lives behind the same confirm the phone uses.
      chip.addEventListener('contextmenu', (ev) => {
        ev.preventDefault()
        if (confirm(`Delete the format "${p.name}"?\n\nThe format only. Games already created with it are untouched.`)) {
          savePresets(remove(loadPresets(), p.name))
          drawPresets()
        }
      })
      chips.appendChild(chip)
    }
  }
  drawPresets()

  const rememberBox = el('input')
  rememberBox.type = 'checkbox'
  rememberBox.id = 'remember-format'
  const rememberWrap = el('label', 'checkline')
  mount(rememberWrap, rememberBox, el('span', null, 'Save this as a format'))
  form.insertBefore(rememberWrap, submit)

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    clearBanner()

    const currency = currencySelect.value
    const name = nameInput.value.trim()
    if (!name) return

    // Blank is allowed (a game with no stakes recorded); junk is not.
    const small = smallInput.value.trim() === '' ? null : parseMoney(smallInput.value, currency)
    const big = bigInput.value.trim() === '' ? null : parseMoney(bigInput.value, currency)
    if (small === null && smallInput.value.trim() !== '') {
      showError('That small blind is not an amount.')
      return
    }
    if (big === null && bigInput.value.trim() !== '') {
      showError('That big blind is not an amount.')
      return
    }

    submit.disabled = true
    submit.textContent = 'Creating…'
    try {
      const game = await createGame({
        name,
        playedOn: dateInput.value,
        smallBlindCents: small,
        bigBlindCents: big,
        currency,
        location: locationInput.value.trim() || null,
      })
      if (rememberBox.checked) {
        savePresets(upsert(loadPresets(), {
          name,
          gameType: 'cash',
          smallBlindCents: small,
          bigBlindCents: big,
          currency,
          location: locationInput.value.trim() || null,
        }))
      }
      location.hash = `#/game/${game.id}`
    } catch (e) {
      submit.disabled = false
      submit.textContent = 'Create game'
      showError(`The game was NOT created: ${e.message ?? e}`)
    }
  })

  if (loadPresets().length >= MAX) {
    root.appendChild(el('p', 'muted small',
      `Saved formats are capped at ${MAX}. Saving another replaces the oldest.`))
  }

  return root
}
