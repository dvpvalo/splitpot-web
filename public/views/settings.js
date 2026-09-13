// Settings: the host profile, the public standings switch, and the account.
//
// The table tools (blind clock, dealer button) and the theme picker arrive in Phase 8.

import { signOut } from '../auth.js'
import { deleteAccount, profile, saveProfile, setPublicHistory } from '../db.js'
import { formatAmount, parseMoney } from '../lib/money.js'
import { historyMessage, historyUrl } from '../lib/share.js'
import { button, clear, clearBanner, el, mount, showError, showNotice } from '../ui.js'

const CURRENCIES = ['GBP', 'INR', 'USD', 'EUR', 'AUD', 'CAD', 'JPY', 'ZAR']

export function settingsView() {
  const root = el('main', 'screen')
  root.appendChild(el('h1', 'title', 'Settings'))
  const body = el('div', 'stack')
  root.appendChild(body)

  const load = async () => {
    clear(body)
    body.appendChild(el('p', 'muted', 'Loading…'))
    try {
      const me = await profile()
      clear(body)
      mount(body, profileCard(me ?? {}), standingsCard(me ?? {}), accountCard())
    } catch (e) {
      clear(body)
      showError(`Could not load your settings: ${e.message ?? e}`, load)
    }
  }

  load()
  return root
}

// ---------- host profile ----------

function profileCard(me) {
  const form = el('form', 'stack')
  form.appendChild(el('h2', 'section-label', 'Host profile'))

  const nameInput = text(me.name ?? '', 'Your name', 60)
  const phoneInput = text(me.phone ?? '', 'Phone number (optional)', 30)
  phoneInput.type = 'tel'

  const currency = el('select')
  currency.className = 'field'
  for (const c of CURRENCIES) {
    const opt = el('option', null, c)
    opt.value = c
    currency.appendChild(opt)
  }
  currency.value = me.default_currency ?? 'GBP'

  const cur = () => currency.value
  const small = text(amount(me.default_small_blind_cents, me.default_currency), '5', 12)
  const big = text(amount(me.default_big_blind_cents, me.default_currency), '5', 12)
  small.inputMode = 'decimal'
  big.inputMode = 'decimal'

  const blinds = el('div', 'two-up')
  mount(blinds, field('Small blind', small), field('Big blind', big))

  const save = el('button', 'btn btn-primary', 'Save profile')
  save.type = 'submit'

  mount(form,
    field('Name', nameInput),
    field('Phone', phoneInput),
    field('Default currency', currency),
    el('p', 'muted small',
      'Pre-selected for new games. Each game keeps its own currency once created.'),
    blinds,
    el('p', 'muted small', 'Your usual stakes. Leave blank if they change every week.'),
    save,
  )

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    clearBanner()

    // Blank is allowed (no usual stakes); junk is not, and must never be saved as null.
    const blind = (input) => (input.value.trim() === '' ? null : parseMoney(input.value, cur()))
    const smallCents = blind(small)
    const bigCents = blind(big)
    if (smallCents === null && small.value.trim() !== '') {
      showError('That small blind is not an amount.')
      return
    }
    if (bigCents === null && big.value.trim() !== '') {
      showError('That big blind is not an amount.')
      return
    }

    save.disabled = true
    save.textContent = 'Saving…'
    try {
      await saveProfile({
        name: nameInput.value,
        phone: phoneInput.value,
        defaultCurrency: cur(),
        smallBlindCents: smallCents,
        bigBlindCents: bigCents,
      })
      showNotice('Profile saved.')
    } catch (e) {
      showError(`Your profile was NOT saved: ${e.message ?? e}`)
    } finally {
      save.disabled = false
      save.textContent = 'Save profile'
    }
  })

  return form
}

// ---------- public standings ----------

/**
 * The one switch on this screen that publishes other people's results.
 *
 * Switching ON asks first and spells out exactly what becomes visible; switching OFF never
 * asks, because that is the safe direction. The slug has been on the row since the profile
 * was created - flipping the flag is the whole switch.
 */
function standingsCard(me) {
  const wrap = el('div', 'stack')
  let on = me.public_db_enabled === true
  const slug = me.public_db_slug

  const state = el('p', 'muted small')
  const links = el('div', 'stack-tight')
  const toggle = button('', () => flip(), 'btn')

  const draw = () => {
    toggle.textContent = on ? 'Turn off public standings' : 'Turn on public standings'
    toggle.className = `btn${on ? ' btn-on' : ''}`
    state.textContent = on
      ? 'On. Turning it off makes the link dead immediately.'
      : 'Off. Nothing is shared until you turn this on.'
    clear(links)
    if (!on || !slug) return
    mount(links,
      button('Share link', () => shareStandings(slug), 'btn-link'),
      el('p', 'muted small', historyUrl(slug)),
    )
  }

  const flip = async () => {
    const want = !on
    if (want && !confirm(
      'Publish your standings?\n\n'
      + "Everyone who has the link sees every player's name and how much they are up or "
      + 'down. No amounts of yours are hidden from it, and you cannot pick who sees what. '
      + 'You can switch it off at any time.',
    )) return
    toggle.disabled = true
    clearBanner()
    try {
      await setPublicHistory(want)
      on = want
      draw()
    } catch (e) {
      showError(`That switch did NOT change: ${e.message ?? e}`)
    } finally {
      toggle.disabled = false
    }
  }

  draw()
  return mount(wrap,
    el('h2', 'section-label', 'Share your standings'),
    el('p', 'muted small',
      'One link showing every finished game and how everyone is doing. '
      + 'Anyone with the link can open it — no app, no account.'),
    state, toggle, links,
  )
}

/** Hands off to the OS share sheet where there is one, the clipboard where there is not. */
async function shareStandings(slug) {
  const text_ = historyMessage(slug)
  try {
    if (navigator.share) {
      await navigator.share({ text: text_, url: historyUrl(slug) })
      return
    }
    await navigator.clipboard.writeText(text_)
    showNotice('Link copied to the clipboard.')
  } catch (e) {
    if (e && e.name === 'AbortError') return
    showError(`Could not share that link: ${e.message ?? e}`)
  }
}

// ---------- account ----------

function accountCard() {
  const wrap = el('div', 'stack actions')

  const out = button('Sign out', async () => {
    if (!confirm("Sign out?\n\nYou'll need to sign in again to get back in.")) return
    out.disabled = true
    try {
      await signOut()
    } catch (e) {
      out.disabled = false
      showError(`Could not sign out: ${e.message ?? e}`)
    }
  }, 'btn')

  const del = button('Delete my account', async () => {
    if (!confirm(
      'Delete your account?\n\n'
      + 'This erases every game, every buy-in and cash-out, your whole player list and your '
      + 'login. Anyone holding a ledger or standings link will find nothing there. It cannot '
      + 'be undone, and there is no copy kept.',
    )) return
    del.disabled = true
    del.textContent = 'Deleting…'
    clearBanner()
    try {
      await deleteAccount()
    } catch (e) {
      // Nothing fails quietly here either: a host who thinks their data is gone when it is
      // still there has been told something untrue.
      del.disabled = false
      del.textContent = 'Delete my account'
      showError(`The account was NOT deleted and nothing was removed: ${e.message ?? e}`)
    }
  }, 'btn-link btn-danger')

  return mount(wrap,
    el('h2', 'section-label', 'Account'),
    out,
    el('p', 'muted small',
      'Deleting your account removes every game, player and result. It cannot be undone.'),
    del,
  )
}

// ---------- small helpers ----------

const amount = (cents, currency) => (cents == null ? '' : formatAmount(cents, currency ?? 'GBP'))

function text(value, placeholder, max) {
  const input = el('input')
  input.className = 'field'
  input.value = value
  input.placeholder = placeholder
  input.maxLength = max
  return input
}

function field(label, input) {
  const wrap = el('label', 'field-wrap')
  mount(wrap, el('span', 'field-label', label), input)
  return wrap
}
