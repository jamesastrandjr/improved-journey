# Dugout — youth baseball stats & lineup helper

**Easiest way:** open `dugout.html` in any browser (phone or laptop). No install, no server. Data is saved in that browser; use **Back up** now and then to download a copy. The Python command-line version below does the same thing.

Enter your game numbers once a week; get a batting order, an inning-by-inning
defensive plan, and talking points for every player. Pure Python 3.9+, no installs.

```
python -m dugout init --team "Tigers" --innings 6
python -m dugout add-player "Ben" --number 7        # repeat for each kid
python -m dugout rate "Ben" SS 4                    # optional: your 1-5 feel for a position
python -m dugout demo --data try.json               # or try a fake season first
```

## Weekly routine
1. **Enter the game** (pick one):
   - `python -m dugout add-game --opponent Hawks --us 7 --them 4` — type one line per player.
   - `python -m dugout template` → fill `game.csv` in Excel/Sheets (rows in batting order,
     delete absent players) → `python -m dugout import-game game.csv --opponent Hawks --us 7 --them 4`.
2. **Look**: `stats` (add `--form` to weight recent games), `report`, `positions`.
3. **Plan next game**: `python -m dugout lineup --absent "Ben,Finn"`

Stat columns: `ab h 2b 3b hr bb hbp k r rbi sb sac`. `positions` is the inning-by-inning
defense, e.g. `SS*3 P*2 B` (B = bench); `ch`/`e` are fielding chances and errors.
Re-importing the same `--date` replaces that game.

## How the recommendations work
- **Small-sample protection**: a kid who goes 3-for-3 isn't treated as a 1.000 hitter; each rate
  is blended with the team average until there are enough at-bats/chances.
- **Batting order**: leadoff = best on-base (+ speed); 2 = contact; 3 = best overall bat;
  4 = power; the rest by OPS. Recent games count more (`--form`). Players who have been stuck at the
  bottom of the order get a small nudge upward.
- **Defense**: each player gets a score at each position from your 1-5 ratings, their fielding record
  there, and experience. Best matching per inning (important spots like P/SS/C weigh more),
  with variety across innings and limits on pitching/catching innings (`settings` in the data file).
- **`--balance 0..1`** (default 0.7): 0 = best players play and bat in the best spots; 1 = perfectly
  even playing time and rotating premium positions. Nobody sits two innings in a row, and kids who
  sat more in earlier games sit less. `report` includes a playing-time audit and strengths to praise.

Data lives in `team_data.json` (plain text; back it up!). Tests: `python -m unittest discover -s tests`.
