// TERRA rotation engine. Pure functions, no DOM, so it runs in the browser
// and in Node tests.
//
// Inputs: daily NASA POWER weather (max/min temperature, rain) for one point.
// Method:
//   1. Reference evapotranspiration (ET0) per day with the Hargreaves equation
//      (FAO-56 eq. 52), using extraterrestrial radiation from latitude (eq. 21).
//   2. Crop water use = Kc x ET0, with FAO-56 crop coefficient curves.
//   3. Irrigation need = crop water use minus effective rain (75% of rain).
//   4. Every rotation is replayed against each real crop year in the record.

import { CROPS, WINTER, SUMMER, BEFORE_COTTON, CY_MONTHS, CALENDAR_AREA } from './crops.js';

export const MM_PER_ACFT = 304.8;
export const GALLONS_PER_ACFT = 325851;
export const EFFECTIVE_RAIN = 0.75;
export const IRRIGATION_EFFICIENCY = { drip: 0.9, sprinkler: 0.8, furrow: 0.7 };

const DAY_MS = 86400000;

// ---------- weather ----------

function dayOfYear(y, m, d) {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / DAY_MS);
}

// FAO-56 eq. 21, returned as mm/day of evaporation equivalent (x 0.408).
export function extraterrestrialRadiation(latDeg, doy) {
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
  const ra = ((24 * 60) / Math.PI) * 0.082 * dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
  return ra * 0.408;
}

export function hargreavesET0(tmax, tmin, raMm) {
  const range = Math.max(0, tmax - tmin);
  return Math.max(0, 0.0023 * raMm * ((tmax + tmin) / 2 + 17.8) * Math.sqrt(range));
}

// weather: { lat, dates: ['YYYYMMDD'...], tmax:[], tmin:[], rain:[] }
// stress:  { dT: degrees C added to max and min, rainPct: -50..+50 }
export function prepareWeather(weather, stress = { dT: 0, rainPct: 0 }) {
  const n = weather.dates.length;
  const days = new Array(n);
  const index = new Map();
  for (let i = 0; i < n; i++) {
    const s = String(weather.dates[i]);
    const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
    const tmax = weather.tmax[i] + stress.dT;
    const tmin = weather.tmin[i] + stress.dT;
    const rain = Math.max(0, weather.rain[i] * (1 + stress.rainPct / 100));
    const et0 = hargreavesET0(tmax, tmin, extraterrestrialRadiation(weather.lat, dayOfYear(y, m, d)));
    days[i] = { y, m, d, tmax, tmin, rain, et0 };
    index.set(s, i);
  }
  // Complete crop years: Nov 1 (y-1) to Oct 31 (y), with at most 5% missing days.
  const cropYears = [];
  const first = days[0], last = days[n - 1];
  for (let cy = first.y + 1; cy <= last.y; cy++) {
    let have = 0;
    for (let t = Date.UTC(cy - 1, 10, 1); t <= Date.UTC(cy, 9, 31); t += DAY_MS) {
      if (index.has(keyOf(t))) have++;
    }
    if (have >= 0.95 * 365) cropYears.push(cy);
  }
  return { lat: weather.lat, days, index, cropYears };
}

function keyOf(t) {
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function cyMonthIndex(m) { return (m + 1) % 12; } // Nov -> 0 ... Oct -> 11

export function climate(prep) {
  const out = { years: prep.cropYears.length, rainIn: 0, et0In: 0, hot110: 0, frost: 0, monthlyEt0: Array(12).fill(0), monthlyRain: Array(12).fill(0), monthlyTmax: Array(12).fill(0) };
  if (!prep.cropYears.length) return out;
  const set = new Set(prep.cropYears);
  const counts = Array(12).fill(0);
  for (const d of prep.days) {
    const cy = d.m >= 11 ? d.y + 1 : d.y;
    if (!set.has(cy)) continue;
    const k = cyMonthIndex(d.m);
    out.rainIn += d.rain; out.et0In += d.et0;
    out.monthlyEt0[k] += d.et0; out.monthlyRain[k] += d.rain; out.monthlyTmax[k] += d.tmax; counts[k]++;
    if (d.tmax >= 43.3) out.hot110++;
    if (d.tmin <= 0) out.frost++;
  }
  const n = prep.cropYears.length;
  out.rainIn = out.rainIn / n / 25.4;
  out.et0In = out.et0In / n / 25.4;
  out.hot110 /= n; out.frost /= n;
  for (let k = 0; k < 12; k++) {
    out.monthlyEt0[k] /= n; out.monthlyRain[k] /= n; out.monthlyTmax[k] /= counts[k] || 1;
  }
  return out;
}

// ---------- crops ----------

function seasonLength(crop) { return crop.stages.reduce((a, b) => a + b, 0); }

// FAO-56 Kc curve: flat initial, linear rise, flat mid, linear fall.
// FAO-56 eq. 62: raise Kc mid and Kc end (when >= 0.45) for dry air. We assume
// wind 2 m/s and a minimum humidity of 20%, typical of the Arizona growing season.
export const RH_MIN = 20, WIND = 2;
export function climateAdjust(kc, height) {
  if (kc < 0.45) return kc;
  return kc + (0.04 * (WIND - 2) - 0.004 * (RH_MIN - 45)) * Math.pow((height || 1) / 3, 0.3);
}

export function kcOnDay(crop, day) {
  const [li, ld, lm, ll] = crop.stages;
  const ki = crop.kc[0];
  const km = climateAdjust(crop.kc[1], crop.height);
  const ke = climateAdjust(crop.kc[2], crop.height);
  if (day < li) return ki;
  if (day < li + ld) return ki + ((day - li) / ld) * (km - ki);
  if (day < li + ld + lm) return km;
  if (ll === 0) return km;
  return km + ((day - li - ld - lm) / ll) * (ke - km);
}

function plantTime(crop, cy) {
  const [m, d] = crop.plant;
  return Date.UTC(m >= 11 ? cy - 1 : cy, m - 1, d);
}

// Which crop-year months a crop occupies (at least 10 days in that month).
export function occupiedMonths(cropId) {
  const crop = CROPS[cropId];
  if (cropId === 'fallow') return [];
  if (crop.perennial) return [...Array(12).keys()];
  const counts = Array(12).fill(0);
  const t0 = plantTime(crop, 2023);
  for (let i = 0; i < seasonLength(crop); i++) counts[cyMonthIndex(new Date(t0 + i * DAY_MS).getUTCMonth() + 1)]++;
  return counts.map((c, k) => (c >= 10 ? k : -1)).filter((k) => k >= 0);
}

// Crop water use and stress hits for one crop in one crop year.
function cropYear(prep, cropId, cy) {
  const crop = CROPS[cropId];
  const etc = Array(12).fill(0);
  const hits = [];
  if (cropId === 'fallow') return { etc, hits };
  const visit = (t, kc) => {
    const i = prep.index.get(keyOf(t));
    if (i === undefined) return null;
    const d = prep.days[i];
    etc[cyMonthIndex(d.m)] += kc * d.et0;
    return d;
  };
  let heatDays = 0, frostDays = 0;
  const check = (d) => {
    if (!d) return;
    if (crop.heat && crop.heat.months.includes(d.m) && d.tmax >= crop.heat.tmaxC) heatDays++;
    if (crop.frost && crop.frost.months.includes(d.m) && d.tmin <= crop.frost.tminC) frostDays++;
  };
  if (crop.perennial) {
    for (let t = Date.UTC(cy - 1, 10, 1); t <= Date.UTC(cy, 9, 31); t += DAY_MS) check(visit(t, climateAdjust(crop.kcFlat, crop.height)));
  } else {
    const t0 = plantTime(crop, cy);
    for (let i = 0; i < seasonLength(crop); i++) check(visit(t0 + i * DAY_MS, kcOnDay(crop, i)));
  }
  if (crop.heat && heatDays >= crop.heat.days) hits.push({ crop: cropId, kind: 'heat', days: heatDays, text: `${crop.short}: ${heatDays} days at or above ${Math.round(crop.heat.tmaxC * 9 / 5 + 32)}°F, ${crop.heat.text}` });
  if (crop.frost && frostDays >= 1) hits.push({ crop: cropId, kind: 'frost', days: frostDays, text: `${crop.short}: ${frostDays} hard-freeze night${frostDays > 1 ? 's' : ''}, ${crop.frost.text}` });
  return { etc, hits };
}

// ---------- year types and rotations ----------

// A year type is one crop year on the field: e.g. durum then sorghum.
export function yearTypes() {
  const list = [{ id: 'alfalfa', parts: ['alfalfa'] }];
  for (const w of BEFORE_COTTON) list.push({ id: `${w}+cotton`, parts: [w, 'cotton'] });
  for (const w of WINTER) for (const s of SUMMER) list.push({ id: `${w}+${s}`, parts: [w, s] });
  for (const y of list) y.label = yearLabel(y);
  return list;
}

export function yearLabel(y) {
  const p = y.parts.filter((c) => c !== 'fallow').map((c) => CROPS[c].short);
  if (y.parts[0] === 'alfalfa') return 'Alfalfa, all year';
  if (!p.length) return 'Bare all year';
  if (y.parts.length === 2 && y.parts[1] === 'fallow' && y.parts[0] !== 'fallow') return `${CROPS[y.parts[0]].short}, then bare`;
  if (y.parts[0] === 'fallow') return `Bare, then ${CROPS[y.parts[1]].short.toLowerCase()}`;
  return `${p[0]}, then ${p[1].toLowerCase()}`;
}

// Per-year-type, per-crop-year results, computed once per weather/stress setting.
export function buildYearTable(prep, types, efficiency) {
  const table = new Map();
  for (const yt of types) {
    const perYear = new Map();
    for (const cy of prep.cropYears) {
      const etc = Array(12).fill(0);
      const hits = [];
      for (const c of yt.parts) {
        const r = cropYear(prep, c, cy);
        r.etc.forEach((v, k) => (etc[k] += v));
        hits.push(...r.hits);
      }
      const rain = monthlyRain(prep, cy);
      let net = 0;
      for (let k = 0; k < 12; k++) if (etc[k] > 0) net += Math.max(0, etc[k] - EFFECTIVE_RAIN * rain[k]);
      perYear.set(cy, { etcMm: etc.reduce((a, b) => a + b, 0), netAcft: net / MM_PER_ACFT, grossAcft: net / MM_PER_ACFT / efficiency, hits });
    }
    table.set(yt.id, perYear);
  }
  return table;
}

const rainCache = new WeakMap();
function monthlyRain(prep, cy) {
  let c = rainCache.get(prep);
  if (!c) { c = new Map(); rainCache.set(prep, c); }
  if (c.has(cy)) return c.get(cy);
  const r = Array(12).fill(0);
  for (let t = Date.UTC(cy - 1, 10, 1); t <= Date.UTC(cy, 9, 31); t += DAY_MS) {
    const i = prep.index.get(keyOf(t));
    if (i !== undefined) r[cyMonthIndex(prep.days[i].m)] += prep.days[i].rain;
  }
  c.set(cy, r);
  return r;
}

// All 3-year rotations. Alfalfa years must sit together (one stand).
export function enumerateRotations(types, excluded = new Set()) {
  const ok = types.filter((t) => t.parts.every((c) => !excluded.has(c)));
  const out = [];
  for (const a of ok) for (const b of ok) for (const c of ok) {
    const seq = [a, b, c];
    const alf = seq.map((t) => t.id === 'alfalfa');
    if (alf[0] && !alf[1] && alf[2]) continue;
    out.push(seq.map((t) => t.id));
  }
  return out;
}

// ---------- scoring ----------

export function evaluate(rotation, ctx) {
  const { types, table, prep, allotment } = ctx;
  const seq = rotation.map((id) => types.find((t) => t.id === id));
  const years = prep.cropYears;

  // Water and year replay
  const replay = [];
  let sumNet = 0, sumGross = 0;
  for (const cy of years) {
    const rows = seq.map((t) => table.get(t.id).get(cy));
    const gross = rows.map((r) => r.grossAcft);
    const hits = rows.flatMap((r) => r.hits);
    const worst = Math.max(...gross);
    let status = 'good';
    if (worst > allotment * 1.15) status = 'bad';
    else if (worst > allotment || hits.length) status = 'warn';
    replay.push({ cy, status, worstGross: worst, avgGross: avg(gross), hits });
    sumNet += avg(rows.map((r) => r.netAcft));
    sumGross += avg(gross);
  }
  const netAcft = sumNet / years.length;
  const grossAcft = sumGross / years.length;

  // Calendar: 36 cells
  const calendar = [];
  seq.forEach((t, yi) => {
    const cells = Array(12).fill('fallow');
    for (const c of t.parts) for (const k of occupiedMonths(c)) cells[k] = c;
    cells.forEach((c, k) => calendar.push({ year: yi, k, month: CY_MONTHS[k], crop: c }));
  });
  const bareMonths = calendar.filter((c) => c.crop === 'fallow').length;
  const windyBare = calendar.filter((c) => c.crop === 'fallow' && [3, 4, 5, 6].includes(c.month)).length;

  // Soil health parts
  const parts = seq.flatMap((t) => (t.parts[0] === 'alfalfa' ? ['alfalfa', 'alfalfa'] : t.parts));
  const legumeSeasons = parts.filter((c) => CROPS[c].legume).length;
  const families = new Set(parts.filter((c) => c !== 'fallow').map((c) => CROPS[c].family));
  const cash = parts.filter((c) => CROPS[c].role === 'cash');
  let breaks = 0, pairs = 0;
  for (let i = 1; i < cash.length; i++) {
    if (cash[i] === 'alfalfa' && cash[i - 1] === 'alfalfa') continue; // one standing crop, not a replant
    pairs++;
    if (CROPS[cash[i]].family !== CROPS[cash[i - 1]].family) breaks++;
  }
  const sameCropRepeats = countRepeats(seq);
  const pestBreak = pairs ? breaks / pairs : (cash.length ? 0 : 1);
  const deepYears = seq.filter((t) => t.parts.some((c) => CROPS[c].deepRoots)).length;
  const alfalfaYears = seq.filter((t) => t.id === 'alfalfa').length;

  // Living roots most of the year matter most for desert soil (cover, organic
  // matter, erosion), then nitrogen from legumes, then diversity and pest breaks.
  let soil = 0;
  soil += 35 * ((36 - bareMonths) / 36);
  soil += 20 * Math.min(1, legumeSeasons / 3);
  soil += 10 * ((Math.max(1, Math.min(families.size, 4)) - 1) / 3);
  soil += 15 * (alfalfaYears === 3 ? 0.5 : pestBreak);
  soil += 10 * (deepYears / 3);
  soil += 10 * (alfalfaYears / 3);
  soil -= Math.min(15, windyBare * 2);
  soil -= 6 * sameCropRepeats;
  soil = clamp(soil);

  const ratio = grossAcft / allotment;
  // Using water you have is fine; going over your supply is not. Score falls
  // gently from 60% of your supply and steeply once a plan needs more than you have.
  const water = clamp(100 - 40 * Math.max(0, ratio - 0.6) - 80 * Math.max(0, ratio - 1));
  const resilience = clamp((100 * replay.reduce((a, r) => a + (r.status === 'good' ? 1 : r.status === 'warn' ? 0.5 : 0), 0)) / replay.length);
  const income = clamp((100 * avg(seq.map((t) => Math.min(6, t.parts.reduce((a, c) => a + CROPS[c].income, 0))))) / 6);

  const w = ctx.weights;
  const wsum = w.water + w.soil + w.resilience + w.income || 1;
  const total = (w.water * water + w.soil * soil + w.resilience * resilience + w.income * income) / wsum;

  return {
    rotation, seq, labels: seq.map((t) => t.label),
    netAcft, grossAcft, replay, calendar, bareMonths, windyBare, legumeSeasons,
    families: [...families], pestBreak, sameCropRepeats, alfalfaYears,
    scores: { water: Math.round(water), soil: Math.round(soil), resilience: Math.round(resilience), income: Math.round(income), total: Math.round(total * 10) / 10 },
    confidence: confidenceFor(seq, ctx),
  };
}

// Same cash crop in the same season two years running (alfalfa stands excluded).
function countRepeats(seq) {
  let n = 0;
  for (let i = 1; i < seq.length; i++) {
    seq[i].parts.forEach((c, slot) => {
      if (c !== 'alfalfa' && CROPS[c].role === 'cash' && seq[i - 1].parts[slot] === c) n++;
    });
  }
  return n;
}

export function inCalendarArea(lat, lon) {
  const a = CALENDAR_AREA;
  return lat >= a.latMin && lat <= a.latMax && lon >= a.lonMin && lon <= a.lonMax;
}

function confidenceFor(seq, ctx) {
  const approx = [...new Set(seq.flatMap((t) => t.parts).filter((c) => CROPS[c].approx))];
  const reasons = [];
  let level = 'High';
  if (!ctx.inArea) { level = 'Low'; reasons.push({ k: 'conf_area' }); }
  if (ctx.prep.cropYears.length < 10) { level = 'Low'; reasons.push({ k: 'conf_years' }); }
  if (approx.length && level === 'High') level = 'Medium';
  if (approx.length) reasons.push({ k: 'conf_approx', crops: approx });
  if (!reasons.length) reasons.push({ k: 'conf_ok' });
  return { level, reasons };
}

// Pick the best options that are actually different from each other.
export function rank(results, baseline, count = 3) {
  const sorted = results.filter((r) => r.rotation.join() !== baseline.join()).sort((a, b) => b.scores.total - a.scores.total);
  const picked = [];
  const seen = new Set();
  for (const r of sorted) {
    const key = [...new Set(r.seq.flatMap((t) => t.parts))].filter((c) => c !== 'fallow').sort().join();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(r);
    if (picked.length === count) break;
  }
  return picked;
}

// ---------- explanation (translatable keys, text lives in i18n.js) ----------

export function explain(r, base) {
  const why = [];
  const diff = base.netAcft - r.netAcft;
  if (r !== base && Math.abs(diff) >= 0.1) why.push(diff > 0 ? { k: 'whyLess', v: { n: fmt(diff), gal: Math.round(diff * GALLONS_PER_ACFT) } } : { k: 'whyMore', v: { n: fmt(-diff) } });
  if (r.legumeSeasons >= 2) why.push({ k: 'whyLegume', v: { n: r.legumeSeasons } });
  if (r.bareMonths === 0) why.push({ k: 'whyCovered' });
  else if (r.windyBare > 0) why.push({ k: 'whyWindy', v: { n: r.windyBare } });
  if (r.pestBreak >= 0.99 && r.alfalfaYears < 3) why.push({ k: 'whyPest' });
  if (r.sameCropRepeats > 0) why.push({ k: 'whyRepeat' });
  const good = r.replay.filter((y) => y.status === 'good').length;
  const bad = r.replay.filter((y) => y.status === 'bad').length;
  why.push({ k: bad ? 'whyReplayBad' : 'whyReplay', v: { good, bad, n: r.replay.length } });
  const heat = new Set(r.replay.flatMap((y) => y.hits.filter((h) => h.kind === 'heat').map((h) => h.crop)));
  for (const c of heat) why.push({ k: 'whyHeat', v: { crop: c } });
  const expert = ['expDates', 'expPests'];
  if (r.seq.some((t) => t.parts.includes('guar') || t.parts.includes('sesame'))) expert.push('expMarket');
  if (r.alfalfaYears) expert.push('expAlfalfa');
  return { why, gaps: ['gapWater', 'gapPrice', 'gapSalt'], expert };
}

// ---------- month-by-month plan ----------

// Events for each year of a rotation: plant, harvest, cover in/out, bare stretches.
export function monthPlan(r) {
  const ev = [];
  r.seq.forEach((t, y) => {
    for (const c of t.parts) {
      if (c === 'fallow') continue;
      const crop = CROPS[c];
      if (crop.perennial) { ev.push({ y, k: 0, kind: 'standing', crop: c }); continue; }
      const t0 = plantTime(crop, 2024);
      const tEnd = t0 + (seasonLength(crop) - 1) * DAY_MS;
      const m0 = new Date(t0).getUTCMonth() + 1, m1 = new Date(tEnd).getUTCMonth() + 1;
      const cover = crop.role === 'cover';
      ev.push({ y, k: cyMonthIndex(m0), month: m0, day: new Date(t0).getUTCDate(), kind: cover ? 'coverIn' : 'plant', crop: c });
      ev.push({ y, k: cyMonthIndex(m1), month: m1, day: new Date(tEnd).getUTCDate(), kind: cover ? 'coverOut' : 'harvest', crop: c });
    }
  });
  // bare stretches of 2+ months
  for (let y = 0; y < 3; y++) {
    const cells = r.calendar.filter((c) => c.year === y);
    let run = [];
    const flush = () => { if (run.length >= 2) ev.push({ y, k: run[0].k, kind: 'bare', months: run.length, from: run[0].month, to: run[run.length - 1].month }); run = []; };
    for (const c of cells) c.crop === 'fallow' ? run.push(c) : flush();
    flush();
  }
  return ev.sort((a, b) => a.y - b.y || a.k - b.k || (a.kind === 'harvest' ? -1 : 1));
}

// ---------- context for fast re-scoring ----------

export function createContext(weather, inputs) {
  const prep = prepareWeather(weather, inputs.stress);
  const types = yearTypes();
  const efficiency = IRRIGATION_EFFICIENCY[inputs.irrigation] || 0.8;
  const table = buildYearTable(prep, types, efficiency);
  return { types, table, prep, allotment: inputs.allotment, weights: inputs.weights, inArea: inCalendarArea(weather.lat, weather.lon) };
}

export function scoreOne(ctx, rotation, baseline) {
  const r = evaluate(rotation, ctx);
  r.explain = explain(r, baseline || r);
  r.plan = monthPlan(r);
  return r;
}

export function run(weather, inputs) {
  const ctx = createContext(weather, inputs);
  const excluded = new Set(inputs.excluded || []);
  const all = enumerateRotations(ctx.types, excluded).map((rot) => evaluate(rot, ctx));
  const baseline = evaluate(inputs.baseline, ctx);
  const options = rank(all, inputs.baseline, inputs.count || 3);
  for (const o of [baseline, ...options]) { o.explain = explain(o, baseline); o.plan = monthPlan(o); }
  return { prep: ctx.prep, climate: climate(ctx.prep), baseline, options, all, ctx };
}

// ---------- helpers ----------
function avg(a) { return a.reduce((x, y) => x + y, 0) / (a.length || 1); }
function clamp(v) { return Math.max(0, Math.min(100, v)); }
export function fmt(v) { return (Math.round(v * 10) / 10).toFixed(1); }
export function galFmt(acft) {
  const g = acft * GALLONS_PER_ACFT;
  return g >= 1e6 ? `${(g / 1e6).toFixed(2)} million` : `${Math.round(g / 1000)} thousand`;
}
