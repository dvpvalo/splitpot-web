// Shell, auth gate, and the hash router.
//
// Hash routing rather than history: every request is for "/", so there is no server rewrite
// to configure and a deep link cannot 404 on a static host.

import { LOADING, SIGNED_IN, SIGNED_OUT, signOut, watchAuth } from './auth.js'
import { button, clearBanner, clear, el, mount, showNotice } from './ui.js'
import { gameView } from './views/game.js'
import { historyView } from './views/history.js'
import { homeView } from './views/home.js'
import { peopleView } from './views/people.js'
import { signinView } from './views/signin.js'

const app = document.getElementById('app')

let state = LOADING

const TABS = [
  { hash: '#/', label: 'Home', view: homeView },
  { hash: '#/history', label: 'History', view: historyView },
  { hash: '#/people', label: 'People', view: peopleView },
]

const routeFor = (hash) => TABS.find((t) => t.hash === hash) ?? TABS[0]

// The only parameterised route. Anything else falls through to the tabs.
const GAME_ROUTE = /^#\/game\/([\w-]+)$/

function render() {
  clear(app)

  if (state === LOADING) {
    // Three states, not two. Rendering the sign-in screen while the stored session is still
    // being read would flash a login form at a host who is already signed in, every cold
    // start - the exact thing the Android splash screen was added to stop.
    app.appendChild(el('div', 'loading', 'Loading…'))
    return
  }

  if (state === SIGNED_OUT) {
    app.appendChild(signinView())
    return
  }

  const game = GAME_ROUTE.exec(location.hash)
  if (game) {
    app.appendChild(gameView(game[1]))
    app.appendChild(tabBar(null))
    return
  }

  const active = routeFor(location.hash)
  app.appendChild(active.view())
  app.appendChild(tabBar(active))
}

function tabBar(active) {
  const nav = el('nav', 'tabs')
  nav.setAttribute('aria-label', 'Sections')
  for (const t of TABS) {
    const link = el('a', `tab${t === active ? ' tab-on' : ''}`, t.label)
    link.href = t.hash
    if (t === active) link.setAttribute('aria-current', 'page')
    nav.appendChild(link)
  }
  // Settings arrives in Phase 7; until then sign out needs to live somewhere reachable.
  nav.appendChild(button('Sign out', () => signOut(), 'tab tab-quiet'))
  return nav
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
