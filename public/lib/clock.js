// Pure half of data/TableTools.kt. Spec: BlindClockTest.kt.
//
// `now` is always a parameter, never read inside. The whole correctness argument of this
// clock is that remaining time is DERIVED from wall-clock time, not counted down in memory:
// close the tab for two levels and it reopens two levels on, which is what happens at a table.
//
// A state is { level, levelStartedAt, pausedElapsed }; pausedElapsed null means running.

export const LEVEL_CHOICES = [10, 15, 20, 30]
export const DEFAULT_LEVEL_MINUTES = 20

export const newClock = (now) => ({ level: 1, levelStartedAt: now, pausedElapsed: null })

export const isPaused = (c) => c.pausedElapsed !== null

export const serialise = (c) => `${c.level}|${c.levelStartedAt}|${c.pausedElapsed ?? -1}`

// Number('') is 0, where Kotlin's toIntOrNull is null. Without this a truncated stored value
// would silently read as level 0 starting at the epoch, i.e. a clock that is wildly wrong
// rather than one that is absent.
const int = (s) => (/^-?\d+$/.test(s) ? Number(s) : null)

export function parse(raw) {
  const bits = String(raw).split('|')
  if (bits.length !== 3) return null
  const level = int(bits[0])
  const started = int(bits[1])
  const paused = int(bits[2])
  if (level === null || started === null || paused === null) return null
  return { level, levelStartedAt: started, pausedElapsed: paused >= 0 ? paused : null }
}

/**
 * Rolls a running clock forward to now, crossing as many level boundaries as real time did.
 * A paused clock is returned untouched - that is the whole point of pausing.
 */
export function advanced(c, levelMillis, now) {
  if (isPaused(c) || levelMillis <= 0) return c
  const elapsed = now - c.levelStartedAt
  if (elapsed < levelMillis) return c
  const passed = Math.floor(elapsed / levelMillis)
  return {
    ...c,
    level: c.level + passed,
    levelStartedAt: c.levelStartedAt + passed * levelMillis,
  }
}

/** Millis left in the current level, never negative. */
export function remaining(c, levelMillis, now) {
  const elapsed = c.pausedElapsed ?? now - c.levelStartedAt
  return Math.min(Math.max(levelMillis - elapsed, 0), levelMillis)
}

/**
 * The blinds at a given level: the game's own stakes, doubled each level. Derived rather
 * than configured - a level editor is a screen nobody wants to fill in before the first hand.
 * A game with no stakes recorded has nothing to double.
 */
export function blindsAtLevel(smallCents, bigCents, level) {
  if (smallCents === null || smallCents === undefined) return null
  if (bigCents === null || bigCents === undefined) return null
  // Clamped at 12 doublings so an overnight clock prints a big number, not a broken one.
  const steps = Math.min(Math.max(level - 1, 0), 12)
  // 2 ** steps, NEVER 1 << steps: JS bitwise operators coerce to 32 bits and would wrap at
  // exactly the level this clamp exists to protect against.
  const factor = 2 ** steps
  return [smallCents * factor, bigCents * factor]
}

/** "12:30", or "0:07" in the last minute. Minutes unpadded; the clock is read at a glance. */
export function clockLabel(remainingMillis) {
  const total = Math.floor((remainingMillis + 999) / 1000) // round up: reads 1:00, not 0:59
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
