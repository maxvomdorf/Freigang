#!/usr/bin/env node
// Everyday update: npm run deploy
// Looks up your database, applies new migrations, deploys. Never ships the placeholder email or database id.
//   npm run deploy -- --email me@x.de    only needed if the address cannot be found (it is asked once and remembered)
import { readSecrets, wrangler, findDatabase, resolveEmail, applyAndDeploy } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const die = (m) => { console.error(`\nStopped: ${m}`); process.exit(1); };

try {
  const version = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version;
  console.log(`Freigang ${version}: deploying to your Cloudflare account`);
  const who = wrangler(['whoami', '--json'], { capture: true });
  if (!who.ok) die('Not logged in to Cloudflare. Run "npx wrangler login" first.');
  const db = findDatabase('freigang');
  if (!db) die('No database called "freigang" found. This looks like a first install: run "npm run setup" instead.');
  const email = await resolveEmail(opt('email'));
  const url = applyAndDeploy({ databaseId: db.uuid, email });
  const s = readSecrets();
  console.log(`\nDone${url ? `: ${url}` : ''}.`);
  console.log(`Check "Einstellungen" in the app: it should show Version ${version}.${s ? '' : ' (No .secrets.json here, so "npm run links" is not available in this folder.)'}`);
} catch (e) {
  die(e.message);
}
