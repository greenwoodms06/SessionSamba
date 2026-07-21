#!/usr/bin/env python3
"""
SIGGRAPH 2026 — one-time clean of the copy-pasted schedule xlsx.

Converts the messy source into the SessionSamba format (see SPEC.md).
Zero dependencies: stdlib zipfile + ElementTree only. Runs offline.

This is a ONE-SHOT adapter. There will be no further versions of the source
file, so it does no ledger reconciliation — IDs are minted deterministically
from track + title (+ day only where a title recurs). SPEC.md sect. 2.3
describes the ledger for conferences that do re-publish; not needed here.

What it actually cleans:
  - day sections delimited by banner rows, with Sunday's banner MISSING
  - repeated header rows
  - merged/spill rows: one session occupies N rows, with extra contributors
    and extra access tiers stacked underneath
  - NBSP-separated 12h times with a timezone suffix -> 24h start/end
  - hyperlinks buried in two different columns -> their own fields

Outputs into public/data/:
  sessions.json      standard schema, for the app
  config.json        conference declaration
  import-report.txt  validation output

Usage:
  python3 scripts/import_siggraph2026.py [--source siggraph2026.xlsx] [--out public/data]
"""

import argparse
import datetime
import json
import pathlib
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, OrderedDict

# --------------------------------------------------------------------------
# Conference constants
# --------------------------------------------------------------------------

CONFERENCE_ID = "siggraph-2026"
ID_PREFIX = "s2026"

# ORDERED, most-privileged first. The order IS the hierarchy (SPEC sect. 3).
ACCESS_LEVELS = [
    {"id": "FCS", "label": "Full Conference Supporter"},
    {"id": "FC",  "label": "Full Conference"},
    {"id": "E",   "label": "Experience"},
    {"id": "D",   "label": "Discover"},
]

# Section order in the file. Sunday has NO banner row, so the first section is
# implicit and inferred from this list (SPEC sect. 10 trap #2).
DAYS = [
    {"key": "2026-07-19", "label": "Sunday",    "date": "19 Jul"},
    {"key": "2026-07-20", "label": "Monday",    "date": "20 Jul"},
    {"key": "2026-07-21", "label": "Tuesday",   "date": "21 Jul"},
    {"key": "2026-07-22", "label": "Wednesday", "date": "22 Jul"},
    {"key": "2026-07-23", "label": "Thursday",  "date": "23 Jul"},
]

CONFERENCE_META = {
    "name": "SIGGRAPH 2026",
    "location": "Los Angeles Convention Center, 1201 S Figueroa St, Los Angeles, CA 90015",
    "timezone": "America/Los_Angeles",
    "accent": "#3d5af1",           # per-conference theme slot (switcher monogram + app accent)
    "dateRange": "Jul 19–23",
    "shortLocation": "Los Angeles",
}

COL_TIME, COL_TRACK, COL_TITLE = "A", "B", "C"
COL_CONTRIB, COL_LOCATION, COL_ACCESS = "D", "E", "F"

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

BANNER_RE = re.compile(r"^(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day,\s*\d+\s+\w+\s+\d{4}")
TIME_RE = re.compile(
    r"^(\d{1,2}):(\d{2})\s*(am|pm)\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)\s*([A-Z]{2,4})?\s*$",
    re.IGNORECASE,
)
# The five header rows are NOT identical: row 1 says "Session"/"Access";
# rows 228/606/1024/1427 say "Session / Presentation"/"Tag" and add a "Plan" column.
HEADER_VALUES = {"Time", "Type", "Session", "Session / Presentation",
                 "Contributors", "Location", "Access", "Tag", "Plan"}
ID_PARAM_RE = re.compile(r"[?&](sess|uid)=([A-Za-z0-9_-]+)")

ACCESS_BY_LABEL = {lvl["label"].lower(): lvl["id"] for lvl in ACCESS_LEVELS}
ACCESS_ORDER = {lvl["id"]: i for i, lvl in enumerate(ACCESS_LEVELS)}


# --------------------------------------------------------------------------
# xlsx reading (stdlib only)
# --------------------------------------------------------------------------

def norm(text):
    """NBSP and friends -> plain spaces, collapse runs, strip."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text).replace("\xa0", " ")).strip()


def read_sheet(path):
    """-> (grid[row][col_letter] = text, hyperlinks[cell_ref] = url)"""
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")):
                shared.append("".join(t.text or "" for t in si.iter(NS + "t")))

        sheet_name = next(n for n in z.namelist() if n.startswith("xl/worksheets/sheet"))
        sheet = ET.fromstring(z.read(sheet_name))

        rel_targets = {}
        rels = sheet_name.replace("worksheets/", "worksheets/_rels/") + ".rels"
        if rels in z.namelist():
            for rel in ET.fromstring(z.read(rels)):
                rel_targets[rel.get("Id")] = rel.get("Target")

    hyperlinks = {}
    block = sheet.find(NS + "hyperlinks")
    if block is not None:
        for hl in block:
            target = rel_targets.get(hl.get(NS_R + "id"))
            if target:
                hyperlinks[hl.get("ref").split(":")[0]] = target

    def cell_text(cell):
        if cell.get("t") == "inlineStr":
            inline = cell.find(NS + "is")
            return "".join(t.text or "" for t in inline.iter(NS + "t")) if inline is not None else ""
        v = cell.find(NS + "v")
        if v is None or v.text is None:
            return ""
        return shared[int(v.text)] if cell.get("t") == "s" else v.text

    grid = {}
    for row in sheet.find(NS + "sheetData"):
        grid[int(row.get("r"))] = {
            re.match(r"([A-Z]+)", c.get("r")).group(1): norm(cell_text(c)) for c in row
        }
    return grid, hyperlinks


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------

def to_24h(hour, minute, meridiem):
    hour, minute = int(hour), int(minute)
    if meridiem.lower() == "pm" and hour != 12:
        hour += 12
    if meridiem.lower() == "am" and hour == 12:
        hour = 0
    return f"{hour:02d}:{minute:02d}"


def parse_time_range(text):
    """'9:00am - 12:15pm PDT' -> ('09:00', '12:15', 'PDT')"""
    m = TIME_RE.match(text)
    if not m:
        return None
    return (to_24h(m.group(1), m.group(2), m.group(3)),
            to_24h(m.group(4), m.group(5), m.group(6)),
            (m.group(7) or "").upper())


def slugify(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"-{2,}", "-", re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower())


def source_id_from_url(url):
    """'...&sess=sess244' -> 'sess244';  '...&uid=081143' -> 'uid-081143'"""
    m = ID_PARAM_RE.search(url or "")
    if not m:
        return None
    return m.group(2) if m.group(1) == "sess" else f"uid-{m.group(2)}"


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------

def split_sections(grid):
    """-> ([(day_index, first_row, last_row)], banner_rows)"""
    banners = sorted(r for r, c in grid.items() if BANNER_RE.match(c.get(COL_TIME, "")))
    starts = [min(grid)] + [r + 1 for r in banners]   # first section is implicit
    ends = [r - 1 for r in banners] + [max(grid)]
    sections = []
    for i, (start, end) in enumerate(zip(starts, ends)):
        if i >= len(DAYS):
            print(f"WARN: section {i} beyond DAYS list; skipped", file=sys.stderr)
            continue
        sections.append((i, start, end))
    return sections, banners


def is_header_row(cells):
    values = {v for v in cells.values() if v}
    return bool(values) and values.issubset(HEADER_VALUES)


def extract(grid, hyperlinks, report):
    """Collapse merged/spill rows into one dict per session.

    A session starts on a row whose Time parses AND whose Title is non-empty.
    Rows after it with no Time are spills carrying extra contributors (col D)
    and extra access tiers (col F). Merged ranges need no expansion: xlsx keeps
    a merged value in its top-left cell, which is exactly the start row.
    """
    sections, banners = split_sections(grid)
    report.append(f"Day sections: {len(sections)}  (banners at rows {banners}; "
                  f"section 0 implicit — Sunday has no banner)")

    sessions = []
    for day_index, start_row, end_row in sections:
        day = DAYS[day_index]
        current, count = None, 0

        for r in range(start_row, end_row + 1):
            cells = grid.get(r)
            if not cells or not any(cells.values()) or is_header_row(cells):
                continue
            if BANNER_RE.match(cells.get(COL_TIME, "")):
                continue

            time_text = cells.get(COL_TIME, "")
            title = cells.get(COL_TITLE, "")

            if time_text:
                parsed = parse_time_range(time_text)
                if not parsed:
                    report.append(f"  WARN row {r}: unparsable time {time_text!r} — skipped")
                    continue
                if not title:
                    report.append(f"  WARN row {r}: timed row with no title — skipped")
                    continue
                current = new_session(cells, hyperlinks, r, day, parsed)
                sessions.append(current)
                count += 1
                continue

            if current is None:
                if any(cells.get(c) for c in (COL_TITLE, COL_TRACK)):
                    report.append(f"  WARN row {r}: content before any session — skipped")
                continue
            add_spill(current, cells, hyperlinks, r)

        report.append(f"  {day['key']} {day['label']:<9} rows {start_row}-{end_row}: {count} sessions")
    return sessions


def new_session(cells, hyperlinks, row, day, parsed):
    start, end, tz = parsed
    url = hyperlinks.get(f"{COL_TITLE}{row}")
    session = {
        "_row": row, "_tz": tz,
        "sourceId": source_id_from_url(url),
        "day": day["key"], "start": start, "end": end,
        "title": cells.get(COL_TITLE, ""),
        "tracks": [],
        "location": cells.get(COL_LOCATION, ""),
        "url": url,
        "contributors": [], "access": [], "tags": [],
    }
    add_spill(session, cells, hyperlinks, row)
    return session


def add_spill(session, cells, hyperlinks, row):
    # A track value on a spill row means the session is cross-listed (joint
    # events carry one track per participating community). Keep them all.
    track = cells.get(COL_TRACK, "")
    if track and track not in session["tracks"]:
        session["tracks"].append(track)

    name = cells.get(COL_CONTRIB, "")
    if name and not any(c["name"] == name for c in session["contributors"]):
        entry = {"name": name}
        url = hyperlinks.get(f"{COL_CONTRIB}{row}")
        if url:
            entry["url"] = url
        session["contributors"].append(entry)

    access = cells.get(COL_ACCESS, "")
    if access:
        mapped = ACCESS_BY_LABEL.get(access.lower())
        if mapped is None:
            session.setdefault("_unmapped_access", []).append(access)
        elif mapped not in session["access"]:
            session["access"].append(mapped)


def assign_ids(sessions):
    """Deterministic IDs from track + title. Day is appended only where a title
    recurs (Exhibition runs three days); day is far more stable than time or
    room, which are deliberately excluded (SPEC sect. 2.1).
    """
    base = {}
    for s in sessions:
        primary = s["tracks"][0] if s["tracks"] else ""
        base.setdefault(f"{ID_PREFIX}-{slugify(primary + '--' + s['title'])}", []).append(s)

    for slug, group in base.items():
        if len(group) == 1:
            group[0]["id"] = slug
            continue
        for s in group:
            s["id"] = f"{slug}--{s['day']}"
        seen = Counter()
        for s in group:
            seen[s["id"]] += 1
            if seen[s["id"]] > 1:
                s["id"] = f"{s['id']}-{seen[s['id']]}"


# --------------------------------------------------------------------------
# Emit + validate
# --------------------------------------------------------------------------

def to_min(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def build_records(sessions):
    out = []
    for s in sessions:
        rec = OrderedDict()
        rec["id"] = s["id"]
        if s["sourceId"]:
            rec["sourceId"] = s["sourceId"]
        rec["day"], rec["start"], rec["end"] = s["day"], s["start"], s["end"]
        rec["title"], rec["tracks"] = s["title"], s["tracks"]
        if s["location"]:
            rec["location"] = s["location"]
        if s["url"]:
            rec["url"] = s["url"]
        if s["contributors"]:
            rec["contributors"] = s["contributors"]
        if s["access"]:
            rec["access"] = sorted(s["access"], key=lambda a: ACCESS_ORDER[a])
        rec["tags"] = s["tags"]
        out.append(rec)
    out.sort(key=lambda r: (r["day"], r["start"], r["end"], r["title"]))
    return out


def build_config(sessions, generated_at):
    tracks = sorted({t for s in sessions for t in s["tracks"]})
    return OrderedDict([
        ("schemaVersion", 1),
        ("conferenceId", CONFERENCE_ID),
        ("dataVersion", generated_at[:10]),
        ("generatedAt", generated_at),
        ("name", CONFERENCE_META["name"]),
        ("accent", CONFERENCE_META["accent"]),
        ("dateRange", CONFERENCE_META["dateRange"]),
        ("shortLocation", CONFERENCE_META["shortLocation"]),
        ("location", CONFERENCE_META["location"]),
        ("timezone", CONFERENCE_META["timezone"]),
        ("days", DAYS),
        ("accessLevels", ACCESS_LEVELS),
        # Presentation metadata only — tracks are derived from the data.
        ("tracks", [{"id": t, "label": t} for t in tracks]),
    ])


def validate(sessions, report):
    problems = 0

    bad = [s for s in sessions if s["end"] <= s["start"]]
    if bad:
        problems += len(bad)
        report.append(f"ISSUE: {len(bad)} sessions with end <= start:")
        for s in bad[:10]:
            report.append(f"    row {s['_row']}: {s['title']!r} {s['start']}-{s['end']}")

    zones = Counter(s["_tz"] for s in sessions)
    if len(zones) > 1 or (zones and "PDT" not in zones):
        report.append(f"NOTE: timezone suffixes in source: {dict(zones)}")

    unmapped = Counter()
    for s in sessions:
        for v in s.get("_unmapped_access", []):
            unmapped[v] += 1
    if unmapped:
        problems += sum(unmapped.values())
        report.append(f"ISSUE: unmapped access values: {dict(unmapped)}")

    untracked = [s for s in sessions if not s["tracks"]]
    if untracked:
        problems += len(untracked)
        report.append(f"ISSUE: {len(untracked)} sessions with no track:")
        for s in untracked[:10]:
            report.append(f"    row {s['_row']}: {s['title']!r}")

    dupes = [i for i, c in Counter(s["id"] for s in sessions).items() if c > 1]
    if dupes:
        problems += len(dupes)
        report.append(f"ISSUE: duplicate ids: {dupes[:10]}")

    report.append(f"Coverage: {len(sessions)} sessions | "
                  f"{sum(1 for s in sessions if s['url'])} with url | "
                  f"{sum(1 for s in sessions if s['sourceId'])} with sourceId | "
                  f"{sum(1 for s in sessions if s['contributors'])} with contributors | "
                  f"{sum(1 for s in sessions if s['access'])} with access")

    multi = [s for s in sessions if len(s["tracks"]) > 1]
    report.append(f"Cross-listed sessions (more than one track): {len(multi)}")
    for s in multi:
        report.append(f"    row {s['_row']}: {s['title'][:44]!r} -> {s['tracks']}")

    tracks = Counter(t for s in sessions for t in s["tracks"])
    report.append(f"Tracks ({len(tracks)}): " + ", ".join(f"{t}={n}" for t, n in tracks.most_common()))

    report.append("")
    report.append("Density (constrains any grid layout):")
    for day in DAYS:
        todays = [s for s in sessions if s["day"] == day["key"]]
        if not todays:
            continue
        peak, at = 0, 0
        for minute in range(6 * 60, 23 * 60, 5):
            n = sum(1 for s in todays if to_min(s["start"]) <= minute < to_min(s["end"]))
            if n > peak:
                peak, at = n, minute
        rooms = len({s["location"] for s in todays if s["location"]})
        report.append(f"  {day['key']} {day['label']:<9} {len(todays):>4} sessions | "
                      f"peak {peak:>2} @ {at // 60}:{at % 60:02d} | {rooms} rooms")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="siggraph2026.xlsx")
    # Per-conference folder under public/data/. The manifest (index.json) is
    # regenerated from every such folder after writing.
    ap.add_argument("--out", default="public/data/siggraph-2026")
    ap.add_argument("--generated-at", default=None)
    args = ap.parse_args()

    generated_at = args.generated_at or datetime.datetime.now(
        datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    report = [f"SessionSamba — {CONFERENCE_ID} one-time import",
              f"source: {args.source}   generatedAt: {generated_at}", ""]

    grid, hyperlinks = read_sheet(pathlib.Path(args.source))
    report.append(f"Sheet: {len(grid)} rows, {len(hyperlinks)} hyperlinks")

    sessions = extract(grid, hyperlinks, report)
    if not sessions:
        print("No sessions extracted — aborting.", file=sys.stderr)
        return 1

    assign_ids(sessions)
    report.append("")
    problems = validate(sessions, report)

    records = build_records(sessions)
    (out_dir / "sessions.json").write_text(
        json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (out_dir / "config.json").write_text(
        json.dumps(build_config(sessions, generated_at), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8")

    report += ["",
               f"Wrote {out_dir}/sessions.json ({len(records)} sessions)",
               f"Wrote {out_dir}/config.json",
               f"Issues needing review: {problems}"]

    rebuild_index(out_dir.parent)
    report.append(f"Rebuilt {out_dir.parent}/index.json")

    text = "\n".join(report)
    (out_dir / "import-report.txt").write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


def rebuild_index(data_dir):
    """Regenerate the conference manifest from every folder holding a config.json."""
    conferences = []
    for folder in sorted(p for p in data_dir.iterdir() if p.is_dir()):
        cfg_path = folder / "config.json"
        if not cfg_path.exists():
            continue
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        conferences.append(OrderedDict([
            ("id", cfg["conferenceId"]),
            ("name", cfg["name"]),
            ("path", folder.name),
            ("accent", cfg.get("accent", "#3d5af1")),
            ("dateRange", cfg.get("dateRange", "")),
            ("location", cfg.get("shortLocation") or cfg.get("location", "")),
            ("dataVersion", cfg.get("dataVersion", "")),
        ]))
    manifest = OrderedDict([("schemaVersion", 1), ("conferences", conferences)])
    (data_dir / "index.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
