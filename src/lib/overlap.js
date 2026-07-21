/** Conflict detection (SPEC sect. 4.1). */

import { toMinutes } from './time.js'

export function overlaps(a, b) {
  if (a.day !== b.day) return false
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end)
}

/**
 * Is `maybeAncestor` somewhere up `session`'s parent chain?
 * Guards against cycles in malformed data rather than trusting the file.
 */
export function isAncestor(maybeAncestor, session, byId) {
  const seen = new Set()
  let current = session
  while (current?.parentId) {
    if (seen.has(current.parentId)) return false // cycle
    seen.add(current.parentId)
    if (current.parentId === maybeAncestor.id) return true
    current = byId.get(current.parentId)
  }
  return false
}

/** Two sessions related by containment never conflict — a talk inside a block
 *  is not a clash with the block (SPEC sect. 4.1). */
export function isRelated(a, b, byId) {
  return isAncestor(a, b, byId) || isAncestor(b, a, byId)
}

/**
 * -> Map<sessionId, Set<sessionId>> of mutual conflicts among the given sessions.
 * Sessions not in conflict are absent from the map.
 */
export function findConflicts(sessions, byId = new Map(sessions.map((s) => [s.id, s]))) {
  const conflicts = new Map()
  const byDay = new Map()
  for (const s of sessions) {
    if (!byDay.has(s.day)) byDay.set(s.day, [])
    byDay.get(s.day).push(s)
  }

  for (const daySessions of byDay.values()) {
    const sorted = [...daySessions].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        // Sorted by start, so once a start is past i's end nothing later overlaps i.
        if (toMinutes(sorted[j].start) >= toMinutes(sorted[i].end)) break
        if (isRelated(sorted[i], sorted[j], byId)) continue
        add(conflicts, sorted[i].id, sorted[j].id)
        add(conflicts, sorted[j].id, sorted[i].id)
      }
    }
  }
  return conflicts
}

function add(map, key, value) {
  if (!map.has(key)) map.set(key, new Set())
  map.get(key).add(value)
}
