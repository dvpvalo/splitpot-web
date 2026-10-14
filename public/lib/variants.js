// Dealer's choice: the games a group plays and the rules people argue about. Port of
// data/Variants.kt, line for line - the default list and every rule wording are identical.
//
// The list lives on the device (lib/tools.js), like the clock and the dealer button: it is
// about the room, it has to work with no signal, and the ledger page never needs it.
// A game is { name, rules }, rules being plain text with one rule per line.

export const NAME_MAX = 30
export const RULES_MAX = 2000

export const DEFAULT_GAMES = [
  { name: "Hold'em", rules: [
    'Two cards each. Make your best five from your two and the five on the board, using both, one or neither.',
    'Betting before the flop, after the flop (three cards), after the turn and after the river.',
    'Best to worst: royal flush, straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, pair, high card.',
    'An ace plays high or low in a straight (A-2-3-4-5), but straights never wrap round (Q-K-A-2-3 is nothing).',
    'Suits never break a tie. Equal hands split the pot.',
  ].join('\n') },
  { name: 'PLO', rules: [
    'Four cards each. You must use exactly two of them and exactly three from the board.',
    'One spade in your hand with four on the board is NOT a flush. You need two of the suit in your hand.',
    'Four to a straight on the board still needs two cards from your hand to finish it.',
    'Pot limit: the biggest bet is the pot after you call. Pot 100 and someone bets 20: call 20 (now 140 in the middle), so you can make it 160 in total.',
    'Ranks and ties as in Hold\'em.',
  ].join('\n') },
  { name: 'PLO5', rules: [
    'Five cards each. Still exactly two from your hand and exactly three from the board.',
    'Pot limit, same raise rule as PLO.',
    'Everything else as PLO. With six cards each it is PLO6, same rules again.',
  ].join('\n') },
  { name: 'Omaha hi-lo', rules: [
    'Four cards each. The pot is split: half to the best high hand, half to the best low hand.',
    'For each half, use exactly two from your hand and three from the board. You may use different cards for high and low.',
    'A low is five different cards, eight or lower. Aces count low, and straights and flushes do not spoil a low. The best low is A-2-3-4-5.',
    'Compare lows from the top card down: 7-5-4-3-2 beats 7-6-3-2-A.',
    'If the board has fewer than three different cards eight or lower, nobody has a low and the high hand takes the whole pot.',
    'Two equal lows share the low half. An odd chip goes to the high half.',
  ].join('\n') },
  { name: 'Big O', rules: [
    'Five cards each, played as Omaha hi-lo: half to the best high, half to the best low (eight or better).',
    'For each half, exactly two from your hand and exactly three from the board.',
    'Usually pot limit, same raise rule as PLO.',
  ].join('\n') },
  { name: 'Stud hi-lo', rules: [
    'Everyone antes. Two cards down and one up each. The lowest up card must open with a small forced bet (the bring-in).',
    'Then three more up cards and a last one down, with a betting round after each: seven cards, five rounds.',
    'From the fourth card on, the best hand showing acts first.',
    'Your best five of seven for high and, separately, for low (eight or better). The pot splits as in Omaha hi-lo.',
  ].join('\n') },
  { name: 'Pineapple', rules: [
    'Three cards each. Throw one away before the flop, then it plays exactly like Hold\'em.',
    'Agree first whether the discard comes before or after the betting on the first two cards.',
  ].join('\n') },
  { name: 'Crazy Pineapple', rules: [
    'Three cards each. Bet before the flop holding all three.',
    'Throw one away after the betting on the flop. From the turn on it plays exactly like Hold\'em.',
    'Lazy Pineapple, if you play it: keep all three until the showdown, then use two.',
  ].join('\n') },
  // House games: every group plays these its own way, so the rules are the host's to write.
  { name: '3 Patti poker', rules: '' },
  { name: 'Fruits', rules: '' },
  { name: 'Saddam', rules: '' },
]

/** The stored list, or the defaults when nothing usable is stored. An empty list is a choice. */
export function parseGames(raw) {
  if (raw == null) return DEFAULT_GAMES
  try {
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return DEFAULT_GAMES
    return list
      .filter((g) => g && typeof g.name === 'string' && g.name.trim())
      .map((g) => ({ name: g.name.trim(), rules: typeof g.rules === 'string' ? g.rules : '' }))
  } catch {
    return DEFAULT_GAMES
  }
}

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Saves [game] in the place of [original] (null for a new one, which goes at the end). A rename
 * onto another game's name replaces that one too, so a name is never on the list twice.
 */
export function upsertGame(list, original, game) {
  const clean = { name: game.name.trim().slice(0, NAME_MAX), rules: game.rules.slice(0, RULES_MAX) }
  const at = original == null ? -1 : list.findIndex((g) => same(g.name, original))
  const out = []
  list.forEach((g, i) => {
    if (i === at) out.push(clean)
    else if (!same(g.name, clean.name)) out.push(g)
  })
  if (at === -1) out.push(clean)
  return out
}

export const removeGame = (list, name) => list.filter((g) => !same(g.name, name))

/** A random game, never the one being played when there is any other. */
export function spinPick(names, current, rand = Math.random) {
  if (names.length === 0) return null
  const pool = names.length > 1 ? names.filter((n) => n !== current) : names
  return pool[Math.min(Math.floor(rand() * pool.length), pool.length - 1)]
}

/** One rule per non-blank line; a typed "-" or "•" bullet is dropped, the sheet draws its own. */
export const ruleLines = (text) => text.split('\n')
  .map((l) => l.trim().replace(/^[-•*]\s*/, ''))
  .filter(Boolean)
