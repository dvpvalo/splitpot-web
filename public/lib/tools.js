// Storage half of data/TableTools.kt: the two optional things that can sit on the live table.
//
// Both are OFF until switched on in Settings, and while off the table renders exactly as it
// did before them. Nobody pays screen space for a feature they never turned on.
//
// All of it is localStorage, never Postgres - the same decision the phone made, for the same
// reasons. A blind clock is about the room you are sitting in, not the account: it has to
// keep counting with no signal, it means nothing to the players reading the ledger link, and
// syncing a timer across devices would be a genuinely hard problem bought for nobody.
//
// The pure logic - advancing levels, doubling blinds, formatting - is lib/clock.js, which has
// the tests. This file only reads and writes.

import { DEFAULT_LEVEL_MINUTES, parse, serialise } from './clock.js'

const KEYS = {
  clockOn: 'splitpot_tools_clock_on',
  dealerOn: 'splitpot_tools_dealer_on',
  levelMinutes: 'splitpot_tools_level_minutes',
}

// Every access is wrapped: Safari in private mode THROWS on localStorage rather than
// returning null, and a table tool must never be able to take the live table down with it.
function read(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* a tool that cannot remember its own switch still works for this sitting */
  }
}

// ---------- the switches ----------

export const clockEnabled = () => read(KEYS.clockOn) === 'true'
export const setClockEnabled = (on) => write(KEYS.clockOn, String(on))

export const dealerEnabled = () => read(KEYS.dealerOn) === 'true'
export const setDealerEnabled = (on) => write(KEYS.dealerOn, String(on))

export function levelMinutes() {
  const raw = read(KEYS.levelMinutes)
  const n = Number(raw)
  // Number(null) and Number('') are both 0, which would be a level that ends instantly and a
  // clock that races through every level on its first tick.
  return raw && Number.isInteger(n) && n > 0 ? n : DEFAULT_LEVEL_MINUTES
}

export const setLevelMinutes = (minutes) => write(KEYS.levelMinutes, String(minutes))

// ---------- per game ----------

const clockKey = (gameId) => `splitpot_clock_${gameId}`
const dealerKey = (gameId) => `splitpot_dealer_${gameId}`

export function clock(gameId) {
  const raw = read(clockKey(gameId))
  return raw ? parse(raw) : null
}

export const saveClock = (gameId, state) => write(
  clockKey(gameId), state === null ? null : serialise(state),
)

/** The seat holding the button, by `gamePlayerId`. Null until the host sets one. */
export const dealer = (gameId) => read(dealerKey(gameId))

export const setDealer = (gameId, gamePlayerId) => write(dealerKey(gameId), gamePlayerId ?? null)

/**
 * Both keys for one game, dropped together.
 *
 * Deleting a game used to leave its clock and its dealer behind forever - the phone had the
 * same bug and it was fixed there in passing. These are per-game keys in a store nothing else
 * ever prunes, so the delete path is the only place they can go.
 */
export function forgetGame(gameId) {
  write(clockKey(gameId), null)
  write(dealerKey(gameId), null)
}
