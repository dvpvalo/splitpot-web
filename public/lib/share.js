// Port of the pure half of share/Share.kt: the link builders and the message text.
//
// The Android file also drives the system share sheet and the clipboard; on the web those
// are navigator.share and navigator.clipboard, and they live in the view layer. This file
// stays free of both so the text can be tested.

import { formatMoney } from './money.js'

/**
 * Where the player-facing pages live, always with one trailing slash.
 *
 * These links are only ever seen in a WhatsApp group, which is why they point at the pages
 * directly rather than at the Supabase redirect in front of them: a twenty-character random
 * subdomain reads as a phishing link. The redirect function stays deployed, so links already
 * sent to players keep working.
 */
export const LEDGER_BASE = 'https://dvpvalo.github.io/splitpot-ledger/'

const base = () => LEDGER_BASE.replace(/\/+$/, '') + '/'

export const ledgerUrl = (game) => `${base()}?g=${game.ledgerSlug}`

/** Under the join QR: how to get in without a camera. A game made before join codes has none. */
export const joinHint = (code) => (code
  ? `Scan with the camera, or open ${base().replace(/^https?:\/\//, '').replace(/\/$/, '')} and type the code.`
  : 'Scan with the camera to open the live ledger.')

/** Where the app itself lives. The player card is part of it, so it can share lib/insights.js. */
export const APP_BASE = 'https://splitpot.pages.dev/'

export const playerCardUrl = (slug) => `${APP_BASE}player.html?p=${slug}`
export const playerCardMessage = (name, slug) => `${name}'s poker card\n${playerCardUrl(slug)}`

/** The whole group's standings - a different page, so the filename is part of the link. */
export const historyUrl = (slug) => `${base()}history.html?h=${slug}`

/** The "Copy full message" text: results, who owes whom, and the link. */
export function resultsMessage(game, transfers) {
  const lines = [`${game.name} — final results`, '']
  if (transfers.length === 0) {
    lines.push("Everyone's square. Nothing to settle.")
  } else {
    for (const t of transfers) {
      lines.push(`${t.fromName} pays ${t.toName} ${formatMoney(t.amountCents, game.currency)}`)
    }
  }
  lines.push('', `Full ledger: ${ledgerUrl(game)}`)
  return lines.join('\n') + '\n'
}

export const ledgerMessage = (game) => `${game.name} — live ledger\n${ledgerUrl(game)}`

export const historyMessage = (slug) => `Our poker standings\n${historyUrl(slug)}`

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-10-08" -> "8 Oct": a reminder is about last week, so no year. */
const dayMonth = (iso) => `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]}`

/**
 * The nudge for someone who still owes: friendly, the amount, which nights it is from, and the
 * newest of those nights' ledger. `gameOf` maps a settlement id to {gameName, playedOn,
 * ledgerSlug}. A simplified payment (no single game behind it, ids null) has no nights to
 * name and no link.
 */
export function reminderMessage(payment, gameOf, currency) {
  const games = [...new Map((payment.ids ?? []).map((id) => gameOf.get(id)).filter(Boolean)
    .map((g) => [g.ledgerSlug ?? g.gameName, g])).values()]
    .sort((a, b) => (a.playedOn < b.playedOn ? -1 : a.playedOn > b.playedOn ? 1 : 0))
  const first = payment.fromName.trim().split(/\s+/)[0]
  const owed = `${payment.toName} ${formatMoney(payment.amountCents, currency)}`
  const from = games.length
    ? ` (${games.map((g) => `${g.gameName}, ${dayMonth(g.playedOn)}`).join(' and ')})`
    : ' from our recent games'
  const lines = [`Hi ${first}, quick reminder from our poker nights: you still owe ${owed}${from}.`]
  const newest = games.at(-1)
  if (newest?.ledgerSlug) lines.push(`Full ledger: ${ledgerUrl({ ledgerSlug: newest.ledgerSlug })}`)
  return lines.join('\n')
}

// ---------- game invites ----------

/** The players' RSVP page: one link in the group, people tap their name. */
export const inviteUrl = (slug) => `${base()}invite.html?i=${slug}`

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Fri 17 Oct, 9:00 pm", from a Date read in the phone's own time zone. */
export function inviteTime(d) {
  const h = d.getHours()
  const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}, ${clock}`
}

/** What goes in the group chat. `startsAt` is a Date. */
export function inviteMessage({ title, startsAt, location, slug }) {
  const when = [title, inviteTime(startsAt), location].filter(Boolean).join(' · ')
  return `${when}\nIn or out? Tap your name: ${inviteUrl(slug)}`
}
