// Shell, auth gate, and the hash router.
//
// Hash routing rather than history: every request is for "/", so there is no server rewrite
// to configure and a deep link cannot 404 on a static host.

import { LOADING, SIGNED_IN, SIGNED_OUT, watchAuth } from './auth.js'
import { clearBanner, clear, el, showNotice } from './ui.js'
import { gamesView } from './views/games.js'
import { signinView } from './views/signin.js'

const app = document.getElementById('app')

let state = LOADING

const ROUTES = {
  '': gamesView,
  '#/': gamesView,
  '#/games': gamesView,
}

function render() {
  clear(app)

  if (state === LOADING) {
    // Three states, not two. Rendering the sign-in screen while the stored session is still
    // being read would flash a login form at a host who is already signed in, every cold
    // start — the exact thing the Android splash screen was added to stop.
    app.appendChild(el('div', 'loading', 'Loading…'))
    return
  }

  if (state === SIGNED_OUT) {
    app.appendChild(signinView())
    return
  }

  const view = ROUTES[location.hash] ?? gamesView
  app.appendChild(view())
}

watchAuth((next, session, meta) => {
  if (meta?.offline) {
    showNotice('Connection lost. Showing the last thing loaded.')
    return
  }
  const changed = next !== state
  state = next
  if (state === SIGNED_IN) clearBanner()
  if (changed) render()
})

window.addEventListener('hashchange', render)
window.addEventListener('online', () => {
  if (state === SIGNED_IN) clearBanner()
})
