import { parseColormap, compositeDates, ndviUrl, decodeColor, GIBS_COLORMAP } from './gibs.js';
// Live NASA data, fetched straight from the browser. Nothing here is made up:
// if a request fails, the app says so instead of filling in numbers.

const POWER_URL = 'https://power.larc.nasa.gov/api/temporal/daily/point';

// Crop years 2005-2024 (Nov 2004 to Oct 2024).
export const RECORD = { start: '20041101', end: '20241031' };

function withTimeout(signal, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timed out')), ms);
  signal?.addEventListener('abort', () => ctl.abort(signal.reason));
  ctl.signal.addEventListener('abort', () => clearTimeout(timer));
  return ctl.signal;
}

// Real NASA data for the demo farms, downloaded ahead of time so the demo
// never waits on a slow service. Same API, same parameters as the live calls.
let demoPromise;
export function loadDemo() {
  demoPromise ||= fetch(new URL('../data/demo.json', import.meta.url)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return demoPromise;
}
export function demoWeather(demo, id) {
  const f = demo?.farms?.[id];
  if (!f) return null;
  const dates = [];
  let t = Date.UTC(+f.start.slice(0, 4), +f.start.slice(4, 6) - 1, +f.start.slice(6, 8));
  for (let i = 0; i < f.n; i++, t += 864e5) {
    const d = new Date(t);
    dates.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return { lat: f.lat, lon: f.lon, z: f.z, dates, tmax: f.tmax, tmin: f.tmin, rain: f.rain, dew: f.dew, u2: f.u2, rs: f.rs, fetched: demo.fetched, bundled: true };
}

function cacheGet(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function cacheSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: fine */ }
}

// NASA POWER daily point data (MERRA-2 temperature, satellite-corrected rain).
export async function fetchPower(lat, lon, signal) {
  const la = lat.toFixed(2), lo = lon.toFixed(2);
  const key = `terra-power-v2-${la}-${lo}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };
  const params = new URLSearchParams({
    parameters: 'T2M_MAX,T2M_MIN,T2MDEW,WS2M,ALLSKY_SFC_SW_DWN,PRECTOTCORR',
    community: 'AG', latitude: la, longitude: lo,
    start: RECORD.start, end: RECORD.end, format: 'JSON',
  });
  const res = await fetch(`${POWER_URL}?${params}`, { signal });
  if (!res.ok) throw new Error(`NASA POWER answered ${res.status}`);
  const json = await res.json();
  const p = json.properties.parameter;
  const dates = Object.keys(p.T2M_MAX);
  const clean = (v) => (v === -999 || v == null ? null : Math.round(v * 100) / 100);
  const out = { lat: +la, lon: +lo, z: Math.round(json.geometry?.coordinates?.[2] ?? 300), dates: [], tmax: [], tmin: [], rain: [], dew: [], u2: [], rs: [] };
  for (const d of dates) {
    const tx = clean(p.T2M_MAX[d]), tn = clean(p.T2M_MIN[d]), r = clean(p.PRECTOTCORR[d]);
    if (tx == null || tn == null || r == null) continue; // skip days missing the basics
    out.dates.push(d); out.tmax.push(tx); out.tmin.push(tn); out.rain.push(Math.max(0, r));
    out.dew.push(clean(p.T2MDEW[d])); out.u2.push(clean(p.WS2M[d])); out.rs.push(clean(p.ALLSKY_SFC_SW_DWN[d]));
  }
  out.fetched = new Date().toISOString().slice(0, 10);
  cacheSet(key, out);
  return out;
}

// MODIS NDVI (16-day, 250 m) decoded from NASA GIBS images: see gibs.js.
let cmapPromise;
export async function fetchNdvi(lat, lon, years = 5, signal) {
  const key = `terra-ndvi-v2-${lat.toFixed(3)}-${lon.toFixed(3)}`;
  const cached = cacheGet(key);
  if (cached && Date.now() - cached.t < 30 * 864e5) return cached.data;
  cmapPromise ||= fetch(GIBS_COLORMAP).then((r) => r.text()).then(parseColormap);
  const cmap = await cmapPromise;
  const y1 = new Date().getUTCFullYear() - 1;
  const dates = compositeDates(y1 - years + 1, y1);
  const rows = [];
  const canvas = new OffscreenCanvas(3, 3);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < dates.length; i += 8) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    await Promise.all(dates.slice(i, i + 8).map(async (d) => {
      try {
        const res = await fetch(ndviUrl(lat, lon, d), { signal: withTimeout(signal, 20000) });
        if (!res.ok) return;
        const img = await createImageBitmap(await res.blob());
        g.clearRect(0, 0, 3, 3);
        g.drawImage(img, 0, 0);
        const p = g.getImageData(1, 1, 1, 1).data;
        const v = decodeColor(cmap, p[0], p[1], p[2], p[3]);
        if (v != null) rows.push([d, v]);
      } catch (e) { if (e.name === 'AbortError' && signal?.aborted) throw e; }
    }));
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  if (rows.length < 20) throw new Error('not enough satellite images');
  cacheSet(key, { t: Date.now(), data: rows });
  return rows;
}

// NASA GIBS layers, drawn on the map with WMS so any zoom works.
const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg3857';
export const LAYERS = {
  ndvi: {
    name: 'Greenness', product: 'MODIS Terra NDVI, 8-day, 250 m',
    url: `${GIBS}/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_NDVI_8Day&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true`,
    legend: ['Bare', 'Lush'], ramp: ['#d8cfb8', '#9db86a', '#2f6b2f'],
    about: 'How green the ground is. Low values mean bare soil, high values mean a growing crop.',
  },
  smap: {
    name: 'Soil moisture', product: 'SMAP Level 4 root-zone soil moisture, 9 km',
    url: `${GIBS}/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=SMAP_L4_Analyzed_Root_Zone_Soil_Moisture&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true`,
    legend: ['Dry', 'Wet'], ramp: ['#e9dcc0', '#7fb3c9', '#1d4e89'],
    about: 'Water in the top meter of soil, from the SMAP satellite plus a land model. Each pixel is about 6 miles wide.',
  },
  grace: {
    name: 'Groundwater change', product: 'GRACE and GRACE-FO water storage change, monthly',
    url: `${GIBS}/all/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI_v6_STD&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true`,
    legend: ['Losing water', 'Gaining water'], ramp: ['#b45309', '#f3f4f6', '#1d4e89'],
    about: 'Change in all water stored underground and on land, measured from tiny changes in Earth\'s gravity. Each pixel covers a whole region, not one farm.',
  },
};

// The last 90 days from NASA POWER (it runs a few days behind), compared
// against the same calendar window in each year of the 20-year record.
export async function fetchRecent(lat, lon, record, signal) {
  const end = new Date(Date.now() - 6 * 864e5);
  const start = new Date(end.getTime() - 89 * 864e5);
  const f = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const params = new URLSearchParams({ parameters: 'T2M_MAX,PRECTOTCORR', community: 'AG', latitude: lat.toFixed(2), longitude: lon.toFixed(2), start: f(start), end: f(end), format: 'JSON' });
  const res = await fetch(`${POWER_URL}?${params}`, { signal });
  if (!res.ok) throw new Error(`NASA POWER answered ${res.status}`);
  const p = (await res.json()).properties.parameter;
  const days = Object.keys(p.T2M_MAX).filter((d) => p.T2M_MAX[d] !== -999 && p.PRECTOTCORR[d] !== -999);
  if (days.length < 30) throw new Error('not enough recent days yet');
  const rain = days.reduce((a, d) => a + p.PRECTOTCORR[d], 0);
  const hot = days.filter((d) => p.T2M_MAX[d] >= 37.8).length; // 100°F
  // same month-day window in the record
  const md = new Set(days.map((d) => d.slice(4)));
  const years = new Map();
  record.dates.forEach((d, i) => {
    if (!md.has(d.slice(4))) return;
    const y = d.slice(0, 4);
    const o = years.get(y) || { rain: 0, hot: 0, n: 0 };
    o.rain += record.rain[i]; o.hot += record.tmax[i] >= 37.8 ? 1 : 0; o.n++;
    years.set(y, o);
  });
  const full = [...years.values()].filter((o) => o.n >= days.length * 0.9);
  const avgRain = full.reduce((a, o) => a + o.rain, 0) / (full.length || 1);
  const avgHot = full.reduce((a, o) => a + o.hot, 0) / (full.length || 1);
  return { from: days[0], to: days[days.length - 1], days: days.length, rainIn: rain / 25.4, normalRainIn: avgRain / 25.4, hot, normalHot: avgHot };
}

// Topsoil from ISRIC SoilGrids 2.0 (250 m): sand, silt, clay and organic carbon.
export async function fetchSoil(lat, lon, signal) {
  const key = `terra-soil-v1-${lat.toFixed(3)}-${lon.toFixed(3)}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const q = new URLSearchParams({ lon: lon.toFixed(4), lat: lat.toFixed(4), value: 'mean' });
  for (const prop of ['sand', 'silt', 'clay', 'soc']) q.append('property', prop);
  for (const d of ['0-5cm', '5-15cm', '15-30cm']) q.append('depth', d);
  const res = await fetch(`https://rest.isric.org/soilgrids/v2.0/properties/query?${q}`, { signal: withTimeout(signal, 30000) });
  if (!res.ok) throw new Error(`SoilGrids answered ${res.status}`);
  const j = await res.json();
  const out = {};
  for (const layer of j.properties.layers) {
    const vals = layer.depths.map((d) => d.values.mean).filter((v) => v != null);
    if (vals.length) out[layer.name] = vals.reduce((a, b) => a + b, 0) / vals.length / (layer.unit_measure.d_factor || 1);
  }
  if (out.sand == null || out.clay == null) throw new Error('no soil data here');
  if (out.silt == null) out.silt = 100 - out.sand - out.clay;
  out.texture = textureClass(out.sand, out.clay);
  cacheSet(key, out);
  return out;
}

// USDA texture triangle, simplified to the classes common in Arizona fields.
export function textureClass(sand, clay) {
  const silt = 100 - sand - clay;
  if (clay >= 40) return 'clay';
  if (clay >= 27 && sand <= 45) return 'clayLoam';
  if (clay >= 20 && sand > 45) return 'sandyClayLoam';
  if (sand >= 85) return 'sand';
  if (sand >= 70) return 'loamySand';
  if (sand >= 52) return 'sandyLoam';
  if (silt >= 50) return 'siltLoam';
  return 'loam';
}

// Other bundled files built by scripts/fetch-data.mjs (validation, AMA map).
const bundles = {};
export function loadBundle(name) {
  bundles[name] ||= fetch(new URL(`../data/${name}.json`, import.meta.url)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return bundles[name];
}

// Depth to groundwater in wells within about 6 miles, from the USGS Water Data
// API (it includes Arizona Department of Water Resources measurements).
export async function fetchWells(lat, lon, signal) {
  const key = `terra-wells-v1-${lat.toFixed(2)}-${lon.toFixed(2)}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const bbox = [lon - 0.11, lat - 0.09, lon + 0.11, lat + 0.09].map((v) => v.toFixed(3)).join(',');
  const url = `https://api.waterdata.usgs.gov/ogcapi/v0/collections/field-measurements/items?f=json&bbox=${bbox}&parameter_code=72019&datetime=1995-01-01T00:00:00Z/..&limit=10000`;
  const res = await fetch(url, { signal: withTimeout(signal, 30000) });
  if (!res.ok) throw new Error(`USGS answered ${res.status}`);
  const j = await res.json();
  const by = new Map();
  for (const f of j.features || []) {
    const p = f.properties, v = parseFloat(p.value);
    if (!Number.isFinite(v)) continue;
    const w = by.get(p.monitoring_location_id) || { id: p.monitoring_location_id, years: new Map() };
    const y = +String(p.time).slice(0, 4);
    if (!w.years.has(y)) w.years.set(y, []);
    w.years.get(y).push(v);
    by.set(w.id, w);
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const out = [...by.values()].map((w) => ({ id: w.id, series: [...w.years.keys()].sort().map((y) => [y, med(w.years.get(y))]) }))
    .filter((w) => w.series.length >= 6 && w.series[w.series.length - 1][0] - w.series[0][0] >= 10);
  cacheSet(key, out);
  return out;
}

// Next 7 days for the field (Open-Meteo, free, no key) and official US warnings
// (National Weather Service). Used by the dashboard to warn before storms and heat.
export async function fetchForecast(lat, lon, signal) {
  const q = new URLSearchParams({ latitude: lat.toFixed(3), longitude: lon.toFixed(3), daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max', timezone: 'auto', forecast_days: '7', temperature_unit: 'fahrenheit', precipitation_unit: 'inch' });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal });
  if (!res.ok) throw new Error(`Forecast answered ${res.status}`);
  const d = (await res.json()).daily;
  return d.time.map((date, i) => ({ date, tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i], rain: d.precipitation_sum[i] || 0, chance: d.precipitation_probability_max?.[i] ?? null }));
}
export async function fetchAlerts(lat, lon, signal) {
  const res = await fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { signal, headers: { Accept: 'application/geo+json' } });
  if (!res.ok) return [];
  const j = await res.json();
  return (j.features || []).map((f) => ({ event: f.properties.event, headline: f.properties.headline, ends: f.properties.ends || f.properties.expires, severity: f.properties.severity }));
}
