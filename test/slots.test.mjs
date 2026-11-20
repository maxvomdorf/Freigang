// Unit tests for the weekly plan maths (pure, no server needed).
import { normalize, overlapsWeek, minutesUntilStart, DAY_MIN } from '../src/slots.js';

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

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
