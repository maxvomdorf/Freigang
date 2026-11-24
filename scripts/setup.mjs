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
import { generateVapid, generateCode, wrangler, ROOT, readSecrets, writeSecrets, printLinks, jsonFrom, findDatabase, resolveEmail, applyAndDeploy, askLine, addMissingCodes, codeSecrets, rememberAccount, PEOPLE_INFO } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const say = (m) => console.log(m);
const step = (n, m) => console.log(`\n[${n}] ${m}`);
const die = (m) => { console.error(`\nStopped: ${m}`); process.exit(1); };

if (Number(process.versions.node.split('.')[0]) < 20) die('Node 20 or newer is needed. Get it from https://nodejs.org');
if (!existsSync(join(ROOT, 'node_modules', 'wrangler')) && !process.env.WRANGLER_BIN) die('Run "npm install" first, then "npm run setup" again.');

async function ask(question) {
  try { return await askLine(question); } catch (e) { die(e.message); }
}

// ---------------------------------------------------------------- local mode
if (flag('local')) {
  step('1/2', 'Local test credentials (.dev.vars)');
  const p = join(ROOT, '.dev.vars');
  if (existsSync(p)) {
    // keep the file, but add test codes for people who were added later
    const have = readFileSync(p, 'utf8');
    const add = Object.values(PEOPLE_INFO).filter((x) => !have.includes(x.secretName + '=')).map((x) => `${x.secretName}=${generateCode()}`);
    if (add.length) { writeFileSync(p, have.replace(/\n*$/, '\n') + add.join('\n') + '\n', { mode: 0o600 }); say(`  .dev.vars exists; added codes for ${add.length} new people.`); }
    else say('  .dev.vars exists, leaving it alone.');
  } else {
    const v = generateVapid();
    writeFileSync(p, [
      ...Object.values(PEOPLE_INFO).map((x) => `${x.secretName}=${generateCode()}`),
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
let email;
try { email = await resolveEmail(opt('email')); } catch (e) { die(e.message); }
say(`  Using ${email}.`);

step('3/7', 'Keys and personal access codes');
let secrets = readSecrets();
if (secrets) say('  Reusing the codes from the earlier run (.secrets.json).');
else {
  const v = generateVapid();
  secrets = { url: '', email, vapid: v, codes: {}, createdAt: new Date().toISOString() };
  addMissingCodes(secrets);
  writeSecrets(secrets);
  say('  Generated new codes and push keys, saved to .secrets.json (keep this file private).');
}
if (addMissingCodes(secrets).length) writeSecrets(secrets); // people added in a later version
rememberAccount();

step('4/7', 'Database (Cloudflare D1)');
let db;
try { db = findDatabase('freigang'); } catch (e) { die(e.message); }
if (db) say('  Database "freigang" already exists, reusing it.');
else {
  if (!wrangler(['d1', 'create', 'freigang', '--location', 'weur']).ok) die('Creating the database failed.');
  try { db = findDatabase('freigang'); } catch (e) { die(e.message); }
  if (!db) die('The database was created but could not be found afterwards. Run "npx wrangler d1 list" and try "npm run setup" again.');
}

step('5/7', 'Database tables and deploy');
let url = opt('url') || '';
try { const u = applyAndDeploy({ databaseId: db.uuid, email }); url = url || u; } catch (e) { die(e.message); }
if (!url) url = await ask('  Could not read the address. Paste the https://….workers.dev address printed above:');
url = url.replace(/\/+$/, '');
if (!/^https:\/\/[^\s/]+$/.test(url)) die(`"${url}" is not a valid address.`);
secrets.url = url;
writeSecrets(secrets);

step('6/7', 'Secrets (codes and push key)');
const tmp = join(mkdtempSync(join(tmpdir(), 'freigang-')), 'secrets.json');
writeFileSync(tmp, JSON.stringify({
  ...codeSecrets(secrets),
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
