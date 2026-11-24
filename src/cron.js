// Runs every minute: plan reminders, "Auf geht’s" and "still outside?" nudges, sent to everyone who looks after that cat. Quiet hours (if set) silence only these.
// Status-change pushes (api.js) are never silenced: cats are often out at dusk, which is exactly when it matters.
import { CATS, CAT_NAME, peopleOfCat, zoned, durText, isQuiet, numVar, HOUR, MIN } from './util.js';
import { notifyUsers } from './push.js';
import { lastEvents } from './db.js';
import { minutesUntilStart } from './slots.js';

async function claim(env, key, now) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO sent_keys (key, ts) VALUES (?, ?)').bind(key, now).run();
  return (r.meta?.changes ?? 0) === 1;
}

export async function runCron(env, nowMs = Date.now()) {
  const tz = env.TIMEZONE || 'Europe/Berlin';
  const z = zoned(nowMs, tz);
  const quiet = isQuiet(z.hour, numVar(env.QUIET_START, 22), numVar(env.QUIET_END, 6));
  const staleMs = numVar(env.STALE_HOURS, 5) * HOUR;

  const last = await lastEvents(env);
  const sent = [];

  if (!quiet) {
    // 1. Plan reminders: from `remind` minutes before the window until it starts, once per occurrence.
    //    Counted on the whole week, so a window starting at 00:05 is announced from 23:50 the evening before.
    const { results: slots } = await env.DB.prepare('SELECT * FROM schedule_slots').all();
    const nowMin = Math.floor(nowMs / MIN);
    for (const s of slots) {
      const until = minutesUntilStart({ weekday: s.weekday, start: s.start_min }, z.weekday, z.minutes);
      if (until > s.remind_min) continue;
      if ((last[s.cat]?.status ?? 'in') !== 'in') continue;
      if (!(await claim(env, `rem:${s.id}:${nowMin + until}`, nowMs))) continue;
      const t = `${String(Math.floor(s.start_min / 60)).padStart(2, '0')}:${String(s.start_min % 60).padStart(2, '0')}`;
      await notifyUsers(env, peopleOfCat(s.cat), {
        title: `Gleich: ${CAT_NAME[s.cat]} darf raus`, body: `Freigang-Zeit um ${t} Uhr.`, tag: `plan-${s.cat}`,
      }, { urgency: 'normal' });
      sent.push(`rem:${s.id}`);
    }

    for (const cat of CATS) {
      const row = last[cat];
      if (!row) continue;
      // 2. Countdown ran out and nothing happened.
      if (row.status === 'soon' && row.soon_until && row.soon_until <= nowMs && (await claim(env, `soon:${row.id}`, nowMs))) {
        await notifyUsers(env, peopleOfCat(cat), {
          title: `${CAT_NAME[cat]}: Auf geht’s`, body: 'Jetzt rauslassen oder abbrechen?', tag: `nudge-${cat}`,
        }, { urgency: 'normal' });
        sent.push(`soon:${row.id}`);
      }
      // 3. Outside for a long time: probably forgot to tap "Wieder drin". Repeats every STALE_HOURS.
      if (row.status === 'out' && nowMs - row.ts >= staleMs) {
        const n = Math.floor((nowMs - row.ts) / staleMs);
        if (await claim(env, `stale:${row.id}:${n}`, nowMs)) {
          await notifyUsers(env, peopleOfCat(cat), {
            title: 'Noch draußen?', body: `${CAT_NAME[cat]} ist seit ${durText(nowMs - row.ts)} draußen.`, tag: `nudge-${cat}`,
          }, { urgency: 'normal' });
          sent.push(`stale:${row.id}:${n}`);
        }
      }
    }
  }

  // 4. Housekeeping once a night.
  if (z.hour === 4 && z.minute === 0) {
    await env.DB.prepare('DELETE FROM sent_keys WHERE ts < ?').bind(nowMs - 7 * 24 * HOUR).run();
  }
  return sent;
}
