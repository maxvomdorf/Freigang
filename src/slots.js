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
