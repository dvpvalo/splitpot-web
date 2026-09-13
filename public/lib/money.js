// Port of money/Money.kt and money/Settlement.kt. The Kotlin tests are the spec:
// app/src/test/java/com/splitpot/app/SettlementTest.kt
//
// Money is an integer of minor units everywhere, never a float — a poker ledger that
// loses a penny to float rounding is a ledger nobody trusts.
// ponytail: Number is exact to 2^53, i.e. ~90 trillion pence. Past any home game, and
// parseMoney refuses anything that would not survive the trip.

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'CLP', 'PYG', 'VND', 'ISK'])

const SYMBOLS = {
  GBP: '£',
  USD: '$', CAD: '$', AUD: '$', NZD: '$', MXN: '$', ARS: '$', CLP: '$', COP: '$',
  EUR: '€', INR: '₹', JPY: '¥', PYG: '₲', BRL: 'R$',
  PEN: 'S/', CHF: 'Fr', ZAR: 'R',
}

export function currencySymbol(code) {
  return SYMBOLS[code] ?? `${code} `
}

export function minorUnitDigits(code) {
  return ZERO_DECIMAL.has(code) ? 0 : 2
}

// "1250" -> "1,250". ponytail: fixed 3-digit grouping. Kotlin's "%,d" follows the JVM
// locale, so a phone set to English (India) groups 125000 as 1,25,000 where this shows
// 125,000. Only visible at six figures of minor units; swap in Intl if anyone notices.
const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// |cents| split into whole units and leftover minor units, with no division that a
// float could round: both halves stay integers.
function split(cents, digits) {
  const abs = Math.abs(cents)
  const scale = 10 ** digits
  return { whole: Math.floor(abs / scale), frac: abs % scale }
}

/** "£1,250" / "£12.50" — a trailing ".00" is dropped, matching the reference app. */
export function formatMoney(cents, currency, signed = false) {
  const digits = minorUnitDigits(currency)
  const { whole, frac } = split(cents, digits)
  const body = frac === 0
    ? group(String(whole))
    : `${group(String(whole))}.${String(frac).padStart(digits, '0')}`
  const sign = cents < 0 ? '-' : signed && cents > 0 ? '+' : ''
  return `${sign}${currencySymbol(currency)}${body}`
}

/**
 * Parses user input ("20", "12.50", "1,250") into minor units. Null if not a valid amount.
 *
 * Parsed by hand, digit by digit, because the obvious port is silently wrong:
 * Math.round(parseFloat("1.005") * 100) is 100, since the float is 1.00499...,
 * where Kotlin's BigDecimal HALF_UP gives 101. No float ever touches this path.
 */
export function parseMoney(input, currency) {
  const digits = minorUnitDigits(currency)
  const symbol = currencySymbol(currency)
  let cleaned = input.trim().replaceAll(',', '')
  if (cleaned.startsWith(symbol)) cleaned = cleaned.slice(symbol.length)

  // ponytail: stricter than Kotlin's BigDecimal, which also accepts exponent notation
  // ("1e3" -> 1000). Refusing that on a buy-in field is the safe direction to differ.
  const m = /^\+?(\d*)(?:\.(\d*))?$/.exec(cleaned)
  if (!m) return null
  const int = m[1] ?? ''
  const frac = m[2] ?? ''
  if (int === '' && frac === '') return null

  const kept = frac.slice(0, digits).padEnd(digits, '0')
  // HALF_UP: the remainder is >= 0.5 exactly when the first discarded digit is >= 5.
  const roundUp = frac.length > digits && Number(frac[digits]) >= 5 ? 1 : 0
  const minor = Number(`${int || '0'}${kept}`) + roundUp
  return Number.isSafeInteger(minor) ? minor : null
}

/**
 * Plain editable form of an amount: no symbol, no thousands separators, no trailing ".00".
 * Round-trips through parseMoney unchanged, which formatMoney deliberately does not.
 */
export function formatAmount(cents, currency) {
  const digits = minorUnitDigits(currency)
  const { whole, frac } = split(cents, digits)
  const sign = cents < 0 ? '-' : ''
  return frac === 0
    ? `${sign}${whole}`
    : `${sign}${whole}.${String(frac).padStart(digits, '0')}`
}

/**
 * Greedy largest-debtor-to-largest-creditor matching. At most (n-1) transfers, which is
 * what "the smallest set of payments" means in practice.
 *
 * ponytail: greedy, not provably minimal — true minimum-cardinality settlement is NP-hard
 * (it needs subset-sum to spot exact-offsetting groups). At home-game sizes it ties the
 * optimum on essentially every real table.
 *
 * If the table does not balance (money still in play), the unmatched remainder is left
 * unsettled rather than being silently forced onto someone.
 */
export function settle(standings) {
  // Kotlin's `thenBy { it.playerId }` is String.compareTo: a UTF-16 code-unit compare.
  // NOT localeCompare, which orders differently and would make the output depend on the
  // browser's locale — the determinism test is what catches that.
  const byId = (a, b) => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0)

  const creditors = standings
    .filter((s) => s.netCents > 0)
    .sort((a, b) => b.netCents - a.netCents || byId(a, b))
    .map((s) => ({ s, left: s.netCents }))
  const debtors = standings
    .filter((s) => s.netCents < 0)
    .sort((a, b) => a.netCents - b.netCents || byId(a, b))
    .map((s) => ({ s, left: -s.netCents }))

  const transfers = []
  let ci = 0
  let di = 0
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci]
    const d = debtors[di]
    const amount = Math.min(c.left, d.left)
    if (amount > 0) {
      transfers.push({
        fromId: d.s.playerId, fromName: d.s.name,
        toId: c.s.playerId, toName: c.s.name,
        amountCents: amount,
      })
    }
    c.left -= amount
    d.left -= amount
    if (c.left === 0) ci++
    if (d.left === 0) di++
  }
  return transfers
}
