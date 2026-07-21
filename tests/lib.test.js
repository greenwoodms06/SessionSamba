import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { toMinutes, zonedToUtcMs, toIcsUtc, formatTime } from '../src/lib/time.js'
import { overlaps, findConflicts, isAncestor } from '../src/lib/overlap.js'
import { layout } from '../src/lib/timeline.js'
import { buildIcs, escapeText, foldLine, unfold } from '../src/lib/ics.js'
import {
  buildShareFile, resolveShareFile, buildResolver, matchExistingColumn, applyOverwrite,
} from '../src/lib/share.js'
import {
  newJournal, addPick, removePick, updatePick, detectChanges,
  acknowledgeChange, acknowledgeAll, canAttend, makeSnapshot,
} from '../src/lib/journal.js'

const sessions = JSON.parse(readFileSync(new URL('../public/data/siggraph-2026/sessions.json', import.meta.url)))
const config = JSON.parse(readFileSync(new URL('../public/data/siggraph-2026/config.json', import.meta.url)))
const byId = new Map(sessions.map((s) => [s.id, s]))

// --------------------------------------------------------------------------
// The real dataset — these guard the importer's output, not just the lib.
// --------------------------------------------------------------------------

test('dataset: shape and invariants', () => {
  assert.equal(sessions.length, 487)
  assert.equal(new Set(sessions.map((s) => s.id)).size, 487, 'ids must be unique')

  for (const s of sessions) {
    assert.ok(s.id && s.day && s.start && s.end && s.title, `complete: ${s.id}`)
    assert.match(s.start, /^\d{2}:\d{2}$/)
    assert.match(s.end, /^\d{2}:\d{2}$/)
    assert.ok(Array.isArray(s.tracks) && s.tracks.length, `tracks non-empty: ${s.id}`)
    assert.ok(toMinutes(s.end) > toMinutes(s.start), `positive duration: ${s.id}`)
    assert.ok(config.days.some((d) => d.key === s.day), `known day: ${s.id}`)
    for (const a of s.access ?? []) {
      assert.ok(config.accessLevels.some((l) => l.id === a), `known access tier: ${a}`)
    }
  }
})

test('dataset: all five days present, including implicit Sunday and Thursday', () => {
  const counts = {}
  for (const s of sessions) counts[s.day] = (counts[s.day] ?? 0) + 1
  assert.deepEqual(counts, {
    '2026-07-19': 61,  // implicit — no banner row in the source
    '2026-07-20': 108,
    '2026-07-21': 123,
    '2026-07-22': 121,
    '2026-07-23': 74,  // out of the original brief's scope, deliberately included
  })
})

test('dataset: urls extracted to their own fields and remain absolute', () => {
  const withUrl = sessions.filter((s) => s.url)
  assert.equal(withUrl.length, 401)
  for (const s of withUrl) assert.match(s.url, /^https:\/\//)

  const contributorUrls = sessions.flatMap((s) => s.contributors ?? []).filter((c) => c.url)
  assert.ok(contributorUrls.length > 300)
  for (const c of contributorUrls) assert.match(c.url, /^https:\/\//)

  // Session links and contributor links are different kinds and must not be conflated.
  assert.ok(withUrl.some((s) => s.url.includes('sess=')))
  assert.ok(contributorUrls.every((c) => c.url.includes('uid=')))
})

test('dataset: cross-listed sessions kept every track', () => {
  const multi = sessions.filter((s) => s.tracks.length > 1)
  assert.equal(multi.length, 18)
  const etech = multi.filter((s) => s.tracks.includes('Emerging Technologies') && s.tracks.includes('Technical Paper'))
  assert.equal(etech.length, 11)
})

// --------------------------------------------------------------------------
// time
// --------------------------------------------------------------------------

test('time: minute conversion and formatting', () => {
  assert.equal(toMinutes('00:00'), 0)
  assert.equal(toMinutes('14:30'), 870)
  assert.equal(formatTime('00:00'), '12:00 AM')
  assert.equal(formatTime('12:00'), '12:00 PM')
  assert.equal(formatTime('14:05'), '2:05 PM')
})

test('time: wall clock in conference zone -> correct UTC instant', () => {
  // July in Los Angeles is PDT (UTC-7): 14:00 local == 21:00Z.
  const ms = zonedToUtcMs('2026-07-21', '14:00', 'America/Los_Angeles')
  assert.equal(toIcsUtc(ms), '20260721T210000Z')

  // January is PST (UTC-8) — the DST correction pass must handle both.
  assert.equal(
    toIcsUtc(zonedToUtcMs('2026-01-21', '14:00', 'America/Los_Angeles')),
    '20260121T220000Z',
  )
  // Midnight, where a naive `hour: 24` would break the offset calculation.
  assert.equal(
    toIcsUtc(zonedToUtcMs('2026-07-21', '00:00', 'America/Los_Angeles')),
    '20260721T070000Z',
  )
})

// --------------------------------------------------------------------------
// overlap / conflicts
// --------------------------------------------------------------------------

const A = { id: 'a', day: 'd1', start: '09:00', end: '10:00' }
const B = { id: 'b', day: 'd1', start: '09:30', end: '10:30' }
const C = { id: 'c', day: 'd1', start: '10:00', end: '11:00' }
const D = { id: 'd', day: 'd2', start: '09:30', end: '10:30' }

test('overlap: touching intervals do not conflict', () => {
  assert.equal(overlaps(A, B), true)
  assert.equal(overlaps(A, C), false, 'end == start is adjacency, not overlap')
  assert.equal(overlaps(A, D), false, 'different days never conflict')
})

test('overlap: findConflicts is symmetric and excludes non-overlapping', () => {
  const conflicts = findConflicts([A, B, C, D])
  assert.deepEqual([...conflicts.get('a')], ['b'])
  assert.deepEqual([...conflicts.get('b')].sort(), ['a', 'c'])
  assert.equal(conflicts.has('d'), false)
})

test('overlap: a child never conflicts with its own parent', () => {
  const parent = { id: 'block', day: 'd1', start: '09:00', end: '12:15' }
  const child = { id: 'talk', day: 'd1', start: '09:20', end: '09:40', parentId: 'block' }
  const other = { id: 'other', day: 'd1', start: '09:30', end: '10:00' }
  const index = new Map([parent, child, other].map((s) => [s.id, s]))

  assert.equal(isAncestor(parent, child, index), true)
  assert.equal(isAncestor(child, parent, index), false)

  const conflicts = findConflicts([parent, child, other], index)
  assert.equal(conflicts.get('block').has('talk'), false, 'parent does not clash with its child')
  assert.equal(conflicts.get('talk').has('block'), false, 'and the relation is symmetric')
  assert.equal(conflicts.get('block').has('other'), true, 'but unrelated overlap still conflicts')
  assert.equal(conflicts.get('talk').has('other'), true)
})

test('overlap: cyclic parentId does not hang', () => {
  const x = { id: 'x', day: 'd1', start: '09:00', end: '10:00', parentId: 'y' }
  const y = { id: 'y', day: 'd1', start: '09:00', end: '10:00', parentId: 'x' }
  const index = new Map([[x.id, x], [y.id, y]])
  assert.equal(isAncestor(x, y, index), true)
  assert.doesNotThrow(() => findConflicts([x, y], index))
})

test('overlap: real data — Tuesday peak concurrency is 36', () => {
  const tuesday = sessions.filter((s) => s.day === '2026-07-21')
  let peak = 0
  for (let m = 6 * 60; m < 23 * 60; m += 5) {
    const n = tuesday.filter((s) => toMinutes(s.start) <= m && m < toMinutes(s.end)).length
    peak = Math.max(peak, n)
  }
  assert.equal(peak, 36)
})

test('timeline: lanes never double-book a lane within a column', () => {
  const L = layout([{ key: 'k', label: 'K', color: '#000', items: [A, B, C] }])
  const laneOf = (id) => L.columns[0].blocks.find((b) => b.item.id === id).lane
  assert.notEqual(laneOf('a'), laneOf('b'), 'overlapping sessions get distinct lanes')
  assert.equal(laneOf('a'), laneOf('c'), 'non-overlapping sessions reuse a lane')
})

// --------------------------------------------------------------------------
// ics
// --------------------------------------------------------------------------

test('ics: escaping follows RFC 5545 order', () => {
  assert.equal(escapeText('a,b;c'), 'a\\,b\\;c')
  assert.equal(escapeText('line1\nline2'), 'line1\\nline2')
  assert.equal(escapeText('back\\slash'), 'back\\\\slash')
})

test('ics: folding respects the 75-octet limit and multi-byte chars', () => {
  const folded = foldLine('X'.repeat(200))
  for (const line of folded.split('\r\n')) {
    assert.ok(new TextEncoder().encode(line).length <= 75)
  }
  // An emoji must not be split across a fold boundary.
  const emoji = foldLine('é'.repeat(100))
  assert.ok(emoji.split('\r\n').every((l) => !l.includes('�')))
})

test('ics: UID is the stable session id, which is what prevents duplicates', () => {
  const picked = sessions.slice(0, 3)
  const ics = buildIcs(picked, config, { now: new Date('2026-07-20T00:00:00Z') })

  assert.match(ics, /^BEGIN:VCALENDAR\r\n/)
  assert.match(ics, /END:VCALENDAR\r\n$/)
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 3)

  // Session ids are long, so UID lines fold. Unfold before inspecting.
  const flat = unfold(ics)
  for (const s of picked) {
    assert.ok(flat.includes(`UID:${s.id}@${config.conferenceId}`), `uid for ${s.id}`)
  }

  // Re-exporting the same picks yields identical UIDs -> calendar updates, not duplicates.
  const again = buildIcs(picked, config, { now: new Date('2026-07-25T00:00:00Z'), sequence: 1 })
  const uids = (text) => [...unfold(text).matchAll(/UID:(.+)\r\n/g)].map((m) => m[1])
  assert.deepEqual(uids(ics), uids(again))
  assert.ok(again.includes('SEQUENCE:1'))
})

test('ics: notes ride into DESCRIPTION so calendar acts as a backup', () => {
  const session = sessions[0]
  const picks = new Map([[session.id, { notes: 'Sit near the front' }]])
  const ics = buildIcs([session], config, { picks, now: new Date('2026-07-20T00:00:00Z') })
  assert.ok(unfold(ics).includes('Sit near the front'))
})

test('ics: fold/unfold round-trips', () => {
  const long = 'UID:' + 'x'.repeat(300)
  assert.equal(unfold(foldLine(long)), long)
})

test('ics: every line is CRLF-terminated and none exceeds 75 octets', () => {
  const ics = buildIcs(sessions.slice(0, 50), config, { now: new Date('2026-07-20T00:00:00Z') })
  assert.ok(!/[^\r]\n/.test(ics), 'no bare LF')
  for (const line of ics.split('\r\n')) {
    assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line.slice(0, 40)}`)
  }
})

// --------------------------------------------------------------------------
// journal
// --------------------------------------------------------------------------

test('journal: picks add, dedupe and remove', () => {
  let j = newJournal('siggraph-2026', 'Me')
  assert.ok(j.sender.id)

  j = addPick(j, sessions[0], config.dataVersion)
  j = addPick(j, sessions[0], config.dataVersion)
  assert.equal(j.picks.length, 1, 'adding twice is idempotent')

  j = addPick(j, sessions[1], config.dataVersion)
  assert.equal(j.picks.length, 2)

  j = removePick(j, sessions[0].id)
  assert.deepEqual(j.picks.map((p) => p.id), [sessions[1].id])
})

test('journal: change detection reports moves and cancellations, removes nothing', () => {
  let j = newJournal('siggraph-2026')
  j = addPick(j, sessions[0], config.dataVersion)
  j = addPick(j, sessions[1], config.dataVersion)

  // Nothing changed yet.
  assert.equal(detectChanges(j, byId).length, 0)

  // Simulate a retime + room move, and a cancellation.
  const moved = { ...sessions[0], start: '11:30', location: 'Room 999' }
  const shifted = new Map(byId)
  shifted.set(moved.id, moved)
  shifted.delete(sessions[1].id)

  const changes = detectChanges(j, shifted)
  assert.equal(changes.length, 2)

  const change = changes.find((c) => c.kind === 'changed')
  assert.deepEqual(change.changes.map((c) => c.field).sort(), ['location', 'start'])
  assert.equal(change.changes.find((c) => c.field === 'start').to, '11:30')

  const gone = changes.find((c) => c.kind === 'gone')
  assert.equal(gone.id, sessions[1].id)
  assert.equal(gone.session, null)

  // The cancelled pick is still in the journal — never silently dropped.
  assert.equal(j.picks.length, 2)
})

test('journal: acknowledging a change stops it re-flagging', () => {
  let j = newJournal('siggraph-2026')
  j = addPick(j, sessions[0], config.dataVersion)

  const moved = { ...sessions[0], start: '11:30' }
  const shifted = new Map(byId)
  shifted.set(moved.id, moved)

  assert.equal(detectChanges(j, shifted).length, 1)
  j = acknowledgeChange(j, moved.id, moved, '2026-07-21')
  assert.equal(detectChanges(j, shifted).length, 0, 'acknowledged changes must not nag')

  // But a NEW change after acknowledgement is still caught.
  const movedAgain = { ...moved, location: 'Room 123' }
  shifted.set(movedAgain.id, movedAgain)
  assert.equal(detectChanges(j, shifted).length, 1)
})

test('journal: acknowledgeAll skips cancelled sessions safely', () => {
  let j = newJournal('siggraph-2026')
  j = addPick(j, sessions[0], config.dataVersion)
  const changes = [{ id: sessions[0].id, session: null, kind: 'gone', changes: [] }]
  assert.doesNotThrow(() => acknowledgeAll(j, changes, config.dataVersion))
})

test('journal: notes and tags round-trip', () => {
  let j = newJournal('siggraph-2026')
  j = addPick(j, sessions[0], config.dataVersion)
  j = updatePick(j, sessions[0].id, { notes: 'great', rating: 5, tags: ['must-see'] })
  assert.equal(j.picks[0].notes, 'great')
  assert.equal(j.picks[0].rating, 5)
})

test('journal: access tier warns but never blocks', () => {
  const restricted = sessions.find((s) => s.access?.length === 2 && s.access.includes('FCS'))
  assert.equal(canAttend(restricted, 'FCS', config.accessLevels), true)
  assert.equal(canAttend(restricted, 'D', config.accessLevels), false)
  // No tier chosen, or a conference with no tiers at all -> never restrict.
  assert.equal(canAttend(restricted, null, config.accessLevels), true)
  assert.equal(canAttend({ ...restricted, access: [] }, 'D', config.accessLevels), true)
})

// --------------------------------------------------------------------------
// share
// --------------------------------------------------------------------------

function journalWithPicks(ids) {
  let j = newJournal('siggraph-2026', 'Alex')
  for (const id of ids) j = addPick(j, byId.get(id), config.dataVersion)
  return j
}

test('share: export carries bare ids, and never carries x', () => {
  let j = journalWithPicks([sessions[0].id, sessions[1].id])
  j = updatePick(j, sessions[0].id, { notes: 'private thoughts' })
  j.x = { hotel: 'Room 1201', flight: 'UA123' }

  const share = buildShareFile(j, config)
  assert.deepEqual(share.picks, [sessions[0].id, sessions[1].id])
  assert.equal(share.conferenceId, 'siggraph-2026')
  assert.equal(share.dataVersion, config.dataVersion)
  assert.ok(share.sender.id)

  const serialised = JSON.stringify(share)
  assert.ok(!serialised.includes('hotel'), 'x must never be shared')
  assert.ok(!serialised.includes('UA123'))
  assert.ok(!serialised.includes('private thoughts'), 'annotations are opt-in, default off')
  // No denormalised session data — the recipient resolves against their own copy.
  assert.ok(!serialised.includes(sessions[0].title))
})

test('share: annotations are included only on opt-in, and still never x', () => {
  let j = journalWithPicks([sessions[0].id])
  j = updatePick(j, sessions[0].id, { notes: 'sit at the front', rating: 4 })
  j.x = { hotel: 'secret' }

  const share = buildShareFile(j, config, { includeAnnotations: true })
  assert.equal(share.annotations[sessions[0].id].notes, 'sit at the front')
  assert.equal(share.annotations[sessions[0].id].rating, 4)
  assert.ok(!JSON.stringify(share).includes('secret'))
})

test('share: import resolves against local data (retitles fix themselves)', () => {
  const j = journalWithPicks([sessions[0].id, sessions[1].id])
  const share = buildShareFile(j, config)

  // Recipient has a RETITLED version of the same session.
  const retitled = sessions.map((s) =>
    s.id === sessions[0].id ? { ...s, title: 'Completely Different Title' } : s)

  const resolved = resolveShareFile(share, { sessions: retitled, config })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.envelope, 'current')
  assert.equal(resolved.unresolvedCount, 0)
  assert.equal(resolved.entries[0].state, 'resolved')
  assert.equal(resolved.entries[0].session.title, 'Completely Different Title',
    'renders from the recipient data, not the sender snapshot')
})

test('share: a cancelled session is unresolvable, NOT dropped', () => {
  const j = journalWithPicks([sessions[0].id, sessions[1].id])
  const share = buildShareFile(j, config)

  const cancelled = sessions.filter((s) => s.id !== sessions[1].id)
  const resolved = resolveShareFile(share, { sessions: cancelled, config })

  assert.equal(resolved.entries.length, 2, 'the pick is still present')
  assert.equal(resolved.unresolvedCount, 1)
  const ghost = resolved.entries.find((e) => e.state === 'unresolvable')
  assert.equal(ghost.id, sessions[1].id)
  assert.equal(ghost.session, null)
})

test('share: aliases keep old exports resolving after a rename', () => {
  const renamed = sessions.map((s) =>
    s.id === sessions[0].id ? { ...s, id: 'new-id-entirely', aliases: [sessions[0].id] } : s)
  const resolver = buildResolver(renamed)
  assert.equal(resolver.get(sessions[0].id).id, 'new-id-entirely')

  const share = buildShareFile(journalWithPicks([sessions[0].id]), config)
  const resolved = resolveShareFile(share, { sessions: renamed, config })
  assert.equal(resolved.entries[0].state, 'resolved')
})

test('share: an older dataVersion flags the whole column stale', () => {
  const j = journalWithPicks([sessions[0].id])
  const share = { ...buildShareFile(j, config), dataVersion: '2026-06-01' }
  const resolved = resolveShareFile(share, { sessions, config })
  assert.equal(resolved.envelope, 'stale')
  assert.ok(resolved.problems.some((p) => p.kind === 'stale'))
})

test('share: a different conference is rejected, not half-imported', () => {
  const share = buildShareFile(journalWithPicks([sessions[0].id]), config)
  const resolved = resolveShareFile({ ...share, conferenceId: 'siggraph-2025' }, { sessions, config })
  assert.equal(resolved.ok, false)
  assert.equal(resolved.envelope, 'unknown-conference')
  assert.equal(resolved.entries.length, 0)
})

test('share: schema version mismatch is reported', () => {
  const share = { ...buildShareFile(journalWithPicks([sessions[0].id]), config), schemaVersion: 99 }
  const resolved = resolveShareFile(share, { sessions, config })
  assert.ok(resolved.problems.some((p) => p.kind === 'schema-mismatch'))
})

test('share: re-import auto-matches the same sender by stable id', () => {
  const j = journalWithPicks([sessions[0].id])
  const share = buildShareFile(j, config)
  const columns = [{ id: 'col1', sender: j.sender, label: 'Alex', color: '#f00', order: 2 }]

  assert.equal(matchExistingColumn(share, columns).confidence, 'exact')

  // A genuinely different person with the same display name is only a weak match.
  const other = { ...share, sender: { id: 'different-uuid', name: 'Alex' } }
  assert.equal(matchExistingColumn(other, columns).confidence, 'name')

  const stranger = { ...share, sender: { id: 'x', name: 'Sam' } }
  assert.equal(matchExistingColumn(stranger, columns).column, null)
})

test('share: overwrite replaces their data but keeps my presentation', () => {
  const column = {
    id: 'col1', label: 'Alex from Pixar', color: '#7c3aed', order: 3,
    sender: { id: 'u1', name: 'Alex' }, entries: [],
  }
  const resolved = resolveShareFile(buildShareFile(journalWithPicks([sessions[0].id]), config), { sessions, config })
  const next = applyOverwrite(column, resolved)

  assert.equal(next.entries.length, 1, 'their picks replaced')
  assert.equal(next.label, 'Alex from Pixar', 'my label preserved')
  assert.equal(next.color, '#7c3aed', 'my colour preserved')
  assert.equal(next.order, 3, 'my ordering preserved')
})
