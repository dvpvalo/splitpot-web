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

/**
 * UPI is built but held back until after launch (user, 12 Oct 2026: people pay each other
 * themselves for now). Off hides the UPI payment type, every Pay button and the intro's pay
 * scenes. Flip it here and in money/Settlement.kt to bring all of it back.
 */
export const UPI_ENABLED = false

/**
 * A UPI id ("name@bank"). Checked before it goes into a link, because the id travels raw:
 * some UPI apps refuse a percent-encoded "@", so the id is never encoded, only vetted.
 */
export const isUpiId = (s) => /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/.test((s ?? '').trim())

/**
 * The upi:// link that opens GPay / PhonePe / Paytm with the payee and amount filled in.
 * Null unless the payee has a UPI id and the game is in rupees - UPI moves nothing else.
 */
export function upiLink({ upiId, name, cents, currency, note }) {
  if (currency !== 'INR' || !isUpiId(upiId) || !(cents > 0)) return null
  const am = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
  return `upi://pay?pa=${upiId.trim()}&pn=${encodeURIComponent(name)}&am=${am}&cu=INR`
    + (note ? `&tn=${encodeURIComponent(note.slice(0, 50))}` : '')
}

/** The player's UPI id, or null. A player row from the database or the ledger. */
export const upiIdOf = (p) => (p?.payment_type === 'upi' && isUpiId(p.payment_details)
  ? p.payment_details.trim() : null)

/**
 * Everything still owed across every finished game, squared up in as few payments as it can.
 * `rows` are pending settlements in ONE currency: {id, fromId, fromName, toId, toName,
 * amountCents}.
 *
 * Two ways to square it, and the fewer payments wins:
 *  - pairwise: two people who owe each other from different nights pay once, the difference.
 *    Nobody ends up paying someone they never owed, and each payment maps back to its rows,
 *    so it can be ticked on its own (`ids`).
 *  - simplified: everyone's total, run through settle(). Can save more payments, but may
 *    have Tanish pay someone he never sat with, and a payment no longer maps to rows
 *    (`ids` null): only "everyone's paid" can clear it.
 * A pair that cancels out exactly is kept as a 0 row, so its debts can still be cleared.
 */
export function settleAcross(rows) {
  const pairs = new Map()
  for (const r of rows) {
    const from = { id: r.fromId, name: r.fromName }
    const to = { id: r.toId, name: r.toName }
    const forward = from.id < to.id
    const [lo, hi] = forward ? [from, to] : [to, from]
    const key = `${lo.id}|${hi.id}`
    const p = pairs.get(key) ?? { lo, hi, net: 0, ids: [] }
    p.net += forward ? r.amountCents : -r.amountCents // lo owes hi when net > 0
    p.ids.push(r.id)
    pairs.set(key, p)
  }
  const byAmount = (x, y) => y.amountCents - x.amountCents
    || (x.fromId < y.fromId ? -1 : x.fromId > y.fromId ? 1 : 0)
    || (x.toId < y.toId ? -1 : x.toId > y.toId ? 1 : 0)
  const pairwise = [...pairs.values()].map(({ lo, hi, net, ids }) => {
    const [from, to] = net >= 0 ? [lo, hi] : [hi, lo]
    return { fromId: from.id, fromName: from.name, toId: to.id, toName: to.name,
      amountCents: Math.abs(net), ids }
  }).sort(byAmount)

  const nets = new Map()
  for (const r of rows) {
    nets.set(r.fromId, { name: r.fromName, net: (nets.get(r.fromId)?.net ?? 0) - r.amountCents })
    nets.set(r.toId, { name: r.toName, net: (nets.get(r.toId)?.net ?? 0) + r.amountCents })
  }
  const simplified = settle([...nets].map(([playerId, v]) => ({ playerId, name: v.name, netCents: v.net })))

  const paying = pairwise.filter((p) => p.amountCents > 0).length
  return simplified.length < paying
    ? { payments: simplified.map((t) => ({ ...t, ids: null })), simplified: true, debts: rows.length }
    : { payments: pairwise, simplified: false, debts: rows.length }
}
