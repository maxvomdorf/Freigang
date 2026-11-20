// HTTP API. Every route except none requires a personal access code (Authorization: Bearer <code>).
import {
  CATS, CAT_NAME, PEOPLE, otherCat, userOfCat, json, clamp, MIN, HOUR, zoned, localToUtc, hhmm, numVar,
} from './util.js';
import { notifyUser } from './push.js';
import { buildLog, todayStrip } from './stats.js';
import { lastEvents, eventsSince } from './db.js';
import { normalize, overlapsWeek } from './slots.js';
import { VERSION } from './version.js';

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
    ? { status: row.status, since: row.ts, soonUntil: row.soon_until, override: !!row.override }
    : { status: 'in', since: null, soonUntil: null, override: false };
}

async function buildState(env, me, now) {
  const tz = tzOf(env);
  const last = await lastEvents(env);
  const z = zoned(now, tz);
  const dayFrom = localToUtc(z.year, z.month, z.day, 0, 0, tz);
  const ev = await eventsSince(env, dayFrom);
  const watch = await env.DB.prepare('SELECT 1 FROM watches WHERE user = ? AND cat = ?').bind(me.user, otherCat(me.cat)).first();
  const partner = me.user === 'maxime' ? 'kathrin' : 'maxime';
  const devices = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user = ?').bind(partner).first();
  return {
    now,
    tz,
    me: { user: me.user, name: me.name, cat: me.cat, admin: me.admin, other: otherCat(me.cat), otherName: me.user === 'maxime' ? 'Kathrin' : 'Maxime', partnerDevices: devices?.n ?? 0 },
    cats: { ilford: catState(last.ilford), bonnie: catState(last.bonnie) },
    waiting: !!watch,
    today: todayStrip({ events: ev, now, tz }),
    quietHours: { start: numVar(env.QUIET_START, 22), end: numVar(env.QUIET_END, 6) },
    vapidPublicKey: env.VAPID_PUBLIC_KEY || '',
    version: VERSION,
  };
}

// ---------- status ----------

function statusMessage({ cat, to, prev, otherStatus, otherSince, ts, soonMin, tz }) {
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

  let ts = now;
  const ago = clamp(Math.round(numVar(body.agoMin, 0)), 0, 240);
  if (ago > 0 && to !== 'soon') ts = Math.max(now - ago * MIN, last[cat]?.ts ?? 0);
  const soonMin = clamp(Math.round(numVar(body.soonMin, 15)), 1, 60);
  const soonUntil = to === 'soon' ? now + soonMin * MIN : null;

  const stmts = [
    env.DB.prepare(
      `INSERT INTO events (cat, status, prev_status, ts, recorded_at, actor, soon_until, override)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(cat, to, cur, ts, now, me.user, soonUntil, override),
  ];
  // A decision was made: stop waiting for the other cat. Anyone waiting for *this* cat is notified below, then cleared.
  stmts.push(env.DB.prepare('DELETE FROM watches WHERE user = ? AND cat = ?').bind(me.user, other));
  if (to === 'in') stmts.push(env.DB.prepare('DELETE FROM watches WHERE cat = ?').bind(cat));
  await env.DB.batch(stmts);

  const msg = statusMessage({ cat, to, prev: cur, otherStatus: oth, otherSince: last[other]?.ts, ts, soonMin, tz });
  ctx.waitUntil(
    notifyUser(env, userOfCat(other), { ...msg, tag: `cat-${cat}`, ts: now }, { urgency: 'high', topic: `status-${cat}` }),
  );
  return json({ ok: true, state: await buildState(env, me, now) });
}

// ---------- plan ----------

const slotOut = (r) => ({ id: r.id, cat: r.cat, weekday: r.weekday, start: r.start_min, end: r.end_min, remind: r.remind_min });

async function overlapsOwn(env, cat, weekday, start, end, exceptId = 0) {
  const { results } = await env.DB.prepare('SELECT weekday, start_min, end_min FROM schedule_slots WHERE cat = ? AND id != ?').bind(cat, exceptId).all();
  return results.some((r) => overlapsWeek({ weekday, start, end }, { weekday: r.weekday, start: r.start_min, end: r.end_min }));
}

async function planRoutes(request, env, me, path) {
  if (request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM schedule_slots ORDER BY weekday, start_min').all();
    return json({ slots: results.map(slotOut) });
  }
  if (request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const days = [...new Set((Array.isArray(b.weekdays) ? b.weekdays : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    const t = normalize(Number(b.start), Number(b.end));
    if (!days.length || !t) return json({ error: 'bad_slot' }, 400);
    const { start, end } = t;
    for (const d of days) if (await overlapsOwn(env, me.cat, d, start, end)) return json({ error: 'overlap_own', weekday: d }, 409);
    await env.DB.batch(days.map((d) => env.DB.prepare('INSERT INTO schedule_slots (cat, weekday, start_min, end_min, remind_min) VALUES (?, ?, ?, ?, 15)').bind(me.cat, d, start, end)));
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
    const t = normalize(Number(b.start), Number(b.end));
    if (!t) return json({ error: 'bad_slot' }, 400);
    const { start, end } = t;
    if (await overlapsOwn(env, me.cat, row.weekday, start, end, id)) return json({ error: 'overlap_own' }, 409);
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
    return json({ events: events.filter((e) => e.ts >= from), tz: tzOf(env) });
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

    if (path === '/api/plan' || path.startsWith('/api/plan/')) return planRoutes(request, env, me, path);
    if (path === '/api/push' || path === '/api/push/test') return pushRoutes(request, env, me, path);

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
