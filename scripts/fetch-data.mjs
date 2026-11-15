// Builds everything Terra bundles so the demo opens instantly and every
// number on screen has a checkable source. Run by the Pages workflow before
// each deploy:   node scripts/fetch-data.mjs
//
// Writes:
//   terra/data/demo.json        NASA POWER weather (20 crop years), SoilGrids soil,
//                               MODIS NDVI and USGS/ADWR well levels for 4 demo farms
//   terra/data/validation.json  our water-demand and heat models checked against
//                               12 University of Arizona AZMET weather stations
//   terra/data/ama.json         Arizona groundwater management areas (ADWR)
//
// Every source is public and needs no key. If a source is down the script keeps
// going and the app hides that card rather than inventing numbers. Only NASA
// POWER is required: without it the script fails and the old site stays up.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { parseColormap, compositeDates, ndviUrl, decodeColor, GIBS_COLORMAP } from '../terra/js/gibs.js';
import { penmanMonteithET0, hargreavesET0, extraterrestrialRadiation, esat, dayOfYear, vpd, HEAT_L1_C } from '../terra/js/et.js';

const OUT = 'terra/data';
const FARMS = {
  casa: [32.87, -111.80], cool: [32.995, -111.49],
  mari: [33.09, -111.99], buck: [33.38, -112.64],
};
const START = '20041101', END = '20241031';
const POWER = 'https://power.larc.nasa.gov/api/temporal/daily/point';
const PARAMS = 'T2M_MAX,T2M_MIN,T2MDEW,WS2M,ALLSKY_SFC_SW_DWN,PRECTOTCORR';

// AZMET farm stations (University of Arizona), spread across the irrigated
// valleys from Yuma to Willcox. Coordinates from azmet.arizona.edu station list.
const STATIONS = [
  ['az05', 'Coolidge', 32.98, -111.61], ['az06', 'Maricopa', 33.07, -111.97],
  ['az26', 'Buckeye', 33.41, -112.68], ['az19', 'Paloma', 32.93, -112.90],
  ['az23', 'Harquahala', 33.49, -113.11], ['az07', 'Aguila', 33.95, -113.19],
  ['az08', 'Parker', 33.96, -114.49], ['az02', 'Yuma Valley', 32.71, -114.70],
  ['az24', 'Roll', 32.76, -113.97], ['az04', 'Safford', 32.81, -109.68],
  ['az33', 'Bowie', 32.29, -109.47], ['az39', 'Willcox Bench', 32.12, -109.71],
];
const VAL_YEARS = [2020, 2021, 2022, 2023, 2024];

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { tries = 3, timeout = 120000, json = true } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: 'application/json', 'User-Agent': 'terra-field-shift (NASA Space Apps)' } });
      if (!res.ok) throw new Error(`${res.status}`);
      return json ? await res.json() : await res.text();
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(4000 * i);
    }
  }
}

// ---------------- NASA POWER ----------------
async function power(lat, lon, start, end) {
  const q = new URLSearchParams({ parameters: PARAMS, community: 'AG', latitude: lat, longitude: lon, start, end, format: 'JSON' });
  const j = await get(`${POWER}?${q}`);
  const p = j.properties.parameter;
  const days = Object.keys(p.T2M_MAX);
  const col = (k, d) => days.map((day, i) => {
    let v = p[k][day];
    if (v === -999 || v == null) return null;
    return round(v, d);
  });
  return { lat, lon, z: round(j.geometry.coordinates[2], 0), start: days[0], n: days.length, days,
    tmax: col('T2M_MAX', 1), tmin: col('T2M_MIN', 1), dew: col('T2MDEW', 1), u2: col('WS2M', 2), rs: col('ALLSKY_SFC_SW_DWN', 2), rain: col('PRECTOTCORR', 2) };
}

// Temperatures and rain must be complete for the water model: fill rare gaps
// with the previous day. Humidity, wind and sunlight stay null when missing so
// the app falls back to the temperature-only method for that day.
function fillCore(f) {
  for (const k of ['tmax', 'tmin', 'rain']) for (let i = 0; i < f.n; i++) if (f[k][i] == null) f[k][i] = i ? f[k][i - 1] : 0;
  for (let i = 0; i < f.n; i++) if (f.rain[i] < 0) f.rain[i] = 0;
  return f;
}

// ---------------- SoilGrids ----------------
async function soil(lat, lon) {
  const q = new URLSearchParams({ lon, lat, value: 'mean' });
  for (const prop of ['sand', 'silt', 'clay', 'soc']) q.append('property', prop);
  for (const d of ['0-5cm', '5-15cm', '15-30cm']) q.append('depth', d);
  const j = await get(`https://rest.isric.org/soilgrids/v2.0/properties/query?${q}`, { tries: 2 });
  const out = {};
  for (const layer of j.properties.layers) {
    const v = layer.depths.map((d) => d.values.mean).filter((x) => x != null);
    if (v.length) out[layer.name] = round(v.reduce((a, b) => a + b, 0) / v.length / (layer.unit_measure.d_factor || 1), 1);
  }
  return out.sand == null ? null : out;
}

// ---------------- MODIS NDVI (NASA GIBS) ----------------
// Minimal PNG reader: 8-bit RGB, RGBA or palette images, as GIBS serves them.
function pngPixel(buf, x, y) {
  let p = 8, w, h, type, pal, trns;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), kind = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9]; if (data[8] !== 8) throw new Error('bit depth'); }
    else if (kind === 'PLTE') pal = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : type === 4 ? 2 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let r = 0; r < h; r++) {
    const f = raw[r * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const v = raw[r * (stride + 1) + 1 + i];
      const a = i >= bpp ? out[r * stride + i - bpp] : 0, b = r ? out[(r - 1) * stride + i] : 0, c = r && i >= bpp ? out[(r - 1) * stride + i - bpp] : 0;
      let pr = 0;
      if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[r * stride + i] = (v + pr) & 255;
    }
  }
  const o = y * stride + x * bpp;
  if (type === 6) return [out[o], out[o + 1], out[o + 2], out[o + 3]];
  if (type === 2) return [out[o], out[o + 1], out[o + 2], 255];
  if (type === 3) { const k = out[o]; return [pal[k * 3], pal[k * 3 + 1], pal[k * 3 + 2], trns && k < trns.length ? trns[k] : 255]; }
  throw new Error(`png type ${type}`);
}

let colormap;
async function ndvi(lat, lon) {
  colormap ||= parseColormap(await get(GIBS_COLORMAP, { json: false }));
  const rows = [];
  const dates = compositeDates(2020, 2024);
  for (let i = 0; i < dates.length; i += 6) {
    await Promise.all(dates.slice(i, i + 6).map(async (d) => {
      try {
        const res = await fetch(ndviUrl(lat, lon, d), { signal: AbortSignal.timeout(60000) });
        if (!res.ok) return;
        const v = decodeColor(colormap, ...pngPixel(Buffer.from(await res.arrayBuffer()), 1, 1));
        if (v != null) rows.push([d, v]);
      } catch { /* skip this composite */ }
    }));
  }
  return rows.sort((a, b) => a[0].localeCompare(b[0]));
}

// ---------------- wells: USGS Water Data API (includes ADWR measurements) ----------------
// Depth to water (parameter 72019) in wells within about 10 km of the farm.
async function wells(lat, lon) {
  const dLat = 0.09, dLon = 0.11;
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(3)).join(',');
  const byWell = new Map();
  let url = `https://api.waterdata.usgs.gov/ogcapi/v0/collections/field-measurements/items?f=json&bbox=${bbox}&parameter_code=72019&datetime=1995-01-01T00:00:00Z/..&limit=10000`;
  for (let page = 0; url && page < 10; page++) {
    const j = await get(url, { timeout: 180000 });
    for (const f of j.features) {
      const p = f.properties;
      const v = parseFloat(p.value);
      if (!Number.isFinite(v) || p.approval_status === 'Rejected') continue;
      const id = p.monitoring_location_id;
      const w = byWell.get(id) || { id, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], years: new Map() };
      const y = +String(p.time).slice(0, 4);
      if (!w.years.has(y)) w.years.set(y, []);
      w.years.get(y).push(v);
      byWell.set(id, w);
    }
    url = (j.links || []).find((l) => l.rel === 'next')?.href || null;
  }
  // Keep wells with a long record: one median value per year.
  const list = [];
  for (const w of byWell.values()) {
    const ys = [...w.years.keys()].sort();
    if (ys.length < 6 || ys[ys.length - 1] - ys[0] < 10) continue;
    list.push({ id: w.id, lat: round(w.lat, 4), lon: round(w.lon, 4), series: ys.map((y) => [y, round(median(w.years.get(y)), 1)]) });
  }
  return list;
}

// ---------------- ADWR groundwater management areas ----------------
async function amas() {
  const url = 'https://azwatermaps.azwater.gov/arcgis/rest/services/General/AMA_and_INA_2024/FeatureServer/0/query?where=1%3D1&outFields=BASIN_NAME&returnGeometry=true&outSR=4326&maxAllowableOffset=0.004&geometryPrecision=4&f=geojson';
  const j = await get(url, { timeout: 180000 });
  return { type: 'FeatureCollection', source: 'Arizona Department of Water Resources, AMA and INA boundaries', features: j.features.map((f) => ({ type: 'Feature', properties: { name: f.properties.BASIN_NAME }, geometry: f.geometry })) };
}

// ---------------- AZMET validation ----------------
async function azmetDaily(id) {
  const rows = [];
  for (const y of VAL_YEARS) {
    const days = (y % 4 === 0 ? 366 : 365) - 1;
    const j = await get(`https://api.azmet.arizona.edu/v1/observations/daily/${id}/${y}-01-01T00:00/P${days}D`);
    for (const d of j.data) rows.push(d);
    await sleep(300);
  }
  return rows;
}

function ols(X, Y) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => Array(k).fill(0)), b = Array(k).fill(0);
  X.forEach((x, i) => { for (let p = 0; p < k; p++) { b[p] += x[p] * Y[i]; for (let q = 0; q < k; q++) A[p][q] += x[p] * x[q]; } });
  for (let i = 0; i < k; i++) {
    for (let r = 0; r < k; r++) if (r !== i) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < k; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

async function validation() {
  const pairs = []; // per station-day
  const stations = [];
  for (const [id, name, lat, lon] of STATIONS) {
    try {
      const az = await azmetDaily(id);
      const pw = await power(lat, lon, '20200101', '20241231');
      const ix = new Map(pw.days.map((d, i) => [d, i]));
      let used = 0;
      for (const d of az) {
        if (d.meta_needs_review === '1') continue;
        const key = d.datetime.replace(/-/g, '');
        const i = ix.get(key);
        const eto = parseFloat(d.eto_pen_mon);
        if (i === undefined || !(eto >= 0) || eto > 20) continue;
        const tx = pw.tmax[i], tn = pw.tmin[i], dew = pw.dew[i], rs = pw.rs[i], u2 = pw.u2[i];
        if ([tx, tn, dew, rs, u2].some((v) => v == null)) continue;
        const y = +key.slice(0, 4), m = +key.slice(4, 6), dd = +key.slice(6, 8);
        const doy = dayOfYear(y, m, dd);
        const pm = penmanMonteithET0({ tmax: tx, tmin: tn, ea: esat(Math.min(dew, tn + 2)), rs, u2, z: pw.z, lat, doy });
        const hg = hargreavesET0(tx, tn, extraterrestrialRadiation(lat, doy));
        const cct = parseFloat(d.heatstress_cotton_meanC);
        pairs.push({ st: id, m, eto, pm, hg, cct, tx, tn, dew });
        used++;
      }
      stations.push({ id, name, lat, lon, days: used });
      console.log(`AZMET ${name}: ${used} matched days`);
    } catch (e) {
      console.log(`AZMET ${name}: skipped (${e.message})`);
    }
  }
  if (pairs.length < 2000) throw new Error('too few AZMET days to validate');

  // Monthly bias correction of NASA-based Penman-Monteith against the stations.
  const factor = Array.from({ length: 12 }, (_, k) => {
    const p = pairs.filter((x) => x.m === k + 1);
    return round(p.reduce((a, x) => a + x.eto, 0) / p.reduce((a, x) => a + x.pm, 0), 3);
  });
  const hgFactor = round(pairs.reduce((a, x) => a + x.eto, 0) / pairs.reduce((a, x) => a + x.hg, 0), 3);

  // Candidate methods, each scored leave-one-station-out: the factors used to
  // test a station are fitted on the other 11 stations only.
  const share = (own) => own.length / (VAL_YEARS.length * 365.25);
  const yearly = (p, f) => p.reduce((a, x) => a + f(x), 0) / VAL_YEARS.length / 25.4 / share(p);
  const fitMonthly = (p) => Array.from({ length: 12 }, (_, k) => { const q = p.filter((x) => x.m === k + 1); return q.reduce((a, x) => a + x.eto, 0) / q.reduce((a, x) => a + x.pm, 0); });
  const fitHg = (p) => p.reduce((a, x) => a + x.eto, 0) / p.reduce((a, x) => a + x.hg, 0);
  const methods = {
    pmRaw: () => (x) => x.pm,
    hgRaw: () => (x) => x.hg,
    pmCal: (rest) => { const f = fitMonthly(rest); return (x) => x.pm * f[x.m - 1]; },
    hgCal: (rest) => { const h = fitHg(rest); return (x) => x.hg * h; },
    blend: (rest) => { const f = fitMonthly(rest), h = fitHg(rest); return (x) => 0.5 * (x.pm * f[x.m - 1] + x.hg * h); },
  };
  const pct = (a, b) => (100 * (a - b)) / b;
  const scored = {};
  for (const [name, make] of Object.entries(methods)) {
    const errs = [], sq = [];
    for (const s of stations) {
      const own = pairs.filter((x) => x.st === s.id);
      if (own.length < 300) continue;
      const fn = make(pairs.filter((x) => x.st !== s.id));
      s.stationIn = round(yearly(own, (x) => x.eto), 1);
      s[name] = round(yearly(own, fn), 1);
      errs.push(Math.abs(pct(s[name], s.stationIn)));
      for (const x of own) sq.push((fn(x) - x.eto) ** 2);
    }
    scored[name] = { meanAbsPct: round(mean(errs), 1), maxAbsPct: round(Math.max(...errs), 1), dailyRmseMm: round(Math.sqrt(mean(sq)), 2) };
  }
  // The app uses whichever calibrated method did best on held-out stations.
  const best = ['pmCal', 'hgCal', 'blend'].sort((a, b) => scored[a].meanAbsPct - scored[b].meanAbsPct || scored[a].dailyRmseMm - scored[b].dailyRmseMm)[0];
  const method = { pmCal: 'pm', hgCal: 'hg', blend: 'blend' }[best];
  for (const s of stations) { s.calIn = s[best]; s.rawIn = s.pmRaw; s.hgIn = s.hgRaw; }
  console.log('ET0 methods (held-out stations):', JSON.stringify(scored), 'chosen:', best);

  // Cotton canopy temperature: fit AZMET's daily canopy temperature from NASA
  // POWER temperature and humidity, summer days only (June to September).
  const summer = pairs.filter((x) => x.m >= 6 && x.m <= 9 && Number.isFinite(x.cct) && x.cct > 0);
  const X = summer.map((x) => [1, (x.tx + x.tn) / 2, vpd(x.tx, x.tn, x.dew)]);
  const Y = summer.map((x) => x.cct);
  const [a, b, c] = ols(X, Y);
  const pred = X.map((x) => a + b * x[1] + c * x[2]);
  const canopy = {
    a: round(a, 3), b: round(b, 3), c: round(c, 3), n: summer.length,
    rmseC: round(Math.sqrt(mean(pred.map((p, i) => (p - Y[i]) ** 2))), 2),
    level1Days: { stations: Y.filter((v) => v > HEAT_L1_C).length, model: pred.filter((v) => v > HEAT_L1_C).length },
  };

  return {
    period: '2020-2024', stations,
    et0: {
      method, chosen: best, monthlyFactor: factor, hgFactor, methods: scored,
      raw: scored.pmRaw, hargreaves: scored.hgRaw, calibrated: scored[best],
      note: 'All errors are leave-one-station-out: each station is tested with factors fitted on the other 11.',
    },
    canopy,
  };
}

// ---------------- main ----------------
fs.mkdirSync(OUT, { recursive: true });
const demo = {
  about: 'Real data from NASA POWER (daily, community AG), ISRIC SoilGrids 2.0, MODIS 16-day NDVI from NASA GIBS and USGS Water Data (well levels, including ADWR measurements) for the four demo farms.',
  fetched: new Date().toISOString().slice(0, 10), farms: {}, soil: {}, ndvi: {}, wells: {},
};
for (const [id, [lat, lon]] of Object.entries(FARMS)) {
  const f = fillCore(await power(lat, lon, START, END));
  delete f.days;
  demo.farms[id] = f;
  console.log(`NASA POWER ${id}: ${f.n} days, elevation ${f.z} m`);
  try { const s = await soil(lat, lon); if (s) demo.soil[id] = s; console.log(`SoilGrids ${id}: ${s ? 'ok' : 'none'}`); } catch (e) { console.log(`SoilGrids ${id}: skipped (${e.message})`); }
  try { demo.ndvi[id] = await ndvi(lat, lon); console.log(`MODIS ${id}: ${demo.ndvi[id].length} composites`); } catch (e) { console.log(`MODIS ${id}: skipped (${e.message})`); }
  try { demo.wells[id] = await wells(lat, lon); console.log(`Wells ${id}: ${demo.wells[id].length} with long records`); } catch (e) { console.log(`Wells ${id}: skipped (${e.message})`); }
}
// ADWR wells (scripts/adwr_wells.py) are fuller than USGS for Arizona: use them when present.
// If ADWR refuses the build server, use the same GWSI extract saved from a browser in scripts/static/.
const wellsFile = fs.existsSync(`${OUT}/wells.json`) ? `${OUT}/wells.json` : fs.existsSync('scripts/static/wells-adwr.json') ? 'scripts/static/wells-adwr.json' : null;
if (wellsFile) {
  const adwr = JSON.parse(fs.readFileSync(wellsFile));
  for (const [id, list] of Object.entries(adwr.farms || {})) if (list.length >= (demo.wells[id]?.length || 0)) demo.wells[id] = list;
  demo.wellsSource = adwr.source;
  console.log('Wells: merged ADWR GWSI', Object.fromEntries(Object.entries(demo.wells).map(([k, v]) => [k, v.length])));
}
// MODIS service often refuses cloud servers. Fall back to the same MODIS data
// pulled earlier from a normal browser and kept in scripts/static/.
if (fs.existsSync('scripts/static/ndvi-demo.json')) {
  const st = JSON.parse(fs.readFileSync('scripts/static/ndvi-demo.json'));
  for (const [id, rows] of Object.entries(st.farms)) if (!(demo.ndvi[id]?.length > 20)) demo.ndvi[id] = rows;
}
fs.writeFileSync(`${OUT}/demo.json`, JSON.stringify(demo));

try {
  const v = await validation();
  v.fetched = demo.fetched;
  fs.writeFileSync(`${OUT}/validation.json`, JSON.stringify(v));
  console.log('Validation:', JSON.stringify(v.et0.calibrated), 'canopy rmse', v.canopy.rmseC);
} catch (e) { console.log(`Validation skipped (${e.message})`); }

try {
  fs.writeFileSync(`${OUT}/ama.json`, JSON.stringify(await amas()));
  console.log('ADWR AMAs: ok');
} catch (e) { console.log(`ADWR AMAs skipped (${e.message})`); }
console.log('Done.');
