# SessionSamba

An offline-first conference schedule planner, and a **portable schedule format**
any event can adopt. One name covers both: the app is SessionSamba, and the file
format it reads is the SessionSamba format (`SPEC.md`).

Pick sessions, see time conflicts, compare your day against your colleagues',
and export to your calendar. No server, no accounts, no tracking. Everything
lives on your device.

First fixture: **SIGGRAPH 2026** (Los Angeles, 19–23 July 2026, 487 sessions).

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 34 logic + 23 component tests
npm run build        # -> dist/

# Real-browser tests (Chromium via Playwright). First run only:
npx playwright install chromium
npm run test:e2e     # 21 end-to-end checks, starts its own server
npm run shots        # screenshots -> e2e/shots/
```

## What it does

- **Browse** a day at a time — filter by track, topic tag, room, or free text;
  include *and* exclude filters, because "everything except Posters" is a real query.
- **Pick sessions**, with overlapping picks flagged automatically.
- **Notes and ratings** on anything you picked, kept private to your device.
- **Compare schedules** — load a colleague's exported picks and see their day as a
  column beside yours on a shared time axis, so gaps and overlaps are visible.
- **Export to calendar** (`.ics`) — re-exporting *updates* your events rather than
  duplicating them.
- **Works offline.** Installable as a PWA; the schedule is cached for the show floor.

## Multiple conferences

The app is multi-event. Bundled conferences live one folder each under
`public/data/`, listed in a manifest:

```
public/data/
  index.json                     manifest the app reads to build the switcher
  siggraph-2026/config.json       conference declaration — days, timezone, tiers, accent
  siggraph-2026/sessions.json     the sessions
  <your-conf>/config.json
  <your-conf>/sessions.json
```

The header title is a switcher (▾) — each conference keeps its **own** picks and
notes, keyed by `conferenceId`; switching never touches the others, so it doubles
as your history of past events. Users can also add their own from the switcher by
**URL or a bundle file** (a single `.json` with `config` + `sessions`); it's cached
on-device so it works offline after the first load.

### Adding a conference to the repo

Add `public/data/<id>/config.json` + `sessions.json`, then regenerate the manifest.
The SIGGRAPH importer does this automatically (`rebuild_index`); for a hand-authored
conference, add an entry to `public/data/index.json` (`id`, `name`, `path`, `accent`,
`dateRange`, `location`, `dataVersion`). No code changes — filters, tracks and topics
are all derived from the data. `SPEC.md` is the authoritative format reference; a
minimal session is:

```json
{
  "id": "conf2027-my-stable-id",
  "day": "2027-05-04",
  "start": "14:00",
  "end": "15:30",
  "title": "A Session",
  "tracks": ["Papers"],
  "tags": []
}
```

Everything else (`location`, `url`, `contributors`, `access`, `sourceId`,
`parentId`, `description`) is optional, and each optional block that's absent
makes its feature disappear cleanly rather than half-render.

### Two rules worth reading before you author data

1. **Session `id` must be stable and must not encode time, date or room.** Those
   change in the weeks before a conference — exactly when people are building
   their agendas — and an id derived from them silently orphans every saved pick.
   See `SPEC.md` §2.
2. **If you'll re-publish the data, keep an id ledger** so an assigned id is
   never reissued. `SPEC.md` §2.3.

### Writing an importer

Conference sites publish wildly different formats, so each gets a small adapter
that emits the standard. `scripts/import_siggraph2026.py` is a worked example —
Python 3, no dependencies — that handles a genuinely nasty source: 2235 merged
cells, no date column, a missing day banner, and hyperlinks buried in two
different columns.

```bash
npm run import:siggraph        # xlsx -> public/data/siggraph-2026/*.json + rebuilds index.json
python3 scripts/seed_tags.py   # placeholder topic tags from titles
```

The importer prints a validation report and refuses to hide problems — unmapped
values, unparsable times and duplicate ids are all reported rather than dropped.

## Deploying

Push to `main`. `.github/workflows/deploy.yml` runs the tests, builds with the
repo name as the base path, and publishes to GitHub Pages. Enable Pages with
source **GitHub Actions** in repo settings.

For a user/org page or a custom domain, set `BASE_PATH=/`.

## Your data

Picks, notes and ratings are stored in **IndexedDB** on your device, and the app
asks the browser to mark that storage persistent.

**Browsers can still evict it.** Safari clears script-writable storage after a
period without interaction, and Chrome evicts under storage pressure. Since your
notes can't be regenerated, the app writes a **backup file to your Downloads
folder** — which no browser clears — and Settings has "Back up now" and
"Restore a backup…" buttons. Restoring is non-destructive: a stored journal is
only replaced when the file's copy is newer.

### What leaves your device

Nothing, unless you press a button. When you do:

| Action | Contains |
|---|---|
| **Share mine** | Session ids only, plus your display name |
| **Share + notes** | The above, plus your notes and ratings |
| **Calendar (.ics)** | Full session details, plus your notes in the description |
| **Backup** | Everything, including trip metadata — for you, never shared |

Your share file carries **ids, not copies of the schedule**, so the person
receiving it renders from *their* data. Retitles and room moves resolve
themselves; cancelled sessions show as struck-through ghosts rather than
vanishing — an empty slot would wrongly read as "they're free then".

Trip metadata (the `x` block: hotels, flights, whatever you add) is **never**
shareable. Not opt-in, not offered — the code path doesn't exist.

## Project layout

```
public/data/       index.json (manifest) + <conferenceId>/{config,sessions}.json
scripts/           import_siggraph2026.py, seed_tags.py
src/lib/           pure logic: identity, conflicts, ics, share, journal, storage
src/components/    PickerView, ColumnsView, dialogs
tests/             lib tests (node:test) + component tests (vitest)
SPEC.md            the format and architecture spec — read this first
```

## Testing

Three layers, 78 checks total:

| Suite | What it covers |
|---|---|
| `tests/lib.test.js` (34) | Identity, conflicts, `.ics`, share resolution, journal diffing — plus invariants on the real 487-session dataset, so a bad data regenerate fails the build |
| `tests/components.test.jsx` (23) | Every component rendered against real data (incl. the conference switcher) |
| `e2e/run.mjs` (21) | Real Chromium: IndexedDB persistence, `.ics` download, share round-trip, backup restore onto a fresh device, Browse view-model, detail sheet, dark theme, conference add/switch, offline via service worker |

## Status

Working and verified in a real browser. Known gaps are tracked in `SPEC.md` §11 —
the notable one is that topic tags are seeded from titles only (54% coverage),
because the SIGGRAPH source has no abstracts. Real enrichment means mining each
session's URL.

Remaining: a pass on physical iOS/Android hardware (Chromium headless is not a
substitute for real Safari).

## License

MIT.
