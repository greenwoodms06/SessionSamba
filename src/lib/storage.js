/** Persistence (SPEC sect. 5.3).
 *
 *  IndexedDB, not localStorage: localStorage is synchronous and ~5MB-capped,
 *  and notes across multiple years will approach that. We also request
 *  persistent storage, because Safari evicts script-writable storage after a
 *  period without interaction and Chrome evicts under pressure — and the
 *  journal holds hand-authored notes that cannot be regenerated.
 */

// This key identifies user data on disk — renaming it orphans every saved
// journal, so treat it as frozen. (It was last changed 2026-07-21, before any
// real users existed, when the app was renamed to SessionSamba.)
const DB_NAME = 'sessionsamba'
const DB_VERSION = 2
const STORE_JOURNALS = 'journals'       // one record per conference
const STORE_COLUMNS = 'columns'         // imported colleagues, per conference
const STORE_CONFERENCES = 'conferences' // user-added conference bundles (config + sessions)

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_JOURNALS)) {
        db.createObjectStore(STORE_JOURNALS, { keyPath: 'conferenceId' })
      }
      if (!db.objectStoreNames.contains(STORE_COLUMNS)) {
        db.createObjectStore(STORE_COLUMNS, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_CONFERENCES)) {
        db.createObjectStore(STORE_CONFERENCES, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  // A failed open (transient lock, private-mode quirk) must not be cached, or
  // one bad moment disables storage until the next full reload.
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

function tx(storeName, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode)
        const request = fn(transaction.objectStore(storeName))
        transaction.oncomplete = () => resolve(request?.result)
        transaction.onerror = () => reject(transaction.error)
      }),
  )
}

export function loadJournal(conferenceId) {
  return tx(STORE_JOURNALS, 'readonly', (store) => store.get(conferenceId)).catch(() => null)
}

export function saveJournal(journal) {
  return tx(STORE_JOURNALS, 'readwrite', (store) => store.put(journal))
}

export function listJournals() {
  return tx(STORE_JOURNALS, 'readonly', (store) => store.getAll()).catch(() => [])
}

/** User-added conferences: the full bundle (config + sessions) is cached in
 *  IndexedDB so it keeps working offline after the first load (URL or file). */
export function saveUserConference(record) {
  return tx(STORE_CONFERENCES, 'readwrite', (store) => store.put(record))
}
export function listUserConferences() {
  return tx(STORE_CONFERENCES, 'readonly', (store) => store.getAll()).catch(() => [])
}
export function loadUserConference(id) {
  return tx(STORE_CONFERENCES, 'readonly', (store) => store.get(id)).catch(() => null)
}
export function removeUserConference(id) {
  return tx(STORE_CONFERENCES, 'readwrite', (store) => store.delete(id))
}

export function loadColumns(conferenceId) {
  return tx(STORE_COLUMNS, 'readonly', (store) => store.get(conferenceId))
    .then((record) => record?.columns ?? [])
    .catch(() => [])
}

export function saveColumns(conferenceId, columns) {
  return tx(STORE_COLUMNS, 'readwrite', (store) => store.put({ key: conferenceId, columns }))
}

/**
 * Ask the browser to exempt this origin from routine eviction. Free upside;
 * Chrome grants it heuristically for installed PWAs, Safari is less predictable.
 */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return { supported: false, persisted: false }
  const already = await navigator.storage.persisted?.()
  const persisted = already || (await navigator.storage.persist())
  return { supported: true, persisted }
}

/** So the UI can TELL the user they're unprotected rather than letting them
 *  find out by data loss. */
export async function storageReport() {
  const { supported, persisted } = await requestPersistence()
  let usage = null
  let quota = null
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate()
    usage = estimate.usage ?? null
    quota = estimate.quota ?? null
  }
  return { supported, persisted, usage, quota }
}

/** Download helper — used for backups, share files and .ics. */
export function downloadFile(filename, contents, mime = 'application/json') {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Auto-backup: a full journal dump lands in the device Downloads folder,
 * which no browser evicts. This is the strongest durability story available
 * without a server (SPEC sect. 5.3).
 */
const BACKUP_KEY = 'ss:lastBackup'

export function shouldAutoBackup(now = Date.now(), intervalMs = 12 * 60 * 60 * 1000) {
  try {
    const last = Number(localStorage.getItem(BACKUP_KEY) ?? 0)
    return now - last > intervalMs
  } catch {
    return false
  }
}

export function markAutoBackup(now = Date.now()) {
  try {
    localStorage.setItem(BACKUP_KEY, String(now))
  } catch {
    /* storage disabled; backups just stay manual */
  }
}

const BACKUP_KIND = 'sessionsamba-backup'

export async function exportBackup() {
  const journals = await listJournals()
  return JSON.stringify(
    { kind: BACKUP_KIND, exportedAt: new Date().toISOString(), journals },
    null,
    2,
  )
}

/**
 * Restore journals from a backup file. Non-destructive: a stored journal is
 * replaced only when the file's copy is NEWER (meta.updatedAt) — restoring an
 * old backup can never clobber picks made since (SPEC sect. 1.5 in spirit).
 * Imported columns and user-added conferences are untouched.
 */
export async function importBackup(raw) {
  if (raw?.kind !== BACKUP_KIND || !Array.isArray(raw.journals)) {
    throw new Error('Not a backup file from this app.')
  }
  let restored = 0
  let skipped = 0
  for (const journal of raw.journals) {
    if (!journal?.conferenceId) { skipped++; continue }
    const existing = await loadJournal(journal.conferenceId)
    const incoming = Date.parse(journal.meta?.updatedAt ?? '') || 0
    const current = Date.parse(existing?.meta?.updatedAt ?? '') || 0
    if (existing && current >= incoming) { skipped++; continue }
    await saveJournal(journal)
    restored++
  }
  return { restored, skipped }
}
