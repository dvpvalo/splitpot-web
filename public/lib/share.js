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
