// Small UI pieces drawn in SVG/HTML: rings, calendar strip, year replay, sparkline, icons.
import { CROPS, CY_MONTHS } from './crops.js';
import { t, crop, month } from './i18n.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function grade(v) { return t(v >= 80 ? 'gGreat' : v >= 60 ? 'gGood' : v >= 40 ? 'gOk' : 'gPoor'); }

export function ring(value, label, size = 76) {
  const r = size / 2 - 6, c = 2 * Math.PI * r, off = c * (1 - value / 100);
  return `<div class="ring" style="--s:${size}px">
    <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>
    <b>${esc(grade(value))}</b><span>${esc(label)}</span>
  </div>`;
}

export function rings(s) {
  return `<div class="rings">${ring(s.water, t('rWater'))}${ring(s.soil, t('rSoil'))}${ring(s.resilience, t('rSafety'))}${ring(s.income, t('rIncome'))}</div>`;
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
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4m8-4v4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-9.5v.5"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
};
export const icon = (name, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
