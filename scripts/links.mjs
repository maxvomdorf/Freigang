#!/usr/bin/env node
// Prints the two personal links again, or replaces one code (lost phone, link shared by mistake).
//   npm run links
//   npm run links -- --rotate kathrin
import { readSecrets, writeSecrets, printLinks, wrangler, generateCode, PEOPLE_INFO } from './lib.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const s = readSecrets();
if (!s || !s.url) { console.error('No .secrets.json with an address yet. Run "npm run setup" first.'); process.exit(1); }

const i = process.argv.indexOf('--rotate');
if (i >= 0) {
  const who = process.argv[i + 1];
  if (!PEOPLE_INFO[who]) { console.error('Use --rotate maxime or --rotate kathrin.'); process.exit(1); }
  const code = generateCode();
  const tmp = join(mkdtempSync(join(tmpdir(), 'freigang-')), 's.json');
  writeFileSync(tmp, JSON.stringify({ [PEOPLE_INFO[who].secretName]: code }), { mode: 0o600 });
  const r = wrangler(['secret', 'bulk', tmp]);
  rmSync(tmp, { force: true });
  if (!r.ok) { console.error('Uploading the new code failed; nothing changed.'); process.exit(1); }
  s.codes[who] = code;
  writeSecrets(s);
  console.log(`New code for ${who} is active. The old one stops working now.`);
}
printLinks(s);
