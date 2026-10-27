// Builds dist/lanelab-artifact.html: the single file reshaped for the claude.ai Artifact host
// (no doctype/head/body, no print/download buttons). Run build-single.mjs first.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../dist/lanelab.html', import.meta.url), 'utf8');
const style = src.match(/<style>([\s\S]*?)<\/style>/)[1];
const script = src.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
let body = src.match(/<body>([\s\S]*?)<script>/)[1];
body = body.replace(/<p class="muted small artifact-note" hidden>/, '<p class="muted small artifact-note">');
const out = `<title>LaneLab Studio</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
body{margin:0;background:var(--bg);color:var(--ink)}
${style}
</style>
${body}
<script>window.__ARTIFACT=true;</script>
<script>
${script}
</script>
`;
fs.writeFileSync(new URL('../dist/lanelab-artifact.html', import.meta.url), out);
console.log('artifact build', (out.length / 1024).toFixed(0) + ' KB');
