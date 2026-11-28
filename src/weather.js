// Weather for Ilford's statistics: pure functions (no network, no database), so everything can be tested from plain Node.
//
// Source: Open-Meteo forecast API (open-meteo.com, free for non-commercial use, no key, data under CC BY 4.0 → the app names the source).
// Without `models=` it picks the best model for the place; in Germany that is DWD ICON-D2 (about 2 km grid), with ICON-EU/global behind it.
// This is MODEL data on a grid, not a measurement at a weather station. Past hours come from the model's own latest hours ("analysis").
//
// Time meaning of the hourly values (Open-Meteo documentation):
// - temperature, feels-like, humidity, wind, gusts, cloud cover and weather code are instant values AT the stamped time;
// - precipitation, snowfall and sunshine duration are sums over the PRECEDING hour: a value stamped T covers (T-1h, T].
// So for a local day [a, b) the instants are the stamps in [a, b) and the sums are the stamps in (a, b].
import { MIN, HOUR } from './util.js';

export const API = 'https://api.open-meteo.com/v1/forecast';
export const HOURLY = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'snowfall', 'weather_code', 'cloud_cover', 'wind_speed_10m', 'wind_gusts_10m', 'sunshine_duration'];
export const CURRENT = ['temperature_2m', 'apparent_temperature', 'weather_code', 'is_day', 'wind_speed_10m', 'precipitation'];
/** Column order of the rows produced by parseForecast and of weather_hours (after ts). */
export const COLS = ['ts', 'temp', 'feels', 'hum', 'precip', 'snow', 'code', 'cloud', 'wind', 'gust', 'sun'];

export const REFRESH_MS = 30 * MIN;      // a good reading is refreshed after this long
export const RETRY_MS = 5 * MIN;         // a failed or unfinished attempt is repeated after this long
export const STALE_NOW_MS = 2 * HOUR;    // the display on the main page hides a reading older than this
export const MAX_PAST_DAYS = 92;         // what Open-Meteo's forecast API offers
const DAY = 24 * HOUR;

export class WeatherError extends Error {
  constructor(code, detail = '') { super(detail ? `${code}: ${detail}` : code); this.code = code; }
}

// ---------- location ----------

/** The location is stored with 2 decimals (about 1 km): enough for the weather, not the front door. */
export const roundCoord = (v) => Math.round(v * 100) / 100;

export function validCoords(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: roundCoord(lat), lon: roundCoord(lon) };
}

/** "52.4012, 12.5034" (as copied from a map app) or "52,40 12,50": exactly two numbers, comma or dot as the decimal sign. */
export function parseCoords(text) {
  const nums = String(text ?? '').match(/-?\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length !== 2) return null;
  const [lat, lon] = nums.map((s) => Number(s.replace(',', '.')));
  return validCoords(lat, lon);
}

// ---------- request and response ----------

export function weatherUrl({ lat, lon, pastDays }, base = API) {
  const q = [
    `latitude=${lat}`, `longitude=${lon}`,
    `current=${CURRENT.join(',')}`, `hourly=${HOURLY.join(',')}`,
    `past_days=${pastDays}`, 'forecast_days=1', 'timeformat=unixtime', 'wind_speed_unit=kmh',
  ];
  return `${base}?${q.join('&')}`;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v) => (num(v) === null ? null : Math.round(v));

/**
 * Open-Meteo answer → { hours, current }. hours = rows in COLS order for every hour that has started (stamp <= now): the future hours
 * are forecasts and are not kept. A missing value stays null, never 0. Throws WeatherError on an error answer or a broken one.
 */
export function parseForecast(json, now) {
  if (!json || typeof json !== 'object') throw new WeatherError('bad_response');
  if (json.error) throw new WeatherError('api', String(json.reason || '').slice(0, 80));
  const h = json.hourly;
  if (!h || !Array.isArray(h.time) || !h.time.length) throw new WeatherError('bad_response');
  const col = (name) => (Array.isArray(h[name]) ? h[name] : []);
  const c = Object.fromEntries(HOURLY.map((n) => [n, col(n)]));
  const hours = [];
  h.time.forEach((sec, i) => {
    const ts = Number(sec) * 1000;
    if (!Number.isFinite(ts) || ts > now) return;
    const row = [
      ts, num(c.temperature_2m[i]), num(c.apparent_temperature[i]), int(c.relative_humidity_2m[i]), num(c.precipitation[i]), num(c.snowfall[i]),
      int(c.weather_code[i]), int(c.cloud_cover[i]), num(c.wind_speed_10m[i]), num(c.wind_gusts_10m[i]), int(c.sunshine_duration[i]),
    ];
    if (row.slice(1).some((v) => v !== null)) hours.push(row);
  });
  if (!hours.length) throw new WeatherError('bad_response');
  let current = null;
  const k = json.current;
  if (k && typeof k === 'object') {
    const ts = Number(k.time) * 1000, temp = num(k.temperature_2m);
    if (Number.isFinite(ts) && temp !== null) {
      current = { ts, temp, feels: num(k.apparent_temperature), code: int(k.weather_code), isDay: k.is_day === 0 ? 0 : 1, wind: num(k.wind_speed_10m), precip: num(k.precipitation) };
    }
  }
  return { hours, current };
}

// WMO weather code → short German text and an icon name (the app draws the icon).
const WMO = {
  0: ['Klar', 'sun'], 1: ['Überwiegend klar', 'sun'], 2: ['Teils bewölkt', 'partly'], 3: ['Bedeckt', 'cloud'],
  45: ['Nebel', 'fog'], 48: ['Raureifnebel', 'fog'],
  51: ['Leichter Nieselregen', 'drizzle'], 53: ['Nieselregen', 'drizzle'], 55: ['Starker Nieselregen', 'drizzle'],
  56: ['Gefrierender Nieselregen', 'drizzle'], 57: ['Gefrierender Nieselregen', 'drizzle'],
  61: ['Leichter Regen', 'rain'], 63: ['Regen', 'rain'], 65: ['Starker Regen', 'rain'], 66: ['Gefrierender Regen', 'rain'], 67: ['Gefrierender Regen', 'rain'],
  71: ['Leichter Schneefall', 'snow'], 73: ['Schneefall', 'snow'], 75: ['Starker Schneefall', 'snow'], 77: ['Schneegriesel', 'snow'],
  80: ['Leichte Regenschauer', 'rain'], 81: ['Regenschauer', 'rain'], 82: ['Heftige Regenschauer', 'rain'],
  85: ['Schneeschauer', 'snow'], 86: ['Starke Schneeschauer', 'snow'],
  95: ['Gewitter', 'storm'], 96: ['Gewitter mit Hagel', 'storm'], 99: ['Gewitter mit Hagel', 'storm'],
};
export function describe(code, isDay = 1) {
  if (!Number.isFinite(code)) return null;
  const [text, icon] = WMO[code] ?? ['Wetter', 'cloud'];
  if (isDay === 0 && icon === 'sun') return { text, icon: 'moon' };
  if (isDay === 0 && icon === 'partly') return { text, icon: 'partlynight' };
  return { text, icon };
}

// ---------- when to fetch ----------

/**
 * status = { ok, tried, err, backfilled } (all optional). A good reading is refreshed every REFRESH_MS; after a failure (or a first
 * unfinished attempt) the next try comes after RETRY_MS. `force` is the admin's "Jetzt abrufen". backfill = nothing fetched yet:
 * take the history back to Ilford's first event at once.
 */
export function fetchPlan({ status, now, force = false }) {
  const s = status || {};
  const backfill = !s.backfilled;
  if (force) return { due: true, backfill };
  if (s.tried && now - s.tried < RETRY_MS) return { due: false, backfill };
  if (s.ok && s.backfilled && now - s.ok < REFRESH_MS) return { due: false, backfill };
  return { due: true, backfill };
}

/** past_days for the first fetch: back to the day of the first event (and one more), at most what the API offers. */
export function pastDaysFor(firstTs, now) {
  if (!Number.isFinite(firstTs)) return 7;
  return Math.min(MAX_PAST_DAYS, Math.max(2, Math.ceil((now - firstTs) / DAY) + 1));
}

/** One statement for many rows: the rows travel as ONE JSON array parameter (D1 allows only 100 bound parameters per statement). */
export const UPSERT_SQL = `INSERT INTO weather_hours (${COLS.join(', ')})
SELECT ${COLS.map((_, i) => `json_extract(value, '$[${i}]')`).join(', ')} FROM json_each(?1) WHERE true
ON CONFLICT(ts) DO UPDATE SET ${COLS.slice(1).map((c) => `${c} = COALESCE(excluded.${c}, weather_hours.${c})`).join(', ')}`;

export const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

// ---------- aggregation per local day ----------

const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
function lowerBound(rows, x) {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (rows[m].ts < x) lo = m + 1; else hi = m; }
  return lo;
}
export const SNOW_CM = 0.3, WET_MM = 1;

/**
 * Weather of the local day [a, b) from hourly rows ({ts, temp, ...}, sorted by ts). Instants: stamps in [a, b). Sums: stamps in (a, b].
 * complete = at most 2 hours without a temperature (DST days have 23 or 25 hours). kind: 'snow' / 'wet' / 'dry' from the sums, null without them.
 * Returns null when the day has no temperature at all.
 */
export function dayWeather(rows, a, b) {
  let n = 0, sum = 0, tmin = null, tmax = null, wind = null, gust = null;
  for (let i = lowerBound(rows, a); i < rows.length && rows[i].ts < b; i++) {
    const r = rows[i];
    if (r.temp !== null) { n++; sum += r.temp; tmin = tmin === null ? r.temp : Math.min(tmin, r.temp); tmax = tmax === null ? r.temp : Math.max(tmax, r.temp); }
    if (r.wind !== null) wind = wind === null ? r.wind : Math.max(wind, r.wind);
    if (r.gust !== null) gust = gust === null ? r.gust : Math.max(gust, r.gust);
  }
  if (!n) return null;
  let precip = 0, snow = 0, sun = 0, np = 0, ns = 0, nsun = 0;
  for (let i = lowerBound(rows, a + 1); i < rows.length && rows[i].ts <= b; i++) {
    const r = rows[i];
    if (r.precip !== null) { precip += r.precip; np++; }
    if (r.snow !== null) { snow += r.snow; ns++; }
    if (r.sun !== null) { sun += r.sun; nsun++; }
  }
  const expected = Math.round((b - a) / HOUR);
  const kind = np ? (ns && snow >= SNOW_CM ? 'snow' : precip >= WET_MM ? 'wet' : 'dry') : null;
  return {
    n, expected, complete: n >= expected - 2,
    tmin: r1(tmin), tmax: r1(tmax), tmean: r1(sum / n),
    precip: np ? r1(precip) : null, snow: ns ? r1(snow) : null, sun: nsun ? r1(sun / 3600) : null,
    wind: r1(wind), gust: r1(gust), kind,
  };
}

// ---------- weather and activity ----------

export const BANDS = [
  { id: 'b0', label: 'unter 0°', lo: -Infinity, hi: 0 },
  { id: 'b1', label: '0 bis 5°', lo: 0, hi: 5 },
  { id: 'b2', label: '5 bis 10°', lo: 5, hi: 10 },
  { id: 'b3', label: 'ab 10°', lo: 10, hi: Infinity },
];
export const KINDS = [{ id: 'dry', label: 'trocken' }, { id: 'wet', label: 'nass' }, { id: 'snow', label: 'Schnee' }];
export const MIN_BAND_DAYS = 3;            // a group shows numbers from this many days on
export const MIN_CORR_DAYS = 21;           // a correlation needs this many decided days ...
export const MIN_CORR_RANGE = 8;           // ... and at least this much spread (K) in the daily mean temperature

/** Average ranks (ties share the mean rank). */
function ranks(v) {
  const order = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
  const out = new Array(v.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}
/** Spearman rank correlation, robust against the skewed minutes; null when one side does not vary at all. */
export function spearman(xs, ys) {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const a = ranks(xs), b = ranks(ys), n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
}

/**
 * days = [{ minutes, outings, w }] for the days that count (decided, whole, no doubtful outing, weather complete).
 * Groups by the day's mean temperature and by dry/wet/snow, plus a correlation once there are enough days with enough spread.
 */
export function weatherGroups(days) {
  const group = (list) => {
    const n = list.length;
    if (n < MIN_BAND_DAYS) return { days: n, avgMinutes: null, avgOutings: null, withFreigang: null };
    return {
      days: n,
      avgMinutes: Math.round(list.reduce((s, d) => s + d.minutes, 0) / n),
      avgOutings: Math.round((list.reduce((s, d) => s + d.outings, 0) / n) * 10) / 10,
      withFreigang: Math.round((list.filter((d) => d.minutes > 0).length / n) * 100),
    };
  };
  const bands = BANDS.map((b) => ({ id: b.id, label: b.label, ...group(days.filter((d) => d.w.tmean >= b.lo && d.w.tmean < b.hi)) }));
  const kinds = KINDS.map((k) => ({ id: k.id, label: k.label, ...group(days.filter((d) => d.w.kind === k.id)) }));
  const temps = days.map((d) => d.w.tmean);
  const range = temps.length ? Math.round((Math.max(...temps) - Math.min(...temps)) * 10) / 10 : 0;
  const need = { days: days.length, minDays: MIN_CORR_DAYS, range, minRange: MIN_CORR_RANGE };
  let corr = null;
  if (days.length >= MIN_CORR_DAYS && range >= MIN_CORR_RANGE) {
    const r = spearman(temps, days.map((d) => d.minutes));
    if (r !== null) corr = { r: Math.round(r * 100) / 100, n: days.length, range };
  }
  return { bands, kinds, corr, need, minBandDays: MIN_BAND_DAYS };
}
