// Freigang – client. Plain ES module, no build step. Everything the person sees is German.
const CATS = { ilford: { name: 'Ilford', gen: 'Ilfords' }, bonnie: { name: 'Bonnie', gen: 'Bonnies' } };
const VERSION = '1.4.0'; // same as src/version.js; a newer server version makes the app reload itself once
const NOTES = ['In Begleitung', 'Nur kurz draußen'], NOTE_MAX = 40; // quick notes on a cat's status; the server caps custom text at 40
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const SOON_MIN = 15;

const ICONS = {
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  doorout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M4 12h10"/><path d="M10 8l4 4-4 4"/>',
  doorin: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M20 12H10"/><path d="M14 8l-4 4 4 4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.5 2.5 4.5-5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5"/><path d="M12 17.3v.2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.8v.2"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  pencil: '<path d="M5 19l1-4L16 5l3 3L9 18z"/>',
  download: '<path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  share: '<path d="M12 15V4M8.5 7.5L12 4l3.5 3.5"/><path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const ic = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (s) => document.querySelector(s);
const img = (cat, kind) => `/img/${cat}-${kind}.svg`;

// ---------- storage (iOS may throw in odd contexts, so keep a memory fallback) ----------
const mem = {};
const store = {
  get(k) { try { return localStorage.getItem('freigang.' + k); } catch { return mem[k] ?? null; } },
  set(k, v) { try { localStorage.setItem('freigang.' + k, v); } catch { mem[k] = v; } },
  del(k) { try { localStorage.removeItem('freigang.' + k); } catch { delete mem[k]; } },
};

// ---------- state ----------
const S = {
  code: '', state: null, skew: 0, tz: 'Europe/Berlin', online: true, view: 'loading',
  plan: null, planDay: 0, log: null, logDays: 7,
  noteDraft: '', sheet: null, toast: '', busy: false, loginError: '', loginBusy: false,
  push: { supported: false, perm: 'default', subscribed: false }, installEvent: null, confirmLogout: false,
};
const now = () => Date.now() + S.skew;
const me = () => S.state.me;
const ownCat = () => me().cat;
const otherCat = () => me().other;

// ---------- time helpers (always in the cats' time zone, not the phone's) ----------
let dtf = null;
function makeFmt() {
  dtf = new Intl.DateTimeFormat('en-GB', { timeZone: S.tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
}
const WD_EN = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
function tp(ts) {
  if (!dtf) makeFmt();
  const o = {};
  for (const p of dtf.formatToParts(ts)) o[p.type] = p.value;
  return { y: o.year, mo: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second, wd: WD_EN[o.weekday] ?? 0 };
}
const hhmm = (ts) => { const p = tp(ts); return `${p.h}:${p.mi}`; };
const dayKey = (ts) => { const p = tp(ts); return `${p.y}-${p.mo}-${p.d}`; };
const minToText = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const textToMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : NaN; };
function dur(ms) {
  const m = Math.round(ms / 60000);
  if (m <= 0) return 'gerade eben';
  const h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h} Std ${mm} Min` : `${m} Min`;
}
function sinceText(ts) {
  if (!ts) return 'noch keine Meldung';
  const p = tp(ts);
  const when = dayKey(ts) === dayKey(now()) ? `${p.h}:${p.mi}` : `${p.d}.${p.mo}. ${p.h}:${p.mi}`;
  return `seit ${when} · ${dur(now() - ts)}`;
}
const headerDate = () => { const p = tp(now()); return `${WD[p.wd]}, ${+p.d}. ${MON[+p.mo - 1]} · ${p.h}:${p.mi}`; };
const durShort = (m) => (m < 60 ? `${m} Min` : `${Math.floor(m / 60)} Std${m % 60 ? ` ${m % 60} Min` : ''}`);
const hMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h` : `${m} Min`);
const pctOf = (m) => +((m / 1440) * 100).toFixed(2); // plan strip: 00–24 h
const segStyle = (a, b) => `left:${pctOf(a)}%;width:${Math.max(1.2, +(pctOf(b) - pctOf(a)).toFixed(2))}%`;

// ---------- network ----------
async function api(method, path, body, opts = {}) {
  const res = await fetch(path, {
    method, cache: 'no-store',
    headers: { authorization: 'Bearer ' + S.code, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && !opts.keep) logout('Der Zugangscode wurde nicht erkannt. Bitte neu eingeben.');
  return { status: res.status, ok: res.ok, data };
}

function applyState(st) {
  S.state = st;
  S.skew = st.now - Date.now();
  if (st.tz !== S.tz || !dtf) { S.tz = st.tz; makeFmt(); }
  if (st.cats?.[st.me.cat]?.status !== 'in') S.noteDraft = '';
  store.set('last', JSON.stringify(st));
}

// An installed app can keep running old code for days. When the server is newer, reload once (never in a loop, never mid-edit).
function reloadIfOutdated(serverVersion) {
  if (!serverVersion || serverVersion === VERSION || S.sheet || S.busy) return;
  try {
    if (sessionStorage.getItem('freigang.reloaded') === serverVersion) return;
    sessionStorage.setItem('freigang.reloaded', serverVersion);
  } catch { return; }
  location.reload();
}

async function refresh() {
  if (!S.code || !S.state) return;
  try {
    const r = await api('GET', '/api/state');
    if (r.ok) { applyState(r.data); S.online = true; reloadIfOutdated(r.data.version); } else S.online = false;
    if (S.online && S.view === 'plan') await loadPlan();
    if (S.online && S.view === 'log' && me().admin) await loadLog();
  } catch { S.online = false; }
  render();
}
async function loadPlan() { const r = await api('GET', '/api/plan'); if (r.ok) S.plan = r.data.slots; }
async function loadLog() { const r = await api('GET', `/api/log?days=${S.logDays}`); if (r.ok) S.log = r.data; }

// ---------- push ----------
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const swReady = () => Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 4000))]);

async function readPush() {
  if (!pushSupported()) { S.push = { supported: false, perm: 'default', subscribed: false }; return; }
  let sub = null;
  try { const reg = await swReady(); sub = reg ? await reg.pushManager.getSubscription() : null; } catch { /* ignore */ }
  S.push = { supported: true, perm: Notification.permission, subscribed: !!sub };
}

async function subscribeAndSend() {
  const reg = await swReady();
  if (!reg) throw new Error('no service worker');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(S.state.vapidPublicKey) });
    } catch (e) {
      // A subscription made with another key blocks subscribing: drop it and retry once.
      const old = await reg.pushManager.getSubscription();
      if (old) { await old.unsubscribe(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(S.state.vapidPublicKey) }); } else throw e;
    }
  }
  const r = await api('POST', '/api/push', sub.toJSON());
  if (!r.ok) throw new Error('server');
}

async function enablePush() {
  if (!pushSupported()) {
    toast(isIOS() && !isStandalone() ? 'Zuerst zum Home-Bildschirm hinzufügen, dann hier erlauben.' : 'Dieser Browser unterstützt keine Benachrichtigungen.');
    return;
  }
  try {
    const perm = await Notification.requestPermission(); // must run straight from the tap
    if (perm !== 'granted') { await readPush(); toast('Benachrichtigungen sind nicht erlaubt. Du kannst das in den iPhone-Einstellungen ändern.'); render(); return; }
    await subscribeAndSend();
    await readPush();
    toast('Benachrichtigungen sind aktiv.');
  } catch {
    await readPush();
    toast('Das hat nicht geklappt. Bitte nochmal versuchen.');
  }
  render();
}

async function disablePush() {
  try {
    const reg = await swReady();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) { await api('DELETE', '/api/push', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
  } catch { /* ignore */ }
  await readPush();
  toast('Benachrichtigungen sind auf diesem Gerät aus.');
  render();
}

// Quietly keeps the server's copy of this device's subscription current (it can change without notice).
async function syncPush() {
  await readPush();
  if (S.push.supported && S.push.perm === 'granted') { try { await subscribeAndSend(); await readPush(); } catch { /* try again next start */ } }
}

// ---------- toast + sheets ----------
let toastTimer = 0;
function toast(msg) {
  S.toast = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = ''; renderOverlay(); }, 6500);
  renderOverlay();
}
function openSheet(sheet) { S.sheet = sheet; S.toast = ''; clearTimeout(toastTimer); render(); }
function closeSheet() { S.sheet = null; S.confirmLogout = false; render(); }

// ---------- views ----------
function statusChip(st, cls = '') {
  const t = { in: 'Drinnen', soon: 'Gleich draußen', out: 'Draußen' }[st];
  return `<span class="chip ${st} ${cls}">${t}</span>`;
}
const soonLeft = (c) => (c.soonUntil ? Math.max(0, Math.ceil((c.soonUntil - now()) / 60000)) : 0);
const portrait = (cat, st) => img(cat, st === 'in' ? 'curled' : 'sitting');

function banner() {
  const C = S.state.cats, o = ownCat(), t = otherCat(), on = CATS[o].name, tn = CATS[t].name;
  const oc = C[o], tc = C[t];
  let tone = 'ok', title = 'Alles ruhig', sub = 'Beide Katzen sind drinnen';
  if (oc.status === 'out' && tc.status === 'out') {
    tone = 'alert'; title = 'Beide draußen – mögliche Begegnung';
    sub = `Ilford seit ${hhmm(C.ilford.since)} · Bonnie seit ${hhmm(C.bonnie.since)}`;
  } else if (oc.status === 'soon' && tc.status === 'soon') {
    tone = 'warn'; title = 'Beide wollen gleich raus'; sub = 'Bitte kurz absprechen.';
  } else if (oc.status === 'soon' && tc.status === 'out') {
    tone = 'warn'; title = `${on} will raus, ${tn} ist noch draußen`; sub = `${tn} seit ${hhmm(tc.since)} draußen`;
  } else if (oc.status === 'soon') {
    tone = 'warn'; title = soonLeft(oc) ? `${on} geht in ${soonLeft(oc)} Min raus` : `${on}: Auf geht’s`; sub = `${tn} ist drinnen`;
  } else if (tc.status === 'soon') {
    tone = 'warn'; title = soonLeft(tc) ? `${tn} geht in ${soonLeft(tc)} Min raus` : `${tn} will jetzt raus`;
    sub = oc.status === 'out' ? `${on} ist noch draußen – bitte vorher reinholen.` : `${on} bleibt besser noch drin.`;
  } else if (tc.status === 'out') {
    tone = 'note'; title = `${tn} ist draußen`; sub = (tc.note ? `„${tc.note}“ · ` : '') + (S.state.waiting ? 'Du wirst benachrichtigt, sobald sie drin ist' : `${on} bleibt drin`);
  } else if (oc.status === 'out') {
    tone = 'note'; title = `${on} ist draußen`; sub = `${tn} bleibt drin`;
  }
  const icon = { ok: 'check', note: 'info', warn: 'clock', alert: 'alert' }[tone];
  return `<div class="banner tone-${tone}" role="status"><div class="ico">${ic(icon)}</div><div class="t"><b>${esc(title)}</b><span>${esc(sub)}</span></div></div>`;
}

function ownCard() {
  const C = S.state.cats, o = ownCat(), t = otherCat(), c = C[o], tn = CATS[t].name, partner = me().otherName;
  const dis = S.busy ? 'disabled' : '';
  let meta = sinceText(c.since), bar = '', actions = '';
  if (c.status === 'soon') {
    const total = Math.max(1, (c.soonUntil || 0) - (c.since || 0));
    const pct = Math.min(100, Math.max(0, Math.round(((now() - c.since) / total) * 100)));
    meta = soonLeft(c) ? `Start um ${hhmm(c.soonUntil)} · noch ${soonLeft(c)} Min` : 'Auf geht’s – jetzt raus oder abbrechen';
    bar = `<div class="progress" role="progressbar" aria-label="Vorwarnzeit" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div>`;
    actions = `<button class="btn out" data-act="raus" ${dis}>${ic('doorout', 22)} Jetzt raus</button>
      <button class="btn ghost" data-act="cancelSoon" ${dis}>Abbrechen</button>
      <div class="line ok">${ic('check', 18)}<span>${esc(partner)} ist vorgewarnt.</span></div>`;
  } else if (c.status === 'in') {
    const tOut = C[t].status === 'out';
    let note = '';
    if (tOut && S.state.waiting) note = `<div class="line ok">${ic('bell', 18)}<span>Du wirst benachrichtigt, sobald ${esc(tn)} drin ist.</span><button data-act="unwait">Abbrechen</button></div>`;
    else if (tOut) note = `<div class="line warn">${ic('alert', 18)}<span>${esc(tn)} ist draußen – ich frage vorher nach.</span></div>`;
    actions = `<button class="btn out" data-act="raus" ${dis}>${ic('doorout', 22)} Jetzt rauslassen</button>
      <button class="btn ghost" data-act="soon" ${dis}>${ic('clock')} In ${SOON_MIN} Min – ${esc(partner)} vorwarnen</button>${note}`;
  } else {
    actions = `<button class="btn in" data-act="back" ${dis}>${ic('doorin', 22)} Ist wieder drin</button>
      <button class="btn ghost" data-act="adjust" ${dis}>${ic('clock')} Kam früher rein? Zeit anpassen</button>`;
  }
  return `<section class="card card-main" aria-label="${CATS[o].name}">
    <div class="row">
      <div class="portrait big"><img src="${portrait(o, c.status)}" alt=""></div>
      <div class="stack">
        <span class="eyebrow">Deine Katze</span>
        <h2 class="name-l">${CATS[o].name}</h2>
        ${statusChip(c.status)}
        <span class="meta">${esc(meta)}</span>
      </div>
    </div>${bar}${noteChips(c)}<div class="actions">${actions}</div></section>`;
}

// Quick note on your own cat. While it is inside the choice is a draft that rides along with the next tap; once it is announced or out the chips edit the live note.
function noteChips(c) {
  const live = c.status !== 'in', cur = live ? c.note : S.noteDraft, custom = cur && !NOTES.includes(cur);
  const chips = NOTES.map((n, i) => `<button type="button" data-act="notePick" data-n="${i}" aria-pressed="${cur === n}" ${S.busy ? 'disabled' : ''}>${esc(n)}</button>`).join('');
  const own = `<button type="button" data-act="noteCustom" aria-pressed="${!!custom}" aria-label="${custom ? 'Eigenen Hinweis ändern' : 'Eigenen Hinweis schreiben'}" ${S.busy ? 'disabled' : ''}>${ic('pencil', 14)}<span>${custom ? esc(cur) : 'Eigener Text'}</span></button>`;
  return `<div class="notebox"><span class="eyebrow">${live ? 'Hinweis' : `Hinweis für ${esc(me().otherName)} (optional)`}</span><div class="notes" role="group" aria-label="Hinweis">${chips}${own}</div></div>`;
}

function otherCard() {
  const t = otherCat(), c = S.state.cats[t];
  const meta = c.status === 'soon' ? (soonLeft(c) ? `Start um ${hhmm(c.soonUntil)} · noch ${soonLeft(c)} Min` : 'wollte gerade raus') : sinceText(c.since);
  return `<section class="card" aria-label="${CATS[t].name}" style="flex-direction:row;align-items:center;gap:14px;border-radius:24px">
    <div class="portrait mid"><img src="${portrait(t, c.status)}" alt=""></div>
    <div class="stack" style="flex:1">
      <div class="row" style="gap:10px;flex-wrap:wrap"><h2 class="name-m">${CATS[t].name}</h2>${statusChip(c.status, 'sm')}</div>
      <span class="meta">${esc(meta)}</span>
      ${c.note ? `<span class="notepill">${ic('info', 14)}<span>${esc(c.note)}</span></span>` : ''}
      <span class="lock">${ic('lock', 14)} Status setzt ${esc(me().otherName)}</span>
    </div></section>`;
}

function hoursRow(spacer, left = [25, 50, 75]) {
  return `<div class="hours"><i style="width:${spacer}px"></i><div>${[6, 12, 18].map((h, i) => `<span style="left:${left[i]}%">${h}</span>`).join('')}</div></div>`;
}

function todayCard() {
  const T = S.state.today, o = ownCat(), t = otherCat();
  const rowTop = { [o]: 6, [t]: 28 };
  const segs = (cat) => T[cat].map((s) => `<div class="seg ${cat === 'ilford' ? 'il' : 'bo'}" style="top:${rowTop[cat]}px;height:10px;border-radius:5px;left:${s.l}%;width:${s.w}%"></div>`).join('');
  return `<section class="card" aria-label="Heute" style="gap:10px;padding-bottom:12px;border-radius:24px">
    <div class="sec-head"><h3>Heute</h3></div>
    <div class="strip-wrap">
      <div class="strip-heads" style="width:22px;padding-bottom:1px"><img src="${img(o, 'head')}" alt="${CATS[o].name}" width="22" height="22"><img src="${img(t, 'head')}" alt="${CATS[t].name}" width="22" height="22"></div>
      <div class="strip" style="height:44px">
        <div class="track" style="top:6px;height:10px;border-radius:5px"></div><div class="track" style="top:28px;height:10px;border-radius:5px"></div>
        ${segs(o)}${segs(t)}<div class="now" style="left:${T.nowPct}%"></div>
      </div>
    </div>${hoursRow(22)}</section>`;
}

function homeView() {
  return `<div class="scroll"><div class="page">
    <div class="head"><div class="head-text"><h1>Freigang</h1><p class="sub">${esc(headerDate())}</p></div>
      <button class="icon-btn" data-act="settings" aria-label="Einstellungen">${ic('sliders', 22)}</button></div>
    ${banner()}${ownCard()}${otherCard()}${todayCard()}</div></div>`;
}

// ----- plan -----
// A window belongs to the weekday it starts on and may run past midnight (end > 1440). On the next day it shows as a carried-over segment.
function dayPlan() {
  const day = S.planDay, segs = [];
  for (const s of S.plan || []) {
    if (s.weekday === day) segs.push({ s, start: s.start, end: Math.min(s.end, 1440), carried: false });
    if (s.end > 1440 && (s.weekday + 1) % 7 === day) segs.push({ s, start: 0, end: s.end - 1440, carried: true });
  }
  segs.sort((a, b) => a.start - b.start);
  const by = { ilford: segs.filter((x) => x.s.cat === 'ilford'), bonnie: segs.filter((x) => x.s.cat === 'bonnie') };
  const ov = [];
  for (const a of by.ilford) for (const b of by.bonnie) { const st = Math.max(a.start, b.start), e = Math.min(a.end, b.end); if (e > st) ov.push({ start: st, end: e }); }
  return { by, ov };
}
const slotTime = (s) => `${minToText(s.start)}–${minToText(s.end % 1440)}`;

function slotHint(sh) {
  const a = textToMin(sh.start), b = textToMin(sh.end);
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) return 'Liegt „Bis“ vor „Von“, geht das Fenster in den nächsten Tag.';
  if (b > a) return '';
  const wd = sh.id ? sh.weekday : (sh.days.length === 1 ? sh.days[0] : null);
  return `Endet ${wd === null ? 'am Folgetag' : WD[(wd + 1) % 7]} um ${sh.end} Uhr (nächster Tag).`;
}

function planView() {
  const o = ownCat(), t = otherCat(), today = tp(now()).wd;
  const days = WD.map((d, i) => `<button class="day ${i === today ? 'today' : ''}" data-act="planDay" data-i="${i}" aria-pressed="${i === S.planDay}" aria-label="${WD_LONG[i]}">${d}</button>`).join('');
  let body = '<p class="empty">Lade Zeitfenster …</p>';
  if (S.plan) {
    const { by, ov } = dayPlan();
    const bar = (cat, top) => by[cat].map((x) => `<div class="seg ${cat === 'ilford' ? 'il' : 'bo'}" style="top:${top}px;height:16px;border-radius:8px;${segStyle(x.start, x.end)}"></div>`).join('');
    const tops = { ilford: o === 'ilford' ? 6 : 46, bonnie: o === 'bonnie' ? 6 : 46 };
    const ovHtml = ov.map((x) => `<div class="ovband" style="top:-2px;bottom:-2px;${segStyle(x.start, x.end)}"></div>`).join('');
    const warn = ov.length
      ? `<div class="box alert" role="alert"><span style="padding-top:1px">${ic('alert')}</span><div><b>Überschneidung ${ov.map((x) => `${minToText(x.start)}–${minToText(x.end)}`).join(', ')}</b><span>Beide wären gleichzeitig draußen. ${CATS[o].gen} Fenster kürzen oder verschieben?</span></div></div>`
      : `<div class="box ok">${ic('check')} Keine Überschneidungen</div>`;
    const row = (x, mine) => { const s = x.s, over = s.end > 1440;
      const sub = x.carried ? `${ic('moon', 14)} Fortsetzung von ${WD[s.weekday]}`
        : mine ? `${ic('bell', 14)} ${s.remind} Min vorher erinnern${over ? ` · bis ${WD[(s.weekday + 1) % 7]}` : ''}`
        : `${ic('lock', 14)} Von ${esc(me().otherName)}${over ? ` · bis ${WD[(s.weekday + 1) % 7]}` : ''}`;
      return `<div class="slot"><img src="${img(s.cat, 'head')}" alt="${CATS[s.cat].name}" width="40" height="40">
      <div class="info"><b class="time">${x.carried ? `00:00–${minToText(s.end % 1440)}` : slotTime(s)}</b><span>${sub}</span></div>
      ${mine ? `<button class="round-btn" data-act="editSlot" data-id="${s.id}" aria-label="Zeitfenster ${slotTime(s)} bearbeiten">${ic('pencil')}</button>` : ''}</div>`; };
    const list = by[o].map((s) => row(s, true)).join('') + by[t].map((s) => row(s, false)).join('');
    body = `<section class="card" aria-label="Tagesplan" style="padding:16px;border-radius:24px">
        <div class="sec-head"><h2 style="font-size:22px">${WD_LONG[S.planDay]}</h2><span class="small">0 – 24 Uhr</span></div>
        <div class="strip-wrap">
          <div class="strip-heads" style="width:28px;padding:3px 0 5px"><img src="${img(o, 'head')}" alt="${CATS[o].name}" width="28" height="28"><img src="${img(t, 'head')}" alt="${CATS[t].name}" width="28" height="28"></div>
          <div class="strip" style="height:70px">${ovHtml}<div class="track" style="top:6px;height:16px;border-radius:8px"></div><div class="track" style="top:46px;height:16px;border-radius:8px"></div>${bar('ilford', tops.ilford)}${bar('bonnie', tops.bonnie)}</div>
        </div>${hoursRow(28, [25, 50, 75])}${warn}</section>
      <section class="card slots" aria-label="Zeitfenster" style="border-radius:24px;gap:0">
        ${list || '<p class="empty">Für diesen Tag gibt es noch keine Zeitfenster. Lege feste Zeiten an, dann erinnern wir dich kurz vorher.</p>'}
        <button class="btn ghost" data-act="addSlot">${ic('plus')} Zeitfenster für ${CATS[o].name}</button></section>`;
  }
  return `<div class="scroll"><div class="page" style="gap:14px">
    <div class="head-text" style="min-height:56px;justify-content:center"><h1>Plan</h1><p class="sub">Wiederkehrende Freigang-Zeiten pro Katze</p></div>
    <div class="days">${days}</div>${body}</div></div>`;
}

// ----- log (admin) -----
function incidentWhen(i) {
  const p = tp(i.start);
  const head = `${WD[p.wd]} ${p.d}.${p.mo}.`;
  return i.ongoing ? `${head} · seit ${hhmm(i.start)} · läuft noch` : `${head} · ${hhmm(i.start)}–${hhmm(i.end)}`;
}

function logView() {
  const L = S.log;
  let body = '<p class="empty" style="text-align:center">Lade Protokoll …</p>';
  if (L) {
    const il = (cat, row, top) => row[cat === 'ilford' ? 'il' : 'bo'].map((s) => `<div class="seg ${cat === 'ilford' ? 'il' : 'bo'}" style="top:${top}px;height:12px;border-radius:6px;left:${s.l}%;width:${s.w}%"></div>`).join('');
    const rows = L.rows.map((r) => `<div class="dayrow"><div class="lbl"><b>${esc(r.d)}</b><span>${esc(r.date)}</span></div>
      <div class="strip" style="height:34px">${r.ov.map((o) => `<div class="ovband" style="top:-3px;bottom:-3px;left:${o.l}%;width:${o.w}%"></div>`).join('')}
        <div class="track" style="top:2px;height:12px;border-radius:6px"></div><div class="track" style="top:20px;height:12px;border-radius:6px"></div>${il('ilford', r, 2)}${il('bonnie', r, 20)}</div></div>`).join('');
    const heat = (label, cells, bg) => `<div class="heatrow"><span>${label}</span><div>${cells.map((c) => `<i style="background:${bg};opacity:${c.o}"></i>`).join('')}</div></div>`;
    const inc = L.incidents.map((i) => `<button class="inc" data-act="note" data-start="${i.start}"><div class="dot">${ic('alert', 18)}</div>
      <div class="txt"><b>${esc(incidentWhen(i))}</b><span class="meta">${durShort(i.minutes)} · zweite Katze: ${CATS[i.second].name}${i.catNote ? ` („${esc(i.catNote)}“)` : ''}</span>
      ${i.note ? `<em>Notiz: ${esc(i.note)}</em>` : ''}</div>${i.override ? '<span class="tag">Override</span>' : ''}</button>`).join('');
    const ranges = [7, 30].map((d) => `<button data-act="logDays" data-d="${d}" aria-pressed="${S.logDays === d}">${d} Tage</button>`).join('');
    body = `<div class="seg-ctl" role="group" aria-label="Zeitraum">${ranges}</div><div class="kpis">
        <div class="kpi"><b>${L.kpi.overlaps}</b><span>Überschneidungen</span></div>
        <div class="kpi"><b>${hMin(L.kpi.overlapMinutes)}</b><span>zusammen draußen</span></div>
        <div class="kpi"><b>${L.kpi.overrides}</b><span>mit Override</span></div></div>
      <section class="card" aria-label="Tagesband" style="gap:8px;padding:16px;border-radius:24px"><h2 style="font-size:20px">Tagesband</h2>
        <div class="legend"><span><i style="width:18px;height:8px;border-radius:4px;background:var(--ink)"></i>Ilford</span><span><i style="width:18px;height:8px;border-radius:4px;background:var(--bonnie)"></i>Bonnie</span><span><i style="width:10px;height:14px;border-left:2px solid var(--ov);border-right:2px solid var(--ov);background:rgba(168,50,31,.16)"></i>gemeinsam draußen</span></div>
        <div style="margin-top:4px">${hoursRow(46)}</div>${rows}</section>
      <section class="card" aria-label="Uhrzeiten" style="gap:10px;padding:16px;border-radius:24px">
        <div style="display:flex;flex-direction:column;gap:2px"><h2 style="font-size:20px">Wann sind sie draußen?</h2><span class="small">Je dunkler, desto öfter in diesen ${L.days} Tagen</span></div>
        ${heat('Ilford', L.heat.ilford, 'var(--ink)')}${heat('Bonnie', L.heat.bonnie, '#B9822F')}${heat('Gemeinsam', L.heat.ov, 'var(--ov)')}
        ${hoursRow(72, [27.08, 52.08, 77.08])}</section>
      <section class="card" aria-label="Überschneidungen" style="padding:16px 16px 6px;gap:0;border-radius:24px">
        <div class="sec-head" style="padding-bottom:10px;align-items:center"><h2 style="font-size:20px">Überschneidungen</h2><span class="count ${L.kpi.overlaps ? '' : 'zero'}">${L.kpi.overlaps}</span></div>
        ${inc || `<p class="empty" style="padding-top:4px">Keine Überschneidungen in diesem Zeitraum.</p>`}
        ${inc ? '<p class="small" style="padding:8px 0 10px">Tippen, um eine Notiz zu ergänzen.</p>' : ''}</section>
      <button class="btn ghost" data-act="export" style="min-height:52px">${ic('download')} Als CSV exportieren</button>`;
  }
  return `<div class="scroll"><div class="page" style="gap:14px">
    <div class="head"><div class="head-text"><h1>Protokoll</h1><p class="sub">Letzte ${S.logDays} Tage · nur für Admin</p></div><span class="pill">Admin</span></div>${body}</div></div>`;
}

function tabs() {
  const items = [['home', 'home', 'Jetzt'], ['plan', 'calendar', 'Plan']];
  if (me().admin) items.push(['log', 'chart', 'Protokoll']);
  return `<nav class="tabs" aria-label="Hauptnavigation">${items.map(([v, i, l]) => `<button class="tab" data-act="tab" data-v="${v}" ${S.view === v ? 'aria-current="page"' : ''}>${ic(i, 22)} ${l}</button>`).join('')}</nav>`;
}

// ----- login / onboarding -----
const prettyCode = (s) => (String(s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20).match(/.{1,5}/g) || []).join('-');

function loginView() {
  return `<div class="scroll"><div class="welcome">
    <div class="logo"><img src="${img('ilford', 'head')}" alt=""><img src="${img('bonnie', 'head')}" alt=""></div>
    <div style="display:flex;flex-direction:column;gap:12px"><h1 class="big">Willkommen bei Freigang</h1>
      <p class="lead">Ein gemeinsamer Status für Ilford und Bonnie. Gib deinen persönlichen Zugangscode ein.</p></div>
    <form class="field" data-form="login" autocomplete="off" novalidate>
      <label for="code">Dein Zugangscode</label>
      <input class="input" id="code" name="code" inputmode="text" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" maxlength="23" value="${esc(S.code)}" aria-describedby="${S.loginError ? 'codeerr' : ''}">
      ${S.loginError ? `<p class="err" id="codeerr" role="alert">${esc(S.loginError)}</p>` : ''}
      <button class="btn in" type="submit" ${S.loginBusy ? 'disabled' : ''} style="margin-top:8px">${S.loginBusy ? '<span class="spin"></span>' : ''} Weiter</button>
    </form></div></div>`;
}

function onboardingView() {
  const standalone = isStandalone(), p = S.push;
  const pushOn = p.supported && p.perm === 'granted' && p.subscribed;
  const iosNeedsInstall = isIOS() && !standalone;
  const s1done = standalone;
  const step1 = `<li class="step"><span class="n ${s1done ? 'done' : ''}">${s1done ? ic('check', 18) : '1'}</span><div class="body">
      <b>Zum Home-Bildschirm hinzufügen</b>
      ${s1done ? '<p>Erledigt – du nutzt Freigang schon als App.</p>' : `<p>iPhone: ${ic('share', 18)} tippen, dann „Zum Home-Bildschirm“.</p><p>Android: Menü ⋮, dann „App installieren“.</p>
      ${S.installEvent ? '<button class="btn ghost sm" data-act="install">App installieren</button>' : ''}
      ${isIOS() ? `<p>Beim ersten Öffnen vom Home-Bildschirm fragt die App noch einmal nach deinem Zugangscode.</p><button class="btn ghost sm" data-act="copyCode">Code kopieren</button>` : ''}`}
    </div></li>`;
  const step2 = `<li class="step ${!pushOn && !iosNeedsInstall ? 'cur' : ''}"><span class="n ${pushOn ? 'done' : ''}">${pushOn ? ic('check', 18) : '2'}</span><div class="body">
      <b>Benachrichtigungen erlauben</b>
      <p>Damit du sofort erfährst, wenn ${CATS[otherCat()].name} rausgeht – und ${esc(me().otherName)}, wenn ${CATS[ownCat()].name} geht.</p>
      ${pushOn ? '<p style="color:var(--in-fg);font-weight:600">Aktiv auf diesem Gerät.</p>'
        : iosNeedsInstall ? '<p>Das geht erst, wenn die App vom Home-Bildschirm geöffnet ist.</p>'
        : `<button class="btn in" data-act="enablePush" style="font-size:16px">${ic('bell')} Benachrichtigungen erlauben</button>`}
    </div></li>`;
  const step3 = `<li class="step" style="align-items:center"><span class="n">3</span><div class="body" style="gap:4px"><b>Deine Katze</b><p style="display:block">${esc(me().name)}, dein Zugang ist für ${CATS[ownCat()].name} eingerichtet.</p></div>
      <img src="${img(ownCat(), 'head')}" alt="${CATS[ownCat()].name}" width="44" height="44"></li>`;
  return `<div class="scroll" style="display:flex;flex-direction:column"><div class="welcome" style="flex:1">
    <div class="logo"><img src="${img('ilford', 'head')}" alt=""><img src="${img('bonnie', 'head')}" alt=""></div>
    <div style="display:flex;flex-direction:column;gap:12px"><h1 class="big">Hallo ${esc(me().name)}!</h1><p class="lead">Zwei kurze Schritte, dann geht es los.</p></div>
    <ol class="steps">${step1}${step2}${step3}</ol></div>
    <div class="foot"><button class="btn ${pushOn ? 'in' : 'ghost'}" data-act="finish">${pushOn ? 'Los geht’s' : 'Ohne Benachrichtigungen fortfahren'}</button></div></div>`;
}

function loadingView() {
  return `<div class="welcome" style="align-items:center;justify-content:center"><div class="logo"><img src="${img('ilford', 'head')}" alt=""><img src="${img('bonnie', 'head')}" alt=""></div><p class="sub" role="status">Lädt …</p></div>`;
}

// ---------- sheets ----------
function sheetHtml() {
  const sh = S.sheet;
  if (!sh) return '';
  const o = ownCat(), t = otherCat();
  let title = '', inner = '';
  if (sh.type === 'conflict') {
    title = `${CATS[t].name} ist draußen`;
    inner = `<div class="head2"><div class="tile"><img src="${img(t, 'sitting')}" alt=""></div>
        <div style="display:flex;flex-direction:column;gap:4px"><h2 id="sh-t">${esc(title)}</h2><span class="sub" style="line-height:1.4">seit ${esc(hhmm(sh.since))} Uhr. ${CATS[o].name} trotzdem rauslassen?</span></div></div>
      <button class="btn in sm" data-act="wait">${ic('bell')} Warten – Bescheid, wenn ${CATS[t].name} drin ist</button>
      <button class="btn danger sm" data-act="force"><span>Trotzdem rauslassen</span><small>wird im Protokoll vermerkt</small></button>
      <button class="btn plain" data-act="closeSheet">Abbrechen</button>`;
  } else if (sh.type === 'adjust') {
    title = `Wann ist ${CATS[o].name} reingekommen?`;
    const opts = [['Gerade eben', 0], ['Vor 5 Min', 5], ['Vor 10 Min', 10], ['Vor 20 Min', 20]];
    inner = `<div style="display:flex;flex-direction:column;gap:4px"><h2 id="sh-t">${esc(title)}</h2><span class="sub">Damit das Protokoll stimmt.</span></div>
      <div class="grid2">${opts.map(([l, m]) => `<button class="opt" data-act="adjustPick" data-m="${m}">${l}</button>`).join('')}</div>
      <button class="btn plain" data-act="closeSheet">Abbrechen</button>`;
  } else if (sh.type === 'slot') {
    title = sh.id ? 'Zeitfenster bearbeiten' : `Neues Zeitfenster für ${CATS[o].name}`;
    const dayChips = sh.id ? `<span class="sub">${WD_LONG[sh.weekday]}</span>`
      : `<div class="chips" role="group" aria-label="Wochentage">${WD.map((d, i) => `<button type="button" data-act="slotDay" data-i="${i}" aria-pressed="${sh.days.includes(i)}" aria-label="${WD_LONG[i]}">${d}</button>`).join('')}</div>`;
    inner = `<h2 id="sh-t">${esc(title)}</h2>${dayChips}
      <div class="two"><div class="field"><label for="slot-start">Von</label><input class="input text" id="slot-start" type="time" step="300" value="${esc(sh.start)}"></div>
      <div class="field"><label for="slot-end">Bis</label><input class="input text" id="slot-end" type="time" step="300" value="${esc(sh.end)}"></div></div>
      <span class="small" id="slot-hint">${esc(slotHint(sh))}</span>
      <span class="small">${esc(me().otherName)} sieht das Fenster, und du wirst 15 Min vorher erinnert.</span>
      ${sh.error ? `<p class="err" role="alert">${esc(sh.error)}</p>` : ''}
      <button class="btn in sm" data-act="saveSlot" ${sh.busy ? 'disabled' : ''}>Speichern</button>
      ${sh.id ? '<button class="btn plain" data-act="deleteSlot" style="color:var(--out-fg)">Zeitfenster löschen</button>' : ''}
      <button class="btn plain" data-act="closeSheet">Abbrechen</button>`;
  } else if (sh.type === 'catnote') {
    title = 'Eigener Hinweis';
    const has = !!String(sh.text || '').trim();
    inner = `<div style="display:flex;flex-direction:column;gap:4px"><h2 id="sh-t">${esc(title)}</h2><span class="sub">${esc(me().otherName)} sieht ihn bei ${CATS[ownCat()].name}.</span></div>
      <div class="field"><label for="cat-note-text">Kurzer Hinweis</label><input class="input text" id="cat-note-text" type="text" maxlength="${NOTE_MAX}" autocomplete="off" enterkeyhint="done" placeholder="z. B. Mit Leine im Garten" value="${esc(sh.text)}"></div>
      <span class="small" id="cat-note-count">${Array.from(sh.text || '').length} / ${NOTE_MAX}</span>
      <button class="btn in sm" data-act="saveCatNote" ${S.busy ? 'disabled' : ''}>${sh.live ? 'Speichern' : 'Übernehmen'}</button>
      ${has || sh.live ? `<button class="btn ghost" data-act="clearCatNote">Hinweis entfernen</button>` : ''}
      <button class="btn plain" data-act="closeSheet">Abbrechen</button>`;
  } else if (sh.type === 'note') {
    title = 'Notiz zur Überschneidung';
    inner = `<div style="display:flex;flex-direction:column;gap:4px"><h2 id="sh-t">${esc(title)}</h2><span class="sub">${esc(sh.when)}</span></div>
      <div class="field"><label for="note-text">Was ist passiert?</label><textarea class="input" id="note-text" maxlength="280" placeholder="z. B. Fauchen am Zaun gehört">${esc(sh.note)}</textarea></div>
      ${sh.error ? `<p class="err" role="alert">${esc(sh.error)}</p>` : ''}
      <button class="btn in sm" data-act="saveNote" ${sh.busy ? 'disabled' : ''}>Speichern</button>
      <button class="btn plain" data-act="closeSheet">Abbrechen</button>`;
  } else if (sh.type === 'settings') {
    title = 'Einstellungen';
    const p = S.push, q = S.state.quietHours;
    let pushRow;
    if (!p.supported) pushRow = `<div class="set-row"><div class="tx"><b>Benachrichtigungen</b><span>${isIOS() && !isStandalone() ? 'Auf dem iPhone erst nach „Zum Home-Bildschirm“ möglich.' : 'Dieser Browser unterstützt sie nicht.'}</span></div></div>`;
    else if (p.perm === 'denied') pushRow = `<div class="set-row"><div class="tx"><b>Benachrichtigungen</b><span>Blockiert. Bitte in den Geräte-Einstellungen für Freigang erlauben.</span></div></div>`;
    else if (p.subscribed && p.perm === 'granted') pushRow = `<div class="set-row"><div class="tx"><b>Benachrichtigungen</b><span>Aktiv auf diesem Gerät.</span></div></div>
      <div class="two"><button class="btn ghost" data-act="testPush">Testnachricht</button><button class="btn ghost" data-act="disablePush">Ausschalten</button></div>`;
    else pushRow = `<div class="set-row"><div class="tx"><b>Benachrichtigungen</b><span>Noch nicht aktiviert.</span></div></div><button class="btn in sm" data-act="enablePush">${ic('bell')} Erlauben</button>`;
    inner = `<div style="display:flex;flex-direction:column;gap:4px"><h2 id="sh-t">${title}</h2><span class="sub">Angemeldet als ${esc(me().name)} · ${CATS[o].name}</span></div>
      ${pushRow}
      ${q.start === q.end ? '' : `<div class="set-row"><div class="tx"><b>Ruhezeit ${q.start}–${q.end} Uhr</b><span>Erinnerungen und Nachfragen pausieren. Meldungen, wenn die andere Katze rausgeht, kommen immer an.</span></div></div>`}
      <p class="small" style="text-align:center">Freigang Version ${VERSION}</p>
      <button class="btn ghost" data-act="logout" style="${S.confirmLogout ? 'border-color:var(--out);color:var(--out-fg)' : ''}">${S.confirmLogout ? 'Wirklich abmelden? Code wird neu gebraucht' : 'Abmelden'}</button>
      <button class="btn plain" data-act="closeSheet">Schließen</button>`;
  }
  return `<div class="scrim"><button class="close" data-act="closeSheet" aria-label="Schließen" tabindex="-1"></button>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-t" tabindex="-1"><div class="grab"></div>${inner}</div></div>`;
}

// ---------- render ----------
let lastHtml = '', lastOverlay = '', lastView = '';
function screenHtml() {
  if (S.view === 'login') return loginView();
  if (S.view === 'loading' || !S.state) return loadingView();
  if (S.view === 'onboarding') return onboardingView();
  const offline = S.online ? '' : `<div class="offline" role="status">Keine Verbindung – Stand von ${esc(hhmm(S.state.now))}</div>`;
  const main = S.view === 'plan' ? planView() : S.view === 'log' && me().admin ? logView() : homeView();
  return offline + main + tabs();
}

function render() {
  const root = $('#screen');
  const html = screenHtml();
  if (html !== lastHtml) {
    const sc = root.querySelector('.scroll');
    const top = sc && lastView === S.view ? sc.scrollTop : 0;
    root.innerHTML = html;
    lastHtml = html; lastView = S.view;
    const sc2 = root.querySelector('.scroll');
    if (sc2) sc2.scrollTop = top;
    if (S.view === 'login' && S.loginError) $('#code')?.focus();
  }
  renderOverlay();
}

function renderOverlay() {
  const root = $('#overlay');
  const toastHtml = S.toast ? `<div class="toast${S.sheet ? ' top' : ''}" role="status"><span>${esc(S.toast)}</span><button data-act="closeToast" aria-label="Meldung schließen">${ic('close', 18)}</button></div>` : '';
  const html = (S.state ? sheetHtml() : '') + toastHtml;
  if (html === lastOverlay) return;
  const hadSheet = !!root.querySelector('.sheet');
  root.innerHTML = html;
  lastOverlay = html;
  const sheet = root.querySelector('.sheet');
  $('#screen').inert = !!sheet;
  if (sheet && !hadSheet) sheet.focus();
}

// ---------- actions ----------
async function setStatus(to, extra = {}, okMsg = '') {
  if (S.busy) return;
  S.busy = true; render();
  try {
    const r = await api('POST', '/api/status', { to, ...extra });
    if (r.status === 409 && r.data?.error === 'conflict') { S.busy = false; openSheet({ type: 'conflict', since: r.data.other.since }); await refresh(); return; }
    if (r.ok) {
      S.noteDraft = ''; applyState(r.data.state); S.online = true; S.sheet = null;
      const nobody = me().partnerDevices === 0 && okMsg;
      if (nobody && !S.warnedNoDevices) { S.warnedNoDevices = true; toast(`Gespeichert. ${me().otherName} hat Benachrichtigungen noch nicht aktiviert.`); }
      else toast(nobody ? 'Gespeichert.' : okMsg);
    } else toast('Das hat nicht geklappt. Bitte nochmal versuchen.');
  } catch { S.online = false; toast('Keine Verbindung – es wurde nichts geändert.'); }
  S.busy = false; render();
}

// The note only travels with a tap from "inside". From "announced" to "out" the server carries the existing note over.
const noteExtra = () => (S.state.cats[ownCat()].status === 'in' && S.noteDraft ? { note: S.noteDraft } : {});

async function putNote(note) {
  if (S.busy) return;
  S.busy = true; render();
  try {
    const r = await api('PUT', '/api/status/note', { note });
    if (r.ok) { applyState(r.data.state); S.online = true; S.sheet = null; toast(note ? 'Hinweis gespeichert.' : 'Hinweis entfernt.'); }
    else if (r.status === 409) { S.sheet = null; toast('Der Status hat sich inzwischen geändert.'); await refresh(); }
    else toast('Das hat nicht geklappt. Bitte nochmal versuchen.');
  } catch { S.online = false; toast('Keine Verbindung – es wurde nichts geändert.'); }
  S.busy = false; render();
}

const A = {
  notePick(d) {
    const text = NOTES[+d.n], c = S.state.cats[ownCat()];
    if (c.status === 'in') { S.noteDraft = S.noteDraft === text ? '' : text; render(); }
    else putNote(c.note === text ? '' : text);
  },
  noteCustom() {
    const c = S.state.cats[ownCat()], cur = c.status === 'in' ? S.noteDraft : c.note;
    openSheet({ type: 'catnote', text: cur && !NOTES.includes(cur) ? cur : '', live: c.status !== 'in' });
  },
  saveCatNote() {
    const sh = S.sheet, text = Array.from(String(sh.text || '').replace(/\s+/g, ' ').trim()).slice(0, NOTE_MAX).join('').trim();
    if (sh.live) { putNote(text); return; }
    S.noteDraft = text; S.sheet = null; render();
  },
  clearCatNote() { if (S.sheet?.live) putNote(''); else { S.noteDraft = ''; S.sheet = null; render(); } },
  tab(d) { S.view = d.v; S.sheet = null; render(); if (d.v === 'plan' && !S.plan) loadPlan().then(render); refresh(); },
  raus() {
    const t = otherCat();
    if (S.state.cats[t].status === 'out') openSheet({ type: 'conflict', since: S.state.cats[t].since });
    else setStatus('out', noteExtra(), `${me().otherName} wurde benachrichtigt.`);
  },
  soon() { setStatus('soon', { soonMin: SOON_MIN, ...noteExtra() }, `${me().otherName} ist vorgewarnt.`); },
  cancelSoon() { setStatus('in', {}, `${me().otherName} weiß Bescheid.`); },
  back() { setStatus('in', {}, `${me().otherName} wurde benachrichtigt.`); },
  adjust() { openSheet({ type: 'adjust' }); },
  adjustPick(d) {
    const m = +d.m;
    setStatus('in', { agoMin: m }, m ? `Eingetragen: ${CATS[ownCat()].name} ist seit ${hhmm(now() - m * 60000)} drin.` : `${me().otherName} wurde benachrichtigt.`);
  },
  async wait() {
    try { const r = await api('POST', '/api/watch'); if (r.ok) { S.state.waiting = r.data.waiting; S.sheet = null; toast(r.data.waiting ? `Ich melde mich, sobald ${CATS[otherCat()].name} drin ist.` : `${CATS[otherCat()].name} ist schon wieder drin.`); } } catch { toast('Keine Verbindung.'); }
    await refresh();
  },
  async unwait() { try { await api('DELETE', '/api/watch'); } catch { /* ignore */ } await refresh(); },
  force() { setStatus('out', { force: true, ...noteExtra() }, `Override im Protokoll vermerkt. ${me().otherName} wurde benachrichtigt.`); },
  closeSheet() { closeSheet(); },
  closeToast() { S.toast = ''; renderOverlay(); },
  settings() { S.confirmLogout = false; openSheet({ type: 'settings' }); },
  enablePush() { return enablePush(); },
  disablePush() { return disablePush(); },
  async testPush() {
    try { const r = await api('POST', '/api/push/test'); toast(r.ok && r.data.sent ? 'Testnachricht ist unterwegs.' : 'Keine Verbindung zum Gerät – bitte Benachrichtigungen neu erlauben.'); } catch { toast('Keine Verbindung.'); }
  },
  logout() {
    if (!S.confirmLogout) { S.confirmLogout = true; renderOverlay(); setTimeout(() => { if (S.confirmLogout) { S.confirmLogout = false; renderOverlay(); } }, 4000); return; }
    logout('');
  },
  planDay(d) { S.planDay = +d.i; render(); },
  addSlot() {
    const sh = { type: 'slot', id: null, days: [S.planDay], start: '16:00', end: '17:00', error: '' };
    openSheet(sh);
  },
  slotDay(d) {
    const i = +d.i, days = S.sheet.days;
    S.sheet.days = days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort();
    renderOverlay();
  },
  editSlot(d) {
    const s = (S.plan || []).find((x) => x.id === +d.id);
    if (s) openSheet({ type: 'slot', id: s.id, weekday: s.weekday, days: [s.weekday], start: minToText(s.start), end: minToText(s.end % 1440), error: '' });
  },
  async saveSlot() {
    const sh = S.sheet, a = textToMin(sh.start), b = textToMin(sh.end);
    if (Number.isNaN(a) || Number.isNaN(b) || a === b) { sh.error = 'Bitte „Von“ und „Bis“ wählen. Sie dürfen nicht gleich sein.'; renderOverlay(); return; }
    if (!sh.id && !sh.days.length) { sh.error = 'Bitte mindestens einen Wochentag wählen.'; renderOverlay(); return; }
    sh.busy = true; sh.error = ''; renderOverlay();
    try {
      const r = sh.id ? await api('PUT', `/api/plan/${sh.id}`, { start: a, end: b }) : await api('POST', '/api/plan', { weekdays: sh.days, start: a, end: b });
      if (r.ok) { await loadPlan(); S.sheet = null; render(); toast('Zeitfenster gespeichert.'); return; }
      sh.error = r.status === 409 ? 'Das überschneidet sich mit einem anderen Zeitfenster von dir.' : 'Bitte Zeiten in 5-Minuten-Schritten wählen.';
    } catch { sh.error = 'Keine Verbindung. Bitte nochmal versuchen.'; }
    sh.busy = false; renderOverlay();
  },
  async deleteSlot() {
    const sh = S.sheet;
    try { const r = await api('DELETE', `/api/plan/${sh.id}`); if (r.ok) { await loadPlan(); S.sheet = null; render(); toast('Zeitfenster gelöscht.'); return; } } catch { /* fall through */ }
    sh.error = 'Das hat nicht geklappt.'; renderOverlay();
  },
  logDays(d) { S.logDays = +d.d; S.log = null; render(); loadLog().then(render); },
  note(d) {
    const i = (S.log?.incidents || []).find((x) => x.start === +d.start);
    if (i) openSheet({ type: 'note', start: i.start, when: incidentWhen(i), note: i.note || '', error: '' });
  },
  async saveNote() {
    const sh = S.sheet;
    sh.busy = true; renderOverlay();
    try { const r = await api('PUT', '/api/note', { start: sh.start, note: sh.note }); if (r.ok) { await loadLog(); S.sheet = null; render(); toast('Notiz gespeichert.'); return; } } catch { /* fall through */ }
    sh.busy = false; sh.error = 'Das hat nicht geklappt. Bitte nochmal versuchen.'; renderOverlay();
  },
  async export() { await exportCsv(); },
  async install() { if (S.installEvent) { S.installEvent.prompt(); await S.installEvent.userChoice.catch(() => {}); S.installEvent = null; render(); } },
  async copyCode() {
    try { await navigator.clipboard.writeText(S.code); toast('Code kopiert. In der App einfügen.'); } catch { toast('Kopieren hat nicht geklappt. Notiere dir den Code.'); }
  },
  finish() { store.set('onboarded', '1'); S.view = 'home'; render(); refresh(); },
};

async function exportCsv() {
  try {
    const r = await api('GET', '/api/export?days=90');
    if (!r.ok) throw new Error('export');
    const st = { in: 'drinnen', soon: 'gleich draußen', out: 'draußen' };
    const f = (ts) => { const p = tp(ts); return `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}:${p.s}`; };
    const q = (v) => { const s = String(v ?? ''); return /[;"\r\n]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = ['Zeit;Katze;Status;Vorher;Erfasst von;Eingetragen um;Override;Hinweis'];
    for (const e of r.data.events) lines.push([f(e.ts), CATS[e.cat].name, st[e.status], st[e.prev_status] || '', e.actor, f(e.recorded_at), e.override ? 'ja' : '', e.note || ''].map(q).join(';'));
    const csv = '﻿' + lines.join('\r\n') + '\r\n';
    const name = `freigang-protokoll-${dayKey(now())}.csv`;
    const file = new File([csv], name, { type: 'text/csv' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Freigang-Protokoll' }); } catch (e) { if (e.name !== 'AbortError') throw e; }
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  } catch { toast('Export hat nicht geklappt. Bitte nochmal versuchen.'); }
}

function logout(msg) {
  const oldCode = S.code;
  if (oldCode && pushSupported()) {
    // Best effort: this phone must stop receiving the previous person's messages.
    swReady().then((reg) => (reg ? reg.pushManager.getSubscription() : null)).then(async (sub) => {
      if (!sub) return;
      await fetch('/api/push', { method: 'DELETE', headers: { authorization: 'Bearer ' + oldCode, 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }).catch(() => {});
  }
  store.del('code'); store.del('last'); store.del('onboarded');
  Object.assign(S, { code: '', state: null, plan: null, log: null, sheet: null, view: 'login', loginError: msg || '', confirmLogout: false, busy: false });
  render();
}

// ---------- events ----------
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.act];
  if (fn) fn(el.dataset, ev);
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'code') { const v = prettyCode(t.value); t.value = v; S.code = v; }
  else if ((t.id === 'slot-start' || t.id === 'slot-end') && S.sheet) {
    S.sheet[t.id === 'slot-start' ? 'start' : 'end'] = t.value;
    const h = document.getElementById('slot-hint'); if (h) h.textContent = slotHint(S.sheet);
  }
  else if (t.id === 'note-text' && S.sheet) S.sheet.note = t.value;
  else if (t.id === 'cat-note-text' && S.sheet) { S.sheet.text = t.value; const c = document.getElementById('cat-note-count'); if (c) c.textContent = `${Array.from(t.value).length} / ${NOTE_MAX}`; }
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('form[data-form="login"]');
  if (!form) return;
  ev.preventDefault();
  if (S.loginBusy) return;
  const code = prettyCode(form.code.value);
  if (code.replace(/-/g, '').length < 12) { S.code = code; S.loginError = 'Der Code ist zu kurz. Er hat 20 Zeichen.'; lastHtml = ''; render(); return; }
  S.code = code; S.loginBusy = true; S.loginError = ''; lastHtml = ''; render();
  try {
    const r = await api('GET', '/api/state', null, { keep: true });
    S.loginBusy = false;
    if (r.ok) { await startSession(r.data); return; }
    S.loginError = r.status === 401 ? 'Dieser Code passt nicht. Bitte noch einmal prüfen.' : 'Der Server antwortet gerade nicht. Bitte später nochmal.';
  } catch { S.loginBusy = false; S.loginError = 'Keine Verbindung. Bitte später nochmal.'; }
  lastHtml = ''; render();
});

document.addEventListener('keydown', (ev) => {
  if (!S.sheet) return;
  if (ev.key === 'Escape') { closeSheet(); return; }
  if (ev.key !== 'Tab') return;
  const items = [...document.querySelectorAll('#overlay .sheet button:not([disabled]), #overlay .sheet input, #overlay .sheet textarea')];
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (ev.shiftKey && (document.activeElement === first || document.activeElement.classList.contains('sheet'))) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
});

window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); S.installEvent = ev; if (S.view === 'onboarding') render(); });
window.addEventListener('online', refresh);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

// ---------- boot ----------
async function startSession(st) {
  applyState(st); S.online = true;
  store.set('code', S.code);
  S.view = store.get('onboarded') ? 'home' : 'onboarding';
  S.planDay = tp(now()).wd;
  await readPush();
  render();
  syncPush().then(render);
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'refresh') refresh(); });
}

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const m = /[#&]k=([A-Za-z0-9-]+)/.exec(location.hash);
  if (m) history.replaceState(null, '', location.pathname + location.search); // keep the code out of history and screenshots
  const code = prettyCode(m ? m[1] : store.get('code') || '');
  if (!code) { S.view = 'login'; render(); return; }
  S.code = code; S.view = 'loading'; render();
  try {
    const r = await api('GET', '/api/state', null, { keep: true });
    if (r.ok) await startSession(r.data);
    else if (r.status === 401) { S.code = ''; store.del('code'); S.loginError = 'Der Zugangscode wurde nicht erkannt. Bitte neu eingeben.'; S.view = 'login'; render(); }
    else throw new Error('server');
  } catch {
    // Offline or server hiccup: open with the last known state if there is one.
    let last = null;
    try { last = JSON.parse(store.get('last') || 'null'); } catch { /* ignore */ }
    if (last) { applyState(last); S.online = false; S.view = store.get('onboarded') ? 'home' : 'onboarding'; S.planDay = tp(now()).wd; render(); }
    else { S.view = 'login'; S.loginError = 'Keine Verbindung. Bitte später nochmal.'; render(); }
  }
}

setInterval(() => { if (document.visibilityState === 'visible' && S.code && S.state && !S.sheet) refresh(); }, 15000);
boot();
