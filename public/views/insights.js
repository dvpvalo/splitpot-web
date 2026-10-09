// Insights: two tabs. "Insights" is one player's game read back to them; "All-time standings"
// is the group's table and a chart comparing players. All the arithmetic is in
// lib/insights.js; this file only draws it. Same sections, order and wording as
// InsightsScreen.kt on the phone.
//
// A host with no finished games sees a clearly-marked sample instead of an empty page.

import { hostStats, players } from '../db.js'
import {
  BIG_TABLE, LONG_GAME_HOURS, compactMoney, comparisonSeries, currenciesFor, hoursLabel,
  insightsFor, niceTicks, rivalsFor, sampleNights, trendBy,
} from '../lib/insights.js'
import { formatMoney } from '../lib/money.js'
import { seasonsIn, standingsFor } from '../lib/stats.js'
import { shortDate } from '../lib/time.js'
import { button, clear, el, money, monogram, mount, sheet, showError } from '../ui.js'

const SVG = 'http://www.w3.org/2000/svg'

/** Section glyphs: constant 24-unit strokes, the same style the tab bar uses. */
const GLYPHS = {
  chart: '<path d="M5 19v-6M10 19V6M15 19v-9M20 19V9"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/>',
  up: '<path d="M7 17 17 7M9 7h8v8"/>',
  down: '<path d="M7 7l10 10M17 9v8H9"/>',
  pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  swords: '<path d="M4 4l9 9M4 4h4M4 4v4M20 4l-9 9M20 4h-4M20 4v4M7 17l-3 3M17 17l3 3"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.2l2.8 1.8"/>',
  gauge: '<path d="M4 16a8 8 0 1 1 16 0M12 16l4-5"/>',
  flame: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-3 5-3 8a6 6 0 0 0 6 6z"/>',
  coins: '<ellipse cx="9" cy="7" rx="5" ry="2.5"/><path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7M10 15.5c.9 1.2 2.9 2 5 2 2.8 0 5-1.1 5-2.5v-4c0-1.4-2.2-2.5-5-2.5"/>',
  door: '<path d="M6 20V4h9v16M15 20h3M11 12h.01"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
}

function glyph(key, cls = 'ins-glyph') {
  const span = el('span', cls)
  span.setAttribute('aria-hidden', 'true')
  // Constant markup from GLYPHS, never data.
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[key]}</svg>`
  return span
}

export function insightsView() {
  const root = el('main', 'screen')
  const body = el('div', 'stack')
  root.appendChild(body)

  const load = async () => {
    clear(body)
    body.appendChild(el('p', 'muted', 'Loading…'))
    try {
      const [stats, roster] = await Promise.all([hostStats(), players()])
      clear(body)
      mount(body, screen(stats.nights ?? [], roster))
    } catch (e) {
      clear(body)
      showError(`Could not load insights: ${e.message ?? e}`, load)
    }
  }

  load()
  return root
}

function screen(realNights, roster) {
  const sample = realNights.length === 0
  const nights = sample ? sampleNights() : realNights

  // Everyone with a finished night, the host first, then the regulars.
  const counts = new Map()
  for (const n of nights) {
    const c = counts.get(n.playerId) ?? { id: n.playerId, name: n.playerName, isSelf: n.isSelf, nights: 0 }
    c.nights++
    counts.set(n.playerId, c)
  }
  const people = [...counts.values()].sort((a, b) => (b.isSelf - a.isSelf) || (b.nights - a.nights))
  const avatarOf = new Map(roster.map((p) => [p.id, p.avatar]))
  const personOf = (id) => ({ name: counts.get(id)?.name ?? '?', avatar: avatarOf.get(id) })

  const state = {
    tab: 'insights',
    player: people[0].id,
    seasonKey: null,
    currency: null,
    view: 'session',
    rivalsShown: 4,
    recentShown: 5,
    boardShown: 5,
    compare: null,
  }

  const wrap = el('div', 'stack')

  const draw = () => {
    const currencies = currenciesFor(nights, state.player)
    if (!currencies.includes(state.currency)) state.currency = currencies[0]
    const seasons = seasonsIn(nights.filter((n) => n.playerId === state.player))
    const season = seasons.find((s) => s.key === state.seasonKey) ?? seasons[0]
    state.seasonKey = season.key

    clear(wrap)
    const standings = state.tab === 'standings'
    mount(wrap,
      header(standings),
      tabs(state.tab, (t) => { state.tab = t; draw() }),
      sample ? sampleCard(standings) : null,
    )

    const filters = el('div', 'ins-filter-row')
    filters.appendChild(selectBox('calendar', 'Period', seasons.map((s) => [s.key ?? '', s.label]), season.key ?? '',
      (v) => { state.seasonKey = v || null; draw() }))
    if (currencies.length > 1) {
      filters.appendChild(selectBox('coins', 'Currency', currencies.map((c) => [c, c]), state.currency,
        (v) => { state.currency = v; draw() }))
    }
    wrap.appendChild(filters)

    if (standings) {
      mount(wrap, ...standingsTab(nights, state, season, personOf, draw))
      return
    }

    const pick = el('section', 'card ins-player')
    mount(pick, mount(el('p', 'ins-label'), glyph('person', 'ins-glyph ins-glyph-accent'), el('span', null, 'Player')),
      selectBox(null, 'Player', people.map((p) => [p.id, p.isSelf && p.name !== 'You' ? `${p.name} (You)` : p.name]), state.player,
        (v) => { state.player = v; state.rivalsShown = 4; state.recentShown = 5; draw() }, 'select-plain'))
    wrap.appendChild(pick)

    const r = insightsFor(nights, state.player, state.currency, season)
    if (r.games === 0) {
      wrap.appendChild(el('p', 'muted', 'No finished games in this period.'))
      return
    }
    const cur = state.currency
    const you = Boolean(counts.get(state.player)?.isSelf)
    mount(wrap,
      hero(r, cur, season.label, you),
      pair(
        tile('up', 'Biggest win', r.best && r.best.netCents > 0 ? money(r.best.netCents, cur, true) : bigText('None yet'),
          r.best && r.best.netCents > 0 ? `${r.best.gameName} · ${shortDate(r.best.playedOn)}` : 'No winning game in this period'),
        tile('down', 'Biggest loss', r.worst && r.worst.netCents < 0 ? money(r.worst.netCents, cur, true) : bigText('None yet'),
          r.worst && r.worst.netCents < 0 ? `${r.worst.gameName} · ${shortDate(r.worst.playedOn)}` : 'No losing game in this period'),
      ),
      pair(
        tile('gauge', 'Avg per game', money(r.avgCents, cur, true), 'Total result divided by games played'),
        tile('flame', 'Current streak', bigText(streakWords(r.streak)), 'Games in a row up or down, up to the latest'),
      ),
      pair(
        tile('coins', 'Return (ROI)', bigText(r.money.roi === null ? '–' : `${r.money.roi > 0 ? '+' : ''}${r.money.roi}%`),
          `${formatMoney(r.money.inCents, cur)} in · ${formatMoney(r.money.outCents, cur)} out`),
        tile('door', 'Went home empty', bigText(`${r.bust.pct}%`),
          `${r.bust.nights} of ${r.games} ${r.games === 1 ? 'game' : 'games'} cashed out nothing`),
      ),
      tendencies(r, cur),
      rivalsCard(nights, state, season, personOf, draw),
      monthsCard(r, cur),
      timeCard(r, cur),
      trendCard(r, cur, state, draw),
      deepDive(r, cur, you),
      recentCard(r, cur, state, draw),
    )
  }

  draw()
  return wrap
}

// ---------- page furniture ----------

function header(standings) {
  const head = el('header', 'screen-title')
  mount(head,
    el('p', 'eyebrow', 'Performance'),
    el('h1', 'title', standings ? 'All-time standings' : 'Insights'),
    el('p', 'ins-sub', standings ? 'Your group leaderboard across finished games.' : 'Your stats and trends in one place.'),
  )
  return head
}

function tabs(active, onPick) {
  const bar = el('div', 'seg seg-big')
  bar.setAttribute('role', 'tablist')
  for (const [key, label, icon] of [['insights', 'Insights', 'chart'], ['standings', 'All-time standings', 'trophy']]) {
    const b = button('', () => onPick(key), `seg-btn${key === active ? ' seg-on' : ''}`)
    b.setAttribute('role', 'tab')
    b.setAttribute('aria-selected', String(key === active))
    mount(b, glyph(icon), el('span', null, label))
    bar.appendChild(b)
  }
  return bar
}

function sampleCard(standings) {
  const card = el('section', 'card ins-sample')
  mount(card,
    el('span', 'ins-badge', 'Sample data'),
    el('p', null, standings
      ? "This is what your group's standings look like after a few game nights. Finish your first game to see your own."
      : 'This is what your Insights look like after a few game nights. Finish your first game to see your own.'),
  )
  return card
}

/** A labelled native <select>, styled as a pill. Native, so the phone's own picker opens. */
function selectBox(icon, label, options, value, onChange, extra = '') {
  const wrap = el('label', `select-wrap ${extra}`)
  if (icon) wrap.appendChild(glyph(icon))
  const sel = el('select', 'select')
  sel.setAttribute('aria-label', label)
  for (const [v, text] of options) {
    const o = el('option', null, text)
    o.value = v
    if (v === value) o.selected = true
    sel.appendChild(o)
  }
  sel.addEventListener('change', () => onChange(sel.value))
  wrap.appendChild(sel)
  return wrap
}

const bigText = (text) => el('p', 'ins-tile-value', text)

function streakWords(s) {
  if (s > 0) return `${s} ${s === 1 ? 'win' : 'wins'}`
  if (s < 0) return `${-s} ${s === -1 ? 'loss' : 'losses'}`
  return 'None'
}

function cardHead(icon, label, sub) {
  const head = el('div', 'ins-card-head')
  mount(head, mount(el('h2', 'ins-label'), glyph(icon, 'ins-glyph ins-glyph-accent'), el('span', null, label)))
  if (sub) head.appendChild(el('p', 'ins-card-sub', sub))
  return head
}

function tile(icon, label, value, sub, note) {
  return mount(el('div', 'tile ins-tile'),
    mount(el('p', 'ins-label'), icon ? glyph(icon) : null, el('span', null, label)),
    value,
    note ? el('p', 'ins-tile-note', note) : null,
    sub ? el('p', 'tile-sub', sub) : null)
}

const pair = (...tiles) => mount(el('div', 'ins-grid'), ...tiles.filter(Boolean))

// ---------- the hero ----------

function hero(r, cur, periodLabel, you) {
  const card = el('section', 'card ins-hero')
  const top = el('div', 'ins-hero-top')
  mount(top,
    mount(el('div'),
      el('p', 'ins-label ins-label-plain', `All games net · ${periodLabel}`),
      mount(el('p', 'ins-net'), money(r.netCents, cur, true))),
    mount(el('div', 'ins-record'),
      el('span', 'ins-record-value', `${r.wins}–${r.games - r.wins}`),
      el('span', 'ins-record-label', 'wins · non-wins')),
  )
  const stat = (value, label) => mount(el('div', 'ins-stat'), el('span', 'ins-stat-value', value), el('span', 'ins-stat-label', label))
  const stats = mount(el('div', 'ins-stats'),
    stat(String(r.games), r.games === 1 ? 'Game' : 'Games'),
    stat(String(r.wins), r.wins === 1 ? 'Win' : 'Wins'),
    stat(`${r.winRate}%`, 'Win rate'))
  const who = you ? 'you' : 'they'
  const foot = el('p', 'ins-foot', `A win is a game ${who} finished up: left with more than ${who} put in.`)
  const rank = r.rank ? el('p', 'ins-rank', `#${r.rank.position} of ${r.rank.of} at the table this period`) : null
  return mount(card, top, stats, foot, rank)
}

// ---------- tendencies ----------

function tendencies(r, cur) {
  const card = el('section', 'card')
  card.appendChild(cardHead('pulse', 'Tendencies'))

  const ups = r.form.filter((f) => f === 'up').length
  const downs = r.form.filter((f) => f === 'down').length
  const dotsCard = el('div', 'ins-inner')
  const head = el('div', 'ins-row-head')
  mount(head, el('p', 'ins-label ins-label-plain', r.form.length < r.games ? `Last ${r.form.length}` : 'All games'),
    el('span', 'ins-row-note', `${ups} up · ${downs} down`))
  const dots = el('div', 'form-dots')
  dots.setAttribute('aria-label', `Newest first: ${r.form.join(', ')}`)
  r.form.forEach((f, i) => dots.appendChild(el('span', `form-dot form-${f}${i === 0 ? ' form-latest' : ''}`)))
  mount(dotsCard, head, dots, el('p', 'tile-sub', 'Each dot is one game: green finished up, red finished down. Newest first.'))
  card.appendChild(dotsCard)

  const t = r.time
  const rb = r.rebuy
  const sl = r.shortLong
  const bs = r.buyInSize
  const ts = r.tables
  const wd = r.bestWeekday
  const pctText = (p) => (p === null ? '–' : `${p}%`)
  const grid = pair(
    t ? tile(null, 'Typical game length', bigText(hoursLabel(t.avgHours)), 'Average time at the table per game', `Longest ${hoursLabel(t.longestHours)}`) : null,
    rb ? tile(null, 'Games with a rebuy', bigText(`${rb.gamesPct}%`), 'Share of games with a second buy-in or more', `${rb.perGame} rebuys per game`) : null,
    rb && rb.after !== null ? tile(null, 'Ahead after a rebuy', bigText(`${rb.after}%`), 'How often a game with a rebuy still finished up',
      rb.without === null ? 'Rebought every game' : `${rb.without}% in games without one`) : null,
    sl ? tile(null, 'Short vs long games', bigText(`${pctText(sl.first.pct)} / ${pctText(sl.second.pct)}`),
      'How often shorter vs longer games finished up', `Under ${LONG_GAME_HOURS}h / ${LONG_GAME_HOURS}h or longer`) : null,
    bs ? tile(null, 'By buy-in size', bigText(`${pctText(bs.small.pct)} / ${pctText(bs.big.pct)}`),
      'How often the smallest vs biggest opening buy-in finished up',
      `${formatMoney(bs.small.cents, cur)} / ${formatMoney(bs.big.cents, cur)} buy-in`) : null,
    wd ? tile(null, 'Best night of the week', bigText(wd.label), 'The weekday with the best average result',
      `${formatMoney(wd.avgCents, cur, true)} average over ${wd.nights} ${wd.nights === 1 ? 'game' : 'games'}`) : null,
    ts ? tile(null, 'Small vs big tables', bigText(`${pctText(ts.first.pct)} / ${pctText(ts.second.pct)}`),
      'How often smaller vs bigger tables finished up', `Up to ${BIG_TABLE - 1} seated / ${BIG_TABLE} or more`) : null,
    tile(null, 'Longest winning run', bigText(`${r.longestWin} ${r.longestWin === 1 ? 'game' : 'games'}`),
      'Most games in a row finished up', `Out of ${r.games} ${r.games === 1 ? 'game' : 'games'}`),
  )
  grid.classList.add('ins-grid-inner')
  card.appendChild(grid)
  return card
}

// ---------- head to head ----------

function rivalsCard(nights, state, season, personOf, redraw) {
  const { rivals, nemesis, favourite } = rivalsFor(nights, state.player, state.currency, season)
  if (rivals.length === 0) return null
  const isYou = nights.some((n) => n.playerId === state.player && n.isSelf)
  const a = isYou ? 'You' : personOf(state.player).name

  const card = el('section', 'card')
  card.appendChild(cardHead('swords', 'Head to head',
    'Only games both played in this period. "Ahead" means finishing that game with the better result.'))

  if (nemesis || favourite) {
    const sum = el('div', 'ins-grid ins-grid-inner')
    if (favourite) {
      sum.appendChild(tile(null, 'Beats most often', bigText(favourite.isSelf ? 'You' : favourite.name),
        `Ahead in ${favourite.h.aAhead} of ${favourite.h.together} games together`))
    }
    if (nemesis) {
      sum.appendChild(tile(null, 'Toughest opponent', bigText(nemesis.isSelf ? 'You' : nemesis.name),
        `Behind in ${nemesis.h.bAhead} of ${nemesis.h.together} games together`))
    }
    card.appendChild(sum)
  }

  const list = el('div', 'stack-tight')
  for (const r of rivals.slice(0, state.rivalsShown)) {
    const b = r.isSelf ? 'You' : r.name
    const h = r.h
    const block = el('div', 'ins-inner rival')
    const top = el('div', 'rival-head')
    mount(top,
      monogram(personOf(state.player), 'mono-sm mono-a'), el('strong', null, a), el('span', 'muted small', 'vs'),
      monogram(personOf(r.playerId), 'mono-sm mono-b'), el('strong', 'rival-name', b),
      el('span', 'rival-count', `${h.together} ${h.together === 1 ? 'game' : 'games'} together`))
    const bar = el('div', 'h2h-bar')
    const decided = h.aAhead + h.bAhead
    const aSeg = el('span', 'h2h-a')
    aSeg.style.flexGrow = String(decided ? h.aAhead : 1)
    const bSeg = el('span', 'h2h-b')
    bSeg.style.flexGrow = String(decided ? h.bAhead : 1)
    mount(bar, aSeg, bSeg)
    const line = (label, left, right) => mount(el('div', 'h2h-line'), el('span', 'muted', label),
      mount(el('span', 'h2h-vals'), left, right))
    const who = (name, node) => mount(el('span', 'h2h-who'), el('span', 'muted', `${name} `), node)
    mount(block, top, bar,
      line('Finished ahead', who(a, el('strong', null, h.aAhead)), who(b, el('strong', null, h.bAhead))),
      line('Net in these games', who(a, money(h.aNetCents, state.currency, true)), who(b, money(h.bNetCents, state.currency, true))))
    list.appendChild(block)
  }
  card.appendChild(list)
  if (rivals.length > state.rivalsShown) {
    card.appendChild(button(`Show ${Math.min(4, rivals.length - state.rivalsShown)} more`,
      () => { state.rivalsShown += 4; redraw() }, 'btn-more'))
  }
  return card
}

// ---------- months ----------

function monthsCard(r, cur) {
  const m = r.months
  if (!m || m.rows.length < 2) return null
  const card = el('section', 'card')
  card.appendChild(cardHead('calendar', 'Monthly highs & lows', 'The total result in each calendar month'))
  const two = el('div', 'ins-two')
  const side = (label, row) => mount(el('div'), el('p', 'ins-mini', label), el('p', 'ins-month', row.label), money(row.netCents, cur, true))
  mount(two, side('Best month', m.best), side('Worst month', m.worst))
  card.appendChild(two)

  // Every month as a bar either side of zero.
  const most = Math.max(...m.rows.map((x) => Math.abs(x.netCents))) || 1
  const bars = el('div', 'month-bars')
  bars.setAttribute('role', 'img')
  bars.setAttribute('aria-label', m.rows.map((x) => `${x.label} ${formatMoney(x.netCents, cur, true)}`).join(', '))
  for (const row of m.rows) {
    const col = el('div', 'month-col')
    const up = el('div', 'month-half month-up')
    const down = el('div', 'month-half month-down')
    const bar = el('span', `month-bar ${row.netCents >= 0 ? 'month-bar-up' : 'month-bar-down'}`)
    bar.style.height = `${Math.max(2, (Math.abs(row.netCents) / most) * 100)}%`
    ;(row.netCents >= 0 ? up : down).appendChild(bar)
    mount(col, up, down, el('span', 'month-label', row.label.slice(0, 3)))
    bars.appendChild(col)
  }
  card.appendChild(bars)
  return card
}

// ---------- time ----------

function timeCard(r, cur) {
  const t = r.time
  if (!t) return null
  const card = el('section', 'card')
  const skipped = r.games - t.games
  card.appendChild(cardHead('clock', 'Time at the table',
    `Based on ${t.games} ${t.games === 1 ? 'game' : 'games'} with a recorded length`
      + (skipped ? ` · ${skipped} left open too long to count` : '')))
  const pace = el('p', 'ins-pace')
  mount(pace, money(t.perHourCents, cur, true), el('span', null, ' per hour'))
  mount(card, el('p', 'ins-mini', 'Average pace'), pace,
    el('p', 'tile-sub', `Across ${Math.round(t.hours)} recorded hours · typical game ${hoursLabel(t.avgHours)}`))
  return card
}

// ---------- profit trend ----------

function trendCard(r, cur, state, redraw) {
  const card = el('section', 'card')
  card.appendChild(cardHead('chart', 'Profit trend'))
  const views = el('div', 'seg')
  for (const [key, label] of [['session', 'Game'], ['month', 'Month'], ['year', 'Year']]) {
    const b = button(label, () => { state.view = key; redraw() }, `seg-btn${state.view === key ? ' seg-on' : ''}`)
    b.setAttribute('aria-pressed', String(state.view === key))
    views.appendChild(b)
  }
  const sum = el('div', 'ins-trend-sum')
  mount(sum, money(r.netCents, cur, true),
    el('span', 'muted', ` ${r.wins} ${r.wins === 1 ? 'win' : 'wins'} – ${r.losses} ${r.losses === 1 ? 'loss' : 'losses'}`))
  const range = el('p', 'tile-sub',
    `${r.games} ${r.games === 1 ? 'game' : 'games'} · ${shortDate(r.trend[0].playedOn)} – ${shortDate(r.trend.at(-1).playedOn)}`)
  mount(card, el('p', 'ins-mini', 'View by'), views, sum, range)

  const points = trendBy(r.trend, state.view)
  if (points.length < 2) {
    const what = state.view === 'year' ? 'year' : state.view === 'month' ? 'month' : 'game'
    card.appendChild(el('p', 'muted small', `Only one ${what} so far. The line starts with the second.`))
    return card
  }
  const unit = state.view === 'session' ? 'Game' : state.view === 'month' ? 'Month' : 'Year'
  card.appendChild(lineChart({
    currency: cur,
    labels: points.map((p) => axisDate(p.playedOn, state.view)),
    series: [{ name: 'Total', values: points.map((p) => p.runningCents), tone: points.at(-1).runningCents >= 0 ? 'up' : 'down' }],
    tip: (i) => {
      const p = points[i]
      return [
        el('strong', null, p.gameName),
        el('span', 'muted', state.view === 'session' ? shortDate(p.playedOn) : `${p.games} ${p.games === 1 ? 'game' : 'games'}`),
        tipLine(`${unit}:`, money(p.netCents, cur, true)),
        tipLine('Total:', money(p.runningCents, cur, true)),
      ]
    },
    describe: `Running total over ${points.length} points, ending at ${formatMoney(points.at(-1).runningCents, cur, true)}`,
  }))
  card.appendChild(el('p', 'chart-hint', 'Touch or drag for exact results'))
  return card
}

const tipLine = (label, node) => mount(el('span', 'chart-tip-line'), el('span', 'muted', `${label} `), node)

const AXIS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function axisDate(playedOn, view) {
  if (view === 'year') return playedOn.slice(0, 4)
  const m = AXIS_MONTHS[Number(playedOn.slice(5, 7)) - 1]
  return view === 'month' ? m : `${Number(playedOn.slice(8, 10))} ${m}`
}

// ---------- deep dive ----------

function deepDive(r, cur, you) {
  const d = r.deepDive
  const card = el('section', 'card')
  card.appendChild(cardHead('gauge', 'Player deep dive', 'Three takeaways from this period'))
  const item = (label, value, text) => mount(el('div', 'deep-item'), el('p', 'deep-label', label), value, el('p', 'deep-text', text))

  card.appendChild(item('Typical result', mount(el('p', 'deep-value'), money(d.typicalCents, cur, true)),
    'Half of these games finished above this amount and half below.'))

  const v = el('p', 'deep-value')
  mount(v, d.avgWinCents !== null ? money(d.avgWinCents, cur, true) : el('span', 'muted', 'no wins'),
    el('span', 'muted', ' vs '),
    d.avgLossCents !== null ? money(d.avgLossCents, cur, true) : el('span', 'muted', 'no losses'))
  const w = d.avgWinCents ?? 0
  const l = -(d.avgLossCents ?? 0)
  const whose = you ? 'your' : 'their'
  const text = d.avgWinCents === null ? 'No winning games yet in this period.'
    : d.avgLossCents === null ? 'No losing games yet in this period.'
      : l > w ? `On average, ${whose} losses are bigger than ${whose} wins.`
        : w > l ? `On average, ${whose} wins are bigger than ${whose} losses.`
          : `On average, ${whose} wins and losses are the same size.`
  card.appendChild(item('Average win vs average loss', v, text))

  const l5 = d.last5
  card.appendChild(item('Recent form', mount(el('p', 'deep-value'), money(l5.netCents, cur, true)),
    `Last ${l5.games}: ${l5.wins} ${l5.wins === 1 ? 'win' : 'wins'}, ${l5.losses} ${l5.losses === 1 ? 'loss' : 'losses'}.`))
  return card
}

// ---------- recent games ----------

function recentCard(r, cur, state, redraw) {
  const card = el('section', 'card')
  card.appendChild(cardHead('trophy', 'Recent games'))
  const list = el('div', 'recent-list')
  for (const n of r.recent.slice(0, state.recentShown)) {
    const row = el('div', 'recent-row')
    const tone = n.netCents > 0 ? 'up' : n.netCents < 0 ? 'down' : 'flat'
    mount(row,
      glyph(n.netCents >= 0 ? 'up' : 'down', `recent-arrow recent-${tone}`),
      mount(el('div', 'recent-main'), el('p', 'recent-name', n.gameName), el('p', 'recent-date', shortDate(n.playedOn))),
      money(n.netCents, cur, true))
    list.appendChild(row)
  }
  card.appendChild(list)
  const left = r.recent.length - state.recentShown
  if (left > 0) card.appendChild(button(`Show ${Math.min(5, left)} more`, () => { state.recentShown += 5; redraw() }, 'btn-more'))
  return card
}

// ---------- the standings tab ----------

function standingsTab(nights, state, season, personOf, redraw) {
  const rows = standingsFor(nights.filter((n) => n.currency === state.currency), season)
  const board = el('section', 'card')
  const head = el('div', 'ins-row-head')
  mount(head, mount(el('div'), el('p', 'ins-mini', `Leaders · ${season.label}`), el('h2', 'ins-h2', 'Leaderboard')),
    el('span', 'ins-row-note', `${rows.length} ${rows.length === 1 ? 'player' : 'players'}`))
  board.appendChild(head)

  const table = el('div', 'lb')
  table.appendChild(mount(el('div', 'lb-row lb-head'), el('span', null, 'Player'), el('span', 'lb-num', 'Games'), el('span', 'lb-num', 'Profit')))
  rows.slice(0, state.boardShown).forEach((row, i) => {
    const line = el('div', 'lb-row')
    const who = el('span', 'lb-who')
    mount(who, el('span', 'lb-rank', String(i + 1)), monogram(personOf(row.playerId), 'mono-sm'),
      el('span', 'lb-name', row.playerName), row.isSelf ? el('span', 'lb-me', 'Me') : null)
    mount(line, who, el('span', 'lb-num', String(row.games)), money(row.netCents, row.currency, true))
    table.appendChild(line)
  })
  board.appendChild(table)
  if (rows.length > state.boardShown) {
    board.appendChild(button(`Show ${rows.length - state.boardShown} more`, () => { state.boardShown = rows.length; redraw() }, 'btn-more'))
  }

  // The comparison: the host plus the two leaders, until the host picks others.
  const ids = new Set(rows.map((x) => x.playerId))
  if (!state.compare || state.compare.some((id) => !ids.has(id))) {
    const self = rows.find((x) => x.isSelf)
    state.compare = [...new Set([...(self ? [self.playerId] : []), ...rows.map((x) => x.playerId)])].slice(0, 3)
  }
  const cmp = el('section', 'card')
  mount(cmp, el('h2', 'ins-h2', 'Performance comparison'),
    el('p', 'ins-card-sub', 'Pick players and see how their results moved over time.'))
  const names = state.compare.map((id) => rows.find((x) => x.playerId === id)?.playerName ?? '?')
  const picker = el('div', 'ins-inner cmp-pick')
  mount(picker,
    mount(el('div'), el('p', 'ins-label ins-label-plain', 'Players in chart'), el('p', 'tile-sub', names.join(', '))),
    button('Edit', () => editCompare(rows, state, redraw), 'btn-inline btn-edit'))
  cmp.appendChild(picker)

  const data = comparisonSeries(nights, state.compare, state.currency, season)
  if (data.games.length < 2) {
    cmp.appendChild(el('p', 'muted small', 'The chart starts once there are two finished games.'))
  } else {
    const legend = el('div', 'cmp-legend')
    data.series.forEach((s, i) => legend.appendChild(mount(el('span', 'cmp-key'), el('span', `cmp-swatch series-${i + 1}`), el('span', null, s.name))))
    cmp.appendChild(legend)
    cmp.appendChild(lineChart({
      currency: state.currency,
      labels: data.games.map((g) => axisDate(g.playedOn, 'session')),
      series: data.series.map((s, i) => ({ name: s.name, values: s.values, tone: `series-${i + 1}` })),
      tip: (i) => [
        el('strong', null, data.games[i].gameName),
        el('span', 'muted', shortDate(data.games[i].playedOn)),
        ...data.series.map((s, k) => mount(el('span', 'chart-tip-line'), el('span', `cmp-swatch series-${k + 1}`),
          el('span', null, ` ${s.name} `), money(s.values[i], state.currency, true))),
      ],
      describe: `Running totals for ${names.join(', ')} over ${data.games.length} games`,
    }))
    cmp.appendChild(el('p', 'chart-hint', 'Touch or drag for exact results'))
  }
  return [board, cmp]
}

/** Up to five players in the comparison. A sheet of checkboxes; changes apply as you tick. */
function editCompare(rows, state, redraw) {
  const body = el('div', 'sheet-body stack-tight')
  const note = el('p', 'muted small', 'Up to five players.')
  body.appendChild(note)
  for (const row of rows) {
    const label = el('label', 'check-row')
    const box = el('input')
    box.type = 'checkbox'
    box.checked = state.compare.includes(row.playerId)
    box.addEventListener('change', () => {
      const next = box.checked ? [...state.compare, row.playerId] : state.compare.filter((id) => id !== row.playerId)
      if (next.length === 0 || next.length > 5) {
        box.checked = !box.checked
        note.textContent = next.length === 0 ? 'Keep at least one player.' : 'Up to five players.'
        return
      }
      state.compare = next
      redraw()
    })
    mount(label, box, el('span', null, row.playerName + (row.isSelf ? ' (You)' : '')))
    body.appendChild(label)
  }
  sheet('Players in chart', body)
}

// ---------- the line chart ----------

/**
 * A smooth line chart in SVG, redrawn at its real width so labels stay 11px on any screen.
 * Touch or drag picks the nearest game; arrow keys do the same from a keyboard.
 *
 * The curve is monotone (Fritsch-Carlson): it bends between points but never overshoots
 * them, so a smooth line can not show a high or low that never happened.
 */
function lineChart({ currency, labels, series, tip, describe }) {
  const box = el('div', 'chart')
  const tipBox = el('div', 'chart-tip')
  tipBox.hidden = true
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'chart-svg')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', describe)
  svg.setAttribute('tabindex', '0')
  mount(box, svg, tipBox)

  const H = 200
  const PAD = { l: 46, r: 10, t: 12, b: 26 }
  const all = series.flatMap((s) => s.values)
  const ticks = niceTicks(Math.min(...all), Math.max(...all))
  const lo = ticks[0]
  const hi = ticks.at(-1)
  const n = labels.length
  let width = 320
  let picked = null

  const x = (i) => PAD.l + (i * (width - PAD.l - PAD.r)) / (n - 1)
  const y = (v) => PAD.t + ((hi - v) * (H - PAD.t - PAD.b)) / (hi - lo || 1)
  const node = (tag, attrs) => {
    const e = document.createElementNS(SVG, tag)
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
    svg.appendChild(e)
    return e
  }

  const draw = () => {
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    svg.setAttribute('viewBox', `0 0 ${width} ${H}`)
    for (const t of ticks) {
      node('line', { x1: PAD.l, x2: width - PAD.r, y1: y(t), y2: y(t), class: t === 0 ? 'chart-zero' : 'chart-grid' })
      node('text', { x: PAD.l - 6, y: y(t) + 4, class: 'chart-axis', 'text-anchor': 'end' }).textContent = compactMoney(t, currency)
    }
    // At most five date labels, evenly spread, always the first and the last.
    const every = Math.max(1, Math.ceil((n - 1) / 4))
    labels.forEach((label, i) => {
      if (i !== n - 1 && (i % every !== 0 || n - 1 - i < every / 2)) return
      node('text', { x: x(i), y: H - 6, class: 'chart-axis', 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }).textContent = label
    })
    for (const s of series) {
      const pts = s.values.map((v, i) => [x(i), y(v)])
      if (series.length === 1) {
        node('path', { d: `${smooth(pts)} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`, class: `chart-area chart-${s.tone}` })
      }
      node('path', { d: smooth(pts), class: `chart-line chart-${s.tone}` })
    }
    if (picked !== null) {
      node('line', { x1: x(picked), x2: x(picked), y1: PAD.t, y2: H - PAD.b, class: 'chart-guide' })
      for (const s of series) node('circle', { cx: x(picked), cy: y(s.values[picked]), r: 4.5, class: `chart-dot chart-${s.tone}` })
      clear(tipBox)
      mount(tipBox, ...tip(picked))
      tipBox.hidden = false
      // Beside the point, flipped to its left on the right half so it never runs off the card.
      const left = x(picked)
      tipBox.style.left = left > width / 2 ? '' : `${left + 10}px`
      tipBox.style.right = left > width / 2 ? `${width - left + 10}px` : ''
    } else {
      tipBox.hidden = true
    }
  }

  const pickAt = (clientX) => {
    const rect = svg.getBoundingClientRect()
    const rel = ((clientX - rect.left) / rect.width) * width
    picked = Math.max(0, Math.min(n - 1, Math.round(((rel - PAD.l) / (width - PAD.l - PAD.r)) * (n - 1))))
    draw()
  }
  let dragging = false
  svg.addEventListener('pointerdown', (e) => { dragging = true; svg.setPointerCapture?.(e.pointerId); pickAt(e.clientX) })
  svg.addEventListener('pointermove', (e) => { if (dragging) pickAt(e.clientX) })
  svg.addEventListener('pointerup', () => { dragging = false })
  svg.addEventListener('pointercancel', () => { dragging = false })
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    picked = picked === null ? n - 1 : Math.max(0, Math.min(n - 1, picked + (e.key === 'ArrowRight' ? 1 : -1)))
    draw()
  })

  // Measured, not assumed: redraw whenever the card changes width (rotation, desktop).
  new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width)
    if (w > 0 && w !== width) { width = w; draw() }
  }).observe(box)
  draw()
  return box
}

/** A monotone cubic through the points (Fritsch-Carlson), as an SVG path. */
function smooth(pts) {
  const n = pts.length
  if (n < 2) return ''
  const dx = []
  const m = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0])
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i])
  }
  const t = [m[0]]
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2)
  t.push(m[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i]
    const b = t[i + 1] / m[i]
    const s = a * a + b * b
    if (s > 9) {
      const k = 3 / Math.sqrt(s)
      t[i] = k * a * m[i]
      t[i + 1] = k * b * m[i]
    }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += ` C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)}`
      + ` ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)}`
      + ` ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`
  }
  return d
}
