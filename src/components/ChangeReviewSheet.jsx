import { formatTime } from '../lib/time.js'

const FIELD_LABEL = { title: 'Title', start: 'Starts', end: 'Ends', location: 'Room' }

/**
 * "Your picks changed" bottom sheet. Per-pick cards
 * with field-level diffs; acknowledging overwrites the snapshot so a pick never
 * re-flags (SPEC §5.2). Cancelled picks are shown too — never silently dropped
 * (SPEC §1.5) — with a Remove action.
 */
export default function ChangeReviewSheet({ changes, onAckOne, onAckAll, onRemoveGone, onClose }) {
  const moved = changes.filter((c) => c.kind === 'changed')
  const gone = changes.filter((c) => c.kind === 'gone')

  return (
    <>
      <div className="scrim" onClick={onClose} style={{ zIndex: 26 }} />
      <div className="sheet" role="dialog" aria-label="Your picks changed" style={{ zIndex: 27 }}>
        <div className="sheet-grip" />
        <h2>Your picks changed</h2>
        <p className="sheet-sub">
          The schedule was updated. Only your affected picks are listed — acknowledge each and it won’t flag again.
        </p>

        <div className="change-detail">
          {moved.map((change) => (
            <div key={change.id} className="change-row">
              <p className="change-title">{change.session.title}</p>
              <ul>
                {change.changes.map((d) => (
                  <li key={d.field}>
                    <span className="change-field">{FIELD_LABEL[d.field] ?? d.field}</span>
                    <s>{fmt(d.field, d.from)}</s> <span className="change-arrow">→</span> <b>{fmt(d.field, d.to)}</b>
                  </li>
                ))}
              </ul>
              <button onClick={() => onAckOne(change)}>Got it</button>
            </div>
          ))}

          {gone.map((change) => (
            <div key={change.id} className="change-row is-gone">
              <p className="change-title">{change.pick.snapshot?.title ?? change.id}</p>
              <p className="review-gone">No longer in the schedule — cancelled, or renamed beyond recognition.</p>
              <button onClick={() => onRemoveGone(change.id)}>Remove from my picks</button>
            </div>
          ))}
        </div>

        {moved.length > 0 && (
          <button className="btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={onAckAll}>
            Acknowledge all
          </button>
        )}
      </div>
    </>
  )
}

function fmt(field, value) {
  if (value == null || value === '') return '—'
  return field === 'start' || field === 'end' ? formatTime(value) : value
}
