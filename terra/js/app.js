import { CROPS, SOURCES, WINTER, SUMMER, BEFORE_COTTON, REFERENCE_USE_IN } from './crops.js';
import { fmt, GALLONS_PER_ACFT } from './engine.js';
import { fetchPower, fetchNdvi, fetchRecent, fetchSoil, fetchWells, loadDemo, loadBundle, demoWeather, textureClass, LAYERS } from './nasa.js';
import { rings, calendarStrip, replayStrip, sparkline, icon, yearBars, depthLine, pairBars, flowDiagram } from './charts.js';
import { inArizona, yearTypes } from './engine.js';
import { findArea, AREA_FACTS, GW_SOURCES, wellTrend, wellSeries, satelliteCheck } from './local.js';
import { ECON_SOURCES, SHORTAGE_SOURCES, WATER_PRICE_DEFAULT } from './economics.js';
import { t, crop, month, getLang, setLang } from './i18n.js';
import { cropArt, scene, heroPlanet } from './art.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TYPES = yearTypes();
const CAP_SHARE = { wells: 0, mix: 0.5, canal: 0.9 };
const FARMS = [
  { id: 'casa', lat: 32.87, lon: -111.80, name: 'Casa Grande', area: 'Pinal County' },
  { id: 'cool', lat: 32.995, lon: -111.49, name: 'Coolidge', area: 'Pinal County' },
  { id: 'mari', lat: 33.09, lon: -111.99, name: 'Maricopa', area: 'Pinal County' },
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
  source: saved.source || 'mix',
  waterPrice: saved.waterPrice ?? WATER_PRICE_DEFAULT,
  shortage: 'none',
  wells: null, area: undefined, val: null, ama: null,
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
    localStorage.setItem('terra-farm', JSON.stringify({ farm: state.farm, baseline: state.baseline, allotment: state.allotment, irrigation: state.irrigation, source: state.source, waterPrice: state.waterPrice, goals: [...state.goals], excluded: [...state.excluded] }));
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
    worker.postMessage({ id: runId, type: 'run', weather: state.weather, inputs: { baseline: state.baseline, allotment: state.allotment, irrigation: state.irrigation, excluded: [...state.excluded], weights: weights(), stress: state.stress, calib: state.val?.et0, canopy: state.val?.canopy, capShare: CAP_SHARE[state.source] ?? 0, shortage: state.shortage, waterPrice: state.waterPrice } });
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
  Object.assign(state, { weather: null, res: null, ndvi: null, soil: null, recent: null, wells: null, area: undefined, loadError: null, buildResult: null });
  renderAll();
  const { lat, lon } = state.farm;
  const [demo, val, ama] = await Promise.all([state.farm.custom ? null : loadDemo(), loadBundle('validation'), loadBundle('ama')]);
  state.val = val; state.ama = ama;
  const az = inArizona(lat, lon);
  state.area = az && ama ? findArea(ama, lat, lon) : undefined;
  if (signal.aborted) return;
  const id = state.farm.id;
  const bundledSoil = demo?.soil?.[id];
  const bundledNdvi = demo?.ndvi?.[id];
  if (bundledSoil && bundledSoil.sand != null) state.soil = { ...bundledSoil, silt: bundledSoil.silt ?? 100 - bundledSoil.sand - bundledSoil.clay, texture: textureClass(bundledSoil.sand, bundledSoil.clay) };
  else fetchSoil(lat, lon, signal).then((s) => { state.soil = s; renderField(); }).catch((e) => { if (e.name !== 'AbortError') { state.soil = { error: true }; renderField(); } });
  const toRows = (r) => r.map((x) => (Array.isArray(x) ? x : [x.date, x.ndvi]));
  if (bundledNdvi && bundledNdvi.length) state.ndvi = toRows(bundledNdvi);
  else fetchNdvi(lat, lon, 5, signal).then((r) => { state.ndvi = toRows(r); renderField(); }).catch((e) => { if (e.name !== 'AbortError') { state.ndvi = { error: true }; renderField(); } });
  const bundledWells = demo?.wells?.[id];
  if (bundledWells) state.wells = bundledWells;
  else if (az) fetchWells(lat, lon, signal).then((w) => { state.wells = w; renderField(); }).catch((e) => { if (e.name !== 'AbortError') { state.wells = []; renderField(); } });
  else state.wells = [];
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

function isAz() { return inArizona(state.farm.lat, state.farm.lon); }
const usd = (v) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString(getLang() === 'es' ? 'es-MX' : 'en-US')}`;
const months = (list) => list.map((m) => month(m)).join(', ');

function renderField() {
  $('#placeChip').innerHTML = `${icon('pin', 18)}<span>${esc(placeName())}</span>`;
  const el = $('#fieldSide');
  if (state.loadError) {
    el.innerHTML = `<div class="hero-title"><h1>${esc(placeName())}</h1></div><div class="err"><span>${t('loadFail')}</span><button class="btn small" data-act="retry">${t('retry')}</button></div>`;
    return;
  }
  const az = isAz();
  const badge = az ? `<span class="pill lime">${icon('sun', 16)}${t('badgeAz')}</span>` : `<span class="pill">${icon('globe', 16)}${t('badgeBasic')}</span>`;
  const basic = az ? '' : `<div class="card note">${t('basicNote')}</div>`;
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

  el.innerHTML = `<div class="hero-title"><h1>${esc(placeName())}</h1>${badge}</div>
    ${tiles}${cta}<div class="field-cards">${basic}${satCard()}${waterRulesCard()}${heatCard()}${monsoonCard()}${recentCard()}${soilCard()}${greenCard()}</div>`;
}

function recentCard() {
  const r = state.recent;
  if (!r || r.error) return '';
  const ratio = r.rainIn / (r.normalRainIn || 0.01);
  const tag = ratio > 1.25 ? t('wetter') : ratio < 0.75 ? t('drier') : t('aboutNormal');
  return `<div class="card"><div class="card-h"><h3>${t('thisSeason')}</h3><span class="pill">${tag}</span></div>
    <div class="stack" style="gap:6px"><span>${t('seasonLine', { rain: r.rainIn.toFixed(1), normal: r.normalRainIn.toFixed(1) })}</span><span class="muted">${t('seasonHot', { hot: r.hot, normal: Math.round(r.normalHot) })}</span></div></div>`;
}

function soilCard() {
  const s = state.soil;
  if (!s) return `<div class="card"><div class="card-h"><h3>${t('soil')}</h3></div><div class="skeleton" style="min-height:40px"></div></div>`;
  if (s.error) return '';
  return `<div class="card"><div class="card-h"><h3>${t('soil')}</h3></div>
    <h2>${esc(t(s.texture === 'sand' ? 'sand_t' : s.texture === 'clay' ? 'clay_t' : s.texture))}</h2>
    <div class="bar3"><i style="flex:${s.sand};background:#d9c38a"></i><i style="flex:${s.silt};background:#a5a08d"></i><i style="flex:${s.clay};background:#7d6a55"></i></div>
    <span class="muted small">${t('sand')} ${Math.round(s.sand)}% · ${t('silt')} ${Math.round(s.silt)}% · ${t('clay')} ${Math.round(s.clay)}%${s.soc != null ? ` · ${(s.soc / 10).toFixed(1)}% ${t('organic')}` : ''}</span></div>`;
}

function greenCard() {
  const n = state.ndvi;
  if (!n) return `<div class="card"><div class="card-h"><h3>${t('greenTitle')}</h3></div><div class="skeleton" style="min-height:64px"></div></div>`;
  if (n.error || n.length < 6) return '';
  const pts = n.slice(-69).map(([date, ndvi]) => ({ date, ndvi }));
  return `<div class="card"><div class="card-h"><h3>${t('greenTitle')}</h3></div>
    ${sparkline(pts)}<span class="muted small">${t('greenLine', { bare: pts.filter((x) => x.ndvi < 0.2).length, n: pts.length })}</span></div>`;
}

function satCheck() {
  if (!Array.isArray(state.ndvi)) return null;
  return satelliteCheck(state.ndvi, state.baseline, TYPES);
}

function satCard() {
  const c = satCheck();
  if (!c) return '';
  let body;
  if (c.agrees) body = `<p>${t('satAgree', { y: c.years })}</p>`;
  else {
    const lines = [];
    if (c.bareButSaid.length) lines.push(t('satBare', { months: months(c.bareButSaid) }));
    if (c.greenButSaid.length) lines.push(t('satGreen', { months: months(c.greenButSaid) }));
    body = `<p>${lines.join(' ')} <b>${t('satAsk')}</b></p><div class="btn-row" style="margin-top:12px"><button class="btn small" data-act="fix-now">${t('satFix')}</button></div>`;
  }
  return `<div class="card ${c.agrees ? '' : 'attention'}"><div class="card-h"><h3>${icon('sat', 18)} ${t('satTitle')}</h3></div>${body}</div>`;
}

function waterRulesCard() {
  if (!isAz() || state.area === undefined) return '';
  const name = state.area;
  const f = name ? AREA_FACTS[name] : null;
  const title = name ? t('amaIn', { name: titleCase(name) }) : t('amaNone');
  const what = name ? t(`amaWhat_${f?.kind || 'ama'}`) : t('amaNoneWhat');
  const story = f?.story ? `<p class="muted small" style="margin-top:6px">${t(`story_${f.story}`)}</p>` : '';
  const tr = wellTrend(state.wells);
  let wells = '';
  if (tr) {
    const ft = Math.abs(tr.perDecadeFt);
    const dir = ft < 2 ? t('wellsFlat') : tr.perDecadeFt > 0 ? t('wellsDown', { ft: Math.round(ft) }) : t('wellsUp', { ft: Math.round(ft) });
    wells = `<div class="sub-block"><b>${t('wellsLine', { depth: Math.round(tr.latestDepthFt) })} ${dir}.</b>${depthLine(wellSeries(state.wells))}<span class="muted small">${t('wellsN', { n: tr.wells })}</span></div>`;
  }
  return `<div class="card"><div class="card-h"><h3>${icon('well', 18)} ${t('azWaterTitle')}</h3></div><h2>${esc(title)}</h2><p style="margin-top:6px">${what}</p>${story}${wells}</div>`;
}

function heatCard() {
  const cl = state.res?.climate;
  if (!cl?.heat) return '';
  const h = cl.heat;
  const up = h.late - h.early >= 2;
  const line = up ? t('heatLine', { late: Math.round(h.late), early: Math.round(h.early) }) : t('heatLineFlat', { late: Math.round(h.late) });
  const cot = cl.cottonHeat && isAz() ? `<p class="muted" style="margin-top:8px">${t('cottonHeat', { n: Math.round(cl.cottonHeat.avgL1) })}</p>` : '';
  return `<div class="card"><div class="card-h"><h3>${icon('sun', 18)} ${t('heatTitle')}</h3></div><p>${line}</p>${yearBars(h.byYear)}${cot}</div>`;
}

function monsoonCard() {
  const m = state.res?.climate?.monsoon;
  if (!m || !isAz()) return '';
  return `<div class="card"><div class="card-h"><h3>${icon('cloud', 18)} ${t('monTitle')}</h3></div>
    <p>${t('monLine', { in: m.avgIn.toFixed(1), n: m.yearsWithHeavy, t: m.byYear.length })}</p>
    <p class="muted small" style="margin-top:6px">${t('monTip')}</p></div>`;
}

function titleCase(s) { return s.toLowerCase().replace(/\b(\w)/g, (c) => c.toUpperCase()).replace(/\bAma\b/, 'AMA').replace(/\bIna\b/, 'INA'); }

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
  let big, line;
  if (r === base || Math.abs(d) < 0.05) { big = t('usesGal', { gal: gal(r.netAcft) }); line = t('usesLine'); }
  else {
    big = d < 0 ? t('savesGal', { gal: gal(-d) }) : t('moreGal', { gal: gal(d) });
    // Range across the 20 replayed years: same plan, same field, real weather.
    const diffs = r.replay.map((y, i) => Math.abs(y.avgNet - base.replay[i].avgNet)).sort((x, z) => x - z);
    const q = (p) => diffs[Math.round((diffs.length - 1) * p)];
    const lo = gal(q(0.1)), hi = gal(q(0.9));
    line = lo === hi ? t('vsNow') : `${t('vsNow')}. ${t('galRange', { lo, hi })}`;
  }
  return `<div class="headline"><b>${big}</b><span>${line}</span></div>`;
}

function moneyBlock(r) {
  const m = r.money;
  if (!m) return '';
  return `<div class="money"><div class="money-main">${icon('coin', 20)}<b>${t('moneyAvg', { v: usd(m.cash) })}</b></div>
    <span>${t('moneyCash')} · ${t('moneyNet', { v: usd(m.mean) })}</span>
    <span>${t('moneyRange', { lo: usd(m.cashLow), hi: usd(m.cashHigh) })}</span></div>`;
}

function shortageCard(r) {
  if (!r.tiers || !isAz()) return '';
  const n = r.replay.length;
  if ((CAP_SHARE[state.source] ?? 0) === 0) return `<div class="card"><div class="card-h"><h3>${t('shortTitle')}</h3></div><p class="muted">${t('shWells')}</p></div>`;
  const cells = [['none', 'shNone'], ['tier1', 'shTier1'], ['tier2', 'shTier2']].map(([k, lab]) => {
    const o = r.tiers[k];
    const cls = o.good >= n * 0.8 ? 'ok' : o.good >= n * 0.4 ? 'mid' : 'low';
    return `<div class="tier ${cls}${state.shortage === k ? ' on' : ''}"><small>${t(lab)}</small><b>${t('shGood', { n: o.good, t: n })}</b><span>${t('shMoney', { v: usd(o.cash) })}</span></div>`;
  }).join('');
  return `<div class="card"><div class="card-h"><h3>${icon('drop', 18)} ${t('shortTitle')}</h3></div><div class="tiers">${cells}</div></div>`;
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
          ${moneyBlock(r)}
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
        ${shortageCard(r)}
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
    <section><h4>${t('whatStands')}</h4><ul>${ex.why.map((x) => `<li>${esc(reasonText(x))}</li>`).join('')}${extraWhy(r).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>
    <section><h4>${t('unknown')}</h4><ul>${ex.gaps.map((k) => `<li>${t(k)}</li>`).join('')}</ul></section>
    <section><h4>${t('askExpert')}</h4><ul>${ex.expert.map((k) => `<li>${t(k)}</li>`).join('')}</ul></section>
    <section><h4>${t('howSure', { level: t(r.confidence.level) })}</h4><ul>${conf.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></section>
    <section><h4>${t('dataUsed')}</h4><ul><li>${t('data1', { from: yrs[0].cy, to: yrs[yrs.length - 1].cy })}</li><li>${t('data2')}</li><li>${t('data3')}</li></ul></section>`);
}

function extraWhy(r) {
  const out = [];
  if (r.money) out.push(t('whyMoney', { v: usd(r.money.cash), lo: usd(r.money.cashLow), w: usd(r.money.waterCost) }));
  const cl = state.res?.climate;
  if (cl?.cottonHeat && r.seq.some((tp) => tp.parts.includes('cotton'))) out.push(t('whyCottonHeat', { n: Math.round(cl.cottonHeat.avgL1) }));
  const deficitYears = r.replay.filter((y) => y.worstGross > r.supply).length;
  if (deficitYears) out.push(t('whyShort', { n: deficitYears, t: r.replay.length }));
  return out;
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
            ${isAz() && (CAP_SHARE[state.source] ?? 0) > 0 ? `<div class="stack" style="gap:8px"><span class="lab">${t('canalSet')}</span><div class="seg" role="radiogroup">${[['none', 'shNone'], ['tier1', 'shTier1'], ['tier2', 'shTier2']].map(([k, l]) => `<button role="radio" aria-checked="${state.shortage === k}" data-short="${k}">${t(l)}</button>`).join('')}</div></div>` : ''}
            <label class="slider"><span class="lab">${t('priceSet')}<b>${t('priceUnit', { n: state.waterPrice })}</b></span><input type="range" min="0" max="400" step="5" value="${state.waterPrice}" data-price="1"></label>
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
function methodsCard() {
  const v = state.val;
  const flow = flowDiagram([t('mFlowNasa'), t('mFlowModel'), t('mFlowCal'), t('mFlowPlans'), t('mFlowMoney')]);
  let et = '';
  if (v?.et0) {
    const rows = v.stations.filter((x) => x.days > 300).map((x) => ({ name: x.name, a: x.stationIn, b: x.calIn }));
    et = `<div class="sub-block"><h3>${t('mEtTitle')}</h3><p class="muted small">${t('mEtLine', { avg: v.et0.calibrated.meanAbsPct, max: v.et0.calibrated.maxAbsPct })} ${t('mEtRaw', { raw: v.et0.raw.meanAbsPct })}</p>
      ${v.et0.methods ? `<p class="muted small">${t('mMethods', { chosen: t(`meth_${v.et0.chosen}`), pm: v.et0.methods.pmCal.meanAbsPct, hg: v.et0.methods.hgCal.meanAbsPct, blend: v.et0.methods.blend.meanAbsPct })}</p>` : ''}
      ${pairBars(rows, [`${t('mStation')} (in/yr)`, `${t('mOurs')} (in/yr)`])}${v.local ? `<p class="muted small">${t('mLocal')}</p>` : ''}</div>
      <div class="sub-block"><p>${t('mCanopy', { rmse: (v.canopy.rmseC * 1.8).toFixed(1), n: v.canopy.n.toLocaleString() })}</p></div>`;
  }
  let use = '';
  const cu = state.res?.cropUse;
  if (cu) {
    const rows = Object.entries(cu).map(([c, model]) => ({ name: crop(c), a: REFERENCE_USE_IN[c], b: model }));
    use = `<div class="sub-block"><h3>${t('mUseTitle')}</h3>${pairBars(rows, [`${t('mPublished')} (in)`, `${t('mOurs')} (in)`])}</div>`;
  }
  return `<div class="card"><div class="card-h"><h3>${t('methodsTitle')}</h3></div>
    <div class="sub-block"><h3>${t('mFlow')}</h3>${flow}</div>${et}${use}
    <div class="sub-block"><p class="muted">${t('mMoney')}</p></div></div>`;
}

function renderLearn() {
  const terms = ['acft', 'et', 'ndvi', 'sm', 'gw', 'leg', 'cover', 'fallow', 'sat'];
  const nasa = [
    ['NASA POWER (temperature, dew point, wind, sunlight, rain)', 'https://power.larc.nasa.gov/'],
    ['MODIS Terra 16-day NDVI (MOD13), read from NASA GIBS', 'https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/'],
    ['NASA GIBS: MODIS NDVI, SMAP L4, GRACE/GRACE-FO', 'https://nasa-gibs.github.io/gibs-api-docs/'],
    ['ISRIC SoilGrids 2.0', 'https://soilgrids.org/'],
    ['University of Arizona AZMET weather stations (API)', 'https://azmet.arizona.edu/'],
    ['FAO Irrigation and Drainage Paper 56 (Penman-Monteith)', 'https://www.fao.org/4/x0490e/x0490e06.htm'],
    ['University of Arizona, Cotton Heat Stress (AZ1448)', 'https://extension.arizona.edu/sites/extension.arizona.edu/files/pubs/az1448.pdf'],
  ];
  const all = [...nasa, ...Object.values(SOURCES).map((x) => [x.label, x.url]), ...Object.values(ECON_SOURCES).map((x) => [x.label, x.url]), ...SHORTAGE_SOURCES.map((x) => [x.label, x.url]), ...GW_SOURCES.map((x) => [x.label, x.url])];
  $('#screen-learn').innerHTML = `
    <div class="screen-h"><h1>${t('navLearn')}</h1></div>
    <div class="learn-grid">
      <div class="stack">
        <div class="card">${scene('learn')}<div class="card-h"><h3>${t('howTitle')}</h3></div><ol class="steps">${[1, 2, 3, 4].map((n) => `<li><span>${t(`how${n}`)}</span></li>`).join('')}</ol></div>
        ${methodsCard()}
        <div class="card lime-card"><h3>${t('disclaimer')}</h3></div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-h"><h3>${t('termsTitle')}</h3></div>${terms.map((k) => `<details class="term"><summary>${t(`t_${k}`)}</summary><p>${t(`d_${k}`)}</p></details>`).join('')}</div>
        <div class="card"><div class="card-h"><h3>${t('sourcesTitle')}</h3></div><ul class="sources">${all.map(([l, u]) => `<li><a href="${u}" target="_blank" rel="noreferrer">${esc(l)}</a></li>`).join('')}</ul></div>
      </div>
    </div>`;
}

// ---------- landing ----------
function renderLanding() {
  const why = [['lW1t', 'lW1', 'drop'], ['lW2t', 'lW2', 'well'], ['lW3t', 'lW3', 'sun'], ['lW4t', 'lW4', 'coin']];
  const proofs = [['lP1n', 'lP1'], ['lP2n', 'lP2'], ['lP3n', 'lP3']];
  const lang = getLang() === 'en' ? '<b>EN</b> · ES' : 'EN · <b>ES</b>';
  $('#landing').innerHTML = `<div class="land">
    <header class="land-top"><span class="brand"><img src="assets/icon.svg" alt="" width="34" height="34"><span>terra</span></span><button class="lang">${lang}</button></header>
    <section class="land-hero">
      <div class="land-copy">
        <span class="pill">${icon('globe', 16)}${t('lAny')}</span>
        <h1>${t('lHead')}</h1>
        <p>${t('lSub')}</p>
        <div class="btn-row"><button class="btn primary big" data-act="land-try">${t('lTry')}${icon('arrow', 20)}</button><button class="btn big" data-act="land-mine">${icon('pin', 20)}${t('lMine')}</button></div>
      </div>
      <div class="land-art">${heroPlanet(420)}<div class="land-badge"><b>Arizona</b><span>${t('badgeAz')}</span></div></div>
    </section>
    <section class="land-proofs">${proofs.map(([n, l]) => `<div><b>${t(n)}</b><span>${t(l)}</span></div>`).join('')}</section>
    <section class="land-why"><h2>${t('lWhyTitle')}</h2><div class="why-grid">${why.map(([h, b, ic]) => `<div class="card"><span class="why-ic">${icon(ic, 24)}</span><h3>${t(h)}</h3><p class="muted">${t(b)}</p></div>`).join('')}</div></section>
    <section class="land-how"><h2>${t('lHowTitle')}</h2><ol class="steps">${[1, 2, 3, 4].map((n) => `<li><span>${t(`how${n}`)}</span></li>`).join('')}</ol>
      <button class="btn primary big" data-act="land-try">${t('lStart')}${icon('arrow', 20)}</button></section>
    <footer class="land-foot">${t('lFoot')}</footer>
  </div>`;
}
function showLanding() { renderLanding(); $('#landing').hidden = false; document.body.style.overflow = 'hidden'; $('#landing').scrollTop = 0; }
function hideLanding() { $('#landing').hidden = true; document.body.style.overflow = ''; try { localStorage.setItem('terra-seen', '1'); } catch { /* fine */ } }

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
      <div class="stack" style="gap:6px"><b>${t('s1Feat')}</b><span class="muted small">${t('s1FeatSub')}</span></div>
      <div class="choice-list">${FARMS.map((f) => `<button class="choice" aria-pressed="${!state.farm.custom && state.farm.id === f.id}" data-farm="${f.id}"><span><b>${f.name}</b><small>${f.area}, Arizona</small></span><span class="tick"></span></button>`).join('')}</div>
      <div class="stack" style="gap:6px"><b>${t('s1Else')}</b><span class="muted small">${t('s1ElseSub')}</span></div>
      <div class="choice-list"><button class="choice" data-act="locate"><span><b>${t('useLoc')}</b></span>${icon('pin', 22)}</button>
      ${state.farm.custom ? `<button class="choice" aria-pressed="true"><span><b>${t('custom')}</b><small>${state.farm.lat.toFixed(3)}, ${state.farm.lon.toFixed(3)}${inArizona(state.farm.lat, state.farm.lon) ? ' · Arizona' : ''}</small></span><span class="tick"></span></button>` : ''}</div>`;
  } else if (s === 2) {
    const cur = state.baseline.join();
    body = `${scene('rotation')}<div class="stack" style="gap:6px"><h1>${t('s2Title')}</h1><p class="muted">${t('s2Sub')}</p></div>
      <div class="choice-list">${PRESETS.map((p) => `<button class="choice" aria-pressed="${p.rot.join() === cur}" data-preset="${p.id}"><span class="choice-l"><span class="choice-art">${[...new Set(p.rot.flatMap((x) => x.split('+')))].filter((c) => c !== 'fallow').map((c) => cropArt(c, 26)).join('')}</span><b>${t(p.id)}</b></span><span class="tick"></span></button>`).join('')}</div>`;
  } else {
    body = `${scene('water')}<h1>${t('s3Title')}</h1>
      <label class="slider"><span class="lab">${t('water')}<b class="num" id="allotV">${t('waterUnit', { n: state.allotment.toFixed(1) })}</b></span>
        <input type="range" id="allot" min="1" max="7" step="0.1" value="${state.allotment}"><span class="muted small">${t('waterHint')}</span></label>
      <div class="stack" style="gap:8px"><span class="muted">${t('srcTitle')}</span><div class="seg" role="radiogroup">${['wells', 'mix', 'canal'].map((v) => `<button role="radio" aria-checked="${state.source === v}" data-src="${v}">${t(`src${v[0].toUpperCase()}${v.slice(1)}`)}</button>`).join('')}</div></div>
      <label class="slider"><span class="lab">${t('priceLabel')}<b id="priceV">${t('priceUnit', { n: state.waterPrice })}</b></span>
        <input type="range" id="priceIn" min="0" max="400" step="5" value="${state.waterPrice}"><span class="muted small">${t('priceHint')}</span></label>
      <div class="stack" style="gap:8px"><span class="muted">${t('irrigation')}</span><div class="seg" role="radiogroup">${['furrow', 'sprinkler', 'drip'].map((v) => `<button role="radio" aria-checked="${state.irrigation === v}" data-irr="${v}">${t(v)}</button>`).join('')}</div></div>
      <div class="stack" style="gap:8px"><span class="muted">${t('goals')}</span><div class="chips">${GOALS.map((g) => `<button aria-pressed="${state.goals.has(g)}" data-goal="${g}">${t(GOAL_LABEL[g])}</button>`).join('')}</div></div>`;
  }
  const foot = `<div class="setup-foot">${s > 1 ? `<button class="btn" data-setup="back">${t('back')}</button>` : ''}<button class="btn primary" data-setup="next">${s < 3 ? t('next') : t('showOptions')}</button></div>`;
  $('#setup').innerHTML = `<div class="setup-in"><div class="stack" style="gap:8px">${prog}</div>${body}${foot}</div>`;
  const allot = $('#allot');
  if (allot) allot.addEventListener('input', () => { state.allotment = +allot.value; $('#allotV').textContent = t('waterUnit', { n: state.allotment.toFixed(1) }); });
  const pr = $('#priceIn');
  if (pr) pr.addEventListener('input', (e) => { e.stopPropagation(); state.waterPrice = +pr.value; $('#priceV').textContent = t('priceUnit', { n: state.waterPrice }); });
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
  if (b.classList.contains('lang')) { setLang(getLang() === 'en' ? 'es' : 'en'); renderAll(); if (!$('#setup').hidden) renderSetup(); if (!$('#landing').hidden) renderLanding(); return; }
  if (b.id === 'placeChip') return openSetup(1);
  if (d.slot) { const [y, s] = d.slot.split('-'); return slotPicker(+y, s); }
  if (d.pick) { const [y, s, c] = d.pick.split('-'); return pick(+y, s, c); }
  if (d.short) { state.shortage = d.short; renderBuild(); return recompute(); }
  if (d.src) { state.source = d.src; return renderSetup(); }
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
    case 'fix-now': return openSetup(2);
    case 'land-try': state.farm = { ...FARMS[0] }; hideLanding(); return openSetup(1);
    case 'land-mine': hideLanding(); return openSetup(1);
    case 'home': return showLanding();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.dataset.price) {
    state.waterPrice = +e.target.value;
    e.target.previousElementSibling.querySelector('b').textContent = t('priceUnit', { n: state.waterPrice });
    persist();
    return recompute();
  }
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
if (firstRun || location.hash === '#home') showLanding();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
