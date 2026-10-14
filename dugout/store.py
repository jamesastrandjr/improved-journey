"""Tiny JSON file store for the team, roster and game history."""
import json
import os
import tempfile

BAT_FIELDS = ["ab", "h", "2b", "3b", "hr", "bb", "hbp", "k", "r", "rbi", "sb", "sac"]
POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"]
BENCH = "B"

DEFAULT_SETTINGS = {
    "innings": 6,          # innings per game
    "max_pitch_inn": 2,    # most innings one player may pitch in a game
    "max_catch_inn": 3,    # most innings one player may catch in a game
}


def new_team(name="My Team", innings=6):
    settings = dict(DEFAULT_SETTINGS, innings=innings)
    return {"name": name, "settings": settings, "players": [], "games": []}


def load(path):
    with open(path, encoding="utf-8") as f:
        team = json.load(f)
    team.setdefault("settings", {})
    for k, v in DEFAULT_SETTINGS.items():
        team["settings"].setdefault(k, v)
    return team


def save(path, team):
    """Write atomically so a crash never corrupts a season of data."""
    directory = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=directory, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(team, f, indent=2, sort_keys=True)
    os.replace(tmp, path)


def find_player(team, name):
    for p in team["players"]:
        if p["name"].lower() == name.strip().lower():
            return p
    return None


def player_names(team):
    return [p["name"] for p in team["players"]]


def sorted_games(team):
    return sorted(team["games"], key=lambda g: g["date"])
