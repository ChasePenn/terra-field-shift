// Replit build: download the NASA data files the GitHub Pages build already made,
// instead of fetching everything from NASA again (slow and can time out).
import fs from 'node:fs';
const BASE = 'https://chasepenn.github.io/terra-field-shift/data/';
const FILES = ['demo.json', 'validation.json', 'ama.json'];
fs.mkdirSync('terra/data', { recursive: true });
let ok = 0;
for (const f of FILES) {
  try {
    const r = await fetch(BASE + f);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    fs.writeFileSync(`terra/data/${f}`, Buffer.from(await r.arrayBuffer()));
    console.log(`Got ${f}`); ok++;
  } catch (e) { console.warn(`Could not get ${f}: ${e.message}`); }
}
if (!fs.existsSync('terra/data/demo.json')) { console.error('demo.json is required'); process.exit(1); }
console.log(`${ok} of ${FILES.length} data files ready`);
