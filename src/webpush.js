// Web Push for Workers: RFC 8291 message encryption (aes128gcm, the encoding Apple, Google and Mozilla all accept)
// plus VAPID (RFC 8292) authentication. Web Crypto only, no dependencies.
const enc = new TextEncoder();
const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const bytesToB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function hkdf(ikmBytes, salt, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikmBytes, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Encrypts `payload` (string) for a browser subscription. Returns the request body (header + one record). */
export async function encryptAes128gcm(subscription, payload, { salt, ephemeral } = {}) {
  const uaPublic = b64uToBytes(subscription.keys.p256dh); // 65 bytes, 0x04 || x || y
  const authSecret = b64uToBytes(subscription.keys.auth); // 16 bytes
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('Invalid subscription keys');

  const as = ephemeral || (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));

  const ikm = await hkdf(ecdh, authSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, s, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, s, enc.encode('Content-Encoding: nonce\0'), 12);

  const data = enc.encode(payload);
  if (data.length > 3800) throw new Error('Payload too large');
  const plain = concat(data, new Uint8Array([2])); // 0x02 marks the last (and only) record
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));

  const header = new Uint8Array(21);
  header.set(s, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** `Authorization: vapid t=<jwt>, k=<public key>` for one push service origin. */
export async function vapidAuthorization({ privateJWK, publicKey, subject, audience, now = Date.now() }) {
  const part = (o) => bytesToB64u(enc.encode(JSON.stringify(o)));
  const unsigned = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject });
  const key = await crypto.subtle.importKey('jwk', privateJWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)); // already r || s
  return `vapid t=${unsigned}.${bytesToB64u(sig)}, k=${publicKey}`;
}

/** Everything fetch() needs to deliver one message. */
export async function buildPushRequest({ privateJWK, publicKey, subject, subscription, payload, ttl = 3600, urgency = 'high', topic }) {
  const url = new URL(subscription.endpoint);
  if (url.protocol !== 'https:') throw new Error('Push endpoints must use HTTPS');
  const headers = {
    Authorization: await vapidAuthorization({ privateJWK, publicKey, subject, audience: url.origin }),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: urgency,
  };
  if (topic) headers.Topic = topic;
  return { endpoint: subscription.endpoint, headers, body: await encryptAes128gcm(subscription, JSON.stringify(payload)) };
}
