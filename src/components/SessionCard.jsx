import { formatRange } from '../lib/time.js'
import { trackColor } from '../lib/palette.js'
import Stars from './Stars.jsx'

/** Stop a link/control click from also opening the detail sheet. */
const stop = (e) => e.stopPropagation()

/** Truncate a conflicting title for the overlap chip (design: 22 chars). */
function short(text) {
  return text.length > 22 ? `${text.slice(0, 22)}…` : text
}

/**
 * Session card. State lives in the RING, never a
 * background swap: picked = accent ring + filled check; an unpicked card that
 * conflicts gets an amber ring. Tapping the title opens the detail sheet.
 */
export default function SessionCard({
  session, config, picked, overlapWith, onToggle, onOpen,
  note, onNote, rating, onRate, mini = false,
}) {
  const cls = [
    mini ? 'mini-card' : 'session',
    picked && 'is-picked',
    overlapWith && 'is-conflicted',
  ].filter(Boolean).join(' ')

  const contribs = session.contributors ?? []
  const shown = contribs.slice(0, 3)

  return (
    <article className={cls}>
      <div className="session-head">
        <div className="session-meta">
          {mini ? formatRange(session).split(' – ')[0] : formatRange(session)}
          {!mini && session.location && (
            <> <span className="dot">·</span> {session.location}</>
          )}
        </div>
        <button
          className="session-toggle"
          onClick={(e) => { stop(e); onToggle(session) }}
          aria-pressed={picked}
          aria-label={picked ? `Remove ${session.title}` : `Add ${session.title}`}
        >
          {picked ? '✓' : ''}
        </button>
      </div>

      {/* When onOpen is provided the whole title row opens the detail sheet;
         otherwise the title falls back to a direct link to the session page. */}
      <h3 className="session-title" onClick={onOpen ? () => onOpen(session) : undefined}>
        {onOpen ? session.title : session.url ? (
          <a href={session.url} target="_blank" rel="noreferrer noopener" onClick={stop}>
            {session.title}
          </a>
        ) : session.title}
      </h3>

      {mini && session.location && <div className="mini-room">{session.location}</div>}

      {!mini && shown.length > 0 && (
        <p className="session-people">
          {shown.map((c, i) => (
            <span key={`${c.name}-${i}`}>
              {i > 0 && ', '}
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer noopener" onClick={stop}>
                  {c.name}
                </a>
              ) : c.name}
            </span>
          ))}
          {contribs.length > 3 && ` and ${contribs.length - 3} more`}
        </p>
      )}

      {!mini && (
        <div className="session-tracks">
          {session.tracks.map((track) => (
            <span key={track} className="chip" style={{ '--chip': trackColor(track, config) }}>
              {track}
            </span>
          ))}
          {overlapWith && (
            <span className="overlap-chip">◔ Overlaps “{short(overlapWith)}”</span>
          )}
          {session.access?.length > 0 && (
            <span className="access">{session.access.join(' · ')}</span>
          )}
        </div>
      )}

      {mini && overlapWith && (
        <div style={{ marginTop: 6 }}><span className="overlap-chip">◔ Overlap</span></div>
      )}

      {!mini && picked && (
        <div className="session-picked-row">
          <input
            className="session-note"
            placeholder="Notes for yourself…"
            value={note ?? ''}
            onChange={(e) => onNote(session.id, e.target.value)}
            onClick={stop}
          />
          <Stars rating={rating} onRate={(r) => onRate(session.id, r)} />
        </div>
      )}
    </article>
  )
}
