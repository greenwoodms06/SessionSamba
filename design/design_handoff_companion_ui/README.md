# Handoff: Companion UI — visual redesign + view-model expansion

## Overview
A full visual redesign ("Companion" style) and UX expansion of the OpenConferencePlan reference PWA, replacing the current default-Tailwind look. It covers the Browse (picker) view with a new 2×2 view model, session detail, filters, conflict/tier/change-detection flows, share import, My day columns, ratings + notes, and a responsive desktop layout.

## About the Design Files
The files in this bundle are **design references created in HTML** — interactive prototypes showing intended look and behavior, **not production code to copy directly**. The task is to **adopt these designs into the existing codebase** (React + Vite per SPEC.md §12: `PickerView.jsx`, `ColumnsView.jsx`, `ImportDialog`, `src/lib/*`), keeping its data layer, journal, share, and `.ics` logic intact. The redesign is presentation + view-model; the architecture in SPEC.md is unchanged and remains authoritative.

- `Companion App.dc.html` — the interactive prototype (open in a browser; logic is in the inline script's `Component` class — readable reference for state shape and layout algorithms).
- `Companion Design System.dc.html` — the component kit / visual spec with usage rules.
- `SPEC.md` — the architecture spec (already in your repo; included for self-sufficiency).

## Fidelity
**High-fidelity.** Colors, type, spacing, radii, and states are final — recreate pixel-perfectly using the codebase's existing patterns. Demo/sample data in the prototype (16 Tuesday sessions, the "Alex" column, simulated schedule update) must be replaced by the real `sessions.json` / journal / share pipelines.

## The view model (new — this is the main structural change)
Browse gains two orthogonal controls, replacing the single list:

1. **Axis** (segmented): `List` (sequential cards, gaps collapsed) | `Timeline` (proportional time axis). Timeline adds a **Compact** pill: empty gaps between sessions collapse to a fixed 16px.
2. **Group** (dropdown, **facets declared by conference config, not hardcoded**): `Everything` | `By track` | `By room` | … A facet = `{ value, label, key: session => string[] }`. Cross-listed sessions appear in every matching column (correct, not a duplicate).

This yields 4 browse modes from one shared **column-timeline component**, parameterized by what a column represents (track / room / **person**). My day IS this component with person columns — build it once. See `layout()` and `renderCols()` in the prototype's script for the reference algorithms:
- **Gap compression**: collect all session start/end minutes + hour marks as breakpoints; per segment, height = covered ? `dur × ppm` : (compact ? `min(dur × ppm, 16px)` : `dur × ppm`); map times through cumulative Y. All columns share one map so rows align.
- **Lane packing**: sort by start; assign each session the first lane whose last end ≤ its start. Lane width 140px (multi-column) / 158px (single); column width = lanes × (laneW + 6px).
- Hour gutter labels: skip any label < 26px below the previous.
- Default `ppm` (px per minute): 1.5.

## Screens / Views

### App shell
- Max-width **402px** (phone) / **1100px** at ≥ 760px viewport; centered; `#f5f6f8` surface on `#e9ebef` page; full-height flex column; content region scrolls.
- Header: conference name (700/20, −0.01em), status line "N picked · M in conflict" (500/12, `#7a8090`, conflict fragment `#b45309`), two 36px circular white icon buttons (export `.ics`, settings), shadow `0 1px 3px rgba(32,36,44,.1)`.
- Primary tabs Browse/My day: segmented control — `#e8eaef` well, 12px radius, 3px padding; active segment white, 10px radius, 600/13.
- Day chips: white 12px-radius chips (label 600/13 `#7a8090`, date 500/11 `#aab0bd`); selected = accent fill, white text; pick-count badge: accent pill, 700/10, offset top −5px/right −4px with 2px surface ring.

### Browse — List · Everything
- Vertical card stack, 10px gap; **two-column grid** (`repeat(2, minmax(0,1fr))`) at ≥ 760px.
- Search input (white, 12px radius, no border, shadow) + Filters button (accent-filled when any filter active, label "Filters · N").
- Count line "X of Y sessions" (500/11.5 `#aab0bd`).
- **Session card** (see design-system file, §4): white, 16px radius, padding 13/15. Meta row (500/12 `#7a8090`) + 24px pick circle; title 600/15/1.3 (tap → detail sheet); contributor links (accent, no underline, ", " separators, "and N more" past 3); track chips (600/11, track color on 8% tint, pill); access tier list right-aligned (500/10.5 `#aab0bd`).
- **States via ring, never background swap**: picked = `0 0 0 1.5px accent` + accent-filled check; conflict adds amber chip `◔ Overlaps "…"` (`#b45309` on `#fbbf2426`) and amber ring on unpicked-conflicting cards.
- **Picked extras**: notes input (`#f9fafb`, 1px `#e8eaef`, 10px radius) + 5-star rating (15px stars, filled `#f59e0b`, empty `#d5d9e2`; tap star to set, tap same to clear). Notes/rating/tags live on the journal pick (SPEC §5) — the future Notes tab reads the same objects.

### Browse — List · faceted (By track / By room)
- Horizontal scroll of 252px columns; column header = 8px color dot (track color, or `#64748b` for non-track facets) + 700/12.5 label + count; mini cards (no contributors/notes), title tap → detail.

### Browse — Timeline
- Left time gutter (50px, right-aligned 500/10 `#aab0bd` hour labels) + horizontally scrollable columns.
- **Block**: absolute-positioned, 8px radius, 3px left border in track color, padding 4/7; time 600/9.5 `#7a8090`; title 600/11/1.25, 3-line clamp; room 400/9.5 `#aab0bd`. Picked = `#eef1fe` bg + accent ring; conflict = amber ring + `◔` top-right; min height 30px. Tap → detail sheet.

### My day
- Same column-timeline; columns = people. "Me" pinned leftmost (accent dot, non-reorderable); imported columns follow (receiver-assigned color, e.g. purple `#8b5cf6`). Blocks keep **track** color — person is encoded by column + faint tint (`accent @ 3%` column bg), never by block color.
- Toolbar: "Load a schedule…", "Share mine" (white buttons), Compact pill.
- **Stale envelope banner** when an imported column's `dataVersion` is older: amber tint bar, "⚠ Alex's schedule was shared against older conference data (14 Jun)…".
- **Ghost block** for unresolvable picks: dashed 1.5px `#aab0bd` border, `#f5f6f8` bg, struck-through title, "no longer in schedule" in `#b45309`. Never silently dropped (SPEC §6.3).
- Empty state: centered 500/13 `#aab0bd` two-liner.

### Session detail (bottom sheet)
Meta line → title 700/18 → chips + overlap chip → description (400/13/1.55 `#4a5060`) → "Contributors" caption + full linked list → access line (400/12 — amber `#b45309` "Requires FCS · FC — your badge is FC" when outside tier, else `#7a8090` "Included in …") → notes + stars when picked → footer: primary Add-to-my-day / quiet-red Remove + "Session page ↗" outline link (session `url` field).

### Filters (bottom sheet)
"Clear all" text button; "Only my picks" checkbox (20px, 6px radius, accent when on); hint copy "Tap a track to include, again to exclude, once more to clear."; track chips cycle **neutral → include (track-color fill, white text) → exclude (`#fee2e2` bg, `#b91c1c` text, line-through) → neutral**, each with count.

### Import confirm (centered dialog — SPEC §6.4)
Title "Import a shared schedule"; meta "From "Alex" · 3 picks · made against 14 Jun data"; radio cards: **Replace Alex's picks** ("Matched an existing column by sender ID", default when `sender.id` matches) / **Create a new column**; footnote: "Replaces the pick set and shared notes only — your label, colour and column order are kept. Hotel/flight extras never travel in share files."; Cancel / Import.

### Tier warning (centered dialog — warn, don't block)
""{title}" requires FCS. Your badge is FC — badges get upgraded and sessions open up, so you can keep it on your list." Cancel / **Add anyway** (accent). Never a hard block.

### Change detection (SPEC §5.2 + §8 — notify by impact)
- Banner (accent tint `#eef1fe`, text `#2a41c4`): "Schedule updated — N of your picks changed" + accent Review button. Shown on both tabs; counts only the user's affected picks (snapshot vs current diff).
- Review sheet: per-pick card with field-level diff rows — caption-width 48px field name, ~~old~~ (line-through `#aab0bd`) → **new** (600) — per-item "Got it" + "Acknowledge all". Acknowledging **overwrites the snapshot** so the pick never re-flags.

### Settings (bottom sheet)
Badge-tier selector (FCS/FC/E/D, ink-filled selected) with caption "sessions outside it warn, never block"; storage status well ("Persistent storage: granted · N MB used" — from `navigator.storage.estimate()`; note about auto-backup cadence); "Back up now" (primary) + "Export .ics" (secondary). The dashed "Demo: simulate a schedule update" button is prototype-only — do not ship.

## Interactions & Behavior
- Pick toggle: check circle or timeline block; if `session.access` exists and excludes the user's tier → tier-warning dialog first.
- Conflict = any two picks on the same day with overlapping intervals (`aStart < bEnd && bStart < aEnd`); remember SPEC §4.1: a child never conflicts with its own parent.
- Title/block tap → detail sheet. Sheet/dialog scrims: `rgba(32,36,44,.35–.4)`, tap to dismiss.
- Toast: dark `#20242c` pill, bottom-center, 500/12.5 white, 2.6s, 200ms ease-in rise. Used for backup, `.ics`, share, import confirmations.
- Search matches title, room, contributor names, case-insensitive; filters compose (search ∧ include-tracks ∧ ¬exclude-tracks ∧ only-picks).
- Responsive: single breakpoint at 760px (shell 402 → 1100, card list 1 → 2 columns, sheets capped at `min(480px, 100%)` centered). Prototype does this in JS; use a CSS media query in production.
- Hit targets ≥ 36px (prototype's 24px pick circle should get padding to ≥ 44px on touch).

## State Management
Per journal spec (SPec §5): `picks: { [sessionId]: { notes: string, rating: 0-5, tags: [] } }` (+ snapshot per pick, owned by the journal layer). UI state: `tab, day, axis ('list'|'tl'), group (facet id), compact, myCompact, search, trackModes { [track]: 'inc'|'exc' }, onlyPicks, tier`, plus transient `detail, filtersOpen, settingsOpen, importOpen, warn, reviewOpen, toast`. Pending changes come from snapshot-vs-current diffs at data load, not stored flags.

## Design Tokens
- **Neutrals**: page `#e9ebef` · surface `#f5f6f8` · card `#fff` · well/track-bg `#e8eaef` · hairline `#e8eaef` · ink `#20242c` · ink-2 `#4a5060` · ink-3 `#7a8090` · ink-4 `#aab0bd` · disabled `#d5d9e2`
- **Accent (theme slot — from conference config; SIGGRAPH ships `#3d5af1`)**: fill `#3d5af1` · hover/deep `#2a41c4` · tint `#eef1fe` · on-accent-muted `#c3cdfb`
- **Semantic**: warn `#b45309` on `#fbbf2426` · destructive `#b91c1c` on `#fee2e2` · rating `#f59e0b` · success `#0d9488`
- **Track palette** (from `config.tracks`; undeclared → `#64748b`): BoF `#c2570c` · Course `#7c3aed` · Technical Paper `#4d7c0f` · Educator's Forum `#0891b2` · Pathfinders `#0d9488` · Technical Workshop `#be185d` · Real-Time Live! `#e11d48` · Keynote `#b45309` · Emerging Tech `#0369a1` · Production `#a16207` · Poster `#65a30d` · Art Gallery `#c026d3`. Chips = color on `color+'14'` (8% tint).
- **Type**: Instrument Sans only (Google Fonts, 400–700). Scale: 20/700 page title · 15/700 sheet title · 15/600 session title · 13/600 buttons/tabs · 13/400 body · 12/500 meta · 11.5/500 caption · 11/600 chips. Never bold metadata.
- **Radii**: cards/inputs 16/12 · chips 99 · blocks/segments 8-10 · sheets 20 (top) · dialogs 18
- **Shadows**: resting `0 1px 3px rgba(32,36,44,.06)` · control `0 1px 2px rgba(32,36,44,.1)` · sheet `0 -8px 30px rgba(32,36,44,.15)` · dialog `0 12px 40px rgba(32,36,44,.25)` · state rings `0 0 0 1.5px <accent|#d97706>`
- **Rules of thumb**: state in rings, identity in chips; one accent per conference; three color channels (accent=app state, track=session identity, column=person) never compete; warnings never block; user data never silently dropped.

## Assets
None — no images or icon fonts. Glyphs used are unicode (⤓ ⚙ ✓ ◔ ★ ☰ ▤ ⚠ ↗); swap for the codebase's icon set (e.g. lucide: download, settings, check, alert-circle, star, list, columns, external-link).

## Screenshots
`screenshots/` — reference captures of key states, taken at desktop width (≥ 760px breakpoint active; on phones the same layouts stack at 402px):
01 browse list · 02 browse timeline + compact · 03 timeline by track · 04 filters sheet · 05 session detail sheet · 06 my day person columns (ghost + stale banner) · 07 change review sheet · 08 import confirm dialog. Use as visual-regression targets, but the DC prototypes remain the source of truth for exact values.

## Files
- `Companion App.dc.html` — full interactive prototype (all views, flows, and the layout algorithms in its `Component` class)
- `Companion Design System.dc.html` — component kit with all specimens and usage rules
- `SPEC.md` — architecture spec (authoritative for data/identity/share/journal behavior)

## Suggested implementation order
1. Tokens + shell + card restyle in `PickerView.jsx` (pure reskin, tests should stay green)
2. Extract the shared column-timeline component (layout algorithms above); port `ColumnsView.jsx` onto it
3. Add axis/facet controls + config-declared facets
4. Detail sheet, filters sheet, rating on picks
5. Change-detection banner/review wired to the real snapshot diff; import dialog restyle
6. Responsive breakpoint; e2e pass (`npm run test:e2e`) + hardware pass
