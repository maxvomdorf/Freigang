// The weather job: fetches Open-Meteo and keeps weather_hours up to date. Runs from the minute cron, and on demand for admins.
// A failure here must never touch the notifications: index.js runs it separately, and everything below ends in a status, not an exception.
import { MIN } from './util.js';
import {
  API, STALE_NOW_MS, WeatherError, chunk, describe, fetchPlan, parseForecast, pastDaysFor, UPSERT_SQL, weatherUrl,
} from './weather.js';

const KEYS = "'wx_config', 'wx_status', 'wx_now'";
export const KV_SQL = `SELECT key, value FROM kv WHERE key IN (${KEYS})`;

/** kv rows → { config, status, now } (a broken row counts as missing). */
export function wxFromRows(rows) {
  const o = {};
  for (const r of rows || []) { try { o[r.key] = JSON.parse(r.value); } catch { /* ignore */ } }
  return { config: o.wx_config ?? null, status: o.wx_status ?? {}, now: o.wx_now ?? null };
}
export async function readWx(env) {
  const { results } = await env.DB.prepare(KV_SQL).all();
  return wxFromRows(results);
}

const put = (env, key, value, at) => env.DB.prepare(
  'INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3',
).bind(key, JSON.stringify(value), at);

/** What the app shows: the current reading (hidden when old) for everybody, the set-up details for admins. */
export function wxState(rows, now, admin) {
  const { config, status, now: cur } = wxFromRows(rows);
  const fresh = config && cur && now - cur.ts <= STALE_NOW_MS;
  const d = fresh ? describe(cur.code, cur.isDay) : null;
  return {
    weather: fresh ? { temp: cur.temp, feels: cur.feels, wind: cur.wind, precip: cur.precip, icon: d?.icon ?? 'cloud', text: d?.text ?? '', at: cur.ts } : null,
    weatherCfg: admin
      ? { configured: !!config, lat: config?.lat ?? null, lon: config?.lon ?? null, ok: status.ok ?? null, tried: status.tried ?? null, err: status.err ?? null }
      : undefined,
  };
}

/** Saves the (rounded) location and starts over: new status, so the next run fetches the whole history. A far-away new place drops the old hours. */
export async function setLocation(env, c, now) {
  const { config } = await readWx(env);
  const stmts = [];
  if (config && (Math.abs(config.lat - c.lat) > 0.2 || Math.abs(config.lon - c.lon) > 0.3)) stmts.push(env.DB.prepare('DELETE FROM weather_hours'));
  stmts.push(
    put(env, 'wx_config', c, now),
    put(env, 'wx_status', { ok: null, tried: null, err: null, backfilled: false }, now),
    env.DB.prepare("DELETE FROM kv WHERE key = 'wx_now'"),
  );
  await env.DB.batch(stmts);
}

async function claim(env, key, at) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO sent_keys (key, ts) VALUES (?, ?)').bind(key, at).run();
  return (r.meta?.changes ?? 0) === 1;
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new WeatherError(`http_${res.status}`);
  try { return await res.json(); } catch { throw new WeatherError('bad_response'); }
}

const errCode = (e) => {
  if (e instanceof WeatherError) return e.code;
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'timeout';
  return 'network';
};

/**
 * One run. Without a location nothing happens. `force` skips the "is it due" check (the admin's button and the first fetch after the
 * location was set). Returns { ok, rows } or { ok:false, error } or { ok:true, skipped }; the same goes into wx_status.
 */
export async function runWeather(env, now = Date.now(), { force = false } = {}) {
  const { config, status } = await readWx(env);
  if (!config) return { ok: false, skipped: 'no_location' };
  const plan = fetchPlan({ status, now, force });
  if (!plan.due) return { ok: true, skipped: 'not_due' };
  if (!force && !(await claim(env, `wx:${Math.floor(now / (5 * MIN))}`, now))) return { ok: true, skipped: 'claimed' };
  // Write the attempt first: a crash or a hang must not turn into one request per minute.
  const base = { ...status, tried: now };
  await put(env, 'wx_status', base, now).run();
  try {
    let pastDays = 2;
    if (plan.backfill) {
      const first = await env.DB.prepare('SELECT MIN(ts) AS t FROM events').first();
      pastDays = pastDaysFor(first?.t, now);
    }
    const json = await getJson(weatherUrl({ ...config, pastDays }, env.WEATHER_API || API));
    const { hours, current } = parseForecast(json, now);
    const stmts = chunk(hours, 240).map((c) => env.DB.prepare(UPSERT_SQL).bind(JSON.stringify(c)));
    stmts.push(put(env, 'wx_status', { ok: now, tried: now, err: null, backfilled: true }, now));
    if (current) stmts.push(put(env, 'wx_now', current, now));
    await env.DB.batch(stmts);
    return { ok: true, rows: hours.length };
  } catch (e) {
    const err = errCode(e);
    console.log('weather', String(e && e.message ? e.message : e).slice(0, 200));
    await put(env, 'wx_status', { ...base, err }, now).run().catch(() => {});
    return { ok: false, error: err };
  }
}

/** For the cron: never throws. */
export async function runWeatherSafe(env, now) {
  try { return await runWeather(env, now); } catch (e) { console.log('weather job', String(e && e.stack ? e.stack : e).slice(0, 300)); return null; }
}

