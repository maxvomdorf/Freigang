// Unit tests for the rules that decide whether and how far an event time may be corrected (pure, fixed clock).
import { checkEdit, editBounds, lockedReason, EDIT_WINDOW } from '../src/times.js';

let failed = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; };

const H = 3600000, MIN = 60000;
const now = Date.UTC(2026, 10, 27, 7, 40);          // Friday morning
const at = (hoursAgo) => now - hoursAgo * H;
const ev = (status, ts) => ({ id: 5, status, ts });

console.log('times: bounds');
{
  const b = editBounds({ prevTs: at(9.5), nextTs: at(0.5), now });
  ok(b.lo === at(9.5) && b.hi === at(0.5), 'between the neighbours');
  const c = editBounds({ prevTs: at(30), nextTs: undefined, now });
  ok(c.lo === now - EDIT_WINDOW && c.hi === now, 'no next event: up to now; an older previous event: at most 24 h back');
  ok(editBounds({ prevTs: at(1), nextTs: now + H, now }).hi === now, 'a next event from the future (clock skew) never lifts the limit above now');
  const d = editBounds({ prevTs: undefined, nextTs: null, now });
  ok(d.lo === now - EDIT_WINDOW && d.hi === now, 'no neighbours at all');
  ok(editBounds({ prevTs: at(1), nextTs: at(2), now }).lo > editBounds({ prevTs: at(1), nextTs: at(2), now }).hi, 'neighbours the wrong way round give an empty range (nothing editable)');
}

console.log('times: who can be corrected');
ok(lockedReason(ev('soon', at(1)), now) === 'not_editable', "'soon' is never editable (soon_until hangs on its time)");
ok(lockedReason(ev('in', at(25)), now) === 'too_old' && lockedReason(ev('out', at(24.01)), now) === 'too_old', 'older than 24 h: locked');
ok(lockedReason(ev('out', at(24)), now) === null && lockedReason(ev('in', at(0)), now) === null, 'exactly 24 h and "now" are still editable');

console.log('times: checkEdit');
{
  // the use case: "Rein" pressed this morning at 07:30, the cat came in at 23:15 last night; "Raus" was yesterday 18:00
  const rein = ev('in', now - 10 * MIN);
  const night = Date.UTC(2026, 10, 26, 22, 15);
  const r = checkEdit({ ev: rein, prevTs: Date.UTC(2026, 10, 26, 17, 0), nextTs: undefined, ts: night, now });
  ok(r.ok === true, 'last night 23:15 is fine (after "Raus" at 17:00, before now)');
  ok(checkEdit({ ev: rein, prevTs: Date.UTC(2026, 10, 26, 23, 0), nextTs: undefined, ts: night, now }).code === 'out_of_range', 'before the "Raus" event: refused');
  ok(checkEdit({ ev: rein, prevTs: Date.UTC(2026, 10, 26, 22, 15), nextTs: undefined, ts: night, now }).ok, 'exactly at the previous event: allowed (inclusive)');
  ok(checkEdit({ ev: rein, prevTs: undefined, nextTs: undefined, ts: now + 1, now }).code === 'out_of_range', 'in the future: refused');
  ok(checkEdit({ ev: rein, prevTs: undefined, nextTs: undefined, ts: now, now }).ok, 'now: allowed');
  ok(checkEdit({ ev: rein, prevTs: undefined, nextTs: undefined, ts: now - EDIT_WINDOW - 1, now }).code === 'out_of_range', 'more than 24 h back: refused');
  ok(checkEdit({ ev: rein, prevTs: undefined, nextTs: undefined, ts: now - EDIT_WINDOW, now }).ok, 'exactly 24 h back: allowed');
  ok(checkEdit({ ev: ev('out', at(2)), prevTs: at(5), nextTs: at(1), ts: at(0.5), now }).code === 'out_of_range', 'cannot jump over the next event');
  ok(checkEdit({ ev: ev('out', at(2)), prevTs: at(5), nextTs: at(1), ts: at(3), now }).ok, 'moving earlier, still after the previous event');
  ok(checkEdit({ ev: ev('soon', at(2)), prevTs: at(5), nextTs: at(1), ts: at(3), now }).code === 'not_editable', 'a soon event is refused before the range is looked at');
  ok(checkEdit({ ev: ev('in', at(30)), prevTs: undefined, nextTs: undefined, ts: at(29), now }).code === 'too_old', 'an event older than 24 h is refused');
  for (const bad of [NaN, Infinity, 1.5, undefined]) ok(checkEdit({ ev: rein, prevTs: undefined, nextTs: undefined, ts: bad, now }).code === 'bad_ts', `ts ${bad} is not a time`);
  const o = checkEdit({ ev: rein, prevTs: at(9), nextTs: undefined, ts: at(12), now });
  ok(o.code === 'out_of_range' && o.lo === at(9) && o.hi === now, 'a refusal carries the allowed range for the message');
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
