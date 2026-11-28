// HTTP API. Every route except none requires a personal access code (Authorization: Bearer <code>).
import {
  CATS, CAT_NAME, PEOPLE, otherCat, peopleOfCat, OTHER_NAME, json, clamp, MIN, HOUR, zoned, localToUtc, hhmm, numVar, staleMsOf, FEED_CAT, FEED_HINT_MIN, FEED_UNDO_MIN,
} from './util.js';
import { feedingRoutes, feedingOut, lastFeeding } from './feeding.js';
import { notifyUser, notifyUsers } from './push.js';
import { buildLog, todayStrip } from './stats.js';
import { ilfordStats } from './ilford.js';
import { checkEdit, editBounds, lockedReason } from './times.js';
import { describe, parseCoords, validCoords } from './weather.js';
import { KV_SQL, readWx, runWeather, setLocation, wxState } from './weatherjob.js';
import { lastEvents, eventsSince } from './db.js';
import { normalize, overlapsWeek, nextDate, addDays, daysBetween, insideAt, DAY_MIN } from './slots.js';
import { VERSION } from './version.js';
import { NOTE_STATUSES, normalizeNote, noteForNewEvent } from './note.js';

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function sha(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha(a), sha(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export async function authenticate(request, env) {
  const h = request.headers.get('authorization') || '';
  const code = norm(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (code.length < 12) return null;
  let found = null;
  for (const p of Object.values(PEOPLE)) {
    const secret = norm(env[p.secret]);
    if (secret && (await sameSecret(code, secret))) found = p;
  }
  return found;
}

const tzOf = (env) => env.TIMEZONE || 'Europe/Berlin';

function catState(row) {
  return row
    ? { status: row.status, since: row.ts, soonUntil: row.soon_until, override: !!row.override, note: NOTE_STATUSES.includes(row.status) ? row.note || '' : '' }
    : { status: 'in', since: null, soonUntil: null, override: false, note: '' };
}

async function buildState(env, me, now) {
  const tz = tzOf(env);
  const last = await lastEvents(env);
  const z = zoned(now, tz);
  const dayFrom = localToUtc(z.year, z.month, z.day, 0, 0, tz);
  const ev = await eventsSince(env, dayFrom);
  const theirs = peopleOfCat(otherCat(me.cat));
  const [watch, devices, prefs, inside, wxRows] = await env.DB.batch([
    env.DB.prepare('SELECT 1 FROM watches WHERE user = ? AND cat = ?').bind(me.user, otherCat(me.cat)),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE user IN (${theirs.map(() => '?').join(',')})`).bind(...theirs),
    env.DB.prepare('SELECT own_push, feed_push FROM user_prefs WHERE user = ?').bind(me.user),
    env.DB.prepare("SELECT cat, weekday, start_min, end_min, on_date FROM schedule_slots WHERE kind = 'in'"),
    env.DB.prepare(KV_SQL),
  ]);
  // Is a cat planned to stay inside right now? (the plan's "Drinnen" entries; until = minutes after today's midnight)
  const insideNow = {};
  for (const cat of CATS) {
    const entries = inside.results.filter((r) => r.cat === cat).map((r) => ({ weekday: r.weekday, start: r.start_min, end: r.end_min, date: r.on_date }));
    insideNow[cat] = insideAt(entries, z.date, z.minutes);
  }
  // Feeding tracker data exists only for Bonnie's household.
  const feeds = me.cat === FEED_CAT;
  const lastFeed = feeds ? await lastFeeding(env) : null;
  return {
    now,
    tz,
    me: { user: me.user, name: me.name, cat: me.cat, admin: me.admin, other: otherCat(me.cat), otherName: OTHER_NAME[me.cat], partnerDevices: devices.results[0]?.n ?? 0 },
    prefs: { ownPush: (prefs.results[0]?.own_push ?? 1) === 1, ...(feeds ? { feedPush: (prefs.results[0]?.feed_push ?? 1) === 1 } : {}) },
    ...(feeds ? { feeding: { last: lastFeed ? feedingOut(lastFeed, me, now) : null, hintMin: FEED_HINT_MIN, undoMin: FEED_UNDO_MIN } } : {}),
    cats: { ilford: catState(last.ilford), bonnie: catState(last.bonnie) },
    ...wxState(wxRows.results, now, me.admin),
    insideNow,
    waiting: watch.results.length > 0,
    today: todayStrip({ events: ev, now, tz }),
    quietHours: { start: numVar(env.QUIET_START, 22), end: numVar(env.QUIET_END, 6) },
    vapidPublicKey: env.VAPID_PUBLIC_KEY || '',
    version: VERSION,
  };
}

// ---------- status ----------

function statusMessage({ cat, to, prev, otherStatus, otherSince, ts, soonMin, tz, note }) {
  const m = baseStatusMessage({ cat, to, prev, otherStatus, otherSince, ts, soonMin, tz });
  return note ? { ...m, body: `„${note}“ · ${m.body}` } : m;
}

function baseStatusMessage({ cat, to, prev, otherStatus, otherSince, ts, soonMin, tz }) {
  const C = CAT_NAME[cat], O = CAT_NAME[otherCat(cat)];
  if (to === 'out') {
    if (otherStatus === 'out') {
      return { title: 'Achtung: beide draußen', body: `${C} seit ${hhmm(ts, tz)}, ${O} seit ${hhmm(otherSince, tz)}.` };
    }
    return {
      title: `${C} ist jetzt draußen`,
      body: otherStatus === 'soon' ? `${O} wollte gleich raus – bitte noch warten.` : `${O} bleibt besser noch drin.`,
    };
  }
  if (to === 'soon') {
    return {
      title: `${C} kommt in ${soonMin} Min raus`,
      body: otherStatus === 'out' ? `${O} ist noch draußen – bitte vorher reinholen.` : `${O} bleibt besser noch drin.`,
    };
  }
  if (prev === 'soon') return { title: `${C} bleibt doch drin`, body: 'Die Vorwarnung ist abgebrochen.' };
  return { title: `${C} ist wieder drin`, body: `${O} kann raus.` };
}

/**
 * Status push: always to everyone on the other side; also to the rest of your own household unless they switched that off.
 * The own household gets the same text plus who did it. Same tag and topic for both, so a later push replaces the earlier one.
 */
async function pushStatus(env, me, msg, now, update) {
  const opts = { urgency: 'high', topic: `status-${me.cat}` };
  const base = { tag: `cat-${me.cat}`, ts: now, ...(update ? { update: true } : {}) };
  const { results: off } = await env.DB.prepare('SELECT user FROM user_prefs WHERE own_push = 0').all();
  const muted = new Set(off.map((r) => r.user));
  const own = peopleOfCat(me.cat).filter((u) => u !== me.user && !muted.has(u));
  await Promise.all([
    notifyUsers(env, peopleOfCat(otherCat(me.cat)), { ...msg, ...base }, opts),
    notifyUsers(env, own, { ...msg, body: `${msg.body} (von ${me.name})`, ...base }, opts),
  ]);
}

async function setStatus(env, ctx, me, body) {
  const now = Date.now(), tz = tzOf(env);
  const cat = me.cat, other = otherCat(cat);
  const to = body.to;
  if (!['in', 'soon', 'out'].includes(to)) return json({ error: 'bad_status' }, 400);

  const last = await lastEvents(env);
  const cur = last[cat]?.status ?? 'in';
  const oth = last[other]?.status ?? 'in';
  if (to === cur) return json({ ok: true, noop: true, state: await buildState(env, me, now) });

  // Conflict guard, enforced here and not only in the UI. Overriding is allowed but always recorded.
  if (to === 'out' && oth === 'out' && !body.force) {
    return json({ error: 'conflict', other: { cat: other, since: last[other].ts } }, 409);
  }
  const override = to === 'out' && oth === 'out' ? 1 : 0;
  const note = noteForNewEvent(to, cur, last[cat]?.note, body);

  let ts = now;
  // "Kam früher rein" may reach back a whole day; backdating an "out" stays at 4 h (and is not offered in the app).
  const ago = clamp(Math.round(numVar(body.agoMin, 0)), 0, to === 'in' ? 1440 : 240);
  if (ago > 0 && to !== 'soon') ts = Math.max(now - ago * MIN, last[cat]?.ts ?? 0);
  const soonMin = clamp(Math.round(numVar(body.soonMin, 15)), 1, 60);
  const soonUntil = to === 'soon' ? now + soonMin * MIN : null;

  const stmts = [
    env.DB.prepare(
      `INSERT INTO events (cat, status, prev_status, ts, recorded_at, actor, soon_until, override, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(cat, to, cur, ts, now, me.user, soonUntil, override, note),
  ];
  // A decision was made: stop waiting for the other cat. Anyone waiting for *this* cat is notified below, then cleared.
  stmts.push(env.DB.prepare('DELETE FROM watches WHERE user = ? AND cat = ?').bind(me.user, other));
  if (to === 'in') stmts.push(env.DB.prepare('DELETE FROM watches WHERE cat = ?').bind(cat));
  await env.DB.batch(stmts);

  const msg = statusMessage({ cat, to, prev: cur, otherStatus: oth, otherSince: last[other]?.ts, ts, soonMin, tz, note });
  ctx.waitUntil(pushStatus(env, me, msg, now, false));
  return json({ ok: true, state: await buildState(env, me, now) });
}

/** Change or clear the note of your own cat while it is announced ("soon") or out. Does not create a new event. */
async function noteOnStatus(env, ctx, me, body) {
  const cat = me.cat, other = otherCat(cat), now = Date.now();
  const note = normalizeNote(body.note);
  const last = await lastEvents(env);
  const row = last[cat];
  if (!row || !NOTE_STATUSES.includes(row.status)) return json({ error: 'no_note_now' }, 409);
  const r = await env.DB.prepare(
    `UPDATE events SET note = ?1 WHERE id = (SELECT id FROM events WHERE cat = ?2 ORDER BY id DESC LIMIT 1) AND status IN ('soon', 'out')`,
  ).bind(note || null, cat).run();
  if ((r.meta?.changes ?? 0) === 1 && note && note !== (row.note || '')) {
    // Same tag and topic as the status push, so it replaces it: therefore it must say everything the status push said
    // ("beide draußen", "bitte vorher reinholen") plus the new note, and be just as urgent.
    const soonMin = row.soon_until ? Math.max(1, Math.ceil((row.soon_until - now) / MIN)) : 1;
    const msg = statusMessage({
      cat, to: row.status, prev: row.prev_status, otherStatus: last[other]?.status ?? 'in', otherSince: last[other]?.ts,
      ts: row.ts, soonMin, tz: tzOf(env), note,
    });
    ctx.waitUntil(pushStatus(env, me, msg, now, true));
  }
  return json({ ok: true, state: await buildState(env, me, now) });
}

// ---------- correct times (admins, own cat, last 24 hours) ----------

/** Rein/Raus events of the cat from the last 24 hours, newest first, each with the range its time may move within. */
async function timesList(env, cat, now) {
  const from = now - 24 * 3600000;
  const [{ results }, before] = await Promise.all([
    env.DB.prepare('SELECT id, status, ts, recorded_at, orig_ts, edited_by, edited_at FROM events WHERE cat = ? AND ts >= ? ORDER BY id').bind(cat, from).all(),
    env.DB.prepare('SELECT ts FROM events WHERE cat = ? AND ts < ? ORDER BY id DESC LIMIT 1').bind(cat, from).first(),
  ]);
  const rows = results.map((r, i) => {
    const { lo, hi } = editBounds({ prevTs: i ? results[i - 1].ts : before?.ts, nextTs: results[i + 1]?.ts, now });
    return {
      id: r.id, status: r.status, ts: r.ts, recordedAt: r.recorded_at, lo, hi,
      editable: lockedReason(r, now) === null && lo <= hi,
      edited: r.orig_ts == null ? null : { orig: r.orig_ts, by: PEOPLE[r.edited_by]?.name ?? r.edited_by, at: r.edited_at },
    };
  });
  return rows.filter((r) => r.status !== 'soon').reverse();
}

async function timesRoute(request, env, me, now) {
  if (request.method === 'GET') return json({ now, rows: await timesList(env, me.cat, now) });
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id), ts = Number(b.ts);
  if (!Number.isInteger(id)) return json({ error: 'bad_request' }, 400);
  // Only the own cat: an id of the other cat looks like a missing one.
  const ev = await env.DB.prepare('SELECT id, cat, status, ts FROM events WHERE id = ? AND cat = ?').bind(id, me.cat).first();
  if (!ev) return json({ error: 'not_found' }, 404);
  const [prev, next] = await Promise.all([
    env.DB.prepare('SELECT ts FROM events WHERE cat = ? AND id < ? ORDER BY id DESC LIMIT 1').bind(me.cat, id).first(),
    env.DB.prepare('SELECT ts FROM events WHERE cat = ? AND id > ? ORDER BY id LIMIT 1').bind(me.cat, id).first(),
  ]);
  const chk = checkEdit({ ev, prevTs: prev?.ts, nextTs: next?.ts, ts, now });
  if (!chk.ok) return json({ error: chk.code, lo: chk.lo, hi: chk.hi }, chk.code === 'bad_ts' ? 400 : 409);
  if (ts === ev.ts) return json({ ok: true, noop: true, rows: await timesList(env, me.cat, now), state: await buildState(env, me, now) });
  // One guarded write: if a neighbour appeared or moved, or the event itself changed since the read, nothing is written.
  const [upd] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE events SET ts = ?1, orig_ts = COALESCE(orig_ts, ?2), edited_by = ?3, edited_at = ?4
       WHERE id = ?5 AND cat = ?6 AND status IN ('in', 'out') AND ts = ?2
         AND ?1 >= COALESCE((SELECT ts FROM events WHERE cat = ?6 AND id < ?5 ORDER BY id DESC LIMIT 1), 0)
         AND ?1 <= COALESCE((SELECT ts FROM events WHERE cat = ?6 AND id > ?5 ORDER BY id LIMIT 1), ?4)`,
    ).bind(ts, ev.ts, me.user, now, id, me.cat),
    // An incident note hangs on the start time of its overlap: it moves with the event (only if the update above went through).
    env.DB.prepare(
      'UPDATE OR IGNORE incident_notes SET start_ts = ?1 WHERE start_ts = ?2 AND EXISTS (SELECT 1 FROM events WHERE id = ?3 AND ts = ?1 AND edited_at = ?4)',
    ).bind(ts, ev.ts, id, now),
  ]);
  if ((upd.meta?.changes ?? 0) !== 1) return json({ error: 'changed' }, 409);
  return json({ ok: true, rows: await timesList(env, me.cat, now), state: await buildState(env, me, now) });
}

// ---------- plan ----------

const slotOut = (r) => ({ id: r.id, cat: r.cat, weekday: r.weekday, start: r.start_min, end: r.end_min, remind: r.remind_min });
const insideOut = (r) => ({ id: r.id, cat: r.cat, weekday: r.weekday, start: r.start_min, end: r.end_min, date: r.on_date });

/**
 * The first of the cat's own entries that `cand` ({ kind, weekday, start, end, date }) may not overlap, or null.
 * Weekly entries (outside or inside) never overlap each other. A one-off "Drinnen" entry may sit on top of a weekly outside window
 * (that is its point: this time the cat stays in) but not on another inside entry, one-off or weekly. A new weekly entry ignores one-offs.
 */
async function conflictOwn(env, cat, cand, exceptId = 0) {
  const { results } = await env.DB.prepare('SELECT id, kind, weekday, start_min, end_min, on_date FROM schedule_slots WHERE cat = ? AND id != ?').bind(cat, exceptId).all();
  const week = (e) => ({ weekday: e.weekday, start: e.start_min, end: e.end_min });
  for (const e of results) {
    if (cand.date) {
      if (e.kind !== 'in') continue;
      if (e.on_date) {
        const off = daysBetween(cand.date, e.on_date) * DAY_MIN;
        if (cand.start < off + e.end_min && cand.end > off + e.start_min) return e;
      } else if (overlapsWeek(cand, week(e))) return e;
    } else if (!e.on_date && overlapsWeek(cand, week(e))) return e;
  }
  return null;
}

const conflict409 = (e, weekday) => json({ error: 'overlap_own', with: e.kind, weekday }, 409);

async function planRoutes(request, env, me, path, now) {
  const tz = tzOf(env), today = zoned(now, tz).date;
  if (request.method === 'GET') {
    const [out, ins] = await env.DB.batch([
      env.DB.prepare("SELECT * FROM schedule_slots WHERE kind = 'out' ORDER BY weekday, start_min"),
      // one-offs stay listed until the day after they ended (an entry can run past midnight)
      env.DB.prepare("SELECT * FROM schedule_slots WHERE kind = 'in' AND (on_date IS NULL OR on_date >= ?) ORDER BY weekday, start_min").bind(addDays(today, -1)),
    ]);
    return json({ slots: out.results.map(slotOut), inside: ins.results.map(insideOut), today });
  }
  if (request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const kind = b.kind === undefined ? 'out' : b.kind;
    if (kind !== 'out' && kind !== 'in') return json({ error: 'bad_slot' }, 400);
    const once = b.once === true;
    if (once && kind !== 'in') return json({ error: 'bad_slot' }, 400);
    const days = [...new Set((Array.isArray(b.weekdays) ? b.weekdays : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    const t = kind === 'in' && b.allDay === true ? normalize(0, DAY_MIN) : normalize(Number(b.start), Number(b.end));
    if (!days.length || !t) return json({ error: 'bad_slot' }, 400);
    const { start, end } = t;
    // A one-off entry lands on the next date (today included) that falls on each chosen weekday.
    const rows = days.map((d) => ({ weekday: d, date: once ? nextDate(today, d) : null }));
    for (const r of rows) {
      const hit = await conflictOwn(env, me.cat, { kind, weekday: r.weekday, start, end, date: r.date });
      if (hit) return conflict409(hit, r.weekday);
    }
    await env.DB.batch(rows.map((r) => env.DB.prepare('INSERT INTO schedule_slots (cat, weekday, start_min, end_min, remind_min, kind, on_date) VALUES (?, ?, ?, ?, 15, ?, ?)').bind(me.cat, r.weekday, start, end, kind, r.date)));
    return json({ ok: true });
  }
  const id = Number(path.split('/')[3]);
  const row = Number.isInteger(id) ? await env.DB.prepare('SELECT * FROM schedule_slots WHERE id = ?').bind(id).first() : null;
  if (!row) return json({ error: 'not_found' }, 404);
  if (row.cat !== me.cat) return json({ error: 'forbidden' }, 403);
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM schedule_slots WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  if (request.method === 'PUT') {
    const b = await request.json().catch(() => ({}));
    const t = row.kind === 'in' && b.allDay === true ? normalize(0, DAY_MIN) : normalize(Number(b.start), Number(b.end));
    if (!t) return json({ error: 'bad_slot' }, 400);
    const { start, end } = t;
    const hit = await conflictOwn(env, me.cat, { kind: row.kind, weekday: row.weekday, start, end, date: row.on_date }, id);
    if (hit) return conflict409(hit, row.weekday);
    await env.DB.prepare('UPDATE schedule_slots SET start_min = ?, end_min = ? WHERE id = ?').bind(start, end, id).run();
    return json({ ok: true });
  }
  return json({ error: 'method' }, 405);
}

// ---------- log (admin) ----------

async function logRoutes(request, env, me, url, now) {
  const days = clamp(Math.round(numVar(url.searchParams.get('days'), 7)), 1, 90);
  const from = now - days * 24 * HOUR;
  const events = await eventsSince(env, from);
  if (url.pathname === '/api/export') {
    // the weather at the time of each event: the nearest full hour (then the one before it), if there is a reading
    const { results: hours } = await env.DB.prepare('SELECT ts, temp, feels, code FROM weather_hours WHERE ts >= ? AND ts <= ?').bind(from - HOUR, now).all();
    const byHour = new Map(hours.map((h) => [h.ts, h]));
    const wxAt = (ts) => {
      const h = byHour.get(Math.round(ts / HOUR) * HOUR) ?? byHour.get(Math.floor(ts / HOUR) * HOUR);
      return h && h.temp !== null ? { temp: h.temp, feels: h.feels, text: describe(h.code, 1)?.text ?? '' } : null;
    };
    return json({ events: events.filter((e) => e.ts >= from).map((e) => ({ ...e, wx: wxAt(e.ts) })), tz: tzOf(env) });
  }
  const { results: notes } = await env.DB.prepare('SELECT start_ts, note FROM incident_notes WHERE start_ts >= ?').bind(from).all();
  return json(buildLog({ events, notes, now, days, tz: tzOf(env) }));
}

async function noteRoute(request, env) {
  const b = await request.json().catch(() => ({}));
  const start = Number(b.start);
  const note = String(b.note ?? '').trim().slice(0, 280);
  if (!Number.isFinite(start)) return json({ error: 'bad_note' }, 400);
  if (!note) await env.DB.prepare('DELETE FROM incident_notes WHERE start_ts = ?').bind(start).run();
  else await env.DB.prepare('INSERT INTO incident_notes (start_ts, note, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(start_ts) DO UPDATE SET note = ?2, updated_at = ?3').bind(start, note, Date.now()).run();
  return json({ ok: true });
}

// ---------- push subscriptions ----------

async function pushRoutes(request, env, me, path) {
  if (path === '/api/push/test' && request.method === 'POST') {
    const sent = await notifyUser(env, me.user, { title: 'Testnachricht', body: `Hallo ${me.name}, Benachrichtigungen funktionieren.`, tag: 'test' }, { urgency: 'normal' });
    return json({ ok: true, sent });
  }
  const b = await request.json().catch(() => ({}));
  if (request.method === 'POST') {
    const endpoint = String(b.endpoint || ''), p256dh = b.keys?.p256dh, auth = b.keys?.auth;
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) return json({ error: 'bad_subscription' }, 400);
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (user, endpoint, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(endpoint) DO UPDATE SET user = ?1, p256dh = ?3, auth = ?4`,
    ).bind(me.user, endpoint, String(p256dh), String(auth), Date.now()).run();
    // keep it tidy: at most 5 devices per person, newest win
    await env.DB.prepare(
      'DELETE FROM push_subscriptions WHERE user = ?1 AND id NOT IN (SELECT id FROM push_subscriptions WHERE user = ?1 ORDER BY id DESC LIMIT 5)',
    ).bind(me.user).run();
    return json({ ok: true });
  }
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE user = ? AND endpoint = ?').bind(me.user, String(b.endpoint || '')).run();
    return json({ ok: true });
  }
  return json({ error: 'method' }, 405);
}

// ---------- router ----------

export async function handleApi(request, env, ctx) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const me = await authenticate(request, env);
    if (!me) return json({ error: 'unauthorized' }, 401);
    const now = Date.now();
    const m = request.method;

    if (path === '/api/state' && m === 'GET') return json(await buildState(env, me, now));
    if (path === '/api/status' && m === 'POST') return setStatus(env, ctx, me, await request.json().catch(() => ({})));
    if (path === '/api/status/note' && m === 'PUT') return noteOnStatus(env, ctx, me, await request.json().catch(() => ({})));

    if (path === '/api/watch') {
      const other = otherCat(me.cat);
      if (m === 'POST') {
        const last = await lastEvents(env);
        if ((last[other]?.status ?? 'in') !== 'out') return json({ ok: true, waiting: false });
        await env.DB.prepare('INSERT OR REPLACE INTO watches (user, cat, created_at) VALUES (?, ?, ?)').bind(me.user, other, now).run();
        return json({ ok: true, waiting: true });
      }
      if (m === 'DELETE') {
        await env.DB.prepare('DELETE FROM watches WHERE user = ? AND cat = ?').bind(me.user, other).run();
        return json({ ok: true, waiting: false });
      }
    }

    if (path === '/api/plan' || path.startsWith('/api/plan/')) return planRoutes(request, env, me, path, now);
    if (path === '/api/feedings' || path.startsWith('/api/feedings/')) return feedingRoutes(request, env, ctx, me, url, now, tzOf(env));
    if (path === '/api/push' || path === '/api/push/test') return pushRoutes(request, env, me, path);
    if (path === '/api/prefs' && m === 'PUT') {
      // Each setting is optional and touches only its own column; at least one must be present.
      const b = await request.json().catch(() => ({}));
      const has = (k) => b[k] !== undefined;
      if (!has('ownPush') && !has('feedPush')) return json({ error: 'bad_prefs' }, 400);
      if ((has('ownPush') && typeof b.ownPush !== 'boolean') || (has('feedPush') && typeof b.feedPush !== 'boolean')) return json({ error: 'bad_prefs' }, 400);
      if (has('feedPush') && me.cat !== FEED_CAT) return json({ error: 'forbidden' }, 403);
      const stmts = [];
      if (has('ownPush')) stmts.push(env.DB.prepare('INSERT INTO user_prefs (user, own_push) VALUES (?1, ?2) ON CONFLICT(user) DO UPDATE SET own_push = ?2').bind(me.user, b.ownPush ? 1 : 0));
      if (has('feedPush')) stmts.push(env.DB.prepare('INSERT INTO user_prefs (user, feed_push) VALUES (?1, ?2) ON CONFLICT(user) DO UPDATE SET feed_push = ?2').bind(me.user, b.feedPush ? 1 : 0));
      await env.DB.batch(stmts);
      return json({ ok: true, state: await buildState(env, me, now) });
    }

    // Correct Rein/Raus times of the last 24 hours: admins only, always for their own cat.
    if (path === '/api/times') {
      if (!me.admin) return json({ error: 'forbidden' }, 403);
      if (m === 'GET' || m === 'POST') return timesRoute(request, env, me, now);
    }

    // Weather: the location (rounded to about 1 km) is set by an admin and lives only in the database, never in the code.
    if (path === '/api/weather/location' && m === 'PUT') {
      if (!me.admin) return json({ error: 'forbidden' }, 403);
      const b = await request.json().catch(() => ({}));
      const c = b.text != null ? parseCoords(b.text) : validCoords(b.lat, b.lon);
      if (!c) return json({ error: 'bad_location' }, 400);
      await setLocation(env, c, now);
      const fetched = await runWeather(env, Date.now(), { force: true });
      return json({ ok: true, fetched, state: await buildState(env, me, Date.now()) });
    }
    if (path === '/api/weather/refresh' && m === 'POST') {
      if (!me.admin) return json({ error: 'forbidden' }, 403);
      const { config, status } = await readWx(env);
      if (!config) return json({ error: 'no_location' }, 409);
      if (status.tried && now - status.tried < 20000) return json({ error: 'too_soon' }, 429);
      const fetched = await runWeather(env, now, { force: true });
      return json({ ok: true, fetched, state: await buildState(env, me, Date.now()) });
    }

    // "Ilford in Zahlen": only Ilford's household may see these numbers (nothing is sent to anyone else).
    if ((path === '/api/ilford' || path === '/api/ilford/daily') && m === 'GET') {
      if (me.cat !== 'ilford') return json({ error: 'forbidden' }, 403);
      const days = url.searchParams.get('days') === '30' ? 30 : 7;
      const [events, wx] = await Promise.all([
        env.DB.prepare("SELECT id, ts, status FROM events WHERE cat = 'ilford' ORDER BY ts, id").all(),
        // only the columns the day aggregation reads: fewer bytes to deserialize on the 10 ms CPU budget (a year is ~8,800 rows)
        env.DB.prepare('SELECT ts, temp, precip, snow, wind, gust, sun FROM weather_hours ORDER BY ts').all(),
      ]);
      const stats = ilfordStats({ events: events.results, now, days, tz: tzOf(env), staleMs: staleMsOf(env), wx: wx.results, withDaily: path === '/api/ilford/daily' });
      return json(path === '/api/ilford/daily' ? { daily: stats.daily ?? [], staleHours: stats.staleHours ?? null } : stats);
    }

    if (path === '/api/log' || path === '/api/export' || path === '/api/note') {
      if (!me.admin) return json({ error: 'forbidden' }, 403);
      if (path === '/api/note' && m === 'PUT') return noteRoute(request, env);
      if (m === 'GET') return logRoutes(request, env, me, url, now);
    }
    return json({ error: 'not_found' }, 404);
  } catch (e) {
    console.log('api error', String(e && e.stack ? e.stack : e).slice(0, 600));
    return json({ error: 'server' }, 500);
  }
}
