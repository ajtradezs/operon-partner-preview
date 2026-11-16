/* Operon partner preview: generic shell, forked from the Operon demo (utilities, dialogs, header, sign-in, render, events).
   Content lives in src/itr12 and registers itself through VIEWS, NAV_COUNT, SEEDERS, TICKERS, ACT, FORMS and EXT_FIELD. */

/* ===================== Utilities ===================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: convenience only */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

// Demo clock: every visit starts at 09:00 (SAST) on Monday 9 November 2026 and then runs at real speed,
// so seeded times (latest 08:59) are never in the future.
const CLOCK_START = new Date(2026, 10, 9, 9, 0, 0).getTime();
const CLOCK_REAL0 = Date.now();
function now() { return new Date(CLOCK_START + (Date.now() - CLOCK_REAL0)); }
const greeting = () => { const h = now().getHours(); return h < 12 ? 'Good morning' : (h < 18 ? 'Good afternoon' : 'Good evening'); };
const DAY0 = new Date(2026, 10, 9);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const day = (off, h = 0, m = 0) => new Date(2026, 10, 9 + off, h, m);
const pad2 = (n) => String(n).padStart(2, '0');
const fDate = (d) => d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
const fDM = (d) => d.getDate() + ' ' + MON[d.getMonth()];
const fShort = (d) => DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()];
const fTime = (d) => pad2(d.getHours()) + ':' + pad2(d.getMinutes());
const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysTo = (d) => Math.round((sod(d) - sod(now())) / 864e5);
function fWhen(d) {
  const n = daysTo(d);
  if (n === 0) return 'Today ' + fTime(d);
  if (n === -1) return 'Yesterday ' + fTime(d);
  return fShort(d) + ' ' + fTime(d);
}
function dueIn(d) {
  const n = daysTo(d);
  if (n < 0) return (-n) + (n === -1 ? ' day' : ' days') + ' overdue';
  if (n === 0) return 'due today';
  if (n === 1) return 'tomorrow';
  return n + ' days';
}
function R(n) {
  const neg = n < 0; const parts = Math.abs(n).toFixed(2).split('.');
  return (neg ? '-' : '') + 'R ' + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
}
function hash(s) {
  let out = '';
  for (let k = 0; k < 8; k++) {
    let h = (0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}
// SHA-256 (FIPS 180-4) over the UTF-8 bytes of a string, synchronous so the engine and the seed stay synchronous.
// tests/test_engine.py checks it against the browser's SubtleCrypto.
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
function sha256(s) {
  const m = new TextEncoder().encode(String(s));
  const len = m.length; const n = (((len + 9) + 63) >> 6) << 6;
  const buf = new Uint8Array(n); buf.set(m); buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(n - 8, Math.floor(len / 0x20000000)); dv.setUint32(n - 4, (len << 3) >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      W[i] = (W[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + W[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}
let uidN = 0;
const uid = (p) => p + (++uidN).toString(36);
const initials = (name) => name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const isPhone = () => window.matchMedia('(max-width: 760px)').matches;
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

/* ===================== Icons ===================== */
const ico = (paths, size = 14) => `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const I = {
  lock: ico('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>', 12),
  cycle: ico('<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.8v3h-3"/>', 12),
  hourglass: ico('<path d="M4.5 2h7M4.5 14h7M5.5 2v2.2L8 8l2.5-3.8V2M5.5 14v-2.2L8 8l2.5 3.8V14"/>', 12),
  pen: ico('<path d="M3 13l.9-3.3L10.6 3 13 5.4 6.3 12.1z"/><path d="M9.4 4.2l2.4 2.4"/>', 12),
  lodge: ico('<path d="M8 10V2.5M5.2 5.3 8 2.5l2.8 2.8M2.5 9.5v4h11v-4"/>', 12),
  alert: ico('<path d="M8 2.2 14.3 13.5H1.7z"/><path d="M8 6.6v3.1M8 11.6v.1"/>', 12),
  search: ico('<circle cx="7" cy="7" r="4.25"/><path d="m10.2 10.2 3.3 3.3"/>', 12),
  check: ico('<path d="m3 8.5 3.2 3L13 4.5"/>', 12),
  chev: ico('<path d="m6 4 4 4-4 4"/>', 12),
  down: ico('<path d="m4 6 4 4 4-4"/>', 12),
  clock: ico('<circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/>', 12),
  shield: ico('<path d="M8 1.8 13 3.6v4c0 3.2-2.2 5.4-5 6.6-2.8-1.2-5-3.4-5-6.6v-4z"/><path d="m5.8 8 1.6 1.6 3-3"/>', 12),
};
const TIER = {
  auto: { word: 'Auto', glyph: '<circle cx="8" cy="8" r="6.5" fill="currentColor"/>' },
  hold: { word: 'Auto + hold', glyph: '<circle cx="8" cy="8" r="5.75" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M8 2.25 A5.75 5.75 0 0 0 8 13.75 Z" fill="currentColor"/>' },
  held: { word: 'Held for a human', glyph: '<rect x="2.375" y="2.375" width="11.25" height="11.25" fill="none" stroke="currentColor" stroke-width="1.75"/>' },
  forbidden: { word: 'Forbidden', glyph: '<circle cx="8" cy="8" r="5.75" fill="none" stroke="currentColor" stroke-width="1.75"/><line x1="3.9" y1="12.1" x2="12.1" y2="3.9" stroke="currentColor" stroke-width="1.75"/>' },
};
const TIER_SHAPE = { auto: 'filled circle', hold: 'half circle', held: 'open square', forbidden: 'slashed circle' };
const tierBadge = (t) => t && TIER[t] ? `<span class="tier ${t}" data-shape="${TIER_SHAPE[t]}"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">${TIER[t].glyph}</svg>${TIER[t].word}</span>` : '';

let markN = 0;
function markSvg(size, label, small) {
  const g = small ? { o: 88, n: 28, s: 40, h: 52, a: 80 } : { o: 95.5, n: 18.75, s: 26.5, h: 66, a: 86 };
  const id = 'opm' + (++markN);
  const pol = (r, d) => { const a = d * Math.PI / 180; return [(r * Math.cos(a)).toFixed(2), (r * Math.sin(a)).toFixed(2)]; };
  const nodes = [0, 1, 2, 3, 4].map((k) => pol(g.o, -90 + 72 * k));
  const cr = g.a / Math.cos(Math.PI / 5);
  const band = [0, 1, 2, 3, 4].map((k) => pol(cr, -90 - 11 + 72 * k).join(',')).join(' ');
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true" focusable="false"';
  return `<svg viewBox="-120 -120 240 240" width="${size}" height="${size}" ${a11y}><defs><linearGradient id="${id}g" gradientUnits="userSpaceOnUse" x1="-64.28" y1="-76.6" x2="73.28" y2="87.33"><stop offset="0" stop-color="#871EFA"/><stop offset=".25" stop-color="#6F49F3"/><stop offset=".5" stop-color="#4C71F0"/><stop offset=".75" stop-color="#1EA1EE"/><stop offset="1" stop-color="#11BAEF"/></linearGradient><mask id="${id}k" maskUnits="userSpaceOnUse" x="-120" y="-120" width="240" height="240"><rect x="-120" y="-120" width="240" height="240" fill="#fff"/><circle r="${g.h}" fill="#000"/>${nodes.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${g.s}" fill="#000"/>`).join('')}</mask></defs><polygon points="${band}" fill="url(#${id}g)" mask="url(#${id}k)"/>${nodes.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${g.n}" fill="url(#${id}g)"/>`).join('')}</svg>`;
}

/* ===================== State, registries and lookups ===================== */
const FIRM = 'Acacia & Partners Inc. (Demo)';
let S;
const VIEWS = {};      // route name -> (id) => html. Content modules register their screens here.
const NAV_COUNT = {};  // nav key -> () => number | null
const SEEDERS = [];    // (S) => void, run in order by seed()
const TICKERS = [];    // () => boolean (true when something changed), run every second
function baseState() {
  const role = LS.get('op-demo-role');
  return {
    signedIn: LS.get('op-demo-in') === '1',
    role: ROLES.includes(role) ? role : ROLES[0],
    authStep: 'email', authEmail: '',
    people: PEOPLE0.map((p) => Object.assign({}, p)), invites: [], lastInvite: null,
    audit: [], auditN: 5000, paused: null, stepUpUntil: 0, timers: [], noRestore: false,
    fb: [], fbNames: {}, fbState: 'idle',
  };
}
function seed() {
  S = baseState();
  AUDIT_SEAL.reset();
  for (const f of SEEDERS) f(S);
}
const person = (id) => S.people.find((p) => p.id === id) || PEOPLE0.find((p) => p.id === id);
const pname = (id) => (person(id) ? person(id).name : id);
const me = () => person(ME_BY_ROLE[S.role]);

/* ===================== Permissions (locked controls say why) ===================== */
const LOCK = {
  people: () => S.role === 'Administrator' ? null : 'Administrators only',
  agents: () => S.paused ? 'AI work is paused' : null,
};
function btn(label, act, o) {
  o = o || {};
  const data = Object.entries(o.data || {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  const cls = 'btn ' + (o.cls || '');
  if (o.lock) {
    const id = uid('lk');
    return `<span class="locked"><button type="button" class="${cls}" disabled aria-describedby="${id}">${esc(label)}</button><span class="lock" id="${id}">${I.lock}${esc(o.lock)}</span></span>`;
  }
  return `<button type="${o.type || 'button'}" class="${cls}" data-act="${act}"${data}${o.id ? ` id="${o.id}"` : ''}${o.title ? ` title="${esc(o.title)}"` : ''}>${o.html || esc(label)}</button>`;
}

/* ===================== Header and nav ===================== */
const ROUTE_WITH_ID = /^(case|client|exception|portal|incident|idea)-([A-Za-z0-9]+)$/;
const ROUTE_NAMES = ['today', 'cases', 'approvals', 'exceptions', 'clients', 'papersync', 'sars', 'deadlines', 'controls',
  'incidents', 'retention', 'audit', 'try', 'import', 'people', 'account', 'feedback'];
const NAV_PARENT = { case: 'cases', client: 'clients', exception: 'exceptions', portal: 'papersync', incident: 'incidents' };
function routeOf() {
  const h = (location.hash || '').replace(/^#/, '');
  const m = h.match(ROUTE_WITH_ID);
  if (m) return { name: m[1], id: m[2] };
  return { name: ROUTE_NAMES.includes(h) ? h : 'today' };
}
function renderHeader() {
  const hdr = $('#hdr');
  if (!S.signedIn) { hdr.innerHTML = ''; return; }
  const m = me(); const r = routeOf();
  const cur = NAV_PARENT[r.name] || r.name;
  const item = (k, label) => {
    const n = NAV_COUNT[k] ? NAV_COUNT[k]() : null;
    return `<a href="#${k}"${cur === k ? ' aria-current="page"' : ''}>${esc(label)}${n != null ? `<span class="count${n ? '' : ' zero'}" aria-label="${n} items">${n}</span>` : ''}</a>`;
  };
  const sep = '<span class="sep" aria-hidden="true"></span>';
  hdr.innerHTML = `<div class="bar">
    <a class="logo" href="#today" aria-label="Operon home">${markSvg(30, null, false)}<span class="wordmark">Operon</span></a>
    <span class="firm">${esc(FIRM)}</span><span class="spacer"></span><button type="button" class="btn sm" data-act="copyPreviewLink">Copy preview link</button>
    <div class="who">
      <label for="role-sw"><span class="lbl">Role</span> <select id="role-sw" data-on="role">${ROLES.map((x) => `<option${S.role === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <a class="avatar" href="#account" title="${esc(m.name)}: account" aria-label="Account for ${esc(m.name)}">${initials(m.name)}</a>
    </div></div>
    <nav class="nav" aria-label="Main">${item('today', 'Today')}${item('cases', 'Cases')}${sep}${item('approvals', 'Approvals')}${item('exceptions', 'Exceptions')}${sep}${item('clients', 'Clients')}${item('papersync', 'PaperSync')}${item('sars', 'SARS link')}${item('deadlines', 'Deadlines')}${sep}${item('controls', 'Controls')}${item('incidents', 'Incidents')}${item('retention', 'Retention')}${item('audit', 'Audit trail')}${item('try', 'Try it')}${item('import', 'Import clients')}${item('people', 'People & roles')}${item('account', 'Account')}${item('feedback', 'Review notes')}</nav>`;
  afterHeader();
}

/* ===================== Sign-in ===================== */
function viewSignIn() {
  const logo = `<div class="stacked">${markSvg(112, 'Operon', false)}<span class="wm">Operon</span><span class="tag">Autonomous Firm Intelligence</span></div>`;
  if (S.authStep === 'code') {
    return `<section class="signin"><div class="signin-card">${logo}<div class="card"><form data-form="code" class="stack" novalidate>
      <h1 class="sr">Simulated two-step sign-in</h1>
      <p>Signing in as <strong>${esc(S.authEmail)}</strong>.</p>
      <label class="f" for="si-code">Simulated code · enter 123456<input id="si-code" name="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000"></label>
      <p class="hint">Demo: any 6 digits work. In the real app this is your authenticator code.</p>
      <p class="err" id="si-err" role="alert"></p>
      <div class="row between"><button type="button" class="btn ghost" data-act="authBack">Back</button><button class="btn primary" type="submit">Sign in</button></div>
    </form></div></div></section>`;
  }
  return `<section class="signin"><div class="signin-card">${logo}<div class="card"><form data-form="email" class="stack" novalidate>
    <h1 style="font-size:1.25rem">Sign in to ${esc(FIRM)}</h1>
    <label class="f" for="si-email">Work email<input id="si-email" name="email" type="email" autocomplete="off" placeholder="roelof.demo@example.test" value="${esc(S.authEmail)}"></label>
    <label class="f" for="si-role">See the preview as<select id="si-role" name="role">${ROLES.map((r) => `<option${r === S.role ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
    <p class="hint">Simulation only. Use aidan.demo@example.test, johan.demo@example.test or roelof.demo@example.test, then code 123456. No password or real authenticator is needed. You can switch role in the header. Clients never sign in here: they act through the PaperSync portal.</p>
    <p class="err" id="si-err" role="alert"></p>
    <button class="btn primary" type="submit">Continue</button>
  </form></div></div></section>`;
}

/* ===================== People and Account ===================== */
function viewPeople() {
  const lock = LOCK.people();
  return `<div class="stack">
    <div class="pagehead" data-rv-key="people-head"><div class="stack" style="gap:6px"><h1>People &amp; roles</h1><p class="muted">Members of ${esc(FIRM)} and the role each holds. Roles are firm-neutral. Administrators invite people, change roles and revoke access. Clients act only through the PaperSync portal.</p></div></div>
    <div class="tablewrap" data-rv-key="people-table"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Simulated two-step sign-in</th><th>Last active</th><th></th></tr></thead><tbody>
    ${S.people.map((p) => `<tr><td><strong>${esc(p.name)}</strong>${p.note ? `<br><span class="small muted">${esc(p.note)}</span>` : ''}${p.id === me().id ? ' <span class="pill">You</span>' : ''}</td><td class="mono small">${esc(p.email)}</td><td>${lock || p.id === me().id ? esc(p.role) : `<select id="pr-${p.id}" data-on="personRole" data-id="${p.id}" aria-label="Role for ${esc(p.name)}">${ROLES.map((r) => `<option${p.role === r ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select>`}</td><td>${p.mfa === 'On' ? '<span class="pill ok">On</span>' : '<span class="pill warn">Not set up</span>'}</td><td class="small">${esc(p.last)}</td><td>${p.id === me().id ? '' : btn('Revoke', 'revoke', { cls: 'sm danger', data: { id: p.id }, lock })}</td></tr>`).join('')}
    </tbody></table></div>
    ${typeof peopleExtra === 'function' ? peopleExtra() : ''}
    <div class="grid2" data-rv-key="people-invites">
      <section class="card stack" style="gap:10px" data-rv-key="people-invite"><h2>Invite someone</h2>
        <form data-form="invite" class="stack" style="gap:10px" novalidate>
          <label class="f" for="inv-email">Email<input id="inv-email" name="email" type="email" placeholder="partner.demo@example.test"${lock ? ' disabled' : ''}></label>
          <label class="f" for="inv-role">Role<select id="inv-role" name="role"${lock ? ' disabled' : ''}>${ROLES.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
          <p class="err" id="inv-err" role="alert"></p>
          <div>${lock ? btn('Create invite link', '', { lock }) : '<button class="btn primary" type="submit">Create invite link</button>'}</div>
        </form>
        ${S.lastInvite ? `<div class="well stack" style="gap:8px"><p><strong>One-time link for ${esc(S.lastInvite.email)}</strong>. It is shown once and expires in 72 hours. Send it yourself; Operon does not email it in the demo.</p><input id="inv-link" readonly value="${esc(S.lastInvite.link)}" class="mono" aria-label="Invite link"><div>${btn('Copy link', 'copy', { cls: 'sm', data: { src: 'inv-link' } })}</div></div>` : ''}
      </section>
      <section class="card stack" style="gap:10px" data-rv-key="people-pending"><h2>Pending invites</h2>${S.invites.length ? `<ul class="plain">${S.invites.map((v) => `<li class="row between"><span>${esc(v.email)} <span class="small muted">${esc(v.role)} · expires ${esc(v.expires)}</span></span>${btn('Revoke', 'revokeInvite', { cls: 'sm', data: { id: v.id }, lock })}</li>`).join('')}</ul>` : '<p class="muted">No pending invites.</p>'}</section>
    </div>
  </div>`;
}
function viewAccount() {
  const m = me(); const theme = LS.get('op-demo-theme') || 'system';
  return `<div class="stack" style="max-width:760px">
    <h1>Account</h1>
    <section class="card" data-rv-key="account-facts"><dl class="facts"><dt>Name</dt><dd>${esc(m.name)}</dd><dt>Email</dt><dd class="mono">${esc(m.email)}</dd><dt>Role</dt><dd>${esc(S.role)} (switch in the header for the demo)</dd><dt>Firm</dt><dd>${esc(FIRM)}</dd></dl></section>
    <section class="card stack" style="gap:10px" data-rv-key="account-mfa"><h2>Simulated two-step sign-in</h2><p><span class="pill ok">On</span> Preview only · no real MFA is configured here.</p>
      <p class="note">Backup codes: 8 of 10 unused. Each code works once. Keep them somewhere safe, away from your phone. Making new codes cancels the old ones.</p>
      <div>${btn('Make new backup codes', 'backupCodes')}</div></section>
    <section class="card stack" style="gap:10px" data-rv-key="account-theme"><h2>Appearance</h2><div class="seg" role="group" aria-label="Theme">${['system', 'light', 'dark'].map((t) => `<button type="button" data-act="theme" data-v="${t}" aria-pressed="${theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></section>
    <section class="card stack" style="gap:10px" data-rv-key="account-demo"><h2>Demo</h2><p class="small muted">Demo work lives only in this browser tab and resets on reload. Reset puts the made-up cases back to the start and keeps your review notes.</p><div class="actions">${btn('Reset the demo data', 'reset')}${btn('Sign out', 'signOut', { cls: 'danger' })}</div></section>
  </div>`;
}

/* ===================== Feedback joins the synced review store (src/sync.js, src/review.js) ===================== */
const CAP = { db: true, uid: 'this-browser', owner: true };
async function lightUp() {
  S.fb = REVIEW.feedbackList(); S.fbState = 'ready';
  if (routeOf().name === 'feedback') render(); else renderHeader();
}
async function saveFeedback(item) {
  REVIEW.saveFeedback(item);
  S.fb = REVIEW.feedbackList(); S.fbState = 'ready';
}

/* ===================== Dialog, toasts, step-up ===================== */
let dlgReturn = null;
function modal(title, body, submitLabel, onSubmit, opts) {
  opts = opts || {};
  const d = $('#dlg');
  if (!d.open) dlgReturn = document.activeElement;
  d.innerHTML = `<form id="dlg-form" novalidate><div class="dlg-h"><h2 id="dlg-title">${esc(title)}</h2><button type="button" class="btn ghost sm" data-close>Close</button></div><div class="dlg-b">${body}<p class="err" id="dlg-err" role="alert"></p></div><div class="dlg-f">${opts.extra || ''}<button type="button" class="btn" data-close>${esc(opts.cancelLabel || (submitLabel ? 'Cancel' : 'Close'))}</button>${submitLabel ? `<button type="submit" class="btn ${opts.danger ? 'danger' : 'primary'}" id="dlg-ok">${esc(submitLabel)}</button>` : ''}</div></form>`;
  const f = $('#dlg-form');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!onSubmit) return;
    const fd = {}; new FormData(f).forEach((v, k) => { fd[k] = v; });
    let res;
    try { res = onSubmit(fd, f, ev.submitter); } catch (err) { res = 'Something went wrong: ' + err.message; }
    if (res && typeof res.then === 'function') {
      const ok = $('#dlg-ok'); if (ok) { ok.disabled = true; ok.textContent = 'Saving…'; }
      try { res = await res; } catch (err) { res = (err && err.message) || 'Could not save.'; }
      if (ok) { ok.disabled = false; ok.textContent = submitLabel; }
    }
    if (typeof res === 'string') { $('#dlg-err').textContent = res; return; }
    closeDialog();
    if (typeof res === 'function') setTimeout(res, 0);
  });
  $$('[data-close]', d).forEach((b) => b.addEventListener('click', closeDialog));
  if (opts.onOpen) opts.onOpen(f);
  if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } }
  const first = f.querySelector('.dlg-b input:not([type="hidden"]):not([readonly]):not([disabled]), .dlg-b select, .dlg-b textarea:not([readonly])');
  (first || f.querySelector('[data-close]')).focus();
}
function closeDialog() {
  const d = $('#dlg');
  if (d.open) { try { d.close(); } catch (e) { d.removeAttribute('open'); } }
  d.innerHTML = '';
  if (dlgReturn && document.body.contains(dlgReturn)) { try { dlgReturn.focus(); } catch (e) { /* ignore */ } }
  dlgReturn = null;
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 4500);
}
function stepUp(why, then) {
  if (Date.now() < S.stepUpUntil) { then(); return; }
  modal('Confirm it’s you', `<p>${esc(why)}</p>
    <label class="f" for="su-pw">Password<input id="su-pw" name="pw" type="password" autocomplete="off"></label>
    <label class="f" for="su-code">Simulated code · enter 123456<input id="su-code" name="code" inputmode="numeric" maxlength="6" class="code" autocomplete="off"></label>
    <p class="hint">Demo: any password and any 6 digits work. You won’t be asked again for 5 minutes.</p>`, 'Confirm', (fd) => {
    if (!String(fd.pw || '').length) return 'Enter your password. Any password works in the demo.';
    if (!/^\d{6}$/.test(String(fd.code || '').trim())) return 'Enter the 6-digit code. Any 6 digits work in the demo.';
    S.stepUpUntil = Date.now() + 5 * 60000;
    addAudit({ text: 'Confirmed identity with password and code (step-up)', result: 'Done' });
    return then;
  });
}
function reasonField(id, label, chips) {
  return `<fieldset style="border:0;padding:0;margin:0" class="stack"><legend class="small muted" style="margin-bottom:6px">${esc(label)}</legend>${chips ? `<div class="chips">${chips.map((c, i) => `<label><input type="radio" name="chip" value="${esc(c)}"${i === 0 ? ' checked' : ''}> ${esc(c)}</label>`).join('')}</div>` : ''}
    <label class="f" for="${id}">${chips ? 'Details (optional)' : 'Reason (required)'}<textarea id="${id}" name="reason"></textarea></label></fieldset>`;
}
const reasonOf = (fd, chips) => { const r = String(fd.reason || '').trim(); return chips ? (fd.chip || '') + (r ? ': ' + r : '') : r; };

/* ===================== Audit trail (append-only and hash-chained; the master document's Phase 20 fields) ===================== */
// actor is human, system or ai. The client (through the portal) and the simulated platform team are human actors.
const AUDIT_FIELDS = ['id', 'at', 'actor', 'who', 'role', 'text', 'result', 'caseId', 'client', 'gate', 'code', 'exceptionId',
  'before', 'after', 'version', 'sarsRef', 'evidence', 'reason', 'doc', 'sarsTx', 'owner', 'severity', 'resolution', 'prev', 'hash'];
const auditHash = (a) => sha256(a.prev + '|' + JSON.stringify(AUDIT_FIELDS.slice(0, -2).map((k) => (a[k] instanceof Date ? a[k].toISOString() : a[k]))));
// The newest entry's hash and the entry count, kept outside S, so the engine's verifyChain also notices a truncated or replaced trail.
const AUDIT_SEAL = (() => { let n = 0; let h = '0'.repeat(64); return { note(a) { n += 1; h = a.hash; }, reset() { n = 0; h = '0'.repeat(64); }, get: () => ({ n, hash: h }) }; })();
function addAudit(o) {
  S.auditN = (S.auditN || 5000) + 1;
  const prev = S.audit.length ? S.audit[S.audit.length - 1].hash : '0'.repeat(64);
  const actor = o.actor || 'human';
  const m = actor === 'human' && S.signedIn ? me() : null;
  const a = Object.assign({ id: 'E' + S.auditN, at: now(), actor, who: m ? m.id : (actor === 'ai' ? 'Operon AI' : 'Operon'), role: m ? S.role : null,
    text: '', result: 'Done', caseId: null, client: null, gate: null, code: null, exceptionId: null, before: null, after: null,
    version: null, sarsRef: null, evidence: '', reason: '', doc: null, sarsTx: null, owner: null, severity: null, resolution: null }, o, { prev });
  a.hash = auditHash(a);
  S.audit.push(Object.freeze(a));
  AUDIT_SEAL.note(a);
  return a;
}
function schedule(ms, fn) { S.timers.push({ at: Date.now() + ms, fn }); }

/* ===================== Actions ===================== */
const ACT = {
  feedback: () => openFeedback(),
  authBack: () => { S.authStep = 'email'; render(); },
  go: (t, e) => { if (e.target.closest('a,button,input,select,textarea,label')) return; location.hash = t.dataset.href; },
  demoOnly: (t) => toast(t.dataset.msg),
  copyPreviewLink: () => {
    const link = location.origin + location.pathname;
    navigator.clipboard.writeText(link).then(() => toast('Preview link copied. Share it with the partners.'), () => modal('Share this preview', '<p class="mono">' + esc(link) + '</p>', null, null));
  },
  kill: () => {
    modal('Pause all AI work', '<p>Every AI step stops straight away. Nothing queued runs until AI work is resumed. Gates already released stay released; nothing is undone.</p><label class="f" for="kill-t">Type PAUSE to confirm<input id="kill-t" name="t" autocomplete="off"></label>', 'Pause all AI work', (fd) => {
      if (String(fd.t || '').trim() !== 'PAUSE') return 'Type PAUSE in capitals to confirm.';
      S.paused = { by: me().id, at: now() };
      addAudit({ text: 'Paused all AI work (kill switch)', result: 'Done' });
      toast('All AI work paused. Nothing will run until it is resumed.'); return () => render();
    }, { danger: true });
  },
  resume: () => stepUp('Resuming lets AI work run again.', () => { S.paused = null; addAudit({ text: 'Resumed all AI work', result: 'Done' }); toast('AI work resumed.'); render(); }),
  copy: (t) => {
    const el = document.getElementById(t.dataset.src); if (!el) return;
    const text = el.value;
    const fallback = () => { el.classList.remove('sr'); el.removeAttribute('aria-hidden'); el.focus(); el.select(); toast('Press Ctrl+C or Cmd+C to copy the selected text.'); };
    try { navigator.clipboard.writeText(text).then(() => toast('Copied.'), fallback); } catch (e) { fallback(); }
  },
  revoke: (t) => {
    if (LOCK.people()) return;
    const p = person(t.dataset.id);
    modal('Revoke access', `<p>Revoke access for <strong>${esc(p.name)}</strong>? They are signed out straight away. Gates they own stay with their role.</p>`, 'Revoke access', () => {
      return () => stepUp('Revoking access is a scope change.', () => { S.people = S.people.filter((x) => x.id !== p.id); addAudit({ text: 'Revoked access for ' + p.name, result: 'Done' }); toast('Access revoked for ' + p.name + '.'); render(); });
    }, { danger: true });
  },
  revokeInvite: (t) => { if (LOCK.people()) return; const v = S.invites.find((x) => x.id === t.dataset.id); S.invites = S.invites.filter((x) => x !== v); if (S.lastInvite && S.lastInvite.id === v.id) S.lastInvite = null; addAudit({ text: 'Revoked the invite for ' + v.email, result: 'Done' }); toast('Invite revoked. The link no longer works.'); render(); },
  backupCodes: () => stepUp('Making new backup codes cancels the old ones.', () => {
    const codes = Array.from({ length: 10 }, () => String(Math.floor(1000 + Math.random() * 9000)) + '-' + String(Math.floor(1000 + Math.random() * 9000)));
    addAudit({ text: 'Made new backup codes', result: 'Done' });
    modal('New backup codes', `<p class="note">Demo codes, not real ones. In the real app they are shown once, here.</p><textarea id="bc-text" readonly class="mono" style="min-height:200px">${codes.join('\n')}</textarea>`, null, null, { extra: `<button type="button" class="btn" data-act="copy" data-src="bc-text">Copy codes</button>` });
  }),
  theme: (t) => { LS.set('op-demo-theme', t.dataset.v); applyTheme(); render(); },
  reset: () => modal('Reset the demo data', '<p>Put every case, exception, gate and audit entry back to the start? Your review notes and layouts are kept.</p>', 'Reset', () => {
    const keep = { fb: S.fb, fbNames: S.fbNames, fbState: S.fbState, role: S.role };
    seed(); Object.assign(S, keep); S.signedIn = true; toast('Demo data reset.'); return () => render();
  }),
  signOut: () => { S.signedIn = false; S.authStep = 'email'; LS.del('op-demo-in'); closeDialog(); if (location.hash) location.hash = ''; render(); },
};

/* ===================== Feedback ===================== */
const PAGE_NAMES = { today: 'Today', cases: 'Cases', case: 'Case page', approvals: 'Approvals', exceptions: 'Exceptions', exception: 'Exception',
  clients: 'Clients', client: 'Client file', papersync: 'PaperSync', portal: 'PaperSync portal', sars: 'SARS link', deadlines: 'Deadlines',
  controls: 'Controls', incidents: 'Incidents', incident: 'Incident', retention: 'Retention', audit: 'Audit trail', try: 'Try it',
  import: 'Import clients', people: 'People & roles', account: 'Account', feedback: 'Review notes', idea: 'Suggested page' };
function openFeedback() {
  const r = routeOf();
  const page = S.signedIn ? (PAGE_NAMES[r.name] || r.name) + ' (#' + ((location.hash || '#today').slice(1) || 'today') + ')' : 'Sign-in';
  const canSave = !!(CAP.db && CAP.uid);
  const cats = ['Bug', 'Idea', 'Confusing', 'Other'];
  modal('Feedback on the demo', `
    <fieldset style="border:0;padding:0;margin:0"><legend class="small muted" style="margin-bottom:6px">Type</legend><div class="chips">${cats.map((c, i) => `<label><input type="radio" name="category" value="${c}"${i === 0 ? ' checked' : ''}> ${c}</label>`).join('')}</div></fieldset>
    <label class="f" for="fb-text">What happened, or what would help?<textarea id="fb-text" name="text" placeholder="Be as specific as you like"></textarea></label>
    <p class="small muted">Page: ${esc(page)} (added automatically)</p>
    ${canSave ? '<p class="hint">Shared with Aidan and the partners when this browser has the review link. Don’t include real client details.</p>' : '<p class="note">Saving is not available here (you are signed out or this is a local preview). Use Copy feedback and send it to Aidan.</p>'}
    <textarea id="fb-copy" class="sr" readonly aria-hidden="true" tabindex="-1"></textarea>`,
  canSave ? 'Save feedback' : null,
  canSave ? (fd) => {
    const text = String(fd.text || '').trim(); if (text.length < 3) return 'Write a few words first.';
    const item = { id: uid('fb') + Date.now().toString(36), category: fd.category || 'Other', text: text.slice(0, 4000), page, at: new Date().toISOString() };
    return saveFeedback(item).then(() => { toast('Saved. It syncs to Aidan when this browser has the review link.'); return true; }, (e) => {
      const code = e && e.code;
      if (code === 'invalid_argument') return 'Your access to this page can’t save feedback. Use Copy feedback and send it to Aidan.';
      if (code === 'quota_exceeded') return 'Feedback storage is full. Use Copy feedback and send it to Aidan.';
      return 'Couldn’t save on this device. Try again, or use Copy feedback.';
    });
  } : null,
  { extra: `<button type="button" class="btn" id="fb-copy-btn">Copy feedback</button>`, onOpen: (f) => {
    $('#fb-copy-btn').addEventListener('click', () => {
      const fdc = new FormData(f); const text = String(fdc.get('text') || '').trim();
      if (!text) { $('#dlg-err').textContent = 'Write a few words first.'; return; }
      const body = `Operon demo feedback\nType: ${fdc.get('category')}\nPage: ${page}\nWhen: ${new Date().toLocaleString('en-ZA')}\n\n${text}`;
      const ta = $('#fb-copy'); ta.value = body;
      const fallback = () => { ta.classList.remove('sr'); ta.removeAttribute('aria-hidden'); ta.style.minHeight = '140px'; ta.focus(); ta.select(); $('#dlg-err').textContent = 'Copying is blocked here. The text is selected: press Ctrl+C or Cmd+C, then send it to Aidan.'; };
      try { navigator.clipboard.writeText(body).then(() => { toast('Copied. Paste it into a message to Aidan.'); }, fallback); } catch (e) { fallback(); }
    });
  } });
}

/* ===================== Forms on pages ===================== */
const FORMS = {
  email: (f) => {
    const email = f.elements.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('#si-err').textContent = 'Enter an email address. Any address works in the demo.'; return; }
    S.authEmail = email; S.role = ROLES.includes(f.elements.role.value) ? f.elements.role.value : ROLES[0]; LS.set('op-demo-role', S.role); S.authStep = 'code'; render(); const c = $('#si-code'); if (c) c.focus();
  },
  code: (f) => {
    const code = f.elements.code.value.trim();
    if (!/^\d{6}$/.test(code)) { $('#si-err').textContent = 'Enter 6 digits. Any 6 digits work in the demo.'; return; }
    S.signedIn = true; LS.set('op-demo-in', '1');
    addAudit({ text: 'Signed in with simulated two-step sign-in', result: 'Done' });
    if (location.hash !== '#today') location.hash = '#today';
    render(); toast(`Signed in as ${me().name} (${S.role}). Everything here is made up.`);
  },
  invite: (f) => {
    if (LOCK.people()) return;
    const email = f.elements.email.value.trim(); const role = f.elements.role.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('#inv-err').textContent = 'Enter an email address.'; return; }
    if (!ROLES.includes(role)) { $('#inv-err').textContent = 'Pick a role.'; return; }
    if (S.people.some((p) => p.email.toLowerCase() === email.toLowerCase())) { $('#inv-err').textContent = 'That person is already a member.'; return; }
    if (S.invites.some((v) => v.email.toLowerCase() === email.toLowerCase())) { $('#inv-err').textContent = 'That email already has a pending invite. Revoke it first to send a new link.'; return; }
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let tok = ''; for (let i = 0; i < 24; i++) tok += abc[Math.floor(Math.random() * abc.length)];
    const v = { id: uid('inv'), email, role, expires: fShort(day(3)) + ' ' + fTime(now()), link: 'SIMULATED-INVITE-NOT-A-LOGIN:' + tok };
    S.invites.push(v); S.lastInvite = v;
    addAudit({ text: `Invited ${email} as ${role}`, result: 'Done' });
    S.noRestore = true; toast('Simulated invite created. It does not grant access. Use Copy preview link to share this preview.'); render();
  },
};

/* ===================== Render and events ===================== */
function applyTheme() {
  const t = LS.get('op-demo-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else if (t === 'system') document.documentElement.removeAttribute('data-theme');
}
function viewPlaceholder(name) {
  return `<div class="stack"><div class="pagehead" data-rv-key="placeholder-head"><div class="stack" style="gap:6px"><h1>${esc(PAGE_NAMES[name] || name)}</h1><p class="muted">This screen is being rebuilt around the ITR12 workflow.</p></div></div></div>`;
}
function viewFor(r) {
  switch (r.name) {
    case 'people': return viewPeople();
    case 'account': return viewAccount();
    case 'feedback': return viewReviewInbox();
    case 'idea': return viewIdeaPage(r.id);
    default: {
      const v = VIEWS[r.name];
      return v ? v(r.id) : viewPlaceholder(r.name);
    }
  }
}
let lastKey = '';
function render() {
  if (REVIEW.busy()) { REVIEW.pending = true; return; }
  const app = $('#app');
  const key = (location.hash || '#today') + '|' + S.signedIn + '|' + S.authStep;
  const same = key === lastKey;
  const ae = document.activeElement;
  const focusId = same && ae && ae.id && app.contains(ae) ? ae.id : null;
  let sel = null;
  try { if (focusId && typeof ae.selectionStart === 'number') sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) { sel = null; }
  const vals = {};
  if (same && !S.noRestore) {
    $$('input[id],textarea[id],select[id]', app).forEach((el) => {
      if (el.dataset.on || el.dataset.act || el.type === 'file') return;
      vals[el.id] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
    });
  }
  S.noRestore = false;
  renderHeader();
  app.innerHTML = S.signedIn ? viewFor(routeOf()) : viewSignIn();
  Object.keys(vals).forEach((id) => {
    const el = document.getElementById(id); if (!el || !app.contains(el) || el.dataset.on || el.dataset.act) return;
    if (typeof vals[id] === 'boolean') el.checked = vals[id]; else el.value = vals[id];
  });
  if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus({ preventScroll: true }); if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text input */ } } } }
  lastKey = key;
  afterRender();
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t || t.disabled) return;
  const fn = ACT[t.dataset.act];
  if (fn) fn(t, e);
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[data-act]')) { e.preventDefault(); e.target.click(); }
});
function onField(el) {
  const on = el.dataset.on;
  switch (on) {
    case 'role':
      if (!ROLES.includes(el.value)) return;
      S.role = el.value; LS.set('op-demo-role', S.role);
      toast(`Now viewing as ${S.role} (${me().name}). Locked controls say why.`); break;
    case 'personRole': {
      if (LOCK.people()) return;
      const p = person(el.dataset.id); const to = el.value; const from = p.role;
      render();
      if (to === from || !ROLES.includes(to)) return;
      stepUp('Changing a role changes what someone can do.', () => { p.role = to; addAudit({ text: `Changed ${p.name}’s role from ${from} to ${to}`, before: from, after: to, result: 'Done' }); toast(`${p.name} is now ${to}.`); render(); });
      return;
    }
    default: if (EXT_FIELD[on]) { if (EXT_FIELD[on](el) === false) return; break; } return;
  }
  render();
}
document.addEventListener('input', (e) => { const el = e.target; if (el.dataset && el.dataset.on && el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'file') onField(el); });
document.addEventListener('change', (e) => { const el = e.target; if (el.dataset && el.dataset.on && (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'file' || el.type === 'radio')) onField(el); });
document.addEventListener('submit', (e) => { const f = e.target; if (!f.dataset || !f.dataset.form) return; e.preventDefault(); if (FORMS[f.dataset.form]) FORMS[f.dataset.form](f); });
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); const h = $('#app h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } });
$('#dlg').addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(); });
try { window.matchMedia('(max-width: 760px)').addEventListener('change', () => render()); } catch (e) { /* older browsers */ }
// Keep sticky rails just below the sticky header, whatever height the header wraps to.
try {
  const topEl = $('#top'); const setTopH = () => document.documentElement.style.setProperty('--top-h', topEl.offsetHeight + 'px');
  setTopH(); if (window.ResizeObserver) new ResizeObserver(setTopH).observe(topEl);
} catch (e) { /* the 140px fallback in CSS applies */ }

function tick() {
  let changed = false;
  const due = S.timers.filter((x) => x.at <= Date.now());
  if (due.length) {
    S.timers = S.timers.filter((x) => x.at > Date.now());
    due.forEach((x) => { if (S.paused && x.ai) { x.at = Date.now() + 3000; S.timers.push(x); } else { x.fn(); changed = true; } });
  }
  for (const f of TICKERS) { try { if (f()) changed = true; } catch (e) { /* a ticker never stops the clock */ } }
  if (changed) render();
}
