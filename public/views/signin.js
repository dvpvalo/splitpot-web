// The sign-in screen.
//
// Google leads and the email code folds behind a link. That is the reference app's order and
// its reasoning holds on the web too: the email route depends on a sender capped at roughly
// two codes an hour, so the fragile path should not be the front door.

import { authMessage, sendEmailCode, signInWithGoogle, verifyEmailCode } from '../auth.js'
import { button, clear, el, mount, showError, clearBanner } from '../ui.js'

export function signinView() {
  const root = el('main', 'screen screen-signin')
  const card = el('div', 'card card-signin')

  mount(card,
    el('h1', 'wordmark', 'Splitpot'),
    el('p', 'sub', 'Your poker ledger, on the same account as the app.'),
  )

  const google = button('Continue with Google', async () => {
    google.disabled = true
    clearBanner()
    try {
      await signInWithGoogle()   // navigates away; nothing after this runs on success
    } catch (e) {
      google.disabled = false
      showError(authMessage(e))
    }
  }, 'btn btn-primary btn-google')
  card.appendChild(google)

  const emailArea = el('div', 'email-area')
  const toggle = button('Use an email code instead', () => {
    emailArea.hidden = false
    toggle.hidden = true
    emailInput.focus()
  }, 'btn-link')
  card.appendChild(toggle)

  // ---- email code, folded away until asked for ----
  emailArea.hidden = true

  const emailInput = el('input')
  emailInput.type = 'email'
  emailInput.inputMode = 'email'
  emailInput.autocomplete = 'email'
  emailInput.placeholder = 'you@example.com'
  emailInput.className = 'field'

  const codeInput = el('input')
  codeInput.type = 'text'
  // A numeric keypad without type=number, which would let a leading zero vanish.
  codeInput.inputMode = 'numeric'
  codeInput.autocomplete = 'one-time-code'
  codeInput.placeholder = '6-digit code'
  codeInput.className = 'field'
  codeInput.hidden = true

  const send = button('Email me a code', async () => {
    const address = emailInput.value.trim()
    if (!address) return
    send.disabled = true
    clearBanner()
    try {
      await sendEmailCode(address)
      codeInput.hidden = false
      verify.hidden = false
      send.textContent = 'Send another code'
      codeInput.focus()
    } catch (e) {
      showError(authMessage(e))
    } finally {
      send.disabled = false
    }
  }, 'btn')

  const verify = button('Sign in', async () => {
    verify.disabled = true
    clearBanner()
    try {
      await verifyEmailCode(emailInput.value.trim(), codeInput.value.trim())
      // onAuthStateChange drives the redraw; nothing to do here.
    } catch (e) {
      showError(authMessage(e))
    } finally {
      verify.disabled = false
    }
  }, 'btn btn-primary')
  verify.hidden = true

  mount(emailArea, emailInput, send, codeInput, verify)
  card.appendChild(emailArea)

  root.appendChild(card)
  return root
}
