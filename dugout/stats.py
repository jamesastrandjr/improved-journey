"""Batting and fielding numbers, with small-sample shrinkage.

Youth seasons are short, so a kid who goes 3-for-3 isn't really a 1.000 hitter.
Every rate is blended with the team average until a player has enough
at-bats/chances to speak for themselves ("shrinkage").
"""
from .store import BAT_FIELDS, BENCH, POSITIONS, sorted_games

PA_PRIOR = 15      # phantom plate appearances of team-average performance
AB_PRIOR = 20
CHANCE_PRIOR = 8   # phantom fielding chances
DEFAULT_OBP, DEFAULT_SLG, DEFAULT_FPCT = 0.350, 0.350, 0.80


def _div(a, b, default=0.0):
    return a / b if b else default


def batting_totals(team, decay=1.0):
    """Per-player counting stats. decay<1 weights recent games more (form)."""
    games = sorted_games(team)
    totals = {p["name"]: dict.fromkeys(BAT_FIELDS, 0.0) | {"gp": 0.0} for p in team["players"]}
    for i, g in enumerate(games):
        w = decay ** (len(games) - 1 - i)
        for name, line in g.get("batting", {}).items():
            if name not in totals:
                continue
            t = totals[name]
            t["gp"] += w
            for f in BAT_FIELDS:
                t[f] += w * line.get(f, 0)
    return totals


def rates(c):
    ab, h = c["ab"], c["h"]
    pa = ab + c["bb"] + c["hbp"] + c["sac"]
    singles = h - c["2b"] - c["3b"] - c["hr"]
    tb = singles + 2 * c["2b"] + 3 * c["3b"] + 4 * c["hr"]
    r = {
        "pa": pa,
        "avg": _div(h, ab),
        "obp": _div(h + c["bb"] + c["hbp"], pa),
        "slg": _div(tb, ab),
        "k_rate": _div(c["k"], pa),
        "sb_per_pa": _div(c["sb"], pa),
    }
    r["ops"] = r["obp"] + r["slg"]
    return r


def league_rates(totals):
    agg = dict.fromkeys(BAT_FIELDS, 0.0)
    for t in totals.values():
        for f in BAT_FIELDS:
            agg[f] += t[f]
    lg = rates(agg)
    if lg["pa"] < 20:  # not enough data yet: use sensible youth-ball defaults
        return {"obp": DEFAULT_OBP, "slg": DEFAULT_SLG, "avg": 0.250, "k_rate": 0.20}
    return lg


def shrunk_rates(c, lg):
    """Rates pulled toward the team average in proportion to sample size."""
    ab, h = c["ab"], c["h"]
    pa = ab + c["bb"] + c["hbp"] + c["sac"]
    tb = (h - c["2b"] - c["3b"] - c["hr"]) + 2 * c["2b"] + 3 * c["3b"] + 4 * c["hr"]
    obp = (h + c["bb"] + c["hbp"] + PA_PRIOR * lg["obp"]) / (pa + PA_PRIOR)
    slg = (tb + AB_PRIOR * lg["slg"]) / (ab + AB_PRIOR)
    avg = (h + AB_PRIOR * lg["avg"]) / (ab + AB_PRIOR)
    k_rate = (c["k"] + PA_PRIOR * lg["k_rate"]) / (pa + PA_PRIOR)
    return {"obp": obp, "slg": slg, "avg": avg, "ops": obp + slg, "k_rate": k_rate,
            "sb_per_pa": _div(c["sb"], pa)}


def fielding_data(team):
    """Per player: innings/chances/errors by position, bench innings, games played."""
    data = {p["name"]: {"pos": {}, "bench": 0, "games": 0, "innings": 0}
            for p in team["players"]}
    for g in sorted_games(team):
        for name, f in g.get("fielding", {}).items():
            if name not in data:
                continue
            d = data[name]
            innings = [x for x in f.get("innings", [])]
            d["games"] += 1
            d["bench"] += innings.count(BENCH)
            played = [x for x in innings if x != BENCH]
            d["innings"] += len(played)
            for pos in played:
                s = d["pos"].setdefault(pos, {"inn": 0, "ch": 0, "e": 0})
                s["inn"] += 1
            if played:  # chances/errors are credited to the main position played
                main = max(set(played), key=played.count)
                s = d["pos"][main]
                s["ch"] += f.get("ch", 0)
                s["e"] += f.get("e", 0)
    return data


def fielding_pct(chances, errors, prior_pct, k=CHANCE_PRIOR):
    return (chances - errors + k * prior_pct) / (chances + k)


def overall_fielding(d):
    ch = sum(s["ch"] for s in d["pos"].values())
    e = sum(s["e"] for s in d["pos"].values())
    return ch, e


def team_fielding_pct(fdata):
    ch = e = 0
    for d in fdata.values():
        c, er = overall_fielding(d)
        ch, e = ch + c, e + er
    return (ch - e) / ch if ch >= 20 else DEFAULT_FPCT


def season_table(team, decay=1.0):
    """Rows of raw season (or recent-form) stats for display."""
    totals = batting_totals(team, decay)
    rows = []
    for p in team["players"]:
        t = totals[p["name"]]
        r = rates(t)
        rows.append({"name": p["name"], "gp": t["gp"], **{f: t[f] for f in BAT_FIELDS}, **r})
    return rows
