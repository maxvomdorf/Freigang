// Shared helpers: people, cats, time zone maths, small formatters.

export const CATS = ['ilford', 'bonnie'];
export const CAT_NAME = { ilford: 'Ilford', bonnie: 'Bonnie' };
export const otherCat = (c) => (c === 'ilford' ? 'bonnie' : 'ilford');

// Exactly two people. Maxime owns Ilford and is the admin; Kathrin owns Bonnie.
export const PEOPLE = {
  maxime: { user: 'maxime', name: 'Maxime', cat: 'ilford', admin: true, secret: 'TOKEN_MAXIME' },
  kathrin: { user: 'kathrin', name: 'Kathrin', cat: 'bonnie', admin: false, secret: 'TOKEN_KATHRIN' },
};
export const userOfCat = (cat) => (cat === 'ilford' ? 'maxime' : 'kathrin');

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const MIN = 60000;
export const HOUR = 3600000;

// ---- time zone maths (DST-safe, no hard-coded offsets) ----

const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const fmtCache = new Map();
function dtf(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(
      tz,
      new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hourCycle: 'h23', weekday: 'short',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }),
    );
  }
  return fmtCache.get(tz);
}

/** Local calendar parts of an instant in a time zone. weekday: 0 = Monday. */
export function zoned(ts, tz) {
  const o = {};
  for (const p of dtf(tz).formatToParts(new Date(ts))) o[p.type] = p.value;
  return {
    year: +o.year, month: +o.month, day: +o.day, hour: +o.hour, minute: +o.minute, second: +o.second,
    weekday: WD[o.weekday],
    minutes: +o.hour * 60 + +o.minute,
    date: `${o.year}-${o.month}-${o.day}`,
  };
}

/** UTC instant for a local wall-clock time (month 1-12). Handles DST changes. */
export function localToUtc(year, month, day, hour, minute, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (t) => {
    const z = zoned(t, tz);
    return Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second) - Math.floor(t / 1000) * 1000;
  };
  let utc = guess - offsetAt(guess);
  utc = guess - offsetAt(utc);
  return utc;
}

export function hhmm(ts, tz) {
  const z = zoned(ts, tz);
  return String(z.hour).padStart(2, '0') + ':' + String(z.minute).padStart(2, '0');
}

export function durText(ms) {
  const m = Math.round(ms / MIN);
  if (m <= 0) return 'gerade eben';
  const h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h} Std ${mm} Min` : `${m} Min`;
}

export function isQuiet(hour, start, end) {
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

export function numVar(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
