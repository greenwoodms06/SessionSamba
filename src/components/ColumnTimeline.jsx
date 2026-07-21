import { layout } from '../lib/timeline.js'
import { formatTime, fromMinutes, toMinutes } from '../lib/time.js'
import { trackColor } from '../lib/palette.js'

/**
 * Shared column-timeline. Renders a proportional, gap-
 * compressed time axis with one column per track / room / person. All columns
 * share one time→Y map so rows align across them — which is what makes gaps and
 * overlaps between people legible in My day.
 *
 * @param columns [{ key, label, color, tint?, sticky?, headExtra?, items: [session-like] }]
 *   where each item is { id, start, end, title, location, tracks, picked, conflict, ghost, onOpen }
 */
export default function ColumnTimeline({ columns, config, compact }) {
  const L = layout(columns, { compact })
  if (!L.columns.length) return null

  return (
    <div className="timeline-scroll">
      <div className="timeline-inner">
        <div className="time-gutter" style={{ height: L.height }}>
          {L.gutter.map((g) => (
            <div key={g.minutes} className="hour-mark" style={{ top: g.top - 6 }}>
              {formatTime(fromMinutes(g.minutes)).replace(':00', '')}
            </div>
          ))}
        </div>

        {L.columns.map((col) => (
          <section key={col.key} className="tl-col">
            <header className={`tl-col-head${col.sticky ? ' sticky' : ''}`}>
              <span className="dot" style={{ background: col.color }} />
              <span className="label">{col.label}</span>
              <span className="count">{col.items.length}</span>
              {col.headExtra}
            </header>
            <div className="tl-body" style={{ width: col.width, height: L.height, background: col.tint || 'transparent' }}>
              {col.blocks.map(({ item, x, top, width, height }) => {
                const accent = item.ghost ? 'var(--ink-4)' : trackColor(item.tracks?.[0], config)
                const cls = ['block', item.picked && 'is-picked', item.conflict && 'is-conflicted', item.ghost && 'is-ghost']
                  .filter(Boolean).join(' ')
                return (
                  <div
                    key={item.id}
                    className={cls}
                    style={{ left: x, top: top + 1, width, height: Math.max(height - 4, 30), '--accent-track': accent }}
                    onClick={item.ghost ? undefined : () => item.onOpen?.(item)}
                    title={`${item.title}\n${formatTime(item.start)}${item.location ? ` · ${item.location}` : ''}`}
                  >
                    <div className="block-head">
                      <span className="block-time">{formatTime(item.start)}</span>
                      {item.conflict && <span className="block-conflict">◔</span>}
                    </div>
                    <div className="block-title">{item.title}</div>
                    {item.location && <div className="block-room">{item.location}</div>}
                    {item.ghost && <div className="block-ghost-note">no longer in schedule</div>}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

/** Sort helper shared by callers building column item lists. */
export function byStart(a, b) {
  return toMinutes(a.start) - toMinutes(b.start)
}
