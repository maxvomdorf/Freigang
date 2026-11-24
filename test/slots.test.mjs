// Unit tests for the weekly plan maths (pure, no server needed).
import { readFileSync } from 'node:fs';
import { normalize, overlapsWeek, minutesUntilStart, DAY_MIN, addDays, weekdayOf, nextDate, daysBetween, insideAt } from '../src/slots.js';

let failed = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; };
const t = (h, m = 0) => h * 60 + m;
const slot = (weekday, s, e) => { const n = normalize(s, e); return { weekday, ...n }; };

console.log('slots');
ok(JSON.stringify(normalize(t(16), t(17))) === JSON.stringify({ start: 960, end: 1020 }), 'same-day window unchanged');
ok(normalize(t(22), t(2))?.end === t(26), 'end before start runs into the next day (22:00–02:00)');
ok(normalize(t(0, 5), t(0, 30)) !== null, 'night window 00:05–00:30 accepted');
ok(normalize(t(23), t(24))?.end === t(24), 'end at 24:00 accepted');
ok(normalize(t(10), t(10)) === null, 'equal times rejected');
ok(normalize(t(10, 3), t(11)) === null, 'not a 5-minute step rejected');
ok(normalize(-5, t(1)) === null && normalize(t(24), t(1)) === null, 'start outside a day rejected');
ok(normalize(t(10), t(9, 55))?.end - t(10) === 1435, 'longest window is 23 h 55 min');

ok(overlapsWeek(slot(0, t(22), t(2)), slot(1, t(1), t(3))), 'Mon 22–02 overlaps Tue 01–03');
ok(!overlapsWeek(slot(0, t(22), t(2)), slot(1, t(2), t(3))), 'touching windows do not overlap');
ok(overlapsWeek(slot(6, t(23), t(1)), slot(0, t(0, 30), t(1, 30))), 'Sun 23–01 overlaps Mon 00:30–01:30 (week wraps)');
ok(!overlapsWeek(slot(2, t(8), t(9)), slot(3, t(8), t(9))), 'same time on different days is fine');

const s = { weekday: 1, start: t(0, 5) }; // Tuesday 00:05
const until = (wd, h, m) => minutesUntilStart(s, wd, t(h, m));
ok(until(0, 23, 50) === 15 && until(0, 23, 59) === 6 && until(1, 0, 0) === 5, 'Tue 00:05 is 15 min away from Mon 23:50, 5 min from 00:00');
ok(until(0, 23, 49) === 16, 'not yet due at Mon 23:49 (16 min)');
ok(until(1, 0, 5) === 7 * DAY_MIN, 'at the start minute it is a week away (no reminder)');
ok(minutesUntilStart({ weekday: 0, start: t(0, 5) }, 6, t(23, 55)) === 10, 'Sun 23:55 is 10 min before Mon 00:05');
// the dedupe key is nowMinute + until: identical at every tick of one occurrence
const key = (nowMin, wd, h, m) => nowMin + until(wd, h, m);
const base = 5_000_000; // an arbitrary absolute minute that is Mon 23:50
ok(new Set([key(base, 0, 23, 50), key(base + 9, 0, 23, 59), key(base + 10, 1, 0, 0), key(base + 14, 1, 0, 4)]).size === 1, 'same reminder key across midnight');


console.log('drinnen (inside) entries');
ok(weekdayOf('2026-11-23') === 0 && weekdayOf('2026-11-29') === 6 && weekdayOf('2026-11-24') === 1, 'weekday of a date: Mon 23.11.2026 = 0, Sun = 6');
ok(addDays('2026-11-30', 1) === '2026-12-01' && addDays('2026-03-01', -1) === '2026-02-28' && addDays('2028-02-28', 1) === '2028-02-29', 'addDays crosses month ends and leap days');
ok(addDays('2026-03-28', 1) === '2026-03-29' && addDays('2026-03-29', 1) === '2026-03-30' && addDays('2026-10-24', 2) === '2026-10-26', 'addDays is not shifted by DST changes');
ok(nextDate('2026-11-24', 1) === '2026-11-24', 'the next Tuesday from a Tuesday is today');
ok(nextDate('2026-11-24', 2) === '2026-11-25' && nextDate('2026-11-24', 0) === '2026-11-30' && nextDate('2026-11-29', 6) === '2026-11-29', 'next Wednesday, next Monday, Sunday on a Sunday');
ok([0, 1, 2, 3, 4, 5, 6].every((wd) => { const d = nextDate('2026-12-30', wd); return weekdayOf(d) === wd && daysBetween('2026-12-30', d) >= 0 && daysBetween('2026-12-30', d) <= 6; }), 'every weekday is found within 6 days, also across the year end');
const weekly = { weekday: 2, start: 0, end: DAY_MIN, date: null };
const once = { weekday: 3, start: t(8), end: t(18), date: '2026-11-26' };
const night = { weekday: 3, start: t(22), end: t(26), date: '2026-11-26' };
ok(insideAt([weekly], '2026-11-25', t(12))?.whole === true && insideAt([weekly], '2026-11-25', t(12)).until === DAY_MIN, 'a weekly whole-day entry covers every Wednesday');
ok(insideAt([weekly], '2026-11-26', t(12)) === null && insideAt([weekly], '2026-12-02', 5)?.whole === true, 'not Thursday, but the Wednesday a week later');
ok(insideAt([once], '2026-11-26', t(8))?.until === t(18) && insideAt([once], '2026-11-26', t(18)) === null && insideAt([once], '2026-11-26', t(7, 55)) === null, 'a timed one-off covers [08:00, 18:00)');
ok(insideAt([once], '2026-12-03', t(9)) === null, 'a one-off does not repeat the next week');
ok(insideAt([night], '2026-11-27', t(1))?.until === t(2) && insideAt([night], '2026-11-27', t(2)) === null, 'an entry running past midnight covers the start of the next day');
ok(insideAt([night], '2026-11-26', t(23))?.until === t(26), 'and the evening it starts');
ok(insideAt([once, { ...once, start: t(6), end: t(20) }], '2026-11-26', t(9))?.until === t(20), 'the longest cover wins');
ok(insideAt([{ weekday: 6, start: t(23), end: t(25), date: null }], '2026-11-30', t(0, 30))?.until === t(1), 'a weekly Sunday-night entry covers Monday 00:30');

// The browser has its own copy of the calendar helpers (public/app.js has no imports). Both copies must give the same answers.
console.log('client copy of the calendar helpers');
const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const a = src.indexOf('// ---- calendar helpers: a copy'), b = src.indexOf('// ---- end of the copy ----');
ok(a >= 0 && b > a, 'the copy is found between its two markers');
const client = new Function(`${src.slice(a, b)}\nreturn { DAY_MIN, addDays, weekdayOf, nextDate, insideAt };`)();
let seed = 12345; // mulberry32, so the low bits are not periodic
const rnd = (n) => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return Math.floor((((x ^ (x >>> 14)) >>> 0) / 4294967296) * n); };
const dates = ['2026-03-28', '2026-03-29', '2026-03-30', '2026-10-24', '2026-10-25', '2026-10-26', '2026-12-31', '2027-01-01', '2028-02-28', '2028-02-29', '2028-03-01'];
for (let i = 0; i < 150; i++) dates.push(addDays('2026-01-01', rnd(900)));
let same = client.DAY_MIN === DAY_MIN;
for (const d of dates) {
  same &&= client.weekdayOf(d) === weekdayOf(d) && client.addDays(d, -1) === addDays(d, -1) && client.addDays(d, 9) === addDays(d, 9);
  for (let wd = 0; wd < 7; wd++) same &&= client.nextDate(d, wd) === nextDate(d, wd);
  const entries = [];
  for (let k = rnd(4); k > 0; k--) {
    const st = rnd(4) ? rnd(288) * 5 : 0, len = (1 + rnd(287)) * 5, en = Math.min(st + len, DAY_MIN + 600);
    entries.push({ weekday: rnd(7), start: st, end: Math.max(en, st + 5), date: rnd(2) ? null : addDays(d, rnd(3) - 1) });
  }
  const edges = entries.flatMap((e) => [e.start - 1, e.start, e.end - 1, e.end, e.end - DAY_MIN - 1, e.end - DAY_MIN]).filter((m) => m >= 0 && m < DAY_MIN);
  for (const m of [0, 5, 119, 120, 600, 1439, ...edges]) same &&= JSON.stringify(client.insideAt(entries, d, m)) === JSON.stringify(insideAt(entries, d, m));
}
ok(same, `weekdayOf, addDays, nextDate and insideAt agree on ${dates.length} dates (DST changes, year ends, leap day) with random entries`);

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
