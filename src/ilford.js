// "Ilford in Zahlen": pure functions that turn Ilford's events into totals, daily bars, streaks and records.
// No database access here, so everything can be tested from plain Node. The conflict log (stats.js) is untouched.
//
// Definitions (the app text and the tests rely on these):
// - Outing = an interval with status 'out'. 'soon' counts as inside. An open outing runs until `now` and is flagged `open`.
// - An outing is "unsicher" when it lasts longer than `staleMs` (the same "still outside?" threshold the cron nudge uses):
//   most likely nobody tapped "Wieder drin". Such outings and open ones never set a record and never count as "Längster Ausflug".
// - Totals window: rolling [now - N*24h, now]. The comparison window is the N*24h before it, same length.
//   Minutes are the overlap with the window; an outing is counted (number, median, longest) in the window it STARTS in.
// - Before Ilford's first event the status is UNKNOWN (not "inside"). So the comparison exists only once the first event lies at
//   or before the start of the comparison window; a current window that begins before the first event is averaged over the covered time.
// - Bars: local calendar days, oldest left, today right. Minutes of an outing are split at local midnight (DST-safe).
//   Today is partial ("bis jetzt") and, like the first (partly known) day, is left out of the average.
// - A day "with Freigang" has at least one minute outside. Streaks only look at decided days: all days before today, and today
//   once it has an outing. A today without an outing yet neither extends nor breaks a streak.
import { zoned, localToUtc, MIN, HOUR } from './util.js';
import { addDays, daysBetween } from './slots.js';
import { dayWeather, weatherGroups } from './weather.js';

const DAY = 24 * HOUR;
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const label = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const wdOf = (iso) => (new Date(Date.parse(iso + 'T00:00:00Z')).getUTCDay() + 6) % 7;
const mins = (ms) => Math.round(ms / MIN);

/**
 * Change against the comparison window: always the absolute difference, the percentage only when the baseline is not tiny
 * (`big`): under 1 h of total time or under 3 outings a "+300 %" says nothing. Typical/longest outing need only 15 minutes.
 */
const BASE_TOTAL_MIN = 60, BASE_COUNT = 3, BASE_OUTING_MIN = 15;
function delta(cur, prev, big) {
  if (cur == null || prev == null) return null;
  return { abs: cur - prev, pct: big && prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null };
}

/** Median in whole minutes; even counts take the mean of the two middle values. */
export function median(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b), m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

/** Out-intervals of one cat's events: [{ s, e, open }], e capped at `now`. Events: { id, ts, status }. */
export function outings(events, now) {
  const evs = [...events].sort((a, b) => a.ts - b.ts || a.id - b.id);
  const res = [];
  let start = null;
  for (const e of evs) {
    if (e.ts > now) break;
    if (e.status === 'out') {
      if (start === null) start = e.ts;
    } else if (start !== null) {
      if (e.ts > start) res.push({ s: start, e: e.ts, open: false });
      start = null;
    }
  }
  if (start !== null && now > start) res.push({ s: start, e: now, open: true });
  return res;
}

/** Overlap of the outings with [from, to] in ms. */
const overlap = (list, from, to) => list.reduce((sum, o) => sum + Math.max(0, Math.min(o.e, to) - Math.max(o.s, from)), 0);

/** Totals for one window. `known` = first event (nothing is known before it). */
function windowTotals(list, from, to, known, staleMs) {
  const a = Math.max(from, known);
  const coveredMs = Math.max(0, to - a);
  const ms = overlap(list, a, to);
  const started = list.filter((o) => o.s >= from && o.s < to);
  const finished = started.filter((o) => !o.open);
  const sure = finished.filter((o) => o.e - o.s <= staleMs);
  const longest = sure.reduce((best, o) => (!best || o.e - o.s > best.e - best.s ? o : best), null);
  const coveredDays = coveredMs / DAY;
  return {
    minutes: mins(ms),
    avgPerDay: coveredDays >= 1 ? Math.round(ms / MIN / coveredDays) : null,
    outings: started.length,
    median: median(finished.map((o) => mins(o.e - o.s))),
    longest: longest ? { minutes: mins(longest.e - longest.s), ts: longest.s } : null,
    uncertain: finished.length - sure.length,
    open: started.some((o) => o.open),
    coveredDays: +coveredDays.toFixed(2),
  };
}

/**
 * Calendar of local days from `firstDate` to today (plus the end of today) with their start instants.
 * Converting every midnight exactly costs two `zoned` calls a day, which adds up over years of history (Workers have ~10 ms CPU).
 * The UTC offset only changes at a DST switch, so it is converted exactly every 14 days; where both ends of such a stretch have the
 * same offset, the days between are plain 24-hour steps, otherwise (twice a year) they are converted one by one.
 */
export function dayStarts(firstDate, todayDate, tz) {
  const n = daysBetween(firstDate, todayDate) + 2;
  const base = Date.parse(firstDate + 'T00:00:00Z');
  const exact = (k) => {
    const d = new Date(base + k * DAY);
    return localToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, tz);
  };
  const start = new Array(n);
  start[0] = exact(0);
  for (let k0 = 0; k0 < n - 1;) {
    const k1 = Math.min(k0 + 14, n - 1);
    start[k1] = exact(k1);
    const off0 = base + k0 * DAY - start[k0], off1 = base + k1 * DAY - start[k1];
    for (let k = k0 + 1; k < k1; k++) start[k] = off0 === off1 ? base + k * DAY - off0 : exact(k);
    k0 = k1;
  }
  return start.map((t, k) => ({ iso: new Date(base + k * DAY).toISOString().slice(0, 10), start: t }));
}

/** Longest run of `flags` (true = streak day) and the run that ends at the last element. Days are the iso dates parallel to flags. */
function runs(flags, dates) {
  let best = { days: 0, from: null, to: null };
  let run = 0;
  for (let i = 0; i < flags.length; i++) {
    run = flags[i] ? run + 1 : 0;
    if (run && run >= best.days) best = { days: run, from: dates[i - run + 1], to: dates[i] };
  }
  const cur = run ? { days: run, from: dates[flags.length - run], to: dates[flags.length - 1] } : { days: 0, from: null, to: null };
  return { current: cur, best, isBest: cur.days > 0 && cur.days >= best.days };
}

/**
 * @param events  Ilford's events, whole history: { id, ts, status }
 * @param now     ms
 * @param days    7 or 30: length of the totals window and the number of bars
 * @param tz      IANA time zone
 * @param staleMs outings longer than this are "unsicher"
 * @param wx      optional hourly weather rows (src/weather.js), sorted by ts: adds the weather to the bars and the "Wetter" block
 * @param withDaily  also return one row per day since the first event (for the CSV)
 *
 * Weather and activity: only DECIDED days count (not today, not the first partly known day), without a doubtful outing
 * ("unsicher" or still open: the real time outside is unknown), and with a complete weather day. Days are grouped by their mean
 * temperature and by dry/wet/snow; a correlation (Spearman) appears only with enough days and enough spread (src/weather.js).
 */
export function ilfordStats({ events, now, days, tz, staleMs, wx = null, withDaily = false }) {
  const sorted = [...events].filter((e) => e.ts <= now).sort((a, b) => a.ts - b.ts || a.id - b.id);
  const base = { now, days, staleHours: +(staleMs / HOUR).toFixed(1) };
  if (!sorted.length) return { ...base, empty: true };

  const list = outings(sorted, now);
  const known = sorted[0].ts;
  const today = zoned(now, tz).date;
  const firstDate = zoned(known, tz).date;

  // ---- totals and comparison ----
  const span = days * DAY;
  const curFrom = now - span;
  const cur = windowTotals(list, curFrom, now, known, staleMs);
  const comparable = known <= now - 2 * span;
  const prev = comparable ? windowTotals(list, now - 2 * span, curFrom, known, staleMs) : null;
  let dl = null;
  if (prev) {
    const minutes = delta(cur.minutes, prev.minutes, prev.minutes >= BASE_TOTAL_MIN);
    const avgPerDay = delta(cur.avgPerDay, prev.avgPerDay, false);
    if (avgPerDay && minutes) avgPerDay.pct = minutes.pct; // equal-length windows: same relative change, without rounding noise
    dl = {
      minutes, avgPerDay,
      outings: delta(cur.outings, prev.outings, prev.outings >= BASE_COUNT),
      median: delta(cur.median, prev.median, (prev.median ?? 0) >= BASE_OUTING_MIN),
      longest: delta(cur.longest?.minutes ?? null, prev.longest?.minutes ?? null, (prev.longest?.minutes ?? 0) >= BASE_OUTING_MIN),
    };
  }

  // ---- one pass: split every outing over the local days ----
  const cal = dayStarts(firstDate, today, tz);
  const grid = cal.slice(0, -1).map((c, i) => ({ iso: c.iso, a: c.start, b: cal[i + 1].start, ms: 0, sureMs: 0, starts: 0, sureStarts: 0 }));
  let k = 0;
  for (const o of list) {
    while (k < grid.length - 1 && grid[k].b <= o.s) k++;
    const sure = !o.open && o.e - o.s <= staleMs;
    grid[k].starts++;
    if (sure) grid[k].sureStarts++;
    for (let j = k; j < grid.length && grid[j].a < o.e; j++) {
      const part = Math.min(o.e, grid[j].b) - Math.max(o.s, grid[j].a);
      if (part <= 0) continue;
      grid[j].ms += part;
      if (sure) grid[j].sureMs += part;
    }
  }
  grid.forEach((g, i) => {
    g.minutes = mins(g.ms);
    g.partial = g.iso === today;                 // today: "bis jetzt"
    g.first = i === 0 && known > g.a;            // first day: only known from the first event on
    g.full = !g.partial && !g.first;
  });

  // ---- weather per day (only when hourly rows exist) ----
  const wxd = wx && wx.length ? grid.map((g) => dayWeather(wx, g.a, g.b)) : null;
  const wxBrief = (w) => (w ? { tmin: w.tmin, tmax: w.tmax, tmean: w.tmean, precip: w.precip, kind: w.kind, complete: w.complete } : null);

  // ---- bars, average line, rolling 7-day average ----
  const shown = grid.slice(-days);
  const fullDays = shown.filter((g) => g.full);
  const avg = fullDays.length ? Math.round(fullDays.reduce((s, g) => s + g.minutes, 0) / fullDays.length) : null;
  const rolling = shown.map((g, j) => {
    const i = grid.length - shown.length + j;
    if (!g.full || i < 6) return null;
    let sum = 0;
    for (let q = i - 6; q <= i; q++) { if (!grid[q].full) return null; sum += grid[q].minutes; }
    return Math.round(sum / 7);
  });
  const bars = shown.map((g, j) => ({
    iso: g.iso, d: WD[wdOf(g.iso)], date: label(g.iso), minutes: g.minutes, outings: g.starts,
    partial: g.partial, first: g.first,
    ...(wxd ? { wx: wxBrief(wxd[grid.length - shown.length + j]) } : {}),
  }));

  // ---- weather and activity ----
  let weather = { has: false };
  if (wxd) {
    const counted = [], doubtful = [];
    grid.forEach((g, i) => {
      const w = wxd[i];
      if (!g.full || !w || !w.complete) return;
      if (g.ms !== g.sureMs) doubtful.push(g); else counted.push({ minutes: g.minutes, outings: g.starts, w });
    });
    const firstWx = zoned(wx[0].ts, tz).date;
    weather = { has: true, since: { iso: firstWx, label: label(firstWx) }, days: counted.length, skipped: doubtful.length, ...weatherGroups(counted) };
  }

  // ---- one row per day since the first event (CSV) ----
  const daily = withDaily ? grid.map((g, i) => ({
    iso: g.iso, wd: WD[wdOf(g.iso)], minutes: g.minutes, outings: g.starts,
    unsure: g.ms !== g.sureMs, partial: g.partial, first: g.first,
    wx: wxd?.[i] ?? null,
  })) : null;

  // ---- streaks (whole history) ----
  const decided = grid.filter((g) => !g.partial || g.minutes > 0);
  const dates = decided.map((g) => g.iso);
  const streaks = {
    out: runs(decided.map((g) => g.minutes > 0), dates),
    none: runs(decided.map((g) => g.minutes === 0), dates),
  };

  // ---- records (whole history), sure outings only ----
  const sureList = list.filter((o) => !o.open && o.e - o.s <= staleMs);
  const longest = sureList.reduce((best, o) => (!best || o.e - o.s > best.e - best.s ? o : best), null);
  const dayBest = (key) => grid.reduce((best, g) => (g[key] > 0 && (!best || g[key] > best[key]) ? g : best), null);
  const mostMs = dayBest('sureMs'), mostN = dayBest('sureStarts');
  // longest stretch inside: between two outings, and from the first event / the last outing to now
  let inside = null;
  const consider = (from, to, open) => {
    if (to > from && (!inside || to - from > inside.to - inside.from)) inside = { from, to, open };
  };
  if (sorted[0].status !== 'out') consider(known, list[0] ? list[0].s : now, !list[0]);
  list.forEach((o, i) => {
    if (i + 1 < list.length) consider(o.e, list[i + 1].s, false);
    else if (!o.open) consider(o.e, now, true);
  });
  const records = {
    longest: longest ? { minutes: mins(longest.e - longest.s), ts: longest.s, date: zoned(longest.s, tz).date } : null,
    mostMinutes: mostMs ? { minutes: mins(mostMs.sureMs), date: mostMs.iso } : null,
    mostOutings: mostN ? { count: mostN.sureStarts, date: mostN.iso } : null,
    longestInside: inside ? { minutes: mins(inside.to - inside.from), ts: inside.from, open: inside.open } : null,
  };

  return {
    ...base,
    empty: false,
    since: { iso: firstDate, label: label(firstDate), ts: known, covers: known <= curFrom },
    cur, prev, delta: dl,
    // the comparison switches on by itself: date from which it exists
    prevFrom: comparable ? null : label(zoned(known + 2 * span, tz).date),
    bars, avg, rolling,
    streaks, records,
    weather,
    ...(daily ? { daily } : {}),
  };
}
