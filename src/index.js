import { handleApi } from './api.js';
import { runCron } from './cron.js';
import { runWeatherSafe } from './weatherjob.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env, event.scheduledTime));
    ctx.waitUntil(runWeatherSafe(env, event.scheduledTime)); // separate on purpose: weather problems never touch the notifications
  },
};
