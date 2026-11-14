// Downloads real NASA POWER weather and SoilGrids soil for the four demo farms
// into terra/data/demo.json, so the demo opens instantly. Run by the Pages
// workflow before each deploy:  node scripts/fetch-data.mjs
import fs from 'node:fs';

const FARMS = {
  casa: [32.88, -111.77], cool: [32.985, -111.52],
  mari: [33.09, -112.02], buck: [33.38, -112.64],
};
const START = '20041101', END = '20241031';
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
}

async function power(lat, lon) {
  const q = new URLSearchParams({
    parameters: 'T2M_MAX,T2M_MIN,PRECTOTCORR', community: 'AG',
    latitude: lat, longitude: lon, start: START, end: END, format: 'JSON',
  });
  const p = (await get(`https://power.larc.nasa.gov/api/temporal/daily/point?${q}`)).properties.parameter;
  const days = Object.keys(p.T2M_MAX);
  const fix = (arr, i) => (arr[i] === -999 ? arr[i - 1] ?? 0 : arr[i]);
  const tx = days.map((d) => p.T2M_MAX[d]), tn = days.map((d) => p.T2M_MIN[d]), r = days.map((d) => p.PRECTOTCORR[d]);
  return {
    lat, lon, start: days[0], n: days.length,
    tmax: tx.map((_, i) => round(fix(tx, i), 1)),
    tmin: tn.map((_, i) => round(fix(tn, i), 1)),
    rain: r.map((_, i) => round(Math.max(0, fix(r, i)), 2)),
  };
}

async function soil(lat, lon) {
  const q = new URLSearchParams({ lon, lat, value: 'mean' });
  for (const prop of ['sand', 'silt', 'clay', 'soc']) q.append('property', prop);
  for (const d of ['0-5cm', '5-15cm', '15-30cm']) q.append('depth', d);
  const j = await get(`https://rest.isric.org/soilgrids/v2.0/properties/query?${q}`, 2);
  const out = {};
  for (const layer of j.properties.layers) {
    const v = layer.depths.map((d) => d.values.mean).filter((x) => x != null);
    if (v.length) out[layer.name] = round(v.reduce((a, b) => a + b, 0) / v.length / (layer.unit_measure.d_factor || 1), 1);
  }
  return out.sand == null ? null : out;
}

const demo = {
  about: 'Real data from NASA POWER (daily point API, community AG: T2M_MAX, T2M_MIN, PRECTOTCORR) and ISRIC SoilGrids 2.0 (0-30 cm mean) for the four demo farms. Bundled so the demo loads instantly; any other location is fetched live.',
  fetched: new Date().toISOString().slice(0, 10), farms: {}, soil: {}, ndvi: {},
};
for (const [id, [lat, lon]] of Object.entries(FARMS)) {
  demo.farms[id] = await power(lat, lon);
  console.log(`NASA POWER ${id}: ${demo.farms[id].n} days`);
  try { const s = await soil(lat, lon); if (s) demo.soil[id] = s; console.log(`SoilGrids ${id}: ${s ? 'ok' : 'none'}`); }
  catch (e) { console.log(`SoilGrids ${id}: skipped (${e.message})`); }
}
fs.mkdirSync('terra/data', { recursive: true });
fs.writeFileSync('terra/data/demo.json', JSON.stringify(demo));
console.log('Wrote terra/data/demo.json');
