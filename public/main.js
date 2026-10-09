// Shell, auth gate, and the hash router.
//
// Hash routing rather than history: every request is for "/", so there is no server rewrite
// to configure and a deep link cannot 404 on a static host.

import { LOADING, SIGNED_IN, SIGNED_OUT, watchAuth } from './auth.js'
import { apply as applyTheme, current as currentTheme, labelOf, next as nextTheme } from './theme.js'
import { button, clearNotice, clear, el, mount, showNotice } from './ui.js'
import { gameView } from './views/game.js'
import { historyView } from './views/history.js'
import { homeView } from './views/home.js'
import { insightsView } from './views/insights.js'
import { introSeen, introView, markIntroSeen } from './views/intro.js'
import { newGameView } from './views/newgame.js'
import { peopleView } from './views/people.js'
import { settingsView } from './views/settings.js'
import { signinView } from './views/signin.js'
import { playSplash } from './views/splash.js'

const app = document.getElementById('app')

// index.html has already set data-theme inline, before first paint. This re-applies it
// through the module that owns it, which is what keeps the meta theme-color in step.
applyTheme(currentTheme())

// A screen may hold a live subscription. Tear the old one down BEFORE the next render, or
// every navigation leaves another socket channel behind listening to a game nobody is on.
let teardown = null
function swap(node) {
  teardown?.()
  teardown = node.destroy ?? null
  app.appendChild(node)
}

let state = LOADING

const TABS = [
  { hash: '#/', label: 'Home', view: homeView, icon: 'home' },
  { hash: '#/history', label: 'History', view: historyView, icon: 'history' },
  { hash: '#/insights', label: 'Insights', view: insightsView, icon: 'insights' },
  { hash: '#/people', label: 'People', view: peopleView, icon: 'people' },
  { hash: '#/settings', label: 'Settings', view: settingsView, icon: 'settings' },
]

/** Tab glyphs: 24-unit strokes in currentColor, so the active tab's colour carries them. */
const ICONS = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.2l2.8 1.8"/>',
  insights: '<path d="M5 19v-6M10 19V6M15 19v-9M20 19V9"/>',
  people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.2a5.5 5.5 0 0 1 3 4.8"/>',
  settings: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
}

function icon(key) {
  const span = el('span', 'tab-icon')
  span.setAttribute('aria-hidden', 'true')
  // Constant markup from ICONS above, never data - the one innerHTML in the app, and safe.
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[key]}</svg>`
  return span
}

const routeFor = (hash) => TABS.find((t) => t.hash === hash) ?? TABS[0]

// The only parameterised route. Anything else falls through to the tabs.
const GAME_ROUTE = /^#\/game\/([\w-]+)$/

function render() {
  clear(app)

  teardown?.()
  teardown = null

  if (state === LOADING) {
    // Three states, not two. Rendering the sign-in screen while the stored session is still
    // being read would flash a login form at a host who is already signed in, every cold
    // start - the exact thing the Android splash screen was added to stop.
    app.appendChild(el('div', 'loading', 'Loading…'))
    return
  }

  if (state === SIGNED_OUT) {
    app.appendChild(signinView())
    app.appendChild(themeCycle())
    return
  }

  // First run on this device, or "Watch the intro again" from Settings.
  if (location.hash === '#/intro' || !introSeen()) {
    swap(introView((target) => {
      markIntroSeen()
      if (location.hash === target) render()
      else location.hash = target
    }))
    return
  }

  app.appendChild(themeCycle())

  if (location.hash === '#/new') {
    swap(newGameView())
    app.appendChild(tabBar(null))
    return
  }

  const game = GAME_ROUTE.exec(location.hash)
  if (game) {
    swap(gameView(game[1]))
    app.appendChild(tabBar(null))
    return
  }

  const active = routeFor(location.hash)
  swap(active.view())
  app.appendChild(tabBar(active))
}

/**
 * One tap through the looks, the way the phone's top bar does it.
 *
 * Deliberately does NOT re-render: a theme is custom properties, so changing the attribute
 * repaints everything for free. Re-rendering here would tear down the live game screen and
 * its realtime subscription to change a colour.
 */
function themeCycle() {
  const b = button('◐', () => { applyTheme(nextTheme()); label() }, 'btn theme-cycle')
  function label() {
    const target = labelOf(nextTheme())
    b.title = `Switch to ${target}`
    b.setAttribute('aria-label', `Switch to ${target}`)
  }
  label()
  return b
}

function tabBar(active) {
  const nav = el('nav', 'tabs')
  nav.setAttribute('aria-label', 'Sections')
  for (const t of TABS) {
    const link = el('a', `tab${t === active ? ' tab-on' : ''}`)
    mount(link, icon(t.icon), el('span', 'tab-label', t.label))
    link.href = t.hash
    if (t === active) link.setAttribute('aria-current', 'page')
    nav.appendChild(link)
  }
  return nav
}

watchAuth((next, session, meta) => {
  if (meta?.offline) {
    showNotice('Connection lost. Showing the last thing loaded.')
    return
  }
  const changed = next !== state
  state = next
  // ONLY on a real transition back to signed-in, which is what clears a "connection lost"
  // notice. This used to fire on every auth callback, TOKEN_REFRESHED included - so a token
  // refresh landing at the wrong moment silently wiped whatever was in the banner. That is
  // fine for a notice and unacceptable for "your buy-in was NOT saved".
  if (changed && state === SIGNED_IN) clearNotice()
  if (changed) render()
})

window.addEventListener('hashchange', render)
// The opening animation, over whatever renders underneath; it holds until the session is read.
playSplash(() => state !== LOADING)
window.addEventListener('online', () => {
  // Recovering the network clears a "connection lost" notice, and deliberately does NOT
  // clear an error: a failed write is still a failed write once the wifi comes back.
  if (state === SIGNED_IN) clearNotice()
})
