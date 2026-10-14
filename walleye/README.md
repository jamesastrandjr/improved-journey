# Should I Fish? 🎣 — Lake Erie walleye, out of Geneva-on-the-Lake, OH

A zero-build, static web app. Open `walleye/index.html` (or serve the repo, e.g. GitHub Pages → `/walleye/`).

**What it does**
- A pulsing **dot on an interactive map** shows the bite score (0–100) and verdict for the selected hour. Drag it, or click anywhere on the water, and the score recomputes for that spot (wind & waves are interpolated from a coast-following sample grid).
- **Live data, auto-refreshing every 10 min:** Open-Meteo (weather + marine waves), NOAA CO-OPS Ashtabula gauge (live water temp/wind/pressure), NWS marine alerts, RainViewer radar.
- **Time machine:** scrub/play the next 10 days hourly, day planner with sunrise/sunset + solunar periods, ranked "prime windows", 10-day outlook.
- **By month & day:** year heat-grid + month calendar of typical walleye potential (water temp, light, moon); days inside the forecast use the real forecast.
- **Safety first:** separate go/no-go gate by boat size (waves, gusts, thunder, fog, NWS advisories). Unsafe = "NOPE".
- Map layers: Bite-map heat field, wind arrows, radar, run-rings with ETA, NOAA chart / satellite basemaps, catch log pins, saved spots, movable home port.
- If the weather services are unreachable the app falls back to clearly-labelled **demo data**.

The model (see `js/model.js`) blends water temp, light, wind/waves, pressure trend, wind direction, sky and solunar influence. It is a planning aid, not a marine forecast — always check the NWS marine forecast and wear a PFD.

Layout: `js/astro.js` (sun/moon), `js/model.js` (scoring), `js/data.js` (feeds + demo), `js/map.js` (Leaflet), `js/app.js` (UI). Leaflet is vendored in `vendor/leaflet`.
