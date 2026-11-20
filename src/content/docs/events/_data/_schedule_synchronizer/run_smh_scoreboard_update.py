import json
import math
import numbers
import os
import re
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

# -------------------------------
# CONFIG
# -------------------------------
TOURNAMENT_NAME = "suis-mahjong-house"  # events/_data/<TOURNAMENT_NAME>/

SPREADSHEET_NAME = "SMH Scoreboard"     # title of the Google spreadsheet file

TOURNAMENT_SCHEDULE_FILE_PRELIM = "preliminary_smh_scoreboard_team.json"
TOURNAMENT_SCHEDULE_FILE_FINALS = "finals_smh_scoreboard_team.json"

# One entry per JSON file to write.
#   worksheet: tab name inside the spreadsheet
#   file:      output file name
#   title:     optional caption shown above the table (None -> no caption)
OUTPUTS = [
    {"worksheet": "Preliminary", "file": TOURNAMENT_SCHEDULE_FILE_PRELIM, "title": None},
    {"worksheet": "Finals", "file": TOURNAMENT_SCHEDULE_FILE_FINALS, "title": None},
]

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
OUTPUT_DIR = os.path.join(REPO_ROOT, "events", "_data", TOURNAMENT_NAME)

# Column indices (0-based). Row 1 holds the headers, entries start on row 2.
#   A Team name | B Player 1 | C Video | D Dollars | E Player 2 | F Video | G Dollars |
#   H Player 3 | I Video | J Dollars | K Yan gained | L Yan spent | M Team Dollars | N Points | (O P/D ratio)
# The P/D ratio column is not read: the scoreboard component calculates it.
COL_TEAM = 0
PLAYER_COLS = [  # (name, video, dollars) for Player 1, 2, 3 in play order
    (1, 2, 3),
    (4, 5, 6),
    (7, 8, 9),
]
COL_YAN_GAINED = 10
COL_YAN_SPENT = 11
COL_TEAM_DOLLARS = 12
COL_POINTS = 13

# The first 14 headers must match these (case-insensitive), otherwise the run stops.
# This protects the public scoreboard if someone inserts or moves a column in the sheet.
EXPECTED_HEADERS = [
    "team name", "player 1", "video", "dollars", "player 2", "video", "dollars",
    "player 3", "video", "dollars", "yan gained", "yan spent", "team dollars", "points",
]

# Google Sheets error values, treated as empty cells. Sheets often appends an explanation,
# e.g. "#N/A (Import Internal Error.)" or "#REF! (Result was not automatically expanded...)",
# so only the start of the text is matched.
SHEET_ERROR_RE = re.compile(r"^#(N/A|REF!|VALUE!|DIV/0!|NAME\?|NULL!|NUM!|ERROR!)", re.I)

# Bare links without https:// are accepted for these hosts (e.g. "youtu.be/abc").
KNOWN_VIDEO_HOSTS = ("youtube.com", "youtu.be", "twitch.tv", "bilibili.com", "b23.tv")


# -------------------------------
# HELPERS
# -------------------------------
def get_cell(row, col):
    """Return the cell at index col, or None if it is empty / an error value / the column doesn't exist.

    Sheets error values (#N/A, #REF!, ...) count as empty. #N/A is skipped silently (it is the
    usual "no data yet" result of a lookup); other errors are treated the same but reported.
    """
    if col is None or col >= len(row):
        return None
    value = row.iloc[col]
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text or text.lower() == "nan":
            return None
        if SHEET_ERROR_RE.match(text):
            if not text.upper().startswith("#N/A"):
                print(f"[row {row.name + 2} column {col + 1}] error value '{text}' treated as empty", file=sys.stderr)
            return None
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def clean_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_number(value, where):
    """Number from a cell, rounded to 2 decimals (whole numbers become ints). None if empty/invalid."""
    if value is None:
        return None
    if isinstance(value, bool):
        print(f"{where} ignored: not a number '{value}'", file=sys.stderr)
        return None
    if isinstance(value, numbers.Real):
        number = float(value)
    else:
        text = str(value).strip().replace("$", "").replace(",", "").replace(" ", "")
        if not text:
            return None
        try:
            number = float(text)
        except ValueError:
            print(f"{where} ignored: not a number '{value}'", file=sys.stderr)
            return None
    if not math.isfinite(number):
        print(f"{where} ignored: not a finite number '{value}'", file=sys.stderr)
        return None
    number = round(number, 2)
    return int(number) if number.is_integer() else number


def normalize_url(text):
    """Return a clean http(s) URL, or None if text isn't one."""
    text = text.strip().strip("<>()[]\"'")
    if not text:
        return None
    if not re.match(r"^[a-z][a-z0-9+.-]*://", text, re.I):
        bare = text.lower()
        bare = bare[4:] if bare.startswith("www.") else bare
        if not any(bare.startswith(host) for host in KNOWN_VIDEO_HOSTS):
            return None
        text = "https://" + text
    parsed = urlparse(text)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.netloc:
        return None
    return text


def parse_videos(value, where):
    """Video cell -> [{"label", "href"}, ...].

    One link per line (or separated by ';', spaces or commas). Optional label before a bar:
        Run 1 | https://youtu.be/abc
        https://youtu.be/def
    Links without a label are called "VOD" (a single link) or "Run 1", "Run 2", ... (several).
    Only http(s) links are kept.
    """
    text = clean_text(value)
    if not text:
        return []

    found = []  # (label or None, url)
    for chunk in re.split(r"[\n;]+", text):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "|" in chunk:
            label, _, rest = chunk.partition("|")
            tokens = rest.split()
            url = normalize_url(tokens[0]) if tokens else None
            if url:
                found.append((label.strip() or None, url))
            else:
                print(f"{where} ignored: no valid link in '{chunk}'", file=sys.stderr)
            continue
        urls = [u for u in (normalize_url(t) for t in re.split(r"[\s,]+", chunk)) if u]
        if urls:
            found.extend((None, u) for u in urls)
        elif "http" in chunk.lower() or "www." in chunk.lower():
            print(f"{where} ignored: no valid link in '{chunk}'", file=sys.stderr)

    videos = []
    seen = set()
    for i, (label, url) in enumerate(found, start=1):
        if url in seen:
            continue
        seen.add(url)
        videos.append({"label": label or ("VOD" if len(found) == 1 else f"Run {i}"), "href": url})
    return videos


def to_iso_utc(dt):
    """Format as 'YYYY-MM-DDTHH:MM:SSZ'."""
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# -------------------------------
# LOAD + BUILD ENTRIES
# -------------------------------
def check_headers(df, label):
    if len(df.columns) == 0:
        raise RuntimeError(f"Worksheet '{label}' is empty (no header row)")
    headers = [str(h).strip().lower() for h in list(df.columns)[: len(EXPECTED_HEADERS)]]
    if headers != EXPECTED_HEADERS:
        raise RuntimeError(
            f"Worksheet '{label}' headers don't match the expected layout.\n"
            f"  expected: {EXPECTED_HEADERS}\n"
            f"  found:    {headers}\n"
            f"If the columns were changed on purpose, update the COL_* constants and EXPECTED_HEADERS."
        )


def build_players(row, where):
    """Players in play order. A missing player is None (so positions stay Player 1, 2, 3)."""
    players = []
    for n, (col_name, col_video, col_dollars) in enumerate(PLAYER_COLS, start=1):
        name = clean_text(get_cell(row, col_name))
        dollars = parse_number(get_cell(row, col_dollars), f"{where} Player {n} dollars")
        videos = parse_videos(get_cell(row, col_video), f"{where} Player {n} video")

        if not name and dollars is None and not videos:
            players.append(None)
            continue
        if not name:
            print(f"{where} Player {n} has data but no name; using 'Player {n}'", file=sys.stderr)
            name = f"Player {n}"

        player = {"name": name}
        if dollars is not None:
            player["dollars"] = dollars
        if videos:
            player["videos"] = videos
        players.append(player)

    while players and players[-1] is None:
        players.pop()
    return players


def build_entries(df, label):
    entries = []
    seen_teams = set()

    for idx, row in df.iterrows():
        row_num = idx + 2  # header is row 1
        where = f"[{label} row {row_num}]"

        # No team name -> no entry. A fully empty row (blank or all #N/A) is dropped silently;
        # a row with data but no team name is dropped with a warning.
        team = clean_text(get_cell(row, COL_TEAM))
        if not team:
            if any(get_cell(row, c) is not None for c in range(len(EXPECTED_HEADERS))):
                print(f"{where} skipped: no team name", file=sys.stderr)
            continue
        if team.lower() in seen_teams:
            print(f"{where} warning: team '{team}' appears more than once", file=sys.stderr)
        seen_teams.add(team.lower())

        entry = {"team": team, "players": build_players(row, where)}
        for key, col in (
            ("yanGained", COL_YAN_GAINED),
            ("yanSpent", COL_YAN_SPENT),
            ("teamDollars", COL_TEAM_DOLLARS),
            ("points", COL_POINTS),
        ):
            number = parse_number(get_cell(row, col), f"{where} {key}")
            if number is not None:
                entry[key] = number
        entries.append(entry)

    return entries


def load_entries(spreadsheet, worksheet):
    from fetch_sheet import read_google_sheet

    label = f"{spreadsheet} / {worksheet}"
    try:
        df, _tz = read_google_sheet(spreadsheet, worksheet)
    except Exception as exc:
        # Abort instead of publishing a scoreboard that silently lacks this tab's teams.
        raise RuntimeError(f"Could not read source '{label}': {exc}") from exc

    check_headers(df, label)
    entries = build_entries(df, label)
    print(f"Source '{label}': {len(entries)} teams", file=sys.stderr)
    return entries


# -------------------------------
# WRITE OUTPUT
# -------------------------------
def read_existing(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def write_scoreboard(path, title, entries):
    """Write the file, unless the data is identical to what is already there."""
    previous = read_existing(path)
    if previous is not None and previous.get("entries") == entries and previous.get("title") == title:
        print(f"Unchanged: {path}")
        return False

    document = {}
    if title:
        document["title"] = title
    document["updated"] = to_iso_utc(datetime.now(timezone.utc))
    document["entries"] = entries

    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(document, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp_path, path)
    print(f"Wrote {len(entries)} teams to {path}")
    return True


# -------------------------------
# MAIN
# -------------------------------
def main():
    # Read and build everything first: if any tab fails, no file is touched.
    built = [(out, load_entries(SPREADSHEET_NAME, out["worksheet"])) for out in OUTPUTS]
    for out, entries in built:
        write_scoreboard(os.path.join(OUTPUT_DIR, out["file"]), out["title"], entries)


if __name__ == "__main__":
    main()