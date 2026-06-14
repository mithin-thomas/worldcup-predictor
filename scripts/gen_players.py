#!/usr/bin/env python3
"""Author data/players.csv from football-data squads.

For each football-data team in data/fd_team_aliases.csv, fetch /v4/teams/{id},
read squad[], and emit (source_id, team_fifa_code, name, position). Throttled
(~7s/call) for the free tier's ~10 req/min. Needs FOOTBALL_DATA_API_KEY.
Run: FOOTBALL_DATA_API_KEY=... python3 scripts/gen_players.py
"""
import csv
import json
import os
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ["FOOTBALL_DATA_API_KEY"]
BASE = os.environ.get("FOOTBALL_DATA_BASE_URL", "https://api.football-data.org/v4")


def aliases():
    with open(os.path.join(ROOT, "data", "fd_team_aliases.csv"), encoding="utf-8") as f:
        return [(int(r["fd_team_id"]), r["fifa_code"]) for r in csv.DictReader(f)]


def fetch(fd_id, retry=3):
    req = urllib.request.Request(
        f"{BASE}/teams/{fd_id}",
        headers={"X-Auth-Token": KEY},
    )
    for attempt in range(retry):
        try:
            return json.load(urllib.request.urlopen(req)).get("squad") or []
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 60
                print(f"  429 rate-limited — sleeping {wait}s before retry {attempt + 1}/{retry}")
                time.sleep(wait)
                continue
            raise
    raise RuntimeError(f"failed to fetch team {fd_id} after {retry} retries")


def main():
    rows = []
    for fd_id, code in aliases():
        squad = fetch(fd_id)
        for p in squad:
            rows.append([p["id"], code, p["name"], p.get("position") or ""])
        print(f"{code}: {len(squad)} players")
        time.sleep(7)  # rate limit: free tier allows ~10 req/min
    rows.sort(key=lambda r: (r[1], r[2]))
    with open(os.path.join(ROOT, "data", "players.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["source_id", "team_fifa_code", "name", "position"])
        w.writerows(rows)
    print(f"wrote {len(rows)} players across {len(aliases())} teams")


if __name__ == "__main__":
    main()
