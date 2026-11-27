// Freigang – client. Plain ES module, no build step. Everything the person sees is German.
const CATS = { ilford: { name: 'Ilford', gen: 'Ilfords' }, bonnie: { name: 'Bonnie', gen: 'Bonnies' } };
const VERSION = '1.9.0'; // same as src/version.js; a newer server version makes the app reload itself once
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
  bowl: '<path d="M3.5 11.5h17a8.5 7.5 0 0 1-17 0z"/><path d="M8 7.5c0-1.2 1-1.6 1-2.8M12 7.5c0-1.2 1-1.6 1-2.8M16 7.5c0-1.2 1-1.6 1-2.8"/>',
  undo: '<path d="M9 6L4.5 10.5 9 15"/><path d="M5 10.5h8.5a5.5 5.5 0 0 1 0 11H11"/>',
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
  plan: null, inside: [], planToday: '', planDay: 0, log: null, logDays: 7, logAll: false, logPage: 'konflikte', times: null, ilford: null, ilAt: 0, ilKey: '', ilBar: '', feed: null,
  noteDraft: '', sheet: null, toast: '', busy: false, loginError: '', loginBusy: false,
  push: { supported: false, perm: 'default', subscribed: false }, installEvent: null, confirmLogout: false,
};
const now = () => Date.now() + S.skew;
const me = () => S.state.me;
const ownCat = () => me().cat;
const otherCat = () => me().other;
const feeds = () => !!S.state?.feeding; // the feeding tracker exists for Bonnie's household only

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
    if (S.online && S.view === 'log' && me().admin) {
      // The Ilford page reads the whole history, so it reloads only when something can have changed (see ilfordStale), not on every poll.
      if (ilfordPage()) { if (ilfordStale()) await loadIlford(); } else if (timesPage()) await loadTimes(); else await loadLog();
    }
    if (S.online && S.view === 'feed' && feeds()) await loadFeed();
  } catch { S.online = false; }
  render();
}
async function loadPlan() { const r = await api('GET', '/api/plan'); if (r.ok) { S.plan = r.data.slots; S.inside = r.data.inside || []; S.planToday = r.data.today || ''; } }
async function loadFeed() { const r = await api('GET', '/api/feedings?days=7'); if (r.ok) S.feed = r.data.feedings; }
async function loadLog() { const r = await api('GET', `/api/log?days=${S.logDays}`); if (r.ok) S.log = r.data; }
// "Ilford in Zahlen": only in Ilford's household (the server refuses everyone else).
const ilfordOn = () => me().cat === 'ilford';
const ilfordPage = () => ilfordOn() && S.logPage === 'ilford';
const timesPage = () => me().admin && S.logPage === 'zeiten';
async function loadTimes() { const r = await api('GET', '/api/times'); if (r.ok) S.times = r.data; }
const ilfordKey = () => { const c = S.state.cats.ilford; return `${c.status}|${c.since}|${S.logDays}|${dayKey(now())}`; };
// Reload when: nothing loaded yet, Ilford's status / the range / the day changed, an outing is running (every 2 min), otherwise every 10 min.
const ilfordStale = () => !S.ilford || S.ilKey !== ilfordKey() || Date.now() - S.ilAt > (S.state.cats.ilford.status === 'out' ? 2 : 10) * 60000;
async function loadIlford() {
  const key = ilfordKey(), r = await api('GET', `/api/ilford?days=${S.logDays}`);
  if (r.ok) { S.ilford = r.data; S.ilAt = Date.now(); S.ilKey = key; }
}

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

// "Bleibt laut Plan … drinnen": shown while the cat is inside and a Drinnen entry of the plan covers now.
function insideLine(cat) {
  const n = S.state.insideNow?.[cat];
  if (!n || S.state.cats[cat].status !== 'in') return '';
  const when = n.whole ? 'heute' : n.until > 1440 ? `bis morgen ${minToText(n.until - 1440)} Uhr` : n.until === 1440 ? 'bis Mitternacht' : `bis ${minToText(n.until)} Uhr`;
  return `<span class="notepill plan">${ic('home', 14)}<span>Bleibt laut Plan ${when} drinnen</span></span>`;
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
        ${insideLine(o)}
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
      ${insideLine(t)}
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
// ---- calendar helpers: a copy of the ones in src/slots.js (test/slots.test.mjs checks that both give the same results) ----
const DAY_MIN = 1440;
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const weekdayOf = (iso) => (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
const nextDate = (iso, weekday) => addDays(iso, (weekday - weekdayOf(iso) + 7) % 7);
function insideAt(entries, iso, minute) {
  const wd = weekdayOf(iso), prev = addDays(iso, -1), pwd = (wd + 6) % 7;
  let best = null;
  const take = (until, whole) => { if (!best || until > best.until) best = { until, whole }; };
  for (const e of entries) {
    if (e.date ? e.date === iso : e.weekday === wd) {
      if (minute >= e.start && minute < e.end) take(e.end, e.start === 0 && e.end === DAY_MIN);
    }
    if (e.end > DAY_MIN && (e.date ? e.date === prev : e.weekday === pwd) && minute < e.end - DAY_MIN) take(e.end - DAY_MIN, false);
  }
  return best;
}
// ---- end of the copy ----
const dateLabel = (iso) => `${WD[weekdayOf(iso)]} ${+iso.slice(8)}.${+iso.slice(5, 7)}.`; // "Mi 25.11."

// A window belongs to the weekday it starts on and may run past midnight (end > 1440). On the next day it shows as a carried-over segment.
// "Drinnen" entries work the same way, weekly or once on a date. The plan's weekday chips mean the coming 7 days, so a selected weekday is the next date (today included) on it.
// An outside window whose start a one-off "Drinnen" entry covers does not happen on that date (cancelled).
function dayPlan() {
  const day = S.planDay, D = nextDate(S.planToday, day), P = addDays(D, -1), segs = [];
  for (const s of S.plan || []) {
    if (s.weekday === day) segs.push({ s, kind: 'out', start: s.start, end: Math.min(s.end, 1440), carried: false });
    if (s.end > 1440 && (s.weekday + 1) % 7 === day) segs.push({ s, kind: 'out', start: 0, end: s.end - 1440, carried: true });
  }
  for (const s of S.inside || []) {
    if (s.date ? s.date === D : s.weekday === day) segs.push({ s, kind: 'in', start: s.start, end: Math.min(s.end, 1440), carried: false });
    if (s.end > 1440 && (s.date ? s.date === P : (s.weekday + 1) % 7 === day)) segs.push({ s, kind: 'in', start: 0, end: s.end - 1440, carried: true });
  }
  const inOf = (cat) => (S.inside || []).filter((x) => x.cat === cat);
  for (const x of segs) if (x.kind === 'out') x.cancelled = !!insideAt(inOf(x.s.cat), x.carried ? P : D, x.s.start);
  segs.sort((a, b) => a.start - b.start);
  const by = { ilford: segs.filter((x) => x.s.cat === 'ilford'), bonnie: segs.filter((x) => x.s.cat === 'bonnie') };
  const live = (cat) => by[cat].filter((x) => x.kind === 'out' && !x.cancelled);
  const ov = [];
  for (const a of live('ilford')) for (const b of live('bonnie')) { const st = Math.max(a.start, b.start), e = Math.min(a.end, b.end); if (e > st) ov.push({ start: st, end: e }); }
  return { by, ov, D };
}
const slotTime = (s) => `${minToText(s.start)}–${minToText(s.end % 1440)}`;

function slotHint(sh) {
  const inn = sh.kind === 'in', parts = [];
  if (inn && !sh.id && sh.days.length) {
    parts.push(sh.once ? `${sh.days.length === 1 ? 'Nur am' : 'Am'} ${sh.days.map((d) => dateLabel(nextDate(S.planToday, d))).join(', ')}` : `Jede Woche: ${sh.days.map((d) => WD[d]).join(', ')}.`);
  }
  if (inn && sh.allDay) return parts.join(' ');
  const a = textToMin(sh.start), b = textToMin(sh.end);
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) parts.push('Liegt „Bis“ vor „Von“, geht das Fenster in den nächsten Tag.');
  else if (b < a) {
    const wd = sh.id ? sh.weekday : (sh.days.length === 1 ? sh.days[0] : null);
    parts.push(`Endet ${wd === null ? 'am Folgetag' : WD[(wd + 1) % 7]} um ${sh.end} Uhr (nächster Tag).`);
  }
  return parts.join(' ');
}

function planView() {
  const o = ownCat(), t = otherCat(), today = tp(now()).wd;
  const days = WD.map((d, i) => `<button class="day ${i === today ? 'today' : ''}" data-act="planDay" data-i="${i}" aria-pressed="${i === S.planDay}" aria-label="${WD_LONG[i]}">${d}</button>`).join('');
  let body = '<p class="empty">Lade Zeitfenster …</p>';
  if (S.plan) {
    const { by, ov, D } = dayPlan();
    // outside = filled bar, inside = hollow dashed bar (so the two differ in shape, not only in colour), a cancelled window is faded
    const bar = (cat, top) => by[cat].map((x) => `<div class="seg ${cat === 'ilford' ? 'il' : 'bo'}${x.kind === 'in' ? ' inn' : x.cancelled ? ' canc' : ''}" style="top:${top}px;height:16px;border-radius:8px;${segStyle(x.start, x.end)}"></div>`).join('');
    const tops = { ilford: o === 'ilford' ? 6 : 46, bonnie: o === 'bonnie' ? 6 : 46 };
    const ovHtml = ov.map((x) => `<div class="ovband" style="top:-2px;bottom:-2px;${segStyle(x.start, x.end)}"></div>`).join('');
    const warn = ov.length
      ? `<div class="box alert" role="alert"><span style="padding-top:1px">${ic('alert')}</span><div><b>Überschneidung ${ov.map((x) => `${minToText(x.start)}–${minToText(x.end)}`).join(', ')}</b><span>Beide wären gleichzeitig draußen. ${CATS[o].gen} Fenster kürzen oder verschieben?</span></div></div>`
      : `<div class="box ok">${ic('check')} Keine Überschneidungen</div>`;
    const row = (x, mine) => { const s = x.s, over = s.end > 1440, inn = x.kind === 'in';
      let sub;
      if (inn) sub = `${ic('home', 14)} Bleibt drinnen · ${x.carried ? `Fortsetzung von ${s.date ? dateLabel(s.date) : WD[s.weekday]}` : s.date ? `nur am ${dateLabel(s.date)}` : 'jede Woche'}${over && !x.carried ? ` · bis ${WD[(s.weekday + 1) % 7]}` : ''}`;
      else if (x.cancelled) sub = `${ic('home', 14)} Entfällt am ${dateLabel(D)} · ${CATS[s.cat].name} bleibt drinnen`;
      else if (x.carried) sub = `${ic('moon', 14)} Fortsetzung von ${WD[s.weekday]}`;
      else sub = mine ? `${ic('bell', 14)} ${s.remind} Min vorher erinnern${over ? ` · bis ${WD[(s.weekday + 1) % 7]}` : ''}` : `${ic('lock', 14)} Von ${esc(me().otherName)}${over ? ` · bis ${WD[(s.weekday + 1) % 7]}` : ''}`;
      const whole = inn && s.start === 0 && s.end === 1440;
      const time = x.carried ? `00:00–${minToText(s.end % 1440)}` : whole ? 'Ganztägig' : slotTime(s);
      const lock = (inn || x.cancelled) && !mine ? `<span>${ic('lock', 14)} Von ${esc(me().otherName)}</span>` : '';
      return `<div class="slot${inn ? ' inn' : ''}${x.cancelled ? ' cancel' : ''}"><img src="${img(s.cat, 'head')}" alt="${CATS[s.cat].name}" width="40" height="40">
      <div class="info"><b class="time">${time}</b><span>${sub}</span>${lock}</div>
      ${mine ? `<button class="round-btn" data-act="editSlot" data-id="${s.id}" aria-label="${inn ? 'Drinnen-Zeit' : 'Zeitfenster'} ${esc(time)} bearbeiten">${ic('pencil')}</button>` : ''}</div>`; };
    const list = by[o].map((s) => row(s, true)).join('') + by[t].map((s) => row(s, false)).join('');
    body = `<section class="card" aria-label="Tagesplan" style="padding:16px;border-radius:24px">
        <div class="sec-head"><h2 style="font-size:22px">${WD_LONG[S.planDay]}</h2><span class="small">${+D.slice(8)}.${+D.slice(5, 7)}. · 0 – 24 Uhr</span></div>
        <div class="strip-wrap">
          <div class="strip-heads" style="width:28px;padding:3px 0 5px"><img src="${img(o, 'head')}" alt="${CATS[o].name}" width="28" height="28"><img src="${img(t, 'head')}" alt="${CATS[t].name}" width="28" height="28"></div>
          <div class="strip" style="height:70px">${ovHtml}<div class="track" style="top:6px;height:16px;border-radius:8px"></div><div class="track" style="top:46px;height:16px;border-radius:8px"></div>${bar('ilford', tops.ilford)}${bar('bonnie', tops.bonnie)}</div>
        </div>${hoursRow(28, [25, 50, 75])}${warn}</section>
      <section class="card slots" aria-label="Zeitfenster" style="border-radius:24px;gap:0">
        ${list || '<p class="empty">Für diesen Tag gibt es noch nichts im Plan. Lege feste Draußen-Zeiten an, dann erinnern wir dich kurz vorher, oder plane, dass eine Katze drinnen bleibt.</p>'}
        <button class="btn ghost" data-act="addSlot">${ic('plus')} Zeit für ${CATS[o].name} planen</button></section>`;
  }
  return `<div class="scroll"><div class="page" style="gap:14px">
    <div class="head-text" style="min-height:56px;justify-content:center"><h1>Plan</h1><p class="sub">Freigang-Zeiten und Drinnen-Tage pro Katze</p></div>
    <div class="days">${days}</div>${body}</div></div>`;
}

// ----- log (admin) -----
function incidentWhen(i) {
  const p = tp(i.start);
  const head = `${WD[p.wd]} ${p.d}.${p.mo}.`;
  return i.ongoing ? `${head} · seit ${hhmm(i.start)} · läuft noch` : `${head} · ${hhmm(i.start)}–${hhmm(i.end)}`;
}

const WDI = (iso) => (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
const isoShort = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
// 'Heute', 'Gestern' or 'Mo 22.11.'
const isoLabel = (iso) => (iso === dayKey(now()) ? 'Heute' : iso === dayKey(now() - 86400000) ? 'Gestern' : `${WD[WDI(iso)]} ${isoShort(iso)}`);
const isoSpan = (a, b) => (a === b ? isoLabel(a) : `${isoShort(a)}–${isoShort(b)}`);
const tsDay = (ts) => { const p = tp(ts); return `${p.y}-${p.mo}-${p.d}`; };
const longDur = (m) => (m >= 1440 ? `${Math.floor(m / 1440)} ${m < 2880 ? 'Tag' : 'Tage'} ${Math.floor((m % 1440) / 60)} Std` : durShort(m));
const nTage = (n) => `${n} ${n === 1 ? 'Tag' : 'Tage'}`;

function logView() {
  const L = S.log;
  const pageCtl = ilfordOn() ? `<div class="seg-ctl" role="group" aria-label="Seite">${[['konflikte', 'Konflikte'], ['ilford', 'Ilford'], ['zeiten', 'Zeiten anpassen']].map(([k, t]) => `<button data-act="logPage" data-p="${k}" aria-pressed="${S.logPage === k}">${t}</button>`).join('')}</div>` : '';
  if (timesPage()) {
    return `<div class="scroll"><div class="page" style="gap:14px">
      <div class="head"><div class="head-text"><h1>Protokoll</h1><p class="sub">Zeiten anpassen · nur für Ilfords Haushalt</p></div><span class="pill">Admin</span></div>
      ${pageCtl}${timesBody(S.times)}</div></div>`;
  }
  if (ilfordPage()) {
    const ranges = [7, 30].map((d) => `<button data-act="logDays" data-d="${d}" aria-pressed="${S.logDays === d}">${d} Tage</button>`).join('');
    return `<div class="scroll"><div class="page" style="gap:14px">
      <div class="head"><div class="head-text"><h1>Protokoll</h1><p class="sub">Ilford in Zahlen · nur für Ilfords Haushalt</p></div><span class="pill">Admin</span></div>
      ${pageCtl}<div class="seg-ctl" role="group" aria-label="Zeitraum">${ranges}</div>${ilfordBody(S.ilford)}</div></div>`;
  }
  let body = `${pageCtl}<p class="empty" style="text-align:center">Lade Protokoll …</p>`;
  if (L) {
    const il = (cat, row, top) => row[cat === 'ilford' ? 'il' : 'bo'].map((s) => `<div class="seg ${cat === 'ilford' ? 'il' : 'bo'}" style="top:${top}px;height:12px;border-radius:6px;left:${s.l}%;width:${s.w}%"></div>`).join('');
    // In the 30-day view only the newest days show until "Alle anzeigen" is pressed, so the heatmap below stays within reach.
    const FOLD = 10, folded = L.rows.length > FOLD && !S.logAll;
    const rows = (folded ? L.rows.slice(0, FOLD) : L.rows).map((r) => `<div class="dayrow"><div class="lbl"><b>${esc(r.d)}</b><span>${esc(r.date)}</span></div>
      <div class="strip" style="height:34px">${r.ov.map((o) => `<div class="ovband" style="top:-3px;bottom:-3px;left:${o.l}%;width:${o.w}%"></div>`).join('')}
        <div class="track" style="top:2px;height:12px;border-radius:6px"></div><div class="track" style="top:20px;height:12px;border-radius:6px"></div>${il('ilford', r, 2)}${il('bonnie', r, 20)}</div></div>`).join('');
    const heat = (label, cells, bg) => `<div class="heatrow"><span>${label}</span><div>${cells.map((c) => `<i style="background:${bg};opacity:${c.o}"></i>`).join('')}</div></div>`;
    const inc = L.incidents.map((i) => `<button class="inc" data-act="note" data-start="${i.start}"><div class="dot">${ic('alert', 18)}</div>
      <div class="txt"><b>${esc(incidentWhen(i))}</b><span class="meta">${durShort(i.minutes)} · zweite Katze: ${CATS[i.second].name}${i.catNote ? ` („${esc(i.catNote)}“)` : ''}</span>
      ${i.note ? `<em>Notiz: ${esc(i.note)}</em>` : ''}</div>${i.override ? '<span class="tag">Override</span>' : ''}</button>`).join('');
    const ranges = [7, 30].map((d) => `<button data-act="logDays" data-d="${d}" aria-pressed="${S.logDays === d}">${d} Tage</button>`).join('');
    body = `${pageCtl}<div class="seg-ctl" role="group" aria-label="Zeitraum">${ranges}</div><div class="kpis">
        <div class="kpi"><b>${L.kpi.overlaps}</b><span>Überschneidungen</span></div>
        <div class="kpi"><b>${hMin(L.kpi.overlapMinutes)}</b><span>zusammen draußen</span></div>
        <div class="kpi"><b>${L.kpi.overrides}</b><span>mit Override</span></div></div>
      <section class="card" aria-label="Tagesband" style="gap:8px;padding:16px;border-radius:24px"><h2 style="font-size:20px">Tagesband</h2>
        <div class="legend"><span><i style="width:18px;height:8px;border-radius:4px;background:var(--ink)"></i>Ilford</span><span><i style="width:18px;height:8px;border-radius:4px;background:var(--bonnie)"></i>Bonnie</span><span><i style="width:10px;height:14px;border-left:2px solid var(--ov);border-right:2px solid var(--ov);background:rgba(168,50,31,.16)"></i>gemeinsam draußen</span></div>
        <div style="margin-top:4px">${hoursRow(46)}</div>${rows}${L.rows.length > FOLD ? `<button class="btn ghost more" data-act="logAll" aria-expanded="${!folded}">${folded ? `Alle ${L.rows.length} Tage anzeigen` : `Nur die letzten ${FOLD} Tage anzeigen`}</button>` : ''}</section>
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

// ----- Ilford in Zahlen (Protokoll, only Ilford's household) -----
const arrow = (up) => `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="${up ? 'M5 1.5l4 7H1z' : 'M5 8.5l4-7H1z'}" fill="currentColor"/></svg>`;
// Change against the comparison window: arrow AND words (never colour alone); the percentage only when the baseline is not tiny.
function deltaLine(dl, count) {
  if (!dl) return '';
  if (dl.abs === 0) return '<span class="dl">gleich wie davor</span>';
  const up = dl.abs > 0, n = Math.abs(dl.abs);
  const amount = count ? String(n) : hMin(n);
  const pct = dl.pct == null ? '' : `&nbsp;·&nbsp;${up ? '+' : '−'}${Math.abs(dl.pct)}&nbsp;%`; // stays together on one line
  return `<span class="dl">${arrow(up)}<span>${amount} ${up ? 'mehr' : 'weniger'}${pct}</span></span>`;
}
const itile = (value, label, dl, count, cls = '') => `<div class="itile ${cls}"><b>${value}</b><span class="lb">${label}</span>${deltaLine(dl, count)}</div>`;

function ilfordBody(I) {
  if (!I) return '<p class="empty" style="text-align:center">Lade Zahlen …</p>';
  if (I.empty) return '<section class="card" aria-label="Ilford in Zahlen" style="padding:16px;border-radius:24px"><h2 style="font-size:20px">Ilford in Zahlen</h2><p class="empty" style="padding:0">Noch keine Daten. Sobald Ilford draußen war, erscheinen hier Zeiten, Tagesbalken und Rekorde.</p></section>';
  const c = I.cur, d = I.delta, n = I.days;
  const sub = I.prev
    ? `Letzte ${n} Tage im Vergleich zu den ${n} Tagen davor`
    : `Letzte ${n} Tage · Vergleich mit den ${n} Tagen davor ab ${I.prevFrom}`;
  const part = I.since.covers ? '' : `<p class="small">Erfasst seit ${I.since.label}: Der Schnitt pro Tag zählt nur die erfassten Tage.</p>`;
  const notes = [];
  if (c.open) notes.push('Ein Ausflug läuft noch und zählt bis jetzt. Er steht nicht bei „Typischer“ und „Längster Ausflug“.');
  if (c.uncertain) notes.push(`${c.uncertain === 1 ? 'Ein Ausflug war' : `${c.uncertain} Ausflüge waren`} länger als ${String(I.staleHours).replace('.', ',')} Std und ${c.uncertain === 1 ? 'gilt' : 'gelten'} als unsicher (vermutlich nicht zurückgemeldet): in der Zeit enthalten, aber nicht bei „Längster Ausflug“ und den Rekorden.`);
  const nums = `<section class="card" aria-label="Ilford in Zahlen" style="gap:10px;padding:16px;border-radius:24px">
      <div style="display:flex;flex-direction:column;gap:3px"><h2 style="font-size:20px">Ilford in Zahlen</h2><span class="small">${sub}</span></div>
      <div class="igrid2">
        ${itile(hMin(c.minutes), 'draußen insgesamt', d?.minutes, false, 'wide')}
        ${itile(c.avgPerDay == null ? '–' : hMin(c.avgPerDay), 'pro Tag im Schnitt', d?.avgPerDay, false)}
        ${itile(String(c.outings), c.outings === 1 ? 'Ausflug' : 'Ausflüge', d?.outings, true)}
        ${itile(c.median == null ? '–' : hMin(c.median), 'typischer Ausflug', d?.median, false)}
        ${itile(c.longest ? hMin(c.longest.minutes) : '–', 'längster Ausflug', d?.longest, false)}
      </div>${part}${notes.map((t) => `<p class="small">${t}</p>`).join('')}</section>`;
  return nums + ilfordBars(I) + ilfordRecords(I);
}

function ilfordBars(I) {
  const B = I.bars, cnt = B.length, thirty = S.logDays === 30 && I.rolling.some((v) => v != null);
  const peak = Math.max(60, ...B.map((b) => b.minutes), I.avg || 0, ...I.rolling.map((v) => v || 0));
  const top = Math.ceil(peak / 60) * 60;
  const pc = (m) => +((m / top) * 100).toFixed(2);
  const sel = B.find((b) => b.iso === S.ilBar) || B[B.length - 1];
  const gap = cnt > 14 ? 2 : 6;
  const txt = (b) => `${b.partial ? 'Heute' : `${b.d} ${b.date}`}: ${b.minutes ? durShort(b.minutes) : 'nicht draußen'}${b.partial ? ' bis jetzt' : ''}${b.outings ? `, ${b.outings} ${b.outings === 1 ? 'Ausflug' : 'Ausflüge'}` : ''}`;
  const cols = B.map((b) => `<button class="icol${b === sel ? ' sel' : ''}" data-act="ilBar" data-i="${b.iso}" aria-label="${txt(b)}" aria-pressed="${b === sel}">
      <i class="ib${b.partial ? ' today' : ''}${b.first ? ' first' : ''}${b.minutes ? '' : ' zero'}" style="${b.minutes ? `height:${pc(b.minutes)}%` : ''}"></i></button>`).join('');
  const labels = B.map((b, i) => {
    const show = cnt <= 14 || (cnt - 1 - i) % 6 === 0;
    return `<span>${show ? (cnt <= 14 ? `<em>${b.partial ? 'Heute' : b.d}<br>${b.date}</em>` : `<em>${b.date}</em>`) : ''}</span>`;
  }).join('');
  const segs = [];
  if (thirty) {
    let cur = [];
    I.rolling.forEach((v, i) => {
      if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(`${+(((i + 0.5) / cnt) * 100).toFixed(2)},${100 - pc(v)}`);
    });
    if (cur.length) segs.push(cur);
  }
  const roll = thirty ? `<svg class="iroll" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${segs.map((p) => (p.length > 1 ? `<polyline points="${p.join(' ')}" fill="none" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` : '')).join('')}</svg>` : '';
  const avg = I.avg == null ? '' : `<div class="iavg" style="bottom:${pc(I.avg)}%"><span>Ø ${hMin(I.avg)}</span></div>`;
  const read = `<p class="iread" aria-live="polite"><b>${sel.partial ? 'Heute' : `${isoLabel(sel.iso)}`}</b> · ${sel.minutes ? `${durShort(sel.minutes)} draußen` : 'nicht draußen'}${sel.outings ? ` · ${sel.outings} ${sel.outings === 1 ? 'Ausflug' : 'Ausflüge'}` : ''}${sel.partial ? ' <span class="small">(bis jetzt)</span>' : ''}${sel.first ? ` <span class="small">(erst ab ${hhmm(I.since.ts)} Uhr erfasst)</span>` : ''}</p>`;
  const legend = `<div class="legend"><span><i style="width:12px;height:12px;border-radius:3px;background:var(--ink)"></i>Zeit draußen</span><span><i class="ib today" style="width:12px;height:12px;border-radius:3px"></i>heute, bis jetzt</span>${I.avg == null ? '' : '<span><i style="width:18px;border-top:2px dashed var(--muted)"></i>Ø pro Tag</span>'}${thirty ? '<span><i style="width:18px;border-top:3px solid var(--out)"></i>7-Tage-Schnitt</span>' : ''}</div>`;
  return `<section class="card" aria-label="Zeit draußen pro Tag" style="gap:8px;padding:16px;border-radius:24px">
      <div style="display:flex;flex-direction:column;gap:3px"><h2 style="font-size:20px">Zeit draußen pro Tag</h2><span class="small">Tippen für Details${I.avg == null ? '' : ' · Ø zählt nur abgeschlossene, ganz erfasste Tage'}</span></div>
      ${legend}
      <div class="ichart" style="--gap:${gap}px">
        <div class="igl" style="bottom:100%"><span>${hMin(top)}</span></div><div class="igl" style="bottom:50%"><span>${hMin(top / 2)}</span></div>
        ${avg}<div class="icols">${cols}</div>${roll}</div>
      <div class="ilabels" style="--gap:${gap}px">${labels}</div>${read}</section>`;
}

function ilfordRecords(I) {
  const R = I.records, st = I.streaks;
  const streak = (title, x) => `<div class="itile"><b>${nTage(x.current.days)}</b><span class="lb">${title}</span>
      ${x.current.days ? `<span class="dl">seit ${isoLabel(x.current.from)}</span>` : ''}
      ${x.isBest ? '<span class="best">Bestwert</span>' : x.best.days ? `<span class="dl">Bestwert: ${nTage(x.best.days)} (${isoSpan(x.best.from, x.best.to)})</span>` : ''}</div>`;
  const row = (label, value, detail) => `<div class="rec"><div><b>${label}</b><span>${detail}</span></div><strong>${value}</strong></div>`;
  const none = 'noch kein Ausflug';
  const inside = R.longestInside;
  const rows = [
    row('Längster Ausflug', R.longest ? durShort(R.longest.minutes) : '–', R.longest ? isoLabel(R.longest.date) : none),
    row('Meiste Zeit an einem Tag', R.mostMinutes ? durShort(R.mostMinutes.minutes) : '–', R.mostMinutes ? isoLabel(R.mostMinutes.date) : none),
    row('Meiste Ausflüge an einem Tag', R.mostOutings ? String(R.mostOutings.count) : '–', R.mostOutings ? isoLabel(R.mostOutings.date) : none),
    row('Längste Zeit am Stück drinnen', inside ? longDur(inside.minutes) : '–', inside ? (inside.open ? `läuft seit ${isoLabel(tsDay(inside.ts))}` : isoSpan(tsDay(inside.ts), tsDay(inside.ts + inside.minutes * 60000))) : '–'),
  ].join('');
  return `<section class="card" aria-label="Serien und Rekorde" style="gap:10px;padding:16px;border-radius:24px">
      <div style="display:flex;flex-direction:column;gap:3px"><h2 style="font-size:20px">Serien &amp; Rekorde</h2><span class="small">Seit ${I.since.label} · unabhängig vom Zeitraum oben</span></div>
      <div class="igrid2">${streak('Tage in Folge draußen', st.out)}${streak('Tage in Folge ohne Ausflug', st.none)}</div>
      <div class="recs">${rows}</div>
      <p class="small">Rekorde zählen nur Ausflüge bis ${String(I.staleHours).replace('.', ',')} Std. Ein Tag zählt als „draußen“, wenn Ilford mindestens eine Minute draußen war. Der heutige Tag verändert eine Serie erst, wenn Ilford draußen war.</p></section>`;
}

// ----- Zeiten anpassen (Protokoll, admins, own cat, last 24 hours) -----
// "heute um 06:42 Uhr", "gestern um 23:40 Uhr", "Mo 23.11. um 09:05 Uhr"
const whenDay = (ts) => feedWhen(ts).replace(/^um /, 'heute um ');
// "HH:MM" → the latest moment <= hi that shows this time on the clock. hi is at most 24 h back, so there is only one candidate.
function clockBefore(t, hi) {
  const m = textToMin(t);
  if (Number.isNaN(m)) return NaN;
  const p = tp(hi), hiMin = +p.h * 60 + +p.mi, back = m <= hiMin ? hiMin - m : hiMin + 1440 - m;
  return hi - +p.s * 1000 - back * 60000;
}
const rangeText = (sh) => `zwischen ${whenDay(sh.lo)} und ${sh.hi >= now() - 60000 ? 'jetzt' : whenDay(sh.hi)}`;
// → { at, ts } or { error } (and `at` when the clock time is fine but outside the range). The server checks the range again.
function resolveEdit(sh) {
  const at = clockBefore(sh.time, sh.hi);
  if (Number.isNaN(at)) return { error: 'Bitte eine Uhrzeit wählen.' };
  if (at < Math.floor(sh.lo / 60000) * 60000) return { at, error: `Die Uhrzeit muss ${rangeText(sh)} liegen.` };
  return { at, ts: Math.max(at, sh.lo) };
}

function timesBody(T) {
  const nm = CATS[ownCat()].name;
  const head = `<div style="display:flex;flex-direction:column;gap:3px"><h2 style="font-size:20px">Zeiten anpassen</h2><span class="small">Rein- und Raus-Zeiten der letzten 24 Stunden korrigieren, zum Beispiel wenn ${esc(nm)} nachts reinkam und der Button erst morgens gedrückt wurde. Die Reihenfolge der Einträge bleibt dabei erhalten.</span></div>`;
  const row = (r) => {
    const [d, date] = feedDayLabel(r.ts);
    const edited = r.edited ? `<span>angepasst von ${esc(r.edited.by)} · vorher ${esc(feedWhen(r.edited.orig).replace(/^um /, ''))}</span>` : '';
    return `<div class="rec"><div><b>${esc(nm)} ${r.status === 'in' ? 'kam rein' : 'ging raus'}</b><span>${d} ${date} · ${hhmm(r.ts)} Uhr</span>${edited}</div>
      ${r.editable ? `<button class="btn ghost" data-act="timeEdit" data-id="${r.id}" aria-label="Zeit ändern: ${esc(nm)} ${r.status === 'in' ? 'kam rein' : 'ging raus'}, ${d} ${hhmm(r.ts)} Uhr">${ic('clock')} Zeit ändern</button>` : '<span class="small">nicht änderbar</span>'}</div>`;
  };
  const list = !T ? '<p class="empty" style="padding:0">Lade Einträge …</p>'
    : !T.rows.length ? `<p class="empty" style="padding:0">In den letzten 24 Stunden gab es keinen Rein- oder Raus-Eintrag.</p>`
    : `<div class="recs">${T.rows.map(row).join('')}</div>`;
  return `<section class="card" aria-label="Zeiten anpassen" style="gap:10px;padding:16px;border-radius:24px">${head}${list}
    <p class="small">Geändert wird nur die Uhrzeit, nicht der Status. Die ursprüngliche Zeit und wer geändert hat bleiben gespeichert (auch im CSV-Export).</p></section>`;
}

// ----- feeding (Bonnie's household) -----
const agoText = (ts) => (Math.round((now() - ts) / 60000) <= 0 ? 'gerade eben' : `vor ${dur(now() - ts)}`);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// "um 19:17 Uhr", "gestern um 16:42 Uhr" or "Mo 23.11. um 09:05 Uhr"
const feedWhen = (ts) => {
  const p = tp(ts), k = dayKey(ts), at = `um ${p.h}:${p.mi} Uhr`;
  if (k === dayKey(now())) return at;
  if (k === dayKey(now() - 86400000)) return `gestern ${at}`;
  return `${WD[p.wd]} ${p.d}.${p.mo}. ${at}`;
};
const feedDayLabel = (ts) => {
  const p = tp(ts), k = dayKey(ts);
  if (k === dayKey(now())) return ['Heute', `${p.d}.${p.mo}.`];
  if (k === dayKey(now() - 86400000)) return ['Gestern', `${p.d}.${p.mo}.`];
  return [WD[p.wd], `${p.d}.${p.mo}.`];
};
// "HH:MM" → the moment it last was on the clock: today, or yesterday when it is later than now. NaN for a bad value.
function lastClockTime(t) {
  const m = textToMin(t);
  if (Number.isNaN(m)) return { at: NaN };
  const p = tp(now()), nowMin = +p.h * 60 + +p.mi, back = m <= nowMin ? nowMin - m : nowMin + 1440 - m;
  return { at: now() - +p.s * 1000 - back * 60000, back, yesterday: m > nowMin };
}
const feedTimeHint = (t) => { const r = lastClockTime(t); return Number.isNaN(r.at) ? '' : `${r.yesterday ? 'Gestern' : 'Heute'} um ${minToText(textToMin(t))} Uhr`; };

// Your own entry that is still young enough to take back (the server decides again).
function undoableFeed() {
  const F = S.state.feeding;
  return [F.last, ...(S.feed || [])].find((e) => e && e.mine && now() - e.rec <= F.undoMin * 60000) || null;
}

function feedCard() {
  const F = S.state.feeding, last = F.last, dis = S.busy || !S.online ? 'disabled' : '';
  // The person who just entered it already has the undo line, so the hint is for everybody else (and for their own older entries).
  const recent = last && now() - last.ts < F.hintMin * 60000 && !(last.mine && now() - last.rec <= F.undoMin * 60000);
  const who = (e) => (e.mine ? 'dir' : e.name);
  const meta = last ? `Zuletzt ${feedWhen(last.ts)} von ${who(last)}` : 'Noch keine Fütterung eingetragen';
  const undo = undoableFeed();
  const hint = recent ? `<div class="box warn" role="status"><span style="padding-top:1px">${ic('clock')}</span><div><b>${esc(cap(agoText(last.ts)))} schon gefüttert</b><span>Vielleicht ist Bonnie noch satt.</span></div></div>` : '';
  return `<section class="card card-main" aria-label="Bonnie füttern">
    <div class="row">
      <div class="portrait big"><img src="${portrait('bonnie', S.state.cats.bonnie.status)}" alt=""></div>
      <div class="stack"><span class="eyebrow">Fütterung</span><h2 class="name-l">Bonnie</h2><span class="meta">${esc(meta)}</span></div>
    </div>${hint}
    <div class="actions"><button class="btn in" data-act="feed" ${dis}>${ic('bowl', 22)} Bonnie füttern</button>
      <button class="btn ghost" data-act="feedAdjust" ${dis}>${ic('clock')} Früher gefüttert? Zeit anpassen</button>
      ${undo ? `<div class="line ok">${ic('check', 18)}<span>${undo.late ? `Nachgetragen für ${esc(hhmm(undo.ts))} Uhr.` : `Eingetragen um ${esc(hhmm(undo.ts))} Uhr.`}</span><button data-act="unfeed" data-id="${undo.id}" ${dis}>${ic('undo', 14)} Rückgängig</button></div>` : ''}
      ${S.online ? '' : `<div class="line warn">${ic('alert', 18)}<span>Ohne Verbindung geht das gerade nicht.</span></div>`}</div></section>`;
}

function feedList() {
  let body = '<p class="empty">Lade Verlauf …</p>';
  if (S.feed) {
    const groups = [];
    for (const e of S.feed) {
      const k = dayKey(e.ts);
      if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, ts: e.ts, items: [] });
      groups[groups.length - 1].items.push(e);
    }
    body = groups.length ? groups.map((g) => { const [d, date] = feedDayLabel(g.ts);
      return `<div class="fgroup"><div class="fhead"><b>${esc(d)}</b><span>${esc(date)}</span><em>${g.items.length} ×</em></div>${g.items.map((e) => `<div class="frow"><time>${esc(hhmm(e.ts))}</time><span class="who">${esc(e.name)}</span>${e.mine ? '<span class="tag you">du</span>' : ''}${e.late ? '<span class="tag late">nachgetragen</span>' : ''}</div>`).join('')}</div>`; }).join('')
      : '<p class="empty">In den letzten 7 Tagen wurde nichts eingetragen.</p>';
  }
  return `<section class="card" aria-label="Verlauf" style="padding:16px 16px 10px;gap:4px;border-radius:24px">
    <div class="sec-head" style="padding-bottom:6px"><h2 style="font-size:20px">Wer hat gefüttert?</h2><span class="small">letzte 7 Tage</span></div>${body}
    <p class="small" style="padding:10px 0 4px">Alle in Bonnies Haushalt sehen diese Liste. Falsch gedrückt? Rückgängig geht ${S.state.feeding.undoMin} Minuten lang.</p></section>`;
}

function feedView() {
  return `<div class="scroll"><div class="page" style="gap:14px">
    <div class="head"><div class="head-text"><h1>Füttern</h1><p class="sub">${esc(headerDate())}</p></div>
      <button class="icon-btn" data-act="settings" aria-label="Einstellungen">${ic('sliders', 22)}</button></div>
    ${feedCard()}${feedList()}</div></div>`;
}

function tabs() {
  const items = [['home', 'home', 'Jetzt'], ['plan', 'calendar', 'Plan']];
  if (feeds()) items.push(['feed', 'bowl', 'Füttern']);
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
  } else if (sh.type === 'feedrecent') {
    const l = sh.last, who = l.mine ? 'dir' : l.name;
    inner = `<div class="head2"><div class="tile"><img src="${img('bonnie', 'sitting')}" alt=""></div>
        <div style="display:flex;flex-direction:column;gap:4px"><h2 id="sh-t">Bonnie wurde schon gefüttert</h2><span class="sub" style="line-height:1.4">${esc(cap(agoText(l.ts)))} (${esc(feedWhen(l.ts))}) von ${esc(who)}. Trotzdem noch einmal eintragen?</span></div></div>
      <button class="btn in sm" data-act="feedForce" ${S.busy ? 'disabled' : ''}>${ic('bowl')} Trotzdem eintragen</button>
      <button class="btn plain" data-act="closeSheet">Abbrechen</button>`;
  } else if (sh.type === 'feedwhen') {
    const opts = [['Vor 10 Min', 10], ['Vor 30 Min', 30], ['Vor 1 Std', 60], ['Vor 2 Std', 120]];
    inner = `<div style="display:flex;flex-direction:column;gap:4px"><h2 id="sh-t">Wann wurde Bonnie gefüttert?</h2><span class="sub">Zum Nachtragen, wenn es vorhin vergessen wurde.</span></div>
      <div class="grid2">${opts.map(([l, m]) => `<button class="opt" data-act="feedPick" data-m="${m}" ${S.busy ? 'disabled' : ''}>${l}</button>`).join('')}</div>
      <div class="field"><label for="feed-time">Oder genaue Uhrzeit</label><input class="input text" id="feed-time" type="time" step="300" value="${esc(sh.time)}"></div>
      <span class="small" id="feed-time-hint">${esc(feedTimeHint(sh.time))}</span>
      ${sh.error ? `<p class="err" role="alert">${esc(sh.error)}</p>` : ''}
      <button class="btn in sm" data-act="feedAtTime" ${S.busy ? 'disabled' : ''}>${ic('bowl')} Eintragen</button>
      <button class="btn plain" data-act="closeSheet">Abbrechen</button>`;
  } else if (sh.type === 'adjust') {
    title = `Wann ist ${CATS[o].name} reingekommen?`;
    const opts = [['Gerade eben', 0], ['Vor 5 Min', 5], ['Vor 10 Min', 10], ['Vor 20 Min', 20]];
    inner = `<div style="display:flex;flex-direction:column;gap:4px"><h2 id="sh-t">${esc(title)}</h2><span class="sub">Damit das Protokoll stimmt.</span></div>
      <div class="grid2">${opts.map(([l, m]) => `<button class="opt" data-act="adjustPick" data-m="${m}" ${S.busy ? 'disabled' : ''}>${l}</button>`).join('')}</div>
      <div class="field"><label for="adjust-time">Oder genaue Uhrzeit (bis 24 Std zurück)</label><input class="input text" id="adjust-time" type="time" step="60" value="${esc(sh.time)}"></div>
      <span class="small" id="adjust-time-hint">${esc(feedTimeHint(sh.time))}</span>
      ${sh.error ? `<p class="err" role="alert">${esc(sh.error)}</p>` : ''}
      <button class="btn in sm" data-act="adjustAtTime" ${S.busy ? 'disabled' : ''}>${ic('doorin')} Eintragen</button>
      <button class="btn plain" data-act="closeSheet">Abbrechen</button>`;
  } else if (sh.type === 'timeedit') {
    const nm = CATS[ownCat()].name, inn = sh.status === 'in', res = resolveEdit(sh);
    title = inn ? `Wann kam ${nm} rein?` : `Wann ging ${nm} raus?`;
    const hint = res.at == null ? '' : `${cap(whenDay(res.at))}${res.error ? ' – außerhalb des möglichen Zeitraums' : ''}`;
    inner = `<div style="display:flex;flex-direction:column;gap:4px"><h2 id="sh-t">${esc(title)}</h2><span class="sub">Aktuell eingetragen: ${esc(whenDay(sh.ts))}</span></div>
      <div class="field"><label for="edit-time">Neue Uhrzeit</label><input class="input text" id="edit-time" type="time" step="60" value="${esc(sh.time)}"></div>
      <span class="small" id="edit-time-hint">${esc(hint)}</span>
      <span class="small">Möglich ist ${esc(rangeText(sh))}.</span>
      ${sh.error ? `<p class="err" role="alert">${esc(sh.error)}</p>` : ''}
      <button class="btn in sm" data-act="timeSave" ${S.busy ? 'disabled' : ''}>${ic('check')} Speichern</button>
      <button class="btn plain" data-act="closeSheet">Abbrechen</button>`;
  } else if (sh.type === 'slot') {
    const inn = sh.kind === 'in', edit = !!sh.id, name = CATS[o].name;
    title = edit ? (inn ? 'Drinnen-Zeit bearbeiten' : 'Zeitfenster bearbeiten') : inn ? `${name} bleibt drinnen` : `Neues Zeitfenster für ${name}`;
    const kindCtl = edit ? '' : `<div class="seg-ctl" role="group" aria-label="Art"><button type="button" data-act="slotKind" data-k="out" aria-pressed="${!inn}">Draußen</button><button type="button" data-act="slotKind" data-k="in" aria-pressed="${inn}">Drinnen</button></div>`;
    const dayChips = edit ? `<span class="sub">${WD_LONG[sh.weekday]}${inn ? (sh.date ? `, ${dateLabel(sh.date).replace(/^\S+\s/, '')}` : ' · jede Woche') : ''}</span>`
      : `<div class="chips" role="group" aria-label="Wochentage">${WD.map((d, i) => `<button type="button" data-act="slotDay" data-i="${i}" aria-pressed="${sh.days.includes(i)}" aria-label="${WD_LONG[i]}">${d}</button>`).join('')}</div>`;
    const onceCtl = inn && !edit ? `<div class="seg-ctl" role="group" aria-label="Wie oft"><button type="button" data-act="slotOnce" data-v="1" aria-pressed="${sh.once}">Nur einmal</button><button type="button" data-act="slotOnce" data-v="0" aria-pressed="${!sh.once}">Jede Woche</button></div>` : '';
    const allDayRow = inn ? `<div class="set-row"><div class="tx"><b>Ganztägig</b><span>${sh.allDay ? `${name} bleibt den ganzen Tag drinnen.` : 'Nur in dieser Zeit drinnen.'}</span></div>
        <button type="button" class="sw" role="switch" aria-checked="${sh.allDay}" aria-label="Ganztägig" data-act="slotAllDay"><i></i></button></div>` : '';
    const times = inn && sh.allDay ? '' : `<div class="two"><div class="field"><label for="slot-start">Von</label><input class="input text" id="slot-start" type="time" step="300" value="${esc(sh.start)}"></div>
      <div class="field"><label for="slot-end">Bis</label><input class="input text" id="slot-end" type="time" step="300" value="${esc(sh.end)}"></div></div>`;
    const note = inn ? `${esc(me().otherName)} sieht das und weiß, dass ${name} drinnen bleibt.${sh.once || sh.date ? ' Draußen-Zeiten, die in dieser Zeit beginnen, entfallen.' : ''}`
      : `${esc(me().otherName)} sieht das Fenster, und du wirst 15 Min vorher erinnert.`;
    inner = `<h2 id="sh-t">${esc(title)}</h2>${kindCtl}${dayChips}${onceCtl}${allDayRow}${times}
      <span class="small" id="slot-hint">${esc(slotHint(sh))}</span>
      <span class="small">${note}</span>
      ${sh.error ? `<p class="err" role="alert">${esc(sh.error)}</p>` : ''}
      <button class="btn in sm" data-act="saveSlot" ${sh.busy ? 'disabled' : ''}>Speichern</button>
      ${edit ? `<button class="btn plain" data-act="deleteSlot" style="color:var(--out-fg)">${inn ? 'Drinnen-Zeit löschen' : 'Zeitfenster löschen'}</button>` : ''}
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
      <div class="set-row"><div class="tx"><b>Meldungen beim Rauslassen</b><span>Benachrichtigt werden, wenn jemand anderes aus dem Haushalt ${CATS[o].name} rauslässt oder wieder reinholt.</span></div>
        <button class="sw" role="switch" aria-checked="${S.state.prefs.ownPush}" aria-label="Meldungen beim Rauslassen" data-act="toggleOwnPush"><i></i></button></div>
      ${feeds() ? `<div class="set-row"><div class="tx"><b>Meldungen beim Füttern</b><span>Benachrichtigt werden, wenn jemand anderes Bonnie füttert.</span></div>
        <button class="sw" role="switch" aria-checked="${S.state.prefs.feedPush}" aria-label="Meldungen beim Füttern" data-act="toggleFeedPush"><i></i></button></div>` : ''}
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
  const main = S.view === 'plan' ? planView() : S.view === 'log' && me().admin ? logView() : S.view === 'feed' && feeds() ? feedView() : homeView();
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

// Preferences that live on the server, one switch at a time.
async function setPref(key, value) {
  try {
    const r = await api('PUT', '/api/prefs', { [key]: value });
    if (r.ok) { applyState(r.data.state); S.online = true; render(); } else toast('Das hat nicht geklappt. Bitte nochmal versuchen.');
  } catch { S.online = false; toast('Keine Verbindung – es wurde nichts geändert.'); }
}

// Entering a feeding never blocks: within the hour it asks first ("Trotzdem eintragen"); the server checks again, so a feeding by someone else a moment ago is caught too.
// `at` (epoch ms) enters it afterwards; without it the feeding is "now".
async function addFeeding(force, at) {
  if (S.busy || !S.online) return;
  const F = S.state.feeding;
  if (!force && at === undefined && F.last && now() - F.last.ts < F.hintMin * 60000) { openSheet({ type: 'feedrecent', last: F.last }); return; }
  S.busy = true; render();
  try {
    const r = await api('POST', '/api/feedings', { ...(force ? { force: true } : {}), ...(at === undefined ? {} : { at: Math.round(at) }) });
    if (r.status === 409 && r.data?.error === 'recent') { S.busy = false; openSheet({ type: 'feedrecent', last: r.data.last, at }); await refresh(); return; }
    if (r.ok) { S.sheet = null; toast(`${r.data.entry.late ? 'Nachgetragen' : 'Eingetragen'}: ${hhmm(r.data.entry.ts)} Uhr.`); } else toast('Das hat nicht geklappt. Bitte nochmal versuchen.');
  } catch { S.online = false; toast('Keine Verbindung – es wurde nichts eingetragen.'); }
  S.busy = false; await refresh();
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
  adjust() { const p = tp(now()); openSheet({ type: 'adjust', time: `${p.h}:${p.mi}`, error: '' }); },
  timeEdit(d) {
    const r = S.times?.rows.find((x) => x.id === +d.id);
    if (!r || !r.editable) return;
    openSheet({ type: 'timeedit', id: r.id, status: r.status, ts: r.ts, lo: r.lo, hi: r.hi, time: hhmm(r.ts), error: '' });
  },
  async timeSave() {
    if (S.busy) return;
    const sh = S.sheet, nm = CATS[ownCat()].name;
    const el = document.getElementById('edit-time'); if (el?.value) sh.time = el.value; // read what is on the clock wheel right now (iOS)
    const r = resolveEdit(sh);
    if (r.error) { sh.error = r.error; renderOverlay(); return; }
    if (Math.floor(r.ts / 60000) === Math.floor(sh.ts / 60000)) { closeSheet(); toast('Die Zeit ist unverändert.'); return; }
    S.busy = true; render();
    try {
      const x = await api('POST', '/api/times', { id: sh.id, ts: Math.round(r.ts) });
      if (x.ok) {
        applyState(x.data.state); S.online = true; S.sheet = null;
        S.times = { rows: x.data.rows }; S.ilford = null; S.log = null; // the numbers on the other pages are out of date now
        toast(`Zeit angepasst: ${nm} ${sh.status === 'in' ? 'kam' : 'ging'} ${feedWhen(r.ts)} ${sh.status === 'in' ? 'rein' : 'raus'}.`);
      } else if (x.status === 409) {
        S.sheet = null; await loadTimes();
        toast(x.data?.error === 'too_old' ? 'Der Eintrag ist älter als 24 Stunden und kann nicht mehr geändert werden.' : 'Der Eintrag hat sich inzwischen geändert. Bitte die Liste prüfen.');
      } else toast('Das hat nicht geklappt. Bitte nochmal versuchen.');
    } catch { S.online = false; toast('Keine Verbindung – es wurde nichts geändert.'); }
    S.busy = false; render();
  },
  adjustAtTime() {
    const sh = S.sheet, c = S.state.cats[ownCat()], name = CATS[ownCat()].name;
    const el = document.getElementById('adjust-time'); if (el?.value) sh.time = el.value; // read what is on the clock wheel right now (iOS)
    const r = lastClockTime(sh.time);
    if (Number.isNaN(r.at)) { sh.error = 'Bitte eine Uhrzeit wählen.'; renderOverlay(); return; }
    // The server would quietly move an earlier time up to the start of the outing: say it instead.
    if (Math.floor(r.at / 60000) < Math.floor(c.since / 60000)) { sh.error = `${name} ist erst ${feedWhen(c.since)} rausgegangen. Bitte eine spätere Zeit wählen.`; renderOverlay(); return; }
    return setStatus('in', { agoMin: r.back }, `Eingetragen: ${name} ist seit ${r.yesterday ? 'gestern ' : ''}${minToText(textToMin(sh.time))} drin.`);
  },
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
  toggleOwnPush() { return setPref('ownPush', !S.state.prefs.ownPush); },
  toggleFeedPush() { return setPref('feedPush', !S.state.prefs.feedPush); },
  feed() { return addFeeding(false); },
  feedForce() { return addFeeding(true, S.sheet?.at); },
  feedAdjust() { const p = tp(now()); openSheet({ type: 'feedwhen', time: `${p.h}:${p.mi}`, error: '' }); },
  feedPick(d) { return addFeeding(false, now() - +d.m * 60000); },
  feedAtTime() {
    const r = lastClockTime(S.sheet.time);
    if (Number.isNaN(r.at)) { S.sheet.error = 'Bitte eine Uhrzeit wählen.'; renderOverlay(); return; }
    return addFeeding(false, r.at);
  },
  async unfeed(d) {
    if (S.busy) return;
    S.busy = true; render();
    try {
      const r = await api('DELETE', `/api/feedings/${+d.id}`);
      if (r.ok) toast('Eintrag zurückgenommen.');
      else if (r.status === 409) toast(`Zu spät – zurücknehmen geht nur ${S.state.feeding.undoMin} Minuten lang.`);
      else if (r.status === 404) toast('Den Eintrag gibt es nicht mehr.');
      else toast('Das hat nicht geklappt. Bitte nochmal versuchen.');
    } catch { S.online = false; toast('Keine Verbindung – es wurde nichts geändert.'); }
    S.busy = false; await refresh();
  },
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
    openSheet({ type: 'slot', id: null, kind: 'out', days: [S.planDay], start: '16:00', end: '17:00', allDay: true, once: true, error: '' });
  },
  slotKind(d) { S.sheet.kind = d.k; S.sheet.error = ''; renderOverlay(); },
  slotOnce(d) { S.sheet.once = d.v === '1'; renderOverlay(); },
  slotAllDay() { S.sheet.allDay = !S.sheet.allDay; S.sheet.error = ''; renderOverlay(); },
  slotDay(d) {
    const i = +d.i, days = S.sheet.days;
    S.sheet.days = days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort();
    renderOverlay();
  },
  editSlot(d) {
    const id = +d.id, ins = (S.inside || []).find((x) => x.id === id), s = ins || (S.plan || []).find((x) => x.id === id);
    if (s) openSheet({ type: 'slot', id: s.id, kind: ins ? 'in' : 'out', weekday: s.weekday, date: s.date || null, days: [s.weekday], start: minToText(s.start), end: minToText(s.end % 1440), allDay: !!ins && s.start === 0 && s.end === 1440, once: !!s.date, error: '' });
  },
  async saveSlot() {
    const sh = S.sheet, inn = sh.kind === 'in', whole = inn && sh.allDay;
    const a = whole ? 0 : textToMin(sh.start), b = whole ? 1440 : textToMin(sh.end);
    if (!whole && (Number.isNaN(a) || Number.isNaN(b) || a === b)) { sh.error = 'Bitte „Von“ und „Bis“ wählen. Sie dürfen nicht gleich sein.'; renderOverlay(); return; }
    if (!sh.id && !sh.days.length) { sh.error = 'Bitte mindestens einen Wochentag wählen.'; renderOverlay(); return; }
    sh.busy = true; sh.error = ''; renderOverlay();
    try {
      const r = sh.id ? await api('PUT', `/api/plan/${sh.id}`, { start: a, end: b, allDay: whole })
        : await api('POST', '/api/plan', { kind: sh.kind, weekdays: sh.days, start: a, end: b, allDay: whole, once: inn && sh.once });
      if (r.ok) { await loadPlan(); S.sheet = null; render(); toast(inn ? 'Drinnen-Zeit gespeichert.' : 'Zeitfenster gespeichert.'); return; }
      if (r.status === 409) {
        const w = r.data?.with;
        sh.error = inn ? (w === 'in' ? 'Dafür gibt es schon eine Drinnen-Zeit von dir.' : 'Das überschneidet sich mit einem Draußen-Zeitfenster von dir. Wähle „Nur einmal“ oder ändere das Zeitfenster.')
          : w === 'in' ? 'Das überschneidet sich mit einer wöchentlichen Drinnen-Zeit von dir.' : 'Das überschneidet sich mit einem anderen Zeitfenster von dir.';
      } else sh.error = 'Bitte Zeiten in 5-Minuten-Schritten wählen.';
    } catch { sh.error = 'Keine Verbindung. Bitte nochmal versuchen.'; }
    sh.busy = false; renderOverlay();
  },
  async deleteSlot() {
    const sh = S.sheet;
    try { const r = await api('DELETE', `/api/plan/${sh.id}`); if (r.ok) { await loadPlan(); S.sheet = null; render(); toast(sh.kind === 'in' ? 'Drinnen-Zeit gelöscht.' : 'Zeitfenster gelöscht.'); return; } } catch { /* fall through */ }
    sh.error = 'Das hat nicht geklappt.'; renderOverlay();
  },
  logDays(d) { S.logDays = +d.d; S.logAll = false; S.log = null; S.ilford = null; S.ilBar = ''; render(); (ilfordPage() ? loadIlford() : loadLog()).then(render); },
  logPage(d) {
    if (!ilfordOn() || !['konflikte', 'ilford', 'zeiten'].includes(d.p)) return;
    S.logPage = d.p; store.set('logPage', d.p); S.logAll = false; render(); refresh();
  },
  ilBar(d) { S.ilBar = d.i; render(); },
  logAll() { S.logAll = !S.logAll; render(); },
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
    const lines = ['Zeit;Katze;Status;Vorher;Erfasst von;Eingetragen um;Override;Hinweis;Ursprüngliche Zeit;Angepasst von'];
    for (const e of r.data.events) lines.push([f(e.ts), CATS[e.cat].name, st[e.status], st[e.prev_status] || '', e.actor, f(e.recorded_at), e.override ? 'ja' : '', e.note || '', e.orig_ts ? f(e.orig_ts) : '', e.edited_by || ''].map(q).join(';'));
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
  else if (t.id === 'adjust-time' && S.sheet) { S.sheet.time = t.value; S.sheet.error = ''; const h = document.getElementById('adjust-time-hint'); if (h) h.textContent = feedTimeHint(t.value); }
  else if (t.id === 'edit-time' && S.sheet) {
    S.sheet.time = t.value; S.sheet.error = '';
    const r = resolveEdit(S.sheet), h = document.getElementById('edit-time-hint');
    if (h) h.textContent = r.at == null ? '' : `${cap(whenDay(r.at))}${r.error ? ' – außerhalb des möglichen Zeitraums' : ''}`;
  }
  else if (t.id === 'feed-time' && S.sheet) { S.sheet.time = t.value; S.sheet.error = ''; const h = document.getElementById('feed-time-hint'); if (h) h.textContent = feedTimeHint(t.value); }
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
  S.logPage = ['ilford', 'zeiten'].includes(store.get('logPage')) ? store.get('logPage') : 'konflikte';
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
