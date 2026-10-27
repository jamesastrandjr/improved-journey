# LaneLab - pro shop fitting + ball-reaction studio

Take a customer's hand and delivery measurements, pick a ball and a layout, and **watch how the ball
would throw down a lane** (overhead view or 3-D chase cam, with the ball spinning in true 3-D), under
different oil patterns and lane conditions. Everything autosaves to a customer **data bank**.

## Easiest way: one HTML file
`dist/lanelab.html` is the whole app in a single file. **Download it and double-click** - it opens in
any modern browser (Chrome, Edge, Safari, Firefox), works offline, and saves every change to that
browser's storage as you type. Use *Data Bank -> Export backup* to move data between computers.

Rebuild it after code changes with `node scripts/build-single.mjs`.

## Shared shop database (optional)
Needs Node 22.5+ (no `npm install` - it uses Node's built-in SQLite).

    npm start                                           # http://127.0.0.1:3000
    HOST=0.0.0.0 LANELAB_TOKEN=somesecret npm start     # reachable from other devices on the shop network

Every save is written to the browser first, then mirrored to `data/lanelab.db` (SQLite). If the
server is unreachable the app keeps working and syncs when it returns (newest edit wins per record).
**Back up `data/lanelab.db`** (or use Export). The token is a simple shared secret - put the server
behind HTTPS if you expose it beyond your own network.

## What it records
- **Client**: name, phone, email, hand, one/two-handed, average, league, body weight (ball-weight hint), goals, injuries, consent.
- **Hand & grip**: grip type, span, finger spacing, bridge, finger/thumb hole sizes, thumb style, finger and thumb pitches (forward/reverse and lateral), hand length and palm width. Fractions like `4 1/8` or `105mm` are accepted; +/- steps by 1/16". Odd values get a warning.
- **Delivery**: style presets (stroker/tweener/cranker/two-hander - clearly flagged *estimated* until you enter measured values), speed, rev rate, axis tilt, axis rotation, PAP over/up, loft, start board and target board.
- **Ball & layout**: ball library (generic archetypes + your own saved balls), weight, coverstock, surface grit, RG, differential, intermediate differential, core orientation; interactive grip-face diagram (drag the PAP and the pin) with pin buffer; pin-to-PAP and VAL angle.
- **Lane**: oil pattern presets (house, heavy house, short house, sport short/medium/long, reverse block, dry) or custom length/volume/ratio/shape, wood vs synthetic, lane transition (games bowled), ball oil-soak.
- Each fitting is a saved snapshot with the simulation result; a client can have many fittings (history). *Print drill sheet* produces a one-page work order.

## What it shows
Animated ball path (skid / hook / roll colours), oil or friction map, ball spinning in 3-D with PAP, pin, holes and the oil track it picks up, pin-deck animation with strike odds and common leaves,
entry board / angle, breakpoint, skid-hook-roll lengths, pin speed, flare, backend angle, charts, plain-English shop notes,
**Auto-aim to pocket**, **Layout lab** (scans pin distance x core orientation and ranks by entry angle), and **pin a line to compare** two balls/conditions.

## How the physics works (and its limits)
The ball is a 3-D rigid body (orientation + angular momentum) whose principal moments come from RG,
differential and intermediate differential, so **flare emerges from the physics**. The only force is
sliding friction at the contact point, with a coefficient set by the oil under the ball and by oil the
ball has already picked up on that part of its surface. Oil is a 2-D thickness field (length, volume,
ratio, "tree" taper) that breaks down and carries down with games played. Pins are a 2-D collision model.

This is a **calibrated educational model, not a measurement**: the friction constants (`public/js/physics/ball.js`,
`sim.js`) were tuned to give league-realistic shapes (skid ~25-35 ft, breakpoint late-30s ft, ~14-15 mph at the pins), and absolute numbers
(especially entry angle and strike %) will not match a specific lane or ball. Use it to **compare** balls, layouts and
conditions and to explain reactions to customers; verify with real ball motion data. Ball "archetypes" are generic, not real products.
In this model VAL angle changes pin buffer/hole interaction but not the dynamics; flare comes from pin-to-PAP distance and core orientation.
Final drilling decisions rest with a certified driller.

## Development
    npm test                       # physics + API tests
    node scripts/build-single.mjs  # rebuild dist/lanelab.html
Layout: `public/js/physics/` (sim, ball, lane, pins, analysis), `public/js/ui/` (form, canvas views), `public/js/bank.js` (data bank), `server.js` (HTTP + SQLite).
