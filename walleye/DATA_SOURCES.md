# Where the data comes from (and why)

Ranked by how much I trust each source. "Verified" = I confirmed the fact on the web while building; "unverified" = built from the documented format but never run against the live service from my sandbox.

## Weather & water
| Rank | Source | Used for | Status |
|---|---|---|---|
| 1 | **Open-Meteo forecast** (+ GFS/ECMWF/ICON cross-check) | hourly wind, gusts, pressure, cloud, rain, vis; model-agreement confidence | free, no key, browser-friendly. Unverified live. |
| 1 | **NWS nearshore marine text, zones LEZ147 (Willowick→Geneva) & LEZ148 (Geneva→Conneaut)** | official wave/wind outlook; tunes wave estimates when the marine model is empty | zones **verified**; fetched in-browser via api.weather.gov and by the Action from tgftp |
| 1 | **NWS alerts** (Small Craft, Gale, Special Marine…) | hard safety gate | unverified live |
| 2 | **NOAA CO-OPS Fairport Harbor 9063053** (backup Cleveland 9063063) | live water temp, wind, air, pressure | IDs **verified** (9063063 is Cleveland, not Ashtabula) |
| 2 | **Cleveland buoy 45164** (15 mi out, 75 ft, seasonal) | offshore water temp & waves | station **verified**; NDBC feed unverified |
| 3 | **Open-Meteo marine waves** | wave height/period | Great Lakes coverage **unverified** (global 28 km model) — app falls back to wind-based estimate tuned by NWS text |
| 3 | **GLERL satellite lake-average temp** (ERDDAP `glsea_avgtemps_3`, column `Erie`) | water-temp fallback | dataset **verified**, query syntax unverified |
| 4 | RainViewer radar | map overlay only | unverified live |
| 5 | Seasonal water-temp model | last-resort water temp | built-in |

Not used (yet): the Cleveland buoy thermistor chain on GLOS Seagull ERDDAP (`obs_70_thermistor_latest`) — it would give thermocline depth, but I couldn't confirm its columns.

## Fishing reports
I searched and found **no verified, machine-readable official walleye report** for the Geneva area (ODNR's page URL could not be confirmed; Patch republishes ODNR text undated; FishingBooker and walleye.com forums are commercial/user-generated). So the policy is:
1. **Nothing is scraped by default.** `scripts/sources.json` ships with report sources *disabled*.
2. **Read → paste:** the app links to the good places (walleye.com central-basin forum, ODNR, NWS, buoy page); you copy text and tap **Paste a report** — analyzed locally.
3. **Your own catch log** counts as the highest-weight report.
4. If you verify an ODNR page or a guide's RSS feed, add it to `sources.json`, set `enabled: true`, and the Action will include it. Respect each site's terms.

## Does opening the HTML file always get real-time data?
No. Live data needs (a) an internet connection, (b) each service to allow browser requests (CORS), and (c) for the saved report file, the page to be *hosted* (`https://…`), because a `file://` page can't read `data/reports.json`. Hosted on GitHub Pages you get everything; opened from a file you get the live weather but not the report file, offline install, or (usually) GPS. Updates happen only while the page is open (every 10 min); notifications can't fire when the tab is closed.
