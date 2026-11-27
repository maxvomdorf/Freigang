// Correcting the time of an already entered Rein/Raus event (admins, own cat, last 24 hours). Pure rules, no database.
//
// Invariant to keep: `lastEvents` reads the current status by id, the statistics sort by (ts, id). So ts must stay
// non-decreasing in id order: a corrected time may never jump over the neighbouring events of the same cat.
// 'soon' events are not editable (their soon_until hangs on ts), but they still bound their neighbours.
import { HOUR } from './util.js';

export const EDIT_WINDOW = 24 * HOUR;
export const EDITABLE = ['in', 'out'];

/** Allowed range for the new time: after the previous event (or 24 h ago), before the next event (or now). Both ends inclusive. */
export function editBounds({ prevTs, nextTs, now }) {
  const lo = Math.max(prevTs ?? 0, now - EDIT_WINDOW);
  const hi = Math.min(nextTs ?? now, now);
  return { lo, hi };
}

/** Why an event cannot be corrected at all, or null. */
export function lockedReason(ev, now) {
  if (!EDITABLE.includes(ev.status)) return 'not_editable';
  if (ev.ts < now - EDIT_WINDOW) return 'too_old';
  return null;
}

/**
 * @returns { ok: true, lo, hi } or { ok: false, code, lo?, hi? } with code bad_ts | not_editable | too_old | out_of_range
 */
export function checkEdit({ ev, prevTs, nextTs, ts, now }) {
  const why = lockedReason(ev, now);
  if (why) return { ok: false, code: why };
  const { lo, hi } = editBounds({ prevTs, nextTs, now });
  if (!Number.isFinite(ts) || !Number.isInteger(ts)) return { ok: false, code: 'bad_ts', lo, hi };
  if (ts < lo || ts > hi) return { ok: false, code: 'out_of_range', lo, hi };
  return { ok: true, lo, hi };
}
