import { generateKeyPairSync, randomInt } from 'node:crypto';

/** VAPID key pair for Web Push. publicKey goes to the browser, privateJWK stays a Worker secret. */
export function generateVapid() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const priv = privateKey.export({ format: 'jwk' });
  const pub = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
  return {
    publicKey: raw.toString('base64url'),
    privateJWK: { kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y, d: priv.d },
  };
}

// 20 characters from an alphabet without 0/O/1/I/L, shown as 4 groups of 5: about 100 bits.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function generateCode() {
  let s = '';
  for (let i = 0; i < 20; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s.match(/.{5}/g).join('-');
}

// ---------- helpers shared by setup.mjs and links.mjs ----------
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SECRETS_FILE = join(ROOT, '.secrets.json');

/** Runs the project's wrangler. WRANGLER_BIN exists only so the setup flow can be tested against a fake. */
export function wrangler(args, { capture = false, env = {} } = {}) {
  const bin = process.env.WRANGLER_BIN;
  const [cmd, cmdArgs] = bin ? [bin, args] : ['npx', ['--no-install', 'wrangler', ...args]];
  const r = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

export function readSecrets() {
  return existsSync(SECRETS_FILE) ? JSON.parse(readFileSync(SECRETS_FILE, 'utf8')) : null;
}
export function writeSecrets(s) {
  writeFileSync(SECRETS_FILE, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
  try { chmodSync(SECRETS_FILE, 0o600); } catch { /* not supported on this OS */ }
}

export const PEOPLE_INFO = {
  maxime: { label: 'Maxime (Ilford, Admin)', secretName: 'TOKEN_MAXIME' },
  kathrin: { label: 'Kathrin (Bonnie)', secretName: 'TOKEN_KATHRIN' },
};

export function personalLinks(s) {
  return Object.entries(PEOPLE_INFO).map(([key, p]) => ({ key, label: p.label, code: s.codes[key], link: `${s.url}/#k=${s.codes[key]}` }));
}

export function printLinks(s) {
  console.log('\nPersonal links (send each one privately, e.g. by Signal or iMessage):\n');
  for (const l of personalLinks(s)) console.log(`  ${l.label}\n    ${l.link}\n    Code: ${l.code}\n`);
}

// ---------- deploy (shared by setup.mjs and deploy.mjs) ----------
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline/promises';

export const DEPLOY_CONFIG = 'wrangler.deploy.jsonc';
export const EMAIL_RE = /^[^\s@"\\]+@[^\s@"\\]+\.[^\s@"\\]+$/;

export function jsonFrom(text) {
  const a = text.search(/[\[{]/);
  const b = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
  return JSON.parse(text.slice(a, b + 1));
}

export async function askLine(question) {
  if (!process.stdin.isTTY) throw new Error(`${question} (no terminal to ask in; pass the answer as an option, see README)`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(question + ' ')).trim();
  rl.close();
  return a;
}

/** Looks up the D1 database by name. Returns {uuid, name} or null. */
export function findDatabase(name = 'freigang') {
  const r = wrangler(['d1', 'list', '--json'], { capture: true });
  if (!r.ok) throw new Error(`Could not list databases:\n${r.stderr || r.stdout}`);
  return jsonFrom(r.stdout).find((d) => d.name === name) || null;
}

/**
 * wrangler.jsonc stays a clean template in git (placeholder database_id and email).
 * The real values are filled into a generated, git-ignored wrangler.deploy.jsonc right before every deploy,
 * so pulling an update can never overwrite them and a deploy can never ship the placeholders.
 */
export function writeDeployConfig({ databaseId, email }) {
  const template = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
  const withId = template.replace(/("database_id"\s*:\s*")[^"]*(")/, `$1${databaseId}$2`);
  const out = withId.replace(/("VAPID_SUBJECT"\s*:\s*")[^"]*(")/, `$1mailto:${email}$2`);
  if (out === template || !out.includes(databaseId) || !out.includes(`mailto:${email}`)) {
    throw new Error('wrangler.jsonc has changed shape; could not fill in database_id and VAPID_SUBJECT.');
  }
  const p = join(ROOT, DEPLOY_CONFIG);
  writeFileSync(p, out);
  return p;
}

/** The contact address: option, then .secrets.json, then a real address left in wrangler.jsonc, then ask once. */
export async function resolveEmail(optionValue) {
  const fromConfig = /"VAPID_SUBJECT"\s*:\s*"mailto:([^"]*)"/.exec(readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8'))?.[1];
  const secrets = readSecrets();
  let email = optionValue || process.env.FREIGANG_EMAIL || secrets?.email || (fromConfig && !fromConfig.startsWith('CHANGE-ME') ? fromConfig : '');
  if (!email) {
    console.log('  Apple and Google require a real contact address in push messages (never shown to anyone).');
    email = await askLine('  Your email address:');
  }
  if (!EMAIL_RE.test(email)) throw new Error('That does not look like an email address.');
  if (secrets && secrets.email !== email) writeSecrets({ ...secrets, email });
  return email;
}

/** Applies new database migrations, then deploys. Migrations are additive, so this order is always safe. Returns the deployed URL or ''. */
export function applyAndDeploy({ databaseId, email }) {
  writeDeployConfig({ databaseId, email });
  const migrate = wrangler(['d1', 'migrations', 'apply', 'freigang', '--remote', '-c', DEPLOY_CONFIG]);
  if (!migrate.ok) throw new Error('Applying the database migrations failed.');
  const outFile = join(mkdtempSync(join(tmpdir(), 'freigang-')), 'wrangler-output.ndjson');
  const dep = wrangler(['deploy', '-c', DEPLOY_CONFIG], { env: { WRANGLER_OUTPUT_FILE_PATH: outFile } });
  if (!dep.ok) { rmSync(outFile, { force: true }); throw new Error('Deploy failed. If it mentions a workers.dev subdomain, pick one at https://dash.cloudflare.com (Workers & Pages) and try again.'); }
  let url = '';
  if (existsSync(outFile)) {
    const text = readFileSync(outFile, 'utf8');
    for (const line of text.split('\n')) {
      try { const e = JSON.parse(line); if (e.type === 'deploy') url = (e.targets || []).find((t) => /^https:\/\//.test(t)) || url; } catch { /* skip */ }
    }
    if (!url) url = /https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(text)?.[0] || '';
  }
  rmSync(outFile, { force: true });
  return url.replace(/\/+$/, '');
}
