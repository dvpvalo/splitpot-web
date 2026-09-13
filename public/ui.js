// The few DOM helpers everything else builds on.
//
// `el` exists so that no player name ever reaches innerHTML. That mattered on the anon
// ledger page for cosmetic reasons; here the page holds a real access token in localStorage,
// so it is guarding a bearer token. textContent, always, everywhere.

import { formatMoney } from './lib/money.js'

/**
 * Money, coloured by sign. The colour comes from --up/--down/--flat, which are their own
 * variables and never derived from --primary: in a ledger, red means money lost, and
 * spending it on controls would make a loss look like a button.
 */
export function money(cents, currency, signed = false) {
  const tone = cents > 0 ? 'up' : cents < 0 ? 'down' : 'flat'
  return el('span', `money money-${tone}`, formatMoney(cents, currency, signed))
}

export function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined && text !== null) node.textContent = String(text)
  return node
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
  return node
}

export function mount(node, ...children) {
  for (const c of children) if (c) node.appendChild(c)
  return node
}

export function button(label, onClick, cls = 'btn') {
  const b = el('button', cls, label)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

/**
 * A bottom sheet, which is a <dialog> so the browser handles focus trapping, Escape and
 * the backdrop rather than this file reimplementing three accessibility features badly.
 */
export function sheet(title, ...content) {
  const dlg = el('dialog', 'sheet')
  const head = el('header', 'sheet-head')
  mount(head, el('h2', 'sheet-title', title), button('Close', () => dlg.close(), 'btn-link'))
  mount(dlg, head, ...content)
  dlg.addEventListener('close', () => dlg.remove())
  // A click on the backdrop lands on the dialog itself, never on its children.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close() })
  document.body.appendChild(dlg)
  dlg.showModal()
  return dlg
}

/**
 * A persistent error strip. Money writes must never fail silently, so this never
 * auto-dismisses: it stays until it is replaced or explicitly cleared.
 */
export function showError(message, onRetry) {
  const bar = document.getElementById('banner')
  clear(bar)
  bar.className = 'banner banner-error'
  bar.appendChild(el('span', null, message))
  if (onRetry) bar.appendChild(button('Retry', onRetry, 'btn-inline'))
  bar.hidden = false
}

export function showNotice(message) {
  const bar = document.getElementById('banner')
  clear(bar)
  bar.className = 'banner banner-notice'
  bar.appendChild(el('span', null, message))
  bar.hidden = false
}

export function clearBanner() {
  const bar = document.getElementById('banner')
  clear(bar)
  bar.hidden = true
}
