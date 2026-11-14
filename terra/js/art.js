// Original line-art for crops and a few small scenes, in the same style as the logo.
// Drawn on a 48px grid with round strokes so they read well from 20px to 160px.

const CROP_PATHS = {
  alfalfa: `
    <path d="M24 44V24"/>
    <path d="M24 24c-7 0-11-4-11-10 6 0 11 4 11 10z"/>
    <path d="M24 24c7 0 11-4 11-10-6 0-11 4-11 10z"/>
    <path d="M24 22c-4-4-4-10 0-14 4 4 4 10 0 14z"/>
    <path d="M24 34c-4 0-7-2-8-5"/>`,
  cotton: `
    <path d="M24 44V31"/>
    <path d="M17 31c2 2 12 2 14 0"/>
    <circle cx="18" cy="22" r="6"/><circle cx="30" cy="22" r="6"/><circle cx="24" cy="15" r="6"/>
    <path d="M14 30l-3 3M34 30l3 3"/>`,
  wheat: `
    <path d="M24 44V12"/>
    <path d="M24 16c-4-1-6-4-6-7 4 1 6 4 6 7zM24 16c4-1 6-4 6-7-4 1-6 4-6 7z"/>
    <path d="M24 24c-4-1-6-4-6-7 4 1 6 4 6 7zM24 24c4-1 6-4 6-7-4 1-6 4-6 7z"/>
    <path d="M24 32c-4-1-6-4-6-7 4 1 6 4 6 7zM24 32c4-1 6-4 6-7-4 1-6 4-6 7z"/>
    <path d="M24 12V5"/>`,
  barley: `
    <path d="M24 44V14"/>
    <path d="M24 18c-3-1-5-3-5-6 3 1 5 3 5 6zM24 18c3-1 5-3 5-6-3 1-5 3-5 6z"/>
    <path d="M24 26c-3-1-5-3-5-6 3 1 5 3 5 6zM24 26c3-1 5-3 5-6-3 1-5 3-5 6z"/>
    <path d="M19 12L13 3M29 12l6-9M19 20l-8-6M29 20l8-6"/>`,
  sorghum: `
    <path d="M24 44V26"/>
    <path d="M24 26c-6 0-9-5-9-11S19 4 24 4s9 5 9 11-3 11-9 11z"/>
    <path d="M19 10h10M17 15h14M18 20h12"/>
    <path d="M24 36c5-1 9-4 11-8M24 39c-5-1-9-4-11-8"/>`,
  guar: `
    <path d="M24 44V8"/>
    <path d="M24 14c-3 0-5 3-5 9s1 9 2 10"/><path d="M24 14c3 0 5 3 5 9s-1 9-2 10"/>
    <path d="M24 24c-6 0-9 3-10 8M24 24c6 0 9 3 10 8"/>
    <path d="M24 8c-3-2-6-2-8 0M24 8c3-2 6-2 8 0"/>`,
  sesame: `
    <path d="M24 44V16"/>
    <path d="M24 16c-4 0-6-4-5-10 3 0 5 2 5 4 0-2 2-4 5-4 1 6-1 10-5 10z"/>
    <rect x="19" y="24" width="4" height="9" rx="2"/><rect x="25" y="26" width="4" height="9" rx="2"/>`,
  wcover: `
    <path d="M24 44V27"/>
    <circle cx="24" cy="16" r="6"/><circle cx="16" cy="24" r="6"/><circle cx="32" cy="24" r="6"/>
    <path d="M24 27v-5"/>`,
  scover: `
    <path d="M10 30c4-12 24-16 30-10-2 10-20 16-30 10z"/>
    <circle cx="18" cy="27" r="2.5"/><circle cx="25" cy="24.5" r="2.5"/><circle cx="32" cy="22.5" r="2.5"/>
    <path d="M38 19c2-3 2-6 0-9"/>`,
  fallow: `
    <path d="M6 30c6-3 12-3 18 0s12 3 18 0"/>
    <path d="M6 38c6-3 12-3 18 0s12 3 18 0" opacity=".6"/>
    <path d="M14 22l2-2M30 21l2 2M22 16l1-2"/>`,
};

export function cropArt(id, size = 28, extra = '') {
  return `<svg class="art ${extra}" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CROP_PATHS[id] || CROP_PATHS.fallow}</svg>`;
}

const LIME = '#d6f45c', INK = '#10120c', S2 = '#20231e', S3 = '#2a2e27', MUTED = '#3d4237';

// A slice of the planet made of crop rows, with a satellite on a dotted orbit.
function planetRows(cx, cy, r) {
  const rows = [0, 1, 2, 3, 4].map((i) => {
    const y = cy - r * 0.35 + i * r * 0.28;
    return `<path d="M${cx - r * 1.3} ${y + r * 0.12}c${r * 0.5} ${-r * 0.32} ${r * 2.1} ${-r * 0.32} ${r * 2.6} 0" stroke="${INK}" stroke-width="${r * 0.11}" stroke-linecap="round" fill="none"/>`;
  }).join('');
  return `<clipPath id="pc${cx}${cy}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${LIME}"/>
    <g clip-path="url(#pc${cx}${cy})">${rows}</g>`;
}

export function scene(name) {
  const W = 360, H = 200;
  let g = '';
  if (name === 'field') {
    g = `${planetRows(180, 250, 150)}
      <path d="M40 110C90 40 220 20 300 40" fill="none" stroke="${LIME}" stroke-width="3" stroke-linecap="round" stroke-dasharray="0.1 12" opacity=".8"/>
      <g transform="translate(304 40) rotate(18)"><rect x="-8" y="-8" width="16" height="16" rx="4" fill="${LIME}"/><rect x="-30" y="-5" width="18" height="10" rx="2" fill="${MUTED}"/><rect x="12" y="-5" width="18" height="10" rx="2" fill="${MUTED}"/></g>
      <path d="M304 52L230 128" stroke="${LIME}" stroke-width="2" stroke-dasharray="4 6" opacity=".5"/>
      <g transform="translate(222 112)"><path d="M0 22S-14 9-14 0a14 14 0 0 1 28 0c0 9-14 22-14 22z" fill="${INK}" stroke="${LIME}" stroke-width="3"/><circle cx="0" cy="0" r="5" fill="${LIME}"/></g>
      <circle cx="62" cy="52" r="16" fill="${S3}"/>`;
  } else if (name === 'rotation') {
    const tiles = [['alfalfa', 40], ['cotton', 140], ['wheat', 240]].map(([c, x], i) => `
      <g transform="translate(${x} 60)"><rect width="80" height="80" rx="22" fill="${i === 1 ? LIME : S2}"/>
      <g transform="translate(16 16)" color="${i === 1 ? INK : LIME}">${cropArt(c, 48)}</g></g>`).join('');
    g = `${tiles}
      <path d="M120 100h18M220 100h18" stroke="${MUTED}" stroke-width="3" stroke-linecap="round"/>
      <path d="M280 152c0 26-200 26-200 0" fill="none" stroke="${LIME}" stroke-width="3" stroke-linecap="round" stroke-dasharray="0.1 10"/>
      <path d="M86 146l-6 8 10 2" fill="none" stroke="${LIME}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (name === 'water') {
    g = `<defs><clipPath id="drop"><path d="M180 26s52 58 52 98a52 52 0 0 1-104 0c0-40 52-98 52-98z"/></clipPath></defs>
      <path d="M180 26s52 58 52 98a52 52 0 0 1-104 0c0-40 52-98 52-98z" fill="${S2}"/>
      <g clip-path="url(#drop)"><path d="M110 120c20-10 40 10 70 0s50-10 70 0V200H110z" fill="${LIME}"/><path d="M110 140c20-10 40 10 70 0s50-10 70 0" stroke="${INK}" stroke-width="3" fill="none" opacity=".35"/></g>
      <circle cx="80" cy="80" r="26" fill="none" stroke="${S3}" stroke-width="7"/><circle cx="80" cy="80" r="26" fill="none" stroke="${LIME}" stroke-width="7" stroke-linecap="round" stroke-dasharray="120 200" transform="rotate(-90 80 80)"/>
      <circle cx="284" cy="70" r="20" fill="none" stroke="${S3}" stroke-width="7"/><circle cx="284" cy="70" r="20" fill="none" stroke="${LIME}" stroke-width="7" stroke-linecap="round" stroke-dasharray="70 200" transform="rotate(-90 284 70)"/>`;
  } else if (name === 'learn') {
    g = `${planetRows(180, 260, 140)}
      <g transform="translate(180 46)"><rect x="-10" y="-10" width="20" height="20" rx="5" fill="${LIME}"/><rect x="-40" y="-6" width="24" height="12" rx="2" fill="${MUTED}"/><rect x="16" y="-6" width="24" height="12" rx="2" fill="${MUTED}"/></g>
      <path d="M170 62l-40 70M190 62l40 70M180 62v66" stroke="${LIME}" stroke-width="2" stroke-dasharray="3 7" opacity=".6"/>`;
  }
  return `<svg class="scene" viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true">${g}</svg>`;
}

// Big background mark for hero cards: the logo's planet of crop rows, outline only.
export function heroPlanet(size = 220) {
  const rows = [0, 1, 2, 3, 4, 5].map((i) => `<path d="M-10 ${70 + i * 22}c40 -26 180 -26 220 0"/>`).join('');
  return `<svg class="hero-art" width="${size}" height="${size}" viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" aria-hidden="true">
    <defs><clipPath id="hp"><circle cx="100" cy="110" r="84"/></clipPath></defs>
    <circle cx="100" cy="110" r="84" stroke-width="8"/>
    <g clip-path="url(#hp)">${rows}</g>
    <path d="M14 70C40 30 120 8 170 22" stroke-width="7" stroke-dasharray="0.1 18"/>
    <circle cx="178" cy="24" r="10" fill="currentColor" stroke="none"/>
  </svg>`;
}
