// MODIS NDVI read straight from NASA GIBS map images. GIBS colors each NDVI
// step with its own exact color (see the published colormap), so the pixel
// color over a field decodes back to the NDVI value. Works in the browser and
// in Node. Layer: MODIS_Terra_L3_NDVI_16Day (MOD13 16-day, 250 m).

export const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
export const GIBS_COLORMAP = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_NDVI.xml';
export const NDVI_LAYER = 'MODIS_Terra_L3_NDVI_16Day';

export function parseColormap(xml) {
  const map = new Map();
  for (const m of xml.matchAll(/<ColorMapEntry rgb="(\d+),(\d+),(\d+)"([^>]*)>/g)) {
    if (/transparent="true"/.test(m[4])) continue;
    const v = m[4].match(/value="\[([-\d.]+),([-\d.]+)\)"/);
    if (v) map.set(`${m[1]},${m[2]},${m[3]}`, Math.round(((+v[1] + +v[2]) / 2) * 1000) / 1000);
  }
  return map;
}

// MOD13 16-day composite start dates (day of year 1, 17, 33 ...).
export function compositeDates(fromYear, toYear) {
  const out = [];
  for (let y = fromYear; y <= toYear; y++) for (let doy = 1; doy <= 353; doy += 16) out.push(new Date(Date.UTC(y, 0, doy)).toISOString().slice(0, 10));
  return out;
}

// 3 x 3 pixel image centred on the point; the centre pixel is about 250 m.
export function ndviUrl(lat, lon, date) {
  const d = 0.0035;
  return `${GIBS_WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${NDVI_LAYER}&STYLES=&CRS=EPSG:4326&BBOX=${(lat - d).toFixed(5)},${(lon - d).toFixed(5)},${(lat + d).toFixed(5)},${(lon + d).toFixed(5)}&WIDTH=3&HEIGHT=3&FORMAT=image/png&TIME=${date}`;
}

export function decodeColor(map, r, g, b, a) {
  if (!a) return null;
  return map.get(`${r},${g},${b}`) ?? null;
}
