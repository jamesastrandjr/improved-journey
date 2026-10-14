# Should I Fish? 🎣 — Lake Erie walleye, out of Geneva-on-the-Lake, OH

A zero-build, static web app. Open `walleye/index.html` (or serve the repo, e.g. GitHub Pages → `/walleye/`).

**What it does**
- A pulsing **dot on an interactive map** shows the bite score (0–100) and verdict for the selected hour. Drag it, or click anywhere on the water, and the score recomputes for that spot (wind & waves are interpolated from a coast-following sample grid).
- **Live data, auto-refreshing every 10 min:** Open-Meteo (weather + marine waves), NOAA CO-OPS Ashtabula gauge (live water temp/wind/pressure), NWS marine alerts, RainViewer radar.
- **Time machine:** scrub/play the next 10 days hourly, day planner with sunrise/sunset + solunar periods, ranked "prime windows", 10-day outlook.
- **By month & day:** year heat-grid + month calendar of typical walleye potential (water temp, light, moon); days inside the forecast use the real forecast.
- **Safety first:** separate go/no-go gate by boat size (waves, gusts, thunder, fog, NWS advisories). Unsafe = "NOPE".
- Map layers: Bite-map heat field, wind arrows, radar, run-rings with ETA, NOAA chart / satellite basemaps, catch log pins, saved spots, movable home port.
- **Tailored to you:** boat size, fishing method (troll / jig / drift) and trip hours change the safety limits, wind/wave sweet spot, rankings and tips.
- **Trip planner:** pick a trip length and get avg/peak score, max waves & gusts, a "be docked by" time before conditions turn, sunset warnings, a ✨ best-start finder and a calendar (.ics) export.
- **Bite clock**, **🎯 best spot now** finder, **pre-launch safety checklist** that adapts to conditions, **share links** that restore the exact hour/spot, **GPS** "dot → me", and an **installable offline PWA**.
- If the weather services are unreachable the app falls back to clearly-labelled **demo data**.

The model (see `js/model.js`) blends water temp, light, wind/waves, pressure trend, wind direction, sky and solunar influence. It is a planning aid, not a marine forecast — always check the NWS marine forecast and wear a PFD.

Layout: `js/astro.js` (sun/moon), `js/model.js` (scoring), `js/data.js` (feeds + demo), `js/map.js` (Leaflet), `js/app.js` (UI). Leaflet is vendored in `vendor/leaflet`.

## Reports & extra data (how it works)

| Source | How it's used | Where it runs |
|---|---|---|
| **Fishing reports** (`scripts/sources.json`) | Text is read by `js/reports.js` → a "bite chatter" signal (−1…+1), plus depths / lures / areas mentioned. Blended (recency-weighted, ~4-day half-life) into the **Angler reports** factor (10% of the score) and shown in the *Reports & chatter* card with a link back to each source. | GitHub Action (server-side, no CORS) |
| **Paste a report** | Paste text from any site, group or message — analyzed in your browser, kept in localStorage, fades over a few days. | Browser |
| **Your catch log** | Recent trips count as (double-weighted) reports. | Browser |
| **NDBC offshore buoys** | Real offshore water temp / waves / wind (used as the water-temp base when the harbor gauge is missing). | Action → `data/reports.json` |
| **NWS nearshore marine forecast text** | Shown in the card (zone block that mentions Geneva/Ashtabula/Conneaut). | Browser, with the Action's copy as fallback |
| **Multi-model wind** (GFS · ECMWF · ICON) | When the models disagree you get a "treat this hour loosely" confidence chip and a shaded range on the wind line. | Browser (Open-Meteo) |

### Put it online (GitHub Pages, automatic)
1. Merge this branch into `main`.
2. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Actions → Deploy site to GitHub Pages → Run workflow** (it then rebuilds on every push to `main` and every 3 hours). Each build runs the report fetcher, so `data/reports.json` is fresh without any commits.
4. Your site: `https://<your-username>.github.io/improved-journey/walleye/` (the mind map stays at the root).
5. Open **Source status** in the reports card to confirm which feeds work. Entries in `scripts/sources.json` marked `verify` are unconfirmed; enable fishing-report sources only after checking the URL and the site's terms.

`node walleye/scripts/test-reports.mjs` runs the offline unit tests (analyzer, RSS/HTML/NDBC/NWS parsers). Without the fetcher the app still works — paste reports manually.


See **[DATA_SOURCES.md](DATA_SOURCES.md)** for the ranked source plan, what was verified, and the hosting note (open via https/GitHub Pages for full real-time features).
