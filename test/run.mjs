// Integration test against `wrangler dev --local --test-scheduled` (port 8787) with a mock push service.
// Run: npx wrangler dev --local --test-scheduled  (other terminal)  then  node test/run.mjs
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createECDH, createPublicKey, verify, randomBytes } from 'node:crypto';
import { decrypt } from './push-crypto.mjs';
import { nextDate, addDays, weekdayOf } from '../src/slots.js';

const BASE = process.env.BASE || 'http://localhost:8787';
const vars = Object.fromEntries(readFileSync('.dev.vars', 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const TOK = { maxime: vars.TOKEN_MAXIME, janin: vars.TOKEN_JANIN, kathrin: vars.TOKEN_KATHRIN, linus: vars.TOKEN_LINUS, oskar: vars.TOKEN_OSKAR, annalena: vars.TOKEN_ANNALENA };
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('  FAIL', m); } else console.log('  ok  ', m); };
const api = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { authorization: 'Bearer ' + (TOK[who] ?? who), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const sql = (cmd) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'freigang', '--local', '--json', '--command', cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (b) => Buffer.from(b).toString('base64url');

// ---- mock push service that decrypts RFC 8291 messages like a browser would ----
const devices = {};
const received = [];
function device(user) {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  devices[user] = { ecdh, auth: randomBytes(16), pub: ecdh.getPublicKey() };
}
function decryptFor(user, body) { return JSON.parse(decrypt(devices[user], body).toString()); }
function checkVapid(h) {
  const m = /^vapid t=([^,]+),\s*k=(.+)$/.exec(h || '');
  if (!m) return 'no vapid header';
  const [hd, pl, sig] = m[1].split('.');
  const pub = Buffer.from(m[2], 'base64url');
  if (m[2] !== vars.VAPID_PUBLIC_KEY) return 'k mismatch';
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  const good = verify('sha256', Buffer.from(hd + '.' + pl), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  const claims = JSON.parse(Buffer.from(pl, 'base64url').toString());
  return good && claims.sub === vars.VAPID_SUBJECT && claims.aud === 'https://push.test' ? '' : 'bad jwt ' + JSON.stringify(claims);
}
const srv = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const user = req.url.split('/').pop();
    try {
      const msg = decryptFor(user, Buffer.concat(chunks));
      received.push({ user, msg, vapid: checkVapid(req.headers.authorization), enc: req.headers['content-encoding'], ttl: req.headers.ttl, urgency: req.headers.urgency, topic: req.headers.topic });
    } catch (e) { const b = Buffer.concat(chunks); received.push({ user, error: String(e) + ' len=' + b.length + ' rs=' + b.readUInt32BE(16) + ' idlen=' + b[20] + ' hdr=' + JSON.stringify(req.headers) }); }
    res.statusCode = user === 'gone' ? 410 : 201; res.end();
  });
}).listen(9911);

// ---- mock weather service (Open-Meteo shape). The worker reaches it through WEATHER_API in .dev.vars (npm run setup:local writes it). ----
const WX_URL = 'http://127.0.0.1:9912/v1/forecast';
const wxMock = { mode: 'ok', hits: 0, last: '' };
const wxSrv = http.createServer((req, res) => {
  wxMock.hits++; wxMock.last = req.url;
  const u = new URL(req.url, 'http://x');
  if (wxMock.mode === '500') { res.statusCode = 500; return res.end('boom'); }
  if (wxMock.mode === 'garbage') { res.setHeader('content-type', 'text/html'); return res.end('<html>not json'); }
  res.setHeader('content-type', 'application/json');
  if (wxMock.mode === 'error') return res.end(JSON.stringify({ error: true, reason: 'Latitude must be in range of -90 to 90°.' }));
  const past = +u.searchParams.get('past_days') || 1, cur = Math.floor(Date.now() / 3600000) * 3600;
  const time = []; for (let t = cur - past * 86400; t <= cur + 12 * 3600; t += 3600) time.push(t);
  const col = (f) => time.map((t, i) => f(t, i));
  res.end(JSON.stringify({
    latitude: +u.searchParams.get('latitude'), longitude: +u.searchParams.get('longitude'), timezone: 'GMT', utc_offset_seconds: 0,
    current: { time: cur, interval: 900, temperature_2m: 3.4, apparent_temperature: 0.9, weather_code: 3, is_day: 1, wind_speed_10m: 12.6, precipitation: 0 },
    hourly: {
      time, temperature_2m: col((t) => 2 + 4 * Math.sin(t / 43200)), apparent_temperature: col(() => 1), relative_humidity_2m: col(() => 85),
      precipitation: col((t, i) => (i % 7 === 0 ? 0.4 : 0)), snowfall: col(() => 0), weather_code: col(() => 3), cloud_cover: col(() => 90),
      wind_speed_10m: col(() => 11), wind_gusts_10m: col(() => 24), sunshine_duration: col(() => 0),
    },
  }));
}).listen(9912);

const take = (user) => { const r = received.filter((x) => x.user === user); received.length = 0; received.push(...received.filter((x) => x.user !== user)); return r; };
const drain = () => { const r = [...received]; received.length = 0; return r; };

try {
  console.log('auth');
  ok((await api('bad', 'GET', '/api/state')).status === 401, 'wrong code rejected');
  ok((await fetch(BASE + '/api/state')).status === 401, 'no code rejected');
  ok((await api('maxime', 'GET', '/api/state')).body.me.cat === 'ilford', 'Maxime owns Ilford');
  const kr = await api(vars.TOKEN_KATHRIN.toLowerCase().replace(/-/g, ' '), 'GET', '/api/state');
  ok(kr.status === 200 && kr.body.me.cat === 'bonnie' && !kr.body.me.admin, 'code is forgiving (case, spaces) and Kathrin owns Bonnie');

  console.log('reset + subscriptions');
  sql('DELETE FROM events; DELETE FROM watches; DELETE FROM sent_keys; DELETE FROM schedule_slots; DELETE FROM push_subscriptions; DELETE FROM incident_notes;');
  device('maxime'); device('kathrin');
  for (const u of ['maxime', 'kathrin']) {
    const d = devices[u];
    sql(`INSERT INTO push_subscriptions (user, endpoint, p256dh, auth, created_at) VALUES ('${u}', 'https://push.test/push/${u}', '${b64u(d.pub)}', '${b64u(d.auth)}', 1)`);
  }
  ok((await api('maxime', 'POST', '/api/push', { endpoint: 'http://x', keys: { p256dh: 'a', auth: 'b' } })).status === 400, 'non-https subscription rejected');
  ok((await api('maxime', 'POST', '/api/push', { endpoint: 'https://push.example/abc', keys: { p256dh: 'a', auth: 'b' } })).status === 200, 'https subscription stored');
  sql("DELETE FROM push_subscriptions WHERE endpoint LIKE 'https://push.example/%'");

  console.log('status flow');
  let r = await api('maxime', 'POST', '/api/status', { to: 'soon', soonMin: 10 });
  ok(r.body.state.cats.ilford.status === 'soon' && r.body.state.cats.ilford.soonUntil > Date.now(), 'Maxime: leaving soon with countdown');
  await sleep(1500);
  let p = drain();
  if (p[0]?.error) console.log('   ', p[0].error);
  ok(p.length === 1 && p[0].user === 'kathrin' && /kommt in 10 Min raus/.test(p[0].msg?.title || ''), 'Kathrin got the early warning, decrypted correctly: ' + JSON.stringify(p[0]?.msg?.title));
  ok(p[0] && p[0].vapid === '' && p[0].enc === 'aes128gcm' && p[0].topic === 'status-ilford' && p[0].urgency === 'high', 'VAPID JWT valid, aes128gcm, topic and urgency set ' + (p[0]?.vapid || ''));
  r = await api('maxime', 'POST', '/api/status', { to: 'soon' });
  ok(r.body.noop === true, 'repeat tap is a no-op');
  r = await api('maxime', 'POST', '/api/status', { to: 'out' });
  ok(r.body.state.cats.ilford.status === 'out', 'Maxime: Ilford out');
  await sleep(1200); p = drain();
  ok(p.length === 1 && /Ilford ist jetzt draußen/.test(p[0].msg.title) && /Bonnie bleibt/.test(p[0].msg.body), 'Kathrin notified: ' + p[0]?.msg?.title);

  console.log('conflict guard');
  r = await api('kathrin', 'POST', '/api/status', { to: 'out' });
  ok(r.status === 409 && r.body.error === 'conflict' && r.body.other.cat === 'ilford', 'Kathrin blocked while Ilford is out (server side)');
  r = await api('kathrin', 'POST', '/api/status', { to: 'soon' });
  ok(r.status === 200, '...but "soon" is allowed');
  await sleep(800); drain();
  r = await api('kathrin', 'POST', '/api/status', { to: 'in' });
  r = await api('maxime', 'POST', '/api/status', { to: 'in' });
  await sleep(1000); drain();
  r = await api('kathrin', 'POST', '/api/status', { to: 'out' });
  await sleep(1000); drain();
  r = await api('maxime', 'POST', '/api/status', { to: 'out' });
  ok(r.status === 409, 'Maxime blocked while Bonnie is out');
  r = await api('maxime', 'POST', '/api/watch');
  ok(r.body.waiting === true, 'Maxime waits for Bonnie');
  ok((await api('maxime', 'GET', '/api/state')).body.waiting === true, 'state shows waiting');
  r = await api('kathrin', 'POST', '/api/status', { to: 'in' });
  await sleep(1200); p = drain();
  ok(p.length === 1 && p[0].user === 'maxime' && /Bonnie ist wieder drin/.test(p[0].msg.title) && /Ilford kann raus/.test(p[0].msg.body), 'waiting Maxime told Ilford can go out');
  ok((await api('maxime', 'GET', '/api/state')).body.waiting === false, 'watch cleared once she is in');
  await api('kathrin', 'POST', '/api/status', { to: 'out' }); await sleep(800); drain();
  r = await api('maxime', 'POST', '/api/status', { to: 'out', force: true, note: 'In Begleitung' });
  ok(r.status === 200 && r.body.state.cats.ilford.override === true && r.body.state.cats.ilford.note === 'In Begleitung', 'forced out is recorded as override and keeps the note');
  await sleep(1000); p = drain();
  ok(p.length === 1 && /beide draußen/.test(p[0].msg.title), 'Kathrin warned: both outside (' + p[0]?.msg?.body + ')');
  r = await api('maxime', 'PUT', '/api/status/note', { note: 'Nur kurz draußen' });
  await sleep(1200); p = drain();
  ok(p.length === 1 && /beide draußen/.test(p[0].msg.title) && /Nur kurz draußen/.test(p[0].msg.body) && p[0].urgency === 'high' && p[0].topic === 'status-ilford', 'a note change keeps the "both outside" warning and its urgency: ' + p[0]?.msg?.title + ' / ' + p[0]?.msg?.body);
  sql('UPDATE events SET ts = ts - 1800000'); // the whole history so far happened 30 min ago
  r = await api('maxime', 'POST', '/api/status', { to: 'in', agoMin: 10 });
  const back = r.body.state.cats.ilford;
  ok(back.status === 'in' && Math.abs(Date.now() - back.since - 600000) < 5000, 'backdating: came in 10 min ago');
  await sleep(1000); drain();
  r = await api('maxime', 'POST', '/api/status', { to: 'in', agoMin: 500 });
  ok(r.status === 200 && r.body.noop === true, 'already inside: no new event');
  await api('kathrin', 'POST', '/api/status', { to: 'in' }); await sleep(800); drain();

  console.log('status note');
  r = await api('maxime', 'POST', '/api/status', { to: 'soon', soonMin: 15, note: '  Mit   Leine\nim Garten ' });
  ok(r.body.state.cats.ilford.note === 'Mit Leine im Garten', 'note is normalised and stored: ' + r.body.state.cats.ilford.note);
  await sleep(1200); p = drain();
  ok(p.length === 1 && /„Mit Leine im Garten“/.test(p[0].msg.body), 'early-warning push carries the note: ' + p[0]?.msg?.body);
  r = await api('maxime', 'POST', '/api/status', { to: 'out' });
  ok(r.body.state.cats.ilford.status === 'out' && r.body.state.cats.ilford.note === 'Mit Leine im Garten', 'soon -> out keeps the note');
  await sleep(1200); p = drain();
  ok(p.length === 1 && /„Mit Leine im Garten“/.test(p[0].msg.body), 'out push carries the carried-over note');
  ok((await api('kathrin', 'GET', '/api/state')).body.cats.ilford.note === 'Mit Leine im Garten', 'Kathrin sees the note');
  r = await api('maxime', 'PUT', '/api/status/note', { note: 'Nur kurz draußen' });
  ok(r.status === 200 && r.body.state.cats.ilford.note === 'Nur kurz draußen', 'note can be changed while out');
  await sleep(1200); p = drain();
  ok(p.length === 1 && p[0].user === 'kathrin' && p[0].msg.update === true && p[0].msg.tag === 'cat-ilford' && /Nur kurz draußen/.test(p[0].msg.body), 'change replaces the earlier notification quietly: ' + JSON.stringify(p[0]?.msg));
  r = await api('maxime', 'PUT', '/api/status/note', { note: 'Nur kurz draußen' });
  await sleep(800); ok(drain().length === 0, 'same note again sends no push');
  r = await api('kathrin', 'PUT', '/api/status/note', { note: 'Fremd' });
  ok(r.status === 409, 'Kathrin cannot set a note while Bonnie is inside');
  ok((await api('maxime', 'GET', '/api/state')).body.cats.ilford.note === 'Nur kurz draußen', "Kathrin's attempt left Ilford's note alone");
  r = await api('maxime', 'PUT', '/api/status/note', { note: '' });
  ok(r.body.state.cats.ilford.note === '', 'empty note clears it');
  await sleep(800); ok(drain().length === 0, 'clearing sends no push');
  r = await api('maxime', 'PUT', '/api/status/note', { note: 'Wieder da' });
  r = await api('maxime', 'POST', '/api/status', { to: 'in', note: 'ignored' });
  ok(r.body.state.cats.ilford.note === '', 'coming inside drops the note, even if one is sent');
  await sleep(800); drain();
  r = await api('maxime', 'PUT', '/api/status/note', { note: 'Zu spät' });
  ok(r.status === 409, 'no note change while inside');
  r = await api('maxime', 'POST', '/api/status', { to: 'soon', note: 'A' });
  r = await api('maxime', 'POST', '/api/status', { to: 'out', note: '' });
  ok(r.body.state.cats.ilford.note === '', 'explicit empty note on "out" clears the carried one');
  await api('maxime', 'POST', '/api/status', { to: 'in' });
  r = await api('maxime', 'POST', '/api/status', { to: 'out', note: 'x'.repeat(90) });
  ok(r.body.state.cats.ilford.note.length === 40, 'long note is capped at 40');
  r = await api('maxime', 'POST', '/api/status', { to: 'in' });
  const exp = (await api('maxime', 'GET', '/api/export?days=1')).body.events;
  ok(exp.some((e) => e.note === 'Mit Leine im Garten'), 'export carries the note column');
  await sleep(1000); drain();

  console.log('plan');
  const z = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date());
  const g = (t) => z.find((x) => x.type === t).value;
  const wd = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[g('weekday')];
  const nowMin = +g('hour') * 60 + +g('minute');
  // From 23:00 on, a window that starts in 6-10 minutes would begin after midnight (or on the next weekday), so the reminder checks
  // are skipped then (printed) and the slot goes to 10:00 instead. Otherwise a push late in the evening would turn CI red and stop the deploy.
  const lateEve = nowMin >= 1380;
  const start = lateEve ? 600 : Math.ceil((nowMin + 6) / 5) * 5;
  r = await api('maxime', 'POST', '/api/plan', { weekdays: [wd], start, end: start + 30 });
  ok(r.status === 200 && start + 45 <= 1440, 'slot created for today');
  ok((await api('maxime', 'POST', '/api/plan', { weekdays: [wd], start: start + 10, end: start + 20 })).status === 409, 'own overlapping slot rejected');
  const slots = (await api('kathrin', 'GET', '/api/plan')).body.slots;
  ok(slots.length === 1 && slots[0].cat === 'ilford', 'Kathrin sees Ilford\'s slot');
  ok((await api('kathrin', 'DELETE', '/api/plan/' + slots[0].id)).status === 403, 'Kathrin cannot touch Ilford\'s slot');
  ok((await api('maxime', 'PUT', '/api/plan/' + slots[0].id, { start, end: start + 45 })).status === 200, 'Maxime can edit his slot');
  // no time limit: night and overnight windows (on days far from today so the reminder test stays clean)
  const dA = (wd + 3) % 7, dB = (wd + 4) % 7;
  ok((await api('maxime', 'POST', '/api/plan', { weekdays: [dA], start: 22 * 60, end: 2 * 60 })).status === 200, 'overnight window 22:00–02:00 accepted');
  const night = (await api('maxime', 'GET', '/api/plan')).body.slots.find((x) => x.weekday === dA);
  ok(night && night.start === 1320 && night.end === 1560, 'overnight window stored with end past midnight: ' + JSON.stringify(night));
  ok((await api('maxime', 'POST', '/api/plan', { weekdays: [dB], start: 60, end: 180 })).status === 409, 'window overlapping the overnight one on the next day is rejected');
  ok((await api('maxime', 'POST', '/api/plan', { weekdays: [dB], start: 120, end: 180 })).status === 200, 'window right after the overnight one is fine');
  ok((await api('maxime', 'POST', '/api/plan', { weekdays: [dB], start: 600, end: 600 })).status === 400, 'equal start and end rejected');
  ok((await api('kathrin', 'POST', '/api/plan', { weekdays: [dA], start: 23 * 60, end: 30 })).status === 200, 'Bonnie can have an overlapping overnight window');
  for (const x of (await api('maxime', 'GET', '/api/plan')).body.slots.filter((x) => x.weekday !== wd)) await api(x.cat === 'ilford' ? 'maxime' : 'kathrin', 'DELETE', '/api/plan/' + x.id);
  ok((await api('maxime', 'GET', '/api/plan')).body.slots.length === 1, 'night test windows removed again');
  if (lateEve) console.log('  skip  slot starts within the next 10 min (late evening)');
  else ok(start - 10 <= nowMin + 10 && start > nowMin, 'slot starts within the next 10 min (reminder window)');

  console.log('cron');
  const cron = async () => (await fetch(BASE + '/__scheduled?cron=*+*+*+*+*')).status;
  ok((await cron()) === 200, 'scheduled handler runs');
  await sleep(1500); p = drain();
  const hr = new Date().getHours();
  if (lateEve) console.log('  skip  plan reminder reaches Maxime (late evening)');
  else ok(p.some((x) => x.user === 'maxime' && /Ilford darf raus/.test(x.msg.title)), 'Maxime got the plan reminder');
  await cron(); await sleep(1000); p = drain();
  ok(!p.some((x) => /darf raus/.test(x.msg.title)), 'reminder not sent twice');

  // countdown ran out
  await api('maxime', 'POST', '/api/status', { to: 'soon', soonMin: 1 }); await sleep(800); drain();
  sql('UPDATE events SET soon_until = soon_until - 120000 WHERE status = \'soon\'');
  await cron(); await sleep(1200); p = drain();
  ok(p.some((x) => x.user === 'maxime' && /Auf geht’s/.test(x.msg.title)), '"Auf geht’s" nudge to the owner');
  await cron(); await sleep(800);
  ok(drain().length === 0, 'nudge not repeated');
  // stale outside
  await api('maxime', 'POST', '/api/status', { to: 'out' }); await sleep(800); drain();
  sql('UPDATE events SET ts = ts - 18600000'); // shift the whole history 5 h 10 min back so Ilford has been outside that long
  await cron(); await sleep(1200); p = drain();
  ok(p.some((x) => x.user === 'maxime' && /Noch draußen/.test(x.msg.title) && /5 Std/.test(x.msg.body)), 'stale "still outside?" nudge: ' + p.map((x) => x.msg?.body));
  // quiet hours: nothing but status pushes
  await api('maxime', 'POST', '/api/status', { to: 'in' }); await sleep(800); drain();

  console.log('log (admin only)');
  ok((await api('kathrin', 'GET', '/api/log')).status === 403, 'Kathrin cannot read the log');
  ok((await api('kathrin', 'PUT', '/api/note', { start: 1, note: 'x' })).status === 403, 'Kathrin cannot write notes');
  const log = await api('maxime', 'GET', '/api/log?days=7');
  ok(log.status === 200 && log.body.rows.length === 7 && log.body.heat.ilford.length === 24, 'log has 7 day rows and 24 heat cells');
  ok(log.body.incidents.length === 1 && log.body.kpi.overlaps === 1 && log.body.kpi.overrides === 1, 'one overlap, from the forced exit: ' + JSON.stringify(log.body.kpi));
  ok(log.body.kpi.overlapMinutes >= 19 && log.body.kpi.overlapMinutes <= 21, 'overlap lasted about 20 min');
  const inc = log.body.incidents.find((i) => i.override) || {};
  ok(!!inc && inc.second === 'ilford', 'incident marked as override, second cat = Ilford');
  ok(inc.catNote === 'Nur kurz draußen', 'incident shows the second cat\'s current note: ' + inc.catNote);
  ok((await api('maxime', 'PUT', '/api/note', { start: inc.start, note: 'Fauchen am Zaun gehört' })).status === 200, 'note saved');
  ok((await api('maxime', 'GET', '/api/log?days=7')).body.incidents.find((i) => i.start === inc.start).note.startsWith('Fauchen'), 'note appears on the incident');
  const ex = await api('maxime', 'GET', '/api/export?days=30');
  ok(ex.body.events.length > 10, 'export returns raw events (' + ex.body.events.length + ')');

  console.log('push housekeeping');
  sql(`INSERT INTO push_subscriptions (user, endpoint, p256dh, auth, created_at) VALUES ('kathrin', 'https://push.test/push/gone', '${b64u(devices.kathrin.pub)}', '${b64u(devices.kathrin.auth)}', 2)`);
  await api('kathrin', 'POST', '/api/push/test'); await sleep(1200);
  const left = JSON.parse(sql("SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint LIKE '%/gone'"))[0].results[0].n;
  ok(left === 0, 'subscription answered with 410 is deleted');
  ok(drain().some((x) => x.user === 'kathrin' && /Testnachricht/.test(x.msg.title)), 'test push reaches Kathrin');
  console.log('household: several people per cat');
  sql('DELETE FROM events; DELETE FROM watches; DELETE FROM sent_keys; DELETE FROM schedule_slots; DELETE FROM push_subscriptions; DELETE FROM user_prefs;');
  const crew = ['maxime', 'janin', 'kathrin', 'linus', 'oskar', 'annalena'];
  for (const u of crew) {
    device(u); const d = devices[u];
    sql(`INSERT INTO push_subscriptions (user, endpoint, p256dh, auth, created_at) VALUES ('${u}', 'https://push.test/push/${u}', '${b64u(d.pub)}', '${b64u(d.auth)}', 1)`);
  }
  const ja = await api('janin', 'GET', '/api/state'), li = await api('linus', 'GET', '/api/state'), an = await api('annalena', 'GET', '/api/state');
  ok(ja.body.me.name === 'Janin' && ja.body.me.cat === 'ilford' && ja.body.me.admin === true, 'Janin looks after Ilford and is an admin');
  ok(ja.body.me.otherName === 'Kathrin' && li.body.me.otherName === 'Maxime' && an.body.me.otherName === 'Maxime', 'the other side is always shown as Kathrin / Maxime');
  ok(li.body.me.cat === 'bonnie' && an.body.me.name === 'Anna-Lena' && an.body.me.cat === 'bonnie', 'Linus and Anna-Lena look after Bonnie');
  ok(ja.body.me.partnerDevices === 4, 'Janin sees 4 devices on the other side: ' + ja.body.me.partnerDevices);
  ok((await api('janin', 'GET', '/api/log?days=7')).status === 200 && (await api('janin', 'GET', '/api/export?days=7')).status === 200, 'Janin (admin) can open the log and export');
  ok((await api('linus', 'GET', '/api/log?days=7')).status === 403, 'Linus cannot open the log');
  ok((await api('oskar', 'GET', '/api/export?days=7')).status === 403, 'Oskar cannot export');
  ok((await api('janin', 'POST', '/api/status', { to: 'soon', soonMin: 10 })).body.state.cats.ilford.status === 'soon', 'Janin announces Ilford');
  await sleep(1500); p = drain();
  const who = (list) => list.map((x) => x.user).sort().join(',');
  ok(who(p) === 'annalena,kathrin,linus,maxime,oskar', 'push reaches all of Bonnie\'s side and Maxime, not Janin herself: ' + who(p));
  ok(/\(von Janin\)/.test(p.find((x) => x.user === 'maxime')?.msg.body || '') && !/von Janin/.test(p.find((x) => x.user === 'linus')?.msg.body || ''), 'own household sees who did it, the other side gets the plain text');
  ok(p.every((x) => x.msg?.title === 'Ilford kommt in 10 Min raus'), 'same title for everybody');
  ok((await api('maxime', 'PUT', '/api/prefs', { ownPush: 'nein' })).status === 400, 'prefs must be a boolean');
  const pr = await api('maxime', 'PUT', '/api/prefs', { ownPush: false });
  ok(pr.status === 200 && pr.body.state.prefs.ownPush === false && (await api('janin', 'GET', '/api/state')).body.prefs.ownPush === true, 'Maxime turns household messages off, Janin keeps hers');
  await api('janin', 'POST', '/api/status', { to: 'out' }); await sleep(1500); p = drain();
  ok(who(p) === 'annalena,kathrin,linus,oskar', 'with the setting off, Maxime gets nothing from Janin: ' + who(p));
  await api('maxime', 'PUT', '/api/prefs', { ownPush: true });
  ok((await api('linus', 'POST', '/api/status', { to: 'out' })).status === 409, 'the conflict guard applies to Linus as well');
  ok((await api('linus', 'POST', '/api/status', { to: 'out', force: true })).body.state.cats.bonnie.override === true, 'Linus can go anyway (override)');
  await sleep(1500); p = drain();
  ok(who(p) === 'annalena,janin,kathrin,maxime,oskar', 'Linus: Ilford\'s side plus the rest of his own household: ' + who(p));
  ok(/\(von Linus\)/.test(p.find((x) => x.user === 'kathrin')?.msg.body || '') && !/von Linus/.test(p.find((x) => x.user === 'maxime')?.msg.body || ''), 'only his own household sees "(von Linus)"');
  ok((await api('janin', 'POST', '/api/status', { to: 'in' })).body.state.cats.ilford.status === 'in', 'Janin brings Ilford in'); await sleep(1000); drain();
  ok((await api('oskar', 'POST', '/api/status', { to: 'in' })).body.state.cats.bonnie.status === 'in', 'Oskar brings Bonnie in (everybody may switch their cat)'); await sleep(1000); drain();
  // nudges go to the whole household
  await api('janin', 'POST', '/api/status', { to: 'out' }); await sleep(800); drain();
  sql('UPDATE events SET ts = ts - 18600000');
  await fetch(BASE + '/__scheduled?cron=*+*+*+*+*'); await sleep(1500); p = drain();
  ok(who(p.filter((x) => /Noch draußen/.test(x.msg?.title))) === 'janin,maxime', '"Noch draußen?" goes to everybody who looks after Ilford: ' + who(p));
  ok((await api('janin', 'POST', '/api/plan', { weekdays: [3], start: 600, end: 660 })).status === 200 && (await api('maxime', 'GET', '/api/plan')).body.slots.some((x) => x.cat === 'ilford'), 'Janin can plan Ilford\'s windows');
  sql('DELETE FROM schedule_slots;');

  console.log('plan: drinnen bleiben');
  sql('DELETE FROM events; DELETE FROM watches; DELETE FROM sent_keys; DELETE FROM schedule_slots;'); drain();
  const berlin = () => {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date());
    const q = (t) => f.find((x) => x.type === t).value;
    return { wd: { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[q('weekday')], min: +q('hour') * 60 + +q('minute') };
  };
  const plan = async (who2) => (await api(who2, 'GET', '/api/plan')).body;
  const now0 = berlin();
  if (now0.min >= 1430 || now0.min < 3) console.log('  skip  (too close to midnight: the date could change during the test)');
  else {
    const pl0 = await plan('linus');
    ok(Array.isArray(pl0.slots) && Array.isArray(pl0.inside) && /^\d{4}-\d{2}-\d{2}$/.test(pl0.today) && weekdayOf(pl0.today) === now0.wd, 'plan answer carries {slots, inside, today}: ' + pl0.today);
    const today = pl0.today, tomorrow = addDays(today, 1), wdT = (now0.wd + 1) % 7;
    ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [now0.wd], once: true, allDay: true })).status === 200, 'Linus plans Bonnie inside for today (one-off, all day)');
    let pi = (await plan('maxime')).inside;
    ok(pi.length === 1 && pi[0].cat === 'bonnie' && pi[0].date === today && pi[0].weekday === now0.wd && pi[0].start === 0 && pi[0].end === 1440, 'stored as a dated entry 0:00–24:00, and Maxime sees it: ' + JSON.stringify(pi[0]));
    ok((await plan('maxime')).slots.length === 0, 'inside entries do not show up among the outside windows');
    let ist = (await api('maxime', 'GET', '/api/state')).body.insideNow;
    ok(ist.bonnie?.whole === true && ist.bonnie.until === 1440 && ist.ilford === null, 'state: Bonnie planned inside the whole day, Ilford not: ' + JSON.stringify(ist));
    const o2 = await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [now0.wd], once: true, start: 600, end: 660 });
    ok(o2.status === 409 && o2.body.error === 'overlap_own' && o2.body.with === 'in' && o2.body.weekday === now0.wd, 'a second one-off on the same day overlaps the first (with: in): ' + JSON.stringify(o2.body));
    ok((await api('maxime', 'POST', '/api/plan', { kind: 'in', weekdays: [now0.wd], once: true, allDay: true })).status === 200, 'the other cat may have its own entry on the same day');
    ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [now0.wd], once: true, start: 600, end: 660 })).status === 409 && (await plan('linus')).inside.length === 2, 'nothing was stored by the rejected call');
    sql('DELETE FROM schedule_slots;');

    // validation
    ok((await api('linus', 'POST', '/api/plan', { kind: 'weg', weekdays: [1], start: 600, end: 660 })).status === 400, 'unknown kind: 400');
    ok((await api('linus', 'POST', '/api/plan', { kind: 'out', weekdays: [1], once: true, start: 600, end: 660 })).status === 400, 'a one-off outside window does not exist: 400');
    ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [1] })).status === 400, 'inside without times and without allDay: 400');
    ok((await api('linus', 'POST', '/api/plan', { weekdays: [1], start: 600, end: 660 })).status === 200 && (await plan('linus')).slots.length === 1, 'a request without kind still creates an outside window (old clients)');
    ok((await api('linus', 'POST', '/api/plan', { kind: 'out', weekdays: [1], allDay: true })).status === 400, 'allDay is for inside entries only');
    sql('DELETE FROM schedule_slots;');

    // weekly vs weekly, one-off on top of a weekly outside window
    ok((await api('linus', 'POST', '/api/plan', { kind: 'out', weekdays: [2], start: 600, end: 720 })).status === 200, 'weekly outside window Wed 10:00–12:00');
    const wi = await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [2], start: 660, end: 780 });
    ok(wi.status === 409 && wi.body.with === 'out', 'a weekly inside entry may not overlap a weekly outside window (with: out)');
    ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [2], start: 720, end: 780 })).status === 200, 'weekly inside entry right after it is fine');
    const wo = await api('linus', 'POST', '/api/plan', { kind: 'out', weekdays: [2], start: 730, end: 770 });
    ok(wo.status === 409 && wo.body.with === 'in', 'and the other way round (with: in)');
    const wnext = (await plan('linus')).inside.find((x) => x.date === null);
    ok((await api('linus', 'PUT', '/api/plan/' + wnext.id, { start: 700, end: 780 })).status === 409, 'editing a weekly entry into the outside window is rejected as well');
    ok((await api('linus', 'PUT', '/api/plan/' + wnext.id, { allDay: true })).status === 409, 'a weekly entry made all-day would overlap the window: rejected');
    ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [2], once: true, start: 630, end: 690 })).status === 200, 'a one-off inside entry may sit on a weekly outside window (that cancels it)');
    const ow = await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [2], once: true, start: 700, end: 760 });
    ok(ow.status === 409 && ow.body.with === 'in', 'a one-off may not overlap a weekly inside entry (it would be pointless): ' + JSON.stringify(ow.body));
    const dWed = nextDate(today, 2);
    const ones = (await plan('linus')).inside.filter((x) => x.date);
    ok(ones.length >= 1 && ones.every((x) => x.date === dWed), 'the one-off lands on the next Wednesday: ' + dWed);
    ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [2], once: true, start: 640, end: 650 })).status === 409, 'one-offs may not overlap each other');
    ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [2], start: 800, end: 900 })).status === 200, 'a new weekly entry ignores the one-offs');
    const keepW = (await plan('linus')).inside.filter((x) => x.date).map((x) => x.id);
    ok((await api('oskar', 'DELETE', '/api/plan/' + keepW[0])).status === 200, 'every person of the household may delete the cat\'s entries');
    ok((await api('maxime', 'DELETE', '/api/plan/' + keepW[0])).status === 404, 'already gone: 404');
    sql('DELETE FROM schedule_slots;');
    // overnight one-off covers the start of the next day
    ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [now0.wd], once: true, start: 22 * 60, end: 2 * 60 })).status === 200, 'overnight one-off 22:00–02:00 accepted');
    ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [wdT], once: true, start: 60, end: 120 })).status === 409, '...and it blocks an entry in its night hours on the next day');
    ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [wdT], once: true, start: 120, end: 180 })).status === 200, '...while one right after it is fine');
    sql('DELETE FROM schedule_slots;');

    // the one-off cancels an outside window's reminder (when it covers the window's start), per cat
    // (the window starts in 6-10 minutes and lasts 20: from 22:30 on it would run past midnight, so these checks are skipped then and a late push does not turn CI red)
    const ref = berlin();
    if (ref.min >= 1350) console.log('  skip  reminder checks (late evening)');
    else {
      const wS = Math.ceil((ref.min + 6) / 5) * 5; // an outside window starting in 6–10 minutes
      ok(wS + 20 <= 1380, 'test window starts today at ' + wS);
      ok((await api('linus', 'POST', '/api/plan', { kind: 'out', weekdays: [ref.wd], start: wS, end: wS + 20 })).status === 200, 'Bonnie\'s outside window starts in a few minutes');
      const cronOnce = async () => { await fetch(BASE + '/__scheduled?cron=*+*+*+*+*'); await sleep(1500); return drain(); };
      const remFor = (list) => list.filter((x) => /darf raus/.test(x.msg?.title || ''));
      ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [ref.wd], once: true, start: Math.max(0, wS - 30), end: wS + 10 })).status === 200, 'Linus plans Bonnie inside around that window (one-off)');
      ok((await api('maxime', 'POST', '/api/plan', { kind: 'in', weekdays: [ref.wd], once: true, allDay: true })).status === 200, 'Maxime plans Ilford inside the whole day (other cat)');
      ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [wdT], once: true, allDay: true })).status === 200, 'Linus also plans tomorrow inside');
      let pc = await cronOnce();
      ok(remFor(pc).length === 0, 'the covered window sends no reminder: ' + JSON.stringify(remFor(pc).map((x) => x.msg.title)));
      const bonnieIn = (await plan('linus')).inside.find((x) => x.cat === 'bonnie' && x.date === today && x.end === wS + 10);
      await api('linus', 'DELETE', '/api/plan/' + bonnieIn.id);
      // an entry that ends before the window starts does not cancel it, and neither does another day or the other cat
      ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [ref.wd], once: true, start: Math.max(0, wS - 120), end: wS })).status === 200, 'inside until exactly the window start: the entry ends where the window begins');
      pc = await cronOnce();
      ok(who(remFor(pc)) === 'annalena,kathrin,linus,oskar', 'then the reminder goes out to Bonnie\'s household (Ilford\'s all-day entry and tomorrow\'s entry do not matter): ' + who(remFor(pc)));
      pc = await cronOnce();
      ok(remFor(pc).length === 0, 'reminder not sent twice');
      sql('DELETE FROM schedule_slots; DELETE FROM sent_keys;'); drain();

      // weekly inside entries send nothing and change nothing for the window of another day
      ok((await api('linus', 'POST', '/api/plan', { kind: 'out', weekdays: [ref.wd], start: wS, end: wS + 20 })).status === 200, 'window again');
      ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [(ref.wd + 3) % 7], allDay: true })).status === 200, 'weekly all-day inside entry on another weekday');
      pc = await cronOnce();
      ok(who(remFor(pc)) === 'annalena,kathrin,linus,oskar', 'a weekly inside entry on another weekday leaves the reminder alone: ' + who(remFor(pc)));
      sql('DELETE FROM schedule_slots; DELETE FROM sent_keys;'); drain();
    }

    // a weekly inside entry covering the window start cannot be created (409), so only one-offs cancel
    // "state.insideNow" with a timed entry: until = end of the entry
    const nowB = berlin();
    if (nowB.min < 1437) {
      sql(`INSERT INTO schedule_slots (cat, weekday, start_min, end_min, remind_min, kind, on_date) VALUES ('bonnie', ${nowB.wd}, 0, 1439, 15, 'in', NULL)`);
      ist = (await api('kathrin', 'GET', '/api/state')).body.insideNow;
      ok(ist.bonnie?.whole === false && ist.bonnie.until === 1439 && ist.ilford === null, 'weekly entry 0:00–23:59 gives until=1439, not whole: ' + JSON.stringify(ist));
    }
    sql('DELETE FROM schedule_slots;');
    sql(`INSERT INTO schedule_slots (cat, weekday, start_min, end_min, remind_min, kind, on_date) VALUES ('bonnie', ${(nowB.wd + 6) % 7}, 1380, 1560, 15, 'in', NULL)`);
    if (nowB.min < 120) {
      ist = (await api('kathrin', 'GET', '/api/state')).body.insideNow;
      ok(ist.bonnie?.until === 120 && ist.bonnie.whole === false, 'an overnight entry from yesterday still covers the early morning (until 02:00): ' + JSON.stringify(ist.bonnie));
    } else {
      ok((await api('kathrin', 'GET', '/api/state')).body.insideNow.bonnie === null, 'yesterday\'s overnight entry does not cover the afternoon');
    }
    sql('DELETE FROM schedule_slots;');

    // plan entries never create a "both outside" warning, and "Drinnen" does not block letting the cat out
    ok((await api('linus', 'POST', '/api/plan', { kind: 'in', weekdays: [now0.wd], once: true, allDay: true })).status === 200, 'Bonnie planned inside today');
    const outAnyway = await api('linus', 'POST', '/api/status', { to: 'out' });
    ok(outAnyway.status === 200 && outAnyway.body.state.cats.bonnie.status === 'out' && outAnyway.body.state.insideNow.bonnie !== null, 'the server lets Bonnie out anyway (the plan only informs): ' + outAnyway.status);
    await sleep(1000); drain();
    await api('linus', 'POST', '/api/status', { to: 'in' }); await sleep(800); drain();
    // housekeeping statement (runs at 04:00 local): removes one-offs older than two days, keeps yesterday and weekly entries
    sql('DELETE FROM schedule_slots;');
    sql(`INSERT INTO schedule_slots (cat, weekday, start_min, end_min, remind_min, kind, on_date) VALUES ('bonnie', 0, 0, 1440, 15, 'in', '${addDays(today, -3)}'), ('bonnie', 0, 0, 1440, 15, 'in', '${addDays(today, -2)}'), ('bonnie', 0, 0, 1440, 15, 'in', '${addDays(today, -1)}'), ('bonnie', 0, 0, 1440, 15, 'in', NULL)`);
    sql(`DELETE FROM schedule_slots WHERE on_date IS NOT NULL AND on_date < '${addDays(today, -2)}'`);
    ok(JSON.parse(sql('SELECT COUNT(*) AS n FROM schedule_slots'))[0].results[0].n === 3, 'housekeeping statement keeps the last two days and weekly entries');
    const listed = (await plan('linus')).inside.filter((x) => x.date);
    ok(listed.length === 1 && listed[0].date === addDays(today, -1), 'the plan list shows one-offs only from yesterday on (older ones are filtered even before the cleanup): ' + listed.map((x) => x.date));
    sql('DELETE FROM schedule_slots; DELETE FROM sent_keys; DELETE FROM events;'); drain();
  }

  console.log('feeding tracker (Bonnie\'s household only)');
  sql('DELETE FROM feedings; DELETE FROM user_prefs; DELETE FROM sent_keys;'); drain();
  const feedUsers = (list) => who(list.filter((x) => x.msg?.tag === 'feed-bonnie'));
  const fm = await api('maxime', 'GET', '/api/state'), fl = await api('linus', 'GET', '/api/state');
  ok(fm.body.feeding === undefined && fm.body.prefs.feedPush === undefined, 'Ilford\'s side gets no feeding data in the state');
  ok(fl.body.feeding?.last === null && fl.body.feeding.hintMin === 60 && fl.body.feeding.undoMin === 10 && fl.body.prefs.feedPush === true, 'Bonnie\'s side: nothing fed yet, hint 60 min, undo 10 min, feed push on by default');
  for (const who2 of ['maxime', 'janin']) {
    ok((await api(who2, 'GET', '/api/feedings')).status === 403 && (await api(who2, 'POST', '/api/feedings')).status === 403 && (await api(who2, 'DELETE', '/api/feedings/1')).status === 403, `${who2} gets 403 on every feeding route`);
  }
  ok((await api('maxime', 'PUT', '/api/prefs', { feedPush: false })).status === 403, 'Ilford\'s people cannot set the feeding push');
  ok((await api('linus', 'PUT', '/api/prefs', {})).status === 400 && (await api('linus', 'PUT', '/api/prefs', { feedPush: 'nein' })).status === 400, 'prefs need at least one boolean');
  ok((await api('linus', 'GET', '/api/feedings')).body.feedings.length === 0, 'list starts empty');

  let f1 = await api('linus', 'POST', '/api/feedings');
  ok(f1.status === 200 && f1.body.entry.mine === true && f1.body.entry.undoable === true && f1.body.entry.name === 'Linus', 'Linus feeds Bonnie');
  await sleep(1500); p = drain();
  ok(feedUsers(p) === 'annalena,kathrin,oskar', 'push goes to the rest of Bonnie\'s household, not to Linus, never to Ilford\'s people: ' + feedUsers(p));
  const fp = p.find((x) => x.user === 'kathrin')?.msg;
  ok(/Linus/.test(fp?.body || '') && /gefüttert/.test(fp?.title || '') && !fp.update, 'push says who and when: ' + JSON.stringify(fp?.body));
  ok(p.find((x) => x.user === 'kathrin')?.topic === 'feed-bonnie', 'own topic, so it does not replace the status push');

  const dup = await api('kathrin', 'POST', '/api/feedings');
  ok(dup.status === 409 && dup.body.error === 'recent' && dup.body.last.name === 'Linus' && dup.body.last.mine === false, 'second feeding within the hour is held back with who/when');
  ok((await api('kathrin', 'GET', '/api/feedings')).body.feedings.length === 1, '...and nothing was entered');
  const f2 = await api('kathrin', 'POST', '/api/feedings', { force: true });
  ok(f2.status === 200, 'with force it is entered anyway');
  await sleep(1500); p = drain();
  ok(feedUsers(p) === 'annalena,linus,oskar', 'push for Kathrin\'s feeding: ' + feedUsers(p));

  const lst = (await api('oskar', 'GET', '/api/feedings')).body.feedings;
  ok(lst.length === 2 && lst[0].name === 'Kathrin' && lst[1].name === 'Linus' && lst.every((e) => !e.mine && !e.undoable), 'list is newest first with names; nothing is "mine" or undoable for Oskar');
  ok((await api('oskar', 'GET', '/api/state')).body.feeding.last.name === 'Kathrin', 'state carries the latest feeding');
  ok((await api('oskar', 'GET', '/api/feedings/3')).status === 404 && (await api('oskar', 'POST', '/api/feedings/3')).status === 404, 'only the exact collection path answers GET and POST');

  // push setting: one switch must not touch the other
  ok((await api('oskar', 'PUT', '/api/prefs', { ownPush: false })).body.state.prefs.ownPush === false, 'Oskar turns household messages off');
  const fo = await api('oskar', 'PUT', '/api/prefs', { feedPush: false });
  ok(fo.status === 200 && fo.body.state.prefs.feedPush === false && fo.body.state.prefs.ownPush === false, 'turning off the feeding push leaves the other setting alone');
  const fa = await api('annalena', 'PUT', '/api/prefs', { feedPush: true });
  ok(fa.body.state.prefs.feedPush === true && fa.body.state.prefs.ownPush === true, 'a person without a settings row gets the defaults for the other switch');
  await api('annalena', 'POST', '/api/feedings', { force: true });
  await sleep(1500); p = drain();
  ok(feedUsers(p) === 'kathrin,linus', 'Oskar (setting off) gets no feeding push: ' + feedUsers(p));

  // undo
  const mine = (await api('annalena', 'GET', '/api/feedings')).body.feedings[0];
  ok(mine.mine === true && mine.undoable === true && mine.name === 'Anna-Lena', 'Anna-Lena sees her entry as undoable');
  ok((await api('linus', 'DELETE', `/api/feedings/${mine.id}`)).status === 403, 'nobody can undo somebody else\'s entry');
  ok((await api('linus', 'DELETE', '/api/feedings/99999')).status === 404, 'unknown entry: 404');
  ok((await api('annalena', 'DELETE', `/api/feedings/${mine.id}`)).status === 200 && (await api('annalena', 'GET', '/api/feedings')).body.feedings.length === 2, 'Anna-Lena takes her entry back');
  await sleep(1500); p = drain();
  const un = p.find((x) => x.user === 'kathrin')?.msg;
  ok(feedUsers(p) === 'kathrin,linus' && un?.update === true && /zurückgenommen/.test(un?.title || '') && /Anna-Lena/.test(un?.body || '') && /Zuletzt gefüttert/.test(un?.body || ''), 'the correction push replaces the first one and names the remaining last feeding: ' + JSON.stringify(un));
  sql('DELETE FROM feedings;');
  const old = Date.now() - 11 * 60000;
  sql(`INSERT INTO feedings (ts, user) VALUES (${old}, 'linus')`);
  const oid = JSON.parse(sql("SELECT id FROM feedings LIMIT 1"))[0].results[0].id;
  const olist = (await api('linus', 'GET', '/api/feedings')).body.feedings;
  ok(olist[0].mine === true && olist[0].undoable === false, 'after 10 minutes the entry is no longer undoable');
  const late = await api('linus', 'DELETE', `/api/feedings/${oid}`);
  ok(late.status === 409 && late.body.error === 'too_late' && (await api('linus', 'GET', '/api/feedings')).body.feedings.length === 1, 'too late to undo: kept');
  await sleep(500); drain();

  // the one-hour edge
  sql('DELETE FROM feedings;');
  sql(`INSERT INTO feedings (ts, user) VALUES (${Date.now() - 59 * 60000}, 'linus')`);
  ok((await api('kathrin', 'POST', '/api/feedings')).status === 409, '59 minutes ago: still a hint');
  sql('DELETE FROM feedings;');
  sql(`INSERT INTO feedings (ts, user) VALUES (${Date.now() - 61 * 60000}, 'linus')`);
  ok((await api('kathrin', 'POST', '/api/feedings')).status === 200, '61 minutes ago: no hint');
  await sleep(1200); p = drain();
  ok(!p.some((x) => ['maxime', 'janin'].includes(x.user)), 'Ilford\'s devices never received anything from the feeding tracker');
  sql('DELETE FROM feedings; DELETE FROM user_prefs;');

  console.log('feeding tracker: entering a feeding afterwards');
  sql('DELETE FROM feedings; DELETE FROM user_prefs;'); drain();
  const H = 3600000, nowMs = () => Date.now();
  ok((await api('kathrin', 'POST', '/api/feedings', { at: 'bald' })).status === 400, 'a bad time is rejected');
  const b1 = await api('kathrin', 'POST', '/api/feedings', { at: nowMs() - 2 * H });
  ok(b1.status === 200 && b1.body.entry.late === true && Math.abs(b1.body.entry.ts - (nowMs() - 2 * H)) < 5000 && b1.body.entry.undoable === true, 'Kathrin enters a feeding from 2 hours ago: marked as late, still undoable (counted from when she entered it)');
  await sleep(1500); p = drain();
  ok(feedUsers(p) === 'annalena,linus,oskar' && /\(nachgetragen\)/.test(p.find((x) => x.user === 'linus')?.msg.body || ''), 'the push says it was entered afterwards: ' + JSON.stringify(p.find((x) => x.user === 'linus')?.msg.body));
  const bl = (await api('linus', 'GET', '/api/feedings')).body.feedings;
  ok(bl.length === 1 && bl[0].late === true && bl[0].name === 'Kathrin', 'the list marks it as entered afterwards');
  const st = await api('linus', 'GET', '/api/state');
  ok(st.body.feeding.last.late === true && Math.abs(st.body.feeding.last.ts - (nowMs() - 2 * H)) < 5000, 'the state\'s "last feeding" is the one with the latest feeding time');
  const nearBack = await api('linus', 'POST', '/api/feedings', { at: nowMs() - 2 * H - 30 * 60000 });
  ok(nearBack.status === 409 && nearBack.body.last.name === 'Kathrin', 'a time within the hour before an entry gets the hint');
  const nearAfter = await api('linus', 'POST', '/api/feedings', { at: nowMs() - 2 * H + 20 * 60000 });
  ok(nearAfter.status === 409, '...and within the hour after it');
  ok((await api('linus', 'POST', '/api/feedings', { at: nowMs() - 2 * H - 70 * 60000 })).status === 200, '70 minutes away: no hint');
  ok((await api('linus', 'POST', '/api/feedings')).status === 200, 'feeding now is fine when the nearest entry is 2 hours old');
  await sleep(1200); drain();
  const far = await api('oskar', 'POST', '/api/feedings', { at: nowMs() - 30 * H, force: true });
  ok(far.status === 200 && nowMs() - far.body.entry.ts > 23.9 * H && nowMs() - far.body.entry.ts < 24.1 * H, 'older than a day is pulled back to 24 hours');
  const fut = await api('oskar', 'POST', '/api/feedings', { at: nowMs() + 5 * H, force: true });
  ok(fut.status === 200 && fut.body.entry.ts <= nowMs(), 'a time in the future is pulled back to now');
  ok((await api('kathrin', 'DELETE', `/api/feedings/${b1.body.entry.id}`)).status === 200, 'Kathrin takes back the entry from 2 hours ago (the undo window counts from when she entered it)');
  sql('DELETE FROM feedings;');
  sql(`INSERT INTO feedings (ts, user, recorded_at) VALUES (${nowMs() - 3 * H}, 'linus', ${nowMs() - 11 * 60000})`);
  const oid2 = JSON.parse(sql('SELECT id FROM feedings LIMIT 1'))[0].results[0].id;
  ok((await api('linus', 'DELETE', `/api/feedings/${oid2}`)).status === 409, 'entered 11 minutes ago for 3 hours ago: too late to undo');
  sql(`DELETE FROM feedings; INSERT INTO feedings (ts, user) VALUES (${nowMs() - 5 * 60000}, 'linus')`);
  const leg = (await api('linus', 'GET', '/api/feedings')).body.feedings[0];
  ok(leg.undoable === true && leg.late === false && leg.rec === leg.ts, 'an entry from before this update (no entry time) counts from its own time');
  await sleep(500); drain();
  sql('DELETE FROM feedings; DELETE FROM user_prefs;');
  console.log('Ilford in Zahlen (Ilford\'s household only)');
  sql('DELETE FROM events;');
  const nowI = nowMs();
  sql(`INSERT INTO events (cat, status, prev_status, ts, recorded_at, actor) VALUES ('ilford', 'in', NULL, ${nowI - 3 * 24 * H}, ${nowI - 3 * 24 * H}, 'maxime'), ('ilford', 'out', 'in', ${nowI - 2 * 24 * H}, ${nowI - 2 * 24 * H}, 'maxime'), ('ilford', 'in', 'out', ${nowI - 2 * 24 * H + 90 * 60000}, ${nowI - 2 * 24 * H + 90 * 60000}, 'maxime')`);
  for (const who2 of ['maxime', 'janin']) {
    const r = await api(who2, 'GET', '/api/ilford?days=7');
    ok(r.status === 200 && r.body.empty === false && r.body.days === 7 && r.body.cur.minutes === 90 && r.body.cur.outings === 1, `${who2} gets the numbers (one 90-minute outing)`);
    ok(r.body.prev === null && r.body.since.covers === false && r.body.bars.length >= 3 && r.body.bars.length <= 4 && Array.isArray(r.body.rolling) && r.body.streaks.out && r.body.records.longest.minutes === 90, `${who2}: three days of history, no comparison yet, bars, streaks and records are there`);
  }
  ok((await api('maxime', 'GET', '/api/ilford?days=30')).body.days === 30 && (await api('maxime', 'GET', '/api/ilford?days=5')).body.days === 7 && (await api('maxime', 'GET', '/api/ilford')).body.days === 7, 'only 7 and 30 days exist, everything else is 7');
  for (const who2 of ['kathrin', 'linus', 'oskar', 'annalena']) {
    const r = await api(who2, 'GET', '/api/ilford?days=7');
    ok(r.status === 403 && JSON.stringify(r.body) === '{"error":"forbidden"}', `${who2} gets 403 and no data`);
  }
  ok((await api('maxime', 'POST', '/api/ilford')).status === 404, 'read-only: no other method');
  sql('DELETE FROM events;');

  console.log('Zeiten anpassen (admins, own cat, last 24 hours)');
  // ids ascend with the inserts: old "in" (30 h), soon (10.5 h), out (10 h), "in" pressed this morning (1 h); Bonnie out 5 h and in 4 h ago
  const t0 = nowMs(), min = 60000;
  const ins = (cat, st, prev, ts, extra = 'NULL') => `INSERT INTO events (cat, status, prev_status, ts, recorded_at, actor, soon_until) VALUES ('${cat}', '${st}', ${prev ? `'${prev}'` : 'NULL'}, ${ts}, ${ts}, 'x', ${extra});`;
  sql([ins('ilford', 'in', null, t0 - 30 * H), ins('ilford', 'soon', 'in', t0 - 10.5 * H, t0 - 10.25 * H), ins('ilford', 'out', 'soon', t0 - 10 * H), ins('bonnie', 'out', 'in', t0 - 5 * H), ins('bonnie', 'in', 'out', t0 - 4 * H), ins('ilford', 'in', 'out', t0 - 1 * H)].join(' '));
  const ids = JSON.parse(sql("SELECT id, cat, status FROM events ORDER BY id"))[0].results;
  const idOf = (cat, st, n = 0) => ids.filter((e) => e.cat === cat && e.status === st)[n].id;
  const [oldIn, soonId, outId, inId, bOut] = [idOf('ilford', 'in', 0), idOf('ilford', 'soon'), idOf('ilford', 'out'), idOf('ilford', 'in', 1), idOf('bonnie', 'out')];
  const near = (a, b, tol = 5000) => Math.abs(a - b) <= tol;
  {
    const r = await api('maxime', 'GET', '/api/times');
    const rows = r.body.rows || [];
    ok(r.status === 200 && rows.length === 2 && rows[0].id === inId && rows[1].id === outId, 'list: the two Rein/Raus events of the last 24 h, newest first (no soon, nothing older)');
    ok(rows[0].editable && near(rows[0].lo, t0 - 10 * H) && near(rows[0].hi, t0, 8000), 'range of the newest event: from the "Raus" until now');
    ok(near(rows[1].lo, t0 - 10.5 * H) && near(rows[1].hi, t0 - 1 * H), 'range of the "Raus": after the soon event, before the next "Rein"');
    ok((await api('janin', 'GET', '/api/times')).status === 200, 'Janin as well');
    for (const w of ['kathrin', 'linus', 'oskar', 'annalena']) ok((await api(w, 'GET', '/api/times')).status === 403 && (await api(w, 'POST', '/api/times', { id: inId, ts: t0 - 2 * H })).status === 403, `${w}: 403 on list and edit`);
  }
  {
    const r = await api('maxime', 'POST', '/api/times', { id: inId, ts: t0 - 2 * H });
    const row = (r.body.rows || []).find((x) => x.id === inId);
    ok(r.status === 200 && row && row.ts === t0 - 2 * H && row.edited && row.edited.orig === t0 - 1 * H && row.edited.by === 'Maxime', 'last night\'s case: "Rein" moved back by one hour, original time and name kept');
    ok(near(r.body.state.cats.ilford.since, t0 - 2 * H, 1), 'the status page shows the corrected time');
    const r2 = await api('janin', 'POST', '/api/times', { id: inId, ts: t0 - 3 * H });
    const row2 = (r2.body.rows || []).find((x) => x.id === inId);
    ok(r2.status === 200 && row2.edited.orig === t0 - 1 * H && row2.edited.by === 'Janin', 'a second correction keeps the very first original time');
    const db = JSON.parse(sql(`SELECT orig_ts, edited_by FROM events WHERE id = ${inId}`))[0].results[0];
    ok(db.orig_ts === t0 - 1 * H && db.edited_by === 'janin', 'stored in the database');
    ok((await api('maxime', 'POST', '/api/times', { id: inId, ts: t0 - 3 * H })).body.noop === true, 'the same time again: nothing to do');
  }
  {
    const lo = (await api('maxime', 'GET', '/api/times')).body.rows.find((x) => x.id === inId);
    const refuse = async (body, code, msg) => { const r = await api('maxime', 'POST', '/api/times', body); ok(r.status === (code === 'bad_request' || code === 'bad_ts' ? 400 : code === 'not_found' ? 404 : 409) && r.body.error === code, msg); return r; };
    const r = await refuse({ id: inId, ts: t0 - 10 * H - min }, 'out_of_range', 'before the "Raus" event: refused');
    ok(near(r.body.lo, t0 - 10 * H) && near(r.body.hi, t0, 8000), 'the refusal names the allowed range');
    await refuse({ id: inId, ts: t0 + 10 * min }, 'out_of_range', 'in the future: refused');
    await refuse({ id: outId, ts: t0 - 2 * H }, 'out_of_range', 'the "Raus" cannot jump behind the next "Rein"');
    await refuse({ id: outId, ts: t0 - 10.6 * H }, 'out_of_range', 'nor before the announcement');
    await refuse({ id: soonId, ts: t0 - 10.4 * H }, 'not_editable', 'a soon event is not editable');
    await refuse({ id: oldIn, ts: t0 - 29 * H }, 'too_old', 'an event older than 24 h is not editable');
    await refuse({ id: bOut, ts: t0 - 4.5 * H }, 'not_found', 'an event of the other cat looks like a missing one');
    await refuse({ id: inId, ts: 'x' }, 'bad_ts', 'not a time');
    await refuse({ ts: t0 - 2 * H }, 'bad_request', 'no id');
    ok(lo.ts === t0 - 3 * H, 'refusals changed nothing');
  }
  {
    sql(`INSERT INTO incident_notes (start_ts, note, updated_at) VALUES (${t0 - 10 * H}, 'Tür war offen', ${t0});`);
    const r = await api('maxime', 'POST', '/api/times', { id: outId, ts: t0 - 9.5 * H });
    ok(r.status === 200 && (r.body.rows.find((x) => x.id === outId) || {}).ts === t0 - 9.5 * H, '"Raus" moved later, between its neighbours');
    const n = JSON.parse(sql("SELECT start_ts, note FROM incident_notes WHERE note = 'Tür war offen'"))[0].results;
    ok(n.length === 1 && n[0].start_ts === t0 - 9.5 * H, 'the incident note moves with the event it hangs on');
    sql("DELETE FROM incident_notes WHERE note = 'Tür war offen';");
  }
  {
    // quick sheet: "Kam früher rein" may reach back a whole day (only for "in"); "out" stays at 4 h
    sql('DELETE FROM events;');
    sql([ins('ilford', 'in', null, t0 - 30 * H), ins('ilford', 'out', 'in', t0 - 10 * H)].join(' '));
    const r = await api('maxime', 'POST', '/api/status', { to: 'in', agoMin: 300 });
    const evs = JSON.parse(sql("SELECT status, ts FROM events WHERE cat = 'ilford' ORDER BY id"))[0].results;
    ok(r.status === 200 && near(evs[2].ts, Date.now() - 300 * min, 15000), '"Kam rein" 5 hours ago is entered 5 hours ago');
    sql('DELETE FROM events;');
    sql([ins('ilford', 'in', null, t0 - 30 * H), ins('ilford', 'out', 'in', t0 - 10 * H)].join(' '));
    await api('janin', 'POST', '/api/status', { to: 'in', agoMin: 5000 });
    const e2 = JSON.parse(sql("SELECT ts FROM events WHERE cat = 'ilford' ORDER BY id"))[0].results;
    ok(near(e2[2].ts, t0 - 10 * H, 1), 'far too long ago: never before the moment he went out');
    sql('DELETE FROM events;');
    sql(ins('ilford', 'in', null, t0 - 30 * H));
    await api('maxime', 'POST', '/api/status', { to: 'out', agoMin: 600 });
    const e3 = JSON.parse(sql("SELECT ts FROM events WHERE cat = 'ilford' ORDER BY id"))[0].results;
    ok(near(e3[1].ts, Date.now() - 240 * min, 15000), 'backdating "Raus" is still capped at 4 hours');
  }
  await sleep(500); drain();
  sql('DELETE FROM events;');

  console.log('Wetter (Standort nur in der Datenbank, Abruf per Cron, Anzeige für alle)');
  const mockOn = vars.WEATHER_API === WX_URL;
  if (!mockOn) console.log('  skip  the fetch tests (no WEATHER_API in .dev.vars: run "npm run setup:local" on a fresh .dev.vars, or add WEATHER_API=' + WX_URL + ')');
  const wxReset = () => sql("DELETE FROM kv; DELETE FROM weather_hours; DELETE FROM sent_keys WHERE key LIKE 'wx:%';");
  const kvOf = (k) => { const r = JSON.parse(sql(`SELECT value FROM kv WHERE key = '${k}'`))[0].results; return r.length ? JSON.parse(r[0].value) : null; };
  const wxCount = () => JSON.parse(sql('SELECT COUNT(*) AS n FROM weather_hours'))[0].results[0].n;
  const everyone = Object.keys(TOK), admins = ['maxime', 'janin'], others = ['kathrin', 'linus', 'oskar', 'annalena'];
  const hourNow = Math.floor(nowMs() / H) * H;
  const seed = (days) => sql(`WITH RECURSIVE h(ts) AS (SELECT ${hourNow - days * 24 * H} UNION ALL SELECT ts + 3600000 FROM h WHERE ts < ${hourNow}) INSERT INTO weather_hours (ts, temp, feels, hum, precip, snow, code, cloud, wind, gust, sun) SELECT ts, CASE WHEN ((ts / 86400000) % 2) = 0 THEN 1.0 ELSE 6.0 END, 0.5, 80, 0, 0, 3, 90, 10, 20, 0 FROM h;`);
  const setNow = (ts, temp = 2.6) => sql(`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('wx_now', '{"ts":${ts},"temp":${temp},"feels":0.4,"code":73,"isDay":1,"wind":9,"precip":0.2}', ${nowMs()});`);
  wxReset(); sql('DELETE FROM events;');
  {
    const bad = [];
    for (const w of everyone) {
      const st = (await api(w, 'GET', '/api/state')).body, admin = admins.includes(w);
      if (st.weather !== null) bad.push(w + ': shows weather');
      if (admin !== ('weatherCfg' in st)) bad.push(w + ': set-up block visibility');
      if (admin && st.weatherCfg.configured !== false) bad.push(w + ': configured');
    }
    ok(!bad.length, 'nothing is shown before a location is set; only admins get the set-up block ' + bad.join(', '));
  }
  for (const w of others) {
    ok((await api(w, 'PUT', '/api/weather/location', { lat: 52.4, lon: 12.5 })).status === 403 && (await api(w, 'POST', '/api/weather/refresh')).status === 403, `${w} may not set the location or fetch`);
  }
  {
    const bads = [{ lat: 999, lon: 12 }, { lat: 52, lon: 181 }, { lat: '52', lon: '12' }, { text: 'abc' }, { text: '1 2 3' }, {}, { lat: null, lon: null }];
    const codes = []; for (const b of bads) codes.push((await api('maxime', 'PUT', '/api/weather/location', b)).status);
    ok(codes.every((c) => c === 400) && kvOf('wx_config') === null, 'nonsense is refused and nothing is stored: ' + codes.join());
    ok((await api('maxime', 'POST', '/api/weather/refresh')).status === 409, 'fetching without a location: 409');
  }
  const firstTs = nowMs() - 6 * 24 * H;
  sql(ins('ilford', 'in', null, firstTs) + ins('ilford', 'out', 'in', nowMs() - 3 * 24 * H) + ins('ilford', 'in', 'out', nowMs() - 3 * 24 * H + 60 * min) + ins('ilford', 'out', 'in', nowMs() - 2 * 24 * H) + ins('ilford', 'in', 'out', nowMs() - 2 * 24 * H + 150 * min));
  wxMock.mode = 'ok'; wxMock.hits = 0;
  {
    const r = await api('maxime', 'PUT', '/api/weather/location', { lat: 52.4012, lon: 12.5034 });
    const cfg = r.body?.state?.weatherCfg;
    ok(r.status === 200 && cfg.configured && cfg.lat === 52.4 && cfg.lon === 12.5, 'Maxime sets the location; it is rounded to 2 decimals (about 1 km)');
    ok(JSON.stringify(kvOf('wx_config')) === '{"lat":52.4,"lon":12.5}', 'only the rounded location is stored (never the exact one)');
    if (mockOn) {
      ok(r.body.fetched.ok === true && r.body.fetched.rows > 100 && wxMock.hits === 1, 'the first fetch comes at once, with the history');
      const q = new URL(wxMock.last, 'http://x').searchParams;
      ok(q.get('latitude') === '52.4' && q.get('longitude') === '12.5' && q.get('timeformat') === 'unixtime' && q.get('forecast_days') === '1', 'the request carries the rounded location and unix times');
      ok([7, 8].includes(+q.get('past_days')), 'the history reaches back to the first event (6 days ago): past_days ' + q.get('past_days'));
      ok(wxCount() > 100, 'the hours are in the database');
      const bad = []; for (const w of everyone) { const st = (await api(w, 'GET', '/api/state')).body.weather; if (!st || st.temp !== 3.4 || st.text !== 'Bedeckt' || st.icon !== 'cloud') bad.push(w); }
      ok(!bad.length, 'everybody sees the current weather (3.4°, Bedeckt) ' + bad.join(', '));
      const st = kvOf('wx_status');
      ok(st.ok > 0 && st.err === null && st.backfilled === true && cfg.ok > 0, 'the status says: fetched, no error, history done');
    } else ok(typeof r.body.fetched === 'object', 'the first fetch is attempted');
  }

  // from here on the data is seeded, so the checks do not depend on any network
  sql('DELETE FROM weather_hours;'); seed(8);
  setNow(hourNow);
  {
    const bad = []; for (const w of everyone) { const st = (await api(w, 'GET', '/api/state')).body.weather; if (!st || st.temp !== 2.6 || st.text !== 'Schneefall' || st.icon !== 'snow' || st.wind !== 9) bad.push(w); }
    ok(!bad.length, 'the current reading is in everybody\'s state: 2.6°, Schneefall ' + bad.join(', '));
    setNow(nowMs() - 3 * H);
    const old = []; for (const w of everyone) if ((await api(w, 'GET', '/api/state')).body.weather !== null) old.push(w);
    ok(!old.length, 'a reading older than 2 hours is hidden, not shown as current ' + old.join(', '));
    ok((await api('maxime', 'GET', '/api/state')).body.weatherCfg.configured === true, 'the set-up block stays for admins');
  }
  for (const w of admins) {
    const r = await api(w, 'GET', '/api/ilford?days=7');
    const W = r.body.weather;
    ok(r.status === 200 && W.has && W.days >= 4 && W.days <= 6 && W.skipped === 0, `${w}: the Ilford numbers have a weather block over the decided days (${W && W.days})`);
    ok(W.bands.reduce((n, b) => n + b.days, 0) === W.days && W.kinds.find((k) => k.id === 'dry').days === W.days && W.corr === null && W.need.minDays === 21, `${w}: bands add up, all days dry, no correlation yet`);
    ok(r.body.bars.length === 7 && r.body.bars.every((b) => b.wx && typeof b.wx.tmean === 'number'), `${w}: every bar carries its day's weather`);
    const d = await api(w, 'GET', '/api/ilford/daily');
    ok(d.status === 200 && d.body.daily.length >= 6 && d.body.daily.at(-1).partial && d.body.daily.every((x) => x.wx), `${w}: daily rows with weather for the CSV`);
  }
  for (const w of others) {
    const a1 = await api(w, 'GET', '/api/ilford/daily');
    ok(a1.status === 403 && JSON.stringify(a1.body) === '{"error":"forbidden"}', `${w}: no daily rows`);
  }
  ok((await api('maxime', 'POST', '/api/ilford/daily')).status === 404, 'daily rows are read-only');
  {
    const r = await api('maxime', 'GET', '/api/export?days=7');
    const withWx = r.body.events.filter((e) => e.wx);
    ok(r.status === 200 && withWx.length === r.body.events.length && withWx.every((e) => typeof e.wx.temp === 'number' && e.wx.text === 'Bedeckt'), 'the export has the weather at the time of every event');
    ok((await api('kathrin', 'GET', '/api/export?days=7')).status === 403, 'the export stays admin-only');
  }

  if (mockOn) {
    const age = (extra = '') => sql(`UPDATE kv SET value = json_set(value, '$.tried', 0${extra}) WHERE key = 'wx_status';`);
    const cron = async () => { sql("DELETE FROM sent_keys WHERE key LIKE 'wx:%';"); const c = (await fetch(BASE + '/__scheduled?cron=*+*+*+*+*')).status; await sleep(1500); return c; };
    setNow(hourNow);
    wxMock.mode = '500'; age();
    {
      const r = await api('maxime', 'POST', '/api/weather/refresh');
      ok(r.status === 200 && r.body.fetched.ok === false && r.body.fetched.error === 'http_500' && r.body.state.weatherCfg.err === 'http_500', 'a server error is recorded as http_500');
      ok(r.body.state.weather && r.body.state.weather.temp === 2.6 && wxCount() > 100, 'the failure leaves the data and the display as they were');
      ok((await api('janin', 'POST', '/api/weather/refresh')).status === 429, 'a second tap right away: too soon (20 s)');
    }
    wxMock.mode = 'garbage'; age();
    ok((await api('janin', 'POST', '/api/weather/refresh')).body.fetched.error === 'bad_response', 'an answer that is not JSON: bad_response');
    wxMock.mode = 'error'; age();
    ok((await api('maxime', 'POST', '/api/weather/refresh')).body.fetched.error === 'api', 'an error answer from the API: api');
    wxMock.mode = 'ok'; age();
    {
      const hits = wxMock.hits;
      const r = await api('maxime', 'POST', '/api/weather/refresh');
      const q = new URL(wxMock.last, 'http://x').searchParams;
      ok(r.body.fetched.ok === true && r.body.state.weatherCfg.err === null && r.body.state.weather.temp === 3.4 && wxMock.hits === hits + 1, 'the next good fetch clears the error and updates the reading');
      ok(q.get('past_days') === '2', 'after the first fetch only the last two days are asked for');
    }
    // the cron: not due → nothing; due → fetch; after a failure it waits
    {
      let hits = wxMock.hits;
      ok((await cron()) === 200 && wxMock.hits === hits, 'the cron does nothing while the reading is fresh');
      age(", '$.ok', 0"); hits = wxMock.hits;
      ok((await cron()) === 200 && wxMock.hits === hits + 1 && kvOf('wx_status').ok > 0, 'the cron fetches when it is due');
      wxMock.mode = '500'; age(", '$.ok', 0"); hits = wxMock.hits;
      ok((await cron()) === 200 && wxMock.hits === hits + 1 && kvOf('wx_status').err === 'http_500', 'a failing API does not break the cron; the error is recorded');
      ok((await cron()) === 200 && wxMock.hits === hits + 1, 'and it waits 5 minutes before the next try');
      wxMock.mode = 'ok';
    }
    // moving the location
    {
      sql('INSERT INTO weather_hours (ts, temp) VALUES (3600000, 9);');
      await api('maxime', 'PUT', '/api/weather/location', { text: '52,45 12,5' });
      ok(JSON.parse(sql('SELECT COUNT(*) AS n FROM weather_hours WHERE ts = 3600000'))[0].results[0].n === 1 && JSON.stringify(kvOf('wx_config')) === '{"lat":52.45,"lon":12.5}', 'a small move keeps the stored hours');
      await api('janin', 'PUT', '/api/weather/location', { lat: 48.14, lon: 11.58 });
      ok(JSON.parse(sql('SELECT COUNT(*) AS n FROM weather_hours WHERE ts = 3600000'))[0].results[0].n === 0 && wxCount() > 100, 'a move to another city drops the old hours and fetches the new place');
    }
  }
  wxReset(); sql('DELETE FROM events;');
  await sleep(300); drain();
} catch (e) {
  failed++; console.log('ERROR', e);
}
srv.close(); wxSrv.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
