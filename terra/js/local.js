// Arizona-specific checks: groundwater rules, nearby wells and what the
// satellite saw on the field. Pure functions, used by the app and the tests.

import { occupiedMonths } from './engine.js';
import { CY_MONTHS } from './crops.js';

// ---------- groundwater management areas (ADWR) ----------

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPolygon(lon, lat, poly) {
  if (!inRing(lon, lat, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (inRing(lon, lat, poly[k])) return false;
  return true;
}
export function findArea(geo, lat, lon) {
  if (!geo?.features) return null;
  for (const f of geo.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    if (polys.some((p) => inPolygon(lon, lat, p))) return f.properties.name;
  }
  return null;
}

// What each area means for an irrigator, in plain words. Dates from ADWR.
export const AREA_FACTS = {
  'PHOENIX AMA': { kind: 'ama', since: 1980 },
  'PINAL AMA': { kind: 'ama', since: 1980 },
  'TUCSON AMA': { kind: 'ama', since: 1980 },
  'PRESCOTT AMA': { kind: 'ama', since: 1980 },
  'SANTA CRUZ AMA': { kind: 'ama', since: 1994 },
  'DOUGLAS AMA': { kind: 'ama', since: 2022, story: 'douglas' },
  'WILLCOX AMA': { kind: 'ama', since: 2024, story: 'willcox' },
  'RANEGRAS PLAIN AMA': { kind: 'ama', since: 2026, story: 'ranegras' },
  'HARQUAHALA INA': { kind: 'ina', since: 1981 },
  'JOSEPH CITY INA': { kind: 'ina', since: 1980 },
  'HUALAPAI VALLEY INA': { kind: 'ina', since: 2022 },
};
export const GW_SOURCES = [
  { label: 'ADWR, AMA and INA boundaries (2024 service, includes Willcox and Ranegras Plain)', url: 'https://azwatermaps.azwater.gov/arcgis/rest/services/General/AMA_and_INA_2024/FeatureServer/0' },
  { label: 'ADWR: Willcox Groundwater Basin designated Arizona’s seventh AMA (Dec 2024), after voters rejected one in 2022', url: 'https://www.western-water.com/2024/12/23/willcox-groundwater-basin-designated-an-az-active-management-area/' },
  { label: 'ADWR: Ranegras Plain becomes Arizona’s eighth AMA (Jan 2026)', url: 'https://www.azwater.gov/node/6225' },
  { label: 'USGS Water Data API, field measurements of depth to groundwater (includes ADWR data)', url: 'https://api.waterdata.usgs.gov/ogcapi/v0/collections/field-measurements' },
];

// ---------- nearby wells ----------

// Each well: { series: [[year, depthFt], ...] }. Returns the typical change in
// depth to water, in feet per decade (positive = water table falling), using
// each well's own Theil-Sen slope and taking the median across wells.
export function wellTrend(wells, fromYear = 2005) {
  if (!wells?.length) return null;
  const slopes = [];
  const depths = [];
  for (const w of wells) {
    const pts = w.series.filter(([y]) => y >= fromYear);
    if (pts.length < 4 || pts[pts.length - 1][0] - pts[0][0] < 8) continue;
    const s = [];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) s.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
    slopes.push(median(s));
    depths.push(pts[pts.length - 1][1]);
  }
  if (!slopes.length) return null;
  return { wells: slopes.length, perDecadeFt: median(slopes) * 10, latestDepthFt: median(depths), falling: slopes.filter((x) => x > 0).length };
}

// The single nearby well with the longest record since fromYear, for a chart.
// (Averaging wells of different depths makes a zigzag that means nothing.)
export function wellSeries(wells, fromYear = 2000) {
  let best = [];
  for (const w of wells || []) {
    const pts = w.series.filter(([y]) => y >= fromYear);
    if (pts.length > best.length) best = pts;
  }
  return best;
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------- satellite check ----------

// NDVI above this means a growing crop in irrigated desert fields; bare
// desert soil sits near 0.1 to 0.15 (MODIS MOD13Q1 user guide ranges).
export const GREEN_NDVI = 0.3;

// Compare what the farmer said they grow with what MODIS saw, month by month
// (crop-year order Nov..Oct). Returns months where they disagree most years.
// rows: [['YYYY-MM-DD', ndvi], ...]
export function satelliteCheck(rows, rotation, types) {
  if (!rows || rows.length < 40) return null;
  const greenYears = Array.from({ length: 12 }, () => new Map());
  for (const [date, v] of rows) {
    const y = +date.slice(0, 4), m = +date.slice(5, 7);
    const k = CY_MONTHS.indexOf(m);
    const cy = m >= 11 ? y + 1 : y;
    const map = greenYears[k];
    const cur = map.get(cy) || { g: 0, n: 0 };
    cur.n++; if (v >= GREEN_NDVI) cur.g++;
    map.set(cy, cur);
  }
  // Share of years each month looked green (majority of composites green).
  const sat = greenYears.map((map) => {
    const ys = [...map.values()].filter((o) => o.n);
    return ys.length ? ys.filter((o) => o.g / o.n >= 0.5).length / ys.length : null;
  });
  // Share of rotation years with a crop in that month, per the farmer's answer.
  const said = Array(12).fill(0);
  for (const id of rotation) {
    const t = types.find((x) => x.id === id);
    const occ = new Set(t.parts.flatMap((c) => occupiedMonths(c)));
    for (let k = 0; k < 12; k++) if (occ.has(k)) said[k] += 1 / rotation.length;
  }
  const bareButSaid = [], greenButSaid = [];
  for (let k = 0; k < 12; k++) {
    if (sat[k] == null) continue;
    if (said[k] >= 0.99 && sat[k] <= 0.25) bareButSaid.push(CY_MONTHS[k]);
    if (said[k] <= 0.01 && sat[k] >= 0.75) greenButSaid.push(CY_MONTHS[k]);
  }
  const years = new Set(rows.map(([d]) => d.slice(0, 4))).size;
  return { sat, said, bareButSaid, greenButSaid, years, agrees: !bareButSaid.length && !greenButSaid.length };
}
