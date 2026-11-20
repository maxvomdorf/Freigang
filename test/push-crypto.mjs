// Receiver side of Web Push (RFC 8291 aes128gcm), written with node:crypto so the test does not use the code under test.
import { createDecipheriv, hkdfSync } from 'node:crypto';

/** device = { ecdh: ECDH(P-256) with keys, auth: Buffer(16), pub: Buffer(65) } */
export function decrypt(device, body) {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const secret = device.ecdh.computeSecret(asPub);
  const ikm = Buffer.from(hkdfSync('sha256', secret, device.auth, Buffer.concat([Buffer.from('WebPush: info\0'), device.pub, asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const dec = createDecipheriv('aes-128-gcm', cek, nonce);
  dec.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([dec.update(ct.subarray(0, ct.length - 16)), dec.final()]);
  let end = pt.length - 1;
  while (pt[end] === 0) end--;
  if (pt[end] !== 2) throw new Error('missing last-record delimiter');
  return pt.subarray(0, end);
}
