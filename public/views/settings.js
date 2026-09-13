// Settings: the host profile, the table tools, the look, the public standings switch, and
// the account.

import { signOut } from '../auth.js'
import { deleteAccount, profile, saveProfile, setPublicHistory } from '../db.js'
import { LEVEL_CHOICES } from '../lib/clock.js'
import { formatAmount, parseMoney } from '../lib/money.js'
import { historyMessage, historyUrl } from '../lib/share.js'
import {
  clockEnabled, dealerEnabled, levelMinutes, setClockEnabled, setDealerEnabled, setLevelMinutes,
} from '../lib/tools.js'
import { THEMES, apply as applyTheme, current as currentTheme } from '../theme.js'
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
      mount(body,
        profileCard(me ?? {}),
        toolsCard(),
        lookCard(),
        standingsCard(me ?? {}),
        accountCard(),
      )
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

// ---------- table tools ----------

/**
 * The two things that can sit on the live table. Both start OFF, and off means ABSENT - the
 * table renders exactly as it did before them, with no greyed-out control and no placeholder
 * row. A feature nobody switched on costs them no pixels.
 *
 * Local to this browser, never in Postgres: a clock is about the room you are sitting in, it
 * has to keep counting with no signal, and syncing a timer across devices would be a hard
 * problem bought for nobody.
 */
function toolsCard() {
  const wrap = el('div', 'stack')
  const levels = el('div', 'chips')

  const drawLevels = () => {
    clear(levels)
    for (const n of LEVEL_CHOICES) {
      const on = n === levelMinutes()
      const chip = button(`${n} min`, () => { setLevelMinutes(n); drawLevels() },
        `chip${on ? ' chip-on' : ''}`)
      chip.setAttribute('aria-pressed', String(on))
      levels.appendChild(chip)
    }
  }
  drawLevels()

  const levelWrap = el('div', 'stack-tight')
  mount(levelWrap, el('p', 'muted small', 'Minutes per level'), levels)
  levelWrap.hidden = !clockEnabled()

  return mount(wrap,
    el('h2', 'section-label', 'Table tools'),
    el('p', 'muted small', 'Both off by default. Off means they are not on the table at all.'),
    toggle('Blind clock', 'Counts down the level and doubles the blinds from this game\u2019s '
      + 'own stakes.', clockEnabled, (on) => {
      setClockEnabled(on)
      levelWrap.hidden = !on
    }),
    levelWrap,
    toggle('Dealer button', 'Shows who deals next, and moves round the table with one tap.',
      dealerEnabled, setDealerEnabled),
  )
}

/**
 * A switch, as a button that says what one tap will do.
 *
 * A real <input type=checkbox> would be the native answer, but every other control on this
 * screen is a full-width button and a 20px box beside a label is the one target on the page
 * that fails the 44px rule this app is built around.
 */
function toggle(title, blurb, read, write) {
  const wrap = el('div', 'stack-tight')
  let on = read()
  const btn = button('', () => { on = !on; write(on); draw() }, 'btn')

  function draw() {
    btn.textContent = `${title}: ${on ? 'on' : 'off'}`
    btn.className = `btn${on ? ' btn-on' : ''}`
    btn.setAttribute('aria-pressed', String(on))
  }
  draw()

  return mount(wrap, btn, el('p', 'muted small', blurb))
}

// ---------- the look ----------

function lookCard() {
  const wrap = el('div', 'stack')
  const row = el('div', 'theme-row')

  const draw = () => {
    clear(row)
    for (const t of THEMES) {
      const on = t.key === currentTheme()
      const chip = button(t.label, () => { applyTheme(t.key); draw() },
        `chip${on ? ' chip-on' : ''}`)
      chip.setAttribute('aria-pressed', String(on))
      row.appendChild(chip)
    }
  }
  draw()
  // The view is torn down with the screen, so this listener goes with it - but the screen can
  // outlive several theme changes, and the chips have to keep up with the pinned button.
  window.addEventListener('splitpot:theme', draw)

  return mount(wrap,
    el('h2', 'section-label', 'Look'),
    el('p', 'muted small',
      'System follows your device. The button at the top of the screen cycles the other four.'),
    row,
  )
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
