// Money per acre, from public Arizona budgets and USDA prices.
//
// How a year is costed:
//   revenue  = yield x price, cut by any water shortfall that year
//              (FAO yield response factor Ky: yield loss = Ky x water deficit)
//   costs    = the crop's own costs WITHOUT irrigation water (seed, fertilizer,
//              labor, machinery, harvest), from the budgets below
//            + land rent once per year
//            + water actually applied x your price per acre-foot
// So water cuts, pumping costs and hotter years all reach the bottom line
// through the same water model that drives everything else.
//
// All money is US dollars per acre, 2024 unless noted.

export const ECON_SOURCES = {
  uaLaPaz: {
    label: 'University of Arizona, La Paz County 2024 Field Crop Production Budgets (az2139): flood-irrigated alfalfa, cotton, sorghum, durum, with water at $55 per acre-foot',
    url: 'https://www.extension.arizona.edu/sites/default/files/2025-07/az2139_Arizona-Agricultural-Enterprise-Budgets-La-Paz-County-2024-Field-Crop-Production-Budgets.pdf',
  },
  uaBarley: {
    label: 'University of Arizona, Spring Barley Following Cotton, Flood Irrigated, Southern Arizona (az2038, 2023)',
    url: 'https://www.extension.arizona.edu/sites/default/files/2024-08/az2038-2023.pdf',
  },
  nass: {
    label: 'USDA NASS, 2024 State Agriculture Overview for Arizona: yields and prices for alfalfa hay, durum, barley, upland cotton, cottonseed',
    url: 'https://www.nass.usda.gov/Quick_Stats/Ag_Overview/stateOverview.php?state=ARIZONA&year=2024',
  },
  ers: {
    label: 'USDA ERS Commodity Costs and Returns, cotton, Fruitful Rim region (includes Arizona): 2024 lint price and cottonseed-to-lint ratio',
    url: 'https://www.ers.usda.gov/data-products/commodity-costs-and-returns',
  },
  tamuGuar: {
    label: 'Texas A&M AgriLife, 2022 Irrigated Guar budget (South Plains). No Arizona guar budget exists.',
    url: 'https://agecoext.tamu.edu/wp-content/uploads/2022/01/2022D2GuarIrragated.pdf',
  },
  tamuSesame: {
    label: 'Texas A&M AgriLife, 2024 Irrigated Sesame budget (South Plains). No Arizona sesame budget exists.',
    url: 'https://agecoext.tamu.edu/wp-content/uploads/2024/02/2024D2SesameIrrigated.pdf',
  },
  sare: {
    label: 'SARE Cover Crop Economics: seed $10 to $50 (Western median about $40), seeding about $12, termination up to $10 per acre',
    url: 'https://www.sare.org/publications/cover-crop-economics/how-to-get-a-faster-return-from-cover-crops/creating-a-baseline-for-cover-crop-costs-and-returns/',
  },
  fao33: {
    label: 'FAO Irrigation and Drainage Paper 66 (from Paper 33), Table 1: seasonal yield response factors Ky',
    url: 'https://fao.org/4/i2800e/i2800e02.pdf',
  },
};

// Default price of irrigation water used in the University of Arizona budgets.
export const WATER_PRICE_DEFAULT = 55;
// Cash rent per acre per year (UA budgets charge $170 per crop; we charge it once a year).
export const LAND_RENT = 170;

// yield, unit, price: what the crop earns.
// variable: crop's own operating costs per acre with the irrigation water line removed.
// fixed: machinery ownership etc. per acre, with land rent removed (charged once a year above).
// ky: FAO yield response to water deficit.
export const BUDGETS = {
  alfalfa: {
    yield: 7.3, unit: 'ton', price: 186, // NASS AZ 2024
    variable: 820.06, // UA La Paz 2024: $1,095.06 variable minus 5.0 ac-ft x $55 water
    fixed: 391.31, // $5.78 ownership + $385.53 stand establishment spread over the stand's life
    ky: 1.1, src: ['nass', 'uaLaPaz', 'fao33'],
  },
  cotton: {
    yield: 1299, unit: 'lb', price: 0.76, // NASS AZ 2024 upland yield, ERS Fruitful Rim 2024 lint price
    extra: { label: 'cottonseed', yield: 1.05, unit: 'ton', price: 328 }, // 1.618 lb seed per lb lint (ERS 2024), NASS AZ $328/ton
    variable: 1159.61, // UA La Paz 2024: $1,434.61 minus 5.0 ac-ft x $55
    fixed: 108.68,
    ky: 0.85, src: ['nass', 'ers', 'uaLaPaz', 'fao33'],
  },
  wheat: {
    yield: 109, unit: 'bu', price: 8.57, // NASS AZ 2024 durum
    variable: 856.82, // UA La Paz 2024: $1,049.32 minus 3.5 ac-ft x $55
    fixed: 40.61,
    ky: 1.05, src: ['nass', 'uaLaPaz', 'fao33'],
  },
  barley: {
    yield: 102, unit: 'bu', price: 6.25, // NASS AZ 2024
    variable: 504.94, // UA 2023: $642.44 minus 2.5 ac-ft x $55
    fixed: 45.88,
    ky: 1.05, kyApprox: true, src: ['nass', 'uaBarley', 'fao33'],
  },
  sorghum: {
    yield: 100, unit: 'bu', price: 5.60, // UA La Paz 2024 (NASS does not publish Arizona sorghum)
    variable: 555.63, // $693.13 minus 2.5 ac-ft x $55
    fixed: 46.49,
    ky: 0.9, src: ['uaLaPaz', 'fao33'],
  },
  guar: {
    yield: 1200, unit: 'lb', price: 0.16,
    variable: 161.64, // $210.64 minus irrigation energy and labor
    fixed: 105.25, // $205.25 minus $100 cash rent
    ky: 1.15, kyApprox: true, approx: true, src: ['tamuGuar', 'fao33'],
  },
  sesame: {
    yield: 1200, unit: 'lb', price: 0.60,
    variable: 351.70,
    fixed: 105.25, // $205.25 minus $100 cash rent
    ky: 0.95, kyApprox: true, approx: true, src: ['tamuSesame', 'fao33'],
  },
  wcover: { yield: 0, unit: '', price: 0, variable: 62, fixed: 0, ky: 0, src: ['sare'] },
  scover: { yield: 0, unit: '', price: 0, variable: 62, fixed: 0, ky: 0, src: ['sare'] },
  fallow: { yield: 0, unit: '', price: 0, variable: 0, fixed: 0, ky: 0, src: [] },
};

export function grossRevenue(cropId, prices = {}) {
  const b = BUDGETS[cropId];
  if (!b) return 0;
  const p = prices[cropId] ?? b.price;
  return b.yield * p + (b.extra ? b.extra.yield * b.extra.price : 0);
}

// Relative yield after a water shortfall (FAO Ky), valid to about a 50% deficit.
export function yieldFactor(ky, deficit) {
  const d = Math.max(0, Math.min(0.6, deficit));
  return Math.max(0, 1 - ky * d);
}

// Net money for one crop year on one acre.
// parts: crop ids in that year. deficit: 0..1 share of water need not met.
export function yearNet(parts, appliedAcft, deficit, opts = {}) {
  const waterPrice = opts.waterPrice ?? WATER_PRICE_DEFAULT;
  let rev = 0, variable = 0, fixed = LAND_RENT;
  for (const c of parts) {
    const b = BUDGETS[c];
    if (!b) continue;
    rev += grossRevenue(c, opts.prices) * yieldFactor(b.ky, deficit);
    variable += b.variable;
    fixed += b.fixed;
  }
  const water = appliedAcft * waterPrice;
  // cash: what's left after paying to grow the crop this year (seed, fuel, labor, water).
  // net: after land rent and machinery ownership too.
  return { revenue: rev, water, cash: rev - variable - water, net: rev - variable - water - fixed };
}

// Colorado River shortage tiers and what they meant for central Arizona farms
// on Central Arizona Project (CAP) water.
// Tier 1 (2022): about 60% of Pinal farmers' CAP water was cut.
// Tier 2a (2023) and after: CAP water for these farms ended under the 2019
// Drought Contingency Plan, and it has stayed off since.
export const SHORTAGE = {
  none: { cut: 0 },
  tier1: { cut: 0.6 },
  tier2: { cut: 1 },
};
export const SHORTAGE_SOURCES = [
  { label: 'Arizona Daily Star (Aug 2021): 2022 Tier 1 cuts take about 60% of Pinal farmers’ CAP supply, which falls to zero in 2023', url: 'https://tucson.com/tncms/asset/editorial/79ae4f88-fec3-11eb-87be-67757f19ae51/' },
  { label: 'Western Growers: Tier 1 cuts Arizona by 512,000 acre-feet; 100% of the CAP Ag Pool is eliminated', url: 'https://www.wga.com/?p=7734' },
  { label: 'Arizona Water Banking Authority 2023 Plan: Tier 2a cuts Arizona by 592,000 acre-feet', url: 'https://azwaterbank.gov/sites/default/files/2023-01/05-AWBA_2023_Preliminary_Plan.pdf' },
  { label: 'University of Arizona Cooperative Extension: a 300,000 acre-foot cutback would fallow about 75% of Pinal County cotton', url: 'https://www.extension.arizona.edu/publication/potential-regional-economic-impacts-water-cutbacks-irrigated-agriculture' },
];

// Supply after a shortage, given the share of the farm's water that comes from CAP.
export function supplyAfter(allotment, capShare, tier) {
  const cut = SHORTAGE[tier]?.cut ?? 0;
  return allotment * (1 - Math.max(0, Math.min(1, capShare)) * cut);
}
