// Integration test against `wrangler dev --local --test-scheduled` (port 8787) with a mock push service.
// Run: npx wrangler dev --local --test-scheduled  (other terminal)  then  node test/run.mjs
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createECDH, createPublicKey, verify, randomBytes } from 'node:crypto';
import { decrypt } from './push-crypto.mjs';

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
} catch (e) {
  failed++; console.log('ERROR', e);
}
srv.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
