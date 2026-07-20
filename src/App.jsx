import { useCallback, useEffect, useMemo, useState } from 'react'

import { buildResolver, buildShareFile, resolveShareFile } from './lib/share.js'
import { buildIcs } from './lib/ics.js'
import { findConflicts } from './lib/overlap.js'
import {
  acknowledgeAll, addPick, detectChanges, newJournal, removePick, setAccessTier, updatePick,
} from './lib/journal.js'
import {
  downloadFile, exportBackup, loadColumns, loadJournal, markAutoBackup,
  saveColumns, saveJournal, shouldAutoBackup, storageReport,
} from './lib/storage.js'

import PickerView from './components/PickerView.jsx'
import ColumnsView from './components/ColumnsView.jsx'
import ChangeBanner from './components/ChangeBanner.jsx'
import ImportDialog from './components/ImportDialog.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'

const base = import.meta.env.BASE_URL

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [journal, setJournal] = useState(null)
  const [columns, setColumns] = useState([])
  const [view, setView] = useState('picker')
  const [activeDay, setActiveDay] = useState(null)
  const [pendingImport, setPendingImport] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [storage, setStorage] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  // ---- load conference data -------------------------------------------------
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${base}data/config.json`).then((r) => r.json()),
      fetch(`${base}data/sessions.json`).then((r) => r.json()),
    ])
      .then(([config, sessions]) => {
        if (cancelled) return
        setData({ config, sessions })
        setActiveDay(config.days[0]?.key ?? null)
      })
      .catch((e) => !cancelled && setError(e))
    return () => { cancelled = true }
  }, [])

  // ---- load the journal + imported columns for this conference --------------
  useEffect(() => {
    if (!data) return
    const { conferenceId } = data.config
    let cancelled = false
    Promise.all([loadJournal(conferenceId), loadColumns(conferenceId)]).then(
      ([stored, storedColumns]) => {
        if (cancelled) return
        setJournal(stored ?? newJournal(conferenceId))
        setColumns(storedColumns)
      },
    )
    storageReport().then((report) => !cancelled && setStorage(report))
    return () => { cancelled = true }
  }, [data])

  // ---- persist ------------------------------------------------------------
  const commit = useCallback((next) => {
    setJournal(next)
    saveJournal(next).catch(() => setToast('Could not save — storage may be full.'))
  }, [])

  const commitColumns = useCallback((next, conferenceId) => {
    setColumns(next)
    saveColumns(conferenceId, next).catch(() => {})
  }, [])

  // ---- derived ------------------------------------------------------------
  const sessionsById = useMemo(
    () => (data ? buildResolver(data.sessions) : new Map()),
    [data],
  )

  const pickedSessions = useMemo(() => {
    if (!journal || !data) return []
    return journal.picks.map((p) => sessionsById.get(p.id)).filter(Boolean)
  }, [journal, data, sessionsById])

  const pickedIds = useMemo(
    () => new Set(journal?.picks.map((p) => p.id) ?? []),
    [journal],
  )

  const conflicts = useMemo(() => findConflicts(pickedSessions), [pickedSessions])

  const changes = useMemo(() => {
    if (!journal || !data) return []
    return detectChanges(journal, sessionsById)
  }, [journal, data, sessionsById])

  // ---- auto-backup (SPEC sect. 5.3) ---------------------------------------
  useEffect(() => {
    if (!journal || journal.picks.length === 0) return
    if (!shouldAutoBackup()) return
    exportBackup().then((contents) => {
      downloadFile(`myconferenceplan-backup-${new Date().toISOString().slice(0, 10)}.json`, contents)
      markAutoBackup()
      setToast('Backup saved to your Downloads folder.')
    })
  }, [journal])

  // ---- actions ------------------------------------------------------------
  const togglePick = useCallback((session) => {
    if (!journal) return
    commit(
      pickedIds.has(session.id)
        ? removePick(journal, session.id)
        : addPick(journal, session, data.config.dataVersion),
    )
  }, [journal, pickedIds, data, commit])

  const exportIcs = useCallback(() => {
    if (!pickedSessions.length) {
      setToast('Select some sessions first.')
      return
    }
    const picks = new Map(journal.picks.map((p) => [p.id, p]))
    const ics = buildIcs(pickedSessions, data.config, { picks, sequence: journal.picks.length })
    downloadFile(`${data.config.conferenceId}.ics`, ics, 'text/calendar')
  }, [pickedSessions, journal, data])

  const exportShare = useCallback((includeAnnotations) => {
    const share = buildShareFile(journal, data.config, { includeAnnotations })
    downloadFile(
      `${journal.sender.name || 'my'}-picks-${data.config.conferenceId}.json`,
      JSON.stringify(share, null, 2),
    )
  }, [journal, data])

  const handleImportFile = useCallback(async (file) => {
    try {
      const parsed = JSON.parse(await file.text())
      const resolved = resolveShareFile(parsed, { sessions: data.sessions, config: data.config })
      setPendingImport({ share: parsed, resolved })
    } catch {
      setToast("That file couldn't be read as a schedule export.")
    }
  }, [data])

  if (error) {
    return (
      <div className="app-message">
        <h1>Couldn’t load the schedule</h1>
        <p>The conference data didn’t load. If you’re offline and haven’t opened this
          app before, connect once so it can cache the schedule.</p>
      </div>
    )
  }

  if (!data || !journal) {
    return <div className="app-message"><p>Loading schedule…</p></div>
  }

  const { config, sessions } = data

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-main">
          <h1>{config.name}</h1>
          <p className="app-header-sub">
            {pickedIds.size} selected
            {conflicts.size > 0 && <> · <span className="warn">{conflicts.size} in conflict</span></>}
          </p>
        </div>
        <div className="app-header-actions">
          <button onClick={exportIcs} title="Download .ics for your calendar">Calendar</button>
          <button onClick={() => setShowSettings(true)} aria-label="Settings">⚙</button>
        </div>
      </header>

      <nav className="view-switch" role="tablist">
        <button role="tab" aria-selected={view === 'picker'} onClick={() => setView('picker')}>
          Browse
        </button>
        <button role="tab" aria-selected={view === 'columns'} onClick={() => setView('columns')}>
          My day{columns.length > 0 && ` + ${columns.length}`}
        </button>
      </nav>

      {changes.length > 0 && (
        <ChangeBanner
          changes={changes}
          onAcknowledge={() => commit(acknowledgeAll(journal, changes, config.dataVersion))}
          onRemoveGone={(id) => commit(removePick(journal, id))}
        />
      )}

      {view === 'picker' ? (
        <PickerView
          config={config}
          sessions={sessions}
          activeDay={activeDay}
          setActiveDay={setActiveDay}
          pickedIds={pickedIds}
          conflicts={conflicts}
          journal={journal}
          onTogglePick={togglePick}
          onUpdatePick={(id, patch) => commit(updatePick(journal, id, patch))}
        />
      ) : (
        <ColumnsView
          config={config}
          sessionsById={sessionsById}
          journal={journal}
          columns={columns}
          activeDay={activeDay}
          setActiveDay={setActiveDay}
          conflicts={conflicts}
          onColumnsChange={(next) => commitColumns(next, config.conferenceId)}
          onImportFile={handleImportFile}
          onExportShare={exportShare}
        />
      )}

      {pendingImport && (
        <ImportDialog
          pending={pendingImport}
          columns={columns}
          onCancel={() => setPendingImport(null)}
          onConfirm={(next) => {
            commitColumns(next, config.conferenceId)
            setPendingImport(null)
            setView('columns')
          }}
        />
      )}

      {showSettings && (
        <SettingsPanel
          config={config}
          journal={journal}
          storage={storage}
          onClose={() => setShowSettings(false)}
          onSetTier={(tier) => commit(setAccessTier(journal, tier))}
          onSetName={(name) => commit({ ...journal, sender: { ...journal.sender, name } })}
          onBackup={async () => {
            downloadFile(
              `myconferenceplan-backup-${new Date().toISOString().slice(0, 10)}.json`,
              await exportBackup(),
            )
            markAutoBackup()
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}
