// Integration test against `wrangler dev --local --test-scheduled` (port 8787) with a mock push service.
// Run: npx wrangler dev --local --test-scheduled  (other terminal)  then  node test/run.mjs
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createECDH, createPublicKey, verify, randomBytes } from 'node:crypto';
import { decrypt } from './push-crypto.mjs';

const BASE = process.env.BASE || 'http://localhost:8787';
const vars = Object.fromEntries(readFileSync('.dev.vars', 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const TOK = { maxime: vars.TOKEN_MAXIME, kathrin: vars.TOKEN_KATHRIN };
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
  r = await api('maxime', 'POST', '/api/status', { to: 'out', force: true });
  ok(r.status === 200 && r.body.state.cats.ilford.override === true, 'forced out is recorded as override');
  await sleep(1000); p = drain();
  ok(p.length === 1 && /beide draußen/.test(p[0].msg.title), 'Kathrin warned: both outside (' + p[0]?.msg?.body + ')');
  sql('UPDATE events SET ts = ts - 1800000'); // the whole history so far happened 30 min ago
  r = await api('maxime', 'POST', '/api/status', { to: 'in', agoMin: 10 });
  const back = r.body.state.cats.ilford;
  ok(back.status === 'in' && Math.abs(Date.now() - back.since - 600000) < 5000, 'backdating: came in 10 min ago');
  await sleep(1000); drain();
  r = await api('maxime', 'POST', '/api/status', { to: 'in', agoMin: 500 });
  ok(r.status === 200 && r.body.noop === true, 'already inside: no new event');
  await api('kathrin', 'POST', '/api/status', { to: 'in' }); await sleep(800); drain();

  console.log('plan');
  const z = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date());
  const g = (t) => z.find((x) => x.type === t).value;
  const wd = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[g('weekday')];
  const nowMin = +g('hour') * 60 + +g('minute');
  const start = Math.ceil((nowMin + 6) / 5) * 5;
  r = await api('maxime', 'POST', '/api/plan', { weekdays: [wd], start, end: start + 30 });
  ok(r.status === 200 && start + 30 <= 1380, 'slot created for today');
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
  ok(start - 10 <= nowMin + 10 && start > nowMin, 'slot starts within the next 10 min (reminder window)');

  console.log('cron');
  const cron = async () => (await fetch(BASE + '/__scheduled?cron=*+*+*+*+*')).status;
  ok((await cron()) === 200, 'scheduled handler runs');
  await sleep(1500); p = drain();
  const hr = new Date().getHours();
  ok(p.some((x) => x.user === 'maxime' && /Ilford darf raus/.test(x.msg.title)), 'Maxime got the plan reminder');
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
  ok(log.status === 200 && log.body.rows.length === 7 && log.body.heat.ilford.length === 18, 'log has 7 day rows and 18 heat cells');
  ok(log.body.incidents.length === 1 && log.body.kpi.overlaps === 1 && log.body.kpi.overrides === 1, 'one overlap, from the forced exit: ' + JSON.stringify(log.body.kpi));
  ok(log.body.kpi.overlapMinutes >= 19 && log.body.kpi.overlapMinutes <= 21, 'overlap lasted about 20 min');
  const inc = log.body.incidents.find((i) => i.override) || {};
  ok(!!inc && inc.second === 'ilford', 'incident marked as override, second cat = Ilford');
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
} catch (e) {
  failed++; console.log('ERROR', e);
}
srv.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
