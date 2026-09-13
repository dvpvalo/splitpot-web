// Port of data/GamePresets.kt. Spec: GamePresetsTest.kt.
//
// A saved game format - "Friday 5/5" - so the host fills the new-game form by tapping a chip
// instead of typing five fields. Local on purpose: a preset is six fields, and local means it
// works with no signal, which is exactly when a game gets created.
//
// The Android version is a JSON file in filesDir; here it is one localStorage key. Same
// rules, same pure upsert, and the storage half is three lines at the bottom.

/** More than this and the chip row stops being a row. */
export const MAX = 6

const KEY = 'splitpot_game_presets'

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Newest first, replacing any preset with the same name rather than stacking a second one
 * beside it - saving "Friday" twice means the host edited Friday.
 */
export function upsert(existing, preset) {
  return [preset, ...existing.filter((p) => !sameName(p.name, preset.name))].slice(0, MAX)
}

export function remove(existing, name) {
  return existing.filter((p) => !sameName(p.name, name))
}

/**
 * A corrupt value must not take the new-game screen down with it: presets are a convenience,
 * and an empty row is a recoverable state that the next save writes over.
 */
export function parsePresets(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.name === 'string') : []
  } catch {
    return []
  }
}

// ---------- storage ----------
// Wrapped because Safari in private mode throws on localStorage rather than returning null,
// and a thrown preset would take the new-game screen with it.

export function load() {
  try {
    return parsePresets(localStorage.getItem(KEY))
  } catch {
    return []
  }
}

export function save(presets) {
  try {
    localStorage.setItem(KEY, JSON.stringify(presets))
  } catch {
    /* presets are a convenience; losing them is not worth failing a game creation over */
  }
  return presets
}
