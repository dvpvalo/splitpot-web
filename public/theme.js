// The three looks, mirroring ThemePref on the phone. Midnight, Daylight and System were
// dropped on 7 Oct 2026 at the user's request; a saved choice of any of them reads as Lounge.
//
// The palettes themselves are custom properties in app.css; this file only decides which
// block is live and remembers the choice. Money colours (--up/--down/--flat) are their own
// variables in every theme and are never derived from --primary - that is the whole point of
// LocalMoneyColors, and Paper's rule (stamp red for losses and errors, ink for buttons) falls
// out of it for free.

const KEY = 'splitpot_theme'

export const THEMES = [
  { key: 'lounge', label: 'Lounge' },
  { key: 'felt', label: 'Neon felt' },
  { key: 'paper', label: 'Paper' },
]

/** The order the top-bar button steps through. */
const CYCLE = ['lounge', 'felt', 'paper']

const valid = (key) => THEMES.some((t) => t.key === key)

/** What a first visit gets: Lounge, same as the phone's default. */
const DEFAULT = 'lounge'

export function current() {
  try {
    const stored = localStorage.getItem(KEY)
    return valid(stored) ? stored : DEFAULT
  } catch {
    return DEFAULT
  }
}

export function apply(key) {
  const theme = valid(key) ? key : DEFAULT
  document.documentElement.dataset.theme = theme
  // Keeps the phone's own browser chrome in step with the page it is framing.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.content = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg').trim() || '#0e0f11'
  }
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* a look that does not survive a reload still looks right for this sitting */
  }
  // So a picker open on the Settings screen does not sit there showing the old choice when
  // the theme was changed from the button pinned above it.
  window.dispatchEvent(new CustomEvent('splitpot:theme', { detail: theme }))
  return theme
}

/** What one tap on the top-bar button moves to. Anything unknown starts at the beginning. */
export function next(key = current()) {
  const at = CYCLE.indexOf(key)
  return at === -1 ? CYCLE[0] : CYCLE[(at + 1) % CYCLE.length]
}

export const labelOf = (key) => THEMES.find((t) => t.key === key)?.label ?? 'Lounge'
