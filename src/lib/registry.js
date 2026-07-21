/** Conference registry. The app is multi-event:
 *  every conference keeps its own schedule, picks and notes, keyed by
 *  conferenceId — switching never touches the others.
 *
 *  Two sources, presented uniformly:
 *   - bundled: shipped in the repo, listed in public/data/index.json
 *   - user:    added by the user (file or URL), cached in IndexedDB so they
 *              keep working offline after the first load.
 */

import {
  listUserConferences, loadUserConference, saveUserConference, removeUserConference,
} from './storage.js'

const base = import.meta.env.BASE_URL
const ACTIVE_KEY = 'ol:activeConference'

export function getActiveId() {
  try { return localStorage.getItem(ACTIVE_KEY) } catch { return null }
}
export function setActiveId(id) {
  try { localStorage.setItem(ACTIVE_KEY, id) } catch { /* storage off; runtime only */ }
}

/** Merged list of all conferences (bundled first, then user-added). Each entry:
 *  { id, name, path?, accent, dateRange, location, dataVersion, source }. */
export async function listConferences() {
  const [manifest, user] = await Promise.all([
    fetch(`${base}data/index.json`).then((r) => r.json()).catch(() => ({ conferences: [] })),
    listUserConferences().catch(() => []),
  ])
  const bundled = (manifest.conferences ?? []).map((c) => ({ ...c, source: 'bundled' }))
  // A user-added bundle can carry a bundled conference's id; the repo copy
  // wins, so the id stays unambiguous (one journal, one dataset, one row).
  const bundledIds = new Set(bundled.map((c) => c.id))
  const added = user
    .filter((c) => !bundledIds.has(c.id))
    .map((c) => ({
      id: c.id, name: c.name, accent: c.accent, dateRange: c.dateRange,
      location: c.location, dataVersion: c.dataVersion, source: 'user',
    }))
  return [...bundled, ...added]
}

/** Which conference to open: the stored active id if it still exists, else the
 *  first bundled one. */
export function resolveActive(list, storedId = getActiveId()) {
  if (storedId && list.some((c) => c.id === storedId)) return storedId
  return list[0]?.id ?? null
}

/** Load a conference's data. Bundled → fetch its two files; user → read the
 *  cached bundle from IndexedDB. Returns { config, sessions }. */
export async function loadConference(entry) {
  if (entry.source === 'user') {
    const record = await loadUserConference(entry.id)
    if (!record) throw new Error(`Conference "${entry.id}" is not stored on this device.`)
    return { config: record.config, sessions: record.sessions }
  }
  const [config, sessions] = await Promise.all([
    fetch(`${base}data/${entry.path}/config.json`).then((r) => r.json()),
    fetch(`${base}data/${entry.path}/sessions.json`).then((r) => r.json()),
  ])
  return { config, sessions }
}

/**
 * Validate an arbitrary object as a conference bundle. A bundle is
 * { config, sessions } (optionally wrapped with kind). We validate rather than
 * trust — a user is loading someone else's file.
 * -> { ok, config, sessions } or { ok: false, error }
 */
export function validateBundle(raw) {
  const config = raw?.config ?? raw?.conference
  const sessions = raw?.sessions
  if (!config || typeof config !== 'object') return { ok: false, error: 'No "config" object in the file.' }
  if (!config.conferenceId) return { ok: false, error: 'config.conferenceId is missing.' }
  if (!config.name) return { ok: false, error: 'config.name is missing.' }
  if (!Array.isArray(config.days) || config.days.length === 0) return { ok: false, error: 'config.days must be a non-empty array.' }
  if (!Array.isArray(sessions)) return { ok: false, error: 'No "sessions" array in the file.' }
  const bad = sessions.findIndex((s) => !s?.id || !s?.day || !s?.start || !s?.end || !s?.title || !Array.isArray(s?.tracks))
  if (bad !== -1) return { ok: false, error: `Session #${bad + 1} is missing required fields (id, day, start, end, title, tracks).` }
  return { ok: true, config, sessions }
}

function toRecord(config, sessions) {
  return {
    id: config.conferenceId,
    name: config.name,
    accent: config.accent ?? '#3d5af1',
    dateRange: config.dateRange ?? '',
    location: config.shortLocation ?? config.location ?? '',
    dataVersion: config.dataVersion ?? '',
    config,
    sessions,
  }
}

/** Add a conference from a parsed bundle object. Caches it in IndexedDB so it
 *  survives offline, and returns its registry entry. */
export async function addConferenceFromBundle(raw) {
  const v = validateBundle(raw)
  if (!v.ok) throw new Error(v.error)
  const record = toRecord(v.config, v.sessions)
  await saveUserConference(record)
  return { ...record, source: 'user' }
}

/** Add from a File (bundle .json). */
export async function addConferenceFromFile(file) {
  let raw
  try { raw = JSON.parse(await file.text()) }
  catch { throw new Error('That file is not valid JSON.') }
  return addConferenceFromBundle(raw)
}

/** Add from a URL. Fetched once and cached, so it then works offline; updates
 *  are re-fetched on demand (user re-adds the same URL). */
export async function addConferenceFromUrl(url) {
  let res
  try { res = await fetch(url) }
  catch { throw new Error('Could not reach that URL (it may block cross-origin requests).') }
  if (!res.ok) throw new Error(`The URL returned ${res.status}.`)
  let raw
  try { raw = await res.json() }
  catch { throw new Error('The URL did not return JSON.') }
  return addConferenceFromBundle(raw)
}

export { removeUserConference }
