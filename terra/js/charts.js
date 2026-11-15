// Small UI pieces drawn in SVG/HTML: rings, calendar strip, year replay, sparkline, icons.
import { CROPS, CY_MONTHS } from './crops.js';
import { t, crop, month } from './i18n.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function grade(v) { return t(v >= 80 ? 'gGreat' : v >= 60 ? 'gGood' : v >= 40 ? 'gOk' : 'gPoor'); }

export function ring(value, label, size = 76, key = '', sub = '') {
  const r = size / 2 - 6, c = 2 * Math.PI * r, off = c * (1 - value / 100);
  return `<button class="ring" style="--s:${size}px" data-score="${key}" aria-label="${esc(label)} ${value} of 100">
    <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>
    <b>${value}<small>/100</small></b><span>${esc(label)}</span>${sub ? `<em>${esc(sub)}</em>` : ''}<i>${esc(grade(value))}</i>
  </button>`;
}

// Four scores, each with the plain number behind it. Tap one for how it is worked out.
export function rings(s, d) {
  const pct = (v) => Math.round(100 * v);
  const sub = d ? {
    water: d.waterPct != null ? t('subWater', { p: pct(d.waterPct) }) : '',
    soil: '',
    resilience: t('subSafe', { n: d.good, t: d.years }),
    income: d.incomePct != null ? t('subIncome', { p: pct(d.incomePct) }) : '',
  } : {};
  return `<div class="rings">${ring(s.water, t('rWater'), 76, 'water', sub.water)}${ring(s.soil, t('rSoil'), 76, 'soil', sub.soil)}${ring(s.resilience, t('rSafety'), 76, 'resilience', sub.resilience)}${ring(s.income, t('rIncome'), 76, 'income', sub.income)}</div><p class="muted small ring-tip">${t('ringTip')}</p>`;
}

function riskMonths(r) {
  const out = new Map();
  const n = r.replay.length || 1;
  r.seq.forEach((tp, y) => {
    for (const c of tp.parts) {
      for (const kind of ['heat', 'frost']) {
        const rule = CROPS[c][kind];
        if (!rule) continue;
        const years = r.replay.filter((yr) => yr.hits.some((h) => h.crop === c && h.kind === kind)).length;
        if (years / n < 0.2) continue;
        for (const m of rule.months) out.set(`${y}-${CY_MONTHS.indexOf(m)}`, true);
      }
    }
  });
  return out;
}

export function calendarStrip(r) {
  const risk = riskMonths(r);
  const rows = [0, 1, 2].map((y) => {
    const cells = r.calendar.filter((c) => c.year === y).map((c) => {
      const mark = risk.get(`${y}-${c.k}`);
      return `<i class="cc${c.crop === 'fallow' ? ' bare' : ''}" style="--c:${CROPS[c.crop].color}" title="${esc(`${t('yearN', { n: y + 1 })} · ${month(c.month)} · ${crop(c.crop)}`)}">${mark ? '<em></em>' : ''}</i>`;
    }).join('');
    return `<div class="cal-row"><span>${y + 1}</span><div class="cal-cells">${cells}</div></div>`;
  }).join('');
  const m = CY_MONTHS.map((x) => `<span>${month(x).slice(0, 1).toUpperCase()}</span>`).join('');
  const crops = [...new Set(r.seq.flatMap((x) => x.parts))].filter((c) => c !== 'fallow');
  const key = crops.map((c) => `<span><i style="background:${CROPS[c].color}"></i>${esc(crop(c))}</span>`).join('') +
    (r.bareMonths ? `<span><i class="bare"></i>${t('bare')}</span>` : '') +
    (risk.size ? `<span><i class="riskdot"></i>${t('risk')}</span>` : '');
  return `<div class="cal">${rows}<div class="cal-row months"><span></span><div class="cal-cells">${m}</div></div></div><div class="legend-row">${key}</div>`;
}

export function replayStrip(r) {
  const sq = r.replay.map((y) => `<i class="rp ${y.status}" title="${y.cy}"></i>`).join('');
  return `<div class="rp-row">${sq}</div><div class="rp-axis"><span>${r.replay[0]?.cy ?? ''}</span><span>${r.replay[r.replay.length - 1]?.cy ?? ''}</span></div>`;
}

export function sparkline(rows, w = 300, h = 64) {
  const ts = rows.map((r) => Date.parse(r.date));
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  const x = (v) => 4 + (w - 8) * (v - t0) / (t1 - t0 || 1);
  const y = (v) => 4 + (h - 8) * (1 - Math.max(0, Math.min(0.9, v)) / 0.9);
  const pts = rows.map((r, i) => `${x(ts[i]).toFixed(1)},${y(r.ndvi).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" preserveAspectRatio="none" aria-hidden="true">
    <rect x="0" y="${y(0.2)}" width="${w}" height="${h - y(0.2)}" class="spark-bare"/>
    <polyline points="${pts}" class="spark-line"/>
  </svg>`;
}

// Simple line icons on a 24px grid.
const P = {
  field: '<path d="M3 20h18M5 20c0-6 3-10 7-10s7 4 7 10"/><path d="M12 10V4m0 0c-2 0-3 1-3 3m3-3c2 0 3 1 3 3"/>',
  plans: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M8 4v16"/>',
  build: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/>',
  learn: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  download: '<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5"/><path d="M4 19h16"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4m8-4v4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-9.5v.5"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cloud: '<path d="M7 17a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4 4 0 0 1 0 8z"/><path d="M9 20l-1 2m5-2-1 2m5-2-1 2"/>',
  well: '<path d="M5 10h14M7 10V6l5-3 5 3v4M8 10v11m8-11v11M8 15h8"/>',
  sat: '<rect x="9" y="9" width="6" height="6" rx="1" transform="rotate(45 12 12)"/><path d="M4 4l4 4m8 8 4 4M14 4l-2 2m-6 6-2 2"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2m0 8v2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4m0 3v.5"/>',
  saved: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.5"/>',
  home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
};
export const icon = (name, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

// Small bar chart by year, e.g. days over 110°F. series: [[year, value], ...]
export function yearBars(series, { color = 'var(--amber)', h = 64 } = {}) {
  if (!series?.length) return '';
  const w = 300, gap = 3, bw = (w - gap * (series.length - 1)) / series.length;
  const max = Math.max(1, ...series.map((s) => s[1]));
  const bars = series.map(([y, v], i) => {
    const bh = Math.max(2, (v / max) * (h - 4));
    return `<rect x="${(i * (bw + gap)).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${color}"><title>${y}: ${Math.round(v)}</title></rect>`;
  }).join('');
  return `<svg class="mini" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>
    <div class="rp-axis"><span>${series[0][0]}</span><span>${series[series.length - 1][0]}</span></div>`;
}

// Depth to water over time; deeper is drawn lower. series: [[year, ft], ...]
export function depthLine(series) {
  if (!series || series.length < 3) return '';
  const w = 300, h = 70, pad = 4;
  const ys = series.map((s) => s[1]);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const x0 = series[0][0], x1 = series[series.length - 1][0];
  const pts = series.map(([x, v]) => `${(pad + ((x - x0) / (x1 - x0 || 1)) * (w - 2 * pad)).toFixed(1)},${(pad + ((v - lo) / span) * (h - 2 * pad)).toFixed(1)}`);
  return `<svg class="mini" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts.join(' ')}" fill="none" stroke="#7fb3c9" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>
    <div class="rp-axis"><span>${x0} · ${Math.round(series[0][1])} ft</span><span>${x1} · ${Math.round(series[series.length - 1][1])} ft</span></div>`;
}

// Paired bars: station value vs our value, one pair per station.
export function pairBars(rows, labels) {
  if (!rows?.length) return '';
  const max = Math.max(...rows.flatMap((r) => [r.a, r.b])) * 1.05;
  const items = rows.map((r) => `<div class="pb"><span class="pb-n">${esc(r.name)}</span>
      <div class="pb-bars"><i style="width:${(100 * r.a / max).toFixed(1)}%" class="pb-a"></i><i style="width:${(100 * r.b / max).toFixed(1)}%" class="pb-b"></i></div>
      <span class="pb-v">${Math.round(r.a)} · ${Math.round(r.b)}</span></div>`).join('');
  return `<div class="pairbars">${items}</div><div class="legend-row"><span><i class="pb-a"></i>${esc(labels[0])}</span><span><i class="pb-b"></i>${esc(labels[1])}</span></div>`;
}

// Data flow: boxes and arrows.
export function flowDiagram(steps) {
  return `<div class="flow">${steps.map((s, i) => `<div class="flow-box${i === steps.length - 1 ? ' last' : ''}">${esc(s)}</div>${i < steps.length - 1 ? '<span class="flow-arrow" aria-hidden="true">→</span>' : ''}`).join('')}</div>`;
}
