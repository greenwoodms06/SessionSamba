# Session handoff

Working doc for the next session. Four planned tasks: **code review (Fable 5),
finalize the app name, add an icon, fix GitHub security notices.** Delete this
file once those are done.

## What this is

An offline-first conference schedule planner PWA + a portable schedule format.
- **Live:** https://greenwoodms06.github.io/MyConferencePlan/
- **Repo:** `git@github.com:greenwoodms06/MyConferencePlan.git` (this folder)
- **Read first:** `SPEC.md` (format + architecture, authoritative) and `CLAUDE.md`
  (invariants + gotchas). Code comments cite `SPEC.md` section numbers.

## Current state — everything builds, tests, deploys

- Full "Companion" design adopted (from claude.ai/design): tokens + Instrument
  Sans, 2×2 Browse view-model (List/Timeline × Everything/By track/By room),
  shared column-timeline, session detail sheet, filters/settings/switcher sheets,
  import radio-card dialog, tier-warning dialog, ratings, change-review sheet,
  System/Light/Dark theme.
- Multi-conference: per-conference data folders + `index.json` manifest, in-app
  switcher, add-your-own by file or URL (cached in IndexedDB, works offline
  after first load).
- **77 tests green:** `npm test` (34 lib + 23 component) and `npm run test:e2e`
  (20 real-Chromium checks). CI runs tests + build + a dist-verification step on
  every push to `main`, then deploys to Pages.

Commands: `npm run dev` · `npm test` · `npm run test:e2e` (needs
`npx playwright install chromium` once) · `npm run build` · `npm run shots`
(screenshots → `e2e/shots/`, gitignored) · `npm run import:siggraph`.

## Task 1 — Code review with Fable 5

Point it at `src/` and `scripts/`. Orient it with `SPEC.md` + `CLAUDE.md` first;
the **seven invariants in `CLAUDE.md`** are the things a "cleanup" most easily
breaks (stable IDs, never-drop-user-data, bare-id share files, `journal.x` never
shared, snapshot-as-change-detector, `.ics` UID stability, warn-don't-block).

Highest-value areas to scrutinize:
- `src/lib/` — the pure logic (identity/`share.js`, `overlap.js`, `ics.js`,
  `journal.js`, `timeline.js`, `registry.js`). Best-tested; verify the tests
  actually pin the invariants.
- `src/lib/registry.js` — newest code. `validateBundle` guards user-supplied
  JSON; `addConferenceFromUrl` fetches arbitrary remote JSON (see Task 4 note).
- `src/App.jsx` — large; the switch/rebind effects and the several sheet render
  blocks are the most complex glue.
- `src/components/ColumnTimeline.jsx` + `src/lib/timeline.js` — the gap-
  compression/lane-packing layout; the one piece with real algorithmic density.

Two known non-blocking design decisions (don't "fix" without intent): the DB key
mismatch in Task 2, and per-conference accent NOT overriding the app-wide accent
(so dark-mode's tuned accent survives) — `config.accent` is used for switcher
monograms only.

## Task 2 — Finalize the app name

Current split (intentional): **app = MyConferencePlan**, **format =
OpenConferencePlan** (the vendor-neutral standard; `SPEC.md` and the importer
keep that name). If you collapse them, decide which name wins everywhere.

Where the **app** name lives (safe to change): `index.html` `<title>`,
`vite.config.js` PWA `manifest.name`/`short_name`, `src/lib/ics.js` PRODID,
backup filename in `src/App.jsx` + `kind` marker in `src/lib/storage.js`,
`README.md`/`CLAUDE.md` prose.

**⚠ Two things that are NOT just the name:**
1. `DB_NAME = 'openconferenceplan'` in `src/lib/storage.js` (and the matching
   `indexedDB.open('openconferenceplan')` in `e2e/run.mjs`) is the on-disk key
   for saved journals. Changing it **orphans existing local data**. There are no
   real users yet, so it's *safe to change now if you also accept wiping local
   test data* — but do it deliberately, update both places, and know why.
   localStorage keys `ocp:theme` / `ocp:activeConference` are the same story.
2. **Renaming the GitHub repo** changes the Pages URL and the base path. The base
   path is derived from the repo name in CI (`.github/workflows/deploy.yml` →
   `BASE_PATH=/<repo>/`) and defaults in `vite.config.js`. If you rename the repo,
   the live URL becomes `…github.io/<new-name>/` and the PWA `start_url`/`scope`
   follow automatically — but any bookmarks/installed PWAs break. The dist-verify
   step in the workflow greps for `${BASE_PATH}assets/`, so a mismatch fails CI
   loudly rather than shipping blank.

## Task 3 — Add an icon

Currently **placeholder SVGs**: `public/icons/icon-192.svg`, `icon-512.svg`,
referenced by `vite.config.js` (`manifest.icons`, `includeAssets`). Needs:
- A real icon at **192×192** and **512×512**. Provide a **maskable** variant
  (safe-zone padding) — the 512 is already declared `purpose: "any maskable"`.
- A **favicon** (`index.html` has none). Add e.g. `public/favicon.svg` +
  `<link rel="icon">`.
- `apple-touch-icon` (180×180 PNG) for iOS home-screen installs.
- PNG fallbacks are worth adding — some platforms don't honor SVG icons for
  install. If you switch formats, update `manifest.icons` types and re-run
  `npm run build` to confirm the manifest + precache pick them up.
Verify: build, then check `dist/manifest.webmanifest` and that icons 200 on the
live site. `manifest.theme_color`/`background_color` are `#111827` — revisit to
match the final brand.

## Task 4 — GitHub security notices

Findings from this session:
- **`npm audit` → 0 vulnerabilities.** Clean today.
- **Dependabot is disabled** on the repo (`gh api …/dependabot/alerts` → 403).
  The notices you're seeing are most likely GitHub prompting to enable it, or the
  CI deprecation warnings below. Enable via **Settings → Code security** (Dependabot
  alerts + security updates) if you want them.
- **CI deprecation warnings (not failures):** the Actions log warns that
  `actions/checkout@v4`, `setup-node@v4`, `configure-pages@v5`,
  `upload-pages-artifact@v3`, `deploy-pages@v4` target Node 20, force-run on
  Node 24. Bump to the latest major of each in `.github/workflows/deploy.yml` to
  clear them. Purely warnings; deploys succeed.
- **Supply-chain note for review:** `addConferenceFromUrl` (`src/lib/registry.js`)
  does `fetch(userURL).then(r => r.json())`. It only ever renders the result as
  text (no eval/HTML injection — React escapes), and `validateBundle` gates shape.
  Worth a look during the Fable review, but not a known hole.
- `gh` CLI is installed at `~/.local/bin/gh` and authenticated (fine-grained
  token, **Actions: read-only** — can read logs/watch runs but not re-run; add
  Actions: write if you want that). SSH push works (github.com host key added).

## Repo map

```
public/data/index.json + <conferenceId>/{config,sessions}.json   (generated)
scripts/import_siggraph2026.py   xlsx→JSON adapter, rebuilds index.json
scripts/seed_tags.py             placeholder title-derived tags (54% coverage)
src/lib/                         pure logic (see Task 1)
src/components/                  PickerView, ColumnsView, ColumnTimeline,
                                 SessionCard, DetailSheet, sheets & dialogs,
                                 ConferenceSwitcher, ChangeBanner/ChangeReviewSheet
src/App.jsx, src/main.jsx, src/styles.css   (ALL styling is in styles.css)
tests/ (node:test + vitest)   e2e/run.mjs (self-contained), e2e/live.mjs
SPEC.md, CLAUDE.md, README.md
siggraph2026.xlsx                source data (provenance; regenerate from it)
```

## Remaining gap (not for these four tasks)

- **No physical iOS/Android test.** The Safari storage-eviction behavior that
  drove the durability design (IndexedDB + `persist()` + auto-backup) can't be
  reproduced in headless Chromium. Needs a real device pass before you'd trust it
  on a show floor.
- Topic tags are title-seeded only (54%); real enrichment = mining session URLs
  (`SPEC.md` §11 #4). Structure is fine; it's a data task.
