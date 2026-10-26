// Shared field-handler map used by onField() for data-on inputs. Keep it first: collections.js uses it too.
const EXT_FIELD = {};

/* Local-first synced store for review notes, statuses, layouts, suggested pages and feedback.
   - Everything is written to localStorage first ('operon-preview-review-v1'), then pushed after a 1.5 s debounce.
   - Pulls run every 20 s while the tab is visible, when it becomes visible again and when the connection returns.
   - The endpoint needs no key: the review code (from ?review=…) and this browser's reviewer secret are the only credentials.
   - Server contract: POST {code, reviewer:{id,secret,name}, items:[{id,kind,route,data,deleted}], since}
     → {now, me, items, more, next_since, reviewers, accepted, rejected}. Reviewers can only write rows they own. */
const SYNC = (() => {
  const ENDPOINT = 'https://xofceephwnlxqrtuqpdl.supabase.co/functions/v1/operon-preview-sync';
  const K_STORE = 'operon-preview-review-v1';
  const K_ME = 'operon-preview-review-v1-me';
  const K_CODE = 'operon-preview-review-v1-code';
  const K_LEGACY = 'operon-partner-preview-v1-feedback';
  const ID_RE = /^[A-Za-z0-9_:.\-]{1,120}$/;
  const KINDS = ['note', 'status', 'layout', 'page', 'feedback'];
  const PUSH_DELAY = 1500, POLL_MS = 20000, OVERLAP_MS = 5000, MAX_BATCH = 200, MAX_BODY = 250000, TIMEOUT_MS = 20000;
  // Synced strings are used as keys: these never are, and keyed objects have no prototype.
  const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  let storageOk = true;
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); storageOk = true; return true; } catch (e) { storageOk = false; return false; } },
  };
  const parse = (s, d) => { if (s == null) return d; try { const v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } };
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const okId = (id) => typeof id === 'string' && ID_RE.test(id) && !BAD_KEYS.has(id);
  function dict(o) {
    const d = Object.create(null);
    if (isObj(o)) for (const k of Object.keys(o)) if (!BAD_KEYS.has(k)) d[k] = o[k];
    return d;
  }
  // Short tag for a review code, so the store knows which space its synced rows came from.
  function spaceTag(c) {
    c = String(c || ''); if (!c) return '';
    let h = 0x811c9dc5;
    for (let i = 0; i < c.length; i++) { h ^= c.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 's' + h.toString(36) + '.' + c.length;
  }

  function bytes(n) {
    const a = new Uint8Array(n);
    try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256); }
    return a;
  }
  const hex = (n) => Array.from(bytes(n), (b) => b.toString(16).padStart(2, '0')).join('');
  function rand(n) {
    const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
    return Array.from(bytes(n), (b) => abc[b % abc.length]).join('');
  }
  function uuid4() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall back below */ }
    const b = bytes(16); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  // Server timestamps look like 2026-10-26T08:12:33.123456+00:00 (fraction length varies). Compare in microseconds.
  function tsKey(s) {
    const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(String(s || ''));
    if (!m) return 0;
    let ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const tz = m[8];
    if (tz && tz !== 'Z') { const sign = tz[0] === '-' ? -1 : 1; const d = tz.slice(1).replace(':', ''); ms -= sign * ((+d.slice(0, 2)) * 60 + (+(d.slice(2, 4) || 0))) * 60000; }
    const frac = ((m[7] || '') + '000000').slice(0, 6);
    return ms * 1000 + Number(frac);
  }

  /* ---------- state ---------- */
  let db = parse(ls.get(K_STORE), {});
  if (!isObj(db)) db = {};
  db.items = dict(db.items);
  for (const id of Object.keys(db.items)) {
    const it = db.items[id];
    if (!isObj(it) || !okId(id) || it.id !== id) delete db.items[id];
    else if (it.deleted) it.data = {}; // copies of deleted items keep no content
  }
  db.reviewers = dict(db.reviewers);
  db.prefs = dict(db.prefs);
  if (typeof db.since !== 'string') db.since = null;

  let me = parse(ls.get(K_ME), null);
  if (!isObj(me) || !/^[0-9a-f-]{36}$/i.test(String(me.id || '')) || !/^[0-9a-f]{64}$/.test(String(me.secret || ''))) {
    me = { id: uuid4(), secret: hex(32), name: '', hint: '', asked: false };
    ls.set(K_ME, JSON.stringify(me));
  }
  const dropped = new Set(); // ids this tab removed on purpose: another tab's copy must not bring them back
  let code = String(ls.get(K_CODE) || '').trim();
  if (typeof db.space !== 'string') db.space = spaceTag(code); // stores from before spaces were recorded belong to the stored code
  // A different review code is a different space: its synced rows and reviewers are not carried across. Only my own changes
  // that never reached any server go with it (a browser with no code moves its local notes into its first space this way).
  function useSpace(c) {
    const t = spaceTag(c);
    if (db.space === t) return false;
    const old = db.space; db.space = t;
    if (!old) { save(); return false; }
    for (const id of Object.keys(db.items)) {
      const it = db.items[id];
      if (!(it.reviewer === me.id && it._dirty && !it.updated_at)) { delete db.items[id]; dropped.add(id); }
    }
    db.reviewers = Object.create(null); db.since = null; db.state = '';
    delete db.prefs.view; delete db.prefs.person;
    save(); return true;
  }
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('review')) {
      const c = String(u.searchParams.get('review') || '').trim();
      if (c) { code = c; ls.set(K_CODE, c); useSpace(c); if (db.state === 'badcode') db.state = ''; }
      u.searchParams.delete('review');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    }
  } catch (e) { /* old browser: the code stays in the address bar */ }

  let state = code ? (db.state === 'badcode' ? 'badcode' : 'idle') : 'local';
  let lastSync = null, failures = 0, running = false, again = false, pushT = 0, retryT = 0, started = false, maxBatch = MAX_BATCH;
  const subs = [];

  /* ---------- this browser's copy, shared by every open tab ---------- */
  // Which of two copies of one item is the later version: a later local edit (from either tab) wins, then the newer server copy.
  function newer(a, b) {
    const la = tsKey(a._at), lb = tsKey(b._at);
    if (la !== lb) return la > lb;
    const ua = tsKey(a.updated_at), ub = tsKey(b.updated_at);
    if (ua !== ub) return ua > ub;
    return !a._dirty && !!b._dirty;
  }
  // Merge another tab's saved store into memory, item by item. Returns the items that changed here.
  function absorb(s) {
    const changed = [];
    if (!isObj(s) || !isObj(s.items) || String(s.space || '') !== String(db.space || '')) return changed;
    for (const id of Object.keys(s.items)) {
      const o = s.items[id];
      if (!okId(id) || dropped.has(id) || !isObj(o) || o.id !== id || !KINDS.includes(o.kind) || !isObj(o.data)) continue;
      const loc = db.items[id];
      if (loc && !newer(o, loc)) continue;
      if (o.deleted) o.data = {};
      db.items[id] = o; changed.push(o);
    }
    if (isObj(s.reviewers)) for (const id of Object.keys(s.reviewers)) if (!BAD_KEYS.has(id) && !db.reviewers[id] && isObj(s.reviewers[id])) db.reviewers[id] = s.reviewers[id];
    return changed;
  }
  function save() {
    absorb(parse(ls.get(K_STORE), null)); // another tab may have saved since this one loaded: keep its changes
    if (ls.set(K_STORE, JSON.stringify(db))) return true;
    // Storage is full (or blocked). Keep what exists only here, unsynced changes and my own items; everything else comes
    // back from the server on the next full pull after a reload.
    const slim = Object.assign({}, db, { items: {}, since: null });
    for (const id of Object.keys(db.items)) { const it = db.items[id]; if (it._dirty || it.reviewer === me.id) slim.items[id] = it; }
    return ls.set(K_STORE, JSON.stringify(slim));
  }
  function saveMe() { ls.set(K_ME, JSON.stringify(me)); }
  function notify(changed, reason) {
    for (const fn of subs) { try { fn(changed || [], reason || 'local'); } catch (e) { console.warn('Review sync listener failed', e); } }
  }
  function setState(s) { if (state !== s) { state = s; db.state = s === 'badcode' ? 'badcode' : ''; notify([], 'state'); } }

  /* ---------- items ---------- */
  function clean(it) {
    return { id: it.id, kind: it.kind, route: typeof it.route === 'string' ? it.route.slice(0, 120) : '', data: !it.deleted && isObj(it.data) ? it.data : {}, deleted: !!it.deleted };
  }
  function put(o, opts) {
    if (!o || !okId(o.id) || !KINDS.includes(o.kind)) { console.warn('Review sync: refused a malformed item'); return null; }
    const prev = db.items[o.id];
    if (prev && prev.reviewer && prev.reviewer !== me.id) { console.warn('Review sync: that item belongs to another reviewer'); return null; }
    const nowIso = new Date().toISOString();
    const it = Object.assign(clean(o), {
      reviewer: me.id, created_at: prev ? prev.created_at || '' : '', updated_at: prev ? prev.updated_at || '' : '',
      _dirty: true, _rev: ((prev && prev._rev) || 0) + 1, _at: nowIso, _created: (prev && prev._created) || nowIso,
    });
    db.items[o.id] = it; dropped.delete(o.id);
    save();
    if (!(opts && opts.silent)) notify([it], 'local');
    schedulePush(PUSH_DELAY);
    return it;
  }
  function merge(inc) {
    if (!isObj(inc) || !okId(inc.id) || !KINDS.includes(inc.kind)) return null;
    const loc = db.items[inc.id];
    if (loc && loc._dirty) return null; // unsent local edit wins; it is pushed next
    if (loc && loc.updated_at && tsKey(inc.updated_at) < tsKey(loc.updated_at)) return null; // keep the newer copy
    const next = Object.assign(clean(inc), {
      reviewer: String(inc.reviewer || ''), created_at: String(inc.created_at || ''), updated_at: String(inc.updated_at || ''),
      _rev: loc ? loc._rev || 0 : 0, _created: loc ? loc._created : undefined, _at: loc ? loc._at : undefined,
    });
    const same = loc && loc.deleted === next.deleted && loc.route === next.route && JSON.stringify(loc.data) === JSON.stringify(next.data);
    db.items[inc.id] = next;
    return same ? null : next;
  }
  function takeBatch() {
    const out = []; let size = 0;
    for (const it of Object.values(db.items)) {
      if (!it._dirty) continue;
      const w = clean(it); w.route = w.route || null;
      const n = JSON.stringify(w).length + 2;
      if (out.length && (out.length >= maxBatch || size + n > MAX_BODY)) break;
      out.push({ w, rev: it._rev, at: it._at }); size += n;
    }
    return out;
  }
  const dirtyCount = () => Object.values(db.items).filter((it) => it._dirty).length;
  const errorItems = () => Object.values(db.items).filter((it) => it._err && it.reviewer === me.id);

  function applyResponse(body, batch) {
    const changed = [], rejected = [];
    const accepted = new Set(Array.isArray(body.accepted) ? body.accepted : []);
    const sent = new Map(batch.map((b) => [b.w.id, b]));
    // The copy that was sent is the one still held (another tab may have edited the item meanwhile).
    const still = (loc, id) => loc && sent.has(id) && loc._rev === sent.get(id).rev && loc._at === sent.get(id).at;
    for (const id of sent.keys()) {
      const loc = db.items[id];
      if (accepted.has(id) && still(loc, id)) { loc._dirty = false; delete loc._err; }
    }
    let repull = false;
    for (const r of (Array.isArray(body.rejected) ? body.rejected : [])) {
      if (!r || typeof r.id !== 'string') continue;
      const loc = okId(r.id) ? db.items[r.id] : null;
      if (still(loc, r.id)) { loc._dirty = false; loc._err = String(r.reason || 'invalid').slice(0, 40); changed.push(loc); rejected.push(loc); }
      if (r.reason === 'not_owner') { repull = true; if (loc) loc.updated_at = ''; }
    }
    for (const inc of (Array.isArray(body.items) ? body.items : [])) { const c = merge(inc); if (c) changed.push(c); }
    for (const r of (Array.isArray(body.reviewers) ? body.reviewers : [])) {
      if (r && okId(r.id)) db.reviewers[r.id] = { id: r.id, name: String(r.name || '').slice(0, 60), last_seen: String(r.last_seen || '') };
    }
    return { changed, repull, rejected };
  }

  /* ---------- network ---------- */
  async function post(body) {
    let ctl = null, timer = 0;
    try {
      ctl = typeof AbortController === 'function' ? new AbortController() : null;
      if (ctl) timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined, cache: 'no-store', credentials: 'omit' });
      const text = await r.text();
      return { status: r.status, body: parse(text, null) };
    } catch (e) {
      return { status: 0, body: null };
    } finally { if (timer) clearTimeout(timer); }
  }
  function overlap(nowStr) {
    const us = tsKey(nowStr);
    return us ? new Date(Math.floor(us / 1000) - OVERLAP_MS).toISOString() : null;
  }
  function rotateIdentity() {
    const old = me.id;
    me = { id: uuid4(), secret: hex(32), name: me.name, hint: me.hint, asked: me.asked };
    saveMe();
    for (const it of Object.values(db.items)) {
      if (it.reviewer !== old) continue;
      if (it.id.indexOf(old) >= 0) {
        const nid = it.id.split(old).join(me.id);
        db.items[nid] = Object.assign({}, it, { id: nid, reviewer: me.id, updated_at: '', created_at: '', _dirty: true, _rev: (it._rev || 0) + 1 });
        if (!it.updated_at) { delete db.items[it.id]; dropped.add(it.id); } // never reached the server: no copy to keep
      } else if (it._dirty) it.reviewer = me.id;
    }
    db.since = null; save();
  }
  function scheduleRetry() {
    clearTimeout(retryT);
    const base = Math.min(60000, 2000 * Math.pow(2, Math.min(Math.max(failures - 1, 0), 5)));
    retryT = setTimeout(cycle, base * (0.8 + Math.random() * 0.4));
  }
  const halted = () => state === 'badcode' || state === 'full';
  function schedulePush(ms) { clearTimeout(pushT); if (code && !halted()) pushT = setTimeout(cycle, ms); }

  async function cycle() {
    if (running) { again = true; return; }
    if (!code || halted()) return;
    running = true; clearTimeout(pushT); clearTimeout(retryT);
    let rotated = false, refetched = false;
    try {
      for (let loops = 0; loops < 30; loops++) {
        const batch = takeBatch();
        if (batch.length) setState('saving');
        const res = await post({ code, reviewer: { id: me.id, secret: me.secret, name: me.name || me.hint || '' }, items: batch.map((b) => b.w), since: db.since || null });
        if (res.status === 200 && isObj(res.body)) {
          const { changed, repull, rejected } = applyResponse(res.body, batch);
          failures = 0;
          if (rejected.length) notify(rejected, 'rejected');
          if (repull && !refetched) { refetched = true; db.since = null; save(); notify(changed, 'remote'); continue; } // fetch the owner's copy back
          if (res.body.more && typeof res.body.next_since === 'string') { db.since = res.body.next_since; save(); notify(changed, 'remote'); continue; }
          db.since = overlap(res.body.now) || db.since;
          lastSync = new Date(); save();
          setState('synced'); notify(changed, 'remote');
          if (takeBatch().length) continue;
          break;
        }
        const err = res.body && res.body.error;
        if (res.status === 403 && err === 'invalid_code') { setState('badcode'); save(); break; }
        if (!rotated && ((res.status === 403 && err === 'reviewer_mismatch') || (res.status === 400 && err === 'invalid_reviewer'))) { rotateIdentity(); rotated = true; continue; }
        if (res.status === 400 && err === 'too_many_items' && maxBatch > 1) { maxBatch = Math.max(1, Math.floor(maxBatch / 4)); continue; }
        if (res.status === 400 && err === 'too_many_reviewers') { setState('full'); break; } // final: this space has no room for another reviewer
        failures++;
        // No answer at all is offline; an answer that is an error is a sync problem (429: the server asked us to slow down).
        setState(res.status === 0 ? 'offline' : (res.status === 429 ? 'busy' : 'error'));
        if (!(res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)) scheduleRetry(); // other 4xx wait for the next poll
        break;
      }
    } catch (e) {
      console.warn('Review sync failed', e); failures++; setState('error'); scheduleRetry();
    } finally {
      running = false;
      if (again) { again = false; schedulePush(300); }
    }
  }

  /* ---------- legacy feedback (previous preview version, this browser only) ---------- */
  function migrateLegacy() {
    if (db.migrated) return;
    const arr = parse(ls.get(K_LEGACY), null);
    db.migrated = true;
    if (Array.isArray(arr)) {
      for (const f of arr.slice(0, 200)) {
        if (!isObj(f)) continue;
        const text = String(f.text || '').trim().slice(0, 4000); if (!text) continue;
        const base = String(f.id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40) || rand(10);
        const id = 'fb_mig_' + base + '_' + me.id.slice(0, 8);
        if (db.items[id]) continue;
        const page = String(f.page || '').slice(0, 200);
        const m = /\(#([a-z]+)/.exec(page);
        put({ id, kind: 'feedback', route: m ? m[1] : (page === 'Sign-in' ? 'signin' : ''), data: { category: String(f.category || 'Other').slice(0, 40), text, page, at: typeof f.at === 'string' ? f.at.slice(0, 40) : '', legacy: true } }, { silent: true });
      }
    }
    save();
  }

  function start() {
    if (started) return; started = true;
    migrateLegacy();
    setInterval(() => { if (document.visibilityState !== 'hidden') cycle(); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cycle(); });
    window.addEventListener('online', () => { failures = 0; cycle(); });
    window.addEventListener('offline', () => { if (code && !halted()) setState('offline'); });
    // Another tab of this browser saved: take its changes now, so neither tab overwrites the other's.
    window.addEventListener('storage', (e) => {
      if (e.key !== K_STORE || !e.newValue) return;
      const changed = absorb(parse(e.newValue, null));
      if (changed.length) { notify(changed, 'remote'); if (changed.some((it) => it._dirty)) schedulePush(PUSH_DELAY); }
    });
    if (code) setTimeout(cycle, 50);
  }

  return {
    start,
    now() { return cycle(); },
    put,
    // Deleting sends and keeps no content: only the id, kind and route remain.
    remove(id) { const it = db.items[id]; if (!it || it.reviewer !== me.id) return null; return put({ id, kind: it.kind, route: it.route, data: {}, deleted: true }); },
    // Take in what other tabs saved (silently; the caller re-renders). Call before building a change from the local copy.
    refresh() { return absorb(parse(ls.get(K_STORE), null)).length; },
    get(id) { return okId(id) ? db.items[id] || null : null; },
    all() { return Object.values(db.items); },
    list(kind) { return Object.values(db.items).filter((it) => it.kind === kind && !it.deleted); },
    newId(prefix) { return prefix + rand(12); },
    rand,
    me() { return { id: me.id, name: me.name || '', hint: me.hint || '', asked: !!me.asked }; },
    setName(n) { me.name = String(n || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60); me.asked = true; saveMe(); schedulePush(200); notify([], 'name'); },
    setHint(h) { h = String(h || '').trim().slice(0, 60); if (h && h !== me.hint) { me.hint = h; saveMe(); } },
    reviewers() { return db.reviewers; },
    name(rid) {
      if (rid === me.id) return me.name || me.hint || 'You';
      const r = db.reviewers[rid]; return (r && r.name) || 'Someone';
    },
    code() { return code; },
    setCode(c) {
      c = String(c || '').trim(); if (!c) return;
      const moved = useSpace(c);
      code = c; ls.set(K_CODE, c); failures = 0; db.since = null; state = 'idle'; db.state = ''; save(); notify([], moved ? 'reset' : 'state'); setTimeout(cycle, 20);
    },
    status() {
      const errs = errorItems();
      return { state, lastSync, dirty: dirtyCount(), failures, storageOk, rejected: errs.length, reasons: Array.from(new Set(errs.map((it) => it._err))) };
    },
    pref(k) { return db.prefs[k]; },
    setPref(k, v) { db.prefs[k] = v; save(); },
    subscribe(fn) { subs.push(fn); },
    tsKey,
    // Recency for "latest wins" displays: unsent local changes count as newest.
    recency(it) { return it._dirty || !it.updated_at ? Number.MAX_SAFE_INTEGER - 1 : tsKey(it.updated_at); },
    shown(it) { return it._at || it.updated_at || ''; },
    created(it) { return it.created_at || it._created || it._at || ''; },
  };
})();
