// Pure functions that turn events into the admin log: intervals, overlaps, day ribbons, heatmap, incidents.
// "Outside" means status 'out'. 'soon' still counts as inside.
import { CATS, zoned, localToUtc, MIN, HOUR } from './util.js';

const AXIS_FROM = 5, AXIS_TO = 23; // ribbon axis, local hours

/** Out-intervals per cat clipped to [from, to]. Open intervals end at `to`. Events must include the last one before `from`. */
export function outIntervals(events, from, to) {
  const res = { ilford: [], bonnie: [] };
  for (const cat of CATS) {
    const evs = events.filter((e) => e.cat === cat).sort((a, b) => a.ts - b.ts || a.id - b.id);
    let start = null;
    for (const e of evs) {
      if (e.status === 'out') {
        if (start === null) start = e.ts;
      } else if (start !== null) {
        push(res[cat], start, e.ts, from, to);
        start = null;
      }
    }
    if (start !== null) push(res[cat], start, to, from, to);
  }
  return res;
}

function push(list, s, e, from, to) {
  const a = Math.max(s, from), b = Math.min(e, to);
  if (b > a) list.push([a, b]);
}

export function intersect(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]), e = Math.min(a[i][1], b[j][1]);
    if (e > s) out.push([s, e]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return out;
}

function clipTo(list, from, to) {
  const out = [];
  for (const [s, e] of list) push(out, s, e, from, to);
  return out;
}

const pct = (t, from, to) => +(((t - from) / (to - from)) * 100).toFixed(2);
function segs(list, from, to) {
  return list.map(([s, e]) => ({ l: pct(s, from, to), w: Math.max(1.2, +(((e - s) / (to - from)) * 100).toFixed(2)) }));
}

const DAY = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Everything the Protokoll tab needs. `events` = events of the window plus the last one before it, per cat. */
export function buildLog({ events, notes, now, days, tz }) {
  const from = now - days * 24 * HOUR;
  const iv = outIntervals(events, from, now);
  const ov = intersect(iv.ilford, iv.bonnie);

  // incidents, newest first
  const noteMap = new Map(notes.map((n) => [n.start_ts, n.note]));
  const incidents = ov
    .map(([s, e]) => {
      const startOf = (cat) => iv[cat].find(([a, b]) => a <= s && b >= e)?.[0] ?? 0;
      const second = startOf('ilford') >= startOf('bonnie') ? 'ilford' : 'bonnie';
      const secondStart = startOf(second);
      const trigger = events.find((x) => x.cat === second && x.status === 'out' && x.ts === secondStart);
      return {
        start: s, end: e, ongoing: e >= now - MIN, minutes: Math.max(1, Math.round((e - s) / MIN)),
        second, override: !!(trigger && trigger.override), note: noteMap.get(s) ?? '', catNote: trigger?.note || '',
      };
    })
    .reverse();

  // day ribbons: today first
  const nowZ = zoned(now, tz);
  const rows = [];
  const heat = { ilford: Array(AXIS_TO - AXIS_FROM).fill(0), bonnie: Array(AXIS_TO - AXIS_FROM).fill(0), ov: Array(AXIS_TO - AXIS_FROM).fill(0) };
  for (let k = 0; k < days; k++) {
    const d = new Date(Date.UTC(nowZ.year, nowZ.month - 1, nowZ.day - k, 12));
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
    const a = localToUtc(y, m, dd, AXIS_FROM, 0, tz), b = localToUtc(y, m, dd, AXIS_TO, 0, tz);
    const wd = (d.getUTCDay() + 6) % 7;
    rows.push({
      d: k === 0 ? 'Heute' : DAY[wd],
      date: `${String(dd).padStart(2, '0')}.${String(m).padStart(2, '0')}.`,
      il: segs(clipTo(iv.ilford, a, b), a, b),
      bo: segs(clipTo(iv.bonnie, a, b), a, b),
      ov: segs(clipTo(ov, a, b), a, b),
    });
    for (let h = AXIS_FROM; h < AXIS_TO; h++) {
      const ha = localToUtc(y, m, dd, h, 0, tz), hb = localToUtc(y, m, dd, h + 1, 0, tz);
      const win = [[Math.max(ha, from), Math.min(hb, now)]].filter(([s, e]) => e > s);
      for (const [key, list] of [['ilford', iv.ilford], ['bonnie', iv.bonnie], ['ov', ov]]) {
        const mins = intersect(win, list).reduce((sum, [s, e]) => sum + (e - s), 0);
        heat[key][h - AXIS_FROM] += mins / HOUR;
      }
    }
  }
  const norm = (arr) => arr.map((v) => ({ o: +Math.min(1, 0.07 + 0.93 * (v / days)).toFixed(2) }));

  return {
    now, days,
    kpi: {
      overlaps: incidents.length,
      overlapMinutes: Math.round(ov.reduce((s, [a, b]) => s + (b - a), 0) / MIN),
      overrides: incidents.filter((i) => i.override).length,
    },
    rows, heat: { ilford: norm(heat.ilford), bonnie: norm(heat.bonnie), ov: norm(heat.ov) }, incidents,
  };
}

/** Today's out segments for the "Heute" strip. */
export function todayStrip({ events, now, tz }) {
  const z = zoned(now, tz);
  const a = localToUtc(z.year, z.month, z.day, AXIS_FROM, 0, tz), b = localToUtc(z.year, z.month, z.day, AXIS_TO, 0, tz);
  const iv = outIntervals(events, a, Math.min(now, b));
  return { ilford: segs(iv.ilford, a, b), bonnie: segs(iv.bonnie, a, b), nowPct: pct(Math.min(Math.max(now, a), b), a, b), from: a, to: b };
}
