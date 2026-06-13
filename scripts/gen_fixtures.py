#!/usr/bin/env python3
"""Regenerate data/teams.csv + data/matches.csv from the committed openfootball
World Cup 2026 dataset (data/source/worldcup2026.openfootball.json).

openfootball is public-domain, maintained, and accurate (verified against the
official schedule). It carries the *resolved* 48 teams (no playoff placeholders)
and venue-local kickoff times with offsets. host_cities.csv and
tournament_stages.csv are unchanged. Run: python3 scripts/gen_fixtures.py
"""
import csv
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "source", "worldcup2026.openfootball.json")
DATA = os.path.join(ROOT, "data")

# openfootball team name -> (FIFA code, flag-icons ISO key)
TEAM = {
    "Czech Republic": ("CZE", "cz"), "Mexico": ("MEX", "mx"),
    "South Africa": ("RSA", "za"), "South Korea": ("KOR", "kr"),
    "Bosnia & Herzegovina": ("BIH", "ba"), "Canada": ("CAN", "ca"),
    "Qatar": ("QAT", "qa"), "Switzerland": ("SUI", "ch"),
    "Brazil": ("BRA", "br"), "Haiti": ("HAI", "ht"),
    "Morocco": ("MAR", "ma"), "Scotland": ("SCO", "gb-sct"),
    "Australia": ("AUS", "au"), "Paraguay": ("PAR", "py"),
    "Turkey": ("TUR", "tr"), "USA": ("USA", "us"),
    "Curaçao": ("CUW", "cw"), "Ecuador": ("ECU", "ec"),
    "Germany": ("GER", "de"), "Ivory Coast": ("CIV", "ci"),
    "Japan": ("JPN", "jp"), "Netherlands": ("NED", "nl"),
    "Sweden": ("SWE", "se"), "Tunisia": ("TUN", "tn"),
    "Belgium": ("BEL", "be"), "Egypt": ("EGY", "eg"),
    "Iran": ("IRN", "ir"), "New Zealand": ("NZL", "nz"),
    "Cape Verde": ("CPV", "cv"), "Saudi Arabia": ("KSA", "sa"),
    "Spain": ("ESP", "es"), "Uruguay": ("URU", "uy"),
    "France": ("FRA", "fr"), "Iraq": ("IRQ", "iq"),
    "Norway": ("NOR", "no"), "Senegal": ("SEN", "sn"),
    "Algeria": ("ALG", "dz"), "Argentina": ("ARG", "ar"),
    "Austria": ("AUT", "at"), "Jordan": ("JOR", "jo"),
    "Colombia": ("COL", "co"), "DR Congo": ("COD", "cd"),
    "Portugal": ("POR", "pt"), "Uzbekistan": ("UZB", "uz"),
    "Croatia": ("CRO", "hr"), "England": ("ENG", "gb-eng"),
    "Ghana": ("GHA", "gh"), "Panama": ("PAN", "pa"),
}

# openfootball round name -> our tournament_stages.csv id
STAGE_ID = {
    "Round of 32": 2, "Round of 16": 3, "Quarter-final": 4,
    "Semi-final": 5, "Match for third place": 6, "Final": 7,
}  # any "Matchday N" -> 1 (group stage)


def stage_id(round_name):
    return 1 if round_name.startswith("Matchday") else STAGE_ID[round_name]


def kickoff_at(time_str):
    # "12:00 UTC-7" -> "12:00:00-07"
    hm, tz = time_str.split(" UTC")
    sign, hours = tz[0], int(tz[1:])
    return f"{hm}:00{sign}{abs(hours):02d}"


def load_city_ids():
    ids = {}
    with open(os.path.join(DATA, "host_cities.csv"), encoding="utf-8") as f:
        for row in csv.DictReader(f):
            ids[row["city_name"]] = int(row["id"])
    return ids


def main():
    city_id = load_city_ids()

    def ground_id(ground):
        base = ground.split(" (")[0]  # "Boston (Foxborough)" -> "Boston"
        if base not in city_id:
            raise SystemExit(f"unmapped ground: {ground!r}")
        return city_id[base]

    matches = json.load(open(SRC, encoding="utf-8"))["matches"]

    # Teams: assign a stable source id per real (group-stage) team.
    team_id, team_rows = {}, []
    for m in matches:
        g = m.get("group", "") or ""
        if not g.startswith("Group"):
            continue
        letter = g.split()[1]
        for name in (m["team1"], m["team2"]):
            if name not in team_id:
                if name not in TEAM:
                    raise SystemExit(f"unmapped team: {name!r}")
                tid = len(team_id) + 1
                team_id[name] = tid
                code, _iso = TEAM[name]
                team_rows.append([tid, name, code, letter, "False"])

    # Matches.
    match_rows = []
    for i, m in enumerate(matches, start=1):
        rnd = m["round"]
        g = m.get("group", "") or ""
        if g.startswith("Group"):
            letter = g.split()[1]
            home, away = team_id[m["team1"]], team_id[m["team2"]]
            label = f"Group {letter}"
        else:
            home, away = "", ""  # knockout placeholders
            label = f'{m["team1"]} vs {m["team2"]}'
        kickoff = f'{m["date"]} {kickoff_at(m["time"])}'  # "2026-06-13 12:00:00-07"
        match_rows.append([
            i, i, home, away, ground_id(m["ground"]), stage_id(rnd),
            kickoff, label,
        ])

    with open(os.path.join(DATA, "teams.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "team_name", "fifa_code", "group_letter", "is_placeholder"])
        w.writerows(team_rows)

    with open(os.path.join(DATA, "matches.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "match_number", "home_team_id", "away_team_id",
                    "city_id", "stage_id", "kickoff_at", "match_label"])
        w.writerows(match_rows)

    print(f"wrote {len(team_rows)} teams, {len(match_rows)} matches")


if __name__ == "__main__":
    main()
