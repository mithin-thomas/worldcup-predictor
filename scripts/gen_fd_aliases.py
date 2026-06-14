#!/usr/bin/env python3
"""Author data/fd_team_aliases.csv: football-data.org team id -> our FIFA code.

One-time / re-runnable. Needs FOOTBALL_DATA_API_KEY in the env. Reads the WC team
list from /v4/competitions/WC/teams and maps each team by its football-data `tla`
(3-letter code), which equals our FIFA code for all but the few exceptions in
TLA_OVERRIDE. Mapping by `tla` (not display name) is robust: football-data's team
`name` varies across endpoints (e.g. "South Korea" vs "Korea Republic"), but the
`tla` is stable. Every resolved code is validated against data/teams.csv; an
unknown tla fails loud so it can be added to the override. Run:
  FOOTBALL_DATA_API_KEY=... python3 scripts/gen_fd_aliases.py
"""
import csv
import json
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ["FOOTBALL_DATA_API_KEY"]

# football-data `tla` -> our FIFA code, only where they differ (tla == our code otherwise).
TLA_OVERRIDE = {"URY": "URU"}  # Uruguay


def our_codes():
    with open(os.path.join(ROOT, "data", "teams.csv"), encoding="utf-8") as f:
        return {row["fifa_code"] for row in csv.DictReader(f)}


def main():
    req = urllib.request.Request(
        "https://api.football-data.org/v4/competitions/WC/teams",
        headers={"X-Auth-Token": KEY},
    )
    teams = json.load(urllib.request.urlopen(req))["teams"]
    valid = our_codes()
    rows, unmapped = [], []
    for t in teams:
        code = TLA_OVERRIDE.get(t["tla"], t["tla"])
        if code not in valid:
            unmapped.append(f'{t["tla"]} ({t["name"]})')
            continue
        rows.append([t["id"], code])
    if unmapped:
        raise SystemExit(f"unmapped football-data teams (add to TLA_OVERRIDE): {unmapped}")
    rows.sort(key=lambda r: r[1])
    with open(os.path.join(ROOT, "data", "fd_team_aliases.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["fd_team_id", "fifa_code"])
        w.writerows(rows)
    print(f"wrote {len(rows)} aliases")


if __name__ == "__main__":
    main()
