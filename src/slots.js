// Pure helpers for the weekly plan (no database, so they can be tested from plain Node).
// A window belongs to the weekday it STARTS on; its end may run into the next day.
// Stored as minutes after local midnight of the start day: start 0..1439, end start+5 .. start+1435 (end > 1440 = next day).
export const DAY_MIN = 1440;
export const WEEK_MIN = 7 * DAY_MIN;

/** Takes time-of-day values as typed (start 0..1439, end 0..1440). End at or before start means "next day". Returns {start, end} or null. */
export function normalize(start, end) {
  if (![start, end].every(Number.isInteger)) return null;
  if (start % 5 || end % 5) return null;
  if (start < 0 || start >= DAY_MIN || end < 0 || end > DAY_MIN) return null;
  if (end === start) return null;
  if (end < start) end += DAY_MIN;
  return { start, end };
}

/** [from, to) in minutes since Monday 00:00. */
export const weekInterval = (s) => [s.weekday * DAY_MIN + s.start, s.weekday * DAY_MIN + s.end];

/** Do two windows overlap, including across the Sunday/Monday boundary? */
export function overlapsWeek(a, b) {
  const [a0, a1] = weekInterval(a), [b0, b1] = weekInterval(b);
  for (const shift of [-WEEK_MIN, 0, WEEK_MIN]) if (a0 < b1 + shift && a1 > b0 + shift) return true;
  return false;
}

/** Minutes until the window next starts, counted from now (weekday 0 = Monday, minutes after local midnight). 0 < result <= WEEK_MIN. */
export function minutesUntilStart(slot, weekday, minutes) {
  const d = ((slot.weekday * DAY_MIN + slot.start - (weekday * DAY_MIN + minutes)) % WEEK_MIN + WEEK_MIN) % WEEK_MIN;
  return d === 0 ? WEEK_MIN : d;
}

// ---- "Drinnen" entries: the cat will not be let out. Weekly (every week) or once (on one local date). ----
// Dates are local calendar dates as 'YYYY-MM-DD'. Calendar maths runs on UTC midnights, so DST never shifts a day.
const dayMs = 86400000;
const utcDay = (iso) => Date.parse(iso + 'T00:00:00Z');
/** The date `n` days after (or before, n < 0) a local date. */
export const addDays = (iso, n) => new Date(utcDay(iso) + n * dayMs).toISOString().slice(0, 10);
/** Weekday of a local date, 0 = Monday. */
export const weekdayOf = (iso) => (new Date(utcDay(iso)).getUTCDay() + 6) % 7;
/** The next date (today included) that falls on `weekday`. */
export const nextDate = (iso, weekday) => addDays(iso, (weekday - weekdayOf(iso) + 7) % 7);
/** Whole days between two local dates (b - a). */
export const daysBetween = (a, b) => Math.round((utcDay(b) - utcDay(a)) / dayMs);

/**
 * Which "Drinnen" entry covers local date `iso` at `minute` (minutes after local midnight)? Entries look like
 * { weekday, start, end, date } with date = null for weekly. An entry that runs past midnight (end > 1440) also covers the start of the next day.
 * Returns { until, whole } or null: `until` = minutes after midnight of `iso` when the cover ends (> 1440 means tomorrow),
 * `whole` = a full-day entry. With several matches the longest wins.
 */
export function insideAt(entries, iso, minute) {
  const wd = weekdayOf(iso), prev = addDays(iso, -1), pwd = (wd + 6) % 7;
  let best = null;
  const take = (until, whole) => { if (!best || until > best.until) best = { until, whole }; };
  for (const e of entries) {
    if (e.date ? e.date === iso : e.weekday === wd) {
      if (minute >= e.start && minute < e.end) take(e.end, e.start === 0 && e.end === DAY_MIN);
    }
    if (e.end > DAY_MIN && (e.date ? e.date === prev : e.weekday === pwd) && minute < e.end - DAY_MIN) take(e.end - DAY_MIN, false);
  }
  return best;
}
