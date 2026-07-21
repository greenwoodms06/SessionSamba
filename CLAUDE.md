# Working in this repo

## Read first

**`SPEC.md` is the source of truth**, not the code. It records *why* the design is
what it is, decision by decision, and the code comments reference its section
numbers (`SPEC sect. 6.3`). If the code and the spec disagree, that's a bug in one
of them — say so rather than silently picking a side.

## What this is

**SessionSamba**: a portable conference-schedule **format** plus the reference PWA
that consumes it — one name for both (see the naming note at the top of
`SPEC.md`). SIGGRAPH 2026 is the first fixture, not the target. Vite + React,
GitHub Pages, no server, no accounts.

## Invariants — breaking these breaks user data

These came out of a long design review. Each has tests guarding it; if a test
fails on one of these, the change is wrong, not the test.

1. **Session ids never encode time, date or room.** Those change in the weeks
   before a conference, which is exactly when people build agendas. An id derived
   from them silently orphans saved picks. (`SPEC.md` §2.1)
2. **Never silently drop a user's pick.** A pick that no longer resolves renders
   as a struck-through ghost. In the collaborative view, a silent removal reads as
   "they're free then", which is confidently wrong. (§1.5, §6.3)
3. **The share file carries bare ids, never denormalised titles/times.** The
   recipient renders from *their* data, so retitles fix themselves. (§6.1)
4. **`journal.x` is never shared.** Not opt-in, not offered — the code path must
   not exist. It holds hotel/flight details. (§6.2)
5. **The local journal snapshot is a change detector, never a render source.**
   Render from current `sessions.json`; compare against the snapshot; overwrite the
   snapshot on acknowledgement or it nags forever. (§5.2)
6. **`.ics` UID is the session id.** This is what makes re-export *update* rather
   than duplicate calendar events. (§7)
7. **Access tier warns, never blocks.** Badges get upgraded, sessions get opened
   up. (§9.1)

## Commands

```bash
npm run dev            # dev server
npm test               # 34 logic + 23 component tests
npm run test:e2e       # 21 real-browser checks (needs: npx playwright install chromium)
npm run shots          # screenshots -> e2e/shots/ (gitignored)
npm run build          # -> dist/
npm run import:siggraph  # regenerate public/data from the xlsx
```

The lib tests assert invariants on the **real 487-session dataset**, so a bad data
regenerate fails the build rather than shipping quietly. That's deliberate — if you
change the importer and tests fail on counts, check the data before "fixing" the test.

## Layout

```
public/data/     index.json (manifest) + <conferenceId>/{config,sessions}.json (generated)
                 multi-event: app reads the manifest, one folder per conference
scripts/         import_siggraph2026.py (xlsx adapter, writes a folder + rebuilds index), seed_tags.py
src/lib/         pure logic, fully unit-tested: time, overlap, ics, share, journal, storage, palette
src/components/  PickerView (browse), ColumnsView (collaborative), dialogs
src/styles.css   ALL styling lives here — no CSS-in-JS, no per-component files
e2e/             Playwright, self-contained (starts its own server)
```

## Conventions

- Plain JavaScript, not TypeScript. ES modules. No test framework in `src/lib`
  beyond `node:test`.
- **All CSS is in `src/styles.css`.** A visual redesign should be possible by
  editing that one file. Keep it that way.
- Comments explain *why*, not *what*, and cite `SPEC.md` sections for decisions
  that were argued rather than obvious.
- The importer is a **one-shot** adapter — SIGGRAPH won't republish. The id ledger
  described in `SPEC.md` §2.3 is for conferences that do; it's deliberately not
  implemented here.

## Known gaps (also `SPEC.md` §11)

- Topic tags are seeded from titles only (54% coverage) — the source has no
  abstracts. Real enrichment means mining session URLs.
- Never tested on physical iOS/Android. The storage-eviction behaviour that drove
  the whole durability design is a Safari/iOS thing, and headless Chromium can't
  stand in for it.

## Gotchas

- `pkill -f "vite preview"` matches its own shell in WSL and kills the command.
  Use a specific port and `fuser -k` or match on the port instead.
- `pip` has no network in this environment; `npm` does. The importer is stdlib-only
  Python for that reason (and because a zero-dep importer is easier to fork).
