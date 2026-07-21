import { formatRange } from '../lib/time.js'
import { trackColor } from '../lib/palette.js'
import { canAttend } from '../lib/journal.js'
import Stars from './Stars.jsx'

const stop = (e) => e.stopPropagation()

/** Session detail bottom sheet. Opened by tapping a card
 *  title or a timeline block. Carries the session URL as "Session page ↗". */
export default function DetailSheet({
  session, config, picked, overlapWith, tier, note, rating,
  onToggle, onNote, onRate, onClose,
}) {
  if (!session) return null
  const attendable = canAttend(session, tier, config.accessLevels)
  const contribs = session.contributors ?? []
  const tierLabel = (id) => config.accessLevels?.find((l) => l.id === id)?.label ?? id

  return (
    <>
      <div className="scrim" onClick={onClose} style={{ zIndex: 24 }} />
      <div className="sheet" role="dialog" aria-label={session.title} style={{ zIndex: 25 }}>
        <div className="sheet-grip" />
        <div className="detail-meta">
          {formatRange(session)}
          {session.location && <> <span style={{ color: 'var(--ink-4)' }}>·</span> {session.location}</>}
        </div>
        <h2 className="detail-title">{session.title}</h2>

        <div className="detail-chips">
          {session.tracks.map((t) => (
            <span key={t} className="chip" style={{ '--chip': trackColor(t, config) }}>{t}</span>
          ))}
          {overlapWith && <span className="overlap-chip">◔ Overlaps “{overlapWith}”</span>}
        </div>

        {session.description && <p className="detail-desc">{session.description}</p>}

        {contribs.length > 0 && (
          <>
            <p className="detail-caption">Contributors</p>
            <p className="detail-contribs">
              {contribs.map((c, i) => (
                <span key={`${c.name}-${i}`}>
                  {i > 0 && ', '}
                  {c.url ? <a href={c.url} target="_blank" rel="noreferrer noopener">{c.name}</a> : c.name}
                </span>
              ))}
            </p>
          </>
        )}

        {session.access?.length > 0 && (
          <div className={`detail-access${attendable ? '' : ' blocked'}`}>
            {attendable
              ? `Included in ${session.access.map(tierLabel).join(' · ')}`
              : `Requires ${session.access.map(tierLabel).join(' · ')} — your badge is ${tierLabel(tier)}`}
          </div>
        )}

        {picked && (
          <div className="session-picked-row" style={{ marginTop: 14 }}>
            <input className="session-note" placeholder="Notes for yourself…"
              value={note ?? ''} onChange={(e) => onNote(session.id, e.target.value)} onClick={stop} />
            <Stars rating={rating} onRate={(r) => onRate(session.id, r)} />
          </div>
        )}

        <div className="sheet-actions">
          <button className={picked ? 'btn-outline btn-quiet-danger' : 'btn-primary'}
            onClick={() => onToggle(session)}>
            {picked ? 'Remove from my day' : 'Add to my day'}
          </button>
          {session.url && (
            <a className="btn-outline" href={session.url} target="_blank" rel="noreferrer noopener"
              style={{ flex: 'none', display: 'grid', placeItems: 'center', padding: '0 16px', textDecoration: 'none' }}>
              Session page ↗
            </a>
          )}
        </div>
      </div>
    </>
  )
}
