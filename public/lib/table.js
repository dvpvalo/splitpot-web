// Where the seats go round the oval table.
//
// Pure geometry, no DOM, so it is testable and the view only has to apply the numbers.
//
// Seats are spaced by ARC LENGTH, not by angle. Equal angles on a tall ellipse bunch the seats
// at the two ends and leave the long sides empty - on a phone that stacks three players on top
// of each other at the head of the table while the sides sit bare.

/** Room one seat needs on the rail: chip avatar, name plate, net, and a 44px rebuy. */
export const SEAT_W = 104
export const SEAT_H = 142

/**
 * Table size and seat centres for `count` places at a table `width` px wide.
 *
 * The table grows TALLER as seats are added rather than squeezing them together, so a seat's
 * rebuy button never lands on its neighbour's. Returns centres in px from the table's top-left.
 */
export function tableLayout(count, width) {
  const a = Math.max((width - SEAT_W) / 2, 60)
  // Never shorter than the pot in the middle needs. Then grow until no two seats' boxes touch:
  // checking the actual boxes beats a perimeter estimate, which let diagonal neighbours on the
  // curve overlap on a narrow phone.
  let b = Math.max(150, Math.min(a * 1.1, 230))
  let pts = spaced(count, a, b)
  while (collides(pts) && b < 3000) {
    b += 8
    pts = spaced(count, a, b)
  }
  const height = Math.round(2 * b + SEAT_H)
  const cx = width / 2
  const cy = height / 2
  return { width, height, a, b, seats: pts.map(([x, y]) => ({ x: cx + x, y: cy + y })) }
}

function collides(pts) {
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (Math.abs(pts[i][0] - pts[j][0]) < SEAT_W && Math.abs(pts[i][1] - pts[j][1]) < SEAT_H) return true
    }
  }
  return false
}

/** `count` points at equal arc length, starting at the head of the table (top centre). */
function spaced(count, a, b) {
  if (count <= 0) return []
  const steps = 720
  const pts = []
  const cum = [0]
  for (let i = 0; i <= steps; i++) {
    // Start at the top (-90deg) and go clockwise.
    const t = -Math.PI / 2 + (i / steps) * Math.PI * 2
    pts.push([a * Math.cos(t), b * Math.sin(t)])
    if (i > 0) {
      const [px, py] = pts[i - 1]
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - px, pts[i][1] - py))
    }
  }
  const total = cum[steps]
  const out = []
  let j = 0
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total
    while (j < steps && cum[j + 1] < target) j++
    const span = cum[j + 1] - cum[j] || 1
    const f = (target - cum[j]) / span
    out.push([
      pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f,
      pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f,
    ])
  }
  return out
}

/**
 * "2 × ₹100 + ₹50" for the chips tapped onto the pile, biggest first. Empty when nothing was
 * tapped (a typed amount has no chips to describe).
 */
export function pileLabel(values, format) {
  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()]
    .sort((x, y) => y[0] - x[0])
    .map(([v, n]) => (n === 1 ? format(v) : `${n} × ${format(v)}`))
    .join(' + ')
}
