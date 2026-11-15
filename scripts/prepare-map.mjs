// Copies the map library from node_modules into terra/vendor so the app can load it.
import fs from 'node:fs';
const src = 'node_modules/maplibre-gl/dist';
fs.mkdirSync('terra/vendor', { recursive: true });
for (const f of ['maplibre-gl.js', 'maplibre-gl.css']) {
  if (!fs.existsSync(`${src}/${f}`)) { console.error(`Missing ${src}/${f}. Run npm install first.`); process.exit(1); }
  fs.copyFileSync(`${src}/${f}`, `terra/vendor/${f}`);
}
console.log('Map library ready in terra/vendor');
