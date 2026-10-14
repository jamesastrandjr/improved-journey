"""Command line interface. Run `python -m dugout --help`."""
import argparse
import csv
import datetime
import os
import random
import sys

from . import lineup, stats, store
from .store import BAT_FIELDS, BENCH, POSITIONS

DEFAULT_FILE = "team_data.json"
CSV_COLUMNS = ["player"] + BAT_FIELDS + ["positions", "ch", "e"]


# ---------------------------------------------------------------- helpers
def parse_positions(text, innings):
    """'SS*2 3B B*3' or 'SS,SS,3B,B,B,B' -> ['SS','SS','3B','B','B','B']."""
    out = []
    for tok in text.replace(",", " ").split():
        pos, _, rep = tok.upper().partition("*")
        if pos not in POSITIONS + [BENCH]:
            raise ValueError(f"unknown position '{pos}' (use {' '.join(POSITIONS)} or B for bench)")
        out += [pos] * (int(rep) if rep else 1)
    if len(out) != innings:
        raise ValueError(f"need {innings} innings of positions, got {len(out)}")
    return out


def int_or_zero(s):
    s = (s or "").strip()
    return int(s) if s else 0


def resolve(team, text):
    p = store.find_player(team, text)
    if not p:
        raise SystemExit(f"No player named '{text}'. Roster: {', '.join(store.player_names(team))}")
    return p["name"]


def need_team(path):
    if not os.path.exists(path):
        raise SystemExit(f"No data file at {path}. Start with: python -m dugout init --team \"Team Name\"")
    return store.load(path)


def table(rows, headers):
    widths = [max(len(str(h)), *(len(str(r[i])) for r in rows)) if rows else len(str(h))
              for i, h in enumerate(headers)]
    fmt = lambda r: "  ".join(str(c).ljust(w) if i == 0 else str(c).rjust(w)
                              for i, (c, w) in enumerate(zip(r, widths)))
    return "\n".join([fmt(headers), "  ".join("-" * w for w in widths)] + [fmt(r) for r in rows])


def rate(x):
    return f"{x:.3f}".lstrip("0") if x < 1 else f"{x:.3f}"


# ---------------------------------------------------------------- commands
def cmd_init(a):
    if os.path.exists(a.data) and not a.force:
        raise SystemExit(f"{a.data} already exists (use --force to overwrite)")
    store.save(a.data, store.new_team(a.team, a.innings))
    print(f"Created {a.data}. Add players with: python -m dugout add-player \"Name\"")


def cmd_add_player(a):
    team = need_team(a.data)
    if store.find_player(team, a.name):
        raise SystemExit(f"{a.name} is already on the roster")
    team["players"].append({"name": a.name, "number": a.number, "pref": {}})
    store.save(a.data, team)
    print(f"Added {a.name}. Roster size: {len(team['players'])}")


def cmd_rate(a):
    """Coach rating 1-5 for how comfortable a player is at a position."""
    team = need_team(a.data)
    p = store.find_player(team, a.name)
    if not p:
        raise SystemExit(f"No player named '{a.name}'")
    pos = a.position.upper()
    if pos not in POSITIONS or not 1 <= a.rating <= 5:
        raise SystemExit(f"position must be one of {' '.join(POSITIONS)}; rating 1-5")
    p.setdefault("pref", {})[pos] = a.rating
    store.save(a.data, team)
    print(f"{p['name']} at {pos}: {a.rating}/5")


def cmd_players(a):
    team = need_team(a.data)
    for p in team["players"]:
        prefs = " ".join(f"{k}:{v}" for k, v in sorted(p.get("pref", {}).items()))
        num = f"#{p['number']}" if p.get("number") else ""
        print(f"{p['name']:<16}{num:<5}{prefs}")


def _save_game(team, game, path):
    team["games"] = [g for g in team["games"] if g["date"] != game["date"]]  # re-entering a date replaces it
    team["games"].append(game)
    store.save(path, team)
    print(f"Saved game {game['date']} vs {game['opponent']} ({game['us']}-{game['them']}).")


def cmd_template(a):
    team = need_team(a.data)
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(CSV_COLUMNS)
        for p in team["players"]:
            w.writerow([p["name"]] + [""] * (len(CSV_COLUMNS) - 1))
    print(f"Wrote {a.out}. Fill it in (delete rows for absent players; list rows in batting order),\n"
          f"then: python -m dugout import-game {a.out} --opponent NAME --us 0 --them 0")


def cmd_import_game(a):
    team = need_team(a.data)
    innings = team["settings"]["innings"]
    game = {"date": a.date, "opponent": a.opponent, "us": a.us, "them": a.them,
            "innings": innings, "batting": {}, "fielding": {}, "batting_order": []}
    with open(a.file, newline="", encoding="utf-8-sig") as f:
        for n, row in enumerate(csv.DictReader(f), 2):
            row = {k.strip().lower(): v for k, v in row.items() if k}
            name = resolve(team, row.get("player", ""))
            game["batting_order"].append(name)
            line = {k: int_or_zero(row.get(k)) for k in BAT_FIELDS}
            if line["h"] > line["ab"] or line["2b"] + line["3b"] + line["hr"] > line["h"]:
                raise SystemExit(f"Row {n} ({name}): hits can't exceed at-bats / extra-base hits can't exceed hits")
            game["batting"][name] = line
            if (row.get("positions") or "").strip():
                try:
                    inn = parse_positions(row["positions"], innings)
                except ValueError as e:
                    raise SystemExit(f"Row {n} ({name}): {e}")
                game["fielding"][name] = {"innings": inn, "ch": int_or_zero(row.get("ch")),
                                          "e": int_or_zero(row.get("e"))}
    _save_game(team, game, a.data)


def cmd_add_game(a):
    """Type the game in at the keyboard, one line per player."""
    team = need_team(a.data)
    innings = team["settings"]["innings"]
    game = {"date": a.date, "opponent": a.opponent, "us": a.us, "them": a.them,
            "innings": innings, "batting": {}, "fielding": {}, "batting_order": []}
    print(f"Batting numbers in this order:  {' '.join(f.upper() for f in BAT_FIELDS)}")
    print("Blank line = player absent. Positions example: SS*3 3B*2 B  (B = bench)\n")
    for p in team["players"]:
        name = p["name"]
        while True:
            raw = input(f"{name} stats: ").strip()
            if not raw:
                break
            try:
                nums = [int(x) for x in raw.replace(",", " ").split()]
                if len(nums) > len(BAT_FIELDS):
                    raise ValueError(f"at most {len(BAT_FIELDS)} numbers")
                line = dict(zip(BAT_FIELDS, nums + [0] * (len(BAT_FIELDS) - len(nums))))
                if line["h"] > line["ab"] or line["2b"] + line["3b"] + line["hr"] > line["h"]:
                    raise ValueError("hits can't exceed at-bats / extra-base hits can't exceed hits")
                pos = input("   innings (positions): ").strip()
                inn = parse_positions(pos, innings) if pos else None
                ch = e = 0
                if inn and any(x != BENCH for x in inn):
                    ce = input("   fielding chances, errors (e.g. 4 1): ").split()
                    ch, e = (int(ce[0]), int(ce[1])) if len(ce) == 2 else (0, 0)
            except ValueError as err:
                print(f"   ! {err}. Try again.")
                continue
            game["batting"][name] = line
            game["batting_order"].append(name)
            if inn:
                game["fielding"][name] = {"innings": inn, "ch": ch, "e": e}
            break
    _save_game(team, game, a.data)


def cmd_stats(a):
    team = need_team(a.data)
    decay = a.form if a.form else 1.0
    rows = stats.season_table(team, decay)
    rows.sort(key=lambda r: r["ops"], reverse=True)
    title = "RECENT FORM (recent games weighted more)" if a.form else "SEASON BATTING"
    print(title)
    print(table([[r["name"], f"{r['gp']:.0f}" if not a.form else f"{r['gp']:.1f}", f"{r['ab']:.0f}",
                  f"{r['h']:.0f}", rate(r["avg"]), rate(r["obp"]), rate(r["slg"]), rate(r["ops"]),
                  f"{r['r']:.0f}", f"{r['rbi']:.0f}", f"{r['sb']:.0f}", f"{r['k']:.0f}"] for r in rows],
                ["Player", "GP", "AB", "H", "AVG", "OBP", "SLG", "OPS", "R", "RBI", "SB", "K"]))
    fd = stats.fielding_data(team)
    print("\nFIELDING & PLAYING TIME")
    frows = []
    for p in team["players"]:
        d = fd[p["name"]]
        ch, e = stats.overall_fielding(d)
        spots = " ".join(f"{k}:{v['inn']}" for k, v in sorted(d["pos"].items(), key=lambda kv: -kv[1]["inn"]))
        frows.append([p["name"], d["games"], d["innings"], d["bench"],
                      rate((ch - e) / ch) if ch else "-", e, spots])
    print(table(frows, ["Player", "GP", "Inn", "Bench", "FPCT", "E", "Innings by position"]))
    games = store.sorted_games(team)
    if games:
        w = sum(g["us"] > g["them"] for g in games)
        l = sum(g["us"] < g["them"] for g in games)
        print(f"\nRecord: {w}-{l}-{len(games) - w - l}")


def cmd_positions(a):
    team = need_team(a.data)
    prof = lineup.build_profiles(team)
    best = lineup.best_positions(prof, top=3)
    print("BEST POSITIONS (blend of your 1-5 ratings, fielding record, and experience)\n")
    for name, picks in best.items():
        print(f"{name:<16}" + "   ".join(f"{p} ({s:.2f})" for p, s in picks))
    print("\nTip: give ratings with  python -m dugout rate \"Name\" SS 4  to teach the planner what you see.")


def cmd_lineup(a):
    team = need_team(a.data)
    names = store.player_names(team)
    absent = {resolve(team, x) for x in (a.absent or "").split(",") if x.strip()}
    present = [resolve(team, x) for x in a.present.split(",")] if a.present else names
    present = [n for n in present if n not in absent]
    if len(present) < 4:
        raise SystemExit("Need at least 4 players present")
    if len(present) < 9:
        print(f"Note: only {len(present)} players, some positions will be uncovered.\n")
    innings = a.innings or team["settings"]["innings"]
    prof = lineup.build_profiles(team, decay=a.form)
    order = lineup.batting_order(team, present, prof, a.balance)
    plan = lineup.field_plan(team, present, prof, a.balance, innings)
    print(f"LINEUP for {team['name']} — {len(present)} players, balance {a.balance:.2f} "
          f"(0 = win-now, 1 = equal for all)\n")
    print(lineup.format_plan(order, plan, innings))
    print("\nField at each inning (who is where):")
    for i in range(innings):
        spots = {plan[n][i]: n for n in present if plan[n][i] != BENCH}
        sit = [n for n in present if plan[n][i] == BENCH]
        print(f"  Inn {i + 1}: " + " ".join(f"{p}:{spots.get(p, '--').split()[0]}" for p in POSITIONS)
              + (f"  | Bench: {', '.join(sit)}" if sit else ""))


def cmd_report(a):
    """Positive talking points for every player, plus a playing-time audit."""
    team = need_team(a.data)
    rows = {r["name"]: r for r in stats.season_table(team)}
    totals = stats.batting_totals(team)
    lg = stats.league_rates(totals)
    prof = lineup.build_profiles(team, decay=1.0)
    fd = stats.fielding_data(team)
    games = store.sorted_games(team)
    cats = {
        "on-base percentage": lambda n: prof[n]["bat"]["obp"],
        "slugging (power)": lambda n: prof[n]["bat"]["slg"],
        "making contact (fewest strikeouts)": lambda n: -prof[n]["bat"]["k_rate"],
        "stolen bases": lambda n: rows[n]["sb"],
        "RBIs": lambda n: rows[n]["rbi"],
        "runs scored": lambda n: rows[n]["r"],
        "fielding (sure-handed)": lambda n: prof[n]["fpct"],
    }
    names = [p["name"] for p in team["players"] if rows[p["name"]]["gp"]]
    if not names:
        raise SystemExit("No games recorded yet.")
    print("WHAT EACH PLAYER BRINGS (use these when talking with the kids and parents)\n")
    for n in names:
        ranks = []
        for label, key in cats.items():
            vals = sorted((key(m) for m in names), reverse=True)
            if key(n) > vals[-1] or len(set(vals)) > 1:
                ranks.append((vals.index(key(n)) + 1, label))
        ranks = sorted(r for r in ranks if r[0] <= 3)
        lines = [f"Top {r[0]} on team in {r[1]}" if r[0] > 1 else f"Team leader in {r[1]}" for r in ranks[:2]]
        if not lines:
            lines = [f"Showed up for {rows[n]['gp']:.0f} games and is building their numbers"]
        recent = [g for g in games[-3:] if n in g.get("batting", {})]
        if len(recent) >= 2 and rows[n]["gp"] >= 4:
            rc = {f: sum(g["batting"][n][f] for g in recent) for f in BAT_FIELDS}
            if stats.rates(rc)["obp"] > rows[n]["obp"] + 0.05:
                lines.append("Trending up — on base more often lately")
        best = max(lineup.POSITIONS, key=lambda p: prof[n]["skill"][p])
        lines.append(f"Best fit in the field: {best}")
        print(f"{n:<16}" + "; ".join(lines))
    print("\nPLAYING-TIME AUDIT (innings on the bench per game attended)")
    avg = {n: fd[n]["bench"] / fd[n]["games"] for n in names if fd[n]["games"]}
    if avg:
        mean = sum(avg.values()) / len(avg)
        for n, v in sorted(avg.items(), key=lambda kv: -kv[1]):
            flag = "  <-- owed more field time" if v > mean + 0.75 else ""
            print(f"  {n:<16}{v:4.1f}{flag}")
    avg_slot = {n: lineup.recent_slot_fraction(team, n, last=len(games)) for n in names}
    low = [n for n, v in avg_slot.items() if v > 0.7]
    if low:
        print(f"\nOften batting at the bottom: {', '.join(low)} — the lineup tool nudges them up over time.")


def cmd_demo(a):
    """Build a made-up 10-player, 6-game season so you can try everything."""
    rng = random.Random(7)
    names = ["Ben", "Carlos", "Dylan", "Ethan", "Finn", "Gabe", "Henry", "Isaac", "Jack", "Kai"]
    skill = {n: 0.10 + 0.03 * i + rng.uniform(-0.04, 0.04) for i, n in enumerate(reversed(names))}
    team = store.new_team("Demo Dragons", innings=6)
    team["players"] = [{"name": n, "number": i + 1, "pref": {}} for i, n in enumerate(names)]
    team["players"][0]["pref"] = {"P": 5, "SS": 4}
    team["players"][1]["pref"] = {"C": 5}
    start = datetime.date.today() - datetime.timedelta(days=7 * 6)
    for w in range(6):
        present = [n for n in names if rng.random() > 0.1] or names
        rng.shuffle(present)
        g = {"date": (start + datetime.timedelta(days=7 * w)).isoformat(), "opponent": f"Team {w + 1}",
             "us": rng.randint(3, 12), "them": rng.randint(3, 12), "innings": 6,
             "batting": {}, "fielding": {}, "batting_order": present}
        for n in present:
            ab = rng.randint(2, 4)
            h = sum(rng.random() < skill[n] + 0.1 for _ in range(ab))
            xb = sum(rng.random() < 0.25 for _ in range(h))
            g["batting"][n] = {"ab": ab, "h": h, "2b": xb, "3b": 0, "hr": 0, "bb": rng.randint(0, 1),
                               "hbp": 0, "k": rng.randint(0, 2), "r": rng.randint(0, 2),
                               "rbi": rng.randint(0, 2), "sb": rng.randint(0, 1), "sac": 0}
        prof = lineup.build_profiles(team)
        plan = lineup.field_plan(team, present, prof, 0.7, 6)
        for n in present:
            g["fielding"][n] = {"innings": plan[n], "ch": rng.randint(0, 5), "e": rng.randint(0, 1)}
        team["games"].append(g)
    store.save(a.data, team)
    print(f"Wrote demo season to {a.data}. Try:  stats | report | positions | lineup --absent Ben")


# ---------------------------------------------------------------- parser
def build_parser():
    p = argparse.ArgumentParser(prog="dugout", description="Youth baseball stats and fair lineup planner")
    p.add_argument("--data", default=DEFAULT_FILE, help=f"data file (default {DEFAULT_FILE})")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("init", help="create a new team file")
    s.add_argument("--team", default="My Team")
    s.add_argument("--innings", type=int, default=6)
    s.add_argument("--force", action="store_true")
    s.set_defaults(fn=cmd_init)

    s = sub.add_parser("add-player", help="add a player to the roster")
    s.add_argument("name")
    s.add_argument("--number", type=int)
    s.set_defaults(fn=cmd_add_player)

    s = sub.add_parser("rate", help="your 1-5 rating of a player at a position")
    s.add_argument("name"); s.add_argument("position"); s.add_argument("rating", type=int)
    s.set_defaults(fn=cmd_rate)

    s = sub.add_parser("players", help="list roster"); s.set_defaults(fn=cmd_players)

    today = datetime.date.today().isoformat()
    for name, fn, helptext in (("add-game", cmd_add_game, "enter a game by typing it in"),
                               ("import-game", cmd_import_game, "enter a game from a CSV file")):
        s = sub.add_parser(name, help=helptext)
        if name == "import-game":
            s.add_argument("file")
        s.add_argument("--date", default=today, help="YYYY-MM-DD (default today)")
        s.add_argument("--opponent", default="?")
        s.add_argument("--us", type=int, default=0, help="our runs")
        s.add_argument("--them", type=int, default=0, help="their runs")
        s.set_defaults(fn=fn)

    s = sub.add_parser("template", help="write a blank game CSV with your roster")
    s.add_argument("--out", default="game.csv"); s.set_defaults(fn=cmd_template)

    s = sub.add_parser("stats", help="season stats")
    s.add_argument("--form", type=float, nargs="?", const=0.8, help="weight recent games more (e.g. 0.8)")
    s.set_defaults(fn=cmd_stats)

    s = sub.add_parser("positions", help="best positions for each player"); s.set_defaults(fn=cmd_positions)

    s = sub.add_parser("lineup", help="suggest batting order + defense for the next game")
    s.add_argument("--present", help="comma-separated names (default: whole roster)")
    s.add_argument("--absent", help="comma-separated names who can't make it")
    s.add_argument("--balance", type=float, default=0.7, help="0 = win now ... 1 = perfectly equal (default 0.7)")
    s.add_argument("--form", type=float, default=0.85, help="recency weight 0-1 (1 = whole season counts equally)")
    s.add_argument("--innings", type=int)
    s.set_defaults(fn=cmd_lineup)

    s = sub.add_parser("report", help="strengths to praise + playing-time audit"); s.set_defaults(fn=cmd_report)
    s = sub.add_parser("demo", help="create a fake season to try things out"); s.set_defaults(fn=cmd_demo)
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        args.fn(args)
    except (EOFError, KeyboardInterrupt):
        print("\nCancelled; nothing saved.")
        return 1
    return 0
