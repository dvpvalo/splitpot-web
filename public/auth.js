// Sign in, sign out, and the three-state gate.
//
// Ported from data/Auth.kt. The two rules worth keeping are both about not throwing a host
// out of their own ledger: a dead network must never look like a sign-out, and the very
// first sign-in for an address must not be rejected by the wrong OTP type.

import { client, sessionReady } from './db.js'

export const LOADING = 'loading'
export const SIGNED_IN = 'in'
export const SIGNED_OUT = 'out'

// supabase-js has no RefreshFailure event: a refresh that fails because the network died
// arrives as SIGNED_OUT, identical to a deliberate sign-out. Treating that as a sign-out
// would drop a host onto a login form mid-game because the wifi blinked.
//
// ponytail: heuristic, not a guarantee. navigator.onLine only knows whether there is a
// network interface, not whether Supabase is reachable. It is the honest 90% until
// supabase-js can tell the two apart.
let deliberate = false

/**
 * Calls back with LOADING, then SIGNED_IN / SIGNED_OUT, and again on every change.
 * `offline` is true when a session vanished while the browser thinks it is offline, which
 * the shell should render as a banner over the current screen rather than a sign-in page.
 */
export function watchAuth(onChange) {
  onChange(LOADING, null)

  sessionReady.then(({ data }) => {
    onChange(data.session ? SIGNED_IN : SIGNED_OUT, data.session)
  })

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' && !deliberate && !navigator.onLine) {
      onChange(SIGNED_IN, session, { offline: true })
      return
    }
    if (session) {
      onChange(SIGNED_IN, session)
    } else if (event === 'SIGNED_OUT') {
      onChange(SIGNED_OUT, null)
    }
  })
}

export const currentUser = async () => (await client.auth.getUser()).data.user

/**
 * Google, which is the front door: every phone installing from Play already has an account,
 * and the email route depends on a sender with a real rate limit.
 *
 * redirectTo is origin + pathname, deliberately without the hash — the hash is this app's
 * router and Supabase would not preserve it anyway.
 */
export async function signInWithGoogle() {
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  })
  if (error) throw error
}

export async function sendEmailCode(email) {
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  })
  if (error) throw error
}

/**
 * Verify the six-digit code.
 *
 * The fallback is not optional. An address that has never signed in before is a 'signup'
 * OTP, and an existing one is 'email'; getting this wrong rejects every first-ever sign-in
 * with a message that reads like the code was mistyped. Kotlin does the same two-step.
 */
export async function verifyEmailCode(email, token) {
  const first = await client.auth.verifyOtp({ email, token, type: 'email' })
  if (!first.error) return first.data
  const second = await client.auth.verifyOtp({ email, token, type: 'signup' })
  if (!second.error) return second.data
  throw first.error // the first error is the one that describes what the user typed
}

export async function signOut() {
  deliberate = true
  try {
    const { error } = await client.auth.signOut()
    if (error) throw error
  } finally {
    deliberate = false
  }
}

/**
 * PKCE keeps its code verifier in this browser's localStorage, so finishing a sign-in in a
 * DIFFERENT browser than it started in fails with "code verifier should be non-empty" —
 * the same class of bug as the Android callback crash. Worth saying plainly rather than
 * showing the raw message.
 */
export function authMessage(error) {
  const message = String(error?.message ?? error ?? '')
  if (/code verifier/i.test(message)) {
    return 'That sign-in was started in a different browser. Try again here, or use an email code.'
  }
  if (/rate limit|too many/i.test(message)) {
    return 'Too many email codes for now — email is limited to about two an hour. Use Google instead.'
  }
  if (/expired|invalid/i.test(message)) {
    return 'That code was wrong or has expired. Send a new one.'
  }
  return message || 'Something went wrong signing in.'
}
