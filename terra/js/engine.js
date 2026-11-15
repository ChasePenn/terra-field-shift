// TERRA rotation engine. Pure functions, no DOM, so it runs in the browser
// and in Node tests.
//
// Inputs: daily NASA POWER weather for one point (temperature, dew point,
// wind, sunlight, rain).
// Method:
//   1. Reference evapotranspiration (ET0) per day with FAO-56 Penman-Monteith,
//      bias-corrected month by month against University of Arizona AZMET
//      stations inside Arizona (see scripts/fetch-data.mjs). Days missing
//      sunlight, humidity or wind use Hargreaves (FAO-56 eq. 52).
//   2. Crop water use = Kc x ET0, with FAO-56 crop coefficient curves.
//   3. Irrigation need = crop water use minus effective rain (USDA-SCS monthly method, FAO CROPWAT).
//   4. Every rotation is replayed against each real crop year in the record.

import { CROPS, WINTER, SUMMER, BEFORE_COTTON, CY_MONTHS, CALENDAR_AREA } from './crops.js';
import { DAY_MS, dayOfYear, extraterrestrialRadiation, hargreavesET0, dailyET0, canopyTemp, HEAT_L1_C, HEAT_L2_C } from './et.js';
import { yearNet, supplyAfter, SHORTAGE, WATER_PRICE_DEFAULT } from './economics.js';

export { extraterrestrialRadiation, hargreavesET0 };

export const MM_PER_ACFT = 304.8;
export const GALLONS_PER_ACFT = 325851;
// Share of a month's rain a crop can use. USDA Soil Conservation Service method as
// used in FAO CROPWAT: small showers count almost fully, big storms run off.
export function effectiveRain(mm) {
  return mm <= 250 ? mm * (125 - 0.2 * mm) / 125 : 125 + 0.1 * mm;
}
export const IRRIGATION_EFFICIENCY = { drip: 0.9, sprinkler: 0.8, furrow: 0.7 };

// Arizona, where the AZMET bias correction was fitted and checked.
export function inArizona(lat, lon) { return lat >= 31.3 && lat <= 37.0 && lon >= -114.9 && lon <= -109.0; }

// weather: { lat, lon, z, dates: ['YYYYMMDD'...], tmax, tmin, rain, dew?, u2?, rs? }
// stress:  { dT: degrees C added to max and min, rainPct: -50..+50 }
// calib:   { monthlyFactor: [12], hgFactor } from data/validation.json
export function prepareWeather(weather, stress = { dT: 0, rainPct: 0 }, calib = null) {
  const az = calib && inArizona(weather.lat, weather.lon ?? 0);
  const mf = az ? calib.monthlyFactor : null;
  const hgF = az ? calib.hgFactor || 1 : 1;
  // Which calibrated method won on held-out AZMET stations: 'pm', 'hg' or 'blend'.
  const method = az ? calib.method || 'pm' : 'pm';
  let pmDays = 0;
  const n = weather.dates.length;
  const days = new Array(n);
  const index = new Map();
  for (let i = 0; i < n; i++) {
    const s = String(weather.dates[i]);
    const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
    const tmax = weather.tmax[i] + stress.dT;
    const tmin = weather.tmin[i] + stress.dT;
    const rain = Math.max(0, weather.rain[i] * (1 + stress.rainPct / 100));
    const dew = weather.dew ? weather.dew[i] : null;
    const day = { y, m, d, tmax, tmin, rain, dew, u2: weather.u2 ? weather.u2[i] : null, rs: weather.rs ? weather.rs[i] : null };
    const r = dailyET0(day, weather.lat, weather.z, hgF);
    const hg = hgF * hargreavesET0(tmax, tmin, extraterrestrialRadiation(weather.lat, dayOfYear(y, m, d)));
    if (r.method === 'pm') {
      pmDays++;
      const pm = mf ? r.et0 * mf[m - 1] : r.et0;
      day.et0 = method === 'hg' ? hg : method === 'blend' ? 0.5 * (pm + hg) : pm;
    } else day.et0 = hg;
    days[i] = day;
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
  return { lat: weather.lat, days, index, cropYears, pmShare: n ? pmDays / n : 0, calibrated: !!mf, method: az ? method : 'pm' };
}

function keyOf(t) {
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function cyMonthIndex(m) { return (m + 1) % 12; } // Nov -> 0 ... Oct -> 11

export function climate(prep, canopy = null) {
  const out = { years: prep.cropYears.length, rainIn: 0, et0In: 0, hot110: 0, frost: 0, monthlyEt0: Array(12).fill(0), monthlyRain: Array(12).fill(0), monthlyTmax: Array(12).fill(0), pmShare: prep.pmShare, calibrated: prep.calibrated };
  if (!prep.cropYears.length) return out;
  const set = new Set(prep.cropYears);
  const counts = Array(12).fill(0);
  // per crop year: 110°F days, cotton canopy heat stress days (Jul-Aug bloom),
  // heavy monsoon rain days (1 inch or more, Jul-Sep)
  const per = new Map(prep.cropYears.map((cy) => [cy, { hot: 0, l1: 0, l2: 0, heavy: 0, monsoonIn: 0, dewDays: 0 }]));
  for (const d of prep.days) {
    const cy = d.m >= 11 ? d.y + 1 : d.y;
    if (!set.has(cy)) continue;
    const k = cyMonthIndex(d.m);
    const p = per.get(cy);
    out.rainIn += d.rain; out.et0In += d.et0;
    out.monthlyEt0[k] += d.et0; out.monthlyRain[k] += d.rain; out.monthlyTmax[k] += d.tmax; counts[k]++;
    if (d.tmax >= 43.3) { out.hot110++; p.hot++; }
    if (d.tmin <= 0) out.frost++;
    if (d.m >= 7 && d.m <= 9) { p.monsoonIn += d.rain / 25.4; if (d.rain >= 25.4) p.heavy++; }
    if ((d.m === 7 || d.m === 8) && d.dew != null) {
      const c = canopyTemp(d.tmax, d.tmin, d.dew, canopy || undefined);
      p.dewDays++;
      if (c > HEAT_L1_C) p.l1++;
      if (c > HEAT_L2_C) p.l2++;
    }
  }
  const n = prep.cropYears.length;
  out.rainIn = out.rainIn / n / 25.4;
  out.et0In = out.et0In / n / 25.4;
  out.hot110 /= n; out.frost /= n;
  for (let k = 0; k < 12; k++) {
    out.monthlyEt0[k] /= n; out.monthlyRain[k] /= n; out.monthlyTmax[k] /= counts[k] || 1;
  }
  const yrs = prep.cropYears;
  const series = (f) => yrs.map((cy) => [cy, f(per.get(cy))]);
  out.heat = {
    byYear: series((p) => p.hot),
    perDecade: theilSen(series((p) => p.hot)) * 10,
    early: avg(yrs.filter((y) => y <= yrs[0] + 9).map((y) => per.get(y).hot)),
    late: avg(yrs.filter((y) => y > yrs[yrs.length - 1] - 10).map((y) => per.get(y).hot)),
  };
  const haveCanopy = yrs.every((y) => per.get(y).dewDays > 50);
  out.cottonHeat = haveCanopy ? {
    byYear: series((p) => p.l1),
    avgL1: avg(yrs.map((y) => per.get(y).l1)), avgL2: avg(yrs.map((y) => per.get(y).l2)),
    perDecade: theilSen(series((p) => p.l1)) * 10,
  } : null;
  out.monsoon = {
    byYear: series((p) => p.heavy),
    yearsWithHeavy: yrs.filter((y) => per.get(y).heavy > 0).length,
    avgIn: avg(yrs.map((y) => per.get(y).monsoonIn)),
  };
  return out;
}

// Theil-Sen slope: median of all pairwise slopes. Robust to one odd year.
export function theilSen(pts) {
  const s = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[j][0] !== pts[i][0]) s.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
  if (!s.length) return 0;
  s.sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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
      for (let k = 0; k < 12; k++) if (etc[k] > 0) net += Math.max(0, etc[k] - effectiveRain(rain[k]));
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

  // Water, money and year replay at the farm's water supply after any shortage.
  const supply = supplyAfter(allotment, ctx.capShare || 0, ctx.shortage || 'none');
  const outcome = (sup) => {
    const rep = [];
    for (const cy of years) {
      const rows = seq.map((t) => table.get(t.id).get(cy));
      const gross = rows.map((r) => r.grossAcft);
      const hits = rows.flatMap((r) => r.hits);
      const worst = Math.max(...gross);
      let status = 'good';
      if (worst > sup * 1.15) status = 'bad';
      else if (worst > sup || hits.length) status = 'warn';
      // money: each rotation year gets the water it needs up to the supply
      const money = seq.map((t, i) => {
        const need = gross[i];
        const applied = Math.min(need, sup);
        const deficit = need > 0 ? 1 - applied / need : 0;
        return yearNet(t.parts, applied, deficit, { waterPrice: ctx.waterPrice, prices: ctx.prices });
      });
      rep.push({ cy, status, worstGross: worst, avgGross: avg(gross), avgNet: avg(rows.map((r) => r.netAcft)), hits,
        profit: avg(money.map((m) => m.net)), cash: avg(money.map((m) => m.cash)), revenue: avg(money.map((m) => m.revenue)), waterCost: avg(money.map((m) => m.water)) });
    }
    return rep;
  };
  const replay = outcome(supply);
  const netAcft = avg(replay.map((r) => r.avgNet));
  const grossAcft = avg(replay.map((r) => r.avgGross));
  const profits = replay.map((r) => r.profit);
  const cashes = replay.map((r) => r.cash);
  const money = { mean: avg(profits), low: quantile(profits, 0.1), high: quantile(profits, 0.9), cash: avg(cashes), cashLow: quantile(cashes, 0.1), cashHigh: quantile(cashes, 0.9), waterCost: avg(replay.map((r) => r.waterCost)), revenue: avg(replay.map((r) => r.revenue)) };
  // What each Colorado River shortage level would do to this plan.
  const tiers = {};
  if (ctx.lite) return { money, grossAcft, rotation };
  for (const tier of Object.keys(SHORTAGE)) {
    const rep = tier === (ctx.shortage || 'none') ? replay : outcome(supplyAfter(allotment, ctx.capShare || 0, tier));
    tiers[tier] = { good: rep.filter((r) => r.status === 'good').length, profit: avg(rep.map((r) => r.profit)), cash: avg(rep.map((r) => r.cash)), supply: supplyAfter(allotment, ctx.capShare || 0, tier) };
  }

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

  const ratio = grossAcft / supply;
  // Water: where this plan's water need sits among every plan that fits this field
  // (100 = thirstiest-free end). A plan that needs more than your supply cannot score
  // above the share of your supply it leaves unused.
  let water = ctx.waterRank ? 100 * (1 - rankOf(ctx.waterRank, grossAcft)) : clamp(100 * (1 - ratio));
  if (ratio > 1) water = Math.min(water, clamp(100 * (2 - ratio) * 0.4));
  water = clamp(water);
  const good = replay.filter((r) => r.status === 'good').length, warn = replay.filter((r) => r.status === 'warn').length;
  const resilience = clamp((100 * (good + 0.5 * warn)) / replay.length);
  // Worst three years: average share of water need you could not cover.
  const shortfalls = replay.map((r) => Math.max(0, 1 - supply / (r.worstGross || 1))).sort((a, b) => b - a);
  const worst3 = avg(shortfalls.slice(0, 3));
  // Income: where this plan's average profit sits among all plans checked.
  // Income score: where this plan's average profit sits between a weak plan (10th percentile) and the best plan.
  const pr = ctx.profitRank;
  const income = pr ? clamp(100 * (money.cash - quantile(pr, 0.1)) / Math.max(1, pr[pr.length - 1] - quantile(pr, 0.1))) : 50;

  const w = ctx.weights;
  const wsum = w.water + w.soil + w.resilience + w.income || 1;
  const total = (w.water * water + w.soil * soil + w.resilience * resilience + w.income * income) / wsum;

  return {
    rotation, seq, labels: seq.map((t) => t.label),
    netAcft, grossAcft, supply, money, tiers, replay, calendar, bareMonths, windyBare, legumeSeasons,
    families: [...families], pestBreak, sameCropRepeats, alfalfaYears,
    scores: { water: Math.round(water), soil: Math.round(soil), resilience: Math.round(resilience), income: Math.round(income), total: Math.round(total * 10) / 10 },
    confidence: confidenceFor(seq, ctx),
    detail: { ratio, good, warn, years: replay.length, worst3, incomePct: ctx.profitRank ? rankOf(ctx.profitRank, money.cash) : null, waterPct: ctx.waterRank ? 1 - rankOf(ctx.waterRank, grossAcft) : null, plans: ctx.waterRank ? ctx.waterRank.length : 0 },
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
  const prep = prepareWeather(weather, inputs.stress, inputs.calib);
  const types = yearTypes();
  const efficiency = IRRIGATION_EFFICIENCY[inputs.irrigation] || 0.8;
  const table = buildYearTable(prep, types, efficiency);
  return { types, table, prep, allotment: inputs.allotment, capShare: inputs.capShare || 0, shortage: inputs.shortage || 'none', waterPrice: inputs.waterPrice ?? WATER_PRICE_DEFAULT, prices: inputs.prices || {}, weights: inputs.weights, inArea: inCalendarArea(weather.lat, weather.lon), canopy: inputs.canopy || null };
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
  const rots = enumerateRotations(ctx.types, excluded);
  // First pass finds every plan's profit, second pass scores income against them.
  ctx.lite = true;
  const lite = rots.map((rot) => evaluate(rot, ctx));
  // A real plan sells a crop every year (no blank years) and does not plant the same cash crop all 3 years.
  // If the farmer left out so many crops that too few plans qualify, relax step by step.
  const cash = (id) => id.split('+').filter((c) => CROPS[c]?.role === 'cash');
  const cashYears = (r) => r.rotation.filter((id) => cash(id).length).length;
  const mono = (r) => { const ids = r.rotation.map((id) => cash(id).join('+')); return ids[0] && ids.every((x) => x === ids[0]); };
  const tests = [(r) => cashYears(r) === 3 && !mono(r), (r) => cashYears(r) >= 2 && !mono(r), (r) => cashYears(r) >= 2, (r) => cashYears(r) >= 1, () => true];
  const realPlan = tests.find((f) => lite.filter(f).length >= 8) || tests[tests.length - 1];
  ctx.profitRank = lite.filter(realPlan).map((x) => x.money.cash).sort((a, b) => a - b);
  ctx.waterRank = lite.map((x) => x.grossAcft).sort((a, b) => a - b);
  ctx.lite = false;
  const all = rots.map((rot) => evaluate(rot, ctx));
  const baseline = evaluate(inputs.baseline, ctx);
  // One plan per goal, each the true leader for that goal, so the names never lie.
  const pool = all.filter((r) => r.rotation.join() !== inputs.baseline.join() && realPlan(r));
  const totals = pool.map((r) => r.scores.total).sort((a, b) => a - b);
  const strong = pool.filter((r) => r.scores.total >= quantile(totals, 0.7)); // skip silly plans like leaving the field bare
  const top = (list, cmp) => [...list].sort(cmp)[0];
  const leaders = [
    ['income', top(pool, (a, b) => b.money.cash - a.money.cash || b.scores.total - a.scores.total)],
    ['water', top(strong, (a, b) => a.netAcft - b.netAcft || b.scores.total - a.scores.total)],
    ['soil', top(strong, (a, b) => b.scores.soil - a.scores.soil || b.scores.total - a.scores.total)],
    // Held up best in this field's worst past years: most years within supply, smallest shortfall in the 3 worst, then income.
    ['safe', top(pool, (a, b) => b.detail.good - a.detail.good || a.detail.worst3 - b.detail.worst3 || b.money.cash - a.money.cash)],
  ];
  const options = [];
  for (const [lens, lead] of leaders) {
    if (!lead) continue;
    // If a plan already on the list does just as well in bad years, name that one instead of adding a near copy.
    const r = lens === 'safe' ? options.find((o) => o.detail.good === lead.detail.good && o.detail.worst3 <= lead.detail.worst3 + 0.02) || lead : lead;
    r.lenses = r.lenses || [];
    r.lenses.push(lens);
    if (lens === 'safe') r.safest = true;
    if (!options.includes(r)) options.push(r);
  }
  for (const o of [baseline, ...options]) { o.explain = explain(o, baseline); o.plan = monthPlan(o); }
  return { prep: ctx.prep, climate: climate(ctx.prep, ctx.canopy), baseline, options, all, ctx };
}

// Average seasonal crop water use (inches) for single-crop years, to compare
// against published Arizona field measurements.
export const SINGLE_YEAR = { alfalfa: 'alfalfa', cotton: 'fallow+cotton', wheat: 'wheat+fallow', barley: 'barley+fallow', sorghum: 'fallow+sorghum', guar: 'fallow+guar' };
export function cropUse(ctx) {
  const ys = ctx.prep.cropYears;
  const out = {};
  for (const [c, yt] of Object.entries(SINGLE_YEAR)) out[c] = ys.reduce((a, y) => a + ctx.table.get(yt).get(y).etcMm, 0) / (ys.length || 1) / 25.4;
  return out;
}

// ---------- helpers ----------
function avg(a) { return a.reduce((x, y) => x + y, 0) / (a.length || 1); }
export function quantile(a, q) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
function rankOf(sorted, v) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  return sorted.length > 1 ? lo / (sorted.length - 1) : 0.5;
}
function clamp(v) { return Math.max(0, Math.min(100, v)); }
export function fmt(v) { return (Math.round(v * 10) / 10).toFixed(1); }
export function galFmt(acft) {
  const g = acft * GALLONS_PER_ACFT;
  return g >= 1e6 ? `${(g / 1e6).toFixed(2)} million` : `${Math.round(g / 1000)} thousand`;
}
