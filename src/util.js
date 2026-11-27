// Shared helpers: people, cats, time zone maths, small formatters.

export const CATS = ['ilford', 'bonnie'];
export const CAT_NAME = { ilford: 'Ilford', bonnie: 'Bonnie' };
export const otherCat = (c) => (c === 'ilford' ? 'bonnie' : 'ilford');

// The household roster. Two cats, several people per cat. Everyone switches only their own cat and sees both.
// Maxime and Janin (Ilford) are admins: they see the log and add notes. Every person has a Worker secret `secret` holding their personal code.
// scripts/ import this list too, so a new person only has to be added here.
export const PEOPLE = {
  maxime: { user: 'maxime', name: 'Maxime', cat: 'ilford', admin: true, secret: 'TOKEN_MAXIME' },
  janin: { user: 'janin', name: 'Janin', cat: 'ilford', admin: true, secret: 'TOKEN_JANIN' },
  kathrin: { user: 'kathrin', name: 'Kathrin', cat: 'bonnie', admin: false, secret: 'TOKEN_KATHRIN' },
  linus: { user: 'linus', name: 'Linus', cat: 'bonnie', admin: false, secret: 'TOKEN_LINUS' },
  oskar: { user: 'oskar', name: 'Oskar', cat: 'bonnie', admin: false, secret: 'TOKEN_OSKAR' },
  annalena: { user: 'annalena', name: 'Anna-Lena', cat: 'bonnie', admin: false, secret: 'TOKEN_ANNALENA' },
};
/** User keys of everyone who looks after a cat. */
export const peopleOfCat = (cat) => Object.values(PEOPLE).filter((p) => p.cat === cat).map((p) => p.user);
/** The name shown for "the other side", whoever is looking: Ilford's side always sees Kathrin, Bonnie's side Maxime. */
export const OTHER_NAME = { ilford: 'Kathrin', bonnie: 'Maxime' };

// Feeding tracker: only Bonnie's household uses it. Ilford's people never see it and never get its pushes.
export const FEED_CAT = 'bonnie';
export const FEED_HINT_MIN = 60; // fed less than this long ago: ask before entering another feeding
export const FEED_UNDO_MIN = 10; // you can take back your own entry for this long

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

/** After how long an outing is probably a forgotten "Wieder drin": the cron nudge and the Ilford statistics use the same value. */
export const staleMsOf = (env) => numVar(env.STALE_HOURS, 5) * HOUR;
