#!/usr/bin/env python3
"""Author data/fd_team_aliases.csv: football-data.org team id -> our FIFA code.

One-time / re-runnable. Needs FOOTBALL_DATA_API_KEY in the env. Fetches the WC
squad list and maps each football-data team name to our FIFA code via NAME_TO_CODE
(kept in sync with scripts/gen_fixtures.py). Run: FOOTBALL_DATA_API_KEY=... \
  python3 scripts/gen_fd_aliases.py
"""
import csv
import json
import os
import urllib.request

# football-data.org team name -> our FIFA code. Extend if the API renames a team.
NAME_TO_CODE = {
    "Mexico": "MEX", "South Africa": "RSA", "Korea Republic": "KOR", "Czechia": "CZE",
    "Bosnia and Herzegovina": "BIH", "Canada": "CAN", "Qatar": "QAT", "Switzerland": "SUI",
    "Brazil": "BRA", "Haiti": "HAI", "Morocco": "MAR", "Scotland": "SCO",
    "Australia": "AUS", "Paraguay": "PAR", "Türkiye": "TUR", "United States": "USA",
    "Curaçao": "CUW", "Ecuador": "ECU", "Germany": "GER", "Côte d'Ivoire": "CIV",
    "Japan": "JPN", "Netherlands": "NED", "Sweden": "SWE", "Tunisia": "TUN",
    "Belgium": "BEL", "Egypt": "EGY", "Iran": "IRN", "New Zealand": "NZL",
    "Cape Verde": "CPV", "Saudi Arabia": "KSA", "Spain": "ESP", "Uruguay": "URU",
    "France": "FRA", "Iraq": "IRQ", "Norway": "NOR", "Senegal": "SEN",
    "Algeria": "ALG", "Argentina": "ARG", "Austria": "AUT", "Jordan": "JOR",
    "Colombia": "COL", "DR Congo": "COD", "Portugal": "POR", "Uzbekistan": "UZB",
    "Croatia": "CRO", "England": "ENG", "Ghana": "GHA", "Panama": "PAN",
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ["FOOTBALL_DATA_API_KEY"]


def main():
    req = urllib.request.Request(
        "https://api.football-data.org/v4/competitions/WC/teams",
        headers={"X-Auth-Token": KEY},
    )
    teams = json.load(urllib.request.urlopen(req))["teams"]
    rows, unmapped = [], []
    for t in teams:
        code = NAME_TO_CODE.get(t["name"])
        if not code:
            unmapped.append(t["name"])
            continue
        rows.append([t["id"], code])
    if unmapped:
        raise SystemExit(f"unmapped football-data team names (add to NAME_TO_CODE): {unmapped}")
    rows.sort(key=lambda r: r[1])
    with open(os.path.join(ROOT, "data", "fd_team_aliases.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["fd_team_id", "fifa_code"])
        w.writerows(rows)
    print(f"wrote {len(rows)} aliases")


if __name__ == "__main__":
    main()
