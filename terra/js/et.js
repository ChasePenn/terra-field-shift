// Reference evapotranspiration and crop canopy temperature.
// Pure functions shared by the browser, the data script and the tests.
//
// ET0 uses the FAO-56 Penman-Monteith equation (Allen et al. 1998, eq. 6) when
// NASA POWER gives us sunlight, humidity and wind for the day. If any of those
// is missing it falls back to Hargreaves (eq. 52), which needs only temperature.

export const DAY_MS = 86400000;

export function dayOfYear(y, m, d) {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / DAY_MS);
}

// FAO-56 eq. 21: extraterrestrial radiation, MJ m-2 day-1.
export function raMJ(latDeg, doy) {
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
  return ((24 * 60) / Math.PI) * 0.082 * dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
}

// Same thing as mm/day of evaporation (x 0.408), used by Hargreaves.
export function extraterrestrialRadiation(latDeg, doy) { return raMJ(latDeg, doy) * 0.408; }

export function hargreavesET0(tmax, tmin, raMm) {
  const range = Math.max(0, tmax - tmin);
  return Math.max(0, 0.0023 * raMm * ((tmax + tmin) / 2 + 17.8) * Math.sqrt(range));
}

// FAO-56 eq. 11: saturation vapour pressure, kPa.
export const esat = (t) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));

// FAO-56 eq. 6 with G = 0 for daily steps.
// o: { tmax, tmin, ea (kPa), rs (MJ m-2 day-1), u2 (m/s), z (m), lat, doy }
export function penmanMonteithET0(o) {
  const { tmax, tmin, ea, rs, u2, z, lat, doy } = o;
  const tmean = (tmax + tmin) / 2;
  const P = 101.3 * Math.pow((293 - 0.0065 * z) / 293, 5.26); // eq. 7
  const gamma = 0.000665 * P; // eq. 8
  const delta = (4098 * esat(tmean)) / Math.pow(tmean + 237.3, 2); // eq. 13
  const es = (esat(tmax) + esat(tmin)) / 2; // eq. 12
  const ra = raMJ(lat, doy);
  const rso = (0.75 + 2e-5 * z) * ra; // eq. 37
  const rns = 0.77 * rs; // eq. 38, albedo 0.23
  const sigma = 4.903e-9;
  const ratio = Math.min(1, rs / (rso || 1));
  const rnl = sigma * ((Math.pow(tmax + 273.16, 4) + Math.pow(tmin + 273.16, 4)) / 2) *
    (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) * (1.35 * ratio - 0.35); // eq. 39
  const rn = rns - rnl;
  const num = 0.408 * delta * rn + gamma * (900 / (tmean + 273)) * u2 * (es - ea);
  const den = delta + gamma * (1 + 0.34 * u2);
  return Math.max(0, num / den);
}

// One day of ET0 from whatever NASA POWER gave us.
// Returns { et0, method: 'pm' | 'hg' }.
export function dailyET0(day, lat, z, hgFactor = 1) {
  const doy = dayOfYear(day.y, day.m, day.d);
  const ok = (v) => v != null && Number.isFinite(v);
  if (ok(day.dew) && ok(day.rs) && ok(day.u2) && day.rs > 0) {
    return { et0: penmanMonteithET0({ tmax: day.tmax, tmin: day.tmin, ea: esat(Math.min(day.dew, day.tmin + 2)), rs: day.rs, u2: day.u2, z: z ?? 300, lat, doy }), method: 'pm' };
  }
  return { et0: hgFactor * hargreavesET0(day.tmax, day.tmin, extraterrestrialRadiation(lat, doy)), method: 'hg' };
}

// Daily mean vapour pressure deficit (kPa) from temperature and dew point,
// computed the same way for AZMET stations and NASA POWER points.
export function vpd(tmax, tmin, dew) {
  return Math.max(0, (esat(tmax) + esat(tmin)) / 2 - esat(dew));
}

// Cotton canopy temperature model. Coefficients are fitted by
// scripts/fetch-data.mjs to AZMET's own daily cotton canopy temperature
// (University of Arizona heat stress model) at Arizona farm stations, and
// shipped in data/validation.json. Fallback values below are from that fit.
export const CANOPY_DEFAULT = { a: 4.0, b: 0.84, c: -0.9 };
export function canopyTemp(tmax, tmin, dew, k = CANOPY_DEFAULT) {
  return k.a + k.b * ((tmax + tmin) / 2) + k.c * vpd(tmax, tmin, dew);
}
// University of Arizona thresholds (Brown, AZ1448): level 1 above 82.4°F (28°C),
// level 2 above 86°F (30°C) mean canopy temperature.
export const HEAT_L1_C = 28;
export const HEAT_L2_C = 30;
