/* Review layer: a note on every section, Wix-style arranging per page, a layout viewer and the Review notes inbox.
   Uses app globals (S, $, $$, esc, modal, closeDialog, toast, routeOf, render, PAGE_NAMES, initials, isPhone) and SYNC.
   Security: every stored or synced string (notes, names, added blocks, text edits, page titles) is rendered with esc()
   or textContent. Stored data never becomes an href, src, style or event attribute; ids are validated before use. */

const RV = {
  inited: false, on: false, arranging: false, picking: false, dragging: false, touch: false,
  rk: '', sel: null, hot: null, editing: null, jump: null,
  blocks: new Map(), meta: new Map(), zones: new Map(), zoneKeyOf: new Map(), orig: Object.create(null),
  sortables: [], undo: Object.create(null), orphans: new Set(), added: new WeakMap(),
  dw: null, menu: false, navOrig: [], viewOwner: null, layout: null, inF: { person: 'all', page: '', type: '', status: '' },
};
const RV_TYPES = [['change', 'Change'], ['better', 'Do it better'], ['missing', 'Missing'], ['bug', 'Bug'], ['love', 'Love it']];
const RV_STATUS = [['open', 'Open'], ['planned', 'Planned'], ['done', 'Done'], ['wontdo', 'Won’t do']];
const RV_PRIO = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
const RV_BLOCKS = [['text', 'Text', 'A heading and a few lines of text.'], ['checklist', 'Checklist', 'One item per line.'], ['table', 'Table', 'One row per line. Separate columns with | (the first line is the header).'], ['chart', 'Chart placeholder', 'Say what the chart should show.'], ['button', 'Button', 'The title is the button label. Say what it should do.'], ['want', 'I want X here', 'Describe what you want in this spot.']];
const RV_BLOCK_SEL = 'section, .card, .pagehead, .tablewrap, aside, p.allclear, .status, nav.crumbs';
const RV_ZONE_SEL = '.stack, .grid2, .rail, .trays, .board, [data-rv-zone]';
const RV_NO_ZONE_IN = '.card, form, table, .jobcard, .pagehead, .status, .allclear, .crumbs, .tablewrap, dialog, [data-rv-ui]';
const RV_STRUCT = { pagehead: 'Page heading', crumbs: 'Breadcrumb', status: 'Status message', allclear: 'All-clear message', detail: 'Detail panel', batchbar: 'Batch sign-off bar', stagebar: 'Stage bar', filters: 'Filters', going: 'Going out soon', trays: 'Trays', rail: 'Tray rail', board: 'Board', split: 'List and detail', trygrid: 'Try-it cards', 'tray-list': 'Tray list' };
const RV_PICK_SNAP = 'a, button, label, th, td, li, dt, dd, h1, h2, h3, h4, p, .pill, .tier, .wait, .state, .tray, .jobcard, .count, input, select, textarea';

/* ---------- small helpers ---------- */
const rvClean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n || 80);
const rvMulti = (s, n) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, n || 4000);
function rvSlug(s, words) {
  const w = String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z]+/g, ' ').trim().split(' ').filter(Boolean);
  return w.slice(0, words || 5).join('-').slice(0, 48);
}
const rvSafeKey = (k) => String(k || '').replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 60);
const rvHashOk = (h) => typeof h === 'string' && /^#[A-Za-z0-9\-]{1,60}$/.test(h);
const rvIsTouch = () => { try { return window.matchMedia('(hover: none) and (pointer: coarse)').matches; } catch (e) { return false; } };
function rvText(el, max) {
  let out = ''; const lim = max || 200;
  const walk = (n) => {
    if (out.length > lim * 2) return;
    if (n.nodeType === 3) { out += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    if (n.hasAttribute('data-rv-ui') || /^(SCRIPT|STYLE|TEMPLATE|SELECT)$/.test(n.tagName) || n.namespaceURI === 'http://www.w3.org/2000/svg') return;
    for (const c of n.childNodes) walk(c);
  };
  if (el) walk(el);
  return rvClean(out, lim);
}
function rvHeading(el) {
  for (const h of el.querySelectorAll('h1, h2, h3, h4')) { if (!h.closest('[data-rv-ui]')) { const t = rvText(h, 90); if (t) return t; } }
  return '';
}
function rvPageName(rk) {
  if (!rk) return 'Page';
  if (rk === '_app') return 'Header and menu';
  if (rk.indexOf('idea-') === 0) { const pg = rvPage(rk.slice(5)); return pg ? 'Suggested page: ' + rvClean(pg.data.title, 80) : 'Suggested page'; }
  return (typeof PAGE_NAMES !== 'undefined' && Object.prototype.hasOwnProperty.call(PAGE_NAMES, rk) && typeof PAGE_NAMES[rk] === 'string' && PAGE_NAMES[rk]) || (rk[0].toUpperCase() + rk.slice(1));
}
function rvRouteKey() { const r = routeOf(); return r.name === 'idea' ? 'idea-' + r.id : r.name; }
function rvNameFromEmail(e) {
  const local = String(e || '').split('@')[0] || '';
  const part = local.split(/[._\-+]/).filter((p) => p && !/^(demo|test|preview)$/i.test(p))[0] || '';
  return /^[A-Za-z]{2,30}$/.test(part) ? part[0].toUpperCase() + part.slice(1).toLowerCase() : '';
}
function rvInit(name) { return initials(String(name || '?').trim() || '?') || '?'; }
function rvWhen(iso) {
  const d = iso ? new Date(SYNC.tsKey(iso) / 1000 || Date.parse(iso)) : null;
  if (!d || isNaN(d.getTime())) return '';
  const n = new Date(); const sameDay = d.toDateString() === n.toDateString();
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return sameDay ? hm : d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + hm;
}
function rvPage(id) {
  if (!/^[A-Za-z0-9]{4,40}$/.test(String(id || ''))) return null;
  const it = SYNC.get('pg_' + id);
  return it && !it.deleted && it.kind === 'page' ? it : null;
}
function rvPages() {
  return SYNC.list('page').filter((p) => /^pg_[A-Za-z0-9]{4,40}$/.test(p.id)).sort((a, b) => SYNC.created(a).localeCompare(SYNC.created(b)));
}
function rvNotes(rk) {
  return SYNC.list('note').filter((n) => !n.data.parent && (rk == null || n.route === rk));
}
function rvReplies(noteId) {
  return SYNC.list('note').filter((n) => n.data.parent === noteId).sort((a, b) => SYNC.created(a).localeCompare(SYNC.created(b)));
}
// Latest status per note (one status item per setter; the newest wins). Indexed once per store change.
function rvStatusOf(noteId) {
  if (!RV.stIdx) {
    RV.stIdx = new Map();
    for (const s of SYNC.list('status')) {
      if (typeof s.data.note !== 'string' || s.id !== 'st:' + s.data.note + ':' + s.reviewer || !RV_STATUS.some((x) => x[0] === s.data.status)) continue;
      const cur = RV.stIdx.get(s.data.note);
      if (!cur || SYNC.recency(s) > SYNC.recency(cur)) RV.stIdx.set(s.data.note, s);
    }
  }
  const best = RV.stIdx.get(noteId);
  return best ? { status: best.data.status, by: best.reviewer, at: SYNC.shown(best) } : { status: 'open', by: null, at: '' };
}
const rvLabelOf = (list, k) => { const x = list.find((e) => e[0] === k); return x ? x[1] : k; };
function rvPersonOk(it, who) {
  const p = who || SYNC.pref('person') || 'all';
  if (p === 'all') return true;
  if (p === 'mine') return it.reviewer === SYNC.me().id;
  return it.reviewer === p;
}
function rvPeople() {
  const ids = new Set(); for (const it of SYNC.all()) if (!it.deleted && it.reviewer) ids.add(it.reviewer);
  ids.delete(SYNC.me().id);
  return Array.from(ids).map((id) => ({ id, name: SYNC.name(id) })).sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- zones, blocks and stable keys ---------- */
function rvTitled(el) {
  const f = el.firstElementChild; if (!f) return false;
  if (/^H[1-4]$/.test(f.tagName)) return true;
  return !!(f.matches('.row, div') && f.querySelector(':scope > h1, :scope > h2, :scope > h3'));
}
function rvBaseKey(el, isZone) {
  const own = el.getAttribute('data-rv-key'); if (own) return rvSafeKey(own) || 'block';
  for (const c of el.classList) if (RV_STRUCT[c]) return c;
  const al = el.getAttribute('aria-label'); if (al) { const s = rvSlug(al); if (s) return s; }
  const h = rvHeading(el);
  if (isZone) return h ? 'group-' + rvSlug(h, 4) : 'group';
  if (h) return rvSlug(h) || 'block';
  const s = rvSlug(rvFirstWords(el), 4);
  return s || el.tagName.toLowerCase();
}
// Text of the first element that holds its own text (a tray's name, not its changing count and total).
function rvFirstWords(el) {
  if (rvOwnText(el)) return rvText(el, 60);
  for (const c of el.querySelectorAll('*')) { if (!c.closest('[data-rv-ui]') && c.namespaceURI !== 'http://www.w3.org/2000/svg' && rvOwnText(c)) return rvText(c, 60); }
  return rvText(el, 60);
}
function rvLabel(el) {
  for (const c of el.classList) if (RV_STRUCT[c]) return RV_STRUCT[c];
  const h = rvHeading(el); if (h) return h;
  const al = el.getAttribute('aria-label'); if (al) return rvClean(al, 80);
  return rvClean(rvFirstWords(el), 50) || el.tagName.toLowerCase();
}
function rvScan(app) {
  RV.blocks = new Map(); RV.meta = new Map(); RV.zones = new Map(); RV.zoneKeyOf = new Map(); RV.orig = Object.create(null);
  const zones = [];
  for (const z of app.querySelectorAll(RV_ZONE_SEL)) {
    if (z.closest('[data-rv-ui]') || z.matches('.card, form, table, .jobcard')) continue;
    const p = z.parentElement && z.parentElement.closest(RV_NO_ZONE_IN);
    if (p && app.contains(p)) continue;
    if (!z.matches('.grid2, .rail, .trays, .board, [data-rv-zone]') && z.matches('section, aside') && rvTitled(z)) continue;
    zones.push(z);
  }
  const zoneSet = new Set(zones);
  const cand = new Set();
  for (const b of app.querySelectorAll(RV_BLOCK_SEL)) {
    if (b.closest('[data-rv-ui]')) continue;
    const up = b.parentElement && b.parentElement.closest(RV_BLOCK_SEL);
    if (up && app.contains(up)) continue;
    cand.add(b);
  }
  for (const z of zones) for (const c of z.children) if (!c.hasAttribute('data-rv-ui') && !/^(SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName)) cand.add(c);
  const list = Array.from(cand).sort((a, b) => (a === b ? 0 : (a.compareDocumentPosition(b) & 4 ? -1 : 1)));
  const used = Object.create(null);
  for (const el of list) {
    const isZone = zoneSet.has(el);
    let k = rvBaseKey(el, isZone);
    if (used[k]) { used[k]++; k = k + '-' + used[k]; } else used[k] = 1;
    el.setAttribute('data-rv-b', k);
    RV.blocks.set(k, el);
    RV.meta.set(k, { key: k, label: rvLabel(el), isZone, layoutOnly: isZone && el.matches('.grid2, .stack') && !el.matches('.rail, .trays, .board'), zone: null });
  }
  const zused = Object.create(null);
  for (const z of zones) {
    let zk;
    const own = z.getAttribute('data-rv-zone');
    if (own) zk = 'z-' + rvSafeKey(own);
    else if (z.hasAttribute('data-rv-b')) zk = z.getAttribute('data-rv-b');
    else if (z.parentElement === app) zk = 'page';
    else {
      const anc = z.parentElement.closest('[data-rv-b]');
      const cls = ['trays', 'rail', 'board'].find((c) => z.classList.contains(c)) || (z.classList.contains('grid2') ? 'grid' : 'stack');
      zk = (anc && app.contains(anc) ? anc.getAttribute('data-rv-b') : 'page') + '>' + cls;
    }
    if (zused[zk]) { zused[zk]++; zk = zk + '#' + zused[zk]; } else zused[zk] = 1;
    RV.zones.set(zk, z); RV.zoneKeyOf.set(z, zk);
    RV.orig[zk] = [];
    for (const c of z.children) {
      const k = c.getAttribute('data-rv-b');
      if (k) { RV.orig[zk].push(k); RV.meta.get(k).zone = zk; }
    }
  }
}
function rvZoneLabel(zk) {
  if (!zk) return 'the page';
  if (zk === 'page' || zk === 'z-idea') return 'the page';
  if (/^page>stack/.test(zk)) return 'the main column';
  const m = RV.meta.get(zk); if (m) return '“' + m.label + '”';
  return 'another area';
}
function rvChildKeys(z) { return Array.from(z.children).map((c) => c.getAttribute('data-rv-b')).filter(Boolean); }
function rvPathOf(block, el) {
  const parts = [];
  for (let n = el; n && n !== block; n = n.parentElement) {
    const p = n.parentElement; if (!p) return null;
    const kids = Array.from(p.children).filter((c) => !c.hasAttribute('data-rv-ui'));
    parts.unshift(kids.indexOf(n));
  }
  return parts.join('.');
}
function rvResolve(block, path) {
  if (path === '' || path == null) return block;
  let n = block;
  for (const s of String(path).split('.')) {
    const i = +s; if (!n || !(i >= 0)) return null;
    n = Array.from(n.children).filter((c) => !c.hasAttribute('data-rv-ui'))[i] || null;
  }
  return n;
}
function rvOwnText(el) {
  for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
  return false;
}
/* ---------- layouts: one item per reviewer and route type ---------- */
const rvLayoutId = (rid, rk) => 'layout:' + rid + ':' + String(rk).replace(/[^A-Za-z0-9_.\-]/g, '_').slice(0, 70);
const rvDict = () => Object.create(null); // objects keyed by synced strings have no prototype
const rvEmpty = () => ({ v: 1, page: '', zones: rvDict(), base: rvDict(), zl: rvDict(), hidden: [], half: [], full: [], texts: [], added: [], labels: rvDict() });
function rvNormLayout(d) {
  const L = rvEmpty();
  if (!d || typeof d !== 'object') return L;
  const keys = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.length <= 120).slice(0, 400) : []);
  const strMap = (o, n) => { const out = rvDict(); if (o && typeof o === 'object') for (const [k, v] of Object.entries(o).slice(0, 400)) if (typeof v === 'string') out[String(k).slice(0, 120)] = v.slice(0, n || 120); return out; };
  for (const f of ['zones', 'base']) if (d[f] && typeof d[f] === 'object') for (const [z, arr] of Object.entries(d[f]).slice(0, 100)) L[f][String(z).slice(0, 120)] = keys(arr);
  L.hidden = keys(d.hidden); L.half = keys(d.half); L.full = keys(d.full);
  L.labels = strMap(d.labels); L.zl = strMap(d.zl);
  L.page = typeof d.page === 'string' ? d.page.slice(0, 120) : '';
  if (Array.isArray(d.texts)) L.texts = d.texts.filter((t) => t && typeof t.block === 'string' && typeof t.path === 'string' && typeof t.original === 'string' && typeof t.text === 'string')
    .slice(0, 200).map((t) => ({ block: t.block.slice(0, 120), path: t.path.slice(0, 80), original: t.original.slice(0, 600), text: t.text.slice(0, 500) }));
  if (Array.isArray(d.added)) L.added = d.added.filter((a) => a && typeof a.id === 'string' && /^a_[A-Za-z0-9]{4,30}$/.test(a.id)).slice(0, 60)
    .map((a) => ({ id: a.id, type: RV_BLOCKS.some((t) => t[0] === a.type) ? a.type : 'text', title: rvClean(a.title, 120), body: rvMulti(a.body, 2000), zone: typeof a.zone === 'string' ? a.zone.slice(0, 120) : '', after: typeof a.after === 'string' ? a.after.slice(0, 120) : '' }));
  return L;
}
function rvLayoutOf(rid, rk) {
  const it = rid ? SYNC.get(rvLayoutId(rid, rk)) : null;
  return it && !it.deleted && it.kind === 'layout' && it.reviewer === rid ? rvNormLayout(it.data) : null;
}
// Layout items whose id names the reviewer who wrote them (any other row is ignored everywhere).
function rvOwnLayouts() { return SYNC.list('layout').filter((it) => it.id === rvLayoutId(it.reviewer, it.route)); }
const rvIsEmpty = (L) => !L || (!Object.keys(L.zones).length && !L.hidden.length && !L.half.length && !L.full.length && !L.texts.length && !L.added.length);
function rvOthersWithLayout(rk) {
  const me = SYNC.me().id; const out = [];
  for (const it of rvOwnLayouts()) {
    if (it.reviewer === me || it.route !== rk) continue;
    if (!rvIsEmpty(rvNormLayout(it.data))) out.push(it.reviewer);
  }
  return Array.from(new Set(out));
}
// Whose layout is shown on this route: null = the original page.
function rvViewOwner(rk) {
  const me = SYNC.me().id; const v = SYNC.pref('view') || 'mine';
  if (v === 'original') return null;
  if (v !== 'mine') return v;
  if (rk.indexOf('idea-') === 0) { const pg = rvPage(rk.slice(5)); if (pg && pg.reviewer !== me && rvIsEmpty(rvLayoutOf(me, rk))) return pg.reviewer; }
  return me;
}
function rvByteLen(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return s.length * 3; } }
function rvSaveLayout(rk, L, before) {
  L.v = 1; L.page = rvPageName(rk);
  const json = JSON.stringify(L);
  if (rvByteLen(json) > 60000) { toast('This page has too many changes to save. Undo or reset some first.'); return false; }
  const it = rvPut({ id: rvLayoutId(SYNC.me().id, rk), kind: 'layout', route: rk, data: L }, 'This change');
  const stack = RV.undo[rk] || (RV.undo[rk] = []);
  if (it && before != null) { stack.push(before); if (stack.length > 50) stack.shift(); }
  return !!it;
}
// Save an item; when the store refuses it, say so (for example, a row from before ids were checked already uses its id).
function rvPut(o, what) {
  const it = SYNC.put(o);
  if (!it) {
    const cur = SYNC.get(o.id);
    toast(what + ' couldn’t be saved' + (cur && cur.reviewer !== SYNC.me().id ? ': another reviewer’s item is in its place. Tell Aidan.' : '.'));
  }
  return it;
}
function rvRemember(L) {
  const keys = new Set(L.hidden.concat(L.half, L.full, L.texts.map((t) => t.block)));
  for (const arr of Object.values(L.zones)) for (const k of arr) keys.add(k);
  for (const arr of Object.values(L.base)) for (const k of arr) keys.add(k);
  for (const k of keys) { const m = RV.meta.get(k); if (m && !m.added) L.labels[k] = m.label.slice(0, 120); }
  for (const z of Object.keys(L.zones)) L.zl[z] = rvZoneLabel(z).slice(0, 120);
}
// Change my layout for a route (the current one unless given), then re-render so it is re-applied from a fresh DOM.
function rvMutate(fn, routeKey) {
  const rk = routeKey || rvRouteKey();
  SYNC.refresh(); // another tab may have changed this layout a moment ago
  const L = rvLayoutOf(SYNC.me().id, rk) || rvEmpty();
  const before = JSON.stringify(L);
  if (fn(L) === false) return false;
  rvRemember(L);
  if (JSON.stringify(L) === before) { rvFlushPending(); return false; }
  const ok = rvSaveLayout(rk, L, before);
  rvRerender();
  return ok;
}
function rvRerender() {
  if (REVIEW.busy()) { REVIEW.pending = true; return; }
  REVIEW.pending = false;
  try { render(); } catch (e) { console.warn('Review layer: render failed', e); }
}
function rvFlushPending() { if (REVIEW.pending && !REVIEW.busy()) rvRerender(); }
function rvUndo() {
  const rk = rvRouteKey(); const stack = RV.undo[rk] || [];
  if (!stack.length) { toast('Nothing to undo on this page yet.'); return; }
  const prev = stack.pop();
  rvSaveLayout(rk, rvNormLayout(JSON.parse(prev)), null);
  toast('Undone.'); rvRerender();
}
function rvResetPage() {
  const rk = rvRouteKey(); const cur = rvLayoutOf(SYNC.me().id, rk);
  if (rvIsEmpty(cur)) { toast('This page already shows the original layout.'); return; }
  rvSaveLayout(rk, rvEmpty(), JSON.stringify(cur));
  RV.sel = null; toast('This page is back to the original layout. Undo brings your changes back.'); rvRerender();
}

/* ---------- applying a layout to the freshly rendered page ---------- */
function rvMakeAdded(a, owner) {
  const t = RV_BLOCKS.find((x) => x[0] === a.type) || RV_BLOCKS[0];
  const sec = document.createElement('section');
  sec.className = 'card rv-added rv-added-' + t[0];
  sec.setAttribute('data-rv-key', a.id);
  const eb = document.createElement('p'); eb.className = 'eyebrow';
  eb.textContent = 'Suggested ' + t[1].toLowerCase() + (t[0] === 'want' ? '' : ' block') + ' · ' + SYNC.name(owner);
  const h = document.createElement('h2'); h.textContent = a.title || t[1];
  sec.append(eb, h);
  const lines = a.body.split('\n').map((s) => s.trim()).filter(Boolean);
  const para = (txt, cls) => { const p = document.createElement('p'); p.className = cls || 'rv-body'; p.textContent = txt; return p; };
  if (t[0] === 'checklist') {
    const ul = document.createElement('ul'); ul.className = 'checklist';
    (lines.length ? lines : ['First item']).slice(0, 40).forEach((l) => {
      const li = document.createElement('li'); const lab = document.createElement('label');
      const cb = document.createElement('input'); cb.type = 'checkbox';
      const sp = document.createElement('span'); sp.textContent = l;
      lab.append(cb, sp); li.append(lab); ul.append(li);
    });
    sec.append(ul);
  } else if (t[0] === 'table') {
    const rows = (lines.length ? lines : ['Column A | Column B']).slice(0, 25).map((l) => l.split('|').map((c) => c.trim()).slice(0, 8));
    const wrap = document.createElement('div'); wrap.className = 'tablewrap';
    const tb = document.createElement('table'); const thead = document.createElement('thead'); const tbody = document.createElement('tbody');
    const hr = document.createElement('tr'); rows[0].forEach((c) => { const th = document.createElement('th'); th.textContent = c; hr.append(th); }); thead.append(hr);
    rows.slice(1).forEach((r) => { const tr = document.createElement('tr'); r.forEach((c) => { const td = document.createElement('td'); td.textContent = c; tr.append(td); }); tbody.append(tr); });
    tb.append(thead, tbody); wrap.append(tb); sec.append(wrap);
  } else if (t[0] === 'chart') {
    const ch = document.createElement('div'); ch.className = 'rv-chart'; ch.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 7; i++) ch.append(document.createElement('i'));
    sec.append(ch); if (a.body) sec.append(para(a.body, 'small muted rv-body'));
  } else if (t[0] === 'button') {
    h.textContent = 'Button: ' + (a.title || 'New button');
    const row = document.createElement('div'); row.className = 'actions';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn primary'; b.textContent = a.title || 'New button';
    b.setAttribute('data-rv-demo', ''); RV.added.set(b, a.body || 'This button is a suggestion.');
    row.append(b); sec.append(row); if (a.body) sec.append(para(a.body, 'small muted rv-body'));
  } else if (t[0] === 'want') {
    sec.classList.add('rv-want'); h.textContent = 'I want ' + (a.title || 'something') + ' here';
    if (a.body) sec.append(para(a.body));
  } else if (a.body) sec.append(para(a.body));
  return sec;
}
function rvFirstZone() {
  for (const zk of ['z-idea', 'page']) if (RV.zones.has(zk)) return zk;
  let best = null;
  for (const [zk, z] of RV.zones) { if (!best || z.getBoundingClientRect().width > RV.zones.get(best).getBoundingClientRect().width) best = zk; }
  return best;
}
function rvPlace(z, seq) {
  let prev = null;
  for (const k of seq) {
    const el = RV.blocks.get(k);
    if (!el || el.contains(z)) continue;
    const want = prev ? prev.nextElementSibling : z.firstElementChild;
    if (el !== want) z.insertBefore(el, want);
    prev = el;
  }
}
function rvApply(L, owner) {
  RV.layout = L; RV.viewOwner = owner;
  if (!L) return;
  // 1. Added blocks join their zone's original sequence after the block they were added below.
  for (const a of L.added) {
    if (RV.blocks.has(a.id)) continue;
    const zk = RV.zones.has(a.zone) ? a.zone : rvFirstZone(); if (!zk) continue;
    const el = rvMakeAdded(a, owner);
    el.setAttribute('data-rv-b', a.id);
    RV.blocks.set(a.id, el);
    RV.meta.set(a.id, { key: a.id, label: a.title || rvLabelOf(RV_BLOCKS, a.type), isZone: false, layoutOnly: false, zone: zk, added: a });
    const seq = RV.orig[zk]; const i = a.after ? seq.indexOf(a.after) : -1;
    seq.splice(i >= 0 ? i + 1 : (a.after ? seq.length : 0), 0, a.id);
    RV.zones.get(zk).appendChild(el);
  }
  // 2. Stored zone orders; new content slots in after its original previous sibling.
  const placed = new Set(); const mentioned = new Set();
  for (const arr of Object.values(L.zones)) for (const k of arr) mentioned.add(k);
  for (const [zk, z] of RV.zones) {
    const orig = RV.orig[zk];
    let out;
    if (L.zones[zk]) {
      out = L.zones[zk].filter((k) => RV.blocks.has(k) && !placed.has(k));
      orig.forEach((k, i) => {
        if (mentioned.has(k) || out.includes(k)) return;
        let j = i - 1; while (j >= 0 && !out.includes(orig[j])) j--;
        out.splice(j >= 0 ? out.indexOf(orig[j]) + 1 : 0, 0, k);
      });
    } else out = orig.filter((k) => !mentioned.has(k));
    out = out.filter((k) => !placed.has(k));
    out.forEach((k) => placed.add(k));
    rvPlace(z, out);
    for (const k of out) { const m = RV.meta.get(k); if (m) m.zone = zk; }
  }
  // 3. Hidden blocks and sizes.
  for (const k of L.hidden) { const el = RV.blocks.get(k); if (el) el.classList.add('rv-hidden'); }
  for (const k of L.half.concat(L.full)) {
    const el = RV.blocks.get(k); if (!el || !el.parentElement) continue;
    const half = L.half.includes(k);
    el.classList.add(half ? 'rv-half' : 'rv-full');
    const cs = getComputedStyle(el.parentElement);
    if (half && cs.display.indexOf('flex') >= 0 && cs.flexDirection.indexOf('column') === 0) el.parentElement.classList.add('rv-wrapzone');
  }
  // 4. Text edits re-apply only while the original text still matches.
  for (const t of L.texts) {
    const b = RV.blocks.get(t.block); const id = owner + '|' + t.block + '|' + t.path + '|' + t.original;
    if (!b) continue;
    let el = rvResolve(b, t.path);
    if (!el || rvText(el, 600) !== t.original) {
      el = null;
      for (const c of b.querySelectorAll('*')) { if (!c.closest('[data-rv-ui]') && rvOwnText(c) && rvText(c, 600) === t.original) { el = c; break; } }
      if (!el && rvOwnText(b) && rvText(b, 600) === t.original) el = b;
    }
    if (el) { el.textContent = t.text; el.classList.add('rv-edited'); RV.orphans.delete(id); } else RV.orphans.add(id);
  }
  if (RV.blocks.size && RV.zones.has('z-idea') && L.added.length) { const e = document.querySelector('#app .rv-idea-empty'); if (e) e.classList.add('rv-hidden', 'rv-gone'); }
}
/* ---------- pins, anchors and arrange chrome (all marked data-rv-ui, appended inside blocks) ---------- */
function rvUi(tag, cls, text, attrs) {
  const el = document.createElement(tag); el.className = cls; el.setAttribute('data-rv-ui', '');
  if (text != null) el.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (tag === 'button') el.type = 'button';
  return el;
}
// Pins and handles need a containing block. position:relative would activate inset values a static element
// carries for another breakpoint (the Today rail has a sticky `top`), so those get a no-op transform instead.
function rvPositioned(el) {
  try {
    const cs = getComputedStyle(el);
    if (cs.position !== 'static') return;
    el.classList.add(cs.top === 'auto' && cs.left === 'auto' && cs.right === 'auto' && cs.bottom === 'auto' ? 'rv-rel' : 'rv-relt');
  } catch (e) { /* ignore */ }
}
function rvClips(el) {
  try { const cs = getComputedStyle(el); return cs.overflowX !== 'visible' || cs.overflowY !== 'visible'; } catch (e) { return false; }
}
function rvClearDecor(root) {
  for (const el of root.querySelectorAll('[data-rv-ui]')) el.remove();
  for (const el of root.querySelectorAll('.rv-anchored')) { el.classList.remove('rv-anchored'); el.removeAttribute('data-rv-n'); }
}
function rvAnchorEl(block, a) {
  if (!a || typeof a !== 'object') return null;
  if (a.href && rvHashOk(a.href)) {
    const nav = document.querySelector('#hdr nav.nav');
    if (nav) for (const x of nav.querySelectorAll('a')) if (x.getAttribute('href') === a.href) return x;
  }
  if (!block) return null;
  const snip = rvClean(a.snippet, 40);
  let el = typeof a.path === 'string' ? rvResolve(block, a.path) : null;
  const ok = (n) => n && (!snip || rvText(n, 80).slice(0, 40) === snip || (n.getAttribute('aria-label') || '').slice(0, 40) === snip);
  if (ok(el) && (!a.tag || el.tagName.toLowerCase() === a.tag)) return el;
  if (snip) for (const c of block.querySelectorAll(a.tag && /^[a-z0-9]{1,10}$/.test(a.tag) ? a.tag : '*')) if (!c.closest('[data-rv-ui]') && ok(c)) return c;
  return null;
}
function rvAnchorRoot(note) {
  const b = note.data.block;
  if (note.route === '_app') return b === 'nav' ? document.querySelector('#hdr nav.nav') : (b === 'banner' ? document.querySelector('#top .banner') : document.querySelector('#hdr .bar'));
  if (b === '_page') return document.getElementById('app');
  return RV.blocks.get(b) || null;
}
function rvDecorate(rk) {
  const app = document.getElementById('app');
  rvClearDecor(app);
  const notes = rvNotes(rk).filter((n) => rvPersonOk(n));
  const byBlock = new Map();
  for (const n of notes) if (n.route === rk) { const k = String(n.data.block); if (!byBlock.has(k)) byBlock.set(k, []); byBlock.get(k).push(n); }
  for (const [k, el] of RV.blocks) {
    const m = RV.meta.get(k); if (!m) continue;
    const hidden = el.classList.contains('rv-hidden');
    if (RV.arranging) rvArrangeChrome(k, el, m, hidden);
    if (m.layoutOnly || hidden) continue;
    const list = byBlock.get(k) || [];
    rvPositioned(el);
    const pin = rvUi('button', 'rv-pin' + (list.length ? '' : ' rv-empty') + (rvClips(el) ? ' rv-in' : ''), null, { 'data-rv': 'pin', 'data-k': k });
    if (list.length) {
      const who = Array.from(new Set(list.map((n) => n.reviewer))).slice(0, 3).map((r) => rvInit(SYNC.name(r))).join(' ');
      const done = list.every((n) => ['done', 'wontdo'].includes(rvStatusOf(n.id).status));
      if (done) pin.classList.add('rv-done');
      pin.append(document.createTextNode(list.length + (list.length === 1 ? ' note' : ' notes')));
      const w = document.createElement('span'); w.className = 'rv-who'; w.textContent = who; pin.append(w);
      pin.setAttribute('aria-label', list.length + (list.length === 1 ? ' note' : ' notes') + ' on ' + m.label);
    } else {
      pin.textContent = '+ Note';
      pin.setAttribute('aria-label', 'Add a note on ' + m.label);
    }
    el.appendChild(pin);
  }
  // Pin-anywhere notes mark their element; if it is gone the note falls back to its block, marked "moved".
  RV.moved = new Set();
  const marks = new Map();
  for (const n of notes) {
    if (!n.data.anchor) continue;
    const el = rvAnchorEl(rvAnchorRoot(n), n.data.anchor);
    if (!el) { RV.moved.add(n.id); continue; }
    marks.set(el, (marks.get(el) || 0) + 1);
  }
  for (const [el, c] of marks) { el.classList.add('rv-anchored'); el.setAttribute('data-rv-n', String(c)); rvPositioned(el); }
  requestAnimationFrame(rvPlacePins);
}
function rvHeaderPin(list) {
  const nav = document.querySelector('#hdr nav.nav'); if (!nav || !list.length) return;
  const pin = rvUi('button', 'rv-pin rv-navpin', list.length + (list.length === 1 ? ' note' : ' notes') + ' on the menu', { 'data-rv': 'pin', 'data-k': '@app' });
  nav.appendChild(pin);
}
const RV_CTRL = 'a[href], button, input, select, textarea, label, summary, [role="tab"], [tabindex]:not([tabindex="-1"])';
// Pins never cover controls. Each pin tries spots around its block (on the top edge, above it, inside its top, below it,
// further left, or beside a narrow block) and takes the one that covers no control, then no other pin, then no text.
// A pin inside a block that clips its overflow (a tab bar, a scrolling table) can move out to the nearest ancestor that
// does not clip. If no spot is free it takes no clicks (rv-tight). Everything is measured in page coordinates.
function rvPlacePins() {
  try {
    const app = document.getElementById('app'); if (!app) return;
    const pins = Array.from(app.querySelectorAll('.rv-pin[data-rv-ui]'));
    if (!pins.length) return;
    for (const p of pins) {
      p.setAttribute('style', ''); p.removeAttribute('style'); p.removeAttribute('data-rv-pos');
      p.classList.remove('rv-tight');
      if (p.classList.contains('rv-out')) { const b = RV.blocks.get(p.getAttribute('data-k')); p.classList.remove('rv-out', 'rv-pinhot'); if (b) b.appendChild(p); }
    }
    const sx = window.scrollX, sy = window.scrollY, vw = document.documentElement.clientWidth + sx;
    const box = (r) => ({ l: r.left + sx, r: r.right + sx, t: r.top + sy, b: r.bottom + sy });
    const ctrls = [];
    for (const c of app.querySelectorAll(RV_CTRL)) { if (c.closest('[data-rv-ui]')) continue; const r = c.getBoundingClientRect(); if (r.width && r.height) ctrls.push([c, box(r)]); }
    const texts = []; const rg = document.createRange();
    const w = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode; if (!n.nodeValue.trim() || !n.parentElement || n.parentElement.closest('[data-rv-ui]')) continue;
      rg.selectNodeContents(n); for (const q of rg.getClientRects()) if (q.width > 1 && q.height > 1) texts.push(box(q));
    }
    const top = document.getElementById('top'); const headB = top ? top.offsetHeight : 0; // the sticky header's band at scroll 0
    const pad = RV.touch ? 6 : 1, gap = RV.touch ? 12 : 4; // touch pins have a larger tap area (see review.css)
    const hit = (a, b, m) => a.l - m < b.r && a.r + m > b.l && a.t - m < b.b && a.b + m > b.t;
    const placed = [];
    const choose = (p, bb, pw, ph, inside) => {
      const near = (q) => q.b > bb.t - 70 && q.t < bb.b + 70 && q.r > bb.l - 60 && q.l < bb.r + pw + 60;
      const cs = ctrls.filter(([c, q]) => !c.contains(p) && near(q)).map(([, q]) => q);
      const ts = texts.filter(near); const ps = placed.filter(near);
      const xs = [];
      for (let x = bb.r - 10 - pw; x >= bb.l + 4 && xs.length < 21; x -= 24) xs.push(x);
      const beside = !inside && bb.r + 6 + pw <= vw - 4;
      const ys = inside ? [6, 34, 62].map((d) => bb.t + d).filter((y) => y + ph <= bb.b - 2) : [bb.t - 11, bb.t - ph - 3, bb.t - ph - 9, bb.t + 6, bb.b + 3];
      const spots = [];
      for (const x of xs) for (const y of ys) spots.push([x, y]);
      if (beside) for (const y of [bb.t + (bb.b - bb.t - ph) / 2, bb.t - 11, bb.t]) spots.push([bb.r + 6, y]);
      return spots.map(([x, y]) => {
        const c = { l: x, r: x + pw, t: y, b: y + ph };
        let score = Math.abs(bb.r - 10 - c.r) / 1000 + Math.abs(y - (bb.t - 11)) / 1000;
        if (c.t < headB + 2 || c.l < sx + 2 || c.r > vw - 2) score += 1000;
        if (cs.some((q) => hit(c, q, pad))) score += 100;
        if (ps.some((q) => hit(c, q, gap))) score += 20;
        if (ts.some((q) => hit(c, q, 0))) score += 5;
        return { score, c };
      }).sort((a, b) => a.score - b.score);
    };
    // Can the pin's whole tap area actually be hit there (a later block can paint over a pin that sticks out of its own)?
    const tappable = (p) => {
      const r = p.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      for (const [x, y] of [[cx, cy], [r.left - pad + 2, cy], [r.right + pad - 2, cy], [cx, r.top - pad + 2], [cx, r.bottom + pad - 2]]) {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const e = document.elementFromPoint(x, y);
        if (e && !p.contains(e) && !e.closest('#rv-root, #top, #toasts, #dlg')) return false;
      }
      return true;
    };
    for (const p of pins) {
      const blk = p.parentElement; const r0 = p.getBoundingClientRect(); if (!blk || !r0.width) continue;
      const base = box(r0); const bb = box(blk.getBoundingClientRect()); const pw = base.r - base.l, ph = base.b - base.t;
      const put = (c) => {
        const shift = Math.round(base.l - c.l), dy = Math.round(c.t - base.t);
        if (shift) p.style.setProperty('--rv-shift', shift + 'px'); else p.style.removeProperty('--rv-shift');
        if (dy) p.style.setProperty('--rv-dy', dy + 'px'); else p.style.removeProperty('--rv-dy');
      };
      const spots = choose(p, bb, pw, ph, p.classList.contains('rv-in'));
      let pick = null;
      for (const sp of spots.slice(0, 40)) { if (sp.score >= 100) break; put(sp.c); if (tappable(p)) { pick = sp; break; } }
      if (!pick && p.classList.contains('rv-in')) {
        let host = blk.parentElement; while (host && host !== app && rvClips(host)) host = host.parentElement;
        const out = host && app.contains(host) ? choose(p, bb, pw, ph, false)[0] : null;
        if (out && out.score < 100) {
          p.style.removeProperty('--rv-shift'); p.style.removeProperty('--rv-dy');
          rvPositioned(host); host.appendChild(p); p.classList.add('rv-out');
          const hr = host.getBoundingClientRect();
          p.style.left = (out.c.l - sx - hr.left - host.clientLeft + host.scrollLeft) + 'px';
          p.style.top = (out.c.t - sy - hr.top - host.clientTop + host.scrollTop) + 'px';
          placed.push(out.c); continue;
        }
      }
      if (!pick) {
        pick = spots.find((sp) => sp.score < 100) || spots[0];
        if (!pick) { placed.push(base); continue; }
        put(pick.c);
        if (pick.score >= 100) p.classList.add('rv-tight'); // no free spot: it must not take clicks meant for a control
      }
      placed.push(pick.c);
    }
    // Keep the page free of style attributes: the measured positions (numbers only) move into one review stylesheet.
    let css = '', n = 0;
    for (const p of pins) {
      const decl = ['--rv-shift', '--rv-dy', 'left', 'top'].map((v) => [v, p.style.getPropertyValue(v)]).filter(([, x]) => /^-?[\d.]+px$/.test(x));
      p.setAttribute('style', ''); p.removeAttribute('style'); // set first: after CSSOM edits Chrome re-serialises a removed style as style=""
      if (decl.length) { n++; p.setAttribute('data-rv-pos', String(n)); css += '#app .rv-pin[data-rv-ui][data-rv-pos="' + n + '"]{' + decl.map(([v, x]) => v + ':' + x).join(';') + '}\n'; }
    }
    let sheet = document.getElementById('rv-pinpos');
    if (!sheet) { sheet = document.createElement('style'); sheet.id = 'rv-pinpos'; sheet.setAttribute('data-rv-ui', ''); document.head.appendChild(sheet); }
    if (sheet.textContent !== css) sheet.textContent = css;
  } catch (e) { /* cosmetic only */ }
}
function rvArrangeChrome(k, el, m, hidden) {
  rvPositioned(el);
  el.classList.add('rv-arr');
  if (k === RV.sel) el.classList.add('rv-sel');
  const h = rvUi('button', 'rv-handle', null, { 'data-rv': 'select', 'data-k': k, 'aria-label': 'Move or change “' + m.label + '”', title: 'Drag to move. Click to select.' });
  h.textContent = '⠿ ' + (m.layoutOnly ? 'Row' : 'Move');
  el.appendChild(h);
  if (hidden) {
    const g = rvUi('div', 'rv-ghost');
    const s = document.createElement('span'); s.textContent = 'Hidden: ' + m.label;
    const b = rvUi('button', 'btn sm', 'Show', { 'data-rv': 'show', 'data-k': k });
    g.append(s, b); el.appendChild(g);
  }
  if (!hidden) el.appendChild(rvUi('button', 'rv-addhere', '+ Add a block here', { 'data-rv': 'addhere', 'data-k': k }));
}
function rvDestroySortables() {
  for (const s of RV.sortables) { try { s.destroy(); } catch (e) { /* detached */ } }
  RV.sortables = [];
}
function rvSortables() {
  if (!window.Sortable || typeof window.Sortable.create !== 'function') return;
  const touch = RV.touch;
  for (const [, z] of RV.zones) {
    try {
      RV.sortables.push(window.Sortable.create(z, {
        group: 'rv-blocks', draggable: '>[data-rv-b]', animation: 150,
        handle: touch ? '.rv-handle' : null,
        filter: '.rv-pin, .rv-ghost, .rv-addhere, .rv-editing', preventOnFilter: false,
        delay: touch ? 180 : 0, delayOnTouchOnly: true, touchStartThreshold: 5,
        forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4, swapThreshold: 0.6, emptyInsertThreshold: 16,
        ghostClass: 'rv-drag-ghost', chosenClass: 'rv-drag-chosen', dragClass: 'rv-drag-clone',
        onStart: () => { RV.dragging = true; document.body.classList.add('rv-dragging'); },
        onEnd: (evt) => { RV.dragging = false; document.body.classList.remove('rv-dragging'); rvDropped(evt); },
      }));
    } catch (e) { console.warn('Review layer: drag setup failed', e); }
  }
}
function rvDropped(evt) {
  try {
    const zs = Array.from(new Set([evt.from, evt.to])).filter(Boolean);
    const moved = evt.item && evt.item.getAttribute('data-rv-b');
    if (moved) RV.sel = moved;
    const changed = rvMutate((L) => {
      for (const z of zs) {
        const zk = RV.zoneKeyOf.get(z); if (!zk) continue;
        if (!L.base[zk]) L.base[zk] = (RV.orig[zk] || []).slice();
        L.zones[zk] = rvChildKeys(z);
      }
    });
    if (!changed) rvFlushPending();
  } catch (e) { console.warn('Review layer: drop failed', e); rvFlushPending(); }
}
function rvSelect(k) {
  RV.sel = k && RV.blocks.has(k) ? k : null;
  for (const el of document.querySelectorAll('#app .rv-sel')) el.classList.remove('rv-sel');
  const el = RV.sel && RV.blocks.get(RV.sel); if (el) el.classList.add('rv-sel');
  rvBars();
}
function rvParentBlock(k) {
  const el = RV.blocks.get(k); if (!el || !el.parentElement) return null;
  const p = el.parentElement.closest('[data-rv-b]');
  return p && document.getElementById('app').contains(p) ? p.getAttribute('data-rv-b') : null;
}
function rvMoveSel(dir) {
  const k = RV.sel; const el = k && RV.blocks.get(k); if (!el) return;
  const z = el.parentElement; const zk = RV.zoneKeyOf.get(z);
  if (!zk) { toast('This block sits outside the arrangeable areas. Drag a block inside it instead.'); return; }
  const keys = rvChildKeys(z); const i = keys.indexOf(k); const j = i + dir;
  if (j < 0 || j >= keys.length) { toast(dir < 0 ? 'Already at the top of this area.' : 'Already at the bottom of this area.'); return; }
  keys.splice(i, 1); keys.splice(j, 0, k);
  rvMutate((L) => { if (!L.base[zk]) L.base[zk] = (RV.orig[zk] || []).slice(); L.zones[zk] = keys; });
}
function rvToggle(field, k, on) {
  rvMutate((L) => {
    const has = L[field].includes(k);
    const want = on == null ? !has : on;
    L[field] = L[field].filter((x) => x !== k);
    if (want) L[field].push(k);
    if (field === 'half' && want) L.full = L.full.filter((x) => x !== k);
    if (field === 'full' && want) L.half = L.half.filter((x) => x !== k);
  });
}
function rvSizeOf(k) {
  const el = RV.blocks.get(k); if (!el) return 'full';
  if (el.classList.contains('rv-half')) return 'half';
  if (el.classList.contains('rv-full')) return 'full';
  const p = el.parentElement; if (!p) return 'full';
  return el.getBoundingClientRect().width < p.getBoundingClientRect().width * 0.85 ? 'half' : 'full';
}
/* ---------- navigation tabs: reorder, rename, hide; suggested pages ---------- */
const RV_NAV = '_nav';
function rvNormNav(d) {
  const N = { v: 1, order: [], hidden: [], names: rvDict(), labels: rvDict() };
  if (!d || typeof d !== 'object') return N;
  const hrefs = (a) => (Array.isArray(a) ? a.filter(rvHashOk).slice(0, 60) : []);
  N.order = hrefs(d.order); N.hidden = hrefs(d.hidden);
  for (const f of ['names', 'labels']) if (d[f] && typeof d[f] === 'object') for (const [k, v] of Object.entries(d[f]).slice(0, 60)) if (rvHashOk(k) && typeof v === 'string') N[f][k] = rvClean(v, 40);
  return N;
}
function rvNavOf(rid) {
  const it = rid ? SYNC.get(rvLayoutId(rid, RV_NAV)) : null;
  return it && !it.deleted && it.kind === 'layout' && it.reviewer === rid ? rvNormNav(it.data) : null;
}
const rvNavEmpty = (N) => !N || (!N.order.length && !N.hidden.length && !Object.keys(N.names).length);
function rvNavLabel(a) {
  for (const n of a.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return rvClean(n.nodeValue, 40);
  return rvText(a, 40);
}
function rvNavRename(a, name) {
  for (const n of a.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = name; return; }
  a.insertBefore(document.createTextNode(name), a.firstChild);
}
function rvApplyNav() {
  const nav = document.querySelector('#hdr nav.nav'); if (!nav) return;
  const owner = rvViewOwner(RV_NAV);
  RV.navOrig = Array.from(nav.querySelectorAll(':scope > a')).map((a) => ({ href: a.getAttribute('href'), label: rvNavLabel(a) })).filter((x) => rvHashOk(x.href));
  if (!owner) return;
  const cur = location.hash || '#today';
  for (const pg of rvPages()) {
    if (pg.reviewer !== owner || !pg.data.inNav) continue;
    const id = pg.id.slice(3);
    const a = document.createElement('a'); a.className = 'rv-navidea';
    a.setAttribute('href', '#idea-' + id); a.textContent = rvClean(pg.data.title, 40) || 'Suggested page';
    if (cur === '#idea-' + id) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  }
  const N = rvNavOf(owner); if (rvNavEmpty(N)) return;
  const links = Array.from(nav.querySelectorAll(':scope > a'));
  const byHref = new Map(links.map((a) => [a.getAttribute('href'), a]));
  if (N.order.length) {
    nav.classList.add('rv-navcustom');
    const seq = N.order.filter((h) => byHref.has(h));
    links.forEach((a, i) => {
      const h = a.getAttribute('href'); if (seq.includes(h)) return;
      let j = i - 1; while (j >= 0 && !seq.includes(links[j].getAttribute('href'))) j--;
      seq.splice(j >= 0 ? seq.indexOf(links[j].getAttribute('href')) + 1 : 0, 0, h);
    });
    for (const h of seq) nav.appendChild(byHref.get(h));
  }
  for (const [h, name] of Object.entries(N.names)) { const a = byHref.get(h); if (a && name) { rvNavRename(a, name); a.classList.add('rv-edited'); } }
  for (const h of N.hidden) { const a = byHref.get(h); if (a) a.classList.add(RV.arranging ? 'rv-navghost' : 'rv-navhid'); }
}
function rvHeaderDecor() {
  const top = document.getElementById('top'); if (!top) return;
  rvClearDecor(top);
  if (!RV.on) return;
  const list = rvNotes('_app').filter((n) => rvPersonOk(n));
  RV.movedApp = new Set();
  const marks = new Map();
  for (const n of list) {
    if (!n.data.anchor) continue;
    const el = rvAnchorEl(rvAnchorRoot(n), n.data.anchor);
    if (!el) { RV.movedApp.add(n.id); continue; }
    marks.set(el, (marks.get(el) || 0) + 1);
  }
  for (const [el, c] of marks) { el.classList.add('rv-anchored'); el.setAttribute('data-rv-n', String(c)); rvPositioned(el); }
  rvHeaderPin(list);
}
function rvNavScroll() {
  const nav = document.querySelector('#hdr nav.nav'); if (!nav) return;
  const cur = nav.querySelector(':scope > a[aria-current="page"]'); const key = cur ? cur.getAttribute('href') : '';
  if (nav.scrollWidth > nav.clientWidth + 1) {
    if (key !== RV.navKey || RV.navX == null) {
      if (cur) { const n = nav.getBoundingClientRect(), a = cur.getBoundingClientRect(); nav.scrollLeft = Math.max(0, nav.scrollLeft + a.left - n.left - (n.width - a.width) / 2); }
    } else nav.scrollLeft = RV.navX;
  }
  RV.navKey = key;
  const edge = () => { RV.navX = nav.scrollLeft; nav.classList.toggle('rv-navmore', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2); };
  edge(); nav.addEventListener('scroll', edge, { passive: true });
}
function rvSaveNav(fn) {
  const me = SYNC.me().id;
  SYNC.refresh();
  const N = rvNavOf(me) || rvNormNav(null);
  const before = JSON.stringify(N);
  fn(N);
  for (const o of RV.navOrig) N.labels[o.href] = o.label;
  if (JSON.stringify(N) === before) return;
  if (rvPut({ id: rvLayoutId(me, RV_NAV), kind: 'layout', route: RV_NAV, data: N }, 'This menu change')) (RV.undo[RV_NAV] = RV.undo[RV_NAV] || []).push(before);
  rvRerender();
}
function rvNavRows() {
  // The tabs as they appear for me now (my order), including my suggested pages shown in the menu.
  const me = SYNC.me().id; const N = rvNavOf(me) || rvNormNav(null);
  const rows = RV.navOrig.map((o) => ({ href: o.href, label: N.labels[o.href] || o.label, name: N.names[o.href] || '', hidden: N.hidden.includes(o.href) }));
  for (const pg of rvPages()) if (pg.reviewer === me && pg.data.inNav) { const h = '#idea-' + pg.id.slice(3); if (!rows.some((r) => r.href === h)) rows.push({ href: h, label: rvClean(pg.data.title, 40), name: '', hidden: N.hidden.includes(h), idea: true }); }
  if (N.order.length) {
    const pos = (h) => { const i = N.order.indexOf(h); return i < 0 ? 1e6 : i; };
    rows.sort((a, b) => pos(a.href) - pos(b.href));
  }
  return rows;
}
function rvNavMove(href, dir) {
  const hrefs = rvNavRows().map((r) => r.href); const i = hrefs.indexOf(href); const j = i + dir;
  if (i < 0 || j < 0 || j >= hrefs.length) return;
  hrefs.splice(i, 1); hrefs.splice(j, 0, href);
  rvSaveNav((N) => { N.order = hrefs; });
}
function rvSuggestPage(fd) {
  const title = rvClean(fd.rvptitle, 80);
  if (title.length < 2) return 'Give the page a name.';
  const id = SYNC.rand(10).replace(/[^A-Za-z0-9]/g, '');
  SYNC.put({ id: 'pg_' + id, kind: 'page', route: 'idea-' + id, data: { title, about: rvMulti(fd.rvpabout, 1000), inNav: fd.rvpnav === 'on' } });
  return id;
}
/* ---------- review root (outside #app so renders never wipe it): bar, tip, arrange bar, menu, drawer ---------- */
function rvRoot() {
  let r = document.getElementById('rv-root');
  if (r) return r;
  r = document.createElement('div'); r.id = 'rv-root'; r.setAttribute('data-rv-ui', '');
  r.innerHTML = '<div class="rv-tip" hidden></div><div class="rv-menu" hidden></div>'
    + '<div class="rv-bar" role="region" aria-label="Review tools" hidden></div>'
    + '<div class="rv-abar" role="region" aria-label="Arrange this page" hidden></div>'
    + '<aside class="rv-drawer" id="rv-drawer" role="dialog" aria-modal="false" aria-labelledby="rv-dw-title" hidden></aside>';
  document.body.appendChild(r);
  r.addEventListener('submit', rvOnSubmit);
  r.addEventListener('change', rvOnChange);
  r.addEventListener('input', rvOnInput);
  r.addEventListener('focusout', () => setTimeout(() => { if (RV.dwStale && !rvDrawerBusy()) rvDrawer(); }, 0));
  return r;
}
const rvHM = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const rvSyncing = () => !!SYNC.code() && !['badcode', 'full'].includes(SYNC.status().state);
const RV_REASONS = { quota: 'storage limit reached', invalid: 'refused as invalid', not_owner: 'belongs to another reviewer' };
const rvReason = (r) => RV_REASONS[r] || 'refused by the server';
function rvChip() {
  const st = SYNC.status(); const kept = st.storageOk ? 'saved here' : 'not saved on this device, keep this tab open';
  switch (st.state) {
    case 'local': return st.storageOk ? ['local', 'Not syncing: open the review link Aidan sent', 'Not syncing'] : ['bad', 'Not syncing, and not saved on this device', 'Not saved'];
    case 'badcode': return ['bad', 'Review link not valid', 'Link not valid'];
    case 'full': return ['bad', 'Review is full: notes stay in this browser', 'Review full'];
    case 'offline': return ['off', 'Offline: ' + kept + (st.storageOk ? ', will sync' : ''), 'Offline'];
    case 'error': return ['off', 'Sync problem: ' + kept + ', retrying', 'Sync problem'];
    case 'busy': return ['off', 'Sync busy: ' + kept + ', retrying shortly', 'Sync busy'];
    case 'saving': return ['busy', 'Saving…', 'Saving…'];
    case 'synced':
      if (st.dirty) return ['busy', 'Saving…', 'Saving…'];
      if (st.rejected) return ['bad', st.rejected + (st.rejected === 1 ? ' change' : ' changes') + ' not synced: ' + st.reasons.map(rvReason).join(', '), 'Not synced'];
      return ['ok', 'Synced ' + (st.lastSync ? rvHM(st.lastSync) : ''), 'Synced'];
    default: return ['busy', 'Connecting…', 'Connecting…'];
  }
}
function rvViewOptions(rk) {
  const v = SYNC.pref('view') || 'mine';
  const others = rvOthersWithLayout(rk); if (v !== 'mine' && v !== 'original' && !others.includes(v)) others.push(v);
  const names = rvDict(); const opts = [['mine', 'Mine'], ['original', 'Original']];
  for (const id of others) { let n = SYNC.name(id) + '’s'; names[n] = (names[n] || 0) + 1; if (names[n] > 1) n += ' (' + names[n] + ')'; opts.push([id, n]); }
  return { v, opts, others };
}
function rvViewSelect(rk, cls) {
  const { v, opts } = rvViewOptions(rk);
  return `<label class="rv-viewsel ${cls || ''}"><span>Layout</span><select data-rv-view aria-label="Whose layout to show">${opts.map(([k, l]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}
function rvPersonSelect(id) {
  const p = SYNC.pref('person') || 'all';
  const opts = [['all', 'Everyone'], ['mine', 'Only mine']].concat(rvPeople().map((x) => [x.id, x.name]));
  return `<label class="rv-viewsel" for="${id}"><span>Notes from</span><select id="${id}" data-rv-person>${opts.map(([k, l]) => `<option value="${esc(k)}"${k === p ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}
function rvSetHtml(el, html) { if (el && el.__rvHtml !== html) { el.innerHTML = html; el.__rvHtml = html; } }
function rvBars() {
  const root = rvRoot();
  const bar = root.querySelector('.rv-bar'), abar = root.querySelector('.rv-abar'), tip = root.querySelector('.rv-tip');
  document.body.classList.toggle('rv-on', RV.on);
  document.body.classList.toggle('rv-arranging', RV.on && RV.arranging);
  document.body.classList.toggle('rv-picking', RV.on && RV.picking);
  if (!RV.on) { bar.hidden = true; abar.hidden = true; tip.hidden = true; rvMenu(false); return; }
  const rk = rvRouteKey(); const page = rvPageName(rk);
  const [cls, long, short] = rvChip();
  const chip = `<button type="button" class="rv-chip rv-${cls}" data-rv="status" title="${esc(long)}"><span class="rv-dot" aria-hidden="true"></span><span class="rv-l">${esc(long)}</span><span class="rv-s">${esc(short)}</span></button>`;
  tip.hidden = !!SYNC.pref('tip') || RV.arranging || RV.picking;
  rvSetHtml(tip, `<p><strong>New:</strong> leave a note on anything, or rearrange this page. ${rvSyncing() ? 'It syncs to Aidan automatically.' : 'Open the review link Aidan sent so he can see it.'}</p><button type="button" class="btn sm" data-rv="tipok">Got it</button>`);
  abar.hidden = !RV.arranging; bar.hidden = RV.arranging;
  if (RV.arranging) {
    const k = RV.sel; const m = k && RV.meta.get(k); const el = k && RV.blocks.get(k);
    const hid = el && el.classList.contains('rv-hidden');
    const tools = m ? `<div class="rv-arow rv-tbrow"><p class="rv-selname"><span class="eyebrow">Selected</span> <strong>${esc(m.label)}</strong></p>
      <div class="rv-tb" role="toolbar" aria-label="Block tools">
        <button type="button" class="btn sm" data-rv="up" aria-label="Move up">↑ Up</button><button type="button" class="btn sm" data-rv="down" aria-label="Move down">↓ Down</button>
        <button type="button" class="btn sm" data-rv="hide">${hid ? 'Show' : 'Hide'}</button>
        <button type="button" class="btn sm" data-rv="size">${rvSizeOf(k) === 'half' ? 'Full width' : 'Half width'}</button>
        ${m.added ? '<button type="button" class="btn sm" data-rv="editblock">Edit block</button><button type="button" class="btn sm danger" data-rv="delblock">Delete block</button>' : '<button type="button" class="btn sm" data-rv="edittext">Edit text</button>'}
        <button type="button" class="btn sm" data-rv="note">Note</button>
        <button type="button" class="btn sm" data-rv="addsel">+ Add a block</button>
        ${rvParentBlock(k) ? '<button type="button" class="btn sm ghost" data-rv="outer">Outer section</button>' : ''}
        <button type="button" class="btn sm ghost" data-rv="deselect" aria-label="Clear the selection">✕</button></div></div>`
      : `<p class="rv-ahint small muted">${RV.touch ? 'Tap a block, then hold its ⠿ Move handle to drag it. The toolbar hides it, resizes it, edits its text or adds a block next to it.' : 'Drag any block to move it. Click a block to hide it, resize it, edit its text or add a block next to it. Double-click text to change it.'}${window.Sortable ? '' : ' Dragging is not available right now: use Up and Down.'}</p>`;
    rvSetHtml(abar, `<div class="rv-arow rv-arow1"><p class="rv-amsg"><strong>Arranging ${esc(page)}.</strong> <span class="rv-l">${rvSyncing() ? 'Changes sync automatically.' : 'Changes are saved on this device only.'}</span></p>
      <div class="rv-aact"><button type="button" class="btn sm" data-rv="undo"${(RV.undo[rk] || []).length ? '' : ' disabled'}>Undo</button><button type="button" class="btn sm" data-rv="resetpage"><span class="rv-l">Reset this page</span><span class="rv-s">Reset page</span></button><button type="button" class="btn sm" data-rv="tabs"><span class="rv-l">Tabs &amp; pages</span><span class="rv-s">Tabs</span></button>${rvViewSelect(rk)}</div><button type="button" class="btn sm primary rv-done" data-rv="done">Done</button></div>${tools}`);
    document.documentElement.style.setProperty('--rv-dock-h', abar.offsetHeight + 'px');
    return;
  }
  if (RV.picking) {
    rvSetHtml(bar, `<p class="rv-pickmsg"><strong>Pin a note:</strong> ${RV.touch ? 'tap' : 'click'} anything on the page, a button, a tray, a table column or a menu tab.</p><button type="button" class="btn sm" data-rv="pickcancel">Cancel</button>`);
    bar.hidden = false; return;
  }
  const n = rvNotes(rk).filter((x) => rvPersonOk(x)).length + rvNotes('_app').filter((x) => rvPersonOk(x)).length;
  const owner = RV.viewOwner; const me = SYNC.me().id;
  const viewing = owner !== me ? `<span class="pill rv-viewing">${owner ? esc(SYNC.name(owner)) + '’s layout' : 'Original layout'}</span>${owner ? '<button type="button" class="btn sm" data-rv="copymine">Copy to mine</button>' : ''}` : '';
  const showSel = rvViewOptions(rk).others.length || owner !== me;
  rvSetHtml(bar, `${chip}<span class="rv-sep" aria-hidden="true"></span>
    <button type="button" class="btn sm" data-rv="pagenotes"><span class="rv-l">Notes on this page</span><span class="rv-s">Notes</span> <span class="count${n ? '' : ' zero'}">${n}</span></button>
    <button type="button" class="btn sm" data-rv="pick"><span class="rv-l">Pin a note</span><span class="rv-s">Pin</span></button>
    <button type="button" class="btn sm primary" data-rv="arrange"><span class="rv-l">Arrange this page</span><span class="rv-s">Arrange</span></button>
    ${viewing}${showSel ? rvViewSelect(rk, 'rv-wide') : ''}
    <button type="button" class="btn sm ghost rv-more" data-rv="menu" aria-expanded="${RV.menu}" aria-label="More review options">•••</button>`);
  bar.hidden = false;
  if (RV.menu) rvMenu(true);
}
function rvMenu(open) {
  RV.menu = !!open;
  const m = rvRoot().querySelector('.rv-menu');
  if (!RV.menu || !RV.on) { m.hidden = true; return; }
  const code = SYNC.code(); const rk = rvRouteKey();
  rvSetHtml(m, `<a href="#feedback" class="rv-mi" data-rv="menuclose">Review notes page</a>
    <button type="button" class="rv-mi" data-rv="status">Sync status${code ? '' : ' and review code'}</button>
    ${code && SYNC.status().state !== 'badcode' ? '<button type="button" class="rv-mi" data-rv="copylink">Copy review link</button>' : ''}
    <button type="button" class="rv-mi" data-rv="rename">Change my name</button>
    <div class="rv-mi rv-misel">${rvViewSelect(rk)}</div><div class="rv-mi rv-misel">${rvPersonSelect('rv-menu-person')}</div>`);
  m.hidden = false;
}
function rvWithName(then) {
  const me = SYNC.me();
  if (me.asked && me.name) { then(); return; }
  const hint = me.name || me.hint || rvNameFromEmail(S && S.authEmail) || '';
  modal('Your name for review notes', `<p>Your notes and layout changes carry your name, so Aidan knows who suggested what.</p>
    <label class="f" for="rv-name">Your name<input id="rv-name" name="rvname" maxlength="60" autocomplete="name" value="${esc(hint)}"></label>
    <p class="hint">Shown to the Operon team and the other partners reviewing this preview.</p>`, 'Continue', (fd) => {
    const n = rvClean(fd.rvname, 60);
    if (n.length < 2) return 'Type your name (at least 2 letters).';
    SYNC.setName(n);
    return () => { try { then(); } catch (e) { console.warn('Review layer', e); } };
  });
}
function rvStatusDialog() {
  const st = SYNC.status(); const code = SYNC.code(); const [, long] = rvChip();
  const people = Object.values(SYNC.reviewers()).sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen))).slice(0, 12);
  const needCode = !code || st.state === 'badcode';
  modal('Review sync', `<p><strong>${esc(long)}</strong></p>
    <p class="small muted">Notes and layout changes are saved in this browser first, then sent to Aidan automatically.${st.dirty ? ' ' + esc(String(st.dirty)) + ' change' + (st.dirty === 1 ? ' is' : 's are') + ' waiting to sync.' : ''}${st.storageOk ? '' : ' This browser could not save them (its storage is full or blocked), so changes last only until you close the tab.'}</p>
    ${st.state === 'full' ? '<p class="small">This review already has the maximum number of reviewers, so your notes can’t reach Aidan. They stay in this browser. Ask Aidan to make room, then choose Sync now.</p>' : ''}
    ${st.rejected ? `<p class="small">${esc(String(st.rejected))} of your changes were not accepted (${esc(st.reasons.map(rvReason).join(', '))}). Delete or shorten them, or tell Aidan.</p>` : ''}
    <p class="small">You are <strong>${esc(SYNC.me().name || SYNC.me().hint || 'not named yet')}</strong>.</p>
    ${people.length ? `<div><h3 class="eyebrow" style="margin-bottom:6px">Reviewers</h3><ul class="plain small">${people.map((p) => `<li>${esc(p.name || 'Reviewer')}${p.id === SYNC.me().id ? ' (you)' : ''}${p.last_seen ? ` <span class="muted">· last seen ${esc(rvWhen(p.last_seen))}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
    ${needCode ? `<label class="f" for="rv-code">Review code<input id="rv-code" name="rvcode" autocomplete="off" spellcheck="false" placeholder="From the link Aidan sent"></label><p class="hint">${st.state === 'badcode' ? 'The review link this browser has is not valid. ' : ''}Open the review link Aidan sent, or paste the code that comes after “review=”.</p>` : ''}`,
  needCode ? 'Save code' : null, needCode ? (fd) => {
    let c = String(fd.rvcode || '').trim();
    const m = /[?&]review=([^&#\s]+)/.exec(c); if (m) { try { c = decodeURIComponent(m[1]); } catch (e) { c = m[1]; } }
    if (c.length < 16 || c.length > 128 || /\s/.test(c)) return 'That does not look like a review code. Copy it from the link Aidan sent.';
    SYNC.setCode(c); toast('Review code saved. Syncing now.'); return true;
  } : null, { extra: code && !needCode ? '<button type="button" class="btn" data-rv="copylink">Copy review link</button><button type="button" class="btn" data-rv="syncnow">Sync now</button>' : '' });
}
// Toasts tell the truth about where a change went.
function rvWhere(what) {
  const st = SYNC.status();
  if (!st.storageOk) return what + ' for now, but this browser could not store it. Keep this tab open.';
  if (!SYNC.code() || ['badcode', 'full'].includes(st.state)) return what + ' on this device only. Open the review link Aidan sent to share it with him.';
  if (['offline', 'error', 'busy'].includes(st.state)) return what + ' here. It syncs to Aidan when the connection works again.';
  return what + '. It syncs to Aidan automatically.';
}
function rvCopyLink() {
  const code = SYNC.code(); if (!code) { rvStatusDialog(); return; }
  const link = location.origin + location.pathname + '?review=' + encodeURIComponent(code);
  const fallback = () => modal('Copy review link', `<p>Send this link only to the partners reviewing the preview.</p><input id="rv-link" readonly class="mono" value="${esc(link)}" aria-label="Review link">`, null, null, { onOpen: () => setTimeout(() => { const i = document.getElementById('rv-link'); if (i) { i.focus(); i.select(); } }, 0) });
  try { navigator.clipboard.writeText(link).then(() => toast('Review link copied. Share it only with the reviewing partners.'), fallback); } catch (e) { fallback(); }
}
/* ---------- the notes drawer: right panel on desktop, bottom sheet on phones ---------- */
function rvDrawerBusy() {
  const d = document.getElementById('rv-drawer'); const ae = document.activeElement;
  if (!d || !ae || !d.contains(ae)) return false;
  return (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && !/^(radio|checkbox|button|submit)$/.test(ae.type))) && (ae.value || '') !== '';
}
function rvOpenDrawer(dw) {
  RV.dw = Object.assign({ mode: 'block' }, dw);
  RV.dwReturn = document.activeElement;
  rvMenu(false); rvDrawer(true);
}
function rvCloseDrawer() {
  RV.dw = null; rvDrawer();
  if (RV.dwReturn && document.body.contains(RV.dwReturn)) { try { RV.dwReturn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  RV.dwReturn = null;
}
function rvChips(name, list, cur) {
  return `<div class="chips" role="radiogroup">${list.map(([k, l]) => `<label><input type="radio" name="${name}" value="${esc(k)}"${k === cur ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>`;
}
function rvAnchorText(a) {
  if (!a) return '';
  const what = a.col ? 'column' : ({ a: 'link', button: 'button', th: 'column', td: 'cell', input: 'field', select: 'menu', textarea: 'field', li: 'row', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', p: 'text', label: 'label' }[a.tag] || 'item');
  return what + (a.snippet ? ' “' + rvClean(a.snippet, 60) + '”' : '');
}
function rvNoteForm(dw, note) {
  const d = note ? note.data : {};
  const type = d.type || 'change';
  return `<form class="rv-form stack" data-rv-form="note" novalidate>
    ${dw.anchor ? `<p class="small rv-anchorline">Pinned to the ${esc(rvAnchorText(dw.anchor))}</p>` : ''}
    <fieldset class="rv-fs"><legend class="small muted">Type</legend>${rvChips('rvtype', RV_TYPES, type)}</fieldset>
    <label class="f" for="rv-change"><span class="rv-qlabel">${type === 'love' ? 'What do you like about it?' : 'What would you change?'}</span><textarea id="rv-change" name="rvchange" maxlength="4000" rows="3" required>${esc(d.change || '')}</textarea></label>
    <label class="f" for="rv-better">How could we do it better? <span class="muted small">(optional)</span><textarea id="rv-better" name="rvbetter" maxlength="4000" rows="3">${esc(d.better || '')}</textarea></label>
    <fieldset class="rv-fs"><legend class="small muted">Priority</legend>${rvChips('rvprio', RV_PRIO, d.priority || 'medium')}</fieldset>
    <p class="hint">Shared with the Operon team. Don’t include real client details.</p>
    <p class="err" id="rv-note-err" role="alert"></p>
    <div class="row"><button type="submit" class="btn primary">${note ? 'Save changes' : 'Save note'}</button>${note || dw.compose ? '<button type="button" class="btn ghost" data-rv="composecancel">Cancel</button>' : ''}</div>
  </form>`;
}
function rvNoteHtml(n, opts) {
  const me = SYNC.me().id; const d = n.data; const mine = n.reviewer === me;
  const st = rvStatusOf(n.id); const reps = rvReplies(n.id);
  const moved = d.anchor && (RV.moved && RV.moved.has(n.id) || RV.movedApp && RV.movedApp.has(n.id));
  const where = opts && opts.where ? `<p class="small muted">${esc(rvClean(d.label, 80) || 'Section')}${d.instance && rvHashOk(d.instance) ? ' · ' + esc(d.instance) : ''}</p>` : '';
  return `<article class="rv-note${n.id === (RV.dw && RV.dw.focus) ? ' rv-focus' : ''}" data-note="${esc(n.id)}">
    <header class="rv-nh"><span class="avatar rv-av" aria-hidden="true">${esc(rvInit(SYNC.name(n.reviewer)))}</span>
      <span class="rv-nm"><strong>${esc(SYNC.name(n.reviewer))}</strong>${mine ? ' <span class="muted small">(you)</span>' : ''}<br><span class="small muted">${esc(rvWhen(SYNC.created(n)))}${n._err ? ' · not synced: ' + esc(rvReason(n._err)) : (n._dirty ? (rvSyncing() ? ' · saving…' : (SYNC.status().storageOk ? ' · saved in this browser' : ' · not saved: this browser’s storage is full or blocked')) : '')}</span></span>
      <span class="row rv-tags"><span class="pill">${esc(rvLabelOf(RV_TYPES, d.type))}</span>${d.priority && d.priority !== 'medium' ? `<span class="pill${d.priority === 'high' ? ' warn' : ''}">${esc(rvLabelOf(RV_PRIO, d.priority))}</span>` : ''}</span></header>
    ${where}
    ${d.anchor ? `<p class="small muted">Pinned to the ${esc(rvAnchorText(d.anchor))}${moved ? ' <span class="pill warn">moved</span>' : ''}</p>` : ''}
    <p class="rv-q">${d.type === 'love' ? 'What they like' : 'What would you change?'}</p><p class="rv-t">${esc(d.change || '')}</p>
    ${d.better ? `<p class="rv-q">How could we do it better?</p><p class="rv-t">${esc(d.better)}</p>` : ''}
    <div class="row rv-strow"><label class="small" for="rv-st-${esc(n.id)}">Status <select id="rv-st-${esc(n.id)}" data-rv-status="${esc(n.id)}">${RV_STATUS.map(([k, l]) => `<option value="${k}"${k === st.status ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>${st.by ? `<span class="small muted">${esc(rvLabelOf(RV_STATUS, st.status))} · set by ${esc(SYNC.name(st.by))}${st.at ? ', ' + esc(rvWhen(st.at)) : ''}</span>` : ''}</div>
    ${reps.length ? `<ul class="rv-replies">${reps.map((r) => `<li><p class="small"><strong>${esc(SYNC.name(r.reviewer))}</strong> <span class="muted">${esc(rvWhen(SYNC.created(r)))}</span>${r.reviewer === me ? ` <button type="button" class="rv-link" data-rv="delreply" data-id="${esc(r.id)}">Delete</button>` : ''}</p><p class="rv-t">${esc(r.data.text || '')}</p></li>`).join('')}</ul>` : ''}
    <form class="rv-reply" data-rv-form="reply" data-note="${esc(n.id)}" novalidate><label class="sr" for="rv-rp-${esc(n.id)}">Reply</label><textarea id="rv-rp-${esc(n.id)}" name="rvreply" maxlength="4000" rows="1" placeholder="Reply…"></textarea><button type="submit" class="btn sm">Reply</button></form>
    <div class="row rv-nact">${opts && opts.jump ? `<button type="button" class="rv-link" data-rv="jump" data-id="${esc(n.id)}">Show on the page</button>` : ''}${mine ? `<button type="button" class="rv-link" data-rv="editnote" data-id="${esc(n.id)}">Edit</button><button type="button" class="rv-link" data-rv="delnote" data-id="${esc(n.id)}">Delete</button>` : ''}</div>
  </article>`;
}
function rvBlockForm(dw, saved) {
  const a = dw.draft || saved;
  const type = (dw.draft && dw.draft.type) || (saved && saved.type) || dw.type || 'text';
  const t = RV_BLOCKS.find((x) => x[0] === type) || RV_BLOCKS[0];
  return `<form class="rv-form stack" data-rv-form="${saved ? 'editblock' : 'addblock'}" novalidate>
    <fieldset class="rv-fs"><legend class="small muted">Kind of block</legend>${rvChips('rvbtype', RV_BLOCKS.map((x) => [x[0], x[1]]), type)}</fieldset>
    <label class="f" for="rv-btitle">${type === 'button' ? 'Button label' : (type === 'want' ? 'What do you want here?' : 'Title')}<input id="rv-btitle" name="rvbtitle" maxlength="120" value="${esc(a ? a.title : '')}" required></label>
    <label class="f" for="rv-bbody">${type === 'button' ? 'What should it do?' : 'Content'} <span class="muted small">(optional)</span><textarea id="rv-bbody" name="rvbbody" maxlength="2000" rows="5">${esc(a ? a.body : '')}</textarea></label>
    <p class="hint rv-bhint">${esc(t[2])} Don’t include real client details.</p>
    <p class="err" id="rv-block-err" role="alert"></p>
    <div class="row"><button type="submit" class="btn primary">${saved ? 'Save block' : 'Add block'}</button><button type="button" class="btn ghost" data-rv="dwclose">Cancel</button></div>
  </form>`;
}
function rvTabsHtml() {
  const rows = rvNavRows(); const me = SYNC.me().id;
  const pages = rvPages();
  return `<section class="stack" style="gap:10px"><h3>Menu tabs</h3><p class="small muted">Reorder, rename or hide tabs. Type over a name to rename that tab in your menu. Only your own menu changes; Aidan sees it in your layout.</p>
    <ol class="rv-tabs" data-rv-tabs>${rows.map((r, i) => `<li data-href="${esc(r.href)}"><span class="rv-tabh" aria-hidden="true">⠿</span>
      <label class="sr" for="rv-tab-${i}">Name for ${esc(r.label)}</label><input id="rv-tab-${i}" data-rv-tabname="${esc(r.href)}" maxlength="40" value="${esc(r.name || r.label)}" placeholder="${esc(r.label)}">
      <button type="button" class="btn sm ghost" data-rv="tabup" data-href="${esc(r.href)}" aria-label="Move ${esc(r.label)} up"${i ? '' : ' disabled'}>↑</button><button type="button" class="btn sm ghost" data-rv="tabdown" data-href="${esc(r.href)}" aria-label="Move ${esc(r.label)} down"${i < rows.length - 1 ? '' : ' disabled'}>↓</button>
      <label class="small rv-tabshow"><input type="checkbox" data-rv-tabshow="${esc(r.href)}"${r.hidden ? '' : ' checked'}> Show</label></li>`).join('')}</ol>
    <div class="row"><button type="button" class="btn sm" data-rv="tabsreset">Reset the menu</button></div></section>
    <section class="stack" style="gap:10px"><h3>Suggest a page</h3>
      <form class="rv-form stack" data-rv-form="page" novalidate>
        <label class="f" for="rv-ptitle">Page name<input id="rv-ptitle" name="rvptitle" maxlength="80" placeholder="e.g. Client onboarding"></label>
        <label class="f" for="rv-pabout">What is it for? <span class="muted small">(optional)</span><textarea id="rv-pabout" name="rvpabout" maxlength="1000" rows="3"></textarea></label>
        <label class="row small" for="rv-pnav" style="gap:8px"><input type="checkbox" id="rv-pnav" name="rvpnav" checked> Add it to my menu</label>
        <p class="err" id="rv-page-err" role="alert"></p>
        <div><button type="submit" class="btn primary">+ Suggest a page</button></div>
      </form></section>
    ${pages.length ? `<section class="stack" style="gap:8px"><h3>Suggested pages</h3><ul class="plain">${pages.map((p) => `<li class="row between"><a href="#idea-${esc(p.id.slice(3))}">${esc(rvClean(p.data.title, 80) || 'Untitled page')}</a><span class="small muted">${esc(SYNC.name(p.reviewer))}${p.reviewer === me ? ` · <button type="button" class="rv-link" data-rv="delpage" data-id="${esc(p.id)}">Delete</button>` : ''}</span></li>`).join('')}</ul></section>` : ''}`;
}
function rvDrawer(focusFirst) {
  const d = rvRoot().querySelector('.rv-drawer');
  document.body.classList.toggle('rv-dwopen', !!RV.dw);
  if (!RV.dw || !RV.on) { d.hidden = true; d.innerHTML = ''; d.__rvHtml = ''; RV.dwStale = false; return; }
  if (!focusFirst && rvDrawerBusy()) { RV.dwStale = true; return; }
  RV.dwStale = false;
  const dw = RV.dw; const rk = rvRouteKey();
  let title = '', eyebrow = esc(rvPageName(dw.route || rk)), body = '';
  if (dw.mode === 'block') {
    const notes = rvNotes(dw.route).filter((n) => n.data.block === dw.block && rvPersonOk(n)).sort((a, b) => SYNC.created(a).localeCompare(SYNC.created(b)));
    const editing = dw.edit ? SYNC.get(dw.edit) : null;
    title = esc(dw.label || 'Section');
    const compose = dw.compose || !notes.length || dw.anchor || editing;
    body = `${compose ? rvNoteForm(dw, editing) : '<div><button type="button" class="btn primary" data-rv="compose">+ Add a note</button></div>'}
      ${notes.length ? `<div class="row between"><h3 class="eyebrow">${notes.length} note${notes.length === 1 ? '' : 's'}</h3>${rvPersonSelect('rv-dw-person')}</div>${notes.map((n) => rvNoteHtml(n)).join('')}` : (SYNC.pref('person') && SYNC.pref('person') !== 'all' ? `<p class="small muted">No notes from this person here. ${rvPersonSelect('rv-dw-person')}</p>` : '')}`;
  } else if (dw.mode === 'page') {
    title = 'Notes on this page';
    const notes = rvNotes(rk).concat(rvNotes('_app')).filter((n) => rvPersonOk(n)).sort((a, b) => SYNC.created(b).localeCompare(SYNC.created(a)));
    const groups = new Map();
    for (const n of notes) { const g = n.route === '_app' ? 'Header and menu' : rvClean(n.data.label, 80) || 'Section'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(n); }
    body = `<p class="small muted">Use a <strong>+ Note</strong> pin on any section, or <button type="button" class="rv-link" data-rv="pick">pin a note to anything</button>.</p>
      <div class="row between"><h3 class="eyebrow">${notes.length} note${notes.length === 1 ? '' : 's'}</h3>${rvPersonSelect('rv-dw-person')}</div>
      ${groups.size ? Array.from(groups).map(([g, list]) => `<section class="stack rv-grp" style="gap:8px"><h3>${esc(g)}</h3>${list.map((n) => rvNoteHtml(n, { jump: true })).join('')}</section>`).join('') : '<p class="allclear">No notes on this page yet.</p>'}`;
  } else if (dw.mode === 'addblock') {
    title = 'Add a block'; eyebrow = esc(rvPageName(rk)) + (dw.label ? ' · below “' + esc(dw.label) + '”' : '');
    body = rvBlockForm(dw, null);
  } else if (dw.mode === 'editblock') {
    const a = RV.layout && RV.layout.added.find((x) => x.id === dw.block);
    title = 'Edit block'; body = a ? rvBlockForm(dw, a) : '<p class="muted">That block is no longer on this page.</p>';
  } else if (dw.mode === 'tabs') {
    title = 'Tabs and pages'; eyebrow = 'Arrange the menu';
    body = rvTabsHtml();
  }
  const html = `<div class="rv-dwh"><div class="stack" style="gap:2px;min-width:0"><p class="eyebrow">${eyebrow}</p><h2 id="rv-dw-title">${title}</h2></div><button type="button" class="btn ghost sm" data-rv="dwclose" aria-label="Close notes">Close</button></div><div class="rv-dwb">${body}</div>`;
  const scroll = d.querySelector('.rv-dwb') ? d.querySelector('.rv-dwb').scrollTop : 0;
  rvSetHtml(d, html);
  d.hidden = false;
  const b = d.querySelector('.rv-dwb'); if (b && !focusFirst) b.scrollTop = scroll;
  if (dw.mode === 'tabs') rvTabsSortable(d);
  if (focusFirst) {
    const f = d.querySelector('#rv-change') || d.querySelector('.rv-dwb [data-rv="compose"]') || d.querySelector('#rv-btitle, #rv-ptitle') || d.querySelector('[data-rv="dwclose"]');
    if (f) { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    if (dw.focus) { const n = d.querySelector('.rv-focus'); if (n) n.scrollIntoView({ block: 'nearest' }); }
  }
}
function rvTabsSortable(d) {
  const ol = d.querySelector('[data-rv-tabs]'); if (!ol || !window.Sortable) return;
  if (typeof window.Sortable.get === 'function' && window.Sortable.get(ol)) return; // the list was kept: it already has one
  try {
    window.Sortable.create(ol, { handle: '.rv-tabh', animation: 120, forceFallback: true, fallbackOnBody: true,
      onEnd: () => { const order = Array.from(ol.children).map((li) => li.getAttribute('data-href')).filter(rvHashOk); rvSaveNav((N) => { N.order = order; }); rvDrawer(); } });
  } catch (e) { /* Up/Down still work */ }
}
/* ---------- actions ---------- */
function rvBlockCtx(k) {
  const rk = rvRouteKey();
  if (k === '@app') return { route: '_app', block: 'nav', label: 'Header and menu' };
  const m = RV.meta.get(k);
  return { route: rk, block: k, label: m ? m.label : 'Section' };
}
function rvSaveNote(fd) {
  const dw = RV.dw; if (!dw) return 'Open a section first.';
  const change = rvMulti(fd.rvchange, 4000); const better = rvMulti(fd.rvbetter, 4000);
  if (change.length < 2) return dw && fd.rvtype === 'love' ? 'Say what you like about it.' : 'Write what you would change first.';
  const type = RV_TYPES.some((t) => t[0] === fd.rvtype) ? fd.rvtype : 'change';
  const priority = RV_PRIO.some((t) => t[0] === fd.rvprio) ? fd.rvprio : 'medium';
  const prev = dw.edit ? SYNC.get(dw.edit) : null;
  const hash = location.hash || '#today';
  const data = Object.assign({}, prev ? prev.data : {
    block: dw.block, label: rvClean(dw.label, 120), page: rvPageName(dw.route), instance: rvHashOk(hash) ? hash : '#' + rvRouteKey(),
    anchor: dw.anchor || undefined,
  }, { type, change, better, priority, name: SYNC.me().name });
  if (!data.anchor) delete data.anchor;
  const it = SYNC.put({ id: prev ? prev.id : SYNC.newId('n_'), kind: 'note', route: dw.route, data });
  if (!it) return 'Couldn’t save this note.';
  RV.dw = Object.assign({}, dw, { compose: false, anchor: null, edit: null, focus: it.id });
  toast(rvWhere(prev ? 'Note updated' : 'Note saved'));
  rvDrawer(); rvRefreshPins();
  return true;
}
function rvAddBlock(fd, editId) {
  const type = RV_BLOCKS.some((t) => t[0] === fd.rvbtype) ? fd.rvbtype : 'text';
  const title = rvClean(fd.rvbtitle, 120); const body = rvMulti(fd.rvbbody, 2000);
  if (title.length < 1) return type === 'button' ? 'Give the button a label.' : 'Give the block a title.';
  const dw = RV.dw || {};
  let newId = null;
  rvMutate((L) => {
    if (editId) { const a = L.added.find((x) => x.id === editId); if (!a) return false; Object.assign(a, { type, title, body }); return; }
    if (L.added.length >= 60) { toast('This page already has 60 added blocks.'); return false; }
    const ctx = dw.after ? RV.meta.get(dw.after) : null;
    const afterEl = dw.after ? RV.blocks.get(dw.after) : null;
    let zone = ctx && ctx.zone; let after = dw.after || '';
    if (afterEl && RV.zoneKeyOf.has(afterEl) && !ctx.zone) { zone = RV.zoneKeyOf.get(afterEl); after = rvChildKeys(afterEl).slice(-1)[0] || ''; }
    if (!zone) { zone = rvFirstZone(); after = zone ? (rvChildKeys(RV.zones.get(zone)).slice(-1)[0] || '') : ''; }
    if (!zone) { toast('Blocks can’t be added on this page.'); return false; }
    newId = 'a_' + SYNC.rand(10).replace(/[^A-Za-z0-9]/g, '');
    L.added.push({ id: newId, type, title, body, zone, after });
    // Keep it where it was added even if that zone already has a stored order.
    if (L.zones[zone]) { const i = L.zones[zone].indexOf(after); L.zones[zone].splice(i >= 0 ? i + 1 : L.zones[zone].length, 0, newId); }
  });
  if (newId) RV.sel = newId;
  RV.dw = null; rvDrawer();
  toast(editId ? 'Block updated.' : 'Block added. Drag it anywhere, or select it to change it.');
  return true;
}
function rvDeleteBlock(k) {
  rvMutate((L) => {
    L.added = L.added.filter((a) => a.id !== k);
    for (const z of Object.keys(L.zones)) L.zones[z] = L.zones[z].filter((x) => x !== k);
    L.hidden = L.hidden.filter((x) => x !== k); L.half = L.half.filter((x) => x !== k); L.full = L.full.filter((x) => x !== k);
    L.texts = L.texts.filter((t) => t.block !== k);
  });
  RV.sel = null; rvBars();
}
function rvArrange(on) {
  if (on) {
    rvWithName(() => {
      const rk = rvRouteKey(); const me = SYNC.me().id;
      if (RV.viewOwner !== me && (SYNC.pref('view') || 'mine') !== 'mine') { SYNC.setPref('view', 'mine'); toast('Showing your own layout so you can arrange it. Use the Layout menu to look at others.'); }
      else if (RV.viewOwner && RV.viewOwner !== me) toast('You’re arranging your own version of this page. Use Copy to mine to start from ' + SYNC.name(RV.viewOwner) + '’s.');
      RV.arranging = true; RV.picking = false; RV.sel = null; RV.rk = rk;
      SYNC.setPref('tip', true);
      rvRerender();
    });
    return;
  }
  if (RV.editing) rvCommitEdit(false);
  RV.arranging = false; RV.sel = null;
  if (RV.dw && (RV.dw.mode === 'addblock' || RV.dw.mode === 'editblock')) RV.dw = null;
  rvDrawer(); rvRerender();
}
function rvCopyToMine() {
  const rk = rvRouteKey(); const owner = RV.viewOwner; const me = SYNC.me().id;
  if (!owner || owner === me) return;
  rvWithName(() => {
    const src = rvLayoutOf(owner, rk) || rvEmpty();
    const cur = rvLayoutOf(me, rk);
    rvSaveLayout(rk, rvNormLayout(JSON.parse(JSON.stringify(src))), cur ? JSON.stringify(cur) : JSON.stringify(rvEmpty()));
    SYNC.setPref('view', 'mine');
    toast('Copied ' + SYNC.name(owner) + '’s layout of this page to yours.');
    rvRerender();
  });
}
function rvAction(act, el, e) {
  const k = el.getAttribute('data-k'); const id = el.getAttribute('data-id');
  switch (act) {
    case 'pin': {
      if (k === '@app') { rvOpenDrawer({ mode: 'page' }); return; }
      const ctx = rvBlockCtx(k);
      if (RV.arranging && k !== '@app') rvSelect(k);
      rvWithName(() => rvOpenDrawer(Object.assign({ mode: 'block' }, ctx)));
      return;
    }
    case 'pagenotes': rvOpenDrawer({ mode: 'page' }); return;
    case 'dwclose': rvCloseDrawer(); return;
    case 'compose': RV.dw.compose = true; rvDrawer(true); return;
    case 'composecancel': Object.assign(RV.dw, { compose: false, anchor: null, edit: null }); rvDrawer(); return;
    case 'editnote': { const n = SYNC.get(id); if (!n || n.reviewer !== SYNC.me().id) return; Object.assign(RV.dw, { edit: id, compose: true }); rvDrawer(true); return; }
    case 'delnote': {
      const n = SYNC.get(id); if (!n || n.reviewer !== SYNC.me().id) return;
      modal('Delete this note?', '<p>The note and its status are removed for everyone. Replies from others stay hidden with it.</p>', 'Delete note', () => { SYNC.remove(id); rvDrawer(); rvRefreshPins(); toast('Note deleted.'); return true; }, { danger: true });
      return;
    }
    case 'delreply': { SYNC.remove(id); rvDrawer(); return; }
    case 'jump': rvJumpTo(id); return;
    case 'pick': rvWithName(() => { RV.picking = true; rvCloseDrawer(); rvBars(); }); return;
    case 'pickcancel': RV.picking = false; rvClearPickHot(); rvBars(); return;
    case 'arrange': rvArrange(true); return;
    case 'done': rvArrange(false); toast(rvWhere('Layout saved')); return;
    case 'undo': rvUndo(); return;
    case 'resetpage': modal('Reset this page?', '<p>Put this page back to the original layout? Notes are kept, and Undo brings your changes back.</p>', 'Reset this page', () => () => rvResetPage()); return;
    case 'tabs': rvOpenDrawer({ mode: 'tabs' }); return;
    case 'select': rvSelect(k); return;
    case 'deselect': rvSelect(null); return;
    case 'up': rvMoveSel(-1); return;
    case 'down': rvMoveSel(1); return;
    case 'hide': if (RV.sel) rvToggle('hidden', RV.sel); return;
    case 'show': rvToggle('hidden', k, false); return;
    case 'size': if (RV.sel) rvToggle(rvSizeOf(RV.sel) === 'half' ? 'full' : 'half', RV.sel, true); return;
    case 'edittext': { const b = RV.blocks.get(RV.sel); if (!b) return; const t = rvFirstText(b); if (t) rvStartEdit(t, b); else toast('This block has no text to edit.' + (RV.touch ? '' : ' Double-click a piece of text instead.')); return; }
    case 'note': if (RV.sel) rvWithName(() => rvOpenDrawer(Object.assign({ mode: 'block' }, rvBlockCtx(RV.sel)))); return;
    case 'addsel': case 'addhere': { const key = act === 'addhere' ? k : RV.sel; const m = RV.meta.get(key); rvWithName(() => rvOpenDrawer({ mode: 'addblock', after: key, label: m ? m.label : '' })); return; }
    case 'outer': rvSelect(rvParentBlock(RV.sel)); return;
    case 'editblock': rvOpenDrawer({ mode: 'editblock', block: RV.sel }); return;
    case 'delblock': { const key = RV.sel; modal('Delete this block?', '<p>Remove this suggested block from your layout?</p>', 'Delete block', () => { rvDeleteBlock(key); return true; }, { danger: true }); return; }
    case 'copymine': rvCopyToMine(); return;
    case 'status': rvMenu(false); rvStatusDialog(); return;
    case 'syncnow': SYNC.now(); toast('Syncing…'); return;
    case 'copylink': rvMenu(false); rvCopyLink(); return;
    case 'rename': rvMenu(false); rvRenameDialog(); return;
    case 'menu': rvMenu(!RV.menu); rvBars(); return;
    case 'menuclose': rvMenu(false); location.hash = '#feedback'; return;
    case 'tipok': SYNC.setPref('tip', true); rvBars(); return;
    case 'tabup': rvNavMove(el.getAttribute('data-href'), -1); rvDrawer(); return;
    case 'tabdown': rvNavMove(el.getAttribute('data-href'), 1); rvDrawer(); return;
    case 'tabsreset': rvSaveNav((N) => { N.order = []; N.hidden = []; N.names = {}; }); rvDrawer(); toast('Menu back to the original.'); return;
    case 'delpage': {
      const p = SYNC.get(id); if (!p || p.reviewer !== SYNC.me().id) return;
      modal('Delete this suggested page?', '<p>Remove the page for everyone? Notes on it stay in Review notes.</p>', 'Delete page', () => { SYNC.remove(id); rvDrawer(); rvRerender(); return true; }, { danger: true });
      return;
    }
    case 'export': rvExport(el.getAttribute('data-fmt')); return;
    case 'inclear': RV.inF = { person: 'all', page: '', type: '', status: '' }; rvRerender(); return;
    default:
  }
}
function rvRenameDialog() {
  const cur = SYNC.me().name || SYNC.me().hint || rvNameFromEmail(S && S.authEmail) || '';
  modal('Change my name', `<label class="f" for="rv-name">Your name<input id="rv-name" name="rvname" maxlength="60" value="${esc(cur)}"></label><p class="hint">New notes and layout changes use this name. It updates on the notes you already wrote too.</p>`, 'Save', (fd) => {
    const n = rvClean(fd.rvname, 60); if (n.length < 2) return 'Type your name (at least 2 letters).';
    SYNC.setName(n); toast('Name saved.'); rvBars(); rvRefreshPins(); return true;
  });
}

/* ---------- forms and fields inside the review root ---------- */
function rvForm(f) { const fd = {}; new FormData(f).forEach((v, k) => { fd[k] = v; }); return fd; }
function rvOnSubmit(e) {
  const f = e.target; if (!f || !f.getAttribute) return;
  const kind = f.getAttribute('data-rv-form'); if (!kind) return;
  e.preventDefault(); e.stopPropagation();
  const fd = rvForm(f);
  const err = (id, msg) => { const el = document.getElementById(id); if (el) el.textContent = msg; };
  if (kind === 'note') { const r = rvSaveNote(fd); if (typeof r === 'string') err('rv-note-err', r); return; }
  if (kind === 'reply') {
    const text = rvMulti(fd.rvreply, 4000); const nid = f.getAttribute('data-note'); const parent = SYNC.get(nid);
    if (!text || !parent) return;
    rvWithName(() => {
      SYNC.put({ id: SYNC.newId('n_'), kind: 'note', route: parent.route, data: { parent: nid, block: parent.data.block, label: parent.data.label, page: parent.data.page, text, name: SYNC.me().name } });
      if (RV.dw) RV.dw.focus = nid; rvDrawer(); toast('Reply saved.');
    });
    return;
  }
  if (kind === 'addblock' || kind === 'editblock') { const r = rvAddBlock(fd, kind === 'editblock' ? RV.dw && RV.dw.block : null); if (typeof r === 'string') err('rv-block-err', r); return; }
  if (kind === 'page') {
    rvWithName(() => {
      const r = rvSuggestPage(fd);
      if (/^[A-Za-z0-9]{4,40}$/.test(r)) {
        if (fd.rvpnav === 'on') rvSaveNav((N) => { if (N.order.length) N.order.push('#idea-' + r); });
        RV.dw = null; rvDrawer(); RV.arranging = true; RV.sel = null;
        toast('Page suggested. Add blocks to show what should be on it.');
        location.hash = '#idea-' + r;
      } else err('rv-page-err', r);
    });
  }
}
function rvOnChange(e) {
  const t = e.target; if (!t || !t.getAttribute) return;
  if (t.hasAttribute('data-rv-view')) {
    const v = t.value || 'mine';
    SYNC.setPref('view', v); rvMenu(false);
    if (RV.arranging && v !== 'mine') { RV.arranging = false; RV.sel = null; toast('Showing ' + (v === 'original' ? 'the original layout' : SYNC.name(v) + '’s layout') + '. Arranging always changes your own layout.'); }
    rvRerender(); return;
  }
  if (t.hasAttribute('data-rv-person')) { SYNC.setPref('person', t.value || 'all'); rvDrawer(); rvRefreshPins(); rvBars(); if (routeOf().name === 'feedback') rvRerender(); return; }
  const sid = t.getAttribute('data-rv-status');
  if (sid) {
    const st = RV_STATUS.some((x) => x[0] === t.value) ? t.value : 'open'; const note = SYNC.get(sid); if (!note) return;
    rvWithName(() => { const it = rvPut({ id: 'st:' + sid + ':' + SYNC.me().id, kind: 'status', route: note.route, data: { note: sid, status: st } }, 'This status'); rvDrawer(); rvRefreshPins(); if (it) toast('Status set to ' + rvLabelOf(RV_STATUS, st) + '.'); });
    return;
  }
  const show = t.getAttribute('data-rv-tabshow');
  if (show && rvHashOk(show)) { rvSaveNav((N) => { N.hidden = N.hidden.filter((h) => h !== show); if (!t.checked) N.hidden.push(show); }); return; }
  const name = t.getAttribute('data-rv-tabname');
  if (name && rvHashOk(name)) {
    const v = rvClean(t.value, 40); const row = rvNavRows().find((r) => r.href === name);
    rvSaveNav((N) => { if (v && (!row || v !== row.label)) N.names[name] = v; else delete N.names[name]; });
    return;
  }
  if (t.name === 'rvbtype' && RV.dw) {
    const fd = rvForm(t.form); RV.dw.type = t.value; RV.dw.draft = { type: t.value, title: fd.rvbtitle || '', body: fd.rvbbody || '' };
    rvDrawer();
    const r = document.querySelector('#rv-drawer input[name="rvbtype"][value="' + (RV_BLOCKS.some((x) => x[0] === t.value) ? t.value : 'text') + '"]'); if (r) r.focus();
    return;
  }
  if (t.name === 'rvtype') { const q = t.form && t.form.querySelector('.rv-qlabel'); if (q) q.textContent = t.value === 'love' ? 'What do you like about it?' : 'What would you change?'; }
}
function rvOnInput(e) {
  const t = e.target;
  if (t && t.name === 'rvreply') { t.rows = Math.min(6, Math.max(1, t.value.split('\n').length)); }
}

/* ---------- pin a note anywhere ---------- */
function rvClearPickHot() { for (const el of document.querySelectorAll('.rv-pickhot')) el.classList.remove('rv-pickhot'); }
function rvPickTarget(t) {
  if (!t || !t.closest) return null;
  if (t.closest('#rv-root, #dlg, [data-rv-ui]')) return null;
  if (!t.closest('#app, #top')) return null;
  return t.closest(RV_PICK_SNAP) || t;
}
function rvPicked(t) {
  RV.picking = false; rvClearPickHot(); rvBars();
  const el = rvPickTarget(t); if (!el) return;
  const rk = rvRouteKey();
  const anchor = { tag: el.tagName.toLowerCase(), snippet: rvText(el, 60) || rvClean(el.getAttribute('aria-label') || el.getAttribute('placeholder') || '', 60) };
  let ctx;
  if (el.closest('#top')) {
    const inNav = el.closest('nav.nav'); const inBanner = el.closest('.banner');
    const root = inNav || inBanner || document.querySelector('#hdr .bar') || el;
    const a = el.closest('a');
    if (inNav && a && rvHashOk(a.getAttribute('href'))) anchor.href = a.getAttribute('href');
    anchor.path = root.contains(el) ? rvPathOf(root, el) : '';
    ctx = { route: '_app', block: inNav ? 'nav' : (inBanner ? 'banner' : 'header'), label: inNav ? 'Menu' : (inBanner ? 'Preview banner' : 'Header') };
  } else {
    const b = el.closest('[data-rv-b]');
    const k = b ? b.getAttribute('data-rv-b') : '_page';
    const cell = el.closest('th, td');
    if (cell && cell.parentElement) {
      const idx = Array.from(cell.parentElement.children).indexOf(cell);
      const table = cell.closest('table'); const th = table && table.querySelector('thead tr') ? table.querySelector('thead tr').children[idx] : null;
      anchor.col = idx + 1; if (th) anchor.snippet = rvText(th, 60) || anchor.snippet; anchor.tag = th ? 'th' : anchor.tag;
      if (th && b) anchor.path = rvPathOf(b, th);
    }
    if (anchor.path == null) anchor.path = rvPathOf(b || document.getElementById('app'), el);
    ctx = { route: rk, block: k, label: b ? (RV.meta.get(k) || {}).label || 'Section' : rvPageName(rk) };
  }
  if (anchor.path == null) anchor.path = '';
  rvOpenDrawer(Object.assign({ mode: 'block', anchor, compose: true }, ctx));
}

/* ---------- editing text in arrange mode ---------- */
function rvEditable(el, block) {
  if (!el || el.closest('[data-rv-ui]') || !block.contains(el)) return false;
  if (el.matches('input, select, textarea, [data-cd]') || el.querySelector('[data-rv-b], input, select, textarea, table, [data-cd]')) return false;
  const t = rvText(el, 600); return t.length > 0 && t.length <= 500;
}
function rvTextTarget(t, block) {
  for (let n = t; n && block.contains(n); n = n.parentElement) { if (rvOwnText(n) && rvEditable(n, block)) return n; if (n === block) break; }
  return null;
}
function rvFirstText(block) {
  const h = Array.from(block.querySelectorAll('h1, h2, h3, h4, .eyebrow, p, .tn, button, a, span')).find((x) => rvOwnText(x) && rvEditable(x, block) && x.closest('[data-rv-b]') === block);
  return h || (rvOwnText(block) && rvEditable(block, block) ? block : null);
}
function rvStartEdit(el, block) {
  if (RV.editing) rvCommitEdit(false);
  const key = block.getAttribute('data-rv-b'); const path = rvPathOf(block, el);
  if (path == null) return;
  const L = RV.layout || {}; const prev = (L.texts || []).find((t) => t.block === key && t.path === path);
  RV.editing = { el, block: key, path, original: prev ? prev.original : rvText(el, 600), rk: RV.rk || rvRouteKey() };
  try { el.setAttribute('contenteditable', 'plaintext-only'); } catch (e) { /* ignore */ }
  if (!el.isContentEditable) el.setAttribute('contenteditable', 'true');
  el.classList.add('rv-editing'); el.setAttribute('spellcheck', 'true');
  const onKey = (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); rvCommitEdit(false); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); rvCommitEdit(true); }
  };
  const onPaste = (ev) => { ev.preventDefault(); const txt = (ev.clipboardData && ev.clipboardData.getData('text/plain')) || ''; document.execCommand('insertText', false, rvClean(txt, 500)); };
  const onBlur = () => setTimeout(() => { if (RV.editing && RV.editing.el === el) rvCommitEdit(false); }, 0);
  el.addEventListener('keydown', onKey); el.addEventListener('paste', onPaste); el.addEventListener('blur', onBlur);
  RV.editing.off = () => { el.removeEventListener('keydown', onKey); el.removeEventListener('paste', onPaste); el.removeEventListener('blur', onBlur); };
  el.focus();
  try { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { /* ignore */ }
  toast(RV.touch ? 'Type the new text, then tap outside it to save.' : 'Type the new text, then press Enter. Esc cancels.');
}
function rvCommitEdit(cancel) {
  const ed = RV.editing; if (!ed) return; RV.editing = null;
  if (ed.off) ed.off();
  const el = ed.el; const text = rvClean(el.textContent, 500);
  el.removeAttribute('contenteditable'); el.classList.remove('rv-editing');
  if (cancel || !text) { rvRerender(); return; }
  const changed = rvMutate((L) => {
    const i = L.texts.findIndex((t) => t.block === ed.block && t.path === ed.path);
    if (i >= 0) L.texts.splice(i, 1);
    if (text !== ed.original) L.texts.push({ block: ed.block, path: ed.path, original: ed.original, text });
  }, ed.rk); // the page that was edited, even if the route changed while the edit was open
  if (!changed) rvRerender();
}
/* ---------- global events (capture phase, registered once) ---------- */
function rvOnClick(e) {
  const t = e.target; if (!t || !t.closest) return;
  if (RV.menu && !t.closest('.rv-menu') && !t.closest('[data-rv="menu"]')) { rvMenu(false); rvBars(); }
  if (RV.picking && !t.closest('#rv-root') && !t.closest('#dlg')) {
    if (t.closest('#app, #top')) { e.preventDefault(); e.stopPropagation(); rvPicked(t); }
    return;
  }
  const c = t.closest('[data-rv]');
  if (c && (c.closest('#rv-root') || c.closest('#dlg') || c.closest('[data-rv-ui]') || c.closest('#app') || c.closest('#top'))) {
    if (c.disabled) return;
    const act = c.getAttribute('data-rv');
    if (c.tagName === 'A' && act === 'menuclose') { rvMenu(false); rvBars(); return; }
    e.preventDefault(); e.stopPropagation();
    if (c.closest('#dlg')) closeDialog();
    try { rvAction(act, c, e); } catch (err) { console.warn('Review layer action failed', err); }
    return;
  }
  const demo = t.closest('[data-rv-demo]');
  if (demo && !RV.arranging) { e.preventDefault(); e.stopPropagation(); toast('Suggested button: ' + (RV.added.get(demo) || 'no description')); return; }
  if (RV.arranging && t.closest('#app')) {
    e.preventDefault(); e.stopPropagation();
    if (RV.editing && RV.editing.el.contains(t)) return;
    const b = t.closest('[data-rv-b]'); if (b) rvSelect(b.getAttribute('data-rv-b'));
    return;
  }
  // Links inside the drawer (for example to a suggested page) close it on phones so the page is visible.
  if (t.closest('#rv-drawer a[href^="#"]') && isPhone()) setTimeout(rvCloseDrawer, 0);
}
function rvOnDblClick(e) {
  if (!RV.arranging) return;
  const t = e.target; if (!t || !t.closest || !t.closest('#app') || t.closest('[data-rv-ui]')) return;
  e.preventDefault(); e.stopPropagation();
  const b = t.closest('[data-rv-b]'); if (!b) return;
  const k = b.getAttribute('data-rv-b'); const m = RV.meta.get(k);
  if (m && m.added) { rvSelect(k); rvOpenDrawer({ mode: 'editblock', block: k }); return; }
  const el = rvTextTarget(t, b);
  if (!el) { toast('Double-click directly on a heading, label or piece of text to change it.'); return; }
  rvSelect(k); rvStartEdit(el, b);
}
function rvOnKey(e) {
  if (e.key !== 'Escape') return;
  if (RV.picking) { RV.picking = false; rvClearPickHot(); rvBars(); e.stopPropagation(); return; }
  if (RV.menu) { rvMenu(false); rvBars(); return; }
  const d = document.getElementById('rv-drawer');
  if (RV.dw && d && (d.contains(document.activeElement) || !document.querySelector('#dlg[open]'))) { rvCloseDrawer(); e.stopPropagation(); return; }
  if (RV.arranging && RV.sel) rvSelect(null);
}
function rvOnOver(e) {
  const t = e.target; if (!t || !t.closest) return;
  if (RV.picking) {
    const el = rvPickTarget(t);
    if (el !== RV.pickHot) { rvClearPickHot(); RV.pickHot = el; if (el) el.classList.add('rv-pickhot'); }
    return;
  }
  // A pin that moved out of its block (see rvPlacePins) still belongs to it.
  const pin = t.closest('#app .rv-pin.rv-out[data-k]');
  const b = (pin && RV.blocks.get(pin.getAttribute('data-k'))) || t.closest('#app [data-rv-b]');
  if (b !== RV.hot) {
    if (RV.hot) RV.hot.classList.remove('rv-hot');
    for (const x of document.querySelectorAll('#app .rv-pinhot')) x.classList.remove('rv-pinhot');
    RV.hot = b;
    if (b) {
      b.classList.add('rv-hot');
      for (const x of document.querySelectorAll('#app .rv-pin.rv-out')) if (x.getAttribute('data-k') === b.getAttribute('data-rv-b')) x.classList.add('rv-pinhot');
    }
  }
}
function rvOnFocusIn(e) {
  const t = e.target;
  if (RV.arranging && t && t.classList && t.classList.contains('rv-handle')) { const k = t.getAttribute('data-k'); if (k !== RV.sel) rvSelect(k); }
}
function rvOnAppSubmit(e) {
  if (RV.arranging && e.target && e.target.closest && e.target.closest('#app')) { e.preventDefault(); e.stopPropagation(); }
}
function rvSetup() {
  if (RV.inited) return; RV.inited = true;
  RV.touch = rvIsTouch();
  rvRoot();
  window.addEventListener('click', rvOnClick, true);
  window.addEventListener('dblclick', rvOnDblClick, true);
  window.addEventListener('submit', rvOnAppSubmit, true);
  document.addEventListener('keydown', rvOnKey, true);
  document.addEventListener('mouseover', rvOnOver, true);
  document.addEventListener('focusin', rvOnFocusIn, true);
  SYNC.subscribe(rvOnSync);
  const box = document.getElementById('toasts');
  if (box && typeof MutationObserver === 'function') {
    new MutationObserver((muts) => {
      for (const m of muts) for (const t of m.addedNodes) {
        if (t.nodeType !== 1) continue;
        for (const o of Array.from(box.children)) if (o !== t && o.textContent === t.textContent) o.remove();
        setTimeout(() => t.remove(), 3000);
      }
      while (box.children.length > 2) box.firstElementChild.remove();
    }).observe(box, { childList: true });
  }
  const sortJs = document.querySelector('script[src*="/Sortable.min.js"]');
  if (sortJs && !window.Sortable) sortJs.addEventListener('load', () => { if (RV.on) rvRerender(); });
  setInterval(() => { if (RV.on && !RV.arranging) rvBars(); }, 30000);
  setTimeout(() => SYNC.start(), 0);
}
function rvOnSync(changed, reason) {
  RV.stIdx = null;
  try {
    if (typeof S !== 'undefined' && S) S.fb = REVIEW.feedbackList();
    if (reason === 'reset') { RV.undo = Object.create(null); RV.sel = null; RV.dw = null; }
    if (!RV.on) return;
    if (reason === 'rejected' && changed.length) {
      const why = Array.from(new Set(changed.map((it) => rvReason(it._err))));
      toast((changed.length === 1 ? 'A change was' : changed.length + ' changes were') + ' not synced: ' + why.join(', ') + (why.includes(RV_REASONS.quota) ? '. Delete some notes or layout changes to make room.' : '.'));
    }
    if (reason === 'reset') { rvRerender(); return; }
    rvBars();
    if (reason !== 'remote' || !changed.length) return;
    const rk = rvRouteKey(); const r = routeOf().name;
    const needs = r === 'feedback' || r === 'idea' || changed.some((it) => (it.kind === 'layout' && (it.route === rk || it.route === RV_NAV)) || it.kind === 'page');
    if (needs) rvRerender(); else rvRefreshPins();
    rvDrawer();
  } catch (e) { console.warn('Review layer: sync update failed', e); }
}
function rvRefreshPins() {
  try { if (RV.on && !RV.dragging && !RV.editing) { rvDecorate(rvRouteKey()); rvHeaderDecor(); rvBars(); } } catch (e) { console.warn('Review layer', e); }
}
function rvJumpTo(noteId) {
  const n = SYNC.get(noteId); if (!n || n.deleted) return;
  const target = n.route === '_app' ? (location.hash || '#today') : (rvHashOk(n.data.instance) ? n.data.instance : '#' + (n.route.indexOf('idea-') === 0 ? n.route : rvSafeKey(n.route) || 'today'));
  RV.jump = { id: noteId, route: n.route, block: n.data.block };
  RV.arranging = false; RV.picking = false;
  if ((location.hash || '#today') === target) { rvRerender(); } else location.hash = target;
}
function rvJumpCheck() {
  const j = RV.jump; if (!j) return;
  RV.jump = null;
  const n = SYNC.get(j.id); if (!n) return;
  setTimeout(() => {
    try {
      const el = j.route === '_app' ? document.querySelector('#hdr nav.nav') : RV.blocks.get(j.block);
      const anchorEl = n.data.anchor ? rvAnchorEl(rvAnchorRoot(n), n.data.anchor) : null;
      const show = anchorEl || el;
      if (show) { show.scrollIntoView({ block: 'center', behavior: 'smooth' }); show.classList.add('rv-flash'); setTimeout(() => show.classList.remove('rv-flash'), 2600); }
      const ctx = j.route === '_app' ? { route: '_app', block: n.data.block, label: 'Header and menu' } : { route: j.route, block: j.block, label: (RV.meta.get(j.block) || {}).label || rvClean(n.data.label, 80) };
      rvOpenDrawer(Object.assign({ mode: 'block', focus: j.id }, ctx));
      rvDrawer(true);
    } catch (e) { console.warn('Review layer: jump failed', e); }
  }, 120);
}

/* ---------- the hooks the app calls ---------- */
const REVIEW = {
  pending: false,
  busy() {
    if (RV.dragging) return true;
    const ae = document.activeElement;
    return !!(ae && ae.isContentEditable && ae.closest && ae.closest('#app'));
  },
  feedbackList() {
    return SYNC.list('feedback').map((f) => ({ id: f.id, category: rvClean(f.data.category, 40), text: rvMulti(f.data.text, 4000), page: rvClean(f.data.page, 200), at: f.data.at || SYNC.created(f), by: SYNC.name(f.reviewer) }))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  },
  saveFeedback(item) {
    const o = item || {};
    SYNC.put({ id: SYNC.newId('fb_'), kind: 'feedback', route: (typeof S !== 'undefined' && S && S.signedIn) ? rvRouteKey() : 'signin', data: { category: rvClean(o.category, 40) || 'Other', text: rvMulti(o.text, 4000), page: rvClean(o.page, 200), at: typeof o.at === 'string' ? o.at.slice(0, 40) : new Date().toISOString(), name: SYNC.me().name || SYNC.me().hint } });
  },
};
function afterHeader() {
  try {
    rvSetup();
    if (!(typeof S !== 'undefined' && S && S.signedIn)) return;
    RV.on = true;
    rvApplyNav();
    rvHeaderDecor();
    rvNavScroll();
  } catch (e) { console.warn('Review layer: header update failed', e); }
}
function afterRender() {
  try {
    rvSetup();
    rvDestroySortables();
    RV.hot = null; RV.pickHot = null;
    RV.on = !!(typeof S !== 'undefined' && S && S.signedIn);
    if (!RV.on) { RV.arranging = false; RV.picking = false; RV.sel = null; RV.dw = null; rvClearDecor(document.getElementById('top')); rvDrawer(); rvBars(); return; }
    if (S.authEmail) SYNC.setHint(rvNameFromEmail(S.authEmail));
    const rk = rvRouteKey();
    if (RV.rk !== rk) { RV.sel = null; RV.rk = rk; if (RV.dw && RV.dw.mode !== 'tabs' && !RV.jump) RV.dw = null; }
    const app = document.getElementById('app');
    const ae = document.activeElement; let sel = null;
    try { if (ae && typeof ae.selectionStart === 'number') sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) { sel = null; }
    rvScan(app);
    const owner = rvViewOwner(rk);
    rvApply(owner ? rvLayoutOf(owner, rk) : null, owner);
    if (ae && ae !== document.activeElement && document.body.contains(ae)) { try { ae.focus({ preventScroll: true }); if (sel) ae.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } }
    if (RV.sel && !RV.blocks.has(RV.sel)) RV.sel = null;
    rvDecorate(rk);
    rvHeaderDecor();
    if (RV.arranging) rvSortables();
    rvBars(); rvDrawer();
    rvJumpCheck();
  } catch (e) { console.warn('Review layer: page update failed', e); }
}
/* ---------- changes summary, in words ---------- */
function rvLcs(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = new Set(); let i = 0, j = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { out.add(a[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  return out;
}
function rvSummary(L, owner, rk) {
  const out = []; if (!L) return out;
  const addedIds = new Set(L.added.map((a) => a.id));
  const lab = (k) => { const a = L.added.find((x) => x.id === k); return '‘' + rvClean(a ? a.title : (L.labels[k] || k), 60) + '’'; };
  for (const [zk, fin] of Object.entries(L.zones)) {
    const base = (L.base[zk] || []).filter((k) => !addedIds.has(k)); const f = fin.filter((k) => !addedIds.has(k));
    const keep = rvLcs(base.filter((k) => f.includes(k)), f.filter((k) => base.includes(k)));
    f.forEach((k, i) => {
      if (keep.has(k)) return;
      if (!base.includes(k)) { out.push('moved ' + lab(k) + ' into ' + (L.zl[zk] || 'another area')); return; }
      const next = f.slice(i + 1).find((x) => keep.has(x)) || f[i + 1];
      const prev = f.slice(0, i).reverse().find((x) => keep.has(x)) || f[i - 1];
      out.push(next ? 'moved ' + lab(k) + ' above ' + lab(next) : (prev ? 'moved ' + lab(k) + ' below ' + lab(prev) : 'moved ' + lab(k)));
    });
  }
  for (const k of L.hidden) out.push('hid ' + lab(k));
  for (const k of L.half) out.push('made ' + lab(k) + ' half width');
  for (const k of L.full) out.push('made ' + lab(k) + ' full width');
  for (const t of L.texts) out.push('renamed ‘' + rvClean(t.original, 60) + '’ → ‘' + rvClean(t.text, 60) + '’' + (RV.orphans.has(owner + '|' + t.block + '|' + t.path + '|' + t.original) ? ' (no longer matches the page)' : ''));
  for (const a of L.added) out.push('added a ' + rvLabelOf(RV_BLOCKS, a.type) + ' block ‘' + rvClean(a.title, 60) + '’');
  return out;
}
function rvNavSummary(N) {
  const out = []; if (!N) return out;
  const lab = (h) => '‘' + (N.labels[h] || h.slice(1)) + '’';
  if (N.order.length) out.push('reordered the menu: ' + N.order.slice(0, 20).map((h) => N.names[h] || N.labels[h] || h.slice(1)).join(', '));
  for (const h of N.hidden) out.push('hid tab ' + lab(h));
  for (const [h, n] of Object.entries(N.names)) out.push('renamed tab ' + lab(h) + ' → ‘' + n + '’');
  return out;
}
function rvAllSummaries() {
  const by = rvDict();
  for (const it of rvOwnLayouts()) {
    const lines = it.route === RV_NAV ? rvNavSummary(rvNormNav(it.data)) : rvSummary(rvNormLayout(it.data), it.reviewer, it.route);
    if (!lines.length) continue;
    const r = (by[it.reviewer] = by[it.reviewer] || rvDict());
    r[it.route === RV_NAV ? 'Menu' : rvPageName(it.route)] = lines;
  }
  for (const p of rvPages()) { const r = (by[p.reviewer] = by[p.reviewer] || rvDict()); (r['Suggested pages'] = r['Suggested pages'] || []).push('suggested a page ‘' + rvClean(p.data.title, 80) + '’'); }
  return by;
}

/* ---------- Review notes page (#feedback) ---------- */
EXT_FIELD.rvInbox = (el) => { const k = el.dataset.k; if (['person', 'page', 'type', 'status'].includes(k)) RV.inF[k] = el.value; };
function rvRows() {
  const f = RV.inF; const rows = [];
  for (const n of rvNotes(null)) {
    if (!rvPersonOk(n, f.person)) continue;
    if (f.page && n.route !== f.page) continue;
    if (f.type && (f.type === 'feedback' || n.data.type !== f.type)) continue;
    const st = rvStatusOf(n.id);
    if (f.status && st.status !== f.status) continue;
    rows.push({ kind: 'note', it: n, st });
  }
  for (const fb of SYNC.list('feedback')) {
    if (!rvPersonOk(fb, f.person)) continue;
    if (f.page && fb.route !== f.page) continue;
    if (f.type && f.type !== 'feedback') continue;
    if (f.status && f.status !== 'open') continue;
    rows.push({ kind: 'feedback', it: fb, st: { status: 'open' } });
  }
  return rows;
}
function rvInboxHtml() {
  const f = RV.inF; const rows = rvRows(); const me = SYNC.me().id;
  const routes = Array.from(new Set(rvNotes(null).map((n) => n.route).concat(SYNC.list('feedback').map((x) => x.route)))).filter(Boolean);
  const sel = (k, label, opts) => `<label class="f" for="rv-in-${k}">${label}<select id="rv-in-${k}" data-on="rvInbox" data-k="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}"${f[k] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const groups = new Map();
  for (const r of rows) {
    const page = r.kind === 'feedback' ? (rvClean(r.it.data.page, 80).replace(/\s*\(#.*\)$/, '') || rvPageName(r.it.route)) : rvPageName(r.it.route);
    const section = r.kind === 'feedback' ? 'Feedback button' : (rvClean(r.it.data.label, 80) || 'Section');
    if (!groups.has(page)) groups.set(page, new Map());
    const g = groups.get(page); if (!g.has(section)) g.set(section, []); g.get(section).push(r);
  }
  const rowHtml = (r) => {
    const it = r.it; const d = it.data; const who = SYNC.name(it.reviewer);
    if (r.kind === 'feedback') return `<li class="rv-inrow rv-infb"><span class="rv-inmeta"><strong>${esc(who)}</strong> <span class="muted small">${esc(rvWhen(d.at || SYNC.created(it)))}</span> <span class="pill">${esc(rvClean(d.category, 40) || 'Feedback')}</span></span><span class="rv-t">${esc(rvMulti(d.text, 1200))}</span></li>`;
    const reps = rvReplies(it.id).length;
    return `<li><button type="button" class="rv-inrow" data-rv="jump" data-id="${esc(it.id)}"><span class="rv-inmeta"><strong>${esc(who)}</strong>${it.reviewer === me ? ' <span class="muted small">(you)</span>' : ''} <span class="muted small">${esc(rvWhen(SYNC.created(it)))}${d.instance && rvHashOk(d.instance) && d.instance !== '#' + it.route ? ' · ' + esc(d.instance) : ''}</span>
      <span class="pill">${esc(rvLabelOf(RV_TYPES, d.type))}</span>${d.priority === 'high' ? '<span class="pill warn">High</span>' : ''}<span class="pill${r.st.status === 'done' ? ' ok' : ''}">${esc(rvLabelOf(RV_STATUS, r.st.status))}</span>${reps ? `<span class="small muted">${reps} repl${reps === 1 ? 'y' : 'ies'}</span>` : ''}</span>
      <span class="rv-t">${esc(rvMulti(d.change, 600))}</span>${d.better ? `<span class="rv-t muted"><strong>Better:</strong> ${esc(rvMulti(d.better, 400))}</span>` : ''}${d.anchor ? `<span class="small muted">Pinned to the ${esc(rvAnchorText(d.anchor))}</span>` : ''}</button></li>`;
  };
  const sums = rvAllSummaries();
  const st = SYNC.status(); const [, long] = rvChip();
  const reviewers = Object.values(SYNC.reviewers());
  return `<div class="stack">
    <div class="pagehead"><div class="stack" style="gap:6px"><h1>Review notes</h1><p class="muted">Every note, suggestion and layout change from everyone reviewing this preview, grouped by page and section. Click a note to jump to it.</p></div>
      <div class="row">${['md', 'csv', 'json'].map((x) => `<button type="button" class="btn sm" data-rv="export" data-fmt="${x}">Export ${x === 'md' ? 'Markdown' : x.toUpperCase()}</button>`).join('')}</div></div>
    <section class="card rv-incard"><div class="row between"><h2>Sync</h2><span class="small muted">${esc(long)}${st.dirty ? ' · ' + st.dirty + (rvSyncing() ? ' waiting to sync' : (st.storageOk ? ' saved in this browser' : ' not saved on this device')) : ''}</span></div>
      <p class="small muted" style="margin-top:6px">${SYNC.code() ? 'Notes, layouts and suggested pages sync to Aidan automatically.' : 'This browser has no review link, so notes stay here. Open the review link Aidan sent, or <button type="button" class="rv-link" data-rv="status">enter the review code</button>.'}</p>
      ${reviewers.length ? `<ul class="plain small rv-people">${reviewers.map((p) => `<li><span class="avatar rv-av" aria-hidden="true">${esc(rvInit(p.name))}</span> ${esc(p.name || 'Reviewer')}${p.id === me ? ' (you)' : ''}${p.last_seen ? ` <span class="muted">· last seen ${esc(rvWhen(p.last_seen))}</span>` : ''}</li>`).join('')}</ul>` : ''}</section>
    <div class="filters">
      ${sel('person', 'Person', [['all', 'Everyone'], ['mine', 'Only mine']].concat(rvPeople().map((p) => [p.id, p.name])))}
      ${sel('page', 'Page', [['', 'All pages']].concat(routes.map((r) => [r, rvPageName(r)])))}
      ${sel('type', 'Type', [['', 'All types']].concat(RV_TYPES, [['feedback', 'Feedback button']]))}
      ${sel('status', 'Status', [['', 'Any status']].concat(RV_STATUS))}
      ${f.person !== 'all' || f.page || f.type || f.status ? '<button type="button" class="btn sm ghost" data-rv="inclear">Clear filters</button>' : ''}
    </div>
    <p class="small muted">${rows.length} item${rows.length === 1 ? '' : 's'}.</p>
    ${groups.size ? Array.from(groups).map(([page, secs]) => `<section class="card rv-ingroup" aria-label="${esc(page)}"><h2>${esc(page)}</h2>${Array.from(secs).map(([s, list]) => `<h3 class="rv-insec">${esc(s)}</h3><ul class="plain rv-inlist">${list.map(rowHtml).join('')}</ul>`).join('')}</section>`).join('')
      : '<p class="allclear">No notes yet. Use a <strong>+ Note</strong> pin on any section, or <strong>Pin a note</strong> in the review bar.</p>'}
    <section class="card" aria-label="Changes summary"><h2>Changes summary</h2>
      ${Object.keys(sums).length ? Object.entries(sums).map(([rid, pages]) => `<div class="rv-sum"><h3>${esc(SYNC.name(rid))}${rid === me ? ' (you)' : ''}</h3>${Object.entries(pages).map(([p, lines]) => `<p class="small" style="margin-top:6px"><strong>${esc(p)}:</strong></p><ul class="rv-sumlist small">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`).join('')}</div>`).join('') : '<p class="muted small" style="margin-top:6px">Nobody has rearranged a page yet. Choose <strong>Arrange this page</strong> to try it.</p>'}</section>
    ${rvPages().length ? `<section class="card" aria-label="Suggested pages"><h2>Suggested pages</h2><ul class="plain" style="margin-top:8px">${rvPages().map((p) => `<li class="row between"><a href="#idea-${esc(p.id.slice(3))}">${esc(rvClean(p.data.title, 80) || 'Untitled page')}</a><span class="small muted">by ${esc(SYNC.name(p.reviewer))}</span></li>`).join('')}</ul></section>` : ''}
  </div>`;
}
function viewReviewInbox() {
  try { return rvInboxHtml(); } catch (e) { console.warn('Review layer: inbox failed', e); return '<div class="stack"><h1>Review notes</h1><p class="muted">Review notes could not be shown. Reload the page to try again.</p></div>'; }
}

/* ---------- exports for the code clean-up ---------- */
function rvDownload(name, mime, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast('This browser blocked the download.'); }
}
function rvExportData() {
  const notes = rvNotes(null).map((n) => {
    const st = rvStatusOf(n.id);
    return { id: n.id, page: rvPageName(n.route), route: n.route, section: rvClean(n.data.label, 120), block: n.data.block, instance: n.data.instance || '', author: SYNC.name(n.reviewer), created: SYNC.created(n),
      type: rvLabelOf(RV_TYPES, n.data.type), priority: rvLabelOf(RV_PRIO, n.data.priority || 'medium'), status: rvLabelOf(RV_STATUS, st.status), status_by: st.by ? SYNC.name(st.by) : '',
      change: n.data.change || '', better: n.data.better || '', pinned_to: n.data.anchor ? rvAnchorText(n.data.anchor) : '',
      replies: rvReplies(n.id).map((r) => ({ author: SYNC.name(r.reviewer), created: SYNC.created(r), text: r.data.text || '' })) };
  });
  const feedback = SYNC.list('feedback').map((f) => ({ id: f.id, author: SYNC.name(f.reviewer), created: f.data.at || SYNC.created(f), category: f.data.category || '', page: f.data.page || '', text: f.data.text || '' }));
  const named = rvDict(); for (const [rid, pages] of Object.entries(rvAllSummaries())) named[SYNC.name(rid)] = pages;
  return { exported_at: new Date().toISOString(), reviewers: Object.values(SYNC.reviewers()).map((r) => ({ name: r.name, last_seen: r.last_seen })), notes, feedback, changes: named,
    layouts: rvOwnLayouts().map((l) => ({ author: SYNC.name(l.reviewer), route: l.route, data: l.data })), pages: rvPages().map((p) => ({ id: p.id, author: SYNC.name(p.reviewer), title: p.data.title, about: p.data.about || '' })) };
}
function rvExport(fmt) {
  const d = rvExportData(); const stamp = new Date().toISOString().slice(0, 10);
  if (fmt === 'json') { rvDownload('operon-review-notes-' + stamp + '.json', 'application/json', JSON.stringify(d, null, 2)); return; }
  if (fmt === 'csv') {
    const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const head = ['kind', 'created', 'author', 'page', 'section', 'instance', 'type', 'priority', 'status', 'status_by', 'change', 'better', 'pinned_to', 'replies'];
    const lines = [head.join(',')];
    for (const n of d.notes) lines.push(['note', n.created, n.author, n.page, n.section, n.instance, n.type, n.priority, n.status, n.status_by, n.change, n.better, n.pinned_to, n.replies.map((r) => r.author + ': ' + r.text).join(' | ')].map(cell).join(','));
    for (const f of d.feedback) lines.push(['feedback', f.created, f.author, f.page, '', '', f.category, '', '', '', f.text, '', '', ''].map(cell).join(','));
    rvDownload('operon-review-notes-' + stamp + '.csv', 'text/csv', '﻿' + lines.join('\r\n'));
    return;
  }
  const md = ['# Operon partner preview: review notes', '', 'Exported ' + new Date().toLocaleString('en-ZA') + '.', ''];
  // Reviewer text is plain text here: no HTML, links, images, emphasis or headings can come from it.
  const oneLine = (s) => String(s == null ? '' : s).replace(/\s*[\r\n]+\s*/g, ' / ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_[\]#|~])/g, '\\$1');
  const byPage = new Map();
  for (const n of d.notes) {
    if (!byPage.has(n.page)) byPage.set(n.page, new Map());
    const secs = byPage.get(n.page); if (!secs.has(n.section)) secs.set(n.section, []); secs.get(n.section).push(n);
  }
  for (const [page, secs] of byPage) {
    md.push('## ' + oneLine(page), '');
    for (const [sec, list] of secs) {
      md.push('### ' + oneLine(sec), '');
      for (const n of list) {
        md.push(`- **${oneLine(n.author)}** (${oneLine(n.type)}, ${oneLine(n.priority)}, ${oneLine(n.status)}${n.status_by ? ' by ' + oneLine(n.status_by) : ''}${n.instance ? ', ' + oneLine(n.instance) : ''}): ${oneLine(n.change)}` + (n.better ? ` _Better:_ ${oneLine(n.better)}` : '') + (n.pinned_to ? ` _(pinned to the ${oneLine(n.pinned_to)})_` : ''));
        for (const r of n.replies) md.push(`  - ${oneLine(r.author)}: ${oneLine(r.text)}`);
      }
      md.push('');
    }
  }
  if (d.feedback.length) { md.push('## Feedback button', ''); for (const f of d.feedback) md.push(`- **${oneLine(f.author)}** (${oneLine(f.category)}, ${oneLine(f.page)}): ${oneLine(f.text)}`); md.push(''); }
  md.push('## Changes summary', '');
  const ch = Object.entries(d.changes);
  if (!ch.length) md.push('No layout changes yet.', '');
  for (const [who, pages] of ch) { md.push('### ' + oneLine(who), ''); for (const [p, lines] of Object.entries(pages)) { md.push('- ' + oneLine(p) + ':'); for (const l of lines) md.push('  - ' + oneLine(l)); } md.push(''); }
  rvDownload('operon-review-notes-' + stamp + '.md', 'text/markdown', md.join('\n'));
}

/* ---------- suggested pages (#idea-<id>) ---------- */
function viewIdeaPage(id) {
  try {
    const pg = rvPage(id);
    if (!pg) return `<div class="stack"><nav class="crumbs" aria-label="Breadcrumb"><a href="#feedback">Review notes</a></nav><h1>Suggested page not found</h1><p class="muted">It may have been deleted, or it has not synced to this browser yet.</p></div>`;
    const about = rvMulti(pg.data.about, 1000);
    return `<div class="stack" data-rv-zone="idea">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#feedback">Review notes</a><span>/</span><span>Suggested page</span></nav>
      <div class="pagehead"><div class="stack" style="gap:6px"><p class="eyebrow">Suggested page · by ${esc(SYNC.name(pg.reviewer))}</p><h1>${esc(rvClean(pg.data.title, 80) || 'Untitled page')}</h1>${about ? `<p class="muted rv-pre">${esc(about)}</p>` : ''}</div></div>
      <p class="allclear rv-idea-empty">This page is empty so far. Choose <strong>Arrange this page</strong>, then <strong>+ Add a block here</strong> to sketch what should be on it.</p>
    </div>`;
  } catch (e) { console.warn('Review layer: idea page failed', e); return '<div class="stack"><h1>Suggested page</h1></div>'; }
}
