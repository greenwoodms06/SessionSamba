import { useEffect, useRef, useState } from 'react'
import { addConferenceFromFile, addConferenceFromUrl } from '../lib/registry.js'
import { loadJournal } from '../lib/storage.js'

/**
 * "Your conferences" bottom sheet. Each event keeps its
 * own schedule, picks and notes keyed by conferenceId — switching never touches
 * the others. Bundled and user-added conferences appear together; the footer
 * adds a new one by URL or bundle file.
 */
export default function ConferenceSwitcher({
  conferences, activeId, onSwitch, onAdded, onClose, onToast,
}) {
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef(null)

  const add = async (fn) => {
    setBusy(true); setError('')
    try {
      const entry = await fn()
      onToast?.(`Added ${entry.name}.`)
      onAdded(entry)
    } catch (e) {
      setError(e.message || 'Could not add that conference.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Your conferences">
        <div className="sheet-grip" />
        <h2>Your conferences</h2>
        <p className="sheet-sub">Each event keeps its own schedule, picks and notes — switching never touches the others.</p>

        <div className="conf-list">
          {conferences.map((c) => (
            <ConferenceRow key={c.id} conference={c} active={c.id === activeId} onSwitch={onSwitch} />
          ))}
        </div>

        {adding ? (
          <div className="conf-add-panel">
            <button className="conf-add-file" disabled={busy} onClick={() => fileInput.current?.click()}>
              Choose a bundle file (.json)
            </button>
            <div className="conf-add-url">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or paste a link to a bundle"
                className="session-note" style={{ flex: 1 }} />
              <button className="btn-primary" style={{ flex: 'none', padding: '0 14px' }}
                disabled={busy || !url.trim()} onClick={() => add(() => addConferenceFromUrl(url.trim()))}>
                {busy ? '…' : 'Load'}
              </button>
            </div>
            {error && <p className="dialog-warning">{error}</p>}
            <p className="dialog-note">
              A bundle is a JSON file with <code>config</code> and <code>sessions</code>. Loaded once and
              cached on this device, so it keeps working offline; re-add the link to pull updates.
            </p>
            <input ref={fileInput} type="file" accept="application/json,.json" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) add(() => addConferenceFromFile(f)); e.target.value = '' }} />
          </div>
        ) : (
          <button className="conf-add" onClick={() => setAdding(true)}>+ Add a conference — link or bundle file</button>
        )}
      </div>
    </>
  )
}

/** A conference row shows its own pick count, read from that conference's
 *  journal (each is keyed by conferenceId). */
function ConferenceRow({ conference, active, onSwitch }) {
  const [picks, setPicks] = useState(null)
  useEffect(() => {
    let alive = true
    loadJournal(conference.id).then((j) => alive && setPicks(j?.picks?.length ?? 0)).catch(() => alive && setPicks(0))
    return () => { alive = false }
  }, [conference.id])
  const initial = (conference.name || '?').trim()[0]?.toUpperCase() ?? '?'
  const meta = [
    picks != null ? `${picks} picked` : null,
    conference.dataVersion || (conference.source === 'user' ? 'added' : ''),
  ].filter(Boolean).join(' · ')

  return (
    <button className={`conf-row${active ? ' is-active' : ''}`} onClick={() => onSwitch(conference.id)}>
      <span className="conf-monogram" style={{ background: conference.accent || '#3d5af1' }}>{initial}</span>
      <span className="conf-body">
        <span className="conf-name">{conference.name}</span>
        <span className="conf-dates">{[conference.dateRange, conference.location].filter(Boolean).join(' · ')}</span>
        {meta && <span className="conf-meta">{meta}</span>}
      </span>
      {active && <span className="conf-check" aria-hidden="true">✓</span>}
    </button>
  )
}
