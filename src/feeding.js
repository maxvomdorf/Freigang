// Feeding tracker for Bonnie. Entry = who and when. Warns, never blocks: a second feeding within the hour needs `force`.
import { PEOPLE, peopleOfCat, json, clamp, numVar, MIN, HOUR, hhmm, FEED_CAT, FEED_HINT_MIN, FEED_UNDO_MIN } from './util.js';
import { notifyUsers } from './push.js';

const nameOf = (user) => PEOPLE[user]?.name || user;

const LATE_MS = 2 * MIN; // entered later than this after the feeding: shown as "nachgetragen"
const MAX_BACK_MS = 24 * HOUR; // a feeding can be entered afterwards for the last 24 hours
const COLS = 'id, ts, user, recorded_at';

/**
 * One entry the way the client wants it. ts = when it happened, rec = when it was entered (undo counts from there),
 * `undoable`: your own entry, entered recently enough, `late`: entered afterwards.
 */
export function feedingOut(row, me, now) {
  const rec = row.recorded_at ?? row.ts;
  return { id: row.id, ts: row.ts, rec, name: nameOf(row.user), mine: row.user === me.user, undoable: row.user === me.user && now - rec <= FEED_UNDO_MIN * MIN, late: rec - row.ts > LATE_MS };
}

export async function lastFeeding(env) {
  return env.DB.prepare(`SELECT ${COLS} FROM feedings ORDER BY ts DESC, id DESC LIMIT 1`).first();
}

/** Everyone in Bonnie's household except the person who did it and except those who switched feeding pushes off. */
async function recipients(env, actor) {
  const { results: off } = await env.DB.prepare('SELECT user FROM user_prefs WHERE feed_push = 0').all();
  const muted = new Set(off.map((r) => r.user));
  return peopleOfCat(FEED_CAT).filter((u) => u !== actor && !muted.has(u));
}

// Same tag and topic for entry and correction, so a correction replaces the earlier notification instead of piling up.
const PUSH_OPTS = { urgency: 'normal', topic: 'feed-bonnie' };

async function pushFed(env, me, ts, tz, now) {
  const to = await recipients(env, me.user);
  const late = now - ts > LATE_MS ? ' (nachgetragen)' : '';
  await notifyUsers(env, to, { title: 'Bonnie wurde gefüttert', body: `${me.name} um ${hhmm(ts, tz)} Uhr${late}`, tag: 'feed-bonnie', ts: now }, PUSH_OPTS);
}

async function pushUndone(env, me, row, tz, now) {
  const to = await recipients(env, me.user);
  const rest = await lastFeeding(env);
  const tail = rest && now - rest.ts < 24 * HOUR ? ` Zuletzt gefüttert: ${hhmm(rest.ts, tz)} Uhr (${nameOf(rest.user)}).` : '';
  await notifyUsers(
    env, to,
    { title: 'Fütterung zurückgenommen', body: `${me.name} hat den Eintrag von ${hhmm(row.ts, tz)} Uhr zurückgenommen.${tail}`, tag: 'feed-bonnie', ts: now, update: true },
    PUSH_OPTS,
  );
}

/** GET /api/feedings?days=7 · POST /api/feedings {force?} · DELETE /api/feedings/:id */
export async function feedingRoutes(request, env, ctx, me, url, now, tz) {
  if (me.cat !== FEED_CAT) return json({ error: 'forbidden' }, 403);
  const m = request.method;
  const withId = /^\/api\/feedings\/[^/]+/.test(url.pathname);
  if (withId !== (m === 'DELETE') && ['GET', 'POST', 'DELETE'].includes(m)) return json({ error: 'not_found' }, 404);

  if (m === 'GET') {
    const raw = url.searchParams.get('days');
    const days = clamp(Math.round(numVar(raw === null ? 7 : raw, 7)), 1, 30);
    const { results } = await env.DB.prepare(`SELECT ${COLS} FROM feedings WHERE ts >= ? ORDER BY ts DESC, id DESC LIMIT 300`).bind(now - days * 24 * HOUR).all();
    return json({ now, days, feedings: results.map((r) => feedingOut(r, me, now)) });
  }

  if (m === 'POST') {
    const b = await request.json().catch(() => ({}));
    // `at` (epoch ms) enters a feeding afterwards: any time in the last 24 hours, never in the future.
    if (b.at !== undefined && !Number.isFinite(Number(b.at))) return json({ error: 'bad_time' }, 400);
    const ts = b.at === undefined ? now : clamp(Math.round(Number(b.at)), now - MAX_BACK_MS, now);
    // The hint looks at the feeding closest to the time being entered, within the hour on either side.
    const near = await env.DB.prepare(`SELECT ${COLS} FROM feedings WHERE ts > ?1 AND ts < ?2 ORDER BY ABS(ts - ?3) LIMIT 1`).bind(ts - FEED_HINT_MIN * MIN, ts + FEED_HINT_MIN * MIN, ts).first();
    if (near && b.force !== true) return json({ error: 'recent', last: feedingOut(near, me, now) }, 409);
    const r = await env.DB.prepare('INSERT INTO feedings (ts, user, recorded_at) VALUES (?, ?, ?)').bind(ts, me.user, now).run();
    ctx.waitUntil(pushFed(env, me, ts, tz, now));
    return json({ ok: true, entry: feedingOut({ id: r.meta?.last_row_id, ts, user: me.user, recorded_at: now }, me, now) });
  }

  if (m === 'DELETE') {
    const id = Number(url.pathname.split('/')[3]);
    const row = Number.isInteger(id) ? await env.DB.prepare(`SELECT ${COLS} FROM feedings WHERE id = ?`).bind(id).first() : null;
    if (!row) return json({ error: 'not_found' }, 404);
    if (row.user !== me.user) return json({ error: 'forbidden' }, 403);
    if (now - (row.recorded_at ?? row.ts) > FEED_UNDO_MIN * MIN) return json({ error: 'too_late' }, 409);
    await env.DB.prepare('DELETE FROM feedings WHERE id = ?').bind(id).run();
    ctx.waitUntil(pushUndone(env, me, row, tz, now));
    return json({ ok: true });
  }

  return json({ error: 'method' }, 405);
}
