# OpenConferencePlan — Format & Architecture Spec

**Status:** Draft 1. Captures decisions from the design review of 2026-07-20.
**Supersedes:** the schema sketch in `HANDOFF.md`. Where the two disagree, this wins.

---

## 0. What this is

A **portable conference-schedule standard** plus a reference PWA that consumes it.
SIGGRAPH 2026 is the first fixture, not the target. The goal is that another
conference can publish (or have someone convert) two files and get a working
planner for free.

Non-goals for v1: a server, accounts, real-time sync, a room-axis grid view.

---

## 1. Principles

These generate most of the decisions below. When something is ambiguous, apply these.

### 1.1 The shape of an artifact is determined by who dereferences it.

There are four artifacts. They deliberately do **not** share a schema:

| Artifact | Resolved by | Carries |
|---|---|---|
| **Conference data** (`config.json`, `sessions.json`) | any implementation | the standard itself |
| **Journal** (local, per-conference) | my app, against my data | picks + snapshots + notes + profile + extensions |
| **Share file** | *someone else's* app, against *their* data | bare IDs + envelope; annotations opt-in |
| **`.ics` export** | Google/Apple Calendar — no access to our data | fully denormalised |

The journal is a *journal* — a record of what I decided and when, so it needs memory
(snapshots, timestamps). The share file is a *pointer set* — it must **not** carry
memory, because my memory is stale in your context. The `.ics` is a *detached copy* —
it leaves the system, so it must carry everything.

### 1.2 Messy source formats die at the importer.

The runtime sees exactly one shape. Every variation a real conference publishes
(threshold-style access tiers, merged cells, free-text times, day banners) is
normalised by the import script. No component branches on source format.

### 1.3 Graceful degradation by omission.

Any optional block that is absent makes its feature disappear cleanly, rather than
erroring or rendering half-on. `recommendation` absent → no recommendations.
`accessLevels` absent → no tier UI. This is how conferences with less structured
data still get a working app.

### 1.4 Unknown fields must survive round-trip.

An implementation that reads a file containing fields it does not understand **must
preserve them on write**. This is the single rule that lets the standard grow without
fragmenting. It applies to `sessions.json`, the journal, and the share file.

### 1.5 Never silently drop user data.

A saved pick that no longer resolves is *shown as unresolvable*, never removed.
Silent removal on a show floor is how people miss talks — and in the collaborative
view it renders as "this person is free," which is confidently wrong.

---

## 2. Identity

**The single most load-bearing decision in the project.** Persistence, sharing, and
multi-year history all resolve through it.

### 2.1 Never derive identity from mutable fields.

Time, date, room, and access are **attributes**, not identity. Schedules move rooms
and times constantly in the weeks before a conference — which is exactly when people
build their agendas. An ID like `20260720_0900_1215_A3F1` changes when the session
changes, silently orphaning every saved pick.

### 2.2 Prefer the source's own ID; derive only as fallback.

```
sourceId: "sess244"                                    // authoritative when present
id:       "s2026-sess244"                              // else:
id:       "s2026-course--an-introduction-to-neural-shading"   // slug(type + title)
```

`sourceId` is a first-class optional field in the standard. Conferences that have
stable internal IDs get exact matching for free.

### 2.3 The ID ledger (`ids.json`) — committed to the repo.

The importer maintains a ledger alongside the data:

```json
{
  "s2026-sess244": {
    "firstSeen": "2026-04-02",
    "titleAtAssign": "An Introduction to Neural Shading",
    "sourceId": "sess244"
  }
}
```

On re-import, match new rows against the ledger in this order:
`sourceId` → slug → fuzzy title.

**An assigned ID is never reissued and never changes.** A retitled session keeps its
ID and gains an alias:

```json
{ "id": "s2026-sess244", "aliases": ["s2026-course--an-intro-to-neural-shading"] }
```

Identity is therefore stable **by construction**, not by hoping the hash inputs
hold still. The ledger is also the designated extension point for future
identity work.

---

## 3. `config.json` — conference-level declaration

```jsonc
{
  "schemaVersion": 1,
  "conferenceId": "siggraph-2026",
  "dataVersion": "2026-07-20",          // bump on every regenerate
  "generatedAt": "2026-07-20T10:14:00Z",
  "name": "SIGGRAPH 2026",
  "location": "Los Angeles Convention Center",
  "timezone": "America/Los_Angeles",

  "days": [
    { "key": "2026-07-19", "label": "Sunday",    "date": "19 Jul" },
    { "key": "2026-07-20", "label": "Monday",    "date": "20 Jul" },
    { "key": "2026-07-21", "label": "Tuesday",   "date": "21 Jul" },
    { "key": "2026-07-22", "label": "Wednesday", "date": "22 Jul" },
    { "key": "2026-07-23", "label": "Thursday",  "date": "23 Jul" }
  ],

  // ORDERED, most-privileged first. The order IS the hierarchy.
  // Required only if sessions carry `access`.
  "accessLevels": [
    { "id": "FCS", "label": "Full Conference Supporter", "aliases": ["Full Conference Supporter"] },
    { "id": "FC",  "label": "Full Conference",           "aliases": ["Full Conference"] },
    { "id": "E",   "label": "Experience",                "aliases": ["Experience"] },
    { "id": "D",   "label": "Discover",                  "aliases": ["Discover"] }
  ],

  // Optional. Presentation metadata over the `track` values found in the data.
  // NOT a source of truth — tracks are derived from sessions.json. This block only
  // assigns colour and display order, and may cover a subset. Unlisted tracks get
  // a default colour and sort alphabetically.
  "tracks": [
    { "id": "Technical Paper", "label": "Technical Papers", "color": "#2563eb" },
    { "id": "Course",          "label": "Courses",          "color": "#7c3aed" }
  ],

  // Optional. Absent → no recommendations, no ranking, no green markers.
  "recommendation": {
    "keywordsBoost": [],
    "programsBoost": [],
    "programsDemote": []
  }
}
```

**Why `accessLevels` is ordered and not derived from the data:** sessions in this
dataset list every eligible tier explicitly, so set-membership answers "can I
attend?" without a hierarchy. But other conferences publish *"Full Conference and
above"* — a threshold. Expanding that into an explicit set requires knowing FCS
outranks FC. The ordered array is that knowledge, and it is used **only at import
time**. The runtime never sees a threshold.

---

## 4. `sessions.json` — the session schema

```jsonc
[
  {
    "id": "s2026-sess244",              // required, stable, from the ledger
    "sourceId": "sess244",              // optional, source's own ID
    "aliases": [],                      // optional, retired IDs that still resolve
    "parentId": null,                   // optional — see 4.1

    "day": "2026-07-21",                // required, matches config.days[].key
    "start": "14:00",                   // required, 24h local
    "end": "15:30",                     // required

    "title": "3D Gaussian Splatting I", // required
    "tracks": ["Technical Paper"],      // required, ARRAY — source truth, drives filters
                                        // (joint events are genuinely cross-listed)

    "location": "Room 408 A",           // optional
    "url": "https://…?sess=sess244",    // optional, must render as a real link
    "contributors": [                   // optional
      { "name": "Zheng Wei", "url": "https://…?uid=081143" }
    ],
    "access": ["FCS", "FC"],            // optional, ALWAYS an explicit set
    "tags": [],                         // optional, feeds recommendation scoring
    "description": ""                   // optional
  }
]
```

Notes:

- **`contributors` is an array of objects, not a flat string.** The source carries a
  per-person profile URL; a string loses it.
- **`url` and `contributors[].url` must remain clickable in the app.** Links are
  extracted to their own fields at import; they are not embedded in the title text.
- **`access` is always an explicit set.** Threshold-style sources are expanded by
  the importer. One form in the standard — consumers implement one thing.
- **Recommendation flags are computed at runtime** from `config.recommendation`.
  Never bake a `rec` boolean into the data; that would make the dataset
  attendee-specific.

### 4.1 `parentId` — session / sub-session

Optional. Present when a conference publishes individual talks inside a container
session (SIGGRAPH 2026's export does **not** — its `Technical Paper` rows are
topic-named session containers with no children).

**One rule makes this safe:** *a child never conflicts with its own parent.* Conflict
detection must walk the parent chain and exclude ancestors, or every sub-session pick
lights up red against the block containing it.

### 4.2 Derived tags

If tags are generated (LLM enrichment, URL mining), they must be **committed as
build artifacts alongside `ids.json`, never regenerated per build.** Non-deterministic
tags mean the recommended list reshuffles between builds, and worse, an exported pick
set and the recipient's data disagree about what a session is. Derived data gets the
same freeze-and-ledger discipline as identity.

---

## 5. The journal — local, per conference

Not "notes on sessions." It is **the user's record of their participation in a
conference**, which is why the access tier lives here and not in config.

```jsonc
{
  "schemaVersion": 1,
  "conferenceId": "siggraph-2026",

  "profile": { "accessTier": "FC" },     // per-user AND per-conference

  "picks": [
    {
      "id": "s2026-sess244",
      "snapshot": {                       // CHANGE DETECTOR — never a render source
        "title": "3D Gaussian Splatting I",
        "start": "14:00", "end": "15:30",
        "room": "Room 408 A",
        "dataVersion": "2026-06-14"
      },
      "addedAt": "2026-06-14T09:12:00Z",
      "notes": "", "rating": null, "tags": []
    }
  ],

  "x": { },                               // extension namespace — see below
  "meta": { "updatedAt": "2026-07-20T10:14:00Z" }
}
```

### 5.1 Three zones, three owners

- **`profile`** — app-owned, structured, small. Tier lives here so
  2025-Experience and 2026-Full-Conference coexist naturally.
- **`picks`** — app-owned, the core.
- **`x`** — **user / extension-owned. The core app never validates it, never
  schematises it, and never deletes it.** Hotel, flights, restaurants, expenses.
  Rides along in every backup for free.

### 5.2 The snapshot is a change detector, never a render source

Always render from current `sessions.json`. On load, compare snapshot to the current
record; if it differs, flag that pick. **Once the user acknowledges the change,
overwrite the snapshot** — without that step every stale pick nags forever.

This is why the journal and the share file have opposite shapes: the journal needs
memory to detect change; the share file must not carry memory because the sender's
memory is stale in the recipient's context.

### 5.3 Storage

- **IndexedDB, not localStorage.** localStorage is synchronous and ~5MB-capped;
  notes across multiple years will approach it.
- **Call `navigator.storage.persist()`** on first write. One line; exempts the origin
  from routine eviction when granted.
- **Surface `navigator.storage.estimate()`** so the user can be *told* they're
  unprotected rather than finding out by data loss.
- **Auto-export a backup file** on a cadence (end of each conference day, or
  `visibilitychange`). It lands in Downloads, which no browser evicts. This is the
  strongest free durability story and it doubles as the share artifact.

Rationale: Safari applies aggressive eviction to script-writable storage
(the ~7-days-without-interaction rule), and installed-PWA exemptions have been
inconsistent across iOS versions. Chrome evicts under storage pressure. For a
feature whose value is longitudinal, browser storage alone is not a durable home
for hand-authored notes.

---

## 6. The share file

```jsonc
{
  "schemaVersion": 1,
  "conferenceId": "siggraph-2026",
  "dataVersion": "2026-06-14",           // which sessions.json this was made against
  "sender": {
    "id": "b1f4…",                        // crypto.randomUUID(), minted once, stored in journal
    "name": "Alex"
  },
  "picks": ["s2026-sess244", "s2026-sess310"],
  "annotations": { }                      // OPT-IN ONLY: notes/ratings promoted from journal
}
```

### 6.1 Bare IDs, because the recipient resolves against their own data

Retitles and room changes then **fix themselves** — the recipient renders from *their*
`sessions.json`, not the sender's June snapshot. This is the entire payoff of doing
identity properly.

### 6.2 `x` is never shared

Not opt-in, not offered in the share UI. Hotel and flight details leaving the device
by accident is a real harm, and the safest design is one where the code path does not
exist. `annotations` remains opt-in; `x` stays home.

### 6.3 Three render states for an imported column

Two states is the bug. You need three:

| State | Condition | Renders as |
|---|---|---|
| **Resolved** | ID resolves in current data | normal block |
| **Unresolvable** | ID does not resolve | **ghost block**, struck through, "no longer in schedule" |
| **Stale envelope** | `dataVersion` older than current | whole column flagged |

**Never silently drop an unresolvable pick.** An empty slot reads as *"they're free,
go find them"* — and the one thing you know for certain is that they *planned* to be
busy then. `dataVersion` is what distinguishes "cancelled" from "different dataset."

### 6.4 Import: auto-match, confirm, override

`sender.id` is minted once (`crypto.randomUUID()`) and persisted in the journal, so a
re-export from the same person auto-matches an existing column. The import prompt is
then a **confirmation with an escape hatch** — "this will replace Alex's picks" — with
a dropdown to create a new column or reassign to a different one instead.

This handles both cases no automatic scheme can: two genuinely different people named
Alex, and one Alex exporting from two devices.

**Scope of overwrite:** replaces the **pick set and annotations**. Never touches the
**label, colour, or column position** — their data is theirs, my presentation of it is
mine. Different owners, different lifecycles.

### 6.5 Transport

Two payloads, two transports:

- **File** (`.json`, download / AirDrop / messaging attachment) — the general case.
  Carries everything including annotations.
- **QR code** — picks only, ID-compressed. Generation is pure client-side JS and works
  offline; scanning uses `getUserMedia` + `BarcodeDetector` over HTTPS (Pages is
  HTTPS). The constraint is **capacity**, not hosting: QR tops out near ~2.9KB and
  realistically far less to stay scannable phone-to-phone. Notes and ratings will
  never fit — do not try.

---

## 7. `.ics` export

Fully denormalised — Calendar has no access to `sessions.json`.

- **`UID` = the ledger ID.** This is what makes a re-export **update** the existing
  event instead of creating a duplicate. Without stable UIDs, every re-import doubles
  the user's calendar, which is the most common way `.ics` features get abandoned.
- **Bump `SEQUENCE`** on each re-export.
- `TZID` from `config.timezone`.
- Notes ride in `DESCRIPTION` — which incidentally makes the user's own calendar a
  free, server-backed, synced partial backup.

---

## 8. Delivery & versioning

### 8.1 Service worker

A cache-first PWA is built specifically *not* to fetch the latest data, which
undercuts the auto-resolution story. So:

- **Force-update to the latest data version.** A new service worker takes control
  rather than sitting in `waiting` until every tab closes.
- **Notify by impact, not by event.** Not "the schedule changed" — flag *the user's
  own affected picks* so they can review exactly those.
- To compute that diff you need the pre-update state — which is why **`picks[].snapshot`
  exists**. The diff is snapshot-vs-current, not v1-file-vs-v3-file, so you do not
  need to retain the old `sessions.json`.
- **`schemaVersion` gates the load.** Code/data skew is real once data can refresh
  independently of code; define the compatibility rule rather than discovering it.

---

## 9. Views

### 9.1 Session picker (primary)

- Vertical, time-ordered, grouped by day. Day tabs from `config.days`.
- Default: show all sessions.
- Filters **derived from the data**, not declared in config: `tracks`, `location`,
  `tags`. Multi-select with include/exclude. A cross-listed session appears under
  every track it belongs to — that is correct, not a duplicate.
- Track colour on the session cell, from `config.tracks` where declared.
- Access tier: **warn, don't block.** Adding a session outside your tier prompts
  ("are you sure — this requires Full Conference") but proceeds. Badges get upgraded
  and sessions get opened up; a hard block is wrong more often than it's right.
- Room-axis / horizontal grid view: **deferred.** At 36 concurrent sessions across 26
  rooms it is 26 columns of ~14px on a phone. Revisit as an optional desktop view.

### 9.2 Collaborative / my-schedule view

- Vertical time axis, **one column per person**.
- **Default: proportional time axis.** The stated purpose is seeing overlaps and gaps,
  and a compact/sequential list cannot answer that — rows stop aligning across columns.
  Compact mode is the escape hatch, not the default.
- **My column is pinned leftmost and non-reorderable.** It is the comparison anchor;
  everything is read against it.
- **Person is encoded by column position**, with a light background tint as secondary.
  Cells keep their track colour — person and track are two independent semantic
  dimensions and must not compete for the same visual channel.
- Colour and label are **receiver-assigned** (click the column header to rename /
  recolour, drag to reorder). Accepted cost: Alex is purple only on my phone. The
  benefit is no collision arbitration without a server.
- **Colleagues' sessions render normally regardless of my tier.** Their schedule is
  theirs; my badge is not a lens on their day.

---

## 10. SIGGRAPH 2026 import — known traps

Findings from `siggraph2026.xlsx` (1654 rows, single sheet, 2235 merged ranges).
Columns: `Time | Type | Session | Contributors | Location | Access | (G, empty)`.

1. **There is no date column.** Days are banner rows in column A —
   `"Monday, 20 July 2026 expand allcollapse all"` — at rows **227, 605, 1023, 1426**,
   each followed by a repeated header row.
2. **Sunday 19 July has no banner.** The first section (rows 2–226, 61 sessions) is
   implicit; its date appears **nowhere in the file**. Parse by banner alone and you
   silently drop a whole day. Infer from `config.days[0]`.
3. **The header row repeats 5×** (rows 1, 228, 606, 1024, 1427) and the five are
   **not identical**: row 1 reads `Session` / `Access`; the rest read
   `Session / Presentation` / `Tag` and add an empty `Plan` column. A header filter
   matching only the first form lets four rows through.
4. **Thursday 23 July is present** (74 sessions). `HANDOFF.md` scoped Sun–Wed.
   Decision: **include it** — clean all five days.
5. **2235 merged ranges are vertical spills.** A session occupies N rows; extra rows
   carry additional `Contributors` and additional `Access` tiers with all other cells
   blank. Collapse each run into one session with arrays.
6. **1103 cell-level hyperlinks on TWO columns** — `C` (session →
   `?post_type=page&p=16&sess=sess244`) and `D` (contributor →
   `?post_type=page&p=14&uid=081143`). These are different link kinds and must land in
   different fields (`url` vs `contributors[].url`). `sess=` is the `sourceId` source.
7. **Times are NBSP-separated with a TZ suffix**: `"9:00am - 12:15pm PDT"`.
   Normalise to 24h `start`/`end`; timezone comes from config.
8. **28 distinct `Type` values** → these become `track`. Largest is **Birds of a
   Feather (102)**, which appears in neither `HANDOFF.md`'s fallback nor its five
   tracks. `config.tracks` must default gracefully for undeclared values.
9. **No description and no keywords column exist.** Titles are 3–6 words
   (*"Speedy 3D"*, *"Numerical Geometry a la Mode"*). The `keywordsBoost` list in
   `HANDOFF.md` will match almost nothing. Recommendations are near-inert on this
   dataset until tags are enriched from the session URLs.
10. **Cross-listing is real.** 18 sessions carry more than one track — a joint event
    lists one track per participating community on successive spill rows
    (`SIGGRAPH Art Party` → ACM SIGGRAPH 365 + Art Gallery + Art Paper; 11
    `Emerging Technologies Demo` entries are also Technical Papers). Keeping only the
    first track silently drops these. This is why `tracks` is an array.
11. **`Technical Paper` rows are session containers, not individual papers** — topic-named,
    no contributors, no children. Confirmed by inspection (rows 250, 269, 360…).
    `parentId` is unused for this conference.

Density, for design work:

| Day | Sessions | Peak concurrent | Rooms |
|---|---|---|---|
| Sun 19 | 61 | 22 @ 11:45 | 20 |
| Mon 20 | 108 | 33 @ 14:30 | 29 |
| Tue 21 | 123 | 36 @ 10:45 | 26 |
| Wed 22 | 121 | 35 @ 10:45 | 26 |
| Thu 23 | 74 | 28 @ 10:45 | 21 |

### 10.1 The importer is a repeatable script, not a one-time clean

It will be re-run — schedules change, and the ledger only works if regeneration is
routine. It must be committed, deterministic, and emit `config.json`, `sessions.json`,
and `ids.json` together.

---

## 11. Open questions

Genuinely unresolved. Do not let these block the importer, but decide before the
collaborative view ships.

1. ~~`type` vs `track`~~ — **resolved.** They are the same concept. The standard uses
   **`tracks`** (the more general term); SIGGRAPH's column happens to be called "Type".
   Required, derived from the data, and an **array** — the SIGGRAPH data proved
   cross-listing is real (18 sessions, e.g. the E-Tech demos that are also Technical
   Papers). `config.tracks` is optional presentation metadata only.
2. **Access tier UI: grey out vs filter out.** Starting with grey-out (non-destructive,
   easier). Filter-out remains a user option later.
3. **Multi-conference bundle growth.** Every past year's `sessions.json` stays in the
   service worker precache forever. Needs a strategy: lazy-load non-active conferences,
   or precache only the active one.
4. **Recommendation enrichment.** URL-mining for tags is a plan, not a design — no owner,
   no schedule, no determinism story beyond §4.2. Feature is inert until it lands.
5. **Undo for a mis-targeted import overwrite.** No server, no undo stack today.
   The auto-backup in §5.3 partially covers it.

---

## 12. Build order

1. ~~**Importer + cleaned SIGGRAPH data**~~ — **done.** `scripts/import_siggraph2026.py`
   (one-shot, zero-dependency) emits `public/data/{config,sessions}.json` plus
   `import-report.txt`. 487 sessions, 0 issues, every source track value accounted
   for. JSON only — CSV cannot represent `contributors: [{name, url}]` without a
   positionally-aligned parallel-column hack that corrupts silently on edit.
2. ~~**Journal layer**~~ — **done.** `src/lib/journal.js` + `storage.js`: IndexedDB,
   `navigator.storage.persist()`, snapshot/diff with acknowledgement, auto-backup
   to Downloads.
3. ~~**Picker view**~~ — **done.** `src/components/PickerView.jsx`. Day tabs,
   derived track/tag/text filters with include+exclude, conflict flags,
   warn-don't-block on badge tier, clickable session and contributor links.
4. ~~**`.ics` export**~~ — **done.** `src/lib/ics.js`, session id as `UID`,
   `SEQUENCE` bump, UTC instants (no VTIMEZONE needed), notes in `DESCRIPTION`.
5. ~~**Share file**~~ — **done.** `src/lib/share.js` + `ImportDialog`. Bare ids,
   envelope, three render states, auto-match by `sender.id`, non-destructive
   overwrite.
6. ~~**Collaborative view**~~ — **done.** `src/components/ColumnsView.jsx`.
   Proportional axis by default, compact escape hatch, own column pinned
   leftmost, receiver-assigned label/colour.
7. ~~**PWA shell, service worker, Pages deploy**~~ — **done.** `vite-plugin-pwa`
   with `autoUpdate`, data on stale-while-revalidate,
   `.github/workflows/deploy.yml`.

**Verified in a real browser** (`npm run test:e2e`, Chromium via Playwright):
IndexedDB persistence across reload, snapshot written with every pick, `.ics`
download with unique scoped UIDs, share round-trip through a real file picker
including the ghost state for a cancelled pick, badge-tier marking without
hiding, and offline load from the service worker.

Remaining: real tag enrichment (open question #4), multi-conference switching
(open question #3), and a pass on physical iOS/Android hardware.
