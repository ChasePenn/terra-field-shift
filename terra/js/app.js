import { CROPS, SOURCES, WINTER, SUMMER, BEFORE_COTTON } from './crops.js';
import { fmt, GALLONS_PER_ACFT } from './engine.js';
import { fetchPower, fetchNdvi, fetchRecent, fetchSoil, loadDemo, demoWeather, textureClass, LAYERS } from './nasa.js';
import { rings, calendarStrip, replayStrip, sparkline, icon } from './charts.js';
import { t, crop, month, getLang, setLang } from './i18n.js';
import { cropArt, scene, heroPlanet } from './art.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const FARMS = [
  { id: 'casa', lat: 32.88, lon: -111.77, name: 'Casa Grande', area: 'Pinal County' },
  { id: 'cool', lat: 32.985, lon: -111.52, name: 'Coolidge', area: 'Pinal County' },
  { id: 'mari', lat: 33.09, lon: -112.02, name: 'Maricopa', area: 'Pinal County' },
  { id: 'buck', lat: 33.38, lon: -112.64, name: 'Buckeye', area: 'Maricopa County' },
];
const PRESETS = [
  { id: 'pAlfalfa', rot: ['alfalfa', 'alfalfa', 'alfalfa'] },
  { id: 'pCotton', rot: ['fallow+cotton', 'fallow+cotton', 'fallow+cotton'] },
  { id: 'pCottonDurum', rot: ['fallow+cotton', 'wheat+fallow', 'fallow+cotton'] },
  { id: 'pDurumSorghum', rot: ['wheat+sorghum', 'wheat+sorghum', 'wheat+sorghum'] },
];
const GOALS = ['water', 'soil', 'resilience', 'income'];
const GOAL_LABEL = { water: 'gWater', soil: 'gSoil', resilience: 'gResilience', income: 'gIncome' };
const EXCLUDABLE = ['alfalfa', 'cotton', 'wheat', 'barley', 'sorghum', 'guar', 'sesame'];
const WATER_TAG = { alfalfa: 'wHigh', cotton: 'wHigh', wheat: 'wMed', sorghum: 'wMed', barley: 'wLow', guar: 'wLow', sesame: 'wLow', wcover: 'wLow', scover: 'wLow', fallow: '' };

// ---------- state ----------
const saved = load();
const state = {
  farm: saved.farm || { ...FARMS[0] },
  baseline: saved.baseline || PRESETS[0].rot.slice(),
  allotment: saved.allotment ?? 4.1,
  irrigation: saved.irrigation || 'furrow',
  goals: new Set(saved.goals || ['water', 'soil']),
  excluded: new Set(saved.excluded || []),
  stress: { dT: 0, rainPct: 0 },
  screen: 'field', layer: 'none', plan: 1,
  weather: null, res: null, build: null, buildResult: null,
  ndvi: null, soil: null, recent: null, loadError: null,
};
function load() { try { return JSON.parse(localStorage.getItem('terra-farm') || '{}'); } catch { return {}; } }
function persist() {
  try {
    localStorage.setItem('terra-farm', JSON.stringify({ farm: state.farm, baseline: state.baseline, allotment: state.allotment, irrigation: state.irrigation, goals: [...state.goals], excluded: [...state.excluded] }));
  } catch { /* fine */ }
}
const weights = () => {
  const w = {};
  for (const g of GOALS) w[g] = state.goals.size ? (state.goals.has(g) ? 5 : 1) : 3;
  return w;
};

// ---------- worker ----------
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let runId = 0, scoreId = 0;
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'run') {
    if (m.id !== runId) return;
    if (!m.ok) return toast(m.error);
    state.res = m;
    if (!state.build) state.build = state.baseline.slice();
    renderAll();
    scoreBuild();
  } else if (m.type === 'score') {
    if (m.id !== scoreId || !m.ok) return;
    state.buildResult = m.result;
    renderBuildResult();
  }
};
let runTimer;
function recompute() {
  if (!state.weather) return;
  clearTimeout(runTimer);
  runTimer = setTimeout(() => {
    runId++;
    worker.postMessage({ id: runId, type: 'run', weather: state.weather, inputs: { baseline: state.baseline, allotment: state.allotment, irrigation: state.irrigation, excluded: [...state.excluded], weights: weights(), stress: state.stress } });
  }, 160);
}
function scoreBuild() {
  if (!state.res || !state.build) return;
  scoreId++;
  worker.postMessage({ id: scoreId, type: 'score', rotation: state.build });
}

// ---------- data loading ----------
let ctl;
async function loadField() {
  ctl?.abort();
  ctl = new AbortController();
  const signal = ctl.signal;
  Object.assign(state, { weather: null, res: null, ndvi: null, soil: null, recent: null, loadError: null, buildResult: null });
  renderAll();
  const { lat, lon } = state.farm;
  const demo = state.farm.custom ? null : await loadDemo();
  if (signal.aborted) return;
  const id = state.farm.id;
  const bundledSoil = demo?.soil?.[id];
  const bundledNdvi = demo?.ndvi?.[id];
  if (bundledSoil && bundledSoil.sand != null) state.soil = { ...bundledSoil, silt: bundledSoil.silt ?? 100 - bundledSoil.sand - bundledSoil.clay, texture: textureClass(bundledSoil.sand, bundledSoil.clay) };
  else fetchSoil(lat, lon, signal).then((s) => { state.soil = s; renderField(); }).catch((e) => { if (e.name !== 'AbortError') { state.soil = { error: true }; renderField(); } });
  if (bundledNdvi && bundledNdvi.length) state.ndvi = bundledNdvi;
  else fetchNdvi(lat, lon, 3, signal).then((r) => { state.ndvi = r; renderField(); }).catch((e) => { if (e.name !== 'AbortError') { state.ndvi = { error: true }; renderField(); } });
  try {
    state.weather = demoWeather(demo, id) || await fetchPower(lat, lon, signal);
    recompute();
    renderField();
    fetchRecent(lat, lon, state.weather, signal).then((r) => { state.recent = r; renderField(); }).catch((e) => { if (e.name !== 'AbortError') { state.recent = { error: true }; renderField(); } });
  } catch (e) {
    if (e.name === 'AbortError') return;
    state.loadError = e.message;
    renderAll();
  }
}

// ---------- shell ----------
const NAV = [['field', 'navField'], ['plans', 'navPlans'], ['build', 'navBuild'], ['learn', 'navLearn']];
function renderShell() {
  const nav = NAV.map(([id, k]) => `<button data-go="${id}" ${state.screen === id ? 'aria-current="page"' : ''}>${icon(id)}<span>${t(k)}</span></button>`).join('');
  $('#railNav').innerHTML = nav;
  $('#tabbar').innerHTML = nav;
  const lang = getLang() === 'en' ? '<b>EN</b> · ES' : 'EN · <b>ES</b>';
  $('#langRail').innerHTML = lang;
  $('#langTop').innerHTML = lang;
  document.documentElement.lang = getLang();
  $$('.screen').forEach((s) => (s.hidden = s.dataset.screen !== state.screen));
}
function go(screen) {
  state.screen = screen;
  if (location.hash !== `#${screen}`) history.replaceState(null, '', `#${screen}`);
  renderShell();
  if (screen === 'field' && map) setTimeout(() => map.resize(), 0);
  window.scrollTo({ top: 0 });
}

function renderAll() {
  renderShell();
  renderField();
  renderPlans();
  renderBuild();
  renderLearn();
  renderLayers();
}

// ---------- field ----------
function placeName() { return state.farm.custom ? t('custom') : `${state.farm.name}, ${state.farm.area}`; }

function renderField() {
  $('#placeChip').innerHTML = `${icon('pin', 18)}<span>${esc(placeName())}</span>`;
  const el = $('#fieldSide');
  if (state.loadError) {
    el.innerHTML = `<div class="hero-title"><h1>${esc(placeName())}</h1></div><div class="err"><span>${t('loadFail')}</span><button class="btn small" data-act="retry">${t('retry')}</button></div>`;
    return;
  }
  const cl = state.res?.climate;
  const tiles = cl ? `
    <div class="tiles">
      <div class="tile"><b class="num">${cl.rainIn.toFixed(1)}<small>in</small></b><span>${t('rainYear')}</span></div>
      <div class="tile"><b class="num">${Math.round(cl.et0In)}<small>in</small></b><span>${t('demandYear')}</span></div>
      <div class="tile"><b class="num">${Math.round(cl.hot110)}</b><span>${t('hotDays')}</span></div>
      <div class="tile"><b class="num">${cl.frost.toFixed(1)}</b><span>${t('frostNights')}</span></div>
    </div>` : `<div class="tiles"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div><p class="muted small" style="margin-top:10px">${t('loadingWeather')}</p>`;

  const best = state.res?.options[0];
  const cta = best ? `<button class="cta" data-go="plans" data-plan="1">
      <div><b>${t('seeBest')}</b><span>${esc(seqText(best))}</span></div>
      <span class="arrow">${icon('arrow')}</span></button>` : '';

  const r = state.recent;
  const recent = !r ? '' : r.error ? '' : (() => {
    const ratio = r.rainIn / (r.normalRainIn || 0.01);
    const tag = ratio > 1.25 ? t('wetter') : ratio < 0.75 ? t('drier') : t('aboutNormal');
    return `<div class="card"><div class="card-h"><h3>${t('thisSeason')}</h3><span class="pill">${tag}</span></div>
      <div class="stack" style="gap:6px"><span>${t('seasonLine', { rain: r.rainIn.toFixed(1), normal: r.normalRainIn.toFixed(1) })}</span><span class="muted">${t('seasonHot', { hot: r.hot, normal: Math.round(r.normalHot) })}</span></div></div>`;
  })();

  const s = state.soil;
  const soil = !s ? `<div class="card"><div class="card-h"><h3>${t('soil')}</h3></div><div class="skeleton" style="min-height:40px"></div></div>`
    : s.error ? '' : `<div class="card"><div class="card-h"><h3>${t('soil')}</h3></div>
      <h2>${esc(t(s.texture === 'sand' ? 'sand_t' : s.texture === 'clay' ? 'clay_t' : s.texture))}</h2>
      <div class="bar3"><i style="flex:${s.sand};background:#d9c38a"></i><i style="flex:${s.silt};background:#a5a08d"></i><i style="flex:${s.clay};background:#7d6a55"></i></div>
      <span class="muted small">${t('sand')} ${Math.round(s.sand)}% · ${t('silt')} ${Math.round(s.silt)}% · ${t('clay')} ${Math.round(s.clay)}%${s.soc != null ? ` · ${(s.soc / 10).toFixed(1)}% ${t('organic')}` : ''}</span></div>`;

  const n = state.ndvi;
  const green = !n ? `<div class="card"><div class="card-h"><h3>${t('greenTitle')}</h3></div><div class="skeleton" style="min-height:64px"></div></div>`
    : n.error || n.length < 6 ? '' : `<div class="card"><div class="card-h"><h3>${t('greenTitle')}</h3></div>
      ${sparkline(n)}<span class="muted small">${t('greenLine', { bare: n.filter((x) => x.ndvi < 0.2).length, n: n.length })}</span></div>`;

  el.innerHTML = `<div class="hero-title"><h1>${esc(placeName())}</h1></div>
    ${tiles}${cta}<div style="margin-top:14px">${recent}${soil}${green}</div>`;
}

function seqText(r) {
  return r.seq.map((tp) => tp.parts.filter((c) => c !== 'fallow').map(crop).join(' → ') || crop('fallow')).join('  ·  ');
}

// ---------- plans ----------
function planList() { return state.res ? [state.res.baseline, ...state.res.options] : []; }

function seqRows(r) {
  return `<div class="seq">${r.seq.map((tp, y) => {
    const parts = tp.parts.filter((c) => c !== 'fallow' || tp.parts.length === 1);
    const shown = parts.length ? parts : ['fallow'];
    return `<div class="seq-row"><span class="yr">${y + 1}</span>${shown.map((c) => `<span class="chip">${cropArt(c, 20)}${esc(crop(c))}</span>`).join('<span class="sep">→</span>')}</div>`;
  }).join('')}</div>`;
}

function headline(r, base) {
  const d = r.netAcft - base.netAcft;
  let big;
  if (r === base || Math.abs(d) < 0.05) big = t('usesGal', { gal: gal(r.netAcft) });
  else if (d < 0) big = t('savesGal', { gal: gal(-d) });
  else big = t('moreGal', { gal: gal(d) });
  return `<div class="headline"><b>${big}</b><span>${t(big === t('usesGal', { gal: gal(r.netAcft) }) ? 'usesLine' : 'vsNow')}</span></div>`;
}

function heroCrop(r) {
  const parts = r.seq.flatMap((tp) => tp.parts);
  return parts.find((c) => CROPS[c].role === 'cash') || parts.find((c) => c !== 'fallow') || 'fallow';
}

function gal(acft) {
  const g = acft * GALLONS_PER_ACFT;
  return g >= 1e6 ? `${(g / 1e6).toFixed(1)}M` : `${Math.round(g / 1000)}k`;
}

// Name each option by what it does best compared with the others.
function optionNames(list) {
  const opts = list.slice(1);
  const used = new Set();
  const picks = [
    ['nameWater', (o) => -o.netAcft],
    ['nameSoil', (o) => o.scores.soil],
    ['nameIncome', (o) => o.scores.income],
    ['nameSafe', (o) => o.scores.resilience],
  ];
  const names = opts.map(() => null);
  for (const [key, f] of picks) {
    let best = -1, bv = -Infinity;
    opts.forEach((o, i) => { if (!names[i] && f(o) > bv) { bv = f(o); best = i; } });
    if (best >= 0 && !used.has(key)) { names[best] = key; used.add(key); }
  }
  return [t('now'), ...names.map((k, i) => (k ? t(k) : t('option', { n: i + 1 })))];
}

function waterDelta(r, base) {
  if (r === base) return '';
  const d = r.netAcft - base.netAcft;
  const gal = Math.abs(d) * GALLONS_PER_ACFT;
  const g = gal >= 1e6 ? `${(gal / 1e6).toFixed(1)}M` : `${Math.round(gal / 1000)}k`;
  if (d < -0.05) return `<span class="pill dark">${t('saves', { gal: g })}</span>`;
  if (d > 0.05) return `<span class="pill">${t('usesMore', { gal: g })}</span>`;
  return `<span class="pill">${t('same')}</span>`;
}

function renderPlans() {
  const el = $('#screen-plans');
  const list = planList();
  if (!list.length) { el.innerHTML = `<div class="screen-h"><h1>${t('navPlans')}</h1></div><div class="stack"><div class="skeleton" style="min-height:260px"></div><div class="skeleton" style="min-height:160px"></div></div>`; return; }
  const i = Math.min(state.plan, list.length - 1);
  const r = list[i], base = list[0];
  const names = optionNames(list);
  const tabs = list.map((p, k) => `<button role="tab" aria-selected="${k === i}" data-plan="${k}">${esc(names[k])}</button>`).join('');
  const fits = r.replay.filter((y) => y.status === 'good').length;
  el.innerHTML = `
    <div class="screen-h"><h1>${t('navPlans')}</h1><div class="tabs" role="tablist">${tabs}</div></div>
    <div class="plan-grid">
      <div class="stack">
        <div class="card ${i > 0 ? 'lime-card' : ''} plan-hero">${heroPlanet(230)}
          <h2>${esc(i === 0 ? t('nowTitle') : names[i])}</h2>
          ${seqRows(r)}
          ${headline(r, base)}
        </div>
        <div class="card">${rings(r.scores)}</div>
        <div class="btn-row">
          <button class="btn primary" data-act="why">${icon('info', 20)}${t('whyBtn')}</button>
          <button class="btn" data-act="month">${icon('cal', 20)}${t('monthBtn')}</button>
          <button class="btn" data-act="edit-plan">${icon('build', 20)}${t('editBtn')}</button>
        </div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-h"><h3>${t('calendar')}</h3></div>${calendarStrip(r)}</div>
        <div class="card"><div class="card-h"><h3>${t('fits', { n: fits, t: r.replay.length })}</h3></div>
          ${replayStrip(r)}
          <div class="rp-key" style="margin-top:10px"><span><i style="background:var(--lime)"></i>${t('fitsKey')}</span><span><i style="background:var(--amber)"></i>${t('tightKey')}</span><span><i style="background:var(--red)"></i>${t('overKey')}</span></div>
        </div>
      </div>
    </div>`;
}

// ---------- sheets ----------
function openSheet(html) {
  $('#sheet').innerHTML = html;
  $('#sheetWrap').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet() { $('#sheetWrap').hidden = true; document.body.style.overflow = ''; }

function reasonText(x) {
  const v = { ...(x.v || {}) };
  if (v.gal) v.gal = Number(v.gal).toLocaleString(getLang() === 'es' ? 'es-MX' : 'en-US');
  if (v.crop) v.crop = crop(v.crop);
  return t(x.k, v);
}

function whySheet(r) {
  sheetRot = r;
  const ex = r.explain;
  const conf = r.confidence.reasons.map((x) => (x.k === 'conf_approx' ? t(x.k, { crops: x.crops.map((c) => crop(c).toLowerCase()).join(', ') }) : t(x.k)));
  const yrs = r.replay;
  openSheet(`<div class="sheet-h"><h2>${t('whyTitle')}</h2><button class="icon-btn" data-close aria-label="Close">${icon('close', 20)}</button></div>
    <section><h4>${t('whatStands')}</h4><ul>${ex.why.map((x) => `<li>${esc(reasonText(x))}</li>`).join('')}</ul></section>
    <section><h4>${t('unknown')}</h4><ul>${ex.gaps.map((k) => `<li>${t(k)}</li>`).join('')}</ul></section>
    <section><h4>${t('askExpert')}</h4><ul>${ex.expert.map((k) => `<li>${t(k)}</li>`).join('')}</ul></section>
    <section><h4>${t('howSure', { level: t(r.confidence.level) })}</h4><ul>${conf.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></section>
    <section><h4>${t('dataUsed')}</h4><ul><li>${t('data1', { from: yrs[0].cy, to: yrs[yrs.length - 1].cy })}</li><li>${t('data2')}</li><li>${t('data3')}</li></ul></section>`);
}

function eventText(e) {
  const c = e.crop ? crop(e.crop).toLowerCase() : '';
  const C = e.crop ? crop(e.crop) : '';
  switch (e.kind) {
    case 'plant': return t('ePlant', { crop: c });
    case 'harvest': return t('eHarvest', { crop: c });
    case 'coverIn': return t('eCoverIn', { crop: c });
    case 'coverOut': return t('eCoverOut', { crop: c });
    case 'standing': return t('eStanding', { crop: C });
    case 'bare': return t('eBare', { from: month(e.from), to: month(e.to) });
    default: return '';
  }
}

let sheetRot = null;
function monthSheet(r) {
  sheetRot = r;
  const byYear = [0, 1, 2].map((y) => r.plan.filter((e) => e.y === y));
  openSheet(`<div class="sheet-h"><h2>${t('monthTitle')}</h2><button class="icon-btn" data-close aria-label="Close">${icon('close', 20)}</button></div>
    <div class="timeline">${byYear.map((evs, y) => `<div class="tl-year">${t('yearN', { n: y + 1 })}</div>${evs.map((e) => `
      <div class="tl"><span class="m">${e.kind === 'standing' ? '' : month(e.month || e.from)}</span><span class="tl-art" style="color:${e.crop ? CROPS[e.crop].color : 'var(--muted)'}">${cropArt(e.crop || 'fallow', 22)}</span><span>${esc(eventText(e))}</span></div>`).join('')}`).join('')}</div>
    <div class="btn-row" style="margin-top:20px"><button class="btn primary" data-act="ics">${icon('cal', 20)}${t('addCal')}</button><button class="btn" data-act="print">${icon('print', 20)}${t('print')}</button></div>`);
}

function downloadIcs(r) {
  const now = new Date();
  const cy0 = now.getMonth() >= 9 ? now.getFullYear() + 2 : now.getFullYear() + 1; // next crop year that hasn't started
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Terra//Crop plan//EN', 'CALSCALE:GREGORIAN'];
  r.plan.filter((e) => e.month).forEach((e, i) => {
    const cy = cy0 + e.y;
    const yr = e.month >= 11 ? cy - 1 : cy;
    const d = `${yr}${String(e.month).padStart(2, '0')}${String(e.day || 1).padStart(2, '0')}`;
    lines.push('BEGIN:VEVENT', `UID:terra-${Date.now()}-${i}@terra`, `DTSTAMP:${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${d}`, `SUMMARY:${eventText(e)}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = 'terra-plan.ics';
  document.body.appendChild(a); a.click(); a.remove();
}

// ---------- build ----------
function splitType(id) {
  if (id === 'alfalfa') return { w: 'alfalfa', s: 'alfalfa' };
  const [w, s] = id.split('+');
  return { w, s };
}
function joinType(w, s) {
  if (w === 'alfalfa' || s === 'alfalfa') return 'alfalfa';
  if (s === 'cotton') return `${BEFORE_COTTON.includes(w) ? w : 'fallow'}+cotton`;
  return `${w}+${s}`;
}

function renderBuild() {
  const el = $('#screen-build');
  if (!state.res) { el.innerHTML = `<div class="screen-h"><h1>${t('buildTitle')}</h1></div><div class="skeleton" style="min-height:300px"></div>`; return; }
  const years = state.build.map((id, y) => {
    const { w, s } = splitType(id);
    if (w === 'alfalfa') {
      return `<div class="card year-card"><div class="card-h" style="margin:0"><h3>${t('yearN', { n: y + 1 })}</h3></div>
        <div class="slots"><button class="slot full" style="--c:${CROPS.alfalfa.color}" data-slot="${y}-w"><small>${t('allYear')}</small><b>${crop('alfalfa')}</b>${cropArt('alfalfa', 44, 'slot-art')}</button></div></div>`;
    }
    const slot = (season, c) => `<button class="slot${c === 'fallow' ? ' bare' : ''}" style="--c:${CROPS[c].color}" data-slot="${y}-${season}"><small>${t(season === 'w' ? 'winter' : 'summer')}</small><b>${esc(crop(c))}</b>${cropArt(c, 40, 'slot-art')}</button>`;
    return `<div class="card year-card"><div class="card-h" style="margin:0"><h3>${t('yearN', { n: y + 1 })}</h3></div><div class="slots">${slot('w', w)}${slot('s', s)}</div></div>`;
  }).join('');
  const dT = state.stress.dT, rp = state.stress.rainPct;
  el.innerHTML = `
    <div class="screen-h"><h1>${t('buildTitle')}</h1>
      <div class="btn-row"><button class="btn small" data-act="from-opt">${t('startFrom')}</button><button class="btn small" data-act="set-now">${t('setNow')}</button></div></div>
    <div class="build-grid">
      <div>${years}
        <div class="card" style="margin-top:10px"><div class="card-h"><h3>${t('whatIf')}</h3></div>
          <div class="stack">
            <label class="slider"><span class="lab">${t('hotter')}<b>${dT ? `+${(dT * 1.8).toFixed(1)}°F` : t('noChange')}</b></span><input type="range" min="0" max="4" step="0.5" value="${dT}" data-stress="dT"></label>
            <label class="slider"><span class="lab">${t('rainChange')}<b>${rp ? `${rp > 0 ? '+' : ''}${rp}%` : t('noChange')}</b></span><input type="range" min="-40" max="20" step="5" value="${rp}" data-stress="rainPct"></label>
          </div></div>
        <div class="card"><div class="card-h"><h3>${t('leaveOut')}</h3></div>
          <div class="chips out">${EXCLUDABLE.map((c) => `<button aria-pressed="${state.excluded.has(c)}" data-exclude="${c}">${esc(crop(c))}</button>`).join('')}</div></div>
      </div>
      <div id="buildResult"></div>
    </div>`;
  renderBuildResult();
}

function renderBuildResult() {
  const el = $('#buildResult');
  if (!el) return;
  const r = state.buildResult;
  if (!r || r.rotation.join() !== state.build.join()) { el.innerHTML = `<div class="skeleton" style="min-height:320px"></div>`; return; }
  const base = state.res.baseline;
  const fits = r.replay.filter((y) => y.status === 'good').length;
  el.innerHTML = `<div class="stack" style="position:sticky;top:26px">
    <div class="card lime-card plan-hero">${heroPlanet(200)}
      <h2>${t('yourPlan')}</h2>
      ${headline(r, base)}
    </div>
    <div class="card">${rings(r.scores)}</div>
    <div class="card"><div class="card-h"><h3>${t('fits', { n: fits, t: r.replay.length })}</h3></div>${replayStrip(r)}</div>
    <div class="card"><div class="card-h"><h3>${t('calendar')}</h3></div>${calendarStrip(r)}</div>
    <div class="btn-row"><button class="btn primary" data-act="why-build">${icon('info', 20)}${t('whyBtn')}</button><button class="btn" data-act="month-build">${icon('cal', 20)}${t('monthBtn')}</button></div>
  </div>`;
}

function slotPicker(y, season) {
  const { w, s } = splitType(state.build[y]);
  const list = season === 'w' ? [...WINTER, 'alfalfa'] : [...SUMMER, 'cotton', 'alfalfa'];
  const current = season === 'w' ? w : s;
  const cards = list.map((c) => {
    const tags = [WATER_TAG[c] ? t(WATER_TAG[c]) : '', CROPS[c].legume ? t('legume') : '', CROPS[c].role === 'cover' ? t('notSold') : ''].filter(Boolean);
    const out = state.excluded.has(c);
    return `<button class="pick" aria-pressed="${c === current}" data-pick="${y}-${season}-${c}" ${out ? 'disabled' : ''}>
      <span class="pick-art" style="color:${c === 'fallow' ? 'var(--muted)' : CROPS[c].color}">${cropArt(c, 34)}</span>
      <span class="nm">${esc(crop(c))}</span>
      <span class="tags">${tags.map((x) => `<span>${x}</span>`).join('')}</span></button>`;
  }).join('');
  openSheet(`<div class="sheet-h"><h2>${t('pick')}</h2><button class="icon-btn" data-close aria-label="Close">${icon('close', 20)}</button></div>
    <p class="muted" style="margin-bottom:14px">${t('yearN', { n: y + 1 })} · ${t(season === 'w' ? 'winter' : 'summer')}</p><div class="picker">${cards}</div>`);
}

function pick(y, season, c) {
  let { w, s } = splitType(state.build[y]);
  if (c === 'alfalfa') { w = s = 'alfalfa'; }
  else if (season === 'w') { if (w === 'alfalfa') s = 'fallow'; w = c; if (s === 'cotton' && !BEFORE_COTTON.includes(c)) s = 'fallow'; }
  else { if (s === 'alfalfa' || w === 'alfalfa') w = 'fallow'; s = c; if (c === 'cotton' && !BEFORE_COTTON.includes(w)) { w = 'fallow'; toast(getLang() === 'es' ? 'El algodón se siembra en abril: antes solo cabe una cobertura.' : 'Cotton goes in by April, so only a cover fits before it.'); } }
  state.build[y] = joinType(w, s);
  closeSheet();
  renderBuild();
  scoreBuild();
}

// ---------- learn ----------
function renderLearn() {
  const terms = ['acft', 'et', 'ndvi', 'sm', 'gw', 'leg', 'cover', 'fallow', 'sat'];
  const nasa = [
    ['NASA POWER', 'https://power.larc.nasa.gov/'],
    ['MODIS MOD13Q1 NDVI (ORNL DAAC)', 'https://modis.ornl.gov/data/modis_webservice.html'],
    ['NASA GIBS: MODIS NDVI, SMAP L4, GRACE/GRACE-FO', 'https://nasa-gibs.github.io/gibs-api-docs/'],
    ['ISRIC SoilGrids 2.0', 'https://soilgrids.org/'],
  ];
  $('#screen-learn').innerHTML = `
    <div class="screen-h"><h1>${t('navLearn')}</h1></div>
    <div class="learn-grid">
      <div class="stack">
        <div class="card">${scene('learn')}<div class="card-h"><h3>${t('howTitle')}</h3></div><ol class="steps">${[1, 2, 3, 4].map((n) => `<li><span>${t(`how${n}`)}</span></li>`).join('')}</ol></div>
        <div class="card lime-card"><h3>${t('disclaimer')}</h3></div>
        <div class="card"><div class="card-h"><h3>${t('sourcesTitle')}</h3></div><ul class="sources">${[...nasa.map(([l, u]) => [l, u]), ...Object.values(SOURCES).map((s) => [s.label, s.url])].map(([l, u]) => `<li><a href="${u}" target="_blank" rel="noreferrer">${esc(l)}</a></li>`).join('')}</ul></div>
      </div>
      <div class="card"><div class="card-h"><h3>${t('termsTitle')}</h3></div>${terms.map((k) => `<details class="term"><summary>${t(`t_${k}`)}</summary><p>${t(`d_${k}`)}</p></details>`).join('')}</div>
    </div>`;
}

// ---------- setup ----------
let setupStep = 1;
function openSetup(step = 1) {
  setupStep = step;
  $('#setup').hidden = false;
  renderSetup();
}
function renderSetup() {
  const s = setupStep;
  const prog = `<div class="progress">${[1, 2, 3].map((n) => `<i class="${n <= s ? 'on' : ''}"></i>`).join('')}</div><span class="muted small">${t('step', { n: s })}</span>`;
  let body = '';
  if (s === 1) {
    body = `${scene('field')}<div class="stack" style="gap:6px"><h1>${t('s1Title')}</h1><p class="muted">${t('s1Sub')}</p></div>
      <div class="choice-list">${FARMS.map((f) => `<button class="choice" aria-pressed="${!state.farm.custom && state.farm.id === f.id}" data-farm="${f.id}"><span><b>${f.name}</b><small>${f.area}</small></span><span class="tick"></span></button>`).join('')}
      <button class="choice" data-act="locate"><span><b>${t('useLoc')}</b></span>${icon('pin', 22)}</button>
      ${state.farm.custom ? `<button class="choice" aria-pressed="true"><span><b>${t('custom')}</b><small>${state.farm.lat.toFixed(3)}, ${state.farm.lon.toFixed(3)}</small></span><span class="tick"></span></button>` : ''}</div>`;
  } else if (s === 2) {
    const cur = state.baseline.join();
    body = `${scene('rotation')}<div class="stack" style="gap:6px"><h1>${t('s2Title')}</h1><p class="muted">${t('s2Sub')}</p></div>
      <div class="choice-list">${PRESETS.map((p) => `<button class="choice" aria-pressed="${p.rot.join() === cur}" data-preset="${p.id}"><span class="choice-l"><span class="choice-art">${[...new Set(p.rot.flatMap((x) => x.split('+')))].filter((c) => c !== 'fallow').map((c) => cropArt(c, 26)).join('')}</span><b>${t(p.id)}</b></span><span class="tick"></span></button>`).join('')}</div>`;
  } else {
    body = `${scene('water')}<h1>${t('s3Title')}</h1>
      <label class="slider"><span class="lab">${t('water')}<b class="num" id="allotV">${t('waterUnit', { n: state.allotment.toFixed(1) })}</b></span>
        <input type="range" id="allot" min="1" max="7" step="0.1" value="${state.allotment}"><span class="muted small">${t('waterHint')}</span></label>
      <div class="stack" style="gap:8px"><span class="muted">${t('irrigation')}</span><div class="seg" role="radiogroup">${['furrow', 'sprinkler', 'drip'].map((v) => `<button role="radio" aria-checked="${state.irrigation === v}" data-irr="${v}">${t(v)}</button>`).join('')}</div></div>
      <div class="stack" style="gap:8px"><span class="muted">${t('goals')}</span><div class="chips">${GOALS.map((g) => `<button aria-pressed="${state.goals.has(g)}" data-goal="${g}">${t(GOAL_LABEL[g])}</button>`).join('')}</div></div>`;
  }
  const foot = `<div class="setup-foot">${s > 1 ? `<button class="btn" data-setup="back">${t('back')}</button>` : ''}<button class="btn primary" data-setup="next">${s < 3 ? t('next') : t('showOptions')}</button></div>`;
  $('#setup').innerHTML = `<div class="setup-in"><div class="stack" style="gap:8px">${prog}</div>${body}${foot}</div>`;
  const allot = $('#allot');
  if (allot) allot.addEventListener('input', () => { state.allotment = +allot.value; $('#allotV').textContent = t('waterUnit', { n: state.allotment.toFixed(1) }); });
}
function finishSetup() {
  $('#setup').hidden = true;
  try { localStorage.setItem('terra-setup', '1'); } catch { /* fine */ }
  persist();
  state.build = state.baseline.slice();
  const moved = !state.weather || state.weather.lat !== +state.farm.lat.toFixed(2) || state.weather.lon !== +state.farm.lon.toFixed(2);
  if (marker) marker.setLngLat([state.farm.lon, state.farm.lat]);
  if (map) map.flyTo({ center: [state.farm.lon, state.farm.lat], zoom: 12.5, duration: 2500 });
  if (moved) loadField(); else recompute();
  go('plans');
}

// ---------- map ----------
let map, marker;
function initMap() {
  if (!window.maplibregl) return;
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8, projection: { type: 'globe' },
      sources: { imagery: { type: 'raster', tileSize: 256, maxzoom: 18, attribution: 'Esri, Maxar, Earthstar Geographics', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] } },
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0e0f0c' } }, { id: 'imagery', type: 'raster', source: 'imagery' }],
      sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0] },
    },
    center: [-40, 22], zoom: 1.1, attributionControl: { compact: true },
  });
  const el = document.createElement('div');
  el.style.cssText = 'width:22px;height:22px;border-radius:50%;background:#d6f45c;border:5px solid #10120c;box-shadow:0 0 0 6px rgba(214,244,92,.25)';
  marker = new maplibregl.Marker({ element: el }).setLngLat([state.farm.lon, state.farm.lat]).addTo(map);
  new ResizeObserver(() => map.resize()).observe(document.getElementById('map'));
  map.on('load', () => {
    for (const [id, L] of Object.entries(LAYERS)) {
      map.addSource(id, { type: 'raster', tiles: [L.url], tileSize: 256, attribution: 'NASA GIBS' });
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.78 }, layout: { visibility: 'none' } });
    }
    setTimeout(() => map.flyTo({ center: [state.farm.lon, state.farm.lat], zoom: 12.5, duration: 5000, essential: true }), 500);
  });
  map.on('click', (e) => {
    state.farm = { id: 'custom', custom: true, lat: e.lngLat.lat, lon: e.lngLat.lng, name: '', area: '' };
    marker.setLngLat(e.lngLat);
    persist();
    loadField();
  });
}
function renderLayers() {
  const ids = [['none', 'satellite'], ['ndvi', 'greenness'], ['smap', 'soilMoisture'], ['grace', 'groundwater']];
  $('#layers').innerHTML = ids.map(([id, k]) => `<button role="radio" aria-checked="${state.layer === id}" data-layer="${id}">${t(k)}</button>`).join('');
  const L = LAYERS[state.layer];
  const lg = $('#mapLegend');
  lg.hidden = !L;
  if (L) lg.innerHTML = `<span>${esc(L.product)}</span><div class="ramp" style="background:linear-gradient(90deg,${L.ramp.join(',')})"></div><div class="ends"><span>${L.legend[0]}</span><span>${L.legend[1]}</span></div>`;
}
function setLayer(id) {
  state.layer = id;
  if (map && map.isStyleLoaded()) for (const k of Object.keys(LAYERS)) map.setLayoutProperty(k, 'visibility', k === id ? 'visible' : 'none');
  if (map && id === 'grace') map.easeTo({ zoom: 5, duration: 1200 });
  else if (map && id === 'smap') map.easeTo({ zoom: 7, duration: 1200 });
  else if (map && map.getZoom() < 10) map.easeTo({ zoom: 12.5, center: [state.farm.lon, state.farm.lat], duration: 1200 });
  renderLayers();
}

// ---------- events ----------
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button, [data-close]');
  if (!b) return;
  const d = b.dataset;
  if (d.close !== undefined) return closeSheet();
  if (d.go) { if (d.plan) state.plan = +d.plan; renderPlans(); return go(d.go); }
  if (d.plan !== undefined && b.getAttribute('role') === 'tab') { state.plan = +d.plan; return renderPlans(); }
  if (d.layer) return setLayer(d.layer);
  if (b.classList.contains('lang')) { setLang(getLang() === 'en' ? 'es' : 'en'); renderAll(); if (!$('#setup').hidden) renderSetup(); return; }
  if (b.id === 'placeChip') return openSetup(1);
  if (d.slot) { const [y, s] = d.slot.split('-'); return slotPicker(+y, s); }
  if (d.pick) { const [y, s, c] = d.pick.split('-'); return pick(+y, s, c); }
  if (d.exclude) { const c = d.exclude; state.excluded.has(c) ? state.excluded.delete(c) : state.excluded.add(c); b.setAttribute('aria-pressed', String(state.excluded.has(c))); persist(); return recompute(); }
  // setup
  if (d.farm) { const f = FARMS.find((x) => x.id === d.farm); state.farm = { ...f }; return renderSetup(); }
  if (d.preset) { state.baseline = PRESETS.find((p) => p.id === d.preset).rot.slice(); return renderSetup(); }
  if (d.irr) { state.irrigation = d.irr; return renderSetup(); }
  if (d.goal) { state.goals.has(d.goal) ? state.goals.delete(d.goal) : state.goals.add(d.goal); return renderSetup(); }
  if (d.setup === 'back') { setupStep--; return renderSetup(); }
  if (d.setup === 'next') { if (setupStep < 3) { setupStep++; return renderSetup(); } return finishSetup(); }
  // actions
  const list = planList();
  const cur = list[Math.min(state.plan, list.length - 1)];
  switch (d.act) {
    case 'retry': return loadField();
    case 'locate':
      if (!navigator.geolocation) return toast(t('locFail'));
      return navigator.geolocation.getCurrentPosition((p) => {
        state.farm = { id: 'custom', custom: true, lat: p.coords.latitude, lon: p.coords.longitude, name: '', area: '' };
        renderSetup();
      }, () => toast(t('locFail')), { timeout: 8000 });
    case 'why': return whySheet(cur);
    case 'month': return monthSheet(cur);
    case 'why-build': return state.buildResult && whySheet(state.buildResult);
    case 'month-build': return state.buildResult && monthSheet(state.buildResult);
    case 'edit-plan': state.build = cur.rotation.slice(); renderBuild(); scoreBuild(); return go('build');
    case 'from-opt': state.build = state.res.options[0].rotation.slice(); renderBuild(); return scoreBuild();
    case 'set-now': state.baseline = state.build.slice(); persist(); toast(t('savedNow')); return recompute();
    case 'ics': return sheetRot && downloadIcs(sheetRot);
    case 'print': return window.print();
  }
});

document.addEventListener('input', (e) => {
  const k = e.target.dataset.stress;
  if (!k) return;
  state.stress[k] = +e.target.value;
  const lab = e.target.previousElementSibling.querySelector('b');
  if (k === 'dT') lab.textContent = state.stress.dT ? `+${(state.stress.dT * 1.8).toFixed(1)}°F` : t('noChange');
  else lab.textContent = state.stress.rainPct ? `${state.stress.rainPct > 0 ? '+' : ''}${state.stress.rainPct}%` : t('noChange');
  recompute();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (NAV.some(([id]) => id === h)) go(h); });

// ---------- start ----------
const h = location.hash.slice(1);
if (NAV.some(([id]) => id === h)) state.screen = h;
renderAll();
initMap();
loadField();
let firstRun = true;
try { firstRun = !localStorage.getItem('terra-setup'); } catch { /* fine */ }
if (firstRun) openSetup(1);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
