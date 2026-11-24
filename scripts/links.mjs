#!/usr/bin/env node
// Prints everybody's personal links. Creates and uploads codes for people who do not have one yet (new household members).
// Existing codes are never changed unless you ask for it.
//   npm run links
//   npm run links -- --rotate kathrin      new code for one person (lost phone, link shared by mistake)
import { readSecrets, writeSecrets, printLinks, wrangler, generateCode, addMissingCodes, codeSecrets, rememberAccount, PEOPLE_INFO } from './lib.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const s = readSecrets();
if (!s || !s.url) { console.error('No .secrets.json with an address yet. Run "npm run setup" first.'); process.exit(1); }
rememberAccount();

function upload(secrets) {
  const tmp = join(mkdtempSync(join(tmpdir(), 'freigang-')), 's.json');
  writeFileSync(tmp, JSON.stringify(secrets), { mode: 0o600 });
  const r = wrangler(['secret', 'bulk', tmp]);
  rmSync(tmp, { force: true });
  return r.ok;
}

const i = process.argv.indexOf('--rotate');
if (i >= 0) {
  const who = process.argv[i + 1];
  if (!PEOPLE_INFO[who]) { console.error(`Use --rotate with one of: ${Object.keys(PEOPLE_INFO).join(', ')}.`); process.exit(1); }
  const code = generateCode();
  if (!upload({ [PEOPLE_INFO[who].secretName]: code })) { console.error('Uploading the new code failed; nothing changed.'); process.exit(1); }
  s.codes[who] = code;
  writeSecrets(s);
  console.log(`New code for ${who} is active. The old one stops working now.`);
} else {
  const fresh = addMissingCodes(s);
  if (fresh.length) {
    if (!upload(codeSecrets(s, fresh))) { console.error('Uploading the new codes failed; nothing changed. Run "npm run links" again.'); process.exit(1); }
    writeSecrets(s);
    console.log(`New codes created and uploaded for: ${fresh.join(', ')}.`);
  }
}
printLinks(s);
