/** Shared column-timeline layout. Drives both Browse→Timeline and My day:
 *  the only difference is what a column represents (track / room / person).
 *
 *  Two ideas:
 *   - Gap compression: break the day at every session edge + hour mark; a
 *     segment with no session is either full height or, in compact mode,
 *     collapsed to <=16px. All columns share ONE time→Y map so rows align.
 *   - Lane packing: within a column, greedily place each session in the first
 *     lane whose last end <= its start.
 */

import { toMinutes } from './time.js'

const DEFAULT_PPM = 1.5     // px per minute
const COMPACT_GAP = 16      // px an empty gap collapses to in compact mode
const LANE_MULTI = 140      // lane width when a column has >1 lane
const LANE_SINGLE = 158
const LANE_PAD = 6

/**
 * @param columns [{ key, label, color, tint?, items: [{ id, start, end, ...}] }]
 * @param opts    { ppm, compact }
 * @returns { height, columns: [{ ...column, width, blocks: [{item, lane, x, top, width, height}] }],
 *            gutter: [{ label, top }], laneWidth }
 */
export function layout(columns, opts = {}) {
  const ppm = opts.ppm ?? DEFAULT_PPM
  const compact = !!opts.compact
  const all = columns.flatMap((c) => c.items)
  if (!all.length) return { height: 0, columns: [], gutter: [] }

  const mins = (t) => toMinutes(t)
  const start = Math.floor(Math.min(...all.map((x) => mins(x.start))) / 60) * 60
  const end = Math.ceil(Math.max(...all.map((x) => mins(x.end))) / 60) * 60

  // Breakpoints: every session edge + every hour mark.
  const pts = new Set([start, end])
  for (const x of all) { pts.add(mins(x.start)); pts.add(mins(x.end)) }
  for (let h = start; h <= end; h += 60) pts.add(h)
  const P = [...pts].sort((a, b) => a - b)

  // Segments with their pixel heights, and a cumulative time→Y map.
  const segs = []
  let y = 0
  for (let i = 0; i < P.length - 1; i++) {
    const t0 = P[i]
    const t1 = P[i + 1]
    const dur = t1 - t0
    const covered = all.some((x) => mins(x.start) < t1 && mins(x.end) > t0)
    const h = covered ? dur * ppm : compact ? Math.min(dur * ppm, COMPACT_GAP) : dur * ppm
    segs.push({ t0, t1, y0: y, h })
    y += h
  }
  const Y = (t) => {
    const sg = segs.find((s) => t >= s.t0 && t <= s.t1) ?? segs[segs.length - 1]
    return sg.y0 + ((t - sg.t0) / (sg.t1 - sg.t0)) * sg.h
  }

  // Hour gutter — skip a label if it would sit <26px below the previous.
  const gutter = []
  let lastY = -30
  for (let h = start; h <= end; h += 60) {
    const gy = Y(h)
    if (gy - lastY >= 26) { gutter.push({ minutes: h, top: gy }); lastY = gy }
  }

  const laneWidth = columns.length > 1 ? LANE_MULTI : LANE_SINGLE
  const outColumns = columns.map((col) => {
    const items = [...col.items].sort(
      (a, b) => mins(a.start) - mins(b.start) || mins(b.end) - mins(a.end),
    )
    const laneEnds = []
    const blocks = items.map((item) => {
      let lane = laneEnds.findIndex((e) => e <= mins(item.start))
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(mins(item.end)) }
      else laneEnds[lane] = mins(item.end)
      const top = Y(mins(item.start))
      return {
        item,
        lane,
        x: lane * (laneWidth + LANE_PAD),
        top,
        width: laneWidth,
        height: Y(mins(item.end)) - top,
      }
    })
    const nLanes = Math.max(1, laneEnds.length)
    return { ...col, blocks, width: nLanes * (laneWidth + LANE_PAD) - LANE_PAD }
  })

  return { height: y, columns: outColumns, gutter, laneWidth }
}
