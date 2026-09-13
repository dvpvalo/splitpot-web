// The Supabase client and every read the app makes.
//
// Same project as the Android app, and every table's RLS keys on auth.uid(), so signing in
// as the same account IS the linkage. There is no sync layer and nothing to migrate.

import { settle } from './lib/money.js'

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

export const game = (id) => authed(() => q(
  client.from('games').select('*').eq('id', id).single(),
))

export const profile = () => authed(() => q(
  client.from('profiles').select('*').eq('id', uid()).maybeSingle(),
))

/** The host's contact book, by name. */
export const players = () => authed(() => q(
  client.from('players').select('*').eq('host_id', uid()).order('name'),
))

// Kotlin gets this free from @SerialName; here it is two lines. The RPC payload is flat
// rows of scalars, so a blanket key rename is safe and beats three hand-written mappers.
const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
const camelRows = (rows) => (rows ?? []).map(
  (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v])),
)

/**
 * One round trip for every stat screen; the aggregation happens in Postgres.
 * Returns { players, games, nights }. Live games are excluded from `nights` server-side —
 * mid-game nobody has cashed out, so every net would read as minus their buy-ins and the
 * screen would report a losing streak for a night still in progress.
 *
 * THE BOUNDARY: this is the one place keys are camelCased, because lib/stats.js is a 1:1
 * port of Kotlin and speaks camelCase. Plain table reads keep their snake_case column names,
 * since those are what writes have to send back.
 */
export const hostStats = () => authed(async () => {
  const raw = await q(client.rpc('host_stats'))
  return {
    players: camelRows(raw?.players),
    games: camelRows(raw?.games),
    nights: camelRows(raw?.nights),
  }
})

export const pendingSettlements = () => authed(() => q(
  client.from('settlements').select('*').eq('status', 'pending'),
))

/**
 * Total buy-ins across many games in ONE round trip. The obvious version - call gameDetail()
 * per game - is an N+1 that makes the screen crawl once a host has a season behind them.
 */
export async function totalBuyInCents(gameIds) {
  if (gameIds.length === 0) return 0
  const rows = await authed(() => q(
    client.from('entries').select('amount_cents').in('game_id', gameIds).eq('kind', 'buyin'),
  ))
  return rows.reduce((sum, r) => sum + r.amount_cents, 0)
}

let cachedUid = null
function uid() {
  if (!cachedUid) throw new Error('no session')
  return cachedUid
}
client.auth.onAuthStateChange((_e, session) => { cachedUid = session?.user?.id ?? null })
sessionReady.then(({ data }) => { cachedUid = data.session?.user?.id ?? null })

/** Everything one game screen needs, assembled from five tables in parallel. */
export async function gameDetail(gameId) {
  return authed(async () => {
    const [g, seatRows, roster, entries, settlements] = await Promise.all([
      q(client.from('games').select('*').eq('id', gameId).single()),
      q(client.from('game_players').select('*').eq('game_id', gameId).order('seat_order')),
      players(),
      q(client.from('entries').select('*').eq('game_id', gameId).order('created_at')),
      q(client.from('settlements').select('*').eq('game_id', gameId)),
    ])

    const playersById = new Map(roster.map((p) => [p.id, p]))
    const bySeat = new Map()
    for (const e of entries) {
      if (!bySeat.has(e.game_player_id)) bySeat.set(e.game_player_id, [])
      bySeat.get(e.game_player_id).push(e)
    }

    const seats = []
    for (const row of seatRows) {
      const player = playersById.get(row.player_id)
      if (!player) continue // a seat whose player was deleted: skip, do not invent one
      const mine = bySeat.get(row.id) ?? []
      const buyIns = mine.filter((e) => e.kind === 'buyin')
      const cashOuts = mine.filter((e) => e.kind !== 'buyin')
      const buyInCents = buyIns.reduce((s, e) => s + e.amount_cents, 0)
      const cashOutCents = cashOuts.reduce((s, e) => s + e.amount_cents, 0)
      seats.push({
        gamePlayerId: row.id,
        player,
        buyInCents,
        cashOutCents,
        hasCashedOut: cashOuts.length > 0,
        lastBuyInCents: buyIns.length ? buyIns[buyIns.length - 1].amount_cents : null,
        netCents: cashOutCents - buyInCents,
      })
    }

    const buyInCents = entries.filter((e) => e.kind === 'buyin')
      .reduce((s, e) => s + e.amount_cents, 0)
    const cashOutCents = entries.filter((e) => e.kind !== 'buyin')
      .reduce((s, e) => s + e.amount_cents, 0)

    return {
      game: g,
      seats,
      entries,
      settlements,
      buyInCents,
      cashOutCents,
      inPlayCents: buyInCents - cashOutCents,
    }
  })
}

// ---------- realtime ----------

/**
 * Calls `onChange` whenever anything in this game changes, so the ledger stays live across
 * devices. Returns an unsubscribe function - call it when leaving the screen, or every
 * navigation leaks a socket subscription.
 *
 * `games` is watched too, which the Android version does not do: the publication carries it,
 * so finishing a game on the phone flips the browser out of live preview for free.
 */
export function gameChanges(gameId, onChange) {
  const channel = client.channel(`game:${gameId}`)

  const watch = (table, filter) => channel.on(
    'postgres_changes', { event: '*', schema: 'public', table, filter }, onChange,
  )
  watch('entries', `game_id=eq.${gameId}`)
  watch('game_players', `game_id=eq.${gameId}`)
  watch('settlements', `game_id=eq.${gameId}`)
  watch('games', `id=eq.${gameId}`)

  // The socket carries its own auth. Without a token the server applies RLS as `anon`,
  // which has no table grants here, so the subscription would connect cleanly and then
  // simply never deliver a row - a silent failure that looks like "realtime doesn't work".
  sessionReady.then(({ data }) => {
    const token = data.session?.access_token
    if (token) client.realtime.setAuth(token)
    // Realtime does not replay what happened while the socket was down. A buy-in logged on
    // the phone during a wifi drop would otherwise stay missing from this page until some
    // LATER change happened to trigger a fetch. The callback fires SUBSCRIBED on every
    // successful join, rejoins after a reconnect included, so refetch each time. The first
    // one also covers a change landing between the initial load and the join.
    channel.subscribe((status) => { if (status === 'SUBSCRIBED') onChange() })
  })

  return () => client.removeChannel(channel)
}

// ---------- writes ----------

/**
 * A buy-in or a cash-out. The first thing in this app that spends money.
 *
 * Awaited against the server, and nothing renders as saved until it returns. There is no
 * optimistic rendering on any money path and no offline queue in this build: the phone
 * already covers the no-signal case, and a web write that LOOKS saved but never arrived is
 * worse than one that visibly failed. A failure raises a banner naming the action, and the
 * sheet keeps the typed amount so the host can retry rather than retype.
 */
export async function addEntry({
  gameId, gamePlayerId, kind, amountCents, paid = false, paidToPlayerId = null,
}) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('amount must be a positive whole number of minor units')
  }
  if (kind !== 'buyin' && kind !== 'cashout') throw new Error(`unknown entry kind: ${kind}`)
  return authed(() => q(client.from('entries').insert({
    game_id: gameId,
    game_player_id: gamePlayerId,
    kind,
    amount_cents: amountCents,
    paid,
    paid_to_player_id: paidToPlayerId,
  })))
}

/** The live preview uses the same shape that finishing the game will commit. */
export const standingsOf = (detail) => detail.seats.map((s) => ({
  playerId: s.player.id, name: s.player.name, netCents: s.netCents,
}))

/**
 * A new game. `id`, `ledger_slug`, `started_at` and `status` are all defaulted by Postgres
 * (`gen_ledger_slug()` mints the slug), so the client sends only what the host typed.
 */
export const createGame = ({
  name, gameType = 'cash', playedOn, smallBlindCents = null, bigBlindCents = null,
  currency = 'GBP', location = null,
}) => authed(() => q(client.from('games').insert({
  host_id: uid(),
  name,
  game_type: gameType,
  played_on: playedOn,
  small_blind_cents: smallBlindCents,
  big_blind_cents: bigBlindCents,
  currency,
  location,
}).select().single()))

export const deleteGame = (id) => authed(() => q(client.from('games').delete().eq('id', id)))

export const seatPlayer = (gameId, playerId, seatOrder) => authed(() => q(
  client.from('game_players')
    .insert({ game_id: gameId, player_id: playerId, seat_order: seatOrder })
    .select().single(),
))

export const unseatPlayer = (gamePlayerId) => authed(() => q(
  client.from('game_players').delete().eq('id', gamePlayerId),
))

export const deleteEntry = (entryId) => authed(() => q(
  client.from('entries').delete().eq('id', entryId),
))

/**
 * Freezes the game: computes the settlement once and stores it, so the numbers players were
 * shown can never drift afterwards.
 *
 * ponytail: three statements, not a transaction. Postgrest cannot do one, and an RPC would
 * be a migration this port does not otherwise need. The window is small and the failure is
 * recoverable — re-running finish recomputes from the entries, which are the source of truth.
 * What it CANNOT recover is `paid` ticks, which is exactly why finishing a second time is
 * confirmed with a count of how many it will clear.
 */
export async function finishGame(gameId) {
  const detail = await gameDetail(gameId)
  const transfers = settle(standingsOf(detail))
  return authed(async () => {
    await q(client.from('settlements').delete().eq('game_id', gameId))
    if (transfers.length > 0) {
      await q(client.from('settlements').insert(transfers.map((t) => ({
        game_id: gameId,
        from_player_id: t.fromId,
        to_player_id: t.toId,
        amount_cents: t.amountCents,
      }))))
    }
    await q(client.from('games')
      .update({ status: 'settled', finished_at: new Date().toISOString() })
      .eq('id', gameId))
    return transfers
  })
}

/**
 * Puts a finished game back into play - the way out of a mis-tapped Finish.
 *
 * Settlements are deliberately LEFT ALONE rather than deleted here. Reopening by accident
 * loses nothing; it is finishing again that replaces them, paid ticks and all.
 */
export const reopenGame = (gameId) => authed(() => q(
  client.from('games').update({ status: 'live', finished_at: null }).eq('id', gameId),
))

export const setSettlementPaid = (settlementId, paid) => authed(() => q(
  client.from('settlements').update({
    status: paid ? 'paid' : 'pending',
    paid_at: paid ? new Date().toISOString() : null,
  }).eq('id', settlementId),
))

// ---------- the contact book ----------

const playerPayload = ({ name, paymentType = 'none', paymentDetails = null, avatar = null }) => ({
  name: name.trim(),
  payment_type: paymentType,
  // A blank details box means "none", not an empty string sitting in the column.
  payment_details: paymentDetails?.trim() || null,
  avatar,
})

export const addPlayer = (fields) => authed(() => q(
  client.from('players').insert({ host_id: uid(), is_self: false, ...playerPayload(fields) })
    .select().single(),
))

export const updatePlayer = (id, fields) => authed(() => q(
  client.from('players').update(playerPayload(fields)).eq('id', id),
))

/**
 * Removing someone from the contact book.
 *
 * The database CASCADES this, because account deletion depends on it - so deleting a player
 * who has played would erase them from every past game and silently change the history.
 * Callers must check playerGameCount() first; the UI blocks it and says why.
 */
export const deletePlayer = (id) => authed(() => q(
  client.from('players').delete().eq('id', id),
))

// ---------- profile + account ----------

export const saveProfile = ({
  name, phone, defaultCurrency, smallBlindCents, bigBlindCents,
}) => authed(() => q(client.from('profiles').update({
  name: name.trim(),
  phone: phone?.trim() || null,
  default_currency: defaultCurrency,
  default_small_blind_cents: smallBlindCents,
  default_big_blind_cents: bigBlindCents,
}).eq('id', uid())))

/**
 * Publishes or unpublishes the standings page. Its own call, never folded into saveProfile:
 * this one makes every player's name and result readable by anyone holding the link, and
 * that must never happen as a side effect of editing a phone number.
 */
export const setPublicHistory = (enabled) => authed(() => q(
  client.from('profiles').update({ public_db_enabled: enabled }).eq('id', uid()),
))

/**
 * Erases the account. `delete_my_account()` is SECURITY DEFINER and RAISES on a null uid,
 * so it can never run without a predicate.
 *
 * Sign-out happens only AFTER the delete returns. Signing out first would throw away the
 * token the delete needs, and a host told "deleted" whose rows are still there has been told
 * something untrue - the same rule as the money writes.
 */
export async function deleteAccount() {
  await authed(() => q(client.rpc('delete_my_account')))
  await client.auth.signOut()
}

/** How many games a player has ever been seated in - the delete guard on the roster. */
export async function playerGameCount(playerId) {
  const rows = await authed(() => q(
    client.from('game_players').select('id', { count: 'exact' }).eq('player_id', playerId),
  ))
  return rows.length
}
