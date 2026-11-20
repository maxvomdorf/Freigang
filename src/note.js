// Short note on a cat's status ("In Begleitung"). Pure helpers, so they can be tested from plain Node.
export const NOTE_MAX = 40;
export const NOTE_STATUSES = ['soon', 'out'];

/** Trim, turn newlines and control characters into spaces, collapse spaces, cap at NOTE_MAX characters. Empty result = no note. */
export function normalizeNote(v) {
  if (typeof v !== 'string') return '';
  const t = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, NOTE_MAX).join('').trim();
}

/** Which note a new event gets. `body` is the request body, `cur` the cat's current status, `curNote` its current note. */
export function noteForNewEvent(to, cur, curNote, body) {
  if (!NOTE_STATUSES.includes(to)) return null;
  if (Object.prototype.hasOwnProperty.call(body, 'note')) return normalizeNote(body.note) || null;
  if (cur === 'soon' && to === 'out') return curNote || null; // announced with a note, now going out: keep it
  return null;
}

/** Quote a CSV field for the `;`-separated export. */
export function csvField(v) {
  const s = String(v ?? '');
  return /[;"\r\n]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
