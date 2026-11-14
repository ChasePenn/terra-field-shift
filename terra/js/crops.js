// Crop facts for central Arizona (low desert, ~1,000-2,000 ft).
// Every number below has a source in SOURCES. Where we had to approximate,
// `approx` says so and the app lowers its confidence label.
//
// Calendar: a "crop year" runs November through October, the way central
// Arizona fields actually turn over (winter grains go in Nov-Dec, summer
// crops come out by late October).
//
// kc = FAO-56 single crop coefficients [initial, mid-season, end].
// stages = FAO-56 growth stage lengths in days [initial, development, mid, late].
// height = typical crop height in meters (FAO-56 Table 12), used for the dry-climate Kc adjustment.

export const SOURCES = {
  fao56: {
    label: 'FAO Irrigation and Drainage Paper 56, Tables 11 and 12 (crop coefficients and stage lengths)',
    url: 'https://www.fao.org/4/x0490e/x0490e0b.htm',
  },
  uaSmallGrains: {
    label: 'University of Arizona, Planting Dates for Small Grains in Arizona (AZ1332): Nov 15 to Dec 15 in central Arizona',
    url: 'https://extension.arizona.edu/sites/extension.arizona.edu/files/pubs/az1332-2015.pdf',
  },
  uaSmallGrainWater: {
    label: 'University of Arizona, Irrigation of Small Grains in Arizona (AZ1345): wheat and barley use about 2 ft of water',
    url: 'https://itc.tamu.edu/files/2023/08/az1345-2015.pdf',
  },
  uaCotton: {
    label: 'University of Arizona: cotton is planted April to May and harvested October to November',
    url: 'https://cales.arizona.edu/news/why-do-we-grow-cotton-arizona',
  },
  cottonWater: {
    label: 'Erie et al., Arizona cotton consumptive use about 41 inches per season',
    url: 'https://icac.org/wp-content/uploads/2024/11/1991-March-Cotton-Recorder.pdf',
  },
  uaSorghum: {
    label: 'University of Arizona ACIS: late-June sorghum near Phoenix used 25 inches',
    url: 'https://acis.cals.arizona.edu/agricultural-ipm/field-crop/corn-and-sorghum/irrigation',
  },
  alfalfaWater: {
    label: 'University of Arizona repository: Arizona alfalfa needs about 6 acre-feet per year',
    url: 'https://repository.arizona.edu/handle/10150/201439',
  },
  guarWater: {
    label: 'Alexander, Bucks and Backhaus (1988), guar at Maricopa, AZ: 400 mm seasonal water use',
    url: 'https://agris.fao.org/search/en/records/65df7b474c5aef494fe2db02',
  },
  guarRotation: {
    label: 'University of Arizona SBAR, Guar as a Rotation Crop: deep-rooted legume suited to Arizona',
    url: 'https://sbar.arizona.edu/sites/default/files/2023-04/SBAR%20Fact%20Sheet%20Guar%20as%20a%20Rotation%20Crop.pdf',
  },
  uaBudgets: {
    label: 'University of Arizona, Pinal County 2025 field crop budgets (use for real prices and costs)',
    url: 'https://repository.arizona.edu/handle/10150/678680',
  },
};

// Muted, distinguishable colors by role. Legumes share a green family,
// grains a wheat family, so the calendar strip reads at a glance.
export const CROPS = {
  alfalfa: {
    name: 'Alfalfa', short: 'Alfalfa', family: 'Legume', role: 'cash', color: '#3f7d4e',
    perennial: true, legume: true, deepRoots: true,
    kcFlat: 0.95, height: 0.7, // FAO-56 Table 12, alfalfa hay, averaged cutting effects (mid 0.95)
    income: 5, approx: false,
    sources: ['fao56', 'alfalfaWater'],
    note: 'Perennial hay legume. Cut 8 to 12 times a year, fixes its own nitrogen, high water use.',
  },
  cotton: {
    name: 'Upland cotton', short: 'Cotton', family: 'Mallow', role: 'cash', color: '#8a7f6e',
    plant: [4, 1], stages: [30, 75, 55, 45], kc: [0.35, 1.175, 0.60], height: 1.3,
    deepRoots: true, income: 5, approx: false,
    heat: { months: [7, 8], tmaxC: 43.3, days: 15, text: 'many 110°F days during bloom can cut boll set' },
    sources: ['fao56', 'uaCotton', 'cottonWater'],
    note: 'Summer fiber crop, planted in April. Leaves room only for a short winter cover before it.',
  },
  wheat: {
    name: 'Durum wheat', short: 'Durum', family: 'Grass', role: 'cash', color: '#c9a646',
    plant: [12, 5], stages: [20, 55, 65, 30], kc: [0.30, 1.15, 0.25], height: 1.0,
    income: 3, approx: false,
    heat: { months: [4], tmaxC: 35, days: 6, text: 'hot days in April during grain fill lower yield' },
    frost: { months: [2, 3], tminC: -2, text: 'a hard freeze near heading can damage grain' },
    sources: ['fao56', 'uaSmallGrains', 'uaSmallGrainWater'],
    note: 'Winter pasta wheat, planted in December, harvested in May.',
  },
  barley: {
    name: 'Barley', short: 'Barley', family: 'Grass', role: 'cash', color: '#d8bf7a',
    plant: [12, 1], stages: [15, 50, 60, 30], kc: [0.30, 1.15, 0.25], height: 1.0,
    income: 2, approx: false,
    heat: { months: [4], tmaxC: 35, days: 6, text: 'hot days in April during grain fill lower yield' },
    frost: { months: [2, 3], tminC: -2, text: 'a hard freeze near heading can damage grain' },
    sources: ['fao56', 'uaSmallGrains', 'uaSmallGrainWater'],
    note: 'Winter grain, finishes a few weeks before wheat and uses a little less water.',
  },
  sorghum: {
    name: 'Grain sorghum', short: 'Sorghum', family: 'Grass', role: 'cash', color: '#b0763c',
    plant: [6, 25], stages: [20, 35, 40, 25], kc: [0.30, 1.05, 0.55], height: 1.5,
    deepRoots: true, income: 2, approx: false,
    sources: ['fao56', 'uaSorghum'],
    note: 'Heat-tolerant summer grain. Fits after a winter grain is harvested.',
  },
  guar: {
    name: 'Guar', short: 'Guar', family: 'Legume', role: 'cash', color: '#6e9f62',
    plant: [7, 1], stages: [20, 30, 40, 20], kc: [0.35, 0.95, 0.35], height: 0.8,
    legume: true, deepRoots: true, income: 2, approx: true,
    sources: ['guarWater', 'guarRotation'],
    note: 'Drought-tolerant summer legume (guar gum). FAO lists no guar values, so we used bean-like values checked against 400 mm measured at Maricopa.',
  },
  sesame: {
    name: 'Sesame', short: 'Sesame', family: 'Sesame', role: 'cash', color: '#a8967a',
    plant: [6, 20], stages: [20, 30, 40, 20], kc: [0.35, 1.10, 0.25], height: 1.0,
    income: 2, approx: true,
    sources: ['fao56'],
    note: 'Short summer oilseed. FAO stage lengths come from China, so timing here is approximate.',
  },
  wcover: {
    name: 'Winter legume cover', short: 'Winter cover', family: 'Legume', role: 'cover', color: '#9cc39a',
    plant: [11, 1], stages: [30, 40, 40, 20], kc: [0.40, 0.90, 0.85], height: 0.6,
    legume: true, income: 0, approx: true,
    sources: ['fao56'],
    note: 'Clover or vetch grown November to March to cover the soil and add nitrogen. Not harvested. Uses FAO clover values.',
  },
  scover: {
    name: 'Summer cowpea cover', short: 'Summer cover', family: 'Legume', role: 'cover', color: '#b6d3a5',
    plant: [7, 1], stages: [20, 30, 25, 0], kc: [0.40, 1.05, 0.60], height: 0.4,
    legume: true, income: 0, approx: true,
    sources: ['fao56'],
    note: 'Cowpeas grown July to mid September, then worked into the soil. Uses FAO cowpea values.',
  },
  fallow: {
    name: 'Bare fallow', short: 'Bare', family: 'None', role: 'fallow', color: '#ffffff',
    income: 0, approx: false, sources: [],
    note: 'No crop. Saves irrigation water but leaves the soil open to wind and sun.',
  },
};

// What can share a crop year. Winter part runs Nov-May, summer part Jun-Oct.
// Cotton is planted in April, so only a cover that ends by March can come before it.
export const WINTER = ['wheat', 'barley', 'wcover', 'fallow'];
export const SUMMER = ['sorghum', 'guar', 'sesame', 'scover', 'fallow'];
export const BEFORE_COTTON = ['wcover', 'fallow'];

// Crop-year month order, used everywhere: Nov, Dec, Jan ... Oct.
export const CY_MONTHS = [11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Published seasonal water use, used to sanity-check the model (inches).
export const REFERENCE_USE_IN = {
  alfalfa: 72, cotton: 41, wheat: 24, barley: 24, sorghum: 25, guar: 15.7,
};

// Rough area our planting calendar is written for.
export const CALENDAR_AREA = { name: 'central Arizona low desert', latMin: 32.0, latMax: 34.0, lonMin: -113.5, lonMax: -110.8 };
