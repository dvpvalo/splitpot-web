// Port of ui/TimeText.kt.
//
// Every function that needs the current time takes `now` as a parameter, so the labels are
// testable and a render never depends on when it happened to run.

/** Postgres hands back "2026-08-31T12:38:29.764517+00:00"; be forgiving about what we accept. */
export function parseInstant(value) {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms)
}

const MINUTE = 60_000

// Kotlin's Duration.toMinutes() truncates toward zero. Math.floor would round a negative
// span (a clock skewed a few seconds into the future) the wrong way.
const minutesBetween = (from, to) => Math.trunc((to.getTime() - from.getTime()) / MINUTE)

/** "0m", "47m", "3h 12m" - matches the reference app's Duration tile. */
export function durationLabel(from, to, now) {
  if (!from) return '0m'
  const end = to ?? now
  const minutes = Math.max(minutesBetween(from, end), 0)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** "Just now", "4m ago", "2h ago", "3d ago". */
export function relativeLabel(at, now) {
  if (!at) return ''
  const minutes = minutesBetween(at, now)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / (60 * 24))}d ago`
}

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * A date-only string is a calendar date, not an instant. Built in UTC and read back in UTC
 * so the weekday cannot shift: `new Date('2026-08-31')` parses as UTC midnight, and reading
 * .getDay() from a browser behind UTC would name the day before.
 *
 * Formats are spelled out rather than handed to Intl, because Kotlin pins Locale.UK and the
 * browser's locale is whatever the user's phone says.
 */
function parts(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate))
  if (!m) return null
  const [, y, mo, d] = m.map(Number)
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null // a real calendar date, not 2026-02-31
  }
  return { dt, y, mo, d }
}

/** "Monday, 31 August 2026" */
export function longDate(isoDate) {
  const p = parts(isoDate)
  if (!p) return isoDate
  return `${DAY_NAMES[p.dt.getUTCDay()]}, ${p.d} ${MONTHS_LONG[p.mo - 1]} ${p.y}`
}

/** "3 Sep 2026" - for lists where the weekday would just be noise. */
export function shortDate(isoDate) {
  const p = parts(isoDate)
  if (!p) return isoDate
  return `${p.d} ${MONTHS_SHORT[p.mo - 1]} ${p.y}`
}
