"""Batting order and defensive plan.

`balance` runs 0..1:
  0.0 -> pure "win now": best players play and bat in the best spots.
  1.0 -> pure "everyone matters": playing time and good positions rotate evenly.
The default (0.7) keeps playing time close to even and lets skill decide the
tie-breaks, plus where each kid plays and bats.
"""

from .store import BENCH, POSITIONS, sorted_games
from . import stats

INFIELD_PREMIUM = {"P", "C", "SS", "2B", "3B", "1B"}
POS_WEIGHT = {"P": 1.5, "C": 1.3, "SS": 1.3, "2B": 1.1, "3B": 1.1, "CF": 1.1,
              "1B": 1.0, "LF": 0.9, "RF": 0.9}
NEUTRAL_PREF = 3  # coach rating 1-5 when none has been entered


def _norm(values):
    lo, hi = min(values.values()), max(values.values())
    if hi - lo < 1e-9:
        return {k: 0.5 for k in values}
    return {k: (v - lo) / (hi - lo) for k, v in values.items()}


# ---------------------------------------------------------------- profiles
def build_profiles(team, decay=0.85):
    """Everything the planner knows about each player."""
    totals = stats.batting_totals(team, decay)
    lg = stats.league_rates(totals)
    fdata = stats.fielding_data(team)
    team_fpct = stats.team_fielding_pct(fdata)
    profiles = {}
    for p in team["players"]:
        name = p["name"]
        bat = stats.shrunk_rates(totals[name], lg)
        d = fdata[name]
        ch, e = stats.overall_fielding(d)
        own_fpct = stats.fielding_pct(ch, e, team_fpct)
        skill = {}
        for pos in POSITIONS:
            pref = p.get("pref", {}).get(pos, NEUTRAL_PREF) / 5
            s = d["pos"].get(pos, {"inn": 0, "ch": 0, "e": 0})
            fp = stats.fielding_pct(s["ch"], s["e"], own_fpct)
            exp = min(s["inn"], 12) / 12
            skill[pos] = 0.45 * pref + 0.45 * fp + 0.10 * exp
        premium_inn = sum(s["inn"] for pos, s in d["pos"].items() if pos in INFIELD_PREMIUM)
        profiles[name] = {
            "bat": bat,
            "skill": skill,
            "def": sum(POS_WEIGHT[x] * v for x, v in skill.items()) / sum(POS_WEIGHT.values()),
            "fpct": own_fpct,
            "bench_per_game": d["bench"] / d["games"] if d["games"] else 0.0,
            "premium_per_game": premium_inn / d["games"] if d["games"] else 0.0,
            "games": d["games"],
        }
    bat_n = _norm({n: pr["bat"]["ops"] for n, pr in profiles.items()}) if profiles else {}
    def_n = _norm({n: pr["def"] for n, pr in profiles.items()}) if profiles else {}
    for n, pr in profiles.items():
        pr["value"] = 0.6 * bat_n[n] + 0.4 * def_n[n]
    return profiles


def recent_slot_fraction(team, name, last=3):
    """Average spot in the order (0=leadoff..1=last) over the last few games."""
    fr = []
    for g in sorted_games(team)[-last:]:
        order = g.get("batting_order", [])
        if name in order:
            fr.append(order.index(name) / max(len(order) - 1, 1))
    return sum(fr) / len(fr) if fr else 0.5


# ---------------------------------------------------------------- batting order
def batting_order(team, present, profiles, balance=0.7):
    """Returns [(name, reason)] for the whole present roster."""
    adj = {n: balance * 0.06 * (recent_slot_fraction(team, n) - 0.5) for n in present}
    pool = list(present)
    order = []

    def pick(key, reason):
        best = max(pool, key=lambda n: key(n) + adj[n])
        pool.remove(best)
        order.append((best, reason(best)))

    b = lambda n: profiles[n]["bat"]
    pick(lambda n: b(n)["obp"] + 0.5 * b(n)["sb_per_pa"],
         lambda n: f"table-setter: on-base {b(n)['obp']:.3f}")
    pick(lambda n: 0.5 * (b(n)["avg"] + b(n)["obp"]) - 0.3 * b(n)["k_rate"],
         lambda n: f"contact: avg {b(n)['avg']:.3f}, strikes out {b(n)['k_rate']:.0%}")
    pick(lambda n: b(n)["ops"], lambda n: f"best all-round bat: OPS {b(n)['ops']:.3f}")
    pick(lambda n: b(n)["slg"], lambda n: f"power: slugging {b(n)['slg']:.3f}")
    while pool:
        pick(lambda n: b(n)["ops"], lambda n: f"OPS {b(n)['ops']:.3f}")
    return order


# ---------------------------------------------------------------- defense
def _assign(players, positions, value):
    """Best player->position matching (bitmask DP; at most 9 players)."""
    skip_cost = 2.0
    best = {0: (0.0, [])}
    for pos in positions:
        new = {}
        for mask, (score, picks) in best.items():
            for j, p in enumerate(players):
                if mask >> j & 1:
                    continue
                cand = (score + value(p, pos), picks + [(pos, p)])
                key = mask | 1 << j
                if key not in new or cand[0] > new[key][0]:
                    new[key] = cand
            if len(players) < len(positions):  # short-handed: leave a spot empty
                cand = (score - skip_cost, picks + [(pos, None)])
                if mask not in new or cand[0] > new[mask][0]:
                    new[mask] = cand
        best = new
    full = (1 << len(players)) - 1
    return dict(best[full][1])


def field_plan(team, present, profiles, balance=0.7, innings=None):
    """Inning-by-inning defense. Returns {name: [pos or 'B', ...]}."""
    s = team["settings"]
    innings = innings or s["innings"]
    n_field = min(9, len(present))
    plan = {n: [] for n in present}
    bench_now = {n: 0 for n in present}
    pos_count = {n: {} for n in present}
    mean_premium = sum(profiles[n]["premium_per_game"] for n in present) / len(present)

    for inn in range(innings):
        # who sits: lowest "priority to play" this inning
        def priority(n):
            load = profiles[n]["bench_per_game"] + bench_now[n]
            pr = (1 - balance) * profiles[n]["value"] + balance * 0.5 * load
            if inn and plan[n][-1] == BENCH:
                pr += 100  # never sit two innings in a row if avoidable
            return pr
        ranked = sorted(present, key=priority, reverse=True)
        on_field, bench = ranked[:n_field], ranked[n_field:]
        for n in bench:
            bench_now[n] += 1

        def value(n, pos):
            v = POS_WEIGHT[pos] * profiles[n]["skill"][pos]
            v -= 0.15 * pos_count[n].get(pos, 0)               # spread the variety
            if inn and plan[n][-1] == pos:
                v += 0.05                                      # don't shuffle needlessly
            if pos in INFIELD_PREMIUM:                         # share the glamour spots
                v += balance * 0.05 * (mean_premium - profiles[n]["premium_per_game"]) \
                     - balance * 0.03 * sum(pos_count[n].get(p, 0) for p in INFIELD_PREMIUM)
            if pos == "P" and pos_count[n].get("P", 0) >= s["max_pitch_inn"]:
                v -= 1000
            if pos == "C" and pos_count[n].get("C", 0) >= s["max_catch_inn"]:
                v -= 1000
            return v

        positions = list(POSITIONS)
        assignment = _assign(on_field, positions, value)
        by_player = {p: pos for pos, p in assignment.items() if p}
        for n in present:
            pos = by_player.get(n, BENCH)
            plan[n].append(pos)
            if pos != BENCH:
                pos_count[n][pos] = pos_count[n].get(pos, 0) + 1
    return plan


def best_positions(profiles, top=3):
    out = {}
    for n, pr in profiles.items():
        ranked = sorted(POSITIONS, key=lambda p: pr["skill"][p], reverse=True)
        out[n] = [(p, pr["skill"][p]) for p in ranked[:top]]
    return out


# ---------------------------------------------------------------- formatting
def format_plan(order, plan, innings):
    lines = ["BATTING ORDER"]
    for i, (name, why) in enumerate(order, 1):
        lines.append(f"  {i:>2}. {name:<14} {why}")
    lines.append("")
    lines.append("DEFENSE BY INNING")
    lines.append("  " + f"{'':<14}" + "".join(f"{i:>4}" for i in range(1, innings + 1)) + "   Bench")
    for name, _ in order:
        row = plan[name]
        lines.append(f"  {name:<14}" + "".join(f"{x:>4}" for x in row) + f"   {row.count(BENCH)}")
    return "\n".join(lines)
