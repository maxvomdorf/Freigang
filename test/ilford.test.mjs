// Unit tests for "Ilford in Zahlen" (pure, no server needed). All times are fixed, so the result never depends on the clock.
import { ilfordStats, median, outings, dayStarts } from '../src/ilford.js';
import { localToUtc, HOUR } from '../src/util.js';

let failed = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; };

const TZ = 'Europe/Berlin';
const STALE = 5 * HOUR;
/** 'YYYY-MM-DD HH:MM' (local) -> ms */
const L = (s) => localToUtc(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16), TZ);
/** [[time, status], ...] -> events with ascending ids */
const evs = (list) => list.map(([t, status], i) => ({ id: i + 1, ts: L(t), status }));
const stats = (list, now, days = 7) => ilfordStats({ events: evs(list), now: L(now), days, tz: TZ, staleMs: STALE });
const NOW = '2026-11-25 14:00'; // a Wednesday

console.log('ilford: helpers');
ok(median([]) === null, 'median of nothing is null');
ok(median([30, 10, 20]) === 20, 'median, odd count');
ok(median([10, 20, 30, 40]) === 25, 'median, even count = mean of the middle two');
ok(median([10, 21]) === 16, 'median, even count rounds to whole minutes');
{
  const o = outings(evs([['2026-11-24 10:00', 'in'], ['2026-11-24 10:05', 'soon'], ['2026-11-24 10:20', 'out'], ['2026-11-24 10:50', 'soon'], ['2026-11-24 12:00', 'out'], ['2026-11-24 12:10', 'in']]), L(NOW));
  ok(o.length === 2 && o[0].e - o[0].s === 30 * 60000 && o[1].e - o[1].s === 10 * 60000, "'soon' is inside: it neither starts nor extends an outing, an outing ends at 'soon'");
}
ok(stats([], NOW).empty === true, 'no events: empty');

console.log('ilford: totals and comparison');
// known since Nov 1; comparison window = Nov 11 14:00 .. Nov 18 14:00, current = Nov 18 14:00 .. Nov 25 14:00
const base = [
  ['2026-11-01 08:00', 'in'],
  ['2026-11-12 10:00', 'out'], ['2026-11-12 11:00', 'in'],        // 60
  ['2026-11-13 10:00', 'out'], ['2026-11-13 12:00', 'in'],        // 120
  ['2026-11-20 09:00', 'out'], ['2026-11-20 10:00', 'in'],        // 60
  ['2026-11-21 09:00', 'out'], ['2026-11-21 12:00', 'in'],        // 180
  ['2026-11-22 23:00', 'out'], ['2026-11-23 01:00', 'in'],        // 120, across midnight
];
{
  const s = stats(base, NOW);
  ok(s.cur.minutes === 360 && s.cur.outings === 3, 'current window: 360 min, 3 outings');
  ok(s.cur.median === 120 && s.cur.longest.minutes === 180, 'typical 120 min, longest 180 min');
  ok(s.cur.avgPerDay === 51, 'average per day = 360 / 7, rounded');
  ok(s.prev && s.prev.minutes === 180 && s.prev.outings === 2 && s.prev.median === 90 && s.prev.longest.minutes === 120, 'comparison window of equal length');
  ok(s.delta.minutes.abs === 180 && s.delta.minutes.pct === 100, 'total time: +180 min, +100 %');
  ok(s.delta.avgPerDay.abs === 25 && s.delta.avgPerDay.pct === 100, 'average per day: same relative change as the total');
  ok(s.delta.outings.abs === 1 && s.delta.outings.pct === null, 'only 2 outings before: absolute change only');
  ok(s.delta.median.abs === 30 && s.delta.median.pct === 33 && s.delta.longest.pct === 50, 'typical and longest outing changes');
  ok(s.prevFrom === null && s.since.covers === true, 'comparison available, window fully covered');
}
{
  const small = stats([['2026-11-01 08:00', 'in'], ['2026-11-12 10:00', 'out'], ['2026-11-12 10:40', 'in'], ['2026-11-20 10:00', 'out'], ['2026-11-20 12:00', 'in']], NOW);
  ok(small.delta.minutes.abs === 80 && small.delta.minutes.pct === null, 'baseline under 1 hour: no percentage, only +80 min');
}
{
  const none = stats([['2026-11-01 08:00', 'in'], ['2026-11-20 10:00', 'out'], ['2026-11-20 11:00', 'in']], NOW);
  ok(none.prev.minutes === 0 && none.delta.minutes.pct === null && none.delta.minutes.abs === 60, 'nothing before: no division by zero');
}

console.log('ilford: coverage (unknown is not "inside")');
{
  const s = stats([['2026-11-20 08:00', 'in'], ['2026-11-21 09:00', 'out'], ['2026-11-21 10:00', 'in']], NOW);
  ok(s.prev === null && s.delta === null, 'first event 5 days ago: no comparison for 7 days');
  ok(s.prevFrom === '04.12.', 'comparison announced from 20.11. + 14 days = 04.12.');
  ok(s.since.covers === false && s.since.label === '20.11.', 'window starts before the first event: "seit 20.11."');
  ok(s.cur.coveredDays === 5.25 && s.cur.avgPerDay === 11, 'average over the 5.25 covered days only: 60 / 5.25 = 11 min');
  const t = stats([['2026-11-20 08:00', 'in'], ['2026-11-21 09:00', 'out'], ['2026-11-21 10:00', 'in']], NOW, 30);
  ok(t.prev === null && t.prevFrom === '19.01.', '30 days: comparison from 20.11. + 60 days');
  const edge = stats([['2026-11-11 14:00', 'in']], NOW);
  ok(edge.prev !== null, 'first event exactly at the start of the comparison window: comparable');
  const justShort = stats([['2026-11-11 14:01', 'in']], NOW);
  ok(justShort.prev === null, 'one minute later: not comparable');
}

console.log('ilford: bars and day split');
{
  const s = stats(base, NOW);
  const by = Object.fromEntries(s.bars.map((b) => [b.iso, b]));
  ok(s.bars.length === 7 && s.bars.at(-1).iso === '2026-11-25' && s.bars.at(-1).d === 'Mi', 'seven days, today last (Mi)');
  ok(by['2026-11-22'].minutes === 60 && by['2026-11-23'].minutes === 60, 'outing across midnight is split 60 / 60');
  ok(by['2026-11-22'].outings === 1 && by['2026-11-23'].outings === 0, 'but it is counted on the day it starts');
  ok(s.bars.at(-1).partial === true && s.bars.slice(0, -1).every((b) => !b.partial), 'only today is "bis jetzt"');
  // the six finished days Nov 19..24: 0, 60, 180, 60, 60, 0 = 360 min
  ok(s.avg === 60, 'average ignores today (6 finished days: 360 / 6 = 60)');
  // Nov 18..24 = 0, 0, 60, 180, 60, 60, 0 = 360 -> 51
  ok(s.rolling.length === 7 && s.rolling[5] === 51 && s.rolling.at(-1) === null, 'rolling 7-day average 51 min for Nov 24, none for today');
}
{
  // history shorter than the view: only the known days are drawn, the first one is partial
  const s = stats([['2026-11-23 10:00', 'in'], ['2026-11-24 09:00', 'out'], ['2026-11-24 09:30', 'in']], NOW, 30);
  ok(s.bars.length === 3 && s.bars[0].first === true && s.bars[0].iso === '2026-11-23', 'young history: 3 bars, first one flagged as partly known');
  ok(s.avg === 30 && s.rolling.every((v) => v === null), 'average only over fully known days, no rolling value yet');
}
{
  // DST: Sunday 2026-10-25 has 25 hours, Sunday 2026-03-29 has 23
  const fall = stats([['2026-10-20 08:00', 'in'], ['2026-10-24 22:00', 'out'], ['2026-10-25 08:00', 'in'], ['2026-10-25 20:00', 'out'], ['2026-10-26 20:00', 'in']], '2026-10-27 12:00');
  const f = Object.fromEntries(fall.bars.map((b) => [b.iso, b.minutes]));
  ok(f['2026-10-24'] === 120 && f['2026-10-25'] === 540 + 240, 'fall-back day: 00:00 -> 08:00 is 9 h in real time (540) plus 20:00 -> 24:00 (240)');
  ok(f['2026-10-26'] === 20 * 60, 'next day: 00:00 -> 20:00 = 20 h');
  const day = stats([['2026-10-20 08:00', 'in'], ['2026-10-25 00:00', 'out'], ['2026-10-26 00:00', 'in']], '2026-10-27 12:00');
  ok(day.bars.find((b) => b.iso === '2026-10-25').minutes === 25 * 60, 'a whole 25-hour day outside = 1500 min');
  const spring = stats([['2026-03-20 08:00', 'in'], ['2026-03-29 00:00', 'out'], ['2026-03-30 00:00', 'in']], '2026-03-31 12:00');
  ok(spring.bars.find((b) => b.iso === '2026-03-29').minutes === 23 * 60, 'a whole 23-hour day outside = 1380 min');
}

console.log('ilford: day calendar');
for (const [zone, from, to] of [['Europe/Berlin', '2023-12-20', '2027-01-10'], ['America/New_York', '2024-01-01', '2026-12-31'], ['Australia/Lord_Howe', '2025-01-01', '2026-12-31'], ['Asia/Kolkata', '2025-11-01', '2026-03-01']]) {
  const cal = dayStarts(from, to, zone);
  let bad = 0;
  cal.forEach((c, k) => { const d = new Date(Date.parse(c.iso + 'T00:00:00Z')); if (c.start !== localToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, zone)) bad++; });
  ok(bad === 0 && cal[0].iso === from && cal.at(-1).iso > to, `${zone}: ${cal.length} local midnights from ${from} agree with the exact conversion (DST switches included)`);
}

console.log('ilford: open and uncertain outings');
{
  const s = stats([['2026-11-01 08:00', 'in'], ['2026-11-24 10:00', 'out'], ['2026-11-24 11:00', 'in'], ['2026-11-25 13:30', 'out']], NOW);
  ok(s.cur.open === true && s.cur.outings === 2 && s.cur.minutes === 90, 'open outing counts up to now (30 min) and is flagged');
  ok(s.cur.longest.minutes === 60 && s.cur.median === 60, 'but it neither sets the longest outing nor the typical one');
  ok(s.records.longest.minutes === 60, 'nor a record');
}
{
  const s = stats([
    ['2026-11-01 08:00', 'in'],
    ['2026-11-21 08:00', 'out'], ['2026-11-21 15:00', 'in'],        // 7 h: forgot to tap "drin"
    ['2026-11-22 10:00', 'out'], ['2026-11-22 12:00', 'in'],        // 2 h
    ['2026-11-23 10:00', 'out'], ['2026-11-23 15:00', 'in'],        // exactly 5 h: still sure
  ], NOW);
  ok(s.cur.uncertain === 1, 'one outing longer than the nudge threshold is flagged unsicher');
  ok(s.cur.longest.minutes === 300, 'longest outing: the 7 h one is skipped, exactly 5 h is fine');
  ok(s.cur.minutes === 420 + 120 + 300 && s.cur.median === 300, 'but it counts in the total time, and the median is robust against it');
  ok(s.records.longest.minutes === 300 && s.records.mostMinutes.minutes === 300 && s.records.mostMinutes.date === '2026-11-23', 'records ignore it');
}

console.log('ilford: streaks and records');
{
  const day = (d, h1 = '10:00', h2 = '11:00') => [[`2026-11-${d} ${h1}`, 'out'], [`2026-11-${d} ${h2}`, 'in']];
  // outings on 22, 23, 24; today (25) nothing yet
  const s = stats([['2026-11-21 08:00', 'in'], ...day(22), ...day(23), ...day(24)], NOW);
  ok(s.streaks.out.current.days === 3 && s.streaks.out.current.from === '2026-11-22' && s.streaks.out.current.to === '2026-11-24', 'a today without an outing yet does not break the outing streak');
  ok(s.streaks.out.isBest === true && s.streaks.out.best.days === 3, 'the current streak is the best one');
  ok(s.streaks.none.current.days === 0 && s.streaks.none.best.days === 1 && s.streaks.none.best.from === '2026-11-21', 'days without: the first, partly known day counts, the current run is 0');
  const t = stats([['2026-11-21 08:00', 'in'], ...day(22), ...day(23), ...day(24), ...day(25, '12:00', '13:00')], NOW);
  ok(t.streaks.out.current.days === 4, 'today with an outing extends the streak');
  // gap: out on 20, 21, then none 22..24, today none yet
  const g = stats([['2026-11-19 08:00', 'in'], ...day(20), ...day(21)], NOW);
  ok(g.streaks.none.current.days === 3 && g.streaks.none.current.from === '2026-11-22' && g.streaks.none.current.to === '2026-11-24', 'days without: yesterday and before, today is undecided');
  ok(g.streaks.out.current.days === 0 && g.streaks.out.best.days === 2, 'broken outing streak: current 0, best 2');
  const tie = stats([['2026-11-19 08:00', 'in'], ...day(20), ...day(21), ...day(23), ...day(24)], NOW);
  ok(tie.streaks.out.best.days === 2 && tie.streaks.out.best.from === '2026-11-23' && tie.streaks.out.isBest === true, 'two equally long streaks: the most recent one is the best (so a tie with the current one shows as best)');
  const open = stats([['2026-11-19 08:00', 'in'], ...day(24), ['2026-11-25 08:00', 'out']], NOW);
  ok(open.streaks.out.current.days === 2, 'an outing running today already counts for today');
}
{
  const s = stats([
    ['2026-11-01 08:00', 'in'],
    ['2026-11-10 09:00', 'out'], ['2026-11-10 10:00', 'in'], ['2026-11-10 12:00', 'out'], ['2026-11-10 12:30', 'in'], ['2026-11-10 15:00', 'out'], ['2026-11-10 17:00', 'in'], // 3 outings, 210 min
    ['2026-11-15 09:00', 'out'], ['2026-11-15 12:00', 'in'],                                                                                                        // 180 min
  ], NOW);
  ok(s.records.longest.minutes === 180 && s.records.longest.date === '2026-11-15', 'longest outing with its date');
  ok(s.records.mostMinutes.minutes === 210 && s.records.mostMinutes.date === '2026-11-10', 'most time outside in one day');
  ok(s.records.mostOutings.count === 3 && s.records.mostOutings.date === '2026-11-10', 'most outings in one day');
  // inside: Nov 1 08:00 -> Nov 10 09:00 = 9 days + 1 h; later stretches are shorter; the running one (Nov 15 12:00 -> now) is 10 days + 2 h
  ok(s.records.longestInside.open === true && s.records.longestInside.minutes === (10 * 24 + 2) * 60, 'longest time inside: the running stretch can be the record');
  const closed = stats([['2026-11-01 08:00', 'in'], ['2026-11-10 09:00', 'out'], ['2026-11-10 10:00', 'in'], ['2026-11-24 09:00', 'out'], ['2026-11-24 10:00', 'in']], NOW);
  ok(closed.records.longestInside.open === false && closed.records.longestInside.minutes === (13 * 24 + 23) * 60, 'longest time inside between two outings: Nov 10 10:00 -> Nov 24 09:00');
  const first = stats([['2026-11-24 09:00', 'out'], ['2026-11-24 10:00', 'in']], NOW);
  ok(first.records.longestInside.open === true && first.records.longestInside.minutes === 28 * 60, 'a first event that is "out" leaves no stretch before it: only 10:00 -> now (28 h)');
  const noOuting = stats([['2026-11-20 08:00', 'in']], NOW);
  ok(noOuting.records.longest === null && noOuting.records.mostMinutes === null && noOuting.cur.median === null && noOuting.cur.longest === null, 'no outing yet: no records, no typical, no longest');
  ok(noOuting.records.longestInside.open === true, 'but the time inside runs');
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
