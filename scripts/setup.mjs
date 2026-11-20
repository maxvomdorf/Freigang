#!/usr/bin/env node
// One-time setup and first deploy for Freigang. Safe to run again: it reuses the database and the codes it made.
//   npm run setup                      full setup on your Cloudflare account
//   npm run setup -- --email me@x.de   skip the question
//   npm run setup -- --local           only prepare local testing (.dev.vars + local database)
//   npm run setup -- --no-check        skip the final online check
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { generateVapid, generateCode, wrangler, ROOT, readSecrets, writeSecrets, printLinks } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const say = (m) => console.log(m);
const step = (n, m) => console.log(`\n[${n}] ${m}`);
const die = (m) => { console.error(`\nStopped: ${m}`); process.exit(1); };

if (Number(process.versions.node.split('.')[0]) < 20) die('Node 20 or newer is needed. Get it from https://nodejs.org');
if (!existsSync(join(ROOT, 'node_modules', 'wrangler')) && !process.env.WRANGLER_BIN) die('Run "npm install" first, then "npm run setup" again.');

async function ask(question) {
  if (!process.stdin.isTTY) die(`${question} (no terminal to ask in; pass the answer as an option, see README)`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(question + ' ')).trim();
  rl.close();
  return a;
}

function patchConfig(re, replacement) {
  const p = join(ROOT, 'wrangler.jsonc');
  const t = readFileSync(p, 'utf8');
  if (!re.test(t)) die(`wrangler.jsonc has changed shape; could not update ${re}. See README for the manual steps.`);
  writeFileSync(p, t.replace(re, replacement));
}

function jsonFrom(text) {
  const a = text.search(/[\[{]/);
  const b = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
  return JSON.parse(text.slice(a, b + 1));
}

// ---------------------------------------------------------------- local mode
if (flag('local')) {
  step('1/2', 'Local test credentials (.dev.vars)');
  const p = join(ROOT, '.dev.vars');
  if (existsSync(p)) say('  .dev.vars exists, leaving it alone.');
  else {
    const v = generateVapid();
    writeFileSync(p, [
      `TOKEN_MAXIME=${generateCode()}`, `TOKEN_KATHRIN=${generateCode()}`,
      `VAPID_PUBLIC_KEY=${v.publicKey}`, `VAPID_PRIVATE_JWK=${JSON.stringify(v.privateJWK)}`,
      'VAPID_SUBJECT=mailto:test@freigang.test', 'PUSH_TEST_URL=http://127.0.0.1:9911', '',
    ].join('\n'), { mode: 0o600 });
    say('  Created .dev.vars (test-only codes, never deployed).');
  }
  step('2/2', 'Local database');
  if (!wrangler(['d1', 'migrations', 'apply', 'freigang', '--local']).ok) die('Applying the local migration failed.');
  say('\nDone. Start the app with "npm run dev", open http://localhost:8787 and use the codes from .dev.vars.');
  process.exit(0);
}

// ---------------------------------------------------------------- real setup
step('1/7', 'Cloudflare login');
let who = wrangler(['whoami', '--json'], { capture: true });
if (!who.ok) {
  say('  Not logged in. A browser window will open; sign in (a free account is fine) and allow Wrangler.');
  if (!wrangler(['login']).ok) die('Login did not finish. Run "npx wrangler login" and try again.');
  who = wrangler(['whoami', '--json'], { capture: true });
  if (!who.ok) die('Still not logged in.');
}
try { const w = jsonFrom(who.stdout); say(`  Logged in${w.email ? ' as ' + w.email : ''}.`); } catch { say('  Logged in.'); }

step('2/7', 'Contact address for push messages');
const cfg = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
const current = /"VAPID_SUBJECT"\s*:\s*"mailto:([^"]*)"/.exec(cfg)?.[1];
let email = opt('email') || (current && !current.startsWith('CHANGE-ME') ? current : '');
if (!email) {
  say('  Apple and Google require a real contact address in push messages (never shown to anyone).');
  email = await ask('  Your email address:');
}
if (!/^[^\s@"\\]+@[^\s@"\\]+\.[^\s@"\\]+$/.test(email)) die('That does not look like an email address.');
patchConfig(/("VAPID_SUBJECT"\s*:\s*")[^"]*(")/, `$1mailto:${email}$2`);
say(`  Using ${email}.`);

step('3/7', 'Keys and personal access codes');
let secrets = readSecrets();
if (secrets) say('  Reusing the codes from the earlier run (.secrets.json).');
else {
  const v = generateVapid();
  secrets = { url: '', email, vapid: v, codes: { maxime: generateCode(), kathrin: generateCode() }, createdAt: new Date().toISOString() };
  writeSecrets(secrets);
  say('  Generated new codes and push keys, saved to .secrets.json (keep this file private).');
}

step('4/7', 'Database (Cloudflare D1)');
const listDbs = () => {
  const r = wrangler(['d1', 'list', '--json'], { capture: true });
  if (!r.ok) die(`Could not list databases:\n${r.stderr || r.stdout}`);
  return jsonFrom(r.stdout);
};
let db = listDbs().find((d) => d.name === 'freigang');
if (db) say('  Database "freigang" already exists, reusing it.');
else {
  if (!wrangler(['d1', 'create', 'freigang', '--location', 'weur']).ok) die('Creating the database failed.');
  db = listDbs().find((d) => d.name === 'freigang');
  if (!db) die('The database was created but could not be found afterwards. Run "npx wrangler d1 list", copy the id into wrangler.jsonc (database_id) and run setup again.');
}
patchConfig(/("database_id"\s*:\s*")[^"]*(")/, `$1${db.uuid}$2`);
if (!wrangler(['d1', 'migrations', 'apply', 'freigang', '--remote']).ok) die('Applying the database migration failed.');

step('5/7', 'Deploy');
const outFile = join(mkdtempSync(join(tmpdir(), 'freigang-')), 'wrangler-output.ndjson');
if (!wrangler(['deploy'], { env: { WRANGLER_OUTPUT_FILE_PATH: outFile } }).ok) {
  die('Deploy failed. If it mentions a workers.dev subdomain, pick one at https://dash.cloudflare.com (Workers & Pages) and run setup again.');
}
let url = opt('url') || '';
if (!url && existsSync(outFile)) {
  for (const line of readFileSync(outFile, 'utf8').split('\n')) {
    try { const e = JSON.parse(line); if (e.type === 'deploy') url = (e.targets || []).find((t) => /^https:\/\//.test(t)) || url; } catch { /* skip */ }
  }
  if (!url) url = /https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(readFileSync(outFile, 'utf8'))?.[0] || '';
}
rmSync(outFile, { force: true });
if (!url) url = await ask('  Could not read the address. Paste the https://….workers.dev address printed above:');
url = url.replace(/\/+$/, '');
if (!/^https:\/\/[^\s/]+$/.test(url)) die(`"${url}" is not a valid address.`);
secrets.url = url;
writeSecrets(secrets);

step('6/7', 'Secrets (codes and push key)');
const tmp = join(mkdtempSync(join(tmpdir(), 'freigang-')), 'secrets.json');
writeFileSync(tmp, JSON.stringify({
  TOKEN_MAXIME: secrets.codes.maxime, TOKEN_KATHRIN: secrets.codes.kathrin,
  VAPID_PUBLIC_KEY: secrets.vapid.publicKey, VAPID_PRIVATE_JWK: JSON.stringify(secrets.vapid.privateJWK),
}), { mode: 0o600 });
const sec = wrangler(['secret', 'bulk', tmp]);
rmSync(tmp, { force: true });
if (!sec.ok) die('Uploading the secrets failed. Run "npm run setup" again.');

step('7/7', 'Check');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let good = false;
for (let i = 0; i < (flag('no-check') ? 0 : 12) && !good; i++) {
  try {
    const noCode = await fetch(url + '/api/state');
    const r = await fetch(url + '/api/state', { headers: { authorization: 'Bearer ' + secrets.codes.maxime } });
    const j = r.ok ? await r.json() : null;
    if (noCode.status === 401 && j?.me?.name === 'Maxime' && j.vapidPublicKey === secrets.vapid.publicKey) good = true;
  } catch { /* new workers.dev addresses can take a minute to resolve */ }
  if (!good) { process.stdout.write('  waiting for the app to come online…\r'); await sleep(5000); }
}
say(flag('no-check') ? '  Skipped.' : good ? '  Online: the address rejects visitors without a code and accepts Maxime\'s code.' : '  Could not confirm yet (a brand-new workers.dev address can take a few minutes). Open the link below to check.');

printLinks(secrets);
say(`Open ${url} once yourself, then follow the README ("Install on the phones").`);
