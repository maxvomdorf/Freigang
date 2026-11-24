// Web Push from a Worker (the usual `web-push` package needs Node). Encryption and VAPID live in webpush.js.
import { buildPushRequest } from './webpush.js';

export async function sendPush(env, sub, payload, opts = {}) {
  const privateJWK = JSON.parse(env.VAPID_PRIVATE_JWK);
  const { endpoint, headers, body } = await buildPushRequest({
    privateJWK,
    publicKey: env.VAPID_PUBLIC_KEY,
    subject: env.VAPID_SUBJECT,
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    payload,
    ttl: opts.ttl ?? 3600,
    urgency: opts.urgency ?? 'high',
    topic: opts.topic,
  });
  // PUSH_TEST_URL exists only in .dev.vars (never deployed): the integration test redirects pushes to a local mock.
  const target = env.PUSH_TEST_URL ? env.PUSH_TEST_URL + new URL(endpoint).pathname : endpoint;
  const res = await fetch(target, { method: 'POST', headers, body });
  if (res.status === 404 || res.status === 410) {
    // The device unsubscribed or the subscription expired: forget it.
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run();
    return { ok: false, gone: true, status: res.status };
  }
  if (!res.ok) console.log('push rejected', res.status, (await res.text()).slice(0, 200));
  return { ok: res.ok, status: res.status };
}

/** Sends to every device of one person. Never throws. Returns how many devices accepted it. */
export const notifyUser = (env, user, payload, opts = {}) => notifyUsers(env, [user], payload, opts);

/** Sends to every device of several people. Never throws. Returns how many devices accepted it. */
export async function notifyUsers(env, users, payload, opts = {}) {
  if (!users.length) return 0;
  const marks = users.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user IN (${marks})`).bind(...users).all();
  let sent = 0;
  await Promise.all(
    results.map(async (sub) => {
      try {
        const r = await sendPush(env, sub, { url: '/', ...payload }, opts);
        if (r.ok) sent++;
      } catch (e) {
        console.log('push failed', String(e).slice(0, 200));
      }
    }),
  );
  return sent;
}
