// The Supabase client and every read the app makes.
//
// Same project as the Android app, and every table's RLS keys on auth.uid(), so signing in
// as the same account IS the linkage. There is no sync layer and nothing to migrate.

const SUPABASE_URL = 'https://sdslqdlmputkhadbrtnm.supabase.co'
// Publishable, not secret: `anon` has no table grants at all, so possession of this grants
// nothing. Every row the app reads is reached with the signed-in user's own token.
const SUPABASE_KEY = 'sb_publishable_w7JkJoarKKptxjlU8Zp34A_bNEv02M-'

const factory = globalThis.supabase?.createClient
if (!factory) {
  throw new Error('vendor/supabase.js did not load before db.js')
}

export const client = factory(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    // PKCE for the same reason the Android app uses it: the code verifier never leaves this
    // browser, so an intercepted redirect is worth nothing.
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/** Resolves once the stored session has been read. Await before any authenticated call. */
export const sessionReady = client.auth.getSession()

/**
 * THE important function. supabase-js RETURNS { data, error } rather than throwing, so an
 * insert whose result is never destructured fails completely silently — the exact shape of
 * the runCatching{}.onSuccess{} bug that once hid a failed rebuy on the phone.
 *
 * Every read and every write goes through here. No exceptions.
 */
export async function q(builder) {
  const { data, error } = await builder
  if (error) throw error
  return data
}

const isAuthFailure = (e) => {
  const status = e?.status ?? e?.originalError?.status
  const code = String(e?.code ?? '')
  const message = String(e?.message ?? '')
  return status === 401 || code === 'PGRST301' || /jwt|token is expired/i.test(message)
}

/**
 * Runs something that needs a session, refreshing once and replaying if the token died
 * mid-flight. The equivalent of Repository.authed{} on the phone.
 */
export async function authed(run) {
  await sessionReady
  try {
    return await run()
  } catch (e) {
    if (!isAuthFailure(e)) throw e
    const { error } = await client.auth.refreshSession()
    if (error) throw error
    return await run()
  }
}

// ---------- reads ----------

/** Every game this host owns, newest night first. */
export const games = () => authed(() => q(
  client
    .from('games')
    .select('id,name,played_on,status,currency,location,started_at,finished_at,ledger_slug')
    .order('played_on', { ascending: false })
    .order('started_at', { ascending: false }),
))
