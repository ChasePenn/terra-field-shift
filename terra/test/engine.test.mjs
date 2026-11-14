// Run: node terra/test/engine.test.mjs
// Uses a TEST-ONLY weather series built from Phoenix 1991-2020 monthly normals
// (NOAA). It is never shown in the app; the app only uses live NASA POWER data.
import assert from 'node:assert/strict';
import { run, yearTypes, enumerateRotations, occupiedMonths, hargreavesET0, extraterrestrialRadiation, MM_PER_ACFT } from '../js/engine.js';
import { CROPS, REFERENCE_USE_IN } from '../js/crops.js';

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
assert.equal(res.options.length, 3);
for (const o of [res.baseline, ...res.options]) {
  assert.equal(o.calendar.length, 36);
  assert.equal(o.replay.length, res.prep.cropYears.length);
  assert.ok(o.explain.why.length >= 1 && o.plan.length >= 1);
  assert.ok(['High', 'Medium', 'Low'].includes(o.confidence.level));
}
console.log('Baseline: ' + res.baseline.labels.join(' | ') + `  ${res.baseline.netAcft.toFixed(2)} ac-ft/ac`, res.baseline.scores);
for (const o of res.options) console.log('Option:   ' + o.labels.join(' | ') + `  ${o.netAcft.toFixed(2)} ac-ft/ac`, o.scores, o.confidence.level);

// 6. Priorities change the ranking.
const incomeFirst = run(fixture(), { ...inputs, weights: { water: 0, soil: 0, resilience: 0, income: 5 } });
assert.notDeepEqual(incomeFirst.options[0].rotation, res.options[0].rotation, 'income-first should rank differently');

// 7. Hotter, drier weather raises water need.
const hot = run(fixture(), { ...inputs, stress: { dT: 2, rainPct: -20 } });
assert.ok(hot.baseline.netAcft > res.baseline.netAcft);

// 8. Outside central Arizona -> low confidence.
const far = run(fixture(41.6, -93.6), inputs);
assert.equal(far.baseline.confidence.level, 'Low');

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
  const real = run({ lat: f.lat, lon: f.lon, dates, tmax: f.tmax, tmin: f.tmin, rain: f.rain }, inputs);
  console.log(`Real NASA POWER, Casa Grande: ET0 ${real.climate.et0In.toFixed(1)} in/yr, rain ${real.climate.rainIn.toFixed(1)} in/yr`);
  for (const [crop, yt] of Object.entries(single)) {
    const ys = real.prep.cropYears;
    const avgIn = ys.reduce((a, y) => a + real.ctx.table.get(yt).get(y).etcMm, 0) / ys.length / 25.4;
    const ref = REFERENCE_USE_IN[crop];
    console.log(`  ${CROPS[crop].short.padEnd(8)} model ${avgIn.toFixed(1)} in   published ${ref} in`);
    assert.ok(Math.abs(avgIn - ref) / ref < 0.25, `${crop} off on real data`);
  }
  console.log('Real-data check passed.');
}
