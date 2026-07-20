/** Persistence (SPEC sect. 5.3).
 *
 *  IndexedDB, not localStorage: localStorage is synchronous and ~5MB-capped,
 *  and notes across multiple years will approach that. We also request
 *  persistent storage, because Safari evicts script-writable storage after a
 *  period without interaction and Chrome evicts under pressure — and the
 *  journal holds hand-authored notes that cannot be regenerated.
 */

// Deliberately NOT renamed to match the app. This key identifies existing
// user data on disk; changing it would orphan every saved journal — the exact
// data-loss the whole design guards against (SPEC sect. 2.1 in spirit).
const DB_NAME = 'openconferenceplan'
const DB_VERSION = 1
const STORE_JOURNALS = 'journals'   // one record per conference
const STORE_COLUMNS = 'columns'     // imported colleagues, per conference

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
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
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
const BACKUP_KEY = 'ocp:lastBackup'

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

export async function exportBackup() {
  const journals = await listJournals()
  return JSON.stringify(
    { kind: 'myconferenceplan-backup', exportedAt: new Date().toISOString(), journals },
    null,
    2,
  )
}
