import { useCallback, useEffect, useMemo, useState } from 'react'

import { buildResolver, buildShareFile, resolveShareFile } from './lib/share.js'
import { buildIcs } from './lib/ics.js'
import { findConflicts } from './lib/overlap.js'
import {
  acknowledgeAll, acknowledgeChange, addPick, detectChanges, newJournal, removePick,
  setAccessTier, updatePick,
} from './lib/journal.js'
import {
  downloadFile, exportBackup, importBackup, loadColumns, loadJournal, markAutoBackup,
  saveColumns, saveJournal, shouldAutoBackup, storageReport,
} from './lib/storage.js'

import { applyTheme, getTheme } from './lib/theme.js'
import { listConferences, loadConference, resolveActive, setActiveId } from './lib/registry.js'
import ConferenceSwitcher from './components/ConferenceSwitcher.jsx'
import PickerView from './components/PickerView.jsx'
import ColumnsView from './components/ColumnsView.jsx'
import ChangeBanner from './components/ChangeBanner.jsx'
import ChangeReviewSheet from './components/ChangeReviewSheet.jsx'
import ImportDialog from './components/ImportDialog.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import DetailSheet from './components/DetailSheet.jsx'

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
  const [warn, setWarn] = useState(null)
  const [theme, setTheme] = useState(getTheme)
  const [detailId, setDetailId] = useState(null)
  const [conferences, setConferences] = useState([])
  const [activeId, setActiveIdState] = useState(null)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showReview, setShowReview] = useState(false)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  // ---- discover conferences, pick the active one ----------------------------
  useEffect(() => {
    let cancelled = false
    listConferences()
      .then((list) => {
        if (cancelled) return
        setConferences(list)
        const id = resolveActive(list)
        if (id) setActiveIdState(id)
        else setError(new Error('No conferences available.'))
      })
      .catch((e) => !cancelled && setError(e))
    return () => { cancelled = true }
  }, [])

  // ---- load the active conference's data (re-runs on switch) -----------------
  useEffect(() => {
    if (!activeId || !conferences.length) return
    const entry = conferences.find((c) => c.id === activeId)
    if (!entry) return
    let cancelled = false
    setData(null)
    setJournal(null)
    // Transient UI (open sheets, pending dialogs) is per-conference state;
    // carrying it across a switch would show one conference's session over
    // another's data.
    setDetailId(null)
    setShowReview(false)
    setPendingImport(null)
    setWarn(null)
    loadConference(entry)
      .then(({ config, sessions }) => {
        if (cancelled) return
        setData({ config, sessions })
        setActiveDay(config.days[0]?.key ?? null)
        setView('picker')
      })
      .catch((e) => !cancelled && setError(e))
    return () => { cancelled = true }
  }, [activeId, conferences])

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
      downloadFile(`sessionsamba-backup-${new Date().toISOString().slice(0, 10)}.json`, contents)
      markAutoBackup()
      setToast('Backup saved to your Downloads folder.')
    })
  }, [journal])

  // ---- actions ------------------------------------------------------------
  const addSession = useCallback((session) => {
    commit(addPick(journal, session, data.config.dataVersion))
  }, [journal, data, commit])

  const togglePick = useCallback((session) => {
    if (!journal) return
    if (pickedIds.has(session.id)) {
      commit(removePick(journal, session.id))
      return
    }
    // Warn, don't block (SPEC §9.1): adding a session outside your badge tier
    // prompts, but always proceeds.
    const tier = journal.profile.accessTier
    if (tier && session.access?.length && !session.access.includes(tier)) {
      setWarn(session)
      return
    }
    addSession(session)
  }, [journal, pickedIds, addSession, commit])

  const exportIcs = useCallback(() => {
    if (!pickedSessions.length) {
      setToast('Select some sessions first.')
      return
    }
    const picks = new Map(journal.picks.map((p) => [p.id, p]))
    // SEQUENCE must only ever grow (SPEC sect. 7): calendar clients ignore an
    // update whose SEQUENCE is lower than the one they hold, so deriving it
    // from the pick count would make exports after a removal silently inert.
    const sequence = (journal.meta.icsSequence ?? 0) + 1
    const ics = buildIcs(pickedSessions, data.config, { picks, sequence })
    downloadFile(`${data.config.conferenceId}.ics`, ics, 'text/calendar')
    commit({ ...journal, meta: { ...journal.meta, icsSequence: sequence } })
  }, [pickedSessions, journal, data, commit])

  const exportShare = useCallback((includeAnnotations) => {
    const share = buildShareFile(journal, data.config, { includeAnnotations })
    downloadFile(
      `${journal.sender.name || 'my'}-picks-${data.config.conferenceId}.json`,
      JSON.stringify(share, null, 2),
    )
  }, [journal, data])

  const switchTo = useCallback((id) => {
    setActiveId(id)
    setActiveIdState(id)
    setShowSwitcher(false)
  }, [])

  const onConferenceAdded = useCallback((entry) => {
    setConferences((list) =>
      list.some((c) => c.id === entry.id) ? list.map((c) => (c.id === entry.id ? entry : c)) : [...list, entry])
    switchTo(entry.id)
  }, [switchTo])

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
  const tierLabel = (id) => config.accessLevels?.find((l) => l.id === id)?.label ?? id

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-main">
          <button className="conf-trigger" onClick={() => setShowSwitcher(true)}
            aria-label="Switch conference">
            <h1>{config.name}</h1>
            <span className="conf-caret" aria-hidden="true">▾</span>
          </button>
          <p className="app-header-sub">
            {pickedIds.size} picked
            {conflicts.size > 0 && <> · <span className="warn">{conflicts.size} in overlap</span></>}
          </p>
        </div>
        <div className="app-header-actions">
          <button className="icon-btn" onClick={exportIcs} aria-label="Export .ics" title="Export .ics">⤓</button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings" title="Settings">⚙</button>
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
        <ChangeBanner count={changes.length} onReview={() => setShowReview(true)} />
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
          onOpenDetail={(s) => setDetailId(s.id)}
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
          onOpen={(s) => setDetailId(s.id)}
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
          theme={theme}
          onSetTheme={(t) => setTheme(applyTheme(t))}
          onClose={() => setShowSettings(false)}
          onSetTier={(tier) => commit(setAccessTier(journal, tier))}
          onSetName={(name) => commit({ ...journal, sender: { ...journal.sender, name } })}
          onIcs={exportIcs}
          onBackup={async () => {
            downloadFile(
              `sessionsamba-backup-${new Date().toISOString().slice(0, 10)}.json`,
              await exportBackup(),
            )
            markAutoBackup()
          }}
          onRestore={async (file) => {
            try {
              const parsed = JSON.parse(await file.text())
              const { restored, skipped } = await importBackup(parsed)
              // The active conference's journal may just have been replaced.
              const stored = await loadJournal(config.conferenceId)
              if (stored) setJournal(stored)
              setToast(restored
                ? `Backup restored — ${restored} conference${restored === 1 ? '' : 's'} updated${skipped ? `, ${skipped} already current` : ''}.`
                : 'Nothing to restore — your local picks are already newer.')
            } catch (e) {
              setToast(e?.message || "That file couldn't be read as a backup.")
            }
          }}
        />
      )}

      {showReview && changes.length > 0 && (
        <ChangeReviewSheet
          changes={changes}
          onAckOne={(change) => {
            const next = change.session
              ? acknowledgeChange(journal, change.id, change.session, config.dataVersion)
              : removePick(journal, change.id)
            commit(next)
            if (changes.length <= 1) setShowReview(false)
          }}
          onAckAll={() => { commit(acknowledgeAll(journal, changes, config.dataVersion)); setShowReview(false) }}
          onRemoveGone={(id) => { commit(removePick(journal, id)); if (changes.length <= 1) setShowReview(false) }}
          onClose={() => setShowReview(false)}
        />
      )}

      {showSwitcher && (
        <ConferenceSwitcher
          conferences={conferences}
          activeId={activeId}
          onSwitch={switchTo}
          onAdded={onConferenceAdded}
          onClose={() => setShowSwitcher(false)}
          onToast={setToast}
        />
      )}

      {detailId && (() => {
        const s = sessionsById.get(detailId)
        if (!s) return null
        const pick = journal.picks.find((p) => p.id === detailId)
        return (
          <DetailSheet
            session={s} config={config} picked={pickedIds.has(detailId)}
            overlapWith={(() => {
              for (const otherId of conflicts.get(detailId) ?? []) {
                const o = sessionsById.get(otherId); if (o) return o.title
              }
              return null
            })()}
            tier={journal.profile.accessTier}
            note={pick?.notes} rating={pick?.rating}
            onToggle={(sess) => togglePick(sess)}
            onNote={(id, v) => commit(updatePick(journal, id, { notes: v }))}
            onRate={(id, v) => commit(updatePick(journal, id, { rating: v }))}
            onClose={() => setDetailId(null)}
          />
        )
      })()}

      {warn && (
        <div className="dialog-scrim" onClick={() => setWarn(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Outside your badge tier</h2>
            <p className="dialog-meta" style={{ marginTop: 6, lineHeight: 1.5 }}>
              “{warn.title}” requires {warn.access.map(tierLabel).join(' · ')}. Your badge is{' '}
              {tierLabel(journal.profile.accessTier)} — badges get upgraded and sessions open up,
              so you can keep it on your list.
            </p>
            <div className="dialog-actions">
              <button className="btn-outline" onClick={() => setWarn(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => { addSession(warn); setWarn(null) }}>Add anyway</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}
