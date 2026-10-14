/* Builds data/bathy.json (compact lake-bottom depth grid in feet) from an NCEI Great Lakes bathymetry grid in ARC ASCII format.
   1) https://maps.ngdc.noaa.gov/viewers/wcs-client  ("Grid Extract") -> Lake Erie -> draw a box around the fishing area -> ARC ASCII.
   2) Save it as walleye/data/source/lake_erie.asc  (or pass a path).   3) node walleye/scripts/build-bathy.mjs
   Options: --units m|ft (default m)  --mode auto|depth|elevation|negative  --surface-m 173.5 (low-water datum, for elevation grids)  --factor N (downsample) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAsc, ascToDepth, encodeBathy } from './lib.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), srcDir = path.join(here, '../data/source');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const input = args.find((a) => !a.startsWith('--') && /\.asc$/i.test(a)) || (fs.existsSync(srcDir) ? fs.readdirSync(srcDir).filter((f) => /\.asc$/i.test(f)).map((f) => path.join(srcDir, f))[0] : null);
if (!input) { console.log('No .asc grid found in walleye/data/source/ — skipping bathymetry build (see the header of this file).'); process.exit(0); }
const asc = parseAsc(fs.readFileSync(input, 'utf8'));
const g = ascToDepth(asc, { units: opt('units', 'm'), mode: opt('mode', 'auto'), surfaceM: +opt('surface-m', 173.5), factor: +opt('factor', 1) });
const valid = Array.from(g.d).filter(Number.isFinite);
console.log(`input ${path.basename(input)} ${asc.nx}x${asc.ny} @ ${(asc.cell * 111320).toFixed(0)} m · mode=${g.mode} · output ${g.nx}x${g.ny} · depth ${Math.min(...valid).toFixed(0)}–${Math.max(...valid).toFixed(0)} ft over ${valid.length} cells`);
if (Math.max(...valid) > 230 || Math.max(...valid) < 20) console.warn('WARNING: max depth looks off for the Lake Erie central basin (~65-80 ft here, ~210 ft lake max). Check --units / --mode / --surface-m.');
fs.writeFileSync(path.join(here, '../data/bathy.json'), JSON.stringify(encodeBathy(g, `built ${new Date().toISOString()} from ${path.basename(input)}`)));
