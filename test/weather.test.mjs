// Unit tests for the weather rules: parsing the Open-Meteo answer, the day aggregation, the fetch schedule, and the groups/correlation
// that decide what the Ilford page may claim. Pure functions, fixed clock, no network.
import {
  parseForecast, parseCoords, validCoords, roundCoord, weatherUrl, describe, fetchPlan, pastDaysFor, dayWeather, weatherGroups, spearman,
  UPSERT_SQL, chunk, WeatherError, REFRESH_MS, RETRY_MS, MIN_BAND_DAYS, MIN_CORR_DAYS, MIN_CORR_RANGE, COLS,
} from '../src/weather.js';
import { ilfordStats, dayStarts } from '../src/ilford.js';

let failed = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; };
const throws = (f) => { try { f(); return null; } catch (e) { return e; } };

const H = 3600000, MIN = 60000, DAY = 24 * H;
const TZ = 'Europe/Berlin';

console.log('weather: location');
ok(roundCoord(52.40123) === 52.4 && roundCoord(12.5049) === 12.5 && roundCoord(12.505) === 12.51, 'rounded to 2 decimals (about 1 km)');
ok(JSON.stringify(parseCoords('52.4012, 12.5034')) === '{"lat":52.4,"lon":12.5}', 'as copied from a map app');
ok(JSON.stringify(parseCoords('52,40 12,50')) === '{"lat":52.4,"lon":12.5}', 'German decimal commas');
ok(JSON.stringify(parseCoords('52,40, 12,50')) === '{"lat":52.4,"lon":12.5}', 'commas as decimal sign and as separator');
ok(JSON.stringify(parseCoords(' -33.87 ; 151.21 ')) === '{"lat":-33.87,"lon":151.21}', 'negative numbers');
ok(parseCoords('52.4') === null && parseCoords('1 2 3') === null && parseCoords('') === null && parseCoords(null) === null, 'not exactly two numbers: nothing');
ok(parseCoords('91, 10') === null && parseCoords('10, 181') === null, 'out of range');
ok(validCoords(NaN, 1) === null && validCoords('52', '12') === null && validCoords(52.4, 12.5) !== null, 'only real numbers');
{
  const u = weatherUrl({ lat: 52.4, lon: 12.5, pastDays: 2 });
  ok(u.startsWith('https://api.open-meteo.com/v1/forecast?latitude=52.4&longitude=12.5'), 'the request goes to Open-Meteo');
  ok(u.includes('timeformat=unixtime') && u.includes('past_days=2') && u.includes('forecast_days=1') && !u.includes('models='), 'unix times, past days, no single model (nulls)');
  ok(!u.includes('visibility'), 'no visibility (DWD drops it after 30 Nov 2026)');
  ok(weatherUrl({ lat: 1, lon: 2, pastDays: 7 }, 'http://localhost:9/x').startsWith('http://localhost:9/x?'), 'the base URL can be replaced (tests, mirror)');
}

console.log('weather: parsing the answer');
const now = Date.UTC(2026, 10, 28, 9, 50);                    // 28 Nov 10:50 local
const h0 = Date.UTC(2026, 10, 28, 9, 0) / 1000;               // the hour that has just started (10:00 local)
const answer = (over = {}) => ({
  latitude: 52.4, longitude: 12.5, utc_offset_seconds: 0, timezone: 'GMT',
  current: { time: h0 + 3000, interval: 900, temperature_2m: 3.4, apparent_temperature: 0.9, weather_code: 3, is_day: 1, wind_speed_10m: 12.6, precipitation: 0 },
  hourly: {
    time: [h0 - 7200, h0 - 3600, h0, h0 + 3600, h0 + 7200],
    temperature_2m: [1.2, 2.0, 3.1, 4.0, 5.0],
    apparent_temperature: [-1, 0, 0.8, 2, 3],
    relative_humidity_2m: [90, 88.4, 85, 80, 75],
    precipitation: [0.2, 0, null, 0, 0],
    snowfall: [0, 0, 0, 0, 0],
    weather_code: [61, 3, 3, 2, 1],
    cloud_cover: [100, 100, 95, 60, 40],
    wind_speed_10m: [10, 11, 12.6, 14, 9],
    wind_gusts_10m: [20, 22, 25, 30, 18],
    sunshine_duration: [0, 0, 120.4, 900, 3600],
  },
  ...over,
});
{
  const { hours, current } = parseForecast(answer(), now);
  ok(hours.length === 3, 'only hours that have started are kept (the two forecast hours are dropped)');
  ok(hours[2][0] === h0 * 1000 && hours[2][1] === 3.1 && hours[2][6] === 3, 'row = ts in ms, then the values in column order');
  ok(hours[2][4] === null && hours[1][4] === 0, 'a missing value stays null; a real 0 stays 0');
  ok(hours[1][3] === 88 && hours[2][10] === 120, 'humidity and sunshine seconds are whole numbers');
  ok(hours.every((r) => r.length === COLS.length), 'every row has one value per column');
  ok(current.temp === 3.4 && current.feels === 0.9 && current.code === 3 && current.isDay === 1 && current.ts === (h0 + 3000) * 1000, 'the current reading');
}
{
  const a = answer(); delete a.hourly.wind_gusts_10m; delete a.hourly.snowfall;
  const { hours } = parseForecast(a, now);
  ok(hours[0][9] === null && hours[0][5] === null && hours[0][1] === 1.2, 'a variable the answer lacks is null, the rest is kept');
  const b = answer({ current: { time: h0, temperature_2m: null } });
  ok(parseForecast(b, now).current === null, 'no current temperature: no current reading (the hours still count)');
  const n = answer({ current: { time: h0, temperature_2m: 1, is_day: 0 } });
  ok(parseForecast(n, now).current.isDay === 0, 'night is kept');
}
{
  const e1 = throws(() => parseForecast({ error: true, reason: 'Latitude must be in range of -90 to 90°.' }, now));
  ok(e1 instanceof WeatherError && e1.code === 'api', 'an error answer is an error');
  ok(throws(() => parseForecast(null, now))?.code === 'bad_response', 'no answer');
  ok(throws(() => parseForecast({ hourly: {} }, now))?.code === 'bad_response', 'no hours');
  ok(throws(() => parseForecast({ hourly: { time: [h0 + 3600], temperature_2m: [5] } }, now))?.code === 'bad_response', 'only forecast hours: nothing to keep');
  ok(throws(() => parseForecast({ hourly: { time: [h0], temperature_2m: ['x'] } }, now))?.code === 'bad_response', 'values that are not numbers count as missing');
}

console.log('weather: texts');
ok(describe(0, 1).icon === 'sun' && describe(0, 0).icon === 'moon' && describe(2, 0).icon === 'partlynight', 'sun by day, moon by night');
ok(describe(63).text === 'Regen' && describe(73).icon === 'snow' && describe(95).icon === 'storm' && describe(45).icon === 'fog', 'the usual codes');
ok(describe(999).text === 'Wetter' && describe(null) === null && describe(undefined) === null, 'an unknown code is harmless, no code gives nothing');

console.log('weather: when to fetch');
{
  const t = Date.UTC(2026, 10, 28, 9, 0);
  ok(fetchPlan({ status: {}, now: t }).due && fetchPlan({ status: {}, now: t }).backfill, 'nothing yet: fetch, with the history');
  ok(!fetchPlan({ status: { ok: t - 10 * MIN, tried: t - 10 * MIN, backfilled: true }, now: t }).due, 'a good reading 10 minutes ago: not yet');
  ok(fetchPlan({ status: { ok: t - REFRESH_MS, tried: t - REFRESH_MS, backfilled: true }, now: t }).due, 'after 30 minutes: due');
  ok(!fetchPlan({ status: { ok: t - 2 * H, tried: t - 2 * MIN, err: 'timeout', backfilled: true }, now: t }).due, 'failed 2 minutes ago: wait');
  ok(fetchPlan({ status: { ok: t - 2 * H, tried: t - RETRY_MS, err: 'timeout', backfilled: true }, now: t }).due, 'failed 5 minutes ago: try again');
  ok(!fetchPlan({ status: { ok: null, tried: t - MIN, err: 'network', backfilled: false }, now: t }).due, 'first fetch failed a minute ago: wait');
  ok(fetchPlan({ status: { ok: null, tried: t - RETRY_MS, backfilled: false }, now: t }).backfill, 'and the retry is still the history fetch');
  ok(fetchPlan({ status: { ok: t - MIN, tried: t - MIN, backfilled: true }, now: t, force: true }).due, 'force always fetches');
  ok(!fetchPlan({ status: { ok: t, tried: t, backfilled: true }, now: t }).backfill, 'the history is fetched once');
  ok(pastDaysFor(undefined, t) === 7 && pastDaysFor(null, t) === 7, 'no event yet: a week');
  ok(pastDaysFor(t - 10 * DAY, t) === 11 && pastDaysFor(t - 2 * H, t) === 2 && pastDaysFor(t - 400 * DAY, t) === 92, 'back to the first event, at least 2 days, at most 92');
}

console.log('weather: SQL and chunks');
ok(UPSERT_SQL.includes('json_each(?1)') && UPSERT_SQL.includes('WHERE true') && (UPSERT_SQL.match(/\?/g) || []).length === 1, 'one JSON parameter, not one per value');
ok(UPSERT_SQL.includes('COALESCE(excluded.temp, weather_hours.temp)'), 'a null never overwrites a stored value');
ok(chunk([1, 2, 3, 4, 5], 2).length === 3 && chunk([], 5).length === 0 && chunk([1, 2], 5)[0].length === 2, 'chunks');

console.log('weather: one local day');
// Rows for the days 26 and 27 Nov (local = UTC+1). Temperature rises 1 K per hour from midnight 26th; precipitation 0.5 mm in the hour 23:00-24:00 of the 26th
// (stamped 00:00 on the 27th) and 2 mm in the hour 23:00-24:00 of the 27th (stamped 00:00 on the 28th).
const midnight = (d) => Date.UTC(2026, 10, d - 1, 23, 0);     // local midnight at the START of day d
const mk = (from, to, f) => { const out = []; for (let t = from; t <= to; t += H) out.push({ ts: t, temp: null, feels: null, hum: null, precip: null, snow: null, code: null, cloud: null, wind: null, gust: null, sun: null, ...f(t) }); return out; };
const a26 = midnight(26), a27 = midnight(27), a28 = midnight(28);
const rows = mk(a26, a28, (t) => ({
  temp: (t - a26) / H / 4, wind: 10, gust: t === a27 + 5 * H ? 40 : 15,
  precip: t === a27 ? 0.5 : t === a28 ? 2 : 0, snow: 0, sun: t === a27 + 12 * H ? 3600 : 0,
}));
{
  const d26 = dayWeather(rows, a26, a27), d27 = dayWeather(rows, a27, a28);
  ok(d26.n === 24 && d26.complete && d26.tmin === 0 && d26.tmax === 5.8, 'a whole day: 24 instants');
  ok(d26.tmean === 2.9, 'mean of the 24 hourly temperatures');
  ok(d26.precip === 0.5, 'the sum stamped at the NEXT midnight belongs to the day (the hour before it)');
  ok(d27.precip === 2 && d27.kind === 'wet', 'the 27th gets the 2 mm stamped at 00:00 on the 28th and none of the 26th (wet from 1 mm on)');
  ok(d26.kind === 'dry', 'under 1 mm: dry');
  ok(d27.sun === 1 && d27.gust === 40 && d27.wind === 10, 'sunshine hours, strongest gust and wind');
  const snowy = mk(a26, a27, (t) => ({ temp: -1, precip: 1.2, snow: t === a26 + 6 * H ? 0.4 : 0 }));
  ok(dayWeather(snowy, a26, a27).kind === 'snow', 'snow from 0.3 cm: snow rather than wet');
  const holes = rows.filter((r) => r.ts < a26 + 5 * H || r.ts > a26 + 8 * H);
  ok(dayWeather(holes, a26, a27).n === 20 && !dayWeather(holes, a26, a27).complete, 'four missing hours: not complete');
  ok(dayWeather(rows.filter((r) => r.ts !== a26 + 7 * H), a26, a27).complete, 'one or two missing hours are tolerated');
  ok(dayWeather([], a26, a27) === null && dayWeather(mk(a26, a27, () => ({})), a26, a27) === null, 'no temperature: nothing');
  const nosum = mk(a26, a27, () => ({ temp: 2 }));
  ok(dayWeather(nosum, a26, a27).kind === null && dayWeather(nosum, a26, a27).precip === null, 'no precipitation values: no kind (never "dry" by default)');
  // a day in the future is not complete
  ok(dayWeather(rows.filter((r) => r.ts <= a26 + 12 * H), a26, a27).complete === false, 'a day that is still running is not complete');
}
{
  // DST: Sunday 25 Oct 2026 has 25 hours, Sunday 29 Mar 2026 has 23
  const cal = dayStarts('2026-10-24', '2026-10-27', TZ);
  const a = cal.find((c) => c.iso === '2026-10-25').start, b = cal.find((c) => c.iso === '2026-10-26').start;
  ok((b - a) / H === 25, 'the day the clocks go back has 25 hours');
  const r = mk(a, b, () => ({ temp: 8 }));
  const d = dayWeather(r, a, b);
  ok(d.n === 25 && d.expected === 25 && d.complete, 'all 25 hours counted');
  const cal2 = dayStarts('2026-03-28', '2026-03-31', TZ);
  const a2 = cal2.find((c) => c.iso === '2026-03-29').start, b2 = cal2.find((c) => c.iso === '2026-03-30').start;
  ok((b2 - a2) / H === 23 && dayWeather(mk(a2, b2, () => ({ temp: 8 })), a2, b2).complete, 'the 23-hour day is complete with 23 values');
}

console.log('weather: ranks and correlation');
ok(Math.abs(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]) - 1) < 1e-9, 'perfectly rising: +1');
ok(Math.abs(spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10]) + 1) < 1e-9, 'perfectly falling: -1');
ok(Math.abs(spearman([1, 2, 3, 4, 5, 6], [1, 4, 9, 16, 25, 100]) - 1) < 1e-9, 'any rising order is +1 (ranks, not values)');
ok(spearman([1, 2, 3, 4], [5, 5, 5, 5]) === null && spearman([1, 2], [1, 2]) === null, 'no variation or too few values: nothing');
ok(Math.abs(spearman([1, 2, 3, 4], [1, 1, 2, 2]) - 0.894) < 0.001, 'ties share their rank');

console.log('weather: groups');
const day = (tmean, minutes, kind = 'dry', outings = 1) => ({ minutes, outings, w: { tmean, kind } });
{
  const days = [day(-2, 0), day(-1, 20), day(-3, 40), day(2, 60), day(3, 90), day(4, 120), day(6, 200), day(11, 300)];
  const g = weatherGroups(days);
  ok(g.bands.map((b) => b.days).join() === '3,3,1,1', 'days per temperature band');
  ok(g.bands[0].avgMinutes === 20 && g.bands[1].avgMinutes === 90, 'average minutes per day in a band');
  ok(g.bands[0].withFreigang === 67 && g.bands[1].withFreigang === 100, 'share of days with Freigang');
  ok(g.bands[2].avgMinutes === null && g.bands[3].avgMinutes === null && MIN_BAND_DAYS === 3, 'under 3 days: counted, but no numbers');
  ok(g.kinds.find((k) => k.id === 'dry').days === 8 && g.kinds.find((k) => k.id === 'wet').days === 0, 'dry/wet/snow');
  ok(g.corr === null && g.need.days === 8 && g.need.range === 14, 'no correlation with 8 days; the need is reported');
}
{
  const many = []; for (let i = 0; i < 24; i++) many.push(day(-2 + i * 0.5, i * 5));
  const g = weatherGroups(many);
  ok(g.corr && g.corr.r === 1 && g.corr.n === 24 && g.corr.range === 11.5, 'enough days and spread: Spearman correlation');
  const flat = []; for (let i = 0; i < 24; i++) flat.push(day(2 + (i % 5) * 0.5, i * 5));
  ok(weatherGroups(flat).corr === null && weatherGroups(flat).need.range === 2, 'a narrow temperature range: no correlation however many days');
  const few = []; for (let i = 0; i < MIN_CORR_DAYS - 1; i++) few.push(day(-5 + i, i));
  ok(weatherGroups(few).corr === null, '20 days: not yet');
  const edge = []; for (let i = 0; i < MIN_CORR_DAYS; i++) edge.push(day(i * (MIN_CORR_RANGE / (MIN_CORR_DAYS - 1)), i));
  ok(weatherGroups(edge).corr !== null, 'exactly 21 days and 8 K: enough');
  ok(weatherGroups([]).bands.every((b) => b.days === 0) && weatherGroups([]).need.range === 0, 'no days at all');
}

console.log('weather: in the Ilford numbers');
{
  // history: first event 10 days before `t`, a few outings; weather rows for the whole time
  const t = Date.UTC(2026, 10, 28, 11, 0);                    // Saturday 12:00 local
  const first = midnight(18) - 3 * H;                          // Wed 18 Nov, 22:00 local the evening before... = 17th 21:00 local
  const ev = [];
  let id = 1;
  const out = (from, hours) => { ev.push({ id: id++, ts: from, status: 'out' }, { id: id++, ts: from + hours * H, status: 'in' }); };
  ev.push({ id: id++, ts: first, status: 'in' });
  for (let d = 19; d <= 27; d++) out(midnight(d) + 10 * H, d % 2 ? 1 : 2);        // 1 h on odd days, 2 h on even days
  const wx = mk(midnight(17), t, (ts) => ({ temp: ((ts - midnight(17)) / DAY) % 2 < 1 ? 1 : 6, precip: 0, snow: 0 }));
  const s = ilfordStats({ events: ev, now: t, days: 7, tz: TZ, staleMs: 5 * H, wx });
  ok(s.weather.has && s.weather.days === 10, 'days with a complete weather day and a sure outing: the 10 decided whole days (18th to 27th; not the partly known first day, not today)');
  ok(s.bars.length === 7 && s.bars.every((b) => b.wx), 'the bars carry the weather of their day');
  ok(s.bars[6].partial && s.bars[6].wx.complete === false, 'today: partial weather, flagged not complete');
  ok(s.weather.since.iso === '2026-11-17', 'weather has been collected since this day');
  ok(s.weather.corr === null && s.weather.need.days === 10, 'ten days are not enough for a correlation');
  ok(s.weather.bands.reduce((n, b) => n + b.days, 0) === 10, 'every counted day is in exactly one band');
  const no = ilfordStats({ events: ev, now: t, days: 7, tz: TZ, staleMs: 5 * H });
  ok(no.weather.has === false && no.bars.every((b) => !('wx' in b)), 'without weather rows nothing changes for the bars');
  const none = ilfordStats({ events: ev, now: t, days: 7, tz: TZ, staleMs: 5 * H, wx: [] });
  ok(none.weather.has === false, 'an empty weather table: no weather block');
  // one doubtful outing (open for 8 h) takes its day out of the weather groups and says so
  const ev2 = ev.map((e) => ({ ...e }));
  const k = ev2.findIndex((e) => e.ts === midnight(22) + 10 * H);
  ev2[k + 1].ts = ev2[k].ts + 8 * H;
  const s2 = ilfordStats({ events: ev2, now: t, days: 7, tz: TZ, staleMs: 5 * H, wx });
  ok(s2.weather.days === 9 && s2.weather.skipped === 1, 'a day with an "unsicher" outing is left out and counted as skipped');
  // incomplete weather day (6 hours missing) is left out
  const holes = wx.filter((r) => r.ts < midnight(24) + 4 * H || r.ts > midnight(24) + 10 * H);
  ok(ilfordStats({ events: ev, now: t, days: 7, tz: TZ, staleMs: 5 * H, wx: holes }).weather.days === 9, 'a day with too few weather hours is left out');
  const d = ilfordStats({ events: ev, now: t, days: 7, tz: TZ, staleMs: 5 * H, wx, withDaily: true });
  ok(d.daily.length >= 11 && d.daily[0].iso === '2026-11-17' && d.daily[0].first === true, 'daily rows since the first event');
  ok(d.daily.at(-1).partial && d.daily.at(-1).iso === '2026-11-28', 'the last row is today, partial');
  ok(d.daily.find((r) => r.iso === '2026-11-20').minutes === 120 && d.daily.find((r) => r.iso === '2026-11-19').minutes === 60, 'minutes per day');
  ok(!('daily' in s), 'no daily rows unless asked for');
}

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
