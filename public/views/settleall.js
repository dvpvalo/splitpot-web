// Settle up everything: every debt still open across every finished game, squared up in as
// few payments as it takes. Reached from Home's "Who owes what".

import { games as allGames, pendingSettlements, players, setSettlementsPaid } from '../db.js'
import { UPI_ENABLED, formatMoney, settleAcross, upiIdOf, upiLink } from '../lib/money.js'
import { reminderMessage } from '../lib/share.js'
import { button, clear, clearBanner, el, mount, payLink, screenTitle, showError, showNotice } from '../ui.js'

export function settleAllView() {
  const root = el('main', 'screen')
  root.appendChild(screenTitle('Across every game', 'Settle up'))
  const body = el('div', 'stack')
  root.appendChild(body)

  const load = async () => {
    clear(body)
    body.appendChild(el('p', 'muted', 'Loading…'))
    try {
      const [gameRows, pending, roster] = await Promise.all([allGames(), pendingSettlements(), players()])
      clear(body)
      render(body, groupsOf(gameRows, pending, roster), load)
    } catch (e) {
      clear(body)
      showError(`Could not load what is owed: ${e.message ?? e}`, load)
    }
  }
  load()
  return root
}

/**
 * Pending rows of FINISHED games, per currency. A reopened game's old rows are left out: it
 * is being played again, and finishing it will replace them.
 */
function groupsOf(games, pending, roster) {
  const gameOf = new Map(games.filter((g) => g.status === 'settled').map((g) => [g.id, g]))
  const playerOf = new Map(roster.map((p) => [p.id, p]))
  const byCurrency = new Map()
  for (const s of pending) {
    const g = gameOf.get(s.game_id)
    if (!g) continue
    const rows = byCurrency.get(g.currency) ?? []
    rows.push({
      id: s.id, gameName: g.name, playedOn: g.played_on, ledgerSlug: g.ledger_slug,
      fromId: s.from_player_id, fromName: playerOf.get(s.from_player_id)?.name ?? 'Removed player',
      toId: s.to_player_id, toName: playerOf.get(s.to_player_id)?.name ?? 'Removed player',
      amountCents: s.amount_cents,
    })
    byCurrency.set(g.currency, rows)
  }
  return [...byCurrency].map(([currency, rows]) => ({ currency, rows, playerOf }))
}

function render(body, groups, reload) {
  if (groups.length === 0) {
    const card = el('div', 'card')
    mount(card, el('h2', 'card-title', "Everyone's square"), el('p', 'muted', 'Nothing outstanding across your games.'))
    body.appendChild(card)
    return
  }
  for (const { currency, rows, playerOf } of groups) {
    const { payments, simplified, debts } = settleAcross(rows)
    const games = new Set(rows.map((r) => r.gameName)).size
    const paying = payments.filter((p) => p.amountCents > 0).length
    const gameName = new Map(rows.map((r) => [r.id, r.gameName]))
    const debtGame = new Map(rows.map((r) => [r.id, r]))

    const card = el('div', 'card')
    mount(card,
      el('h2', 'card-title', `${debts} ${debts === 1 ? 'debt' : 'debts'} from ${games} ${games === 1 ? 'game' : 'games'}`),
      el('p', 'muted', paying < debts
        ? `Squared up in ${paying} ${paying === 1 ? 'payment' : 'payments'} instead of ${debts}.`
        : 'Nothing to combine: each one is already a single payment.'),
    )
    if (simplified) {
      card.appendChild(el('p', 'muted small',
        'Simplified: some people pay someone other than who they owed. Everyone ends up exactly as square.'))
    }
    body.appendChild(card)

    const list = el('div', 'list tickets')
    for (const p of payments) {
      const row = el('div', 'row')
      const main = el('div', 'row-main')
      const from = p.ids ? [...new Set(p.ids.map((id) => gameName.get(id)))].join(' · ') : null
      mount(main,
        el('h4', 'row-title', p.amountCents === 0 ? `${p.fromName} and ${p.toName} cancel out` : `${p.fromName} pays ${p.toName}`),
        ...(from ? [el('p', 'row-sub', from)] : []),
      )
      const right = el('div', 'row-right')
      if (p.amountCents > 0) right.appendChild(el('span', 'money money-down', formatMoney(p.amountCents, currency)))
      const pay = UPI_ENABLED && upiLink({
        upiId: upiIdOf(playerOf.get(p.toId)), name: p.toName, cents: p.amountCents, currency, note: 'Splitpot settle-up',
      })
      if (pay) right.appendChild(payLink(pay))
      if (p.amountCents > 0) {
        right.appendChild(button('Remind', () => remind(reminderMessage(p, debtGame, currency)), 'btn-rebuy'))
      }
      // A combined payment can be ticked on its own only when it maps back to its debts.
      if (p.ids) right.appendChild(tick(p.amountCents === 0 ? 'Clear' : 'Mark paid', p.ids, reload))
      mount(row, main, right)
      list.appendChild(row)
    }
    body.appendChild(list)

    const all = rows.map((r) => r.id)
    const everyone = button("Everyone's paid", async () => {
      if (!confirm(`Tick all ${all.length} ${all.length === 1 ? 'debt' : 'debts'} across ${games} ${games === 1 ? 'game' : 'games'} as paid?`)) return
      await write(everyone, all, reload)
    }, 'btn')
    body.appendChild(everyone)
  }
}

/**
 * Hands the reminder to the share sheet; the host picks WhatsApp and the person, and presses
 * send. Where there is no share sheet (desktops), it is copied instead, and says so.
 */
async function remind(text) {
  try {
    if (navigator.share) {
      await navigator.share({ text })
      return
    }
    await navigator.clipboard.writeText(text)
    showNotice('Reminder copied. Paste it in WhatsApp.')
  } catch (e) {
    if (e?.name === 'AbortError') return
    showError(`Could not share that reminder: ${e.message ?? e}`)
  }
}

function tick(label, ids, reload) {
  const b = button(label, () => write(b, ids, reload), 'btn-rebuy')
  return b
}

async function write(btn, ids, reload) {
  btn.disabled = true
  clearBanner()
  try {
    await setSettlementsPaid(ids)
    await reload()
  } catch (e) {
    btn.disabled = false
    showError(`Those payments were NOT ticked: ${e.message ?? e}`)
  }
}
