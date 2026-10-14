import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dugout import cli, lineup, stats, store
from dugout.store import BENCH, POSITIONS


def make_team(n=11, games=4):
    team = store.new_team("T")
    team["players"] = [{"name": f"P{i}", "pref": {}} for i in range(n)]
    for g in range(games):
        game = {"date": f"2026-09-{g + 1:02d}", "opponent": "x", "us": 1, "them": 0, "innings": 6,
                "batting": {}, "fielding": {}, "batting_order": []}
        for i, p in enumerate(team["players"]):
            game["batting"][p["name"]] = dict.fromkeys(store.BAT_FIELDS, 0) | {"ab": 3, "h": i % 3, "bb": 1}
            game["batting_order"].append(p["name"])
        team["games"].append(game)
    return team


class StatsTests(unittest.TestCase):
    def test_rates(self):
        c = dict.fromkeys(store.BAT_FIELDS, 0) | {"ab": 10, "h": 4, "2b": 1, "hr": 1, "bb": 2}
        r = stats.rates(c)
        self.assertAlmostEqual(r["avg"], 0.4)
        self.assertAlmostEqual(r["obp"], 6 / 12)
        self.assertAlmostEqual(r["slg"], (2 + 2 + 4) / 10)

    def test_shrinkage_pulls_small_samples_to_average(self):
        lg = {"obp": 0.35, "slg": 0.35, "avg": 0.25, "k_rate": 0.2}
        hot = dict.fromkeys(store.BAT_FIELDS, 0) | {"ab": 3, "h": 3}
        s = stats.shrunk_rates(hot, lg)
        self.assertLess(s["obp"], 0.6)
        self.assertGreater(s["obp"], lg["obp"])


class PlanTests(unittest.TestCase):
    def setUp(self):
        self.team = make_team()
        self.names = store.player_names(self.team)
        self.prof = lineup.build_profiles(self.team)

    def plan(self, balance, present=None):
        return lineup.field_plan(self.team, present or self.names, self.prof, balance)

    def test_every_position_filled_every_inning(self):
        plan = self.plan(0.7)
        for i in range(6):
            filled = sorted(p[i] for p in plan.values() if p[i] != BENCH)
            self.assertEqual(filled, sorted(POSITIONS))

    def test_bench_is_even_and_never_back_to_back(self):
        plan = self.plan(1.0)
        counts = [row.count(BENCH) for row in plan.values()]
        self.assertLessEqual(max(counts) - min(counts), 1)
        for row in plan.values():
            for a, b in zip(row, row[1:]):
                self.assertFalse(a == BENCH and b == BENCH)

    def test_pitch_and_catch_limits(self):
        for balance in (0.0, 1.0):
            plan = self.plan(balance)
            for row in plan.values():
                self.assertLessEqual(row.count("P"), self.team["settings"]["max_pitch_inn"])
                self.assertLessEqual(row.count("C"), self.team["settings"]["max_catch_inn"])

    def test_short_handed_does_not_crash(self):
        plan = self.plan(0.7, self.names[:7])
        self.assertEqual(len(plan), 7)
        self.assertTrue(all(len(r) == 6 for r in plan.values()))

    def test_batting_order_includes_everyone_once(self):
        order = lineup.batting_order(self.team, self.names, self.prof)
        self.assertEqual(sorted(n for n, _ in order), sorted(self.names))

    def test_win_now_benches_weakest(self):
        plan = self.plan(0.0)
        value = {n: self.prof[n]["value"] for n in self.names}
        weakest = min(value, key=value.get)
        self.assertGreaterEqual(plan[weakest].count(BENCH), 1)


class CliTests(unittest.TestCase):
    def test_parse_positions(self):
        self.assertEqual(cli.parse_positions("SS*2 3B B*3", 6), ["SS", "SS", "3B", "B", "B", "B"])
        with self.assertRaises(ValueError):
            cli.parse_positions("SS*2", 6)
        with self.assertRaises(ValueError):
            cli.parse_positions("XX*6", 6)

    def test_end_to_end(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "t.json")
            for argv in (["init", "--team", "Z"], ["add-player", "Amy"], ["add-player", "Bo"]):
                cli.main(["--data", path] + argv)
            csv_path = os.path.join(d, "g.csv")
            with open(csv_path, "w") as f:
                f.write("player,ab,h,positions,ch,e\nAmy,3,1,SS*6,4,1\nbo,2,0,P*2 B*4,1,0\n")
            cli.main(["--data", path, "import-game", csv_path, "--opponent", "Cubs", "--us", "4", "--them", "2"])
            team = store.load(path)
            self.assertEqual(len(team["games"]), 1)
            self.assertEqual(team["games"][0]["batting_order"], ["Amy", "Bo"])
            self.assertEqual(stats.fielding_data(team)["Bo"]["bench"], 4)


if __name__ == "__main__":
    unittest.main()
