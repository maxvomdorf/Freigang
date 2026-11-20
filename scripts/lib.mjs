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
