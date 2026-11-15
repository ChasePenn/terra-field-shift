// Run: node terra/test/engine.test.mjs
// Uses a TEST-ONLY weather series built from Phoenix 1991-2020 monthly normals
// (NOAA). It is never shown in the app; the app only uses live NASA POWER data.
import assert from 'node:assert/strict';
import { run, yearTypes, enumerateRotations, occupiedMonths, hargreavesET0, extraterrestrialRadiation, MM_PER_ACFT } from '../js/engine.js';
import { CROPS, REFERENCE_USE_IN } from '../js/crops.js';
import { penmanMonteithET0, esat, canopyTemp } from '../js/et.js';
import { yearNet, yieldFactor, supplyAfter, BUDGETS, grossRevenue } from '../js/economics.js';
import { theilSen, quantile } from '../js/engine.js';

const NORMALS_F = { // [Tmax, Tmin, rain inches/month]
  1: [67.6, 46.0, 0.91], 2: [71.0, 49.2, 0.92], 3: [77.5, 54.2, 0.99], 4: [85.4, 60.5, 0.28],
  5: [94.8, 69.4, 0.11], 6: [104.2, 78.6, 0.02], 7: [106.5, 85.4, 0.91], 8: [105.1, 84.5, 0.93],
  9: [100.4, 78.0, 0.57], 10: [89.2, 65.8, 0.56], 11: [76.6, 53.6, 0.64], 12: [66.1, 45.4, 0.89],
};
const c = (f) => (f - 32) * 5 / 9;

function fixture(lat = 32.88, lon = -111.75, y0 = 2004, y1 = 2024) {
  const w = { lat, lon, dates: [], tmax: [], tmin: [], rain: [] };
  for (let t = Date.UTC(y0, 10, 1); t <= Date.UTC(y1, 9, 31); t += 86400000) {
    const d = new Date(t), m = d.getUTCMonth() + 1, y = d.getUTCFullYear();
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const [hx, lx, r] = NORMALS_F[m];
    // add a year-to-year swing so the replay has variety
    const swing = Math.sin(y * 1.7) * 1.2;
    w.dates.push(`${y}${String(m).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`);
    w.tmax.push(c(hx) + swing); w.tmin.push(c(lx) + swing);
    w.rain.push((r * 25.4) / dim * (1 + Math.cos(y * 2.3) * 0.5));
  }
  return w;
}

const inputs = {
  baseline: ['alfalfa', 'alfalfa', 'alfalfa'], allotment: 4.5, irrigation: 'sprinkler',
  weights: { water: 3, soil: 3, resilience: 3, income: 1 }, stress: { dT: 0, rainPct: 0 }, excluded: [],
};

// 1. ET0 sanity: a hot June day near Phoenix should be roughly 8-11 mm.
const et = hargreavesET0(c(104), c(79), extraterrestrialRadiation(33.4, 172));
assert.ok(et > 7 && et < 11.5, `June ET0 ${et}`);

// 2. Calendars never overlap inside a year type.
for (const t of yearTypes()) {
  const seen = new Set();
  for (const p of t.parts) for (const k of occupiedMonths(p)) {
    assert.ok(!seen.has(k), `${t.id} overlaps in month ${k}`);
    seen.add(k);
  }
}

// 3. Alfalfa stands stay together, exclusions are respected.
const types = yearTypes();
const rots = enumerateRotations(types, new Set(['cotton']));
assert.ok(rots.every((r) => !r.some((id) => id.includes('cotton'))));
assert.ok(!rots.some((r) => r[0] === 'alfalfa' && r[1] !== 'alfalfa' && r[2] === 'alfalfa'));

// 4. Model water use vs published Arizona numbers (within 30%).
const res = run(fixture(), inputs);
console.log(`Climate fixture: ET0 ${res.climate.et0In.toFixed(1)} in/yr, rain ${res.climate.rainIn.toFixed(1)} in/yr, ${res.prep.cropYears.length} crop years`);
const table = res.ctx.table;
const cy = res.prep.cropYears[5];
const single = { alfalfa: 'alfalfa', cotton: 'fallow+cotton', wheat: 'wheat+fallow', barley: 'barley+fallow', sorghum: 'fallow+sorghum', guar: 'fallow+guar' };
for (const [crop, yt] of Object.entries(single)) {
  const etcIn = table.get(yt).get(cy).etcMm / 25.4;
  const ref = REFERENCE_USE_IN[crop];
  console.log(`  ${CROPS[crop].short.padEnd(8)} model ${etcIn.toFixed(1)} in   published ${ref} in`);
  assert.ok(Math.abs(etcIn - ref) / ref < 0.3, `${crop} water use off: ${etcIn} vs ${ref}`);
}

// 5. Output shape: baseline plus 3 distinct options, explanations, replay.
assert.ok(res.options.length >= 3 && res.options.length <= 4 && res.options.some((o) => o.safest));
for (const o of [res.baseline, ...res.options]) {
  assert.equal(o.calendar.length, 36);
  assert.equal(o.replay.length, res.prep.cropYears.length);
  assert.ok(o.explain.why.length >= 1 && o.plan.length >= 1);
  assert.ok(['High', 'Medium', 'Low'].includes(o.confidence.level));
}
console.log('Baseline: ' + res.baseline.labels.join(' | ') + `  ${res.baseline.netAcft.toFixed(2)} ac-ft/ac`, res.baseline.scores);
for (const o of res.options) console.log('Option:   ' + o.labels.join(' | ') + `  ${o.netAcft.toFixed(2)} ac-ft/ac`, o.scores, o.confidence.level);

// 6. Each named plan really leads its goal.
const real = (r) => r.seq.filter((x) => x.parts.some((c) => CROPS[c]?.role === 'cash')).length === 3 && !r.seq.every((x, _, a) => x.parts.filter((c) => CROPS[c]?.role === 'cash').join() === a[0].parts.filter((c) => CROPS[c]?.role === 'cash').join() && a[0].parts.some((c) => CROPS[c]?.role === 'cash'));
const others = res.all.filter((r) => r.rotation.join() !== inputs.baseline.join() && real(r));
const inc = res.options.find((o) => o.lenses.includes('income'));
assert.ok(others.every((r) => r.money.cash <= inc.money.cash + 1e-9), 'Most income plan must earn the most');
assert.ok(others.every((r) => r.scores.income <= inc.scores.income), 'Most income plan must have the top income score');
const wat = res.options.find((o) => o.lenses.includes('water'));
assert.ok(res.options.every((o) => o.netAcft >= wat.netAcft - 1e-9), 'Least water plan must use the least water of the options');

// 7. Hotter, drier weather raises water need.
const hot = run(fixture(), { ...inputs, stress: { dT: 2, rainPct: -20 } });
assert.ok(hot.baseline.netAcft > res.baseline.netAcft);

// 8. Outside central Arizona -> low confidence.
const far = run(fixture(41.6, -93.6), inputs);
assert.equal(far.baseline.confidence.level, 'Low');

// 9a. Penman-Monteith reproduces FAO-56 Example 18 (Brussels, 6 July): 3.9 mm/day.
{
  const pm = penmanMonteithET0({ tmax: 21.5, tmin: 12.3, ea: 1.409, rs: 22.07, u2: 2.078, z: 100, lat: 50.8, doy: 187 });
  assert.ok(Math.abs(pm - 3.9) < 0.1, `FAO-56 example 18 gives ${pm}`);
  assert.ok(Math.abs(esat(20) - 2.338) < 0.005, 'saturation vapour pressure at 20C');
}

// 9b. Money: a full water supply means no yield loss; a 50% shortfall in cotton
// cuts revenue by Ky x 0.5 = 42.5% (FAO-33).
{
  assert.equal(yieldFactor(0.85, 0), 1);
  assert.ok(Math.abs(yieldFactor(0.85, 0.5) - 0.575) < 1e-9);
  const full = yearNet(['fallow', 'cotton'], 5, 0, { waterPrice: 55 });
  const short = yearNet(['fallow', 'cotton'], 2.5, 0.5, { waterPrice: 55 });
  assert.ok(Math.abs(full.revenue - grossRevenue('cotton')) < 1e-6);
  assert.ok(short.revenue < full.revenue && short.water < full.water);
  // Every crop budget is complete
  for (const [id, b] of Object.entries(BUDGETS)) for (const k of ['yield', 'price', 'variable', 'fixed', 'ky']) assert.ok(Number.isFinite(b[k]), `${id}.${k}`);
  // Shortage: half the water from CAP, Tier 1 cuts 60% of it
  assert.ok(Math.abs(supplyAfter(4, 0.5, 'tier1') - 2.8) < 1e-9);
  assert.equal(supplyAfter(4, 0, 'tier2'), 4);
}

// 9c. Plans carry money ranges and shortage outcomes; a deeper cut never helps.
for (const r of [res.baseline, ...res.options]) {
  assert.ok(r.money.low <= r.money.mean + 1e-6 && r.money.mean <= r.money.high + 1e-6, 'money range ordered');
  assert.ok(Number.isFinite(r.money.cash));
}
{
  const cut = run(fixture(), { ...inputs, capShare: 1 });
  const t = cut.baseline.tiers;
  assert.ok(t.none.good >= t.tier1.good && t.tier1.good >= t.tier2.good, 'shortage tiers monotonic');
  assert.ok(t.none.profit >= t.tier2.profit - 1e-6, 'less water never earns more');
}

// 9d. Trend and range helpers.
assert.equal(theilSen([[0, 0], [1, 1], [2, 2], [3, 3], [4, 40]]), 1);
assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
assert.ok(canopyTemp(40, 25, 5) < 32.5, 'dry desert air keeps the canopy far cooler than the air');

console.log('All engine tests passed. Rotations evaluated:', res.all.length);

// 9. Real NASA POWER data (bundled demo farms) vs published Arizona water use.
const fs = await import('node:fs');
if (!fs.existsSync(new URL('../data/demo.json', import.meta.url))) {
  console.log('No bundled NASA data yet (run node scripts/fetch-data.mjs). Skipping real-data check.');
} else {
  const demo = JSON.parse(fs.readFileSync(new URL('../data/demo.json', import.meta.url)));
  const f = demo.farms.casa;
  const dates = []; let t = Date.UTC(+f.start.slice(0, 4), +f.start.slice(4, 6) - 1, +f.start.slice(6, 8));
  for (let i = 0; i < f.n; i++, t += 864e5) { const d = new Date(t); dates.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`); }
  const vUrl = new URL('../data/validation.json', import.meta.url);
  const val = fs.existsSync(vUrl) ? JSON.parse(fs.readFileSync(vUrl)) : null;
  const real = run({ lat: f.lat, lon: f.lon, z: f.z, dates, tmax: f.tmax, tmin: f.tmin, rain: f.rain, dew: f.dew, u2: f.u2, rs: f.rs }, { ...inputs, calib: val?.et0, canopy: val?.canopy });
  console.log(`Real NASA POWER, Casa Grande: ET0 ${real.climate.et0In.toFixed(1)} in/yr (${Math.round(real.climate.pmShare * 100)}% Penman-Monteith days, ${real.prep.calibrated ? 'AZMET-calibrated' : 'not calibrated'}), rain ${real.climate.rainIn.toFixed(1)} in/yr`);
  for (const [crop, yt] of Object.entries(single)) {
    const ys = real.prep.cropYears;
    const avgIn = ys.reduce((a, y) => a + real.ctx.table.get(yt).get(y).etcMm, 0) / ys.length / 25.4;
    const ref = REFERENCE_USE_IN[crop];
    console.log(`  ${CROPS[crop].short.padEnd(8)} model ${avgIn.toFixed(1)} in   published ${ref} in`);
    // Crops whose FAO values are borrowed (flagged approx in the app) get a wider band.
    const tol = CROPS[crop].approx ? 0.35 : 0.25;
    assert.ok(Math.abs(avgIn - ref) / ref < tol, `${crop} off on real data`);
  }
  console.log('Real-data check passed.');
}
