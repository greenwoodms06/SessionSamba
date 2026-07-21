/** `.ics` export (SPEC sect. 7).
 *
 *  Fully denormalised — Calendar has no access to sessions.json.
 *  UID is the stable session id, which is what makes a re-export UPDATE the
 *  existing event instead of creating a duplicate. Without that, every
 *  re-import doubles the user's calendar.
 */

import { zonedToUtcMs, toIcsUtc } from './time.js'

const CRLF = '\r\n'

/** RFC 5545 sect. 3.3.11 — escape in this order; backslash first. */
export function escapeText(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** RFC 5545 sect. 3.1 — fold to 75 octets, continuation lines start with a space.
 *  TextEncoder rather than Buffer: this runs in the browser. */
export function foldLine(line) {
  const bytes = encoder.encode(line)
  if (bytes.length <= 75) return line

  const out = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    // Never split a multi-byte character: back off continuation bytes (10xxxxxx).
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
    out.push((out.length ? ' ' : '') + decoder.decode(bytes.subarray(start, end)))
    start = end
    limit = 74 // continuation lines lose one octet to the leading space
  }
  return out.join(CRLF)
}

/** Reverse of foldLine. Session ids are long enough that UID lines fold, so
 *  anything inspecting generated .ics (tests, debugging) must unfold first. */
export function unfold(text) {
  return text.replace(/\r\n[ \t]/g, '')
}

function describe(session, pick) {
  const parts = []
  if (session.contributors?.length) {
    parts.push(session.contributors.map((c) => c.name).join(', '))
  }
  if (session.tracks?.length) parts.push(session.tracks.join(' / '))
  if (session.access?.length) parts.push(`Access: ${session.access.join(', ')}`)
  if (session.url) parts.push(session.url)
  // Notes ride along so the user's calendar doubles as a durable backup
  // of their own annotations (SPEC sect. 5.3).
  if (pick?.notes) parts.push('', pick.notes)
  return parts.join('\n')
}

/**
 * @param sessions   sessions to export (already filtered to the user's picks)
 * @param config     conference config (timezone, conferenceId, name)
 * @param options    { picks: Map<id, pick>, sequence: number, now: Date }
 */
export function buildIcs(sessions, config, options = {}) {
  const { picks = new Map(), sequence = 0, now = new Date() } = options
  const stamp = toIcsUtc(now.getTime())
  const tz = config.timezone

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SessionSamba//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(config.name)}`,
  ]

  for (const session of sessions) {
    const start = zonedToUtcMs(session.day, session.start, tz)
    const end = zonedToUtcMs(session.day, session.end, tz)
    lines.push(
      'BEGIN:VEVENT',
      // Stable UID -> re-export updates rather than duplicates.
      `UID:${session.id}@${config.conferenceId}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsUtc(start)}`,
      `DTEND:${toIcsUtc(end)}`,
      `SEQUENCE:${sequence}`,
      `SUMMARY:${escapeText(session.title)}`,
    )
    if (session.location) lines.push(`LOCATION:${escapeText(session.location)}`)
    // URL is a URI value (RFC 5545 sect. 3.3.13), not TEXT — escaping would
    // corrupt any URL containing a comma.
    if (session.url) lines.push(`URL:${session.url}`)
    const description = describe(session, picks.get(session.id))
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join(CRLF) + CRLF
}
