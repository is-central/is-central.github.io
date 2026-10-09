import os
import json
import sys
from datetime import timezone
import re
from collections import defaultdict

from dateutil import parser as dateparser

# -------------------------------
# CONFIG
# -------------------------------
SHEET_NAME = "schedule form test (Responses)"
WORKSHEET_NAME = "Form Responses 1"
TOURNAMENT_NAME = "tournament_name"
TOURNAMENT_SCHEDULE_FILE = "event_phase_schedule.json"

DEFAULT_DURATION = 120

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
OUTPUT_PATH = os.path.join(REPO_ROOT, "events", "_data", TOURNAMENT_NAME, TOURNAMENT_SCHEDULE_FILE)

COL_SUBMITTED_AT = 0
COL_NAME_TAG = 1
COL_DISCORD_TAG = 2
COL_NAME = 3
COL_SCHEDULED_DATE = 4
COL_SCHEDULED_TIME = 5
COL_LINK = 8

DISCRIMINATOR_PATTERN = re.compile(r"#\d{4}$")

PLATFORM_PATTERNS = {
    "youtube": ("youtube.com", "youtu.be"),
    "twitch": ("twitch.tv",),
    "bilibili": ("bilibili.com", "b23.tv"),
}


# -------------------------------
# HELPERS
# -------------------------------
def parse_utc_datetime(value):
    """Parse a string into a timezone-aware UTC datetime, or None if invalid/empty."""
    if not value or not str(value).strip():
        return None
    try:
        dt = dateparser.parse(str(value).strip())
    except (ValueError, OverflowError):
        return None

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt


def parse_scheduled_datetime(date_str, time_str):
    """Combine separate date + time strings into one UTC datetime."""
    date_str = (date_str or "").strip()
    time_str = (time_str or "").strip()
    if not date_str or not time_str:
        return None
    combined = f"{date_str} {time_str}"
    return parse_utc_datetime(combined)


def detect_platform(link):
    """Return (platform, link) if link matches a known platform, else (None, None)."""
    if not link or not str(link).strip():
        return None, None
    link = str(link).strip()
    lowered = link.lower()
    for platform, domains in PLATFORM_PATTERNS.items():
        if any(domain in lowered for domain in domains):
            return platform, link
    return None, None


def to_iso_utc(dt):
    """Format as 'YYYY-MM-DDTHH:MM:SSZ'."""
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

def normalize_key(value):
    """Lowercased, stripped value used for matching identities. Empty -> None."""
    if not value or not str(value).strip():
        return None
    return str(value).strip().lower()


def clean_name_tag(value):
    """Strip a trailing #1234 discriminator from a name tag, if present."""
    value = str(value).strip()
    return DISCRIMINATOR_PATTERN.sub("", value).strip()


class UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, x, y):
        rx, ry = self.find(x), self.find(y)
        if rx != ry:
            self.parent[rx] = ry

# -------------------------------
# BUILD SCHEDULE
# -------------------------------
def build_schedule(df):
    records = []

    # ---- Pass 1: parse every row ----
    for idx, row in df.iterrows():
        row_num = idx + 2

        try:
            submitted_raw = row.iloc[COL_SUBMITTED_AT]
            name_tag_raw = row.iloc[COL_NAME_TAG]
            discord_tag_raw = row.iloc[COL_DISCORD_TAG]
            name_raw = row.iloc[COL_NAME]
            date_raw = row.iloc[COL_SCHEDULED_DATE]
            time_raw = row.iloc[COL_SCHEDULED_TIME]
            link_raw = row.iloc[COL_LINK] if COL_LINK < len(row) else None
        except IndexError:
            print(f"[row {row_num}] skipped: missing expected columns", file=sys.stderr)
            continue

        submitted_dt = parse_utc_datetime(submitted_raw)
        if submitted_dt is None:
            print(f"[row {row_num}] skipped: could not parse submission datetime '{submitted_raw}'", file=sys.stderr)
            continue

        scheduled_dt = parse_scheduled_datetime(date_raw, time_raw)
        if scheduled_dt is None:
            print(f"[row {row_num}] skipped: could not parse scheduled date/time "
                  f"'{date_raw}' '{time_raw}'", file=sys.stderr)
            continue

        # name fallback: column 3 -> cleaned column 1
        name = str(name_raw).strip()
        if not name:
            name = clean_name_tag(name_tag_raw)
        if not name:
            print(f"[row {row_num}] skipped: no usable name (column 3 and column 1 both empty)", file=sys.stderr)
            continue

        is_valid = scheduled_dt > submitted_dt

        records.append({
            "row_num": row_num,
            "name_key": normalize_key(name_tag_raw),
            "discord_key": normalize_key(discord_tag_raw),
            "submitted_dt": submitted_dt,
            "scheduled_dt": scheduled_dt,
            "name": name,
            "link_raw": link_raw,
            "is_valid": is_valid,
        })

    # ---- Pass 2: group repeated submissions by identity (col1 OR col2 match) ----
    uf = UnionFind()
    for rec in records:
        keys = [k for k in (rec["name_key"], rec["discord_key"]) if k is not None]
        for k in keys:
            uf.union(("rec", rec["row_num"]), ("key", k))

    groups = defaultdict(list)
    for rec in records:
        root = uf.find(("rec", rec["row_num"]))
        groups[root].append(rec)

    # ---- Pass 3: within each group, drop invalids, keep latest-submitted valid one ----
    schedule = []
    for group_records in groups.values():
        valid = [r for r in group_records if r["is_valid"]]

        for r in group_records:
            if not r["is_valid"]:
                print(f"[row {r['row_num']}] ignored: scheduled time not after submission time", file=sys.stderr)

        if not valid:
            continue  # entire group invalid, nothing to schedule

        latest = max(valid, key=lambda r: r["submitted_dt"])

        entry = {
            "player": latest["name"],
            "time": to_iso_utc(latest["scheduled_dt"]),
            "duration": DEFAULT_DURATION,
        }

        platform, link = detect_platform(latest["link_raw"])
        if platform:
            entry["platform"] = platform
            entry["link"] = link

        schedule.append(entry)

    schedule.sort(key=lambda e: e["time"])
    return schedule


# -------------------------------
# WRITE OUTPUT
# -------------------------------
def write_schedule(schedule, output_path):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(schedule, f, indent=2, ensure_ascii=False)
        f.write("\n")


# -------------------------------
# MAIN
# -------------------------------
def main():
    from fetch_sheet import read_google_sheet

    df = read_google_sheet(SHEET_NAME, WORKSHEET_NAME)
    schedule = build_schedule(df)
    write_schedule(schedule, OUTPUT_PATH)
    print(f"Wrote {len(schedule)} entries to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()