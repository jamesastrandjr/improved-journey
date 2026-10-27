// Bundles public/ into ONE self-contained HTML file (no server, no network, works from file://).
//   node scripts/build-single.mjs   ->   dist/lanelab.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const seen = new Set(); const order = [];
const IMPORT = /import\s*(?:[\w$*{}\s,]+?)\s*from\s*['"]([^'"]+)['"];?/g;
function visit(file) {
  if (seen.has(file)) return; seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(IMPORT)) visit(path.resolve(path.dirname(file), m[1]));
  order.push(file);
}
visit(path.join(pub, 'js/main.js'));
const parts = order.map((f) => {
  let s = fs.readFileSync(f, 'utf8');
  s = s.replace(IMPORT, '');
  s = s.replace(/^export\s+\{[^}]*\};?\s*$/gm, '');
  s = s.replace(/^export\s+default\s+/gm, '').replace(/^export\s+(?=(const|let|var|function|class|async))/gm, '');
  return `/* ---- ${path.relative(pub, f)} ---- */\n${s}`;
});
const js = `(function(){\n'use strict';\n${parts.join('\n')}\n})();`;
const css = fs.readFileSync(path.join(pub, 'css/app.css'), 'utf8');
let html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]*>/, `<style>\n${css}\n</style>`).replace(/<script type="module"[^>]*><\/script>/, () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist/lanelab.html');
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} KB, ${order.length} modules)`);
