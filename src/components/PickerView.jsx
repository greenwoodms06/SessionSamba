import { useMemo, useState } from 'react'
import SessionCard from './SessionCard.jsx'
import ColumnTimeline from './ColumnTimeline.jsx'
import { toMinutes } from '../lib/time.js'
import { trackColor } from '../lib/palette.js'

/**
 * Browse view. Two orthogonal controls give four modes from one shared
 * column-timeline component:
 *   Axis:  List | Timeline
 *   Group: Everything | By track | By room   (facets, config-declarable)
 *
 * Filters are DERIVED FROM THE DATA (SPEC §9.1); a cross-listed session appears
 * under every track it belongs to — correct, not a duplicate.
 */
export default function PickerView({
  config, sessions, activeDay, setActiveDay, pickedIds, conflicts,
  journal, onTogglePick, onUpdatePick, onOpenDetail,
}) {
  const [query, setQuery] = useState('')
  const [include, setInclude] = useState(() => new Set())
  const [exclude, setExclude] = useState(() => new Set())
  const [tagInclude, setTagInclude] = useState(() => new Set())
  const [onlyPicked, setOnlyPicked] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [axis, setAxis] = useState('list')     // 'list' | 'tl'
  const [group, setGroup] = useState('all')     // facet id
  const [compact, setCompact] = useState(false)

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])
  const pickState = useMemo(() => new Map(journal.picks.map((p) => [p.id, p])), [journal])

  // Facets — config may declare them; default to Everything / track / room.
  const FACETS = useMemo(() => ([
    { value: 'all', label: 'Everything', key: null },
    { value: 'track', label: 'By track', key: (s) => s.tracks },
    { value: 'room', label: 'By room', key: (s) => [s.location || 'TBD'] },
  ]), [])
  const facet = FACETS.find((f) => f.value === group) ?? FACETS[0]

  const dayCounts = useMemo(() => {
    const counts = new Map()
    for (const id of pickedIds) {
      const s = byId.get(id)
      if (s) counts.set(s.day, (counts.get(s.day) ?? 0) + 1)
    }
    return counts
  }, [pickedIds, byId])

  const daySessions = useMemo(() => sessions.filter((s) => s.day === activeDay), [sessions, activeDay])
  const tracks = useMemo(() => tally(daySessions, (s) => s.tracks), [daySessions])
  const tags = useMemo(() => tally(daySessions, (s) => s.tags ?? []), [daySessions])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return daySessions
      .filter((s) => {
        if (onlyPicked && !pickedIds.has(s.id)) return false
        if (include.size && !s.tracks.some((t) => include.has(t))) return false
        if (exclude.size && s.tracks.some((t) => exclude.has(t))) return false
        if (tagInclude.size && !(s.tags ?? []).some((t) => tagInclude.has(t))) return false
        if (!q) return true
        return (
          s.title.toLowerCase().includes(q) ||
          s.location?.toLowerCase().includes(q) ||
          s.tracks.some((t) => t.toLowerCase().includes(q)) ||
          (s.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
          s.contributors?.some((c) => c.name.toLowerCase().includes(q))
        )
      })
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || a.title.localeCompare(b.title))
  }, [daySessions, query, include, exclude, tagInclude, onlyPicked, pickedIds])

  const overlapTitle = (id) => {
    const others = conflicts.get(id)
    if (!others) return null
    for (const otherId of others) { const s = byId.get(otherId); if (s) return s.title }
    return null
  }

  const facetGroups = () => {
    const keys = [...new Set(visible.flatMap((s) => facet.key(s)))].sort()
    return keys.map((k) => ({
      key: k,
      color: group === 'track' ? trackColor(k, config) : '#64748b',
      sessions: visible.filter((s) => facet.key(s).includes(k)),
    }))
  }

  const mkItem = (s) => ({
    id: s.id, start: s.start, end: s.end, title: s.title, location: s.location, tracks: s.tracks,
    picked: pickedIds.has(s.id), conflict: conflicts.has(s.id), onOpen: () => onOpenDetail(s),
  })

  const tlColumns = axis === 'tl'
    ? (facet.key
      ? facetGroups().map((g) => ({ key: g.key, label: g.key, color: g.color, items: g.sessions.map(mkItem) }))
      : [{ key: 'all', label: 'All sessions', color: 'var(--accent)', items: visible.map(mkItem) }])
    : []

  const cycleTrack = (track) => {
    if (include.has(track)) { setInclude(without(include, track)); setExclude(with_(exclude, track)) }
    else if (exclude.has(track)) setExclude(without(exclude, track))
    else setInclude(with_(include, track))
  }
  const activeFilters = include.size + exclude.size + tagInclude.size + (onlyPicked ? 1 : 0)
  const clearAll = () => { setInclude(new Set()); setExclude(new Set()); setTagInclude(new Set()); setOnlyPicked(false) }

  const renderCard = (session, mini) => {
    const pick = pickState.get(session.id)
    return (
      <SessionCard
        session={session} config={config} mini={mini}
        picked={pickedIds.has(session.id)} overlapWith={overlapTitle(session.id)}
        onToggle={onTogglePick} onOpen={onOpenDetail}
        note={pick?.notes} onNote={(id, v) => onUpdatePick(id, { notes: v })}
        rating={pick?.rating} onRate={(id, v) => onUpdatePick(id, { rating: v })}
      />
    )
  }

  return (
    <>
      <div className="day-tabs" role="tablist">
        {config.days.map((day) => (
          <button key={day.key} role="tab" aria-selected={day.key === activeDay}
            onClick={() => setActiveDay(day.key)}>
            <span className="day-label">{day.label}</span>
            <span className="day-date">{day.date}</span>
            {dayCounts.get(day.key) > 0 && <span className="day-count">{dayCounts.get(day.key)}</span>}
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <input type="search" placeholder="Search titles, people, rooms…" value={query}
          onChange={(e) => setQuery(e.target.value)} aria-label="Search sessions" />
        <button className={activeFilters ? 'is-active' : ''} onClick={() => setFiltersOpen(true)}>
          Filters{activeFilters > 0 && ` · ${activeFilters}`}
        </button>
      </div>

      <div className="view-model-bar">
        <div className="segmented" role="tablist" aria-label="Layout">
          <button role="tab" aria-selected={axis === 'list'} onClick={() => setAxis('list')}>☰ List</button>
          <button role="tab" aria-selected={axis === 'tl'} onClick={() => setAxis('tl')}>▤ Timeline</button>
        </div>
        <select className="group-select" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group by">
          {FACETS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        {axis === 'tl' && (
          <button className="pill-toggle" aria-pressed={compact} onClick={() => setCompact((v) => !v)}>Compact</button>
        )}
      </div>

      <p className="result-count">{visible.length} of {daySessions.length} sessions</p>

      {visible.length === 0 ? (
        <div className="empty-state">
          No sessions match — clear a filter or two.
          {activeFilters > 0 && (
            <button className="link-button" style={{ display: 'block', margin: '10px auto 0' }}
              onClick={() => { setQuery(''); clearAll() }}>Clear all</button>
          )}
        </div>
      ) : axis === 'tl' ? (
        <ColumnTimeline columns={tlColumns} config={config} compact={compact} />
      ) : facet.key ? (
        <div className="facet-cols">
          {facetGroups().map((g) => (
            <section key={g.key} className="facet-col">
              <div className="facet-col-head">
                <span className="facet-dot" style={{ '--dot': g.color }} />
                <span className="label">{g.key}</span>
                <span className="count">{g.sessions.length}</span>
              </div>
              <div className="facet-col-body">
                {g.sessions.map((s) => <div key={s.id}>{renderCard(s, true)}</div>)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <ul className="session-list">
          {visible.map((s) => <li key={s.id}>{renderCard(s, false)}</li>)}
        </ul>
      )}

      {filtersOpen && (
        <>
          <div className="scrim" onClick={() => setFiltersOpen(false)} />
          <div className="sheet" role="dialog" aria-label="Filters">
            <div className="sheet-grip" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Filters</h2>
              {activeFilters > 0 && <button className="link-button" onClick={clearAll}>Clear all</button>}
            </div>
            <button className="only-toggle" aria-pressed={onlyPicked} onClick={() => setOnlyPicked((v) => !v)}>
              <span className="only-box">{onlyPicked ? '✓' : ''}</span> Only my picks
            </button>
            <p className="filter-hint">Tap a track to include, again to exclude, once more to clear.</p>
            <div className="filter-chips">
              {tracks.map(([track, count]) => (
                <button key={track}
                  className={['filter-chip', include.has(track) && 'is-include', exclude.has(track) && 'is-exclude'].filter(Boolean).join(' ')}
                  style={include.has(track) ? { '--chip': trackColor(track, config) } : undefined}
                  onClick={() => cycleTrack(track)}>
                  {track} <span className="count">{count}</span>
                </button>
              ))}
            </div>
            {tags.length > 0 && (
              <>
                <p className="filter-hint">Topics — seeded from titles, so coverage is partial.</p>
                <div className="filter-chips">
                  {tags.map(([tag, count]) => (
                    <button key={tag} className={`filter-chip ${tagInclude.has(tag) ? 'is-include' : ''}`}
                      onClick={() => setTagInclude(tagInclude.has(tag) ? without(tagInclude, tag) : with_(tagInclude, tag))}>
                      {tag} <span className="count">{count}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}

function tally(sessions, pick) {
  const counts = new Map()
  for (const s of sessions) for (const value of pick(s)) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}
const with_ = (set, value) => new Set(set).add(value)
const without = (set, value) => { const n = new Set(set); n.delete(value); return n }
