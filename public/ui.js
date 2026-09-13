// The few DOM helpers everything else builds on.
//
// `el` exists so that no player name ever reaches innerHTML. That mattered on the anon
// ledger page for cosmetic reasons; here the page holds a real access token in localStorage,
// so it is guarding a bearer token. textContent, always, everywhere.

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
