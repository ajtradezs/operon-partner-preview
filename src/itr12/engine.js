/* ITR12 gate engine. Deterministic rules over REGISTER (Johan's exception register), WORKFLOW (his master document) and
   the lookups in workflow.js. Views, the seed and the PaperSync portal change case state only through ENGINE, and every
   change is written to the hash-chained audit trail. The AI checks and the SARS link are simulated and labelled as such.

   Actors: ACTOR.me(), as(role, personId), client(clientId), ai(), reviewer(), system(), platform(role), sars().
   Actions return { ok, why, ... } and audit every refusal. The main ones:
     newClient(o) newCase(client, o) addItem(c, kind, label) setKyc(client, key, ok, a) markReq(c, gate, key, a)
     release(c, gate, a, o) canRelease(c, gate, a, o) gateState(c, gate) drive(c, untilGate, o)
     raise(c, code, o) raiseManual(c, code, a, o) resolve(x, a, o) close(x, a, o) setSeverity(x, a, to, o) approveSeverity(x, a, o)
     requestOverride(x, a, o) approveOverride(x, a) setOverridable(code, on, a) recordFallback(x, a, o) reconcileFallback(x, a, o)
     change(c, a, data, o) outsideEdit(c, patch) restoreVersion(c, a) calculate(c, a, o) decideItem(c, lineId, a, o) setInputs(c, a, inputs, o)
     draftResponse(c, a, kind, drafts)
     requestTx(c, fn, a) g18Checks(t) g18Blockers(t) signG18(t, a) transmit(t, a, outcome) checkStatus(t, a, truth) retry(t, a) manualFallback(t, a, o)
     receive(item) routeInbound(item, caseId, a) confirmInboundDate(item, a, o) portal(c, action, d) recordWithdrawal(c, a, o) upload(c, itemId, file, a) approveNa(c, itemId, a)
     chooseRemedy(c, a, route, o) remind(c, kind, a) addHold / legalHold / releaseHold incidentStep(inc, step, a, o) closeIncident(inc, a)
     dragForward(c, a, toKey) returnForRework(c, a, toKey, reason) rulesetChange(a, o) setReviewer(c, gate, verdict) setAiUp(up, a) setLink(patch, a)
     watch() settle(c) auditCsv() auditJson() verifyChain() canon(v) digest(v) */

const ACTOR = {
  me() { const m = me(); return { type: 'human', role: S.role, id: m.id }; },
  as(role, id) { return { type: 'human', role, id: id || ME_BY_ROLE[role] }; },
  client(clientId, via) { return { type: 'client', role: 'Client', id: clientId, via: via || 'portal' }; },
  ai() { return { type: 'ai', role: 'AI Agent', id: 'Operon AI (simulated)' }; },
  reviewer() { return { type: 'ai', role: 'Independent reviewer', id: 'Operon reviewer (simulated)' }; },
  system() { return { type: 'system', role: 'Operon (system)', id: 'Operon' }; },
  platform(role) { const r = role || 'Platform Administrator'; return { type: 'platform', role: r, id: r + ' (simulated)' }; },
  sars() { return { type: 'sars', role: 'SARS', id: 'SARS (simulated)' }; },
};

const ENGINE = (() => {
  /* ===================== Small helpers ===================== */
  const ZERO = '0'.repeat(64);
  // Canonical JSON: keys sorted at every level, undefined dropped, Dates as ISO strings. Hashes are SHA-256 over it.
  function canon(v) {
    if (v instanceof Date) return JSON.stringify(v.toISOString());
    if (v === null || v === undefined || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  const digest = (v) => sha256(canon(v));
  const prim = (v) => (v == null || typeof v !== 'object' ? v : (v instanceof Date ? v.toISOString() : canon(v)));
  const nextId = (key, prefix, width) => { S[key] = (S[key] || 0) + 1; return prefix + String(S[key]).padStart(width, '0'); };
  const isoDay = (d) => DATES.iso(DATES.fromLocal(d));
  const fail = (why, extra) => Object.assign({ ok: false, why }, extra || {});
  const okr = (extra) => Object.assign({ ok: true, why: '' }, extra || {});
  const list = (a) => a.join(', ');
  const clientOf = (c) => (c ? S.clients.find((x) => x.id === (typeof c === 'string' ? c : c.clientId)) || null : null);
  const caseById = (id) => S.cases.find((x) => x.id === id) || null;
  const caseOf = (x) => (x && x.caseId ? caseById(x.caseId) : null);
  const exById = (id) => S.exceptions.find((x) => x.id === id) || null;
  const txById = (id) => S.txs.find((t) => t.id === id) || null;
  const incById = (id) => S.incidents.find((i) => i.id === id) || null;
  const isOpen = (x) => x.status !== 'resolved' && x.status !== 'closed';
  const exOf = (c) => S.exceptions.filter((x) => x.caseId === c.id);
  const liveEx = (c) => exOf(c).filter((x) => x.status !== 'closed');
  const openOf = (c, code) => exOf(c).filter((x) => x.code === code && isOpen(x));
  const hasOpen = (c, code) => openOf(c, code).length > 0;
  const curVersion = (c) => (c && c.versions.length ? c.versions[c.versions.length - 1] : null);
  const vN = (c) => (c && c.versions.length ? c.versions.length : null);
  const cf = (c) => (c ? { caseId: c.id, client: c.clientId, version: vN(c) } : {});
  const personFor = (role) => { const p = S.people.find((x) => x.role === role); return p ? p.id : null; };
  const whoOf = (a) => a.id;
  function nameOf(a) {
    if (a.type === 'human') return pname(a.id);
    if (a.type === 'client') { const cl = clientOf(a.id); return (cl ? cl.name : a.id) + ' (PaperSync portal)'; }
    return a.id;
  }
  const raisedByOf = (a) => ({ ai: 'AI', system: 'system', sars: 'SARS' }[a.type] || 'human');
  const sourceOf = (a) => ({ ai: 'AI check (simulated)', system: 'Operon rule', sars: 'SARS (simulated)', client: 'PaperSync portal', platform: 'Platform team (simulated)' }[a.type] || 'Raised by ' + nameOf(a));
  const RULESET_DEFAULT = '2026.1';
  const rulesetNow = () => (typeof RULESET !== 'undefined' && RULESET && RULESET.version ? RULESET.version : RULESET_DEFAULT);
  // ITR12 transaction states in which the return may already be with SARS: nothing may change or be withdrawn blindly.
  const IN_FLIGHT = ['unknown', 'no-response', 'manual'];
  const itr12InFlight = (c) => S.txs.find((t) => t.caseId === c.id && t.fn === 'itr12' && IN_FLIGHT.includes(t.status)) || null;
  const currentApproval = (c) => !!(c.approval && !c.approval.withdrawn && !c.approval.superseded);
  const validDay = (s) => (typeof s === 'string' && DATES.dt(s) ? s : null);

  /* ===================== Audit ===================== */
  // Client and simulated platform actions are human actions; SARS events are recorded as system events.
  function log(a, text, o) {
    const f = { actor: a.type === 'ai' ? 'ai' : (a.type === 'system' || a.type === 'sars' ? 'system' : 'human'), who: whoOf(a), role: a.role, text };
    Object.keys(o || {}).forEach((k) => { f[k] = prim(o[k]); });
    return addAudit(f);
  }
  function refuse(a, c, text, why, audit, ret) {
    log(a, text + ': ' + why, Object.assign(cf(c), { result: 'Refused', reason: why }, audit || {}));
    return fail(why, ret);
  }
  // A person acting in a role: they must exist, not be revoked, hold the role they act in, and (optionally) be one of `roles`.
  function staffWhy(a, roles) {
    const want = roles ? [].concat(roles) : null;
    if (!a || a.type !== 'human') return (want ? 'A ' + want.join(' or a ') : 'A person') + ' must do this';
    const p = S.people.find((x) => x.id === a.id);
    if (!p) return 'Unknown or revoked user ' + a.id;
    if (p.role !== a.role) return p.name + ' does not hold the ' + a.role + ' role';
    if (want && !want.includes(a.role)) return 'Only ' + want.map((r) => (/^[AEIOU]/.test(r) ? 'an ' : 'a ') + r).join(' or ') + ' can do this';
    return null;
  }

  // The Operon AI agent acting: not the independent reviewer, and only while the AI service is up and AI work is not paused.
  function aiWhy(a) {
    if (!a || a.type !== 'ai' || a.role !== 'AI Agent') return 'Only the Operon AI agent can do this';
    if (S.paused) return 'AI work is paused';
    if (!S.aiUp) return 'The AI service is unavailable';
    return null;
  }
  // Rulesets by version (own keys only).
  const rulesetOf = (v) => (typeof CALC !== 'undefined' ? CALC.rulesetOf(v) : null);
  // The extracted values changed after the last calculation (a decision, a corrected value): the calculation must be rerun.
  const calcStale = (c) => (c.inputs && c.calc && typeof c.calc.inputs === 'string' && c.calc.inputs !== digest(c.inputs)
    ? 'The extracted values changed after version ' + vN(c) + ': rerun the calculation' : null);

  /* ===================== State ===================== */
  SEEDERS.push((s) => Object.assign(s, {
    clients: [], cases: [], exceptions: [], txs: [], inbound: [], incidents: [],
    clientN: 0, caseN: 0, exN: 0, txN: 0, inN: 0, incN: 0, docN: 0, holdN: 0,
    policy: JSON.parse(JSON.stringify(POLICY0)), link: { up: true, auth: true, rights: true }, aiUp: true,
    rulesetVersion: rulesetNow(), aiLogged: {}, watchErrors: 0,
  }));

  const KYC_ITEMS = [
    { key: 'id', label: 'Identity document' }, { key: 'address', label: 'Proof of address' }, { key: 'bank', label: 'Bank confirmation' },
    { key: 'mandate', label: 'Signed appointment letter and mandate' }, { key: 'popia', label: 'POPIA privacy notice acknowledged' },
    { key: 'engagement', label: 'Engagement terms accepted' },
  ];
  // The annual questionnaire. 'kind' adds that document to the checklist when answered yes; 'material' new events raise QUE-03.
  const QUESTIONS = [
    { key: 'employment', label: 'Were you employed during the year?', kind: 'irp5' },
    { key: 'medical', label: 'Did you belong to a medical scheme?', kind: 'medical' },
    { key: 'ra', label: 'Did you contribute to a retirement annuity?', kind: 'ra' },
    { key: 'interest', label: 'Did you earn interest or dividends?', kind: 'it3b' },
    { key: 'rental', label: 'Did you earn rental income?', kind: 'rental', material: true },
    { key: 'cgt', label: 'Did you sell shares, property or crypto assets?', kind: 'it3c', material: true },
    { key: 'foreign', label: 'Did you earn foreign income?', kind: 'foreign', material: true },
    { key: 'travel', label: 'Did you receive a travel allowance?', kind: 'logbook' },
    { key: 'homeoffice', label: 'Did you work from a home office?', kind: 'homeoffice' },
    { key: 'donations', label: 'Did you make section 18A donations?', kind: 'donation' },
  ];
  const kindLabel = (k) => { const d = DOC_KINDS.find((x) => x.kind === k); return d ? d.label : k; };
  // A clean file name per document kind (used by drive() and the demo's "upload a sample" buttons).
  const FILE_FOR = { irp5: 'IRP5_2026.pdf', it3b: 'IT3b_interest_2026.pdf', it3c: 'IT3c_capital_gains_2026.pdf', medical: 'Medical_scheme_certificate_2026.pdf',
    ra: 'RA_certificate_2026.pdf', rental: 'Rental_schedule_2026.pdf', logbook: 'Logbook_2026.pdf', homeoffice: 'Home_office_expenses_2026.pdf',
    donation: 'Section18A_receipt_2026.pdf', foreign: 'Foreign_income_statement_2026.pdf', bank: 'Bank_confirmation_2026.pdf', notice: 'SARS_notice_2026.pdf' };

  // a: the person adding the client (an Administrator). The seed and the engine's own walk-through pass none (the system).
  function newClient(o, a) {
    o = o || {};
    if (a) { const w = staffWhy(a, 'Administrator'); if (w) return refuse(a, null, 'Adding a client refused', w); }
    const kyc = KYC_ITEMS.map((k) => ({ key: k.key, label: k.label, ok: o.kyc && k.key in o.kyc ? !!o.kyc[k.key] : true }));
    // The default ID number deliberately fails the SA ID checksum: every identity in the preview is made up.
    const cl = { id: nextId('clientN', 'CL', 2), name: o.name || 'Demo Client', idNo: o.idNo || '8001015009088', taxRef: o.taxRef || '0123456789',
      provisional: o.provisional !== false, others: (o.others || []).slice(), kyc, email: o.email || null };
    if (o.master && typeof o.master === 'object') cl.master = Object.assign({}, o.master);
    S.clients.push(cl);
    log(a || ACTOR.system(), 'Added client ' + cl.id + ' to the permanent client repository', { client: cl.id });
    return cl;
  }
  function setKyc(cl, key, ok, a) {
    const w = staffWhy(a, ['Administrator', 'Tax Consultant']); if (w) return refuse(a, null, 'KYC update refused', w, { client: cl.id });
    const k = cl.kyc.find((x) => x.key === key); if (!k) return fail('Unknown KYC item ' + key);
    const before = k.ok; k.ok = !!ok;
    log(a, (ok ? 'Confirmed ' : 'Marked as missing: ') + k.label, { client: cl.id, before, after: k.ok });
    S.cases.filter((c) => c.clientId === cl.id).forEach(settle);
    return okr();
  }
  function newCase(cl, o) {
    o = o || {};
    const c = {
      id: nextId('caseN', 'C', 2), clientId: cl.id, year: o.year || FILING_2026.year, consultant: o.consultant || 'TC1',
      filing: cl.provisional ? 'provisional' : 'nonProvisional', flags: { da: false, vrf: false, aud: false, remedy: false },
      gates: {}, req: { G02: [{ key: 'compare', label: 'SARS registered details compared with the client record', done: false }] },
      items: [], docs: [], questionnaire: { status: 'open', required: (o.required || ['employment', 'medical', 'ra', 'interest', 'rental', 'cgt', 'foreign']).slice(), answers: {}, at: null },
      priorYear: (o.priorYear || []).slice(), prepop: null, notices: [],
      inputs: o.inputs ? structuredClone(o.inputs) : null,  // extracted values with their lineage (calc.js)
      calc: null, schedules: null, itr12: null, recon: { ok: true, issues: [] }, versions: [], approval: null, frozen: null,
      subTx: null, submission: null, da: null, vrf: null, aud: null, ita34: null, decision: null, outcome: null, remedy: null,
      retention: { from: null, until: null, review: null, holds: [], raised: {} },
      reminders: [], ai: {}, warned: {}, rerun: false, archived: false, opened: now(),
    };
    GATE_IDS.forEach((g) => { c.gates[g] = { status: 'pending', by: [], at: null, version: null, routed: false, rework: null, invalidated: null }; });
    S.cases.push(c);
    (o.items || ['irp5', 'medical']).forEach((k) => addItem(c, typeof k === 'string' ? k : k.kind, typeof k === 'string' ? null : k.label, true));
    log(ACTOR.system(), 'Opened the ' + c.year + ' ITR12 case ' + c.id + ' (annual case repository)', cf(c));
    return c;
  }
  function addItem(c, kind, label, quiet) {
    const it = { id: 'I' + (c.items.length + 1), kind, label: label || kindLabel(kind), na: null, naReason: null };
    c.items.push(it);
    if (!quiet) log(ACTOR.system(), 'Requested ' + it.label, Object.assign(cf(c), { doc: it.id }));
    return it;
  }
  function markReq(c, g, key, a) {
    const w = a.type === 'ai' ? null : staffWhy(a); if (w) return refuse(a, c, 'Checklist update refused', w, { gate: g });
    const r = (c.req[g] || []).find((x) => x.key === key); if (!r) return fail('No checklist item ' + key + ' on ' + g);
    r.done = true; r.by = whoOf(a); r.at = now();
    log(a, g + ': ' + r.label, Object.assign(cf(c), { gate: g, result: 'Done' }));
    settle(c);
    return okr();
  }
  const markAll = (c, g, a) => (c.req[g] || []).filter((r) => !r.done).forEach((r) => markReq(c, g, r.key, a));

  /* ===================== Gate state ===================== */
  function applies(c, g) {
    if (g === 'G17') return false;  // per incident, never in the case sequence
    if (c.gates[g].status === 'na') return false;
    const f = OPTIONAL_GATE[g];
    if (f === 'vrf') return !!(c.flags.vrf || c.flags.aud);
    return f ? !!c.flags[f] : true;
  }
  const seq = (c) => SEQ.filter((g) => applies(c, g));
  const txDoneAfter = (c, g, at) => !!at && S.txs.some((t) => t.caseId === c.id && t.gate === g && t.status === 'success' && t.doneAt && t.doneAt >= at);
  const daMoved = (c) => !!(c.da && c.da.moved);
  // Released, plus the SARS leg for the gates that end in a transaction. G10 needs no response once SARS moved the
  // Declaration Questionnaire to verification (the G10 box: "submit ... or move to verification").
  function stepDone(c, g) {
    const st = c.gates[g];
    if (!st || st.status !== 'released') return false;
    if (g === 'G18') return !!(c.submission && c.submission.ok);
    if (g === 'G10') return daMoved(c) || txDoneAfter(c, g, st.at);
    if (g === 'G11') return txDoneAfter(c, g, st.at);
    if (g === 'G15') return (c.remedy && c.remedy.route === 'advice') || txDoneAfter(c, g, st.at);
    return true;
  }
  const currentGate = (c) => seq(c).find((g) => !stepDone(c, g)) || null;
  function pendingBefore(c, g) { const s = seq(c); const i = s.indexOf(g); return i < 0 ? [] : s.slice(0, i).filter((x) => !stepDone(c, x)); }

  // Does this exception block right now? Closed or Blocking=No: no. Resolved: only while a secondary reviewer still has to close it.
  // Conditional: until the manual fallback is recorded and independently reconciled. S2: not while an approved override holds for
  // the current version and the code is still on the override policy list.
  function blocksNow(x) {
    if (x.status === 'closed' || x.blocking === 'No') return false;
    if (x.status === 'resolved') return !!x.secondary;
    if (x.blocking === 'Conditional') return !(x.fallback && x.fallback.recorded && x.fallback.reconciled);
    if (x.sev === 'S2' && x.override && x.override.status === 'approved' && S.policy.overridable.includes(x.code)) { const c = caseOf(x); if (!c || x.override.version === vN(c)) return false; }
    return true;
  }
  // S1 anywhere on the case stops every gate except incident handling (G17). Otherwise a blocking exception stops the gates it is
  // mapped to, except the codes whose own resolution is passing those gates (BY_GATE): they never block their own gates, even at S1.
  function gateBlockers(c, g) {
    if (g === 'G17') return [];
    return liveEx(c).filter((x) => blocksNow(x) && ((x.sev === 'S1' && !(x.byGate && x.gates.includes(g))) || (x.gates.includes(g) && !x.byGate)));
  }
  function itemState(c, it) {
    if (it.na === 'approved') return 'na';
    if (liveEx(c).some((x) => x.item === it.id && blocksNow(x))) return 'held';
    if (c.docs.some((d) => d.itemId === it.id && d.status === 'validated')) return 'validated';
    return 'requested';
  }
  function drift(c) {
    const v = curVersion(c); if (!v) return [];
    return ['calc', 'schedules', 'itr12'].filter((k) => digest(c[k]) !== v[k]);
  }
  function approvalProblem(c) {
    const ap = c.approval; const v = curVersion(c);
    if (!v) return 'No version to approve';
    if (!ap) return 'The client has not approved a version';
    if (ap.withdrawn) return 'The client withdrew the approval of version ' + ap.version;
    if (ap.superseded) return 'The approval of version ' + ap.version + ' was superseded';
    if (ap.version !== v.n || ap.calc !== v.calc || ap.itr12 !== v.itr12) return 'The approval is for version ' + ap.version + ', not version ' + v.n;
    if (ap.declaration !== DECLARATION) return 'The declaration was not confirmed';
    return null;
  }
  function criteria(c, g) {
    const miss = [];
    const ap = () => { const p = approvalProblem(c); if (p) miss.push(p); };
    const dr = () => { const d = drift(c); if (d.length) miss.push('The record differs from version ' + vN(c) + ' (' + list(d) + ')'); };
    const rs = () => { if (c.calc && c.calc.ruleset !== S.rulesetVersion) miss.push('The calculation used ruleset ' + c.calc.ruleset + '; the current ruleset is ' + S.rulesetVersion); };
    const st = () => { const s = calcStale(c); if (s) miss.push(s); };
    switch (g) {
      case 'G01': clientOf(c).kyc.filter((k) => !k.ok).forEach((k) => miss.push(k.label + ' is not complete')); break;
      case 'G03': if (c.questionnaire.status !== 'submitted') miss.push('The client has not submitted the questionnaire'); break;
      case 'G04': c.items.forEach((it) => { const s = itemState(c, it); if (s !== 'validated' && s !== 'na') miss.push(it.label + (s === 'held' ? ' is held by an exception' : ' is outstanding')); }); break;
      case 'G05': if (!c.calc) miss.push('No calculation yet'); if (!c.versions.length) miss.push('No version recorded'); rs(); st(); break;
      case 'G06': ap(); break;
      case 'G07': ap(); dr(); st(); break;
      case 'G08': ap(); dr(); if (!c.recon.ok) miss.push('The final reconciliation fails'); rs(); st(); break;
      case 'G09': ap(); dr(); st(); if (!c.frozen || c.frozen.version !== vN(c)) miss.push('Version ' + vN(c) + ' is not frozen'); break;
      case 'G12': if (!c.ita34) miss.push('No ITA34 received'); break;
      case 'G14': if (!c.decision) miss.push('The client has not decided'); break;
      case 'G15':
        if (!c.remedy || !c.remedy.route) miss.push('No remedy route chosen');
        else {
          if (!c.remedy.evidence) miss.push('Grounds and evidence are not recorded');
          if (c.remedy.route !== 'advice' && !(c.remedy.authority && c.remedy.authority.route === c.remedy.route)) miss.push('The client has not authorised the remedy');
        }
        break;
      case 'G16': {
        const r = c.retention;
        if (!r.review) miss.push('No retention review date');
        else if (isoDay(now()) < r.review) miss.push('The retention review date (' + r.review + ') is not reached');
        else if (!r.raised.review) miss.push('The retention review (RET-03) has not been raised yet');
        r.holds.filter((h) => !h.released).forEach((h) => miss.push(h.label + ' is active'));
        S.incidents.filter((i) => i.caseId === c.id && i.status === 'open').forEach((i) => miss.push('Incident ' + i.id + ' is still open'));
        break;
      }
      default: break;
    }
    if (!(g === 'G10' && daMoved(c))) (c.req[g] || []).filter((r) => !r.done).forEach((r) => miss.push(r.label));
    return miss;
  }
  // Who may release a gate (RELEASE in workflow.js). Returns why not, or null.
  function actorCheck(c, g, a) {
    const r = RELEASE[g];
    switch (r.by) {
      case 'client':
        return a.type === 'client' && a.via === 'portal' && a.id === c.clientId ? null : g + ' passes only through the client’s own PaperSync portal action';
      case 'system':
        return a.type === 'system' ? null : g + ' is released by Operon itself when its checks pass';
      case 'ai':
        if (a.type === 'ai') {
          if (S.paused) return 'AI work is paused';
          if (!S.aiUp) return 'The AI service is unavailable';
          if (c.ai[g] === 'disagree') return 'The independent reviewer did not agree';
          return null;
        }
        return a.type === 'human' && a.role === r.role ? staffWhy(a, r.role) : g + ' is released by the AI check or a ' + r.role;
      case 'role':
        if (g === 'G09' && a.type !== 'human') return 'No system or AI may approve G09';
        return a.type === 'human' && a.role === r.role ? staffWhy(a, r.role) : g + ' is released by a ' + r.role;
      default:
        return 'G18 is signed off per transaction on the SARS link';
    }
  }
  function canRelease(c, g, a, o) {
    o = o || {};
    const res = { ok: false, why: '', codes: [], blockers: [], missing: [], before: [] };
    if (g === 'G17') { res.why = 'G17 is released when an incident is closed'; return res; }
    if (g === 'G18') { res.why = 'G18 is signed off per transaction on the SARS link'; return res; }
    if (!GATE[g]) { res.why = 'Unknown gate ' + g; return res; }
    if (!applies(c, g)) { res.why = g + ' does not apply to this case'; return res; }
    if (c.gates[g].status === 'released') { res.why = g + ' is already released'; return res; }
    const ign = o.ignore || [];
    res.before = pendingBefore(c, g);
    res.blockers = gateBlockers(c, g).filter((x) => !ign.includes(x.id));
    res.codes = res.blockers.map((x) => x.code);
    res.missing = criteria(c, g);
    const who = actorCheck(c, g, a);
    res.why = who || (res.before.length ? 'Earlier gates are not done: ' + list(res.before)
      : res.blockers.length ? 'Blocked by ' + list(res.blockers.map((x) => x.code + ' (' + x.sev + ')'))
        : res.missing.length ? 'Not ready: ' + res.missing.join('; ') : '');
    res.ok = !res.why;
    return res;
  }
  function release(c, g, a, o) {
    o = o || {};
    const r = canRelease(c, g, a, o);
    if (!r.ok) {
      if (a.type === 'ai') { const sig = c.id + '|' + g + '|' + r.why; if (S.aiLogged[sig]) return r; S.aiLogged[sig] = 1; }
      log(a, 'Refused to release ' + g + ' (' + (GATE[g] ? GATE[g].control : g) + '): ' + r.why, Object.assign(cf(c), { gate: g, code: list(r.codes) || null, result: 'Refused', reason: r.why }));
      return r;
    }
    const st = c.gates[g]; const before = st.status;
    Object.assign(st, { status: 'released', by: [whoOf(a)], byType: a.type, at: now(), version: vN(c), rework: null, routed: false, via: a.via || null });
    log(a, 'Released ' + g + ': ' + GATE[g].control, Object.assign(cf(c), { gate: g, before, after: 'released', result: 'Released', evidence: o.evidence || '' }));
    onReleased(c, g, a);
    settle(c);
    return r;
  }
  function onReleased(c, g, a) {
    if (g === 'G07') { c.frozen = { version: vN(c), at: now() }; log(ACTOR.system(), 'Froze version ' + vN(c) + ' for submission', cf(c)); }
    else if (g === 'G09') { const t = newTx(c, 'itr12', a); c.subTx = t.id; }
    else if (g === 'G10') { if (daMoved(c)) log(ACTOR.system(), 'G10 passed without a response: SARS moved the Declaration Questionnaire to verification', Object.assign(cf(c), { gate: 'G10' })); else newTx(c, 'da', a); }
    else if (g === 'G11') newTx(c, 'vrf', a);
    else if (g === 'G15' && c.remedy.route !== 'advice') {
      const f = SARS_FN[c.remedy.route];
      const t = newTx(c, c.remedy.route, a, { status: f.approved ? 'awaiting G18' : 'blocked' });
      if (!f.approved) raise(c, 'INT-08', { by: ACTOR.system(), txId: t.id, gate: 'G15', note: f.label + ' is outside the SARS-approved interface capability', noSettle: true });
    } else if (g === 'G16') { c.archived = true; log(ACTOR.system(), 'Archived the case. Nothing is deleted; every record stays retrievable.', cf(c)); }
  }
  // Re-opens g0 and every released gate after it in the sequence. Callers deal with the approval.
  function reopenFrom(c, g0, a, why) {
    const i0 = SEQ.indexOf(g0); const hit = [];
    SEQ.slice(i0).forEach((g) => {
      const st = c.gates[g];
      if (st.status === 'released') { st.status = 'invalidated'; st.invalidated = { at: now(), by: whoOf(a), why }; st.routed = false; hit.push(g); }
    });
    if (hit.includes('G07')) c.frozen = null;
    if (hit.includes('G16')) c.archived = false;
    S.txs.filter((t) => t.caseId === c.id && hit.includes(t.gate) && (t.status === 'awaiting G18' || t.status === 'ready' || t.status === 'blocked'))
      .forEach((t) => { t.status = 'cancelled'; log(ACTOR.system(), 'Cancelled ' + t.id + ' (' + t.label + '): its gate was re-opened', Object.assign(cf(c), { sarsTx: t.id, result: 'Cancelled' })); });
    if (hit.length) log(a, 'Re-opened ' + list(hit) + ': ' + why, Object.assign(cf(c), { gate: hit.join('; '), before: 'released', after: 'invalidated', result: 'Re-opened', reason: why }));
    return hit;
  }
  function gateState(c, g) {
    if (g === 'G17') {
      const incs = S.incidents.filter((i) => i.caseId === c.id);
      return { gate: g, state: incs.some((i) => i.status === 'open') ? 'in progress' : (incs.length ? 'released' : 'n/a'), blockers: [], missing: [], incidents: incs.map((i) => i.id) };
    }
    if (!applies(c, g)) return { gate: g, state: 'n/a', blockers: [], missing: [] };
    const st = c.gates[g];
    if (st.status === 'released') return { gate: g, state: stepDone(c, g) ? 'released' : 'released, awaiting SARS', by: st.by.slice(), at: st.at, blockers: [], missing: [] };
    const bl = gateBlockers(c, g); const miss = criteria(c, g); const before = pendingBefore(c, g);
    let state = before.length ? 'not started' : (!bl.length && !miss.length ? 'ready' : 'in progress');
    if (st.status === 'invalidated') state = 'invalidated';
    return { gate: g, state, blockers: bl, missing: miss, before, invalidated: st.invalidated };
  }

  /* ===================== settle(): the rules that follow from the current state ===================== */
  let settling = false;
  const PRE_GATES = SEQ.slice(0, SEQ.indexOf('G09') + 1);
  // Gate-critical exceptions before submission, other than the final-validation codes themselves.
  const preBlockers = (c) => liveEx(c).filter((x) => blocksNow(x) && !x.byGate && x.code !== 'PRE-01' && x.code !== 'PRE-02' && (x.sev === 'S1' || x.gates.some((g) => PRE_GATES.includes(g))));
  // Every applicable gate of the exception is done (its own raising gate excepted; G17 counts as done once its incident is closed).
  function gatesDone(c, x) {
    const gs = x.gates.filter((g) => g !== x.fromGate && (g === 'G17' || applies(c, g)));
    if (!gs.length) return false;
    return gs.every((g) => (g === 'G17' ? !!x.incidentId && (incById(x.incidentId) || {}).status === 'closed' : stepDone(c, g)));
  }
  const gateReleasedText = (c, x) => x.gates.map((g) => g + ': ' + (g === 'G17' ? (x.incidentId ? (incById(x.incidentId).status === 'closed' ? 'released' : 'incident open') : 'no incident')
    : (!applies(c, g) ? 'n/a' : (stepDone(c, g) ? 'released' : c.gates[g].status)))).join('; ');
  function settle(c) {
    if (!c || settling) return;
    settling = true;
    try {
      for (let pass = 0; pass < 30; pass++) {
        let changed = false;
        // 1. An edit made outside the workflow (drift from the last version) is an S1 integrity exception.
        if (c.versions.length && drift(c).length && !hasOpen(c, 'VER-02')) {
          raise(c, 'VER-02', { by: ACTOR.system(), source: 'Version integrity check', note: 'The ' + list(drift(c)) + ' no longer match version ' + vN(c), noSettle: true });
          changed = true;
        }
        // 2. Keep each exception's "gate released status" current.
        exOf(c).forEach((x) => { x.gateReleased = gateReleasedText(c, x); });
        // 3. Close the codes whose gates are done: BY_GATE codes, and resolved codes that have no secondary reviewer.
        liveEx(c).forEach((x) => {
          if (x.byGate && isOpen(x) && gatesDone(c, x)) { closeByGate(c, x); changed = true; }
          else if (x.status === 'resolved' && !x.secondary && gatesDone(c, x)) { x.status = 'closed'; x.closedBy = 'Operon'; x.closedAt = now(); log(ACTOR.system(), 'Closed ' + x.id + ' (' + x.code + '): resolved and its gates are done', Object.assign(cf(c), { exceptionId: x.id, code: x.code, result: 'Closed' })); changed = true; }
        });
        // 4. PRE-02 belongs to the system: it clears when no other gate-critical exception remains...
        openOf(c, 'PRE-02').forEach((x) => { if (!preBlockers(c).length) { finishResolve(x, ACTOR.system(), 'Every gate-critical exception is closed', null); changed = true; } });
        // 5. ...and is raised whenever G08 or G09 is next while one is still open, whoever is about to release them.
        const cg = currentGate(c);
        if ((cg === 'G08' || cg === 'G09') && !hasOpen(c, 'PRE-02')) {
          const others = preBlockers(c);
          if (others.length) { raise(c, 'PRE-02', { by: ACTOR.system(), note: 'Still open before ' + cg + ': ' + list(others.map((x) => x.code + ' ' + x.id)), noSettle: true }); changed = true; }
        }
        // 6. G07 is Operon's: freeze the approved version as soon as its checks pass.
        if (applies(c, 'G07') && c.gates.G07.status !== 'released' && canRelease(c, 'G07', ACTOR.system()).ok) { release(c, 'G07', ACTOR.system()); changed = true; }
        // 7. The AI gates pass automatically only with no blocker and an agreeing independent reviewer; otherwise they route to the consultant.
        for (const g of ['G04', 'G08', 'G12']) {
          const st = c.gates[g];
          if (!applies(c, g) || st.status === 'released' || st.rework || S.paused || pendingBefore(c, g).length) continue;
          if (!S.aiUp) {
            if (!exOf(c).some((x) => x.code === 'AI-06' && isOpen(x) && x.gates.includes(g))) {
              raise(c, 'AI-06', { by: ACTOR.system(), gate: g, source: 'AI service health check', note: 'The AI service is unavailable; ' + g + ' cannot run automatically', dedupe: false, noSettle: true });
              changed = true;
            }
            continue;
          }
          const ai = ACTOR.ai();
          if (g === 'G08' && !c.recon.ok && !hasOpen(c, 'PRE-01')) { raise(c, 'PRE-01', { by: ai, note: (c.recon.issues || []).join('; ') || 'Documents, calculation, schedules and ITR12 do not reconcile', noSettle: true }); changed = true; }
          const r = canRelease(c, g, ai);
          if (r.ok) { release(c, g, ai); changed = true; }
          else {
            // Route only when what stops the gate is an exception or the reviewer, not documents that simply have not arrived.
            const waiting = g === 'G04' ? c.items.some((it) => itemState(c, it) === 'requested') : r.missing.length > 0;
            if (!waiting && !r.before.length && (r.blockers.length || c.ai[g] === 'disagree') && !st.routed) {
              st.routed = true;
              log(ai, 'Routed ' + g + ' to the Tax Consultant: ' + r.why, Object.assign(cf(c), { gate: g, code: list(r.codes) || null, result: 'Routed' }));
              changed = true;
            }
          }
        }
        if (!changed) break;
      }
    } finally { settling = false; }
  }
  function closeByGate(c, x) {
    const gs = x.gates.filter((g) => g !== 'G17' && g !== x.fromGate && applies(c, g));
    const last = gs[gs.length - 1];
    x.status = 'closed'; x.resolvedBy = c.gates[last].by.join(' + '); x.resolvedAt = now(); x.closedBy = 'Operon'; x.closedAt = now();
    x.resolution = 'Resolved by passing ' + list(gs) + (SUBSTANTIVE.includes(last) && last !== 'G09' && !(last === 'G10' && daMoved(c)) ? ' and the SARS transaction that follows' : '');
    log(ACTOR.system(), 'Closed ' + x.id + ' (' + x.code + '): ' + x.resolution, Object.assign(cf(c), { exceptionId: x.id, code: x.code, result: 'Closed', resolution: x.resolution }));
  }

  /* ===================== Exceptions ===================== */
  function resolveGates(c, def, o) {
    const out = [];
    if (def.runtime === 'Relevant gate') out.push(o.gate || (c && currentGate(c)) || 'G01');
    else if (def.runtime) { const t = o.txId ? txById(o.txId) : null; out.push(o.gate && SUBSTANTIVE.includes(o.gate) ? o.gate : (t ? t.gate : 'G09')); }
    def.gateList.forEach((g) => { if (!out.includes(g)) out.push(g); });
    return out;
  }
  function assignee(c, x) {
    const o = x.owner;
    if (o === 'Client') return { status: 'awaiting client', who: x.clientId, label: 'the client (PaperSync portal)' };
    if (o === 'Tax Consultant' && c) return { status: 'assigned', who: c.consultant, label: pname(c.consultant) + ' (Tax Consultant)' };
    if (o === 'AI Agent') return { status: 'assigned', who: 'Operon AI (simulated)', label: 'the AI agent (simulated)' };
    if (o === 'Operon (system)') return { status: 'assigned', who: 'Operon', label: 'Operon (system)' };
    if (/^Platform /.test(o)) return { status: 'assigned', who: o + ' (simulated)', label: 'the ' + o + ' (simulated)' };
    const p = personFor(o); return { status: 'assigned', who: p, label: p ? pname(p) + ' (' + o + ')' : o };
  }
  function raise(c, code, o) {
    o = o || {};
    const def = CODE[code]; if (!def) throw new Error('Unknown exception code ' + code);
    const a = o.by || ACTOR.system();
    if (c && o.dedupe !== false) {
      const dup = exOf(c).find((x) => x.code === code && isOpen(x) && (x.item || null) === (o.item || null) && (x.txId || null) === (o.txId || null) && (x.docId || null) === (o.docId || null) && (x.holdId || null) === (o.holdId || null) && (x.inboundId || null) === (o.inboundId || null) && (x.calcRef || null) === (o.calcRef || null));
      if (dup) return dup;
    }
    const gates = resolveGates(c, def, o);
    const x = {
      id: nextId('exN', 'X', 4), code, title: def.title, caseId: c ? c.id : null, clientId: c ? c.clientId : (o.clientId || null), year: c ? c.year : (o.year || null),
      stage: def.stage, gates, severity: def.severity, sev: def.sev, blocking: def.blocking, trigger: def.trigger, source: o.source || sourceOf(a),
      raisedBy: raisedByOf(a), raisedById: whoOf(a), owner: def.owner, secondary: def.secondary || null,
      clientAction: o.clientAction || (def.owner === 'Client' ? def.resolution : null), clientDue: o.clientDue || null, sarsDeadline: o.sarsDeadline || null,
      related: [], parent: o.parent || null, resolution: null, evidence: null, resolvedBy: null, resolvedById: null, resolvedAt: null,
      humanApproval: def.sev === 'S1' || def.sev === 'S2', gateReleased: '', byGate: BY_GATE.includes(code), fromGate: o.fromGate || null,
      item: o.item || null, docId: o.docId || null, txId: o.txId || null, holdId: o.holdId || null, inboundId: o.inboundId || null, calcRef: o.calcRef || null, status: 'raised', assignee: null,
      incidentId: null, closedBy: null, closedAt: null, fallback: def.blocking === 'Conditional' ? { recorded: null, reconciled: null } : null,
      override: null, sevRequest: null, note: o.note || '', at: now(),
    };
    const as = assignee(c, x); x.status = as.status; x.assignee = as.who;
    S.exceptions.push(x);
    log(a, 'Raised ' + code + ' ' + def.title + (o.note ? ': ' + o.note : '') + '. Assigned to ' + as.label + '.',
      Object.assign(cf(c), { client: x.clientId, code, exceptionId: x.id, gate: gates.join('; '), severity: def.severity, owner: def.owner, result: 'Raised', sarsTx: x.txId, doc: x.docId }));
    if (c && OPENS_FLAG[code]) c.flags[OPENS_FLAG[code]] = true;
    // A BY_GATE code raised after its gates passed means those gates must be passed again.
    if (c && x.byGate) {
      const done = gates.filter((g) => g !== 'G17' && g !== x.fromGate && applies(c, g) && c.gates[g].status === 'released');
      if (done.length) reopenFrom(c, done.sort((p, q) => SEQ.indexOf(p) - SEQ.indexOf(q))[0], a, code + ' ' + x.id + ' needs ' + list(done) + ' again');
    }
    autoLinks(c, x, a, o);
    if (c && !o.noSettle) settle(c);
    return x;
  }
  function relate(x, y) { if (!x.related.includes(y.id)) x.related.push(y.id); if (!y.related.includes(x.id)) y.related.push(x.id); }
  function autoLinks(c, x, a, o) {
    // Incident first: a G17-mapped code opens an incident (with or without a case); a linked child joins its parent's.
    if (x.gates.includes('G17')) {
      const par = x.parent ? exById(x.parent) : null;
      const inc = par && par.incidentId ? incById(par.incidentId) : null;
      if (inc && inc.status === 'open') { inc.codes.push(x.code); inc.exceptionIds.push(x.id); x.incidentId = inc.id; log(ACTOR.system(), 'Linked ' + x.id + ' (' + x.code + ') to incident ' + inc.id, Object.assign(cf(c), { exceptionId: x.id, code: x.code, gate: 'G17' })); }
      else openIncident(c, x);
    }
    if (!c || o.linked) return;
    const link = (code) => { const y = raise(c, code, { by: a, parent: x.id, txId: x.txId, docId: x.docId, item: x.item, gate: o.gate, linked: true, source: x.source, note: 'Linked to ' + x.code + ' ' + x.id, noSettle: true }); relate(x, y); return y; };
    if (x.code === 'DOC-04') link('SEC-01');
    const t = x.txId ? txById(x.txId) : null;
    if (t && t.fn === 'itr12') {
      if (x.code === 'INT-09') link('SUB-01'); else if (x.code === 'SUB-01') link('INT-09');
      if (x.code === 'INT-10') link('SUB-03'); else if (x.code === 'SUB-03') link('INT-10');
    }
  }
  // The register lets any person raise any of the 116 codes by hand (the "Raise exception" picker).
  function raiseManual(c, code, a, o) {
    const w = staffWhy(a); if (w) return refuse(a, c, 'Raising ' + code + ' refused', w, { code });
    if (!CODE[code]) return fail('Unknown exception code ' + code);
    const x = raise(c, code, Object.assign({}, o || {}, { by: a, dedupe: false }));
    return okr({ exception: x });
  }

  // Who may resolve: nobody for PORTAL_ONLY codes (only the client's fresh portal approval clears them); the owner role otherwise,
  // with the stand-ins the register implies (client-owned items can be recorded by the consultant or administrator; AI- and
  // system-owned by the consultant).
  function resolverCheck(x, a) {
    const c = caseOf(x);
    if (PORTAL_ONLY.includes(x.code)) return x.code + ' is resolved only by the client’s fresh approval of the current version in the PaperSync portal';
    const o = x.owner;
    if (o === 'Client') return (a.type === 'client' && a.via === 'portal' && c && a.id === c.clientId) ? null : staffWhy(a, ['Tax Consultant', 'Administrator']);
    if (o === 'AI Agent') return a.type === 'ai' || a.type === 'system' ? null : staffWhy(a, 'Tax Consultant');
    if (o === 'Operon (system)') return a.type === 'system' ? null : staffWhy(a, 'Tax Consultant');
    if (/^Platform /.test(o)) return a.type === 'platform' && a.role === o ? null : x.code + ' is resolved by the ' + o + ' (simulated platform team)';
    return staffWhy(a, o);
  }
  const txOf = (x) => (x.txId ? txById(x.txId) : null);
  const holdGuard = (c, x) => { const h = x.holdId && c.retention.holds.find((y) => y.id === x.holdId); return h && !h.released ? 'Release hold ' + h.id + ' (' + h.label + ') first' : null; };
  // A judgement item the calculator flagged resolves once the Tax Consultant recorded the amount and rationale and the calculation was rerun.
  function judgementGuard(c, x) {
    if (!x.calcRef || !c.inputs) return null;
    const l = (c.inputs.lines || []).find((y) => y.id === x.calcRef);
    if (!l) return null;
    if (!(l.decided && l.decided.by)) return 'Record the Tax Consultant’s amount and rationale for ' + l.id + ' first';
    return c.calc && (c.calc.pending || []).some((p) => p.line === l.id) ? 'Rerun the calculation with the decision on ' + l.id + ' first' : null;
  }
  const RESOLVE_GUARD = {
    'DOC-04': (c, x) => (x.related.map(exById).some((y) => y && y.code === 'SEC-01' && isOpen(y)) ? 'Resolve the linked SEC-01 incident first' : null),
    'INT-04': (c, x) => { const t = txOf(x); return t && t.status === 'unknown' ? 'Check the SARS status of ' + t.id + ' first: it is still unknown' : null; },
    'VER-01': (c) => (['G05', 'G06'].every((g) => c.gates[g].status === 'released' && c.gates[g].version === vN(c)) ? null : 'G05 and G06 must be released again on version ' + vN(c)),
    'VER-02': (c) => (drift(c).length ? 'The record still differs from version ' + vN(c) : null),
    'DA-04': (c) => (exOf(c).some((y) => y.code === 'VRF-01') ? null : 'Open the verification workflow (VRF-01) first'),
    'PRE-02': (c) => { const b = preBlockers(c); return b.length ? 'Still open: ' + list(b.map((y) => y.code)) : null; },
    'PRE-01': (c) => (c.recon.ok ? null : 'The final reconciliation still fails'),
    'REM-01': (c) => (c.remedy && c.remedy.route ? null : 'Choose the remedy route first'),
    'AI-06': (c, x) => (S.aiUp || (x.fallback.recorded && x.fallback.reconciled) ? null : 'The AI service is still down and no fallback is reconciled'),
    'INT-03': (c, x) => (S.link.up || (x.fallback.recorded && x.fallback.reconciled) ? null : 'The SARS interface is still down and no fallback is reconciled'),
    'INT-13': (c, x) => (x.fallback.recorded && x.fallback.reconciled ? null : 'A different person must reconcile the manual filing first (independent reconciliation)'),
    'INT-15': (c, x) => (x.fallback.recorded && x.fallback.reconciled ? null : 'Record the confirmed dates and have them independently reconciled first'),
    'INT-01': () => (S.link.auth ? null : 'SARS authentication is still failing'),
    'INT-02': () => (S.link.rights ? null : 'The eFiling rights are still missing'),
    'RET-01': holdGuard, 'RET-02': holdGuard, 'RET-04': holdGuard,
    'TAX-01': (c) => (c.calc && c.calc.errors && c.calc.errors.length ? 'The current calculation still fails validation: ' + c.calc.errors[0] : null),
    'TAX-02': judgementGuard,
    'AI-05': judgementGuard,
    'TAX-06': (c) => {
      const rs = rulesetOf(S.rulesetVersion);
      if (!rs) return 'There is no ruleset ' + S.rulesetVersion;
      if (rs.year !== c.year) return 'The configured ruleset ' + S.rulesetVersion + ' is for ' + rs.year + ', not ' + c.year;
      return c.calc && c.calc.ruleset === S.rulesetVersion && !c.rerun ? null : 'Rerun the calculation on ruleset ' + S.rulesetVersion + ' first';
    },
    'AI-07': (c) => {
      if (c.rerun) return 'Rerun the calculation on ruleset ' + S.rulesetVersion + ' first (impact assessment)';
      const rs = rulesetOf(S.rulesetVersion);
      if (rs && rs.year !== c.year) return 'The configured ruleset ' + S.rulesetVersion + ' is for ' + rs.year + ', not ' + c.year + ': restore the approved ruleset first';
      return hasOpen(c, 'TAX-06') ? 'Resolve TAX-06 (wrong-year ruleset) first' : null;
    },
  };
  function resolveGuard(c, x) {
    if (x.byGate && x.code !== 'CLT-07') return x.code + ' closes when ' + list(x.gates.filter((g) => g !== x.fromGate && g !== 'G17')) + ' pass' + (x.gates.some((g) => SUBSTANTIVE.includes(g) && g !== 'G09') ? ' and the SARS transaction succeeds' : '');
    // Anything tied to an incident (SEC codes included) waits for the Information Officer to close the incident; closing it resolves the SEC codes.
    if (x.incidentId) { const inc = incById(x.incidentId); if (inc && inc.status !== 'closed') return 'Close incident ' + inc.id + ' first (G17)'; }
    const g = RESOLVE_GUARD[x.code];
    return g && c ? g(c, x) : null;
  }
  function resolve(x, a, o) {
    o = o || {};
    const c = caseOf(x);
    const audit = { exceptionId: x.id, code: x.code, client: x.clientId };
    if (!isOpen(x)) return refuse(a, c, 'Resolving ' + x.id + ' refused', x.id + ' is already ' + x.status, audit);
    const who = resolverCheck(x, a); if (who) return refuse(a, c, 'Resolving ' + x.id + ' (' + x.code + ') refused', who, audit);
    const guard = resolveGuard(c, x); if (guard) return refuse(a, c, 'Resolving ' + x.id + ' (' + x.code + ') refused', guard, audit);
    const action = String(o.action || '').trim();
    if (!action) return refuse(a, c, 'Resolving ' + x.id + ' refused', 'Record the resolution action', audit);
    finishResolve(x, a, action, o.evidence || null);
    if (c) settle(c);
    return okr();
  }
  // The recorded resolution, used by resolve() and by the rules that resolve an exception when its criterion is met.
  function finishResolve(x, a, action, evidence) {
    const c = caseOf(x);
    x.status = 'resolved'; x.resolution = action; x.evidence = evidence; x.resolvedBy = nameOf(a); x.resolvedById = a.id; x.resolvedAt = now();
    log(a, 'Resolved ' + x.id + ' (' + x.code + '): ' + action, Object.assign(cf(c), { client: x.clientId, exceptionId: x.id, code: x.code, resolution: action, evidence: evidence || '', result: 'Resolved', severity: x.severity, owner: x.owner }));
    if (!c && !x.secondary) { x.status = 'closed'; x.closedBy = 'Operon'; x.closedAt = now(); }
    if (c && x.docId) releaseDocHold(c, x.docId);
  }
  // Secondary review: a different person, in the secondary role, closes a resolved exception.
  function close(x, a, o) {
    o = o || {};
    const c = caseOf(x);
    const audit = { exceptionId: x.id, code: x.code, client: x.clientId };
    if (x.status !== 'resolved') return refuse(a, c, 'Closing ' + x.id + ' refused', x.id + ' is ' + x.status + ', not resolved', audit);
    if (!x.secondary) return refuse(a, c, 'Closing ' + x.id + ' refused', x.code + ' has no secondary reviewer; it closes when its gates are done', audit);
    const sec = x.secondary;
    const who = /^Platform /.test(sec) ? (a.type === 'platform' && a.role === sec ? null : 'The ' + sec + ' (simulated platform team) closes ' + x.code) : staffWhy(a, sec);
    if (who) return refuse(a, c, 'Closing ' + x.id + ' refused', who, audit);
    if (a.id === x.resolvedById) return refuse(a, c, 'Closing ' + x.id + ' refused', 'The secondary reviewer must be a different person from the one who resolved it', audit);
    x.status = 'closed'; x.closedBy = nameOf(a); x.closedById = a.id; x.closedAt = now();
    log(a, 'Closed ' + x.id + ' (' + x.code + ') as secondary reviewer' + (o.note ? ': ' + o.note : ''), Object.assign(cf(c), audit, { result: 'Closed' }));
    if (c) { if (x.docId) releaseDocHold(c, x.docId); settle(c); }
    return okr();
  }
  function releaseDocHold(c, docId) {
    const d = c.docs.find((y) => y.id === docId);
    if (!d || d.status !== 'held') return;
    if (liveEx(c).some((x) => x.docId === docId && blocksNow(x))) return;
    d.status = 'validated';
    log(ACTOR.system(), 'Validated ' + d.name + ' after its exceptions were cleared', Object.assign(cf(c), { doc: d.id }));
  }

  /* ---------- Severity: staff, the AI and the system may raise it; only a person may lower it; lowering S1/S2 needs the Records/Compliance Owner ---------- */
  function applySeverity(x, to, a, note, viaRequest) {
    const c = caseOf(x); const from = x.sev; const def = CODE[x.code];
    x.sev = to; x.severity = SEV_LABEL[to]; x.humanApproval = to === 'S1' || to === 'S2';
    if (to === 'S4') x.blocking = 'No'; else if (from === 'S4') x.blocking = def.blocking === 'No' ? 'Yes' : def.blocking;
    // A pending lowering request was for the old severity; it lapses when the severity moves another way.
    if (!viaRequest && x.sevRequest && x.sevRequest.status === 'pending') {
      x.sevRequest.status = 'lapsed'; x.sevRequest.lapsedAt = now();
      log(ACTOR.system(), 'The request to lower ' + x.id + ' (' + x.code + ') from ' + x.sevRequest.from + ' to ' + x.sevRequest.to + ' lapsed: the severity is now ' + to, Object.assign(cf(c), { exceptionId: x.id, code: x.code, result: 'Lapsed' }));
    }
    log(a, 'Changed the severity of ' + x.id + ' (' + x.code + ') from ' + from + ' to ' + to + (note ? ': ' + note : ''),
      Object.assign(cf(c), { exceptionId: x.id, code: x.code, before: from, after: to, severity: x.severity, result: 'Changed' }));
    if (c) settle(c);
  }
  function setSeverity(x, a, to, o) {
    o = o || {};
    const c = caseOf(x); const audit = { exceptionId: x.id, code: x.code };
    if (!SEV.includes(to) || to === x.sev) return fail('Pick a different severity');
    if (a.type === 'client') return refuse(a, c, 'Severity change refused', 'Clients do not set severities', audit);
    if (a.type === 'human') { const w0 = staffWhy(a); if (w0) return refuse(a, c, 'Severity change refused', w0, audit); }
    if (x.status === 'closed') return refuse(a, c, 'Severity change refused', x.id + ' is closed', audit);
    const raising = SEV.indexOf(to) < SEV.indexOf(x.sev);
    if (raising) { applySeverity(x, to, a, o.reason); return okr(); }
    if (a.type !== 'human') return refuse(a, c, 'Lowering ' + x.id + ' refused', 'Only a person may lower a severity; the AI may only raise it', audit);
    const reason = String(o.reason || '').trim(); if (!reason) return refuse(a, c, 'Lowering ' + x.id + ' refused', 'Give the reason for lowering the severity', audit);
    if (x.sev === 'S1' || x.sev === 'S2') {
      x.sevRequest = { from: x.sev, to, by: a.id, role: a.role, reason, at: now(), status: 'pending' };
      log(a, 'Asked to lower ' + x.id + ' (' + x.code + ') from ' + x.sev + ' to ' + to + ': ' + reason + '. Needs the Records/Compliance Owner’s approval.',
        Object.assign(cf(c), audit, { before: x.sev, after: to, reason, result: 'Requested' }));
      return okr({ pending: true });
    }
    applySeverity(x, to, a, reason);
    return okr();
  }
  function approveSeverity(x, a, o) {
    o = o || {};
    const c = caseOf(x); const audit = { exceptionId: x.id, code: x.code }; const rq = x.sevRequest;
    if (!rq || rq.status !== 'pending') return fail('No severity change is waiting for approval');
    const w = staffWhy(a, 'Records/Compliance Owner'); if (w) return refuse(a, c, 'Severity approval refused', w, audit);
    if (a.id === rq.by) return refuse(a, c, 'Severity approval refused', 'The approver must not be the person who asked for the change', audit);
    if (x.status === 'closed') { rq.status = 'lapsed'; return refuse(a, c, 'Severity approval refused', x.id + ' is closed; the request lapses', audit); }
    if (x.sev !== rq.from) { rq.status = 'lapsed'; return refuse(a, c, 'Severity approval refused', 'The request was to lower ' + rq.from + ', but ' + x.id + ' is now ' + x.sev + '; the request lapses, ask again', audit); }
    if (o.approve === false) { rq.status = 'declined'; rq.decidedBy = a.id; rq.decidedAt = now(); log(a, 'Declined lowering ' + x.id + ' to ' + rq.to, Object.assign(cf(c), audit, { result: 'Declined' })); return okr(); }
    rq.status = 'approved'; rq.decidedBy = a.id; rq.decidedAt = now();
    applySeverity(x, rq.to, a, 'approved request by ' + pname(rq.by) + ': ' + rq.reason, true);
    return okr();
  }

  /* ---------- Overrides: S2 only, never for authority, security, SARS-interface or statutory-hold codes, and only from the policy list ---------- */
  // Codes that may never go on the override list: missing taxpayer authority, security, SARS interface, statutory holds, and anything not S2.
  function eligibleWhy(code) {
    const d = CODE[code];
    if (!d) return 'Unknown code ' + code;
    if (NEVER_OVERRIDE.authority.includes(code)) return 'No override may bypass missing taxpayer authority (' + code + ')';
    if (NEVER_OVERRIDE.security.includes(code)) return 'No override may bypass a security control (' + code + ')';
    const fam = code.split('-')[0];
    if (NEVER_OVERRIDE.families[fam]) return 'No override may bypass ' + NEVER_OVERRIDE.families[fam] + ' (' + code + ')';
    if (d.sev !== 'S2') return 'Only S2 codes can be put on the override list';
    return null;
  }
  function overrideWhy(x) {
    if (x.sev === 'S1') return 'S1 is always a hard stop and cannot be overridden';
    if (x.sev !== 'S2') return 'Only an S2 exception can be overridden';
    const e = eligibleWhy(x.code); if (e) return e;
    if (!S.policy.overridable.includes(x.code)) return x.code + ' is not on the override policy list (pending Johan)';
    return null;
  }
  function requestOverride(x, a, o) {
    o = o || {};
    const c = caseOf(x); const audit = { exceptionId: x.id, code: x.code };
    const w = staffWhy(a); if (w) return refuse(a, c, 'Override request refused', w, audit);
    if (!isOpen(x)) return refuse(a, c, 'Override request refused', x.id + ' is ' + x.status, audit);
    const why = overrideWhy(x); if (why) return refuse(a, c, 'Override of ' + x.id + ' refused', why, audit);
    const reason = String(o.reason || '').trim(); const evidence = String(o.evidence || '').trim();
    if (!reason || !evidence) return refuse(a, c, 'Override of ' + x.id + ' refused', 'Give the reason and the evidence', audit);
    x.override = { requestedBy: a.id, role: a.role, reason, evidence, at: now(), version: vN(c), status: 'requested', approvedBy: null, approvedAt: null };
    log(a, 'Asked to override ' + x.id + ' (' + x.code + ') on version ' + vN(c) + ': ' + reason, Object.assign(cf(c), audit, { reason, evidence, result: 'Requested' }));
    return okr();
  }
  function approveOverride(x, a) {
    const c = caseOf(x); const audit = { exceptionId: x.id, code: x.code }; const ov = x.override;
    if (!ov || ov.status !== 'requested') return fail('No override is waiting for approval');
    const w = staffWhy(a, 'Records/Compliance Owner'); if (w) return refuse(a, c, 'Override approval refused', w, audit);
    if (a.id === ov.requestedBy) return refuse(a, c, 'Override approval refused', 'The approver must not be the person who asked for the override', audit);
    const why = overrideWhy(x); if (why) return refuse(a, c, 'Override approval refused', why, audit);
    if (ov.version !== vN(c)) return refuse(a, c, 'Override approval refused', 'The request was for version ' + ov.version + '; the case is on version ' + vN(c), audit);
    ov.status = 'approved'; ov.approvedBy = a.id; ov.approvedAt = now();
    log(a, 'Approved the override of ' + x.id + ' (' + x.code + ') for version ' + ov.version + ', asked for by ' + pname(ov.requestedBy) + ' (' + ov.role + ')',
      Object.assign(cf(c), audit, { reason: ov.reason, evidence: ov.evidence, result: 'Approved' }));
    settle(c);
    return okr();
  }
  function setOverridable(code, on, a) {
    const w = staffWhy(a, 'Records/Compliance Owner'); if (w) return refuse(a, null, 'Override policy change refused', w, { code });
    if (!CODE[code]) return fail('Unknown code ' + code);
    if (on) { const e = eligibleWhy(code); if (e) return refuse(a, null, 'Override policy change refused', e, { code }); }
    const set = new Set(S.policy.overridable); const before = set.has(code);
    if (on) set.add(code); else set.delete(code);
    S.policy.overridable = Array.from(set).sort();
    log(a, (on ? 'Allowed overrides of ' : 'Removed overrides of ') + code + ' (policy pending Johan)', { code, before, after: on, result: 'Changed' });
    if (!on) {
      // Taking a code off the list revokes the overrides already approved for it.
      const hit = S.exceptions.filter((x) => x.code === code && x.override && (x.override.status === 'approved' || x.override.status === 'requested'));
      hit.forEach((x) => { x.override.status = 'lapsed'; log(a, 'The override of ' + x.id + ' lapsed: ' + code + ' is no longer on the policy list', Object.assign(cf(caseOf(x)), { exceptionId: x.id, code })); });
      Array.from(new Set(hit.map((x) => caseOf(x)).filter(Boolean))).forEach(settle);
    }
    return okr();
  }

  /* ---------- Manual fallback for the Conditional codes: recorded by one person, independently reconciled by another ---------- */
  function recordFallback(x, a, o) {
    o = o || {};
    const c = caseOf(x); const audit = { exceptionId: x.id, code: x.code };
    if (!x.fallback) return refuse(a, c, 'Fallback refused', x.code + ' is not a Conditional code', audit);
    // An unreadable SARS date is never settled by a note: the dates are confirmed from the notice (confirmInboundDate).
    if (x.code === 'INT-15' && x.inboundId) return refuse(a, c, 'Fallback refused', 'Confirm the dates from the SARS notice (Confirm dates on the SARS link page)', audit);
    const w = staffWhy(a); if (w) return refuse(a, c, 'Fallback refused', w, audit);
    if (x.fallback.recorded) return refuse(a, c, 'Fallback refused', 'A fallback is already recorded for ' + x.id + ' by ' + pname(x.fallback.recorded.by), audit);
    x.fallback.recorded = { by: a.id, at: now(), note: o.note || '', ref: o.ref || null };
    log(a, 'Recorded the manual fallback for ' + x.id + ' (' + x.code + ')' + (o.note ? ': ' + o.note : ''), Object.assign(cf(c), audit, { result: 'Recorded' }));
    return okr();
  }
  function reconcileFallback(x, a, o) {
    o = o || {};
    const c = caseOf(x); const audit = { exceptionId: x.id, code: x.code };
    if (!x.fallback || !x.fallback.recorded) return refuse(a, c, 'Reconciliation refused', 'Record the fallback first', audit);
    if (x.fallback.reconciled) return fail('Already reconciled');
    const w = staffWhy(a); if (w) return refuse(a, c, 'Reconciliation refused', w, audit);
    if (x.code === 'INT-15' && x.inboundId) {
      const it = S.inbound.find((y) => y.id === x.inboundId);
      if (it && !it.date) return refuse(a, c, 'Reconciliation refused', 'The notice date is still unconfirmed', audit);
    }
    const t = x.code === 'INT-13' && x.txId ? txById(x.txId) : null;
    if (a.id === x.fallback.recorded.by || (t && t.manual && t.manual.by === a.id)) return refuse(a, c, 'Reconciliation refused', 'A different person must reconcile the fallback independently', audit);
    x.fallback.reconciled = { by: a.id, at: now(), note: o.note || '', found: o.processed !== false };
    log(a, 'Independently reconciled the fallback for ' + x.id + ' (' + x.code + ')' + (t && o.processed === false ? ': the manual filing is not on eFiling' : ''), Object.assign(cf(c), audit, { result: 'Reconciled' }));
    if (t && t.status === 'manual' && o.processed === false) {
      // The independent check can conclude either way: not filed means "not processed", so a retry under a fresh G18 is possible.
      t.status = 'not processed'; t.doneAt = now();
      if (isOpen(x)) finishResolve(x, a, 'Independent reconciliation found the manual filing was not processed', null);
      heldWithdrawal(c, t);
    } else if (t) {
      if (t.status === 'manual') { t.sentAt = t.sentAt || t.manual.at; succeed(t, c, a, { ref: t.manual.ref, manual: true }); }
      if (isOpen(x)) finishResolve(x, a, 'Manual transaction independently reconciled to the case and audit trail', t.manual ? t.manual.ref : null);
    }
    if (x.code === 'INT-15' && isOpen(x)) finishResolve(x, a, 'Authoritative dates confirmed and independently reconciled', null);
    if (c) settle(c);
    return okr();
  }

  /* ===================== Versions ===================== */
  function change(c, a, data, o) {
    o = o || {};
    if (a.type === 'ai') { const w = aiWhy(a); if (w) return refuse(a, c, 'Change refused', w); }
    else if (a.type !== 'system') { const w = staffWhy(a, 'Tax Consultant'); if (w) return refuse(a, c, 'Change refused', w); }
    if (c.submission && c.submission.ok) return refuse(a, c, 'Change refused', 'The return is submitted; a correction goes through G15 (Request for Correction)');
    const fl = itr12InFlight(c); if (fl) return refuse(a, c, 'Change refused', 'The ITR12 ' + fl.id + ' may already be with SARS (' + fl.status + '); establish its status first', { sarsTx: fl.id });
    const reason = String(o.reason || '').trim(); if (!reason) return refuse(a, c, 'Change refused', 'Give the reason for the change');
    const prev = vN(c);
    const approved = currentApproval(c);
    ['calc', 'schedules', 'itr12'].forEach((k) => { if (data && k in data) c[k] = structuredClone(data[k]); });
    if (data && data.recon) c.recon = structuredClone(data.recon);
    const v = { n: c.versions.length + 1, at: now(), reason, by: whoOf(a), byType: a.type, docs: digest(c.docs.map((d) => d.hash)),
      calc: digest(c.calc), schedules: digest(c.schedules), itr12: digest(c.itr12), data: structuredClone({ calc: c.calc, schedules: c.schedules, itr12: c.itr12 }) };
    c.versions.push(v);
    c.rerun = false;
    log(a, 'Created version ' + v.n + ': ' + reason, Object.assign(cf(c), { before: prev, after: v.n, reason, result: 'Version' }));
    // An override applies to the version it was approved on.
    exOf(c).filter((x) => x.override && x.override.status === 'approved').forEach((x) => { x.override.status = 'lapsed'; log(ACTOR.system(), 'The override of ' + x.id + ' lapsed with version ' + v.n, Object.assign(cf(c), { exceptionId: x.id, code: x.code })); });
    if (approved) {
      c.approval.superseded = true;
      raise(c, 'VER-01', { by: a.type === 'human' ? a : ACTOR.system(), note: 'Version ' + v.n + ' after the client approved version ' + c.approval.version, noSettle: true });
    }
    if (prev && (o.material !== false || approved)) {
      reopenFrom(c, 'G05', a, 'Version ' + v.n + ' replaces version ' + prev);
      c.frozen = null;
      GATE_IDS.forEach((g) => { c.gates[g].rework = null; });
    }
    settle(c);
    return okr({ version: v.n });
  }
  // Simulates an edit made outside the workflow (for the demo and the tests). It is not audited here; the integrity check finds it.
  function outsideEdit(c, patch) { Object.keys(patch || {}).forEach((k) => { if (['calc', 'schedules', 'itr12'].includes(k)) c[k] = Object.assign({}, c[k] || {}, patch[k]); }); }
  function restoreVersion(c, a) {
    if (!(a.type === 'platform' && a.role === 'Platform Administrator')) return refuse(a, c, 'Restore refused', 'The Platform Administrator (simulated platform team) restores a version');
    const v = curVersion(c); if (!v) return fail('No version to restore');
    const d = drift(c);
    ['calc', 'schedules', 'itr12'].forEach((k) => { c[k] = structuredClone(v.data[k]); });
    log(a, 'Restored version ' + v.n + ' (' + (list(d) || 'nothing') + ' had changed outside the workflow)', Object.assign(cf(c), { before: list(d), after: 'version ' + v.n, result: 'Restored' }));
    settle(c);
    return okr();
  }

  /* ===================== The simulated SARS link ===================== */
  function newTx(c, fn, a, o) {
    o = o || {};
    const v = curVersion(c);
    const t = { id: nextId('txN', 'T', 3), caseId: c.id, clientId: c.clientId, fn, label: SARS_FN[fn].label, gate: SARS_FN[fn].gate, dir: 'out',
      version: vN(c), hash: null, status: o.status || 'awaiting G18', signoffs: [], checks: null, created: now(), g18At: null, sentAt: null, doneAt: null,
      ref: null, attempts: [], parentTx: o.parentTx || null, manual: null };
    // The hash covers what is sent, not the transaction id, so a second filing of the same thing is caught as a duplicate (INT-05).
    const payload = fn === 'da' ? { ref: c.da && c.da.ref } : (fn === 'vrf' ? { ref: c.g11Ref || null }
      : (REMEDY_FN.includes(fn) ? { route: c.remedy && c.remedy.route, from: c.remedy && c.remedy.from, evidence: c.remedy && c.remedy.evidence } : null));
    t.hash = fn === 'itr12' ? (v ? v.itr12 : null) : digest({ fn, caseId: c.id, version: t.version, payload });
    S.txs.push(t);
    log(a, (t.status === 'blocked' ? 'Recorded ' : 'Queued ') + t.label + ' ' + t.id + (t.status === 'blocked' ? ' (blocked: unsupported function)' : ' for G18') + ' (simulated SARS link)',
      Object.assign(cf(c), { sarsTx: t.id, gate: t.gate, result: t.status === 'blocked' ? 'Blocked' : 'Queued' }));
    return t;
  }
  // An outbound request made outside the normal gate flow. Before its substantive gate passes it is a gate-bypass attempt (INT-11, S1),
  // whatever the function; an unsupported function behind a passed gate is INT-08.
  function requestTx(c, fn, a) {
    const f = SARS_FN[fn];
    if (!f || f.dir !== 'out') return fail('Unknown outbound SARS function ' + fn);
    if (c.gates[f.gate].status !== 'released') {
      const x = raise(c, 'INT-11', { by: ACTOR.system(), gate: f.gate, source: 'SARS link (simulated)', note: f.label + ' requested by ' + nameOf(a) + ' before ' + f.gate + ' passed' });
      return refuse(a, c, f.label + ' blocked', 'Gate-bypass attempt: ' + f.gate + ' has not passed (INT-11)', { code: 'INT-11', exceptionId: x.id, gate: f.gate }, { exception: x });
    }
    if (REMEDY_FN.includes(fn) && !(c.remedy && c.remedy.route === fn)) return refuse(a, c, f.label + ' refused', 'The approved remedy route is ' + (c.remedy ? c.remedy.route : 'not chosen yet'), { gate: f.gate });
    const live = S.txs.find((t) => t.caseId === c.id && t.fn === fn && ['awaiting G18', 'ready', 'unknown', 'no-response', 'manual', 'blocked'].includes(t.status));
    if (live) return fail(live.id + ' is already ' + live.status, { tx: live });
    if (!f.approved) {
      const t = newTx(c, fn, a, { status: 'blocked' });
      const x = raise(c, 'INT-08', { by: ACTOR.system(), txId: t.id, gate: f.gate, note: f.label + ' is outside the SARS-approved interface capability' });
      return fail(f.label + ' is outside the SARS-approved interface capability (INT-08)', { exception: x, tx: t });
    }
    return okr({ tx: newTx(c, fn, a) });
  }
  function g18Checks(t) {
    const c = caseById(t.caseId); const cl = clientOf(c); const v = curVersion(c); const f = SARS_FN[t.fn];
    const open = (codes) => codes.filter((k) => hasOpen(c, k));
    const res = [];
    const add = (ok, why) => res.push({ n: res.length + 1, label: G18_CHECKS[res.length], ok: !!ok, why: ok ? '' : why });
    const tp = open(['INT-06', 'MD-06']);
    add(cl && cl.taxRef && t.clientId === c.clientId && !tp.length, tp.length ? 'Open ' + list(tp) : 'The taxpayer or tax reference does not match');
    add(f && f.dir === 'out' && c.year === FILING_2026.year, 'The function or tax year does not match the case');
    const au = open(['INT-01', 'INT-02', 'SEC-06']);
    add(S.link.auth && S.link.rights && !au.length, au.length ? 'Open ' + list(au) : (!S.link.auth ? 'SARS authentication is failing' : 'The eFiling rights are missing'));
    let auth = '';
    if (c.gates[t.gate].status !== 'released') auth = t.gate + ' is not released';
    else if (t.fn === 'itr12') { const p = approvalProblem(c); const o4 = open(['CLT-04', 'CLT-06', 'PRE-03']); auth = p || (o4.length ? 'Open ' + list(o4) : ''); }
    else if (REMEDY_FN.includes(t.fn) && !(c.remedy && c.remedy.route === t.fn && c.remedy.authority && c.remedy.authority.route === t.fn)) auth = 'The client has not authorised this ' + t.label;
    add(!auth, auth);
    let ver = '';
    if (t.version !== vN(c)) ver = 'Prepared on version ' + t.version + '; the case is on version ' + vN(c);
    else if (t.fn === 'itr12' && (!v || t.hash !== v.itr12)) ver = 'The ITR12 hash differs from the approved version';
    else if (t.fn === 'itr12' && digest(c.itr12) !== t.hash) ver = 'The ITR12 on record no longer matches version ' + t.version;
    else if (t.fn === 'itr12' && (!c.frozen || c.frozen.version !== t.version)) ver = 'Version ' + t.version + ' is not frozen';
    add(!ver, ver);
    const bl = liveEx(c).filter((x) => blocksNow(x) && (x.sev === 'S1' || x.sev === 'S2') && !x.byGate && !x.gates.every((g) => g === 'G16'));
    add(!bl.length, 'Blocking ' + list(bl.map((x) => x.code + ' (' + x.sev + ')')));
    add(f && f.approved === true, 'Not within the SARS-approved interface capability');
    const prior = S.txs.filter((x) => x.caseId === c.id && x !== t && (x.status === 'unknown' || x.status === 'no-response'));
    const p8 = open(['INT-04', 'INT-05']);
    add(!prior.length && !p8.length, prior.length ? list(prior.map((x) => x.id + ' is ' + x.status)) : 'Open ' + list(p8));
    return res;
  }
  // Beyond the eight document checks, the Gate Map applies to G18 itself: an S3 exception mapped to G18 that blocks now (INT-15, or INT-03
  // while the interface is still down) stops the transaction, and so does any open security incident on the case (rule 10).
  function g18Blockers(t, ignore) {
    const c = caseById(t.caseId); const ign = ignore || [];
    const out = liveEx(c).filter((x) => blocksNow(x) && !x.byGate && x.sev === 'S3' && x.gates.includes('G18') && (!x.txId || x.txId === t.id)
      && !ign.includes(x.code) && !(x.code === 'INT-03' && S.link.up)).map((x) => x.code + ' (' + x.sev + ')');
    S.incidents.filter((i) => i.caseId === c.id && i.status === 'open').forEach((i) => out.push('open incident ' + i.id + ' (G17)'));
    if (t.fn === 'itr12' && calcStale(c)) out.push(calcStale(c));
    return out;
  }
  const checkText = (bad, gb) => [bad.length ? 'Check ' + bad.map((k) => k.n + ' fails (' + k.why + ')').join('; ') : '', gb.length ? 'Blocked by ' + list(gb) : ''].filter(Boolean).join('; ');
  function signG18(t, a) {
    const c = caseById(t.caseId); const audit = { sarsTx: t.id, gate: 'G18' };
    if (t.status !== 'awaiting G18') return refuse(a, c, 'G18 sign-off on ' + t.id + ' refused', t.id + ' is ' + t.status + ', not awaiting G18', audit);
    const w = staffWhy(a, ['Integration Administrator', 'Tax Consultant']); if (w) return refuse(a, c, 'G18 sign-off on ' + t.id + ' refused', w, audit);
    if (t.signoffs.some((s) => s.id === a.id)) return refuse(a, c, 'G18 sign-off on ' + t.id + ' refused', 'G18 needs two different people', audit);
    if (t.signoffs.some((s) => s.role === a.role)) return refuse(a, c, 'G18 sign-off on ' + t.id + ' refused', 'The ' + a.role + ' has already signed G18 for ' + t.id + '; the other role signs next', audit);
    settle(c);  // an edit made outside the workflow is found before anyone signs
    if (!S.link.auth && !hasOpen(c, 'INT-01')) raise(c, 'INT-01', { by: ACTOR.system(), txId: t.id, note: 'SARS rejected the access token', noSettle: true });
    if (!S.link.rights && !hasOpen(c, 'INT-02')) raise(c, 'INT-02', { by: ACTOR.system(), txId: t.id, note: 'Missing eFiling rights for ' + t.label, noSettle: true });
    const checks = g18Checks(t); t.checks = checks;
    const bad = checks.filter((k) => !k.ok); const gb = g18Blockers(t);
    if (bad.length || gb.length) return refuse(a, c, 'G18 sign-off on ' + t.id + ' refused', checkText(bad, gb), audit, { checks, blockers: gb });
    t.signoffs.push({ role: a.role, id: a.id, at: now() });
    log(a, 'Signed G18 for ' + t.id + ' (' + t.label + '): all 8 checks pass', Object.assign(cf(c), audit, { result: 'Signed' }));
    if (t.signoffs.length === 2) {
      t.status = 'ready'; t.g18At = now();
      if (t.fn === 'itr12') Object.assign(c.gates.G18, { status: 'released', by: t.signoffs.map((s) => s.id), byType: 'human', at: now(), version: t.version, routed: false, rework: null });
      log(ACTOR.system(), 'Released G18 for ' + t.id + ': signed by ' + t.signoffs.map((s) => pname(s.id) + ' (' + s.role + ')').join(' and '), Object.assign(cf(c), audit, { result: 'Released' }));
      settle(c);
    }
    return okr({ checks, ready: t.status === 'ready' });
  }
  const OUTCOMES = ['success', 'reject', 'unknown', 'no-response'];
  function transmit(t, a, outcome) {
    const c = caseById(t.caseId); const audit = { sarsTx: t.id, gate: t.gate };
    outcome = outcome || 'success';
    if (!OUTCOMES.includes(outcome)) return fail('Unknown simulated outcome ' + outcome + '; use ' + list(OUTCOMES));
    if (a.type !== 'system') { const w = staffWhy(a, 'Integration Administrator'); if (w) return refuse(a, c, 'Sending ' + t.id + ' refused', w, audit); }
    if (t.status === 'unknown' || t.status === 'no-response') return refuse(a, c, 'Sending ' + t.id + ' refused', 'The status of ' + t.id + ' is not known. Check the SARS status first; unknown calls are never retried blindly.', audit);
    if (['success', 'rejected', 'not processed', 'cancelled', 'superseded', 'manual'].includes(t.status)) return refuse(a, c, 'Sending ' + t.id + ' refused', t.id + ' is ' + t.status, audit);
    settle(c);  // an edit made outside the workflow since the sign-off is found before anything is sent
    if (c.gates[t.gate].status !== 'released' || t.status !== 'ready') {
      const missing = c.gates[t.gate].status !== 'released' ? t.gate : 'G18';
      const x = raise(c, 'INT-11', { by: ACTOR.system(), gate: t.gate, txId: t.id, source: 'SARS link (simulated)', note: t.label + ' attempted before ' + missing + ' passed' });
      return refuse(a, c, 'Blocked ' + t.id, 'Gate-bypass attempt: ' + missing + ' has not passed (INT-11)', Object.assign({ code: 'INT-11', exceptionId: x.id }, audit), { exception: x });
    }
    const dup = S.txs.find((x) => x !== t && x.caseId === c.id && ((x.fn === t.fn && x.hash === t.hash && (x.status === 'success' || x.status === 'unknown')) || (t.fn === 'itr12' && x.fn === 'itr12' && x.status === 'success')));
    if (dup) {
      const x = raise(c, 'INT-05', { by: ACTOR.system(), txId: t.id, note: t.id + ' would duplicate ' + dup.id + ' (' + dup.status + ')' });
      return refuse(a, c, 'Sending ' + t.id + ' refused', 'Duplicate SARS transaction risk: ' + dup.id + ' is ' + dup.status + ' (INT-05)', Object.assign({ code: 'INT-05', exceptionId: x.id }, audit), { exception: x });
    }
    if (!S.link.up) {
      const x = raise(c, 'INT-03', { by: ACTOR.system(), txId: t.id, gate: t.gate, note: 'The SARS interface is unavailable' });
      return refuse(a, c, 'Sending ' + t.id + ' refused', 'The SARS interface is unavailable (INT-03)', Object.assign({ code: 'INT-03', exceptionId: x.id }, audit), { exception: x });
    }
    const checks = g18Checks(t); const bad = checks.filter((k) => !k.ok); const gb = g18Blockers(t);
    if (bad.length || gb.length) return refuse(a, c, 'Sending ' + t.id + ' refused', 'The G18 conditions no longer hold: ' + checkText(bad, gb), audit, { checks, blockers: gb });
    t.sentAt = now(); t.attempts.push({ at: t.sentAt, outcome, by: whoOf(a) });
    log(a, 'Sent ' + t.id + ' (' + t.label + ') through the simulated SARS link', Object.assign(cf(c), audit, { result: 'Sent' }));
    if (outcome === 'success') succeed(t, c, a);
    else if (outcome === 'reject') {
      t.status = 'rejected'; t.doneAt = now();
      raise(c, 'INT-09', { by: ACTOR.sars(), txId: t.id, gate: t.gate, note: 'SARS rejected ' + t.id + ' (simulated validation error)', noSettle: true });
      reopenFrom(c, t.gate, ACTOR.system(), 'SARS rejected ' + t.id);
    } else if (outcome === 'unknown') {
      t.status = 'unknown';
      raise(c, 'INT-04', { by: ACTOR.system(), txId: t.id, note: 'No reliable outcome for ' + t.id + '; retry is disabled until the SARS status is checked', noSettle: true });
    } else {
      t.status = 'no-response';
      raise(c, 'INT-10', { by: ACTOR.system(), txId: t.id, note: 'SARS processed ' + t.id + ' but no reference was captured', noSettle: true });
    }
    settle(c);
    return okr({ status: t.status, ref: t.ref });
  }
  function succeed(t, c, a, o) {
    o = o || {};
    t.status = 'success'; t.doneAt = now();
    t.ref = o.ref || ('SARS-' + sha256(t.id + t.hash).slice(0, 10).toUpperCase());
    log(ACTOR.sars(), 'SARS accepted ' + t.id + ' (' + t.label + '), reference ' + t.ref + (o.manual ? ' (manual channel, reconciled)' : ''), Object.assign(cf(c), { sarsTx: t.id, sarsRef: t.ref, gate: t.gate, result: 'Success' }));
    exOf(c).filter((x) => x.code === 'INT-03' && isOpen(x) && (!x.txId || x.txId === t.id)).forEach((x) => finishResolve(x, ACTOR.system(), o.manual ? 'Approved manual fallback completed and reconciled' : 'Controlled retry succeeded', t.ref));
    if (t.fn === 'itr12') {
      c.submission = { ok: true, at: t.sentAt || now(), ref: t.ref, txId: t.id, version: t.version, hash: t.hash };
      startRetention(c);
      const w = c.approval && c.approval.withdrawn;
      // SUB-05: "submission occurs after client withdrew authority", so only a withdrawal strictly before the submission counts.
      if (w && w.at < c.submission.at) raise(c, 'SUB-05', { by: ACTOR.system(), txId: t.id, note: 'Submitted ' + fWhen(c.submission.at) + '; the client withdrew authority ' + fWhen(w.at), noSettle: true });
      else if (w) log(ACTOR.system(), 'The client’s withdrawal (' + fWhen(w.at) + ') came after the submission (' + fWhen(c.submission.at) + '); the filed return stands and any change needs a remedy (G15)', cf(c));
      if (c.pendingIta34) { const p = c.pendingIta34; c.pendingIta34 = null; INBOUND.ita34(c, p); }
    } else if (t.fn === 'da') { if (c.da) c.da.submitted = { at: now(), ref: t.ref }; }
    else if (t.fn === 'vrf') {
      const up = DATES.fromLocal(now());
      if (c.vrf) { c.vrf.uploaded = DATES.iso(up); c.vrf.target = DATES.iso(DATES.addBusinessDays(up, PERIODS.verification.days)); }
      if (c.aud) { c.aud.uploaded = DATES.iso(up); c.aud.target = DATES.iso(DATES.addBusinessDays(up, PERIODS.audit.days)); }
    } else if (t.fn === 'objection' || t.fn === 'appeal') addHold(c, 'dispute', (t.fn === 'objection' ? 'Objection ' : 'Appeal ') + t.ref + ' (dispute hold, TAA s32)', ACTOR.system(), { ref: t.ref });
  }
  function checkStatus(t, a, truth) {
    const c = caseById(t.caseId); const audit = { sarsTx: t.id, gate: t.gate };
    const w = staffWhy(a, 'Integration Administrator'); if (w) return refuse(a, c, 'Status check refused', w, audit);
    if (t.status !== 'unknown' && t.status !== 'no-response') return refuse(a, c, 'Status check refused', t.id + ' is ' + t.status + '; there is nothing to check', audit);
    const processed = truth === 'processed';
    log(a, 'Checked the SARS status of ' + t.id + ': ' + (processed ? 'processed' : 'not processed') + ' (simulated)', Object.assign(cf(c), audit, { result: processed ? 'Processed' : 'Not processed' }));
    const fix = exOf(c).filter((x) => isOpen(x) && x.txId === t.id && ['INT-04', 'INT-10', 'SUB-03'].includes(x.code));
    if (processed) {
      succeed(t, c, a);
      fix.forEach((x) => finishResolve(x, a, 'SARS state positively reconciled: processed, reference ' + t.ref, t.ref));
    } else {
      t.status = 'not processed'; t.doneAt = now();
      fix.forEach((x) => finishResolve(x, a, 'SARS state positively reconciled: not processed. A retry needs a fresh G18.', null));
      heldWithdrawal(c, t);
    }
    settle(c);
    return okr({ status: t.status, ref: t.ref });
  }
  // A withdrawal held while the ITR12 might have been with SARS takes effect once SARS confirms it was not processed.
  function heldWithdrawal(c, t) {
    const wd = t.fn === 'itr12' && c.approval && c.approval.withdrawn;
    if (!wd) return;
    raise(c, wd.code || 'CLT-06', { by: ACTOR.system(), note: 'The withdrawal received while ' + t.id + ' was in flight takes effect', noSettle: true });
    reopenFrom(c, 'G06', ACTOR.system(), 'The client withdrew approval');
  }
  function retry(t, a) {
    const c = caseById(t.caseId); const audit = { sarsTx: t.id, gate: t.gate };
    const w = staffWhy(a, 'Integration Administrator'); if (w) return refuse(a, c, 'Retry refused', w, audit);
    if (t.status !== 'not processed') return refuse(a, c, 'Retry of ' + t.id + ' refused', t.status === 'unknown' || t.status === 'no-response'
      ? 'Check the SARS status first: unknown calls are never retried blindly' : 'Only a transaction SARS confirmed as not processed can be retried', audit);
    if (c.gates[t.gate].status !== 'released') return refuse(a, c, 'Retry of ' + t.id + ' refused', t.gate + ' is no longer released', audit);
    t.status = 'superseded';
    const n = newTx(c, t.fn, a, { parentTx: t.id });
    if (t.fn === 'itr12') { c.subTx = n.id; if (c.gates.G18.status === 'released') Object.assign(c.gates.G18, { status: 'invalidated', invalidated: { at: now(), by: whoOf(a), why: 'Retry ' + n.id + ' needs a fresh G18' } }); }
    log(a, 'Retry of ' + t.id + ' queued as ' + n.id + '; it needs a fresh G18', Object.assign(cf(c), audit, { result: 'Queued' }));
    settle(c);
    return okr({ tx: n });
  }
  // Manual channel: after G18 when the interface is down (INT-03), or when an unsupported function has an approved alternative (INT-08).
  // Either way the substantive gate must have passed and the G18 conditions must hold now.
  function manualFallback(t, a, o) {
    o = o || {};
    const c = caseById(t.caseId); const audit = { sarsTx: t.id, gate: t.gate };
    const w = staffWhy(a, 'Tax Consultant'); if (w) return refuse(a, c, 'Manual fallback refused', w, audit);
    const ref = String(o.ref || '').trim(); if (!ref) return refuse(a, c, 'Manual fallback refused', 'Record the reference from the manual channel', audit);
    const linkDown = t.status === 'ready' && (!S.link.up || exOf(c).some((x) => x.code === 'INT-03' && isOpen(x) && (!x.txId || x.txId === t.id)));
    const altChannel = t.status === 'blocked' && exOf(c).some((x) => x.code === 'INT-08' && x.txId === t.id && !isOpen(x));
    if (!linkDown && !altChannel) return refuse(a, c, 'Manual fallback refused', 'A manual fallback applies only after G18 when the SARS interface is down (INT-03), or for an unsupported function once the Integration Administrator has approved the alternative channel (INT-08)', audit);
    if (c.gates[t.gate].status !== 'released') return refuse(a, c, 'Manual fallback refused', t.gate + ' is not released', audit);
    settle(c);
    const bad = g18Checks(t).filter((k) => !k.ok && !(altChannel && k.n === 7)); const gb = g18Blockers(t, ['INT-03']);
    if (bad.length || gb.length) return refuse(a, c, 'Manual fallback refused', checkText(bad, gb), audit);
    const x = raise(c, 'INT-13', { by: a, txId: t.id, gate: t.gate, note: 'Manual ' + t.label + ', reference ' + ref, noSettle: true });
    x.fallback.recorded = { by: a.id, at: now(), ref, note: o.note || '' };
    t.status = 'manual'; t.manual = { by: a.id, at: now(), ref };
    exOf(c).filter((y) => y.code === 'INT-03' && isOpen(y) && (!y.txId || y.txId === t.id) && !y.fallback.recorded).forEach((y) => { y.fallback.recorded = { by: a.id, at: now(), ref, via: x.id }; });
    log(a, 'Recorded the manual fallback for ' + t.id + ' (INT-13 ' + x.id + '), reference ' + ref + '. A different person reconciles it.', Object.assign(cf(c), audit, { code: 'INT-13', exceptionId: x.id, result: 'Recorded' }));
    settle(c);
    return okr({ exception: x });
  }

  /* ===================== Inbound SARS items ===================== */
  const INBOUND = {
    prepop(c, it) { c.prepop = { data: it.data, at: it.at, ref: it.ref }; },
    notice(c, it) { c.notices.push({ ref: it.ref, at: it.at, data: it.data }); },
    daIn(c, it) {
      c.da = { ref: it.ref, received: it.date, due: it.due, questions: (it.data && it.data.questions) || [], window: PERIODS.daWindow.text, submitted: null, moved: null };
      c.req.G10 = [{ key: 'draft', label: 'Response drafted from the case evidence', done: false }, { key: 'support', label: 'Supporting evidence linked to each answer', done: false }];
      raise(c, 'DA-01', { by: ACTOR.sars(), sarsDeadline: it.due, note: 'Declaration Questionnaire ' + it.ref, noSettle: true });
    },
    vrfIn(c, it) {
      c.vrf = { ref: it.ref, received: it.date, due: it.due, requests: (it.data && it.data.requests) || [], uploaded: null, target: null };
      c.g11Ref = it.ref;  // the request the next G11 response answers (its transaction hash covers this)
      c.req.G11 =[{ key: 'pack', label: 'Response pack complete and indexed', done: false }, { key: 'integrity', label: 'File integrity confirmed before the one-time upload', done: false }];
      raise(c, 'VRF-01', { by: ACTOR.sars(), sarsDeadline: it.due, note: 'Verification request ' + it.ref, noSettle: true });
      // A Declaration Questionnaire still unanswered is overtaken: SARS has moved to verification (DA-04).
      if (c.da && !c.da.submitted && !c.da.moved) {
        c.da.moved = { at: now(), ref: it.ref };
        raise(c, 'DA-04', { by: ACTOR.sars(), note: 'Declaration Questionnaire ' + c.da.ref + ' moved to verification ' + it.ref, noSettle: true });
      }
      addHold(c, 'verification', 'Verification ' + it.ref + ' (TAA s32)', ACTOR.system(), { ref: it.ref });
    },
    audIn(c, it) {
      c.aud = { ref: it.ref, received: it.date, due: it.due, requests: (it.data && it.data.requests) || [], uploaded: null, target: null };
      c.g11Ref = it.ref;
      c.req.G11 =[{ key: 'pack', label: 'Response pack complete and indexed', done: false }, { key: 'integrity', label: 'File integrity confirmed before upload', done: false }];
      raise(c, 'AUD-01', { by: ACTOR.sars(), sarsDeadline: it.due, note: 'Audit or expanded enquiry ' + it.ref, noSettle: true });
      addHold(c, 'audit', 'Audit ' + it.ref + ' (TAA s32)', ACTOR.system(), { ref: it.ref });
    },
    ita34(c, it) {
      if (!(c.submission && c.submission.ok)) {
        const fl = itr12InFlight(c);
        if (fl) {
          // SARS may already have the return (status unknown, or a manual filing awaiting reconciliation): apply it once that is settled.
          c.pendingIta34 = it;
          log(ACTOR.system(), 'ITA34 ' + it.ref + ' arrived while ' + fl.id + ' may be with SARS (' + fl.status + '); it is applied once the submission is confirmed', Object.assign(cf(c), { sarsRef: it.ref, result: 'Held' }));
          return;
        }
        c.notices.push({ ref: it.ref, at: it.at, data: it.data, kind: 'ITA34 before submission' });
        log(ACTOR.system(), 'ITA34 ' + it.ref + ' arrived before the firm’s submission (an auto-assessment?). It is kept as a notice for the consultant and is not used for G12.', Object.assign(cf(c), { sarsRef: it.ref, result: 'Held' }));
        return;
      }
      if (it.submissionRef && it.submissionRef !== c.submission.ref) {
        raise(c, 'ASM-05', { by: ACTOR.sars(), note: 'ITA34 ' + it.ref + ' refers to submission ' + it.submissionRef + ', not ' + c.submission.ref, noSettle: true });
        return;
      }
      setIta34(c, it);
    },
    outcome(c, it) {
      c.outcome = { ref: it.ref, date: it.date, data: it.data };
      // The outcome re-opens G12 to G15: the client decides again and any next remedy is chosen afresh.
      if (c.decision) { (c.decisions = c.decisions || []).push(c.decision); c.decision = null; }
      if (c.remedy) { (c.remedies = c.remedies || []).push(c.remedy); c.remedy = null; }
      raise(c, 'REM-08', { by: ACTOR.sars(), note: 'Remedy outcome ' + it.ref, noSettle: true });
      if (it.data && it.data.values) setIta34(c, { ref: it.ref, date: it.date, data: it.data.values });
    },
  };
  function setIta34(c, it) {
    const vals = it.data || {}; const calc = (c.calc && c.calc.summary) || {}; const m = S.policy.materiality.amount;
    const diffs = ITA34_FIELDS.filter((f) => Math.abs((+vals[f.key] || 0) - (+calc[f.key] || 0)) > m).map((f) => ({ key: f.key, label: f.label, firm: +calc[f.key] || 0, sars: +vals[f.key] || 0 }));
    c.ita34 = { ref: it.ref, date: it.date, values: vals, recon: { ok: !diffs.length, diffs } };
    c.req.G13 = [{ key: 'advice', label: 'Client advised of the assessment outcome', done: false }];
    if (diffs.length) raise(c, 'ASM-02', { by: ACTOR.ai(), note: diffs.map((d) => d.label + ': firm ' + R(d.firm) + ', SARS ' + R(d.sars)).join('; '), noSettle: true });
  }
  function receive(o) {
    const f = SARS_FN[o.fn]; if (!f || f.dir !== 'in') throw new Error('Unknown inbound SARS item ' + o.fn);
    const given = (v) => v != null && v !== '';
    const badDate = given(o.date) && !validDay(o.date); const badDue = given(o.due) && !validDay(o.due);
    // An unreadable SARS date is never guessed: it stays empty and INT-15 asks for it to be confirmed from the notice.
    const it = { id: nextId('inN', 'IN', 3), fn: o.fn, label: f.label, taxRef: o.taxRef, year: o.year, ref: o.ref || null, due: validDay(o.due),
      date: badDate ? null : (validDay(o.date) || isoDay(now())), raw: badDate || badDue ? { date: badDate ? String(o.date) : null, due: badDue ? String(o.due) : null } : null,
      data: o.data || null, submissionRef: o.submissionRef || null, at: now(), caseId: null, status: 'received', hash: null };
    it.hash = digest({ fn: it.fn, taxRef: it.taxRef, year: it.year, ref: it.ref, date: it.date, due: it.due || undefined, raw: it.raw || undefined, data: it.data });
    S.inbound.push(it);
    const cl = S.clients.find((x) => x.taxRef === o.taxRef);
    const c = cl ? S.cases.find((x) => x.clientId === cl.id && x.year === o.year) : null;
    if (!c) {
      it.status = 'unrouted';
      log(ACTOR.sars(), 'Received ' + f.label + ' ' + (it.ref || it.id) + ' (hash ' + it.hash.slice(0, 12) + '…) with no matching case', { result: 'Unrouted', sarsRef: it.ref });
      raise(null, 'INT-14', { by: ACTOR.system(), clientId: cl ? cl.id : null, year: o.year || null, inboundId: it.id, dedupe: false, note: f.label + ' ' + (it.ref || it.id) + ' matches no case for that tax reference and year' });
      flagDates(null, it, cl);
      return it;
    }
    route(c, it, ACTOR.sars());
    flagDates(c, it, cl);
    return it;
  }
  function flagDates(c, it, cl) {
    if (!it.raw) return;
    const what = [it.raw.date ? 'date "' + it.raw.date + '"' : '', it.raw.due ? 'due date "' + it.raw.due + '"' : ''].filter(Boolean).join(' and ');
    raise(c, 'INT-15', { by: ACTOR.system(), inboundId: it.id, clientId: cl ? cl.id : null, year: it.year || null, sarsDeadline: null,
      note: 'Unreadable ' + what + ' on ' + it.label + ' ' + (it.ref || it.id) + '; no deadline runs until the date is confirmed from the notice' });
  }
  // The Integration Administrator (or the consultant) confirms the dates from the notice itself; a different person then reconciles INT-15.
  function confirmInboundDate(it, a, o) {
    o = o || {};
    const c = caseById(it.caseId);
    const w = staffWhy(a, ['Integration Administrator', 'Tax Consultant']); if (w) return refuse(a, c, 'Date confirmation refused', w, { sarsRef: it.ref });
    const date = given2(o.date) ? validDay(o.date) : it.date; const due = given2(o.due) ? validDay(o.due) : it.due;
    if ((given2(o.date) && !date) || (given2(o.due) && !due)) return fail('Give the dates as YYYY-MM-DD');
    it.date = date; it.due = due;
    if (c) {
      if (c.ita34 && c.ita34.ref === it.ref) c.ita34.date = date;
      if (c.da && c.da.ref === it.ref) { c.da.received = date; c.da.due = due; }
      if (c.vrf && c.vrf.ref === it.ref) { c.vrf.received = date; c.vrf.due = due; }
      if (c.aud && c.aud.ref === it.ref) { c.aud.received = date; c.aud.due = due; }
      if (c.outcome && c.outcome.ref === it.ref) c.outcome.date = date;
      if (c.remedy && c.remedy.route && !c.remedy.deadline) Object.assign(c.remedy, remedyDeadline(c, c.remedy.route));
    }
    log(a, 'Confirmed from the notice: ' + it.label + ' ' + (it.ref || it.id) + ' dated ' + (date || 'unknown') + (due ? ', due ' + due : ''), Object.assign(cf(c), { sarsRef: it.ref, result: 'Confirmed' }));
    S.exceptions.filter((x) => x.code === 'INT-15' && isOpen(x) && x.inboundId === it.id && !x.fallback.recorded)
      .forEach((x) => { x.fallback.recorded = { by: a.id, at: now(), note: 'Dates confirmed from the notice', ref: it.ref }; });
    if (c) settle(c);
    return okr();
  }
  const given2 = (v) => v != null && v !== '';
  function route(c, it, a) {
    it.caseId = c.id; it.status = 'routed';
    log(a, 'Received ' + it.label + ' ' + (it.ref || it.id) + ' (hash ' + it.hash.slice(0, 12) + '…), routed to ' + c.id, Object.assign(cf(c), { sarsRef: it.ref, result: 'Routed' }));
    // New SARS work on an archived case brings it back from G16; nothing was deleted, so the records are all still there.
    if (c.archived && ['daIn', 'vrfIn', 'audIn', 'ita34', 'outcome'].includes(it.fn)) reopenFrom(c, 'G16', ACTOR.system(), it.label + ' ' + (it.ref || it.id) + ' arrived after the case was archived');
    INBOUND[it.fn](c, it);
    settle(c);
  }
  function routeInbound(it, caseId, a) {
    const w = staffWhy(a, 'Integration Administrator'); if (w) return refuse(a, null, 'Routing refused', w);
    const c = caseById(caseId); if (!c) return fail('No case ' + caseId);
    if (it.status !== 'unrouted') return fail(it.id + ' is already ' + it.status);
    const cl = clientOf(c);
    if (it.taxRef !== cl.taxRef) return refuse(a, c, 'Routing ' + it.id + ' refused', 'The item’s tax reference does not match the client of ' + c.id, { sarsRef: it.ref });
    if (it.year !== c.year) return refuse(a, c, 'Routing ' + it.id + ' refused', 'The item is for the ' + it.year + ' year, not ' + c.year, { sarsRef: it.ref });
    route(c, it, a);
    S.exceptions.filter((x) => x.code === 'INT-14' && isOpen(x) && x.inboundId === it.id).forEach((x) => finishResolve(x, a, 'Case, tax year, type and task confirmed: routed to ' + c.id, null));
    return okr();
  }

  /* ===================== Documents and the simulated AI file checks (name and size only) ===================== */
  function upload(c, itemId, file, a) {
    const it = c.items.find((x) => x.id === itemId); if (!it) return fail('No checklist item ' + itemId);
    if (a.type === 'client') { if (a.id !== c.clientId || a.via !== 'portal') return fail('Not this client'); }
    else { const w = staffWhy(a, ['Administrator', 'Tax Consultant']); if (w) return refuse(a, c, 'Upload refused', w); }
    const d = { id: nextId('docN', 'D', 3), itemId, name: String(file.name), size: +file.size || 0, at: now(), by: a.type === 'client' ? c.clientId : a.id, hash: null, status: 'validated', kind: null, confidence: null };
    d.hash = digest({ name: d.name, size: d.size, at: d.at, caseId: c.id });
    c.docs.push(d);
    log(a, 'Uploaded ' + d.name + ' for ' + it.label, Object.assign(cf(c), { doc: d.id, result: 'Uploaded' }));
    aiCheckFile(c, d, it);
    if (c.versions.length && (d.status === 'validated' || d.status === 'held')) raise(c, 'VER-04', { by: ACTOR.system(), docId: d.id, note: d.name + ' arrived after version ' + vN(c), noSettle: true });
    if (d.status === 'validated') openOf(c, 'DOC-01').filter((x) => x.item === it.id).forEach((x) => finishResolve(x, ACTOR.system(), 'Document received and validated: ' + d.name, d.id));
    settle(c);
    return okr({ doc: d });
  }
  function aiCheckFile(c, d, it) {
    const ai = ACTOR.ai(); const nm = d.name.toLowerCase(); const plain = nm.replace(/[_\-.]+/g, ' ');
    const r = (code, note, extra) => raise(c, code, Object.assign({ by: ai, docId: d.id, item: it.id, note: d.name + ': ' + note, noSettle: true }, extra || {}));
    if (UPLOAD.unsafe.test(nm)) { d.status = 'quarantined'; r('DOC-10', 'unsafe file type; quarantined and never opened'); return; }
    if (!UPLOAD.ok.test(nm)) { d.status = 'rejected'; r('DOC-11', 'file type cannot be processed'); return; }
    if (d.size > UPLOAD.maxBytes) { d.status = 'rejected'; r('DOC-11', 'larger than ' + (UPLOAD.maxBytes / 1048576) + ' MB'); return; }
    if (UPLOAD.encrypted.test(plain)) { d.status = 'rejected'; r('DOC-11', 'looks password-protected'); return; }
    const cl = clientOf(c);
    const esc2 = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const other = (cl.others || []).find((n) => { const first = String(n).trim().split(/\s+/)[0].toLowerCase(); return first.length > 1 && new RegExp('\\b' + esc2(first) + '\\b').test(plain); });
    const ids = plain.match(/\b\d{13}\b/g) || [];
    const foreignId = ids.find((x) => x !== cl.idNo);
    if (other || foreignId) { d.status = 'quarantined'; r('DOC-04', other ? 'names ' + other + ', not the taxpayer' : 'carries another person’s ID number'); return; }
    const dup = c.docs.find((o) => o !== d && o.name === d.name && o.size === d.size && o.status !== 'rejected' && o.status !== 'quarantined');
    if (dup) { d.status = 'duplicate'; r('DOC-05', 'same name and size as ' + dup.id + '; linked and not counted twice'); return; }
    let held = false;
    const years = (plain.match(/\b20\d\d\b/g) || []);
    if (years.length && !years.includes(String(c.year))) { held = true; r('DOC-03', 'dated ' + list(Array.from(new Set(years))) + ', not the ' + c.year + ' year of assessment'); }
    const k = DOC_KINDS.find((x) => x.rx.test(plain));
    d.kind = k ? k.kind : null;
    if (!k || (it.kind && k.kind !== it.kind)) { held = true; r('AI-02', k ? 'looks like ' + k.label + ', not ' + it.label : 'could not be classified'); }
    d.confidence = UPLOAD.lowConfidence.test(plain) ? 0.62 : (d.size < UPLOAD.minBytes ? 0.7 : 0.97);
    if (d.confidence < S.policy.aiConfidence) { held = true; r('AI-01', 'extraction confidence ' + Math.round(d.confidence * 100) + '% is below ' + Math.round(S.policy.aiConfidence * 100) + '%'); }
    d.status = held ? 'held' : 'validated';
    log(ai, (held ? 'Held ' : 'Validated ') + d.name + ' (simulated check on name and size only)', Object.assign(cf(c), { doc: d.id, result: held ? 'Held' : 'Validated' }));
  }
  function approveNa(c, itemId, a) {
    const w = staffWhy(a, 'Tax Consultant'); if (w) return refuse(a, c, 'N/A approval refused', w);
    const it = c.items.find((x) => x.id === itemId); if (!it) return fail('No checklist item ' + itemId);
    if (it.na !== 'requested') return fail('The client has not asked for ' + it.label + ' to be marked not available');
    it.na = 'approved'; it.naBy = a.id;
    log(a, 'Approved the client’s reason why ' + it.label + ' is not available: ' + it.naReason, Object.assign(cf(c), { doc: it.id, reason: it.naReason, result: 'Approved' }));
    openOf(c, 'DOC-01').filter((x) => x.item === it.id).forEach((x) => finishResolve(x, a, 'Consultant-approved reason for non-availability recorded', null));
    settle(c);
    return okr();
  }

  /* ===================== Withdrawal of the client's approval ===================== */
  // However it arrives (a portal withdrawal, a rejection or withholding after approving, or an instruction the firm received another
  // way and records with the time it was received): before submission it re-opens G06 and raises the code; while the ITR12 may
  // already be with SARS it waits for the status to be known; after submission it raises SUB-05 if it took effect first.
  function withdrawApproval(c, a, o) {
    const ap = c.approval; const at = o.at || now(); const code = o.code || 'CLT-06';
    ap.withdrawn = { at, reason: o.reason || '', code, by: a.type === 'client' ? c.clientId : a.id, via: o.via || (a.type === 'client' ? 'PaperSync portal' : 'recorded by staff') };
    log(a, 'Withdrew the approval of version ' + ap.version + (o.reason ? ': ' + o.reason : '') + (o.at ? ' (received ' + fWhen(at) + ')' : ''),
      Object.assign(cf(c), { gate: 'G06', before: 'approved', after: 'withdrawn', reason: o.reason || '', result: 'Withdrawn' }));
    const t = c.subTx ? txById(c.subTx) : null;
    if (c.submission && c.submission.ok) {
      if (at < c.submission.at) raise(c, 'SUB-05', { by: ACTOR.system(), txId: c.submission.txId, note: 'Submitted ' + fWhen(c.submission.at) + ' after the withdrawal took effect ' + fWhen(at) });
      // A rejection of the filed return is a post-submission error for the consultant to remedy (SUB-04 opens G15).
      else if (code === 'CLT-02') raise(c, 'SUB-04', { by: a, note: 'The client rejects the filed return' + (o.reason ? ': ' + o.reason : '') });
      else log(ACTOR.system(), 'The withdrawal came after the return was submitted; the filed return stands and any change needs a remedy (G15)', cf(c));
    } else if (t && IN_FLIGHT.includes(t.status)) {
      log(ACTOR.system(), 'The withdrawal arrived while ' + t.id + ' may be with SARS (' + t.status + '); it is held until the SARS status is known', Object.assign(cf(c), { sarsTx: t.id }));
    } else {
      raise(c, code, { by: a, note: o.reason || 'Approval withdrawn before submission', noSettle: true });
      reopenFrom(c, 'G06', ACTOR.system(), 'The client withdrew approval');
      settle(c);
    }
    return okr();
  }
  // An instruction to withdraw received outside the portal (an email or a call), recorded by staff with the time it was received.
  function recordWithdrawal(c, a, o) {
    o = o || {};
    const w = staffWhy(a, ['Tax Consultant', 'Administrator']); if (w) return refuse(a, c, 'Recording the withdrawal refused', w, { gate: 'G06' });
    if (!currentApproval(c)) return fail('There is no current approval to withdraw');
    const at = o.receivedAt ? new Date(o.receivedAt) : now();
    if (isNaN(at.getTime()) || at > now()) return refuse(a, c, 'Recording the withdrawal refused', 'Give the time the instruction was received (not in the future)', { gate: 'G06' });
    if (at < c.approval.at) return refuse(a, c, 'Recording the withdrawal refused', 'The instruction cannot predate the approval it withdraws (' + fWhen(c.approval.at) + ')', { gate: 'G06' });
    const reason = String(o.reason || '').trim(); if (!reason) return refuse(a, c, 'Recording the withdrawal refused', 'Record what the client said', { gate: 'G06' });
    return withdrawApproval(c, a, { at, reason, code: 'CLT-06', via: 'recorded by ' + pname(a.id) + (o.channel ? ' from ' + o.channel : '') });
  }

  /* ===================== The PaperSync portal: the client's only way to act ===================== */
  function portal(c, action, d) {
    d = d || {};
    const a = ACTOR.client(c.clientId, 'portal');
    const q = c.questionnaire;
    switch (action) {
      case 'verify':
        log(a, 'Opened the PaperSync portal with a one-time code (simulated)', Object.assign(cf(c), { result: 'Verified' }));
        return okr();
      case 'answer': {
        const qq = QUESTIONS.find((x) => x.key === d.key); if (!qq) return fail('Unknown question ' + d.key);
        q.answers[d.key] = !!d.value;
        log(a, 'Answered “' + qq.label + '”: ' + (d.value ? 'yes' : 'no'), Object.assign(cf(c), { result: 'Saved' }));
        return okr();
      }
      case 'submitQuestionnaire': {
        const missing = q.required.filter((k) => !(k in q.answers));
        if (missing.length) {
          raise(c, 'QUE-01', { by: ACTOR.system(), note: 'Unanswered: ' + list(missing.map((k) => (QUESTIONS.find((x) => x.key === k) || { label: k }).label)) });
          return refuse(a, c, 'Questionnaire not submitted', missing.length + ' required question' + (missing.length === 1 ? ' is' : 's are') + ' unanswered');
        }
        if (q.status !== 'submitted') {
          q.status = 'submitted'; q.at = now();
          log(a, 'Submitted the questionnaire', Object.assign(cf(c), { result: 'Submitted' }));
          openOf(c, 'QUE-01').forEach((x) => finishResolve(x, a, 'All mandatory responses completed and saved', null));
          QUESTIONS.forEach((qq) => { if (q.answers[qq.key] && qq.kind && !c.items.some((it) => it.kind === qq.kind)) addItem(c, qq.kind); });
          c.priorYear.filter((k) => q.answers[k] === false).forEach((k) => raise(c, 'QUE-04', { by: ACTOR.ai(), item: k, note: (QUESTIONS.find((x) => x.key === k) || { label: k }).label + ' Yes last year, no this year', noSettle: true }));
          QUESTIONS.filter((qq) => qq.material && q.answers[qq.key] === true && !c.priorYear.includes(qq.key)).forEach((qq) => raise(c, 'QUE-03', { by: ACTOR.ai(), item: qq.key, note: 'New this year: ' + qq.label, noSettle: true }));
        }
        return release(c, 'G03', a);
      }
      case 'upload': return upload(c, d.itemId, d.file || {}, a);
      case 'na': {
        const it = c.items.find((x) => x.id === d.itemId); if (!it) return fail('No checklist item ' + d.itemId);
        const reason = String(d.reason || '').trim(); if (!reason) return fail('Say why the document is not available');
        it.na = 'requested'; it.naReason = reason;
        log(a, 'Said ' + it.label + ' is not available: ' + reason, Object.assign(cf(c), { doc: it.id, reason, result: 'Requested' }));
        return okr();
      }
      case 'submitDocs': {
        const out = c.items.filter((it) => itemState(c, it) === 'requested' && it.na !== 'approved' && !c.docs.some((x) => x.itemId === it.id && x.status !== 'rejected' && x.status !== 'quarantined' && x.status !== 'duplicate'));
        log(a, 'Told the firm the documents are uploaded', Object.assign(cf(c), { result: 'Submitted' }));
        out.forEach((it) => raise(c, 'DOC-01', { by: ACTOR.system(), item: it.id, note: it.label + ' is still outstanding', noSettle: true }));
        settle(c);
        return okr({ missing: out.map((it) => it.id) });
      }
      case 'approve': {
        const v = curVersion(c);
        if (!v) return refuse(a, c, 'Approval refused', 'There is no version to approve');
        if (d.declaration !== true) return refuse(a, c, 'Approval refused', 'Confirm the declaration first');
        if (d.version !== v.n) return refuse(a, c, 'Approval refused', 'This pack is version ' + d.version + '; the current version is ' + v.n);
        if (c.submission && c.submission.ok) return fail('The return is already submitted; a change to it goes through a remedy (G15)');
        const fl = itr12InFlight(c);
        if (fl) {
          // While SARS may already have the return, nothing re-opens. Re-confirming the same version cancels a withdrawal held for the status check.
          if (c.approval && c.approval.withdrawn && !c.approval.superseded && c.approval.version === v.n) {
            const w0 = c.approval.withdrawn; c.approval.withdrawn = null;
            log(a, 'Re-confirmed the approval of version ' + v.n + ' while ' + fl.id + ' may be with SARS; the withdrawal held since ' + fWhen(w0.at) + ' is cancelled',
              Object.assign(cf(c), { gate: 'G06', before: 'withdrawn', after: 'approved v' + v.n, result: 'Approved' }));
            return okr();
          }
          return refuse(a, c, 'Approval refused', 'The ITR12 ' + fl.id + ' may already be with SARS (' + fl.status + '); wait until its status is known', { gate: 'G06', sarsTx: fl.id });
        }
        if (c.gates.G06.status === 'released') {
          if (!approvalProblem(c)) return fail('Version ' + v.n + ' is already approved');
          reopenFrom(c, 'G06', ACTOR.system(), 'The approval on record is no longer valid');
        }
        const portalOnly = liveEx(c).filter((x) => PORTAL_ONLY.includes(x.code) && isOpen(x));
        const pre = canRelease(c, 'G06', a, { ignore: portalOnly.map((x) => x.id) });
        if (pre.before.length || pre.blockers.length) return refuse(a, c, 'Approval refused', pre.before.length ? 'Earlier gates are not done: ' + list(pre.before) : 'Blocked by ' + list(pre.codes), { gate: 'G06' });
        c.approval = { version: v.n, calc: v.calc, itr12: v.itr12, at: now(), declaration: DECLARATION, withdrawn: null, superseded: false, by: c.clientId };
        log(a, 'Approved version ' + v.n + ' and gave version-specific authority to submit it, with the declaration', Object.assign(cf(c), { gate: 'G06', after: 'approved v' + v.n, evidence: DECLARATION, result: 'Approved' }));
        portalOnly.forEach((x) => finishResolve(x, a, 'Fresh, explicit approval of version ' + v.n + ' through the PaperSync portal', null));
        return release(c, 'G06', a);
      }
      case 'reject': {
        const reason = String(d.reason || '').trim(); if (!reason) return fail('Say what is wrong');
        if (currentApproval(c)) return withdrawApproval(c, a, { reason, code: 'CLT-02' });
        return okr({ exception: raise(c, 'CLT-02', { by: a, note: reason }) });
      }
      case 'withhold': {
        const reason = String(d.reason || 'The client did not give authority to submit');
        if (currentApproval(c)) return withdrawApproval(c, a, { reason, code: 'CLT-06' });
        return okr({ exception: raise(c, 'CLT-04', { by: a, note: reason }) });
      }
      case 'withdraw': {
        if (!currentApproval(c)) return fail('There is no current approval to withdraw');
        return withdrawApproval(c, a, { reason: String(d.reason || ''), code: 'CLT-06' });
      }
      case 'decide': {
        if (d.choice !== 'accept' && d.choice !== 'instruct') return fail('Accept the assessment or instruct the firm');
        if (c.gates.G14.status === 'released') return fail('The decision is already recorded');
        const prev = c.decision;
        c.decision = { choice: d.choice, at: now(), note: String(d.note || '') };
        const r = release(c, 'G14', a);
        if (!r.ok) { c.decision = prev; return r; }
        if (d.choice === 'instruct') {
          raise(c, 'CLT-07', { by: a, fromGate: 'G14', note: d.note || 'The client does not accept the assessment', noSettle: true });
          raise(c, 'REM-01', { by: a, fromGate: 'G14', note: d.note || 'The client instructs the firm to act' });
        }
        return okr();
      }
      case 'authorise': {
        if (!c.remedy || !c.remedy.route) return fail('No remedy has been proposed yet');
        c.remedy.authority = { by: c.clientId, at: now(), route: c.remedy.route };
        log(a, 'Authorised the ' + (SARS_FN[c.remedy.route] ? SARS_FN[c.remedy.route].label : c.remedy.route), Object.assign(cf(c), { gate: 'G15', result: 'Authorised' }));
        openOf(c, 'REM-07').forEach((x) => finishResolve(x, a, 'Client authority received through the PaperSync portal', null));
        settle(c);
        return okr();
      }
      case 'respond': {
        const x = exById(d.exceptionId); if (!x || x.caseId !== c.id) return fail('No such exception on this case');
        if (PORTAL_ONLY.includes(x.code)) return fail(x.code + ' is resolved by approving the current version in the portal');
        return resolve(x, a, { action: d.text, evidence: d.evidence || null });
      }
      default: return fail('Unknown portal action ' + action);
    }
  }

  /* ===================== Remedies, reminders, retention and incidents ===================== */
  const REM_FOR = { rfc: 'REM-02', reasons: 'REM-04', objection: 'REM-05', appeal: 'REM-06' };
  const lastRemedy = (c) => (c.remedies && c.remedies.length ? c.remedies[c.remedies.length - 1] : null);
  // The statutory deadline for a remedy: PERIODS days from the date the rules name, skipping 16 Dec to 15 Jan (Chapter 9).
  function remedyDeadline(c, route) {
    const p = PERIODS[route]; const prior = lastRemedy(c);
    if (!p || !p.days) return { from: null, basis: null, deadline: null };
    let from = null; let basis = null;
    if (route === 'appeal') { if (c.outcome) { from = c.outcome.date; basis = 'delivery of the rule 9 notice ' + (c.outcome.ref || ''); } }
    else if (route === 'objection' && c.outcome && prior && prior.route === 'reasons') { from = c.outcome.date; basis = 'delivery of the reasons ' + (c.outcome.ref || ''); }
    else if (c.ita34) { from = c.ita34.date; basis = 'the date of assessment (ITA34 ' + c.ita34.ref + ')'; }
    if (!validDay(from)) return { from: null, basis: (basis ? basis + ': ' : '') + 'the date is not confirmed yet, so no deadline is set', deadline: null };
    return { from, basis, deadline: DATES.iso(DATES.addBusinessDays(DATES.dt(from), p.days, { ch9: p.ch9 })) };
  }
  function chooseRemedy(c, a, route, o) {
    o = o || {};
    const w = staffWhy(a, 'Tax Consultant'); if (w) return refuse(a, c, 'Remedy refused', w, { gate: 'G15' });
    if (route !== 'advice' && !REMEDY_FN.includes(route)) return fail('Unknown remedy ' + route);
    const prior = lastRemedy(c);
    if (route === 'appeal' && !(c.outcome && prior && prior.route === 'objection')) return refuse(a, c, 'Remedy refused', 'An appeal follows the decision on an objection: record the rule 9 notice (the objection outcome) first', { gate: 'G15' });
    const p = PERIODS[route]; const { from, basis, deadline } = remedyDeadline(c, route);
    // A different route after G15 passed re-opens G15, which cancels the transaction queued for the old route.
    if (c.gates.G15.status === 'released' && c.remedy && c.remedy.route !== route) reopenFrom(c, 'G15', a, 'Remedy changed from ' + c.remedy.route + ' to ' + route);
    c.remedy = { route, from, basis, deadline, rule: p ? p.rule : null, authority: c.remedy && c.remedy.route === route ? c.remedy.authority : null, evidence: o.evidence || null, at: now(), by: a.id };
    log(a, 'Chose the remedy: ' + (route === 'advice' ? 'documented advice, no SARS action' : SARS_FN[route].label) + (deadline ? ', due ' + deadline + ' (' + p.days + ' business days from ' + basis + ', ' + from + '; 16 Dec to 15 Jan excluded; ' + p.rule + ')' : ''),
      Object.assign(cf(c), { gate: 'G15', after: route, result: 'Chosen' }));
    if (REM_FOR[route]) raise(c, REM_FOR[route], { by: a, sarsDeadline: deadline, note: SARS_FN[route].label, noSettle: true });
    if (o.evidence) openOf(c, 'REM-01').forEach((x) => finishResolve(x, a, 'Remedy selected and documented: ' + (route === 'advice' ? 'advice' : SARS_FN[route].label), o.evidence));
    if (route === 'advice' && o.evidence) openOf(c, 'CLT-07').forEach((x) => finishResolve(x, a, 'Advice documented', o.evidence));
    settle(c);
    return okr({ deadline });
  }
  function setRemedyEvidence(c, a, evidence) {
    const w = staffWhy(a, 'Tax Consultant'); if (w) return refuse(a, c, 'Remedy update refused', w, { gate: 'G15' });
    if (!c.remedy) return fail('Choose the remedy first');
    c.remedy.evidence = String(evidence || '').trim() || null;
    log(a, 'Recorded the grounds and evidence for the remedy', Object.assign(cf(c), { gate: 'G15', evidence: c.remedy.evidence }));
    settle(c);
    return okr();
  }
  function remind(c, kind, a) {
    const w = staffWhy(a, ['Administrator', 'Tax Consultant']); if (w) return refuse(a, c, 'Reminder refused', w);
    const days = S.policy.reminderDays[kind]; if (!days) return fail('Unknown reminder ' + kind);
    const r = { kind, sent: now(), expires: new Date(now().getTime() + days * 864e5), status: 'sent' };
    c.reminders.push(r);
    log(a, 'Sent a PaperSync ' + kind + ' reminder; it expires ' + fWhen(r.expires) + ' (policy pending Johan)', Object.assign(cf(c), { result: 'Sent' }));
    return okr({ reminder: r });
  }
  function startRetention(c) {
    const r = c.retention; const f = DATES.fromLocal(c.submission.at);
    r.from = DATES.iso(f);
    r.until = DATES.iso(new Date(Date.UTC(f.getUTCFullYear() + S.policy.retentionYears, f.getUTCMonth(), f.getUTCDate())));
    r.review = r.until;
    log(ACTOR.system(), 'Retention runs from ' + r.from + '; review on ' + r.review + ' (' + PERIODS.retention.rule + ')', cf(c));
  }
  function addHold(c, kind, label, a, o) {
    o = o || {};
    const h = { id: 'H' + String(++S.holdN).padStart(3, '0'), kind, label, since: now(), released: null, ref: o.ref || null };
    c.retention.holds.push(h);
    log(a, 'Placed a retention hold: ' + label, Object.assign(cf(c), { gate: 'G16', result: 'Hold' }));
    return h;
  }
  function legalHold(c, a, label) {
    const w = staffWhy(a, 'Records/Compliance Owner'); if (w) return refuse(a, c, 'Legal hold refused', w, { gate: 'G16' });
    const h = addHold(c, 'legal', String(label || 'Legal or compliance hold'), a);
    settle(c);
    return okr({ hold: h });
  }
  function releaseHold(c, holdId, a) {
    const w = staffWhy(a, 'Records/Compliance Owner'); if (w) return refuse(a, c, 'Hold release refused', w, { gate: 'G16' });
    const h = c.retention.holds.find((x) => x.id === holdId); if (!h || h.released) return fail('No active hold ' + holdId);
    h.released = { by: a.id, at: now() };
    log(a, 'Released the retention hold: ' + h.label, Object.assign(cf(c), { gate: 'G16', result: 'Released' }));
    exOf(c).filter((x) => x.holdId === h.id && isOpen(x)).forEach((x) => finishResolve(x, a, 'Hold released; retention reassessed', null));
    settle(c);
    return okr();
  }
  function openIncident(c, x) {
    const inc = { id: nextId('incN', 'INC', 2), caseId: c ? c.id : null, clientId: c ? c.clientId : x.clientId, codes: [x.code], exceptionIds: [x.id], opened: now(), status: 'open',
      steps: { containment: null, investigation: null, remediation: null, notification: null }, gate: { status: 'pending', by: [], at: null }, closed: null };
    S.incidents.push(inc); x.incidentId = inc.id;
    log(ACTOR.system(), 'Opened incident ' + inc.id + ' for ' + x.code + ' ' + x.id + ' (G17).' + (c ? ' SARS transactions on ' + c.id + ' are stopped until it closes.' : ' It is not tied to a case.'),
      Object.assign(cf(c), { client: inc.clientId, gate: 'G17', code: x.code, exceptionId: x.id, owner: 'Information Officer', result: 'Opened' }));
    return inc;
  }
  const INCIDENT_STEPS = { containment: 'Containment', investigation: 'Investigation', remediation: 'Remediation', notification: 'Notification assessment' };
  function incidentStep(inc, step, a, o) {
    o = o || {};
    const c = caseById(inc.caseId);
    const w = staffWhy(a, 'Information Officer'); if (w) return refuse(a, c, 'Incident step refused', w, { gate: 'G17' });
    if (!INCIDENT_STEPS[step]) return fail('Unknown step ' + step);
    if (inc.status !== 'open') return fail(inc.id + ' is closed');
    const note = String(o.note || '').trim(); if (!note) return fail('Record what was done');
    inc.steps[step] = { by: a.id, at: now(), note };
    log(a, inc.id + ': ' + INCIDENT_STEPS[step] + ' recorded: ' + note, Object.assign(cf(c), { gate: 'G17', result: 'Done' }));
    return okr();
  }
  function closeIncident(inc, a) {
    const c = caseById(inc.caseId);
    const w = staffWhy(a, 'Information Officer'); if (w) return refuse(a, c, 'Closing ' + inc.id + ' refused', w, { gate: 'G17' });
    if (inc.status !== 'open') return fail(inc.id + ' is already closed');
    const missing = Object.keys(INCIDENT_STEPS).filter((k) => !inc.steps[k]);
    if (missing.length) return refuse(a, c, 'Closing ' + inc.id + ' refused', 'Still to record: ' + list(missing.map((k) => INCIDENT_STEPS[k])), { gate: 'G17' });
    inc.status = 'closed'; inc.closed = { by: a.id, at: now() }; inc.gate = { status: 'released', by: [a.id], at: now() };
    log(a, 'Closed incident ' + inc.id + ' and released G17: containment, investigation, remediation and the notification assessment are complete', Object.assign(cf(c), { gate: 'G17', result: 'Released' }));
    inc.exceptionIds.map(exById).filter((x) => x && x.code.split('-')[0] === 'SEC' && isOpen(x)).forEach((x) => finishResolve(x, a, 'Incident ' + inc.id + ' closed: containment, investigation, remediation and notification assessment completed', null));
    if (c) settle(c);
    return okr();
  }

  /* ===================== Ticker: deadlines, reminders, retention and integrity ===================== */
  function warnOnce(c, kind, dueIso, code, ch9) {
    const due = validDay(dueIso); if (!due) return false;
    const key = kind + '|' + due; if (c.warned[key]) return false;
    const left = DATES.businessDaysBetween(DATES.fromLocal(now()), DATES.dt(due), { ch9: !!ch9 });
    if (left > S.policy.warnDays) return false;
    c.warned[key] = true;
    raise(c, code, { by: ACTOR.system(), sarsDeadline: due, note: left < 0 ? 'The deadline ' + due + ' has passed' : left + ' business day' + (left === 1 ? '' : 's') + ' left to ' + due });
    return true;
  }
  function watchCase(c) {
    let changed = false;
    if (c.versions.length && drift(c).length && !hasOpen(c, 'VER-02')) { settle(c); changed = true; }
    // The filing-season dates are verified for the 2026 year only.
    if (!(c.submission && c.submission.ok) && c.year === FILING_2026.year) changed = warnOnce(c, 'filing', (c.filing === 'provisional' ? FILING_2026.provisional : FILING_2026.nonProvisional).closes, 'PRE-04') || changed;
    if (c.da && c.da.due && !c.da.submitted && !c.da.moved) changed = warnOnce(c, 'da', c.da.due, 'DA-05') || changed;
    if (c.vrf && c.vrf.due && !c.vrf.uploaded) changed = warnOnce(c, 'vrf', c.vrf.due, 'VRF-03') || changed;
    if (c.remedy && c.remedy.deadline && !stepDone(c, 'G15')) changed = warnOnce(c, 'remedy', c.remedy.deadline, 'REM-09', true) || changed;
    c.reminders.filter((r) => r.status === 'sent').forEach((r) => {
      // A reminder the client has answered is closed; an expired one never counts as approval.
      const answered = r.kind === 'approval' ? (c.gates.G06.status === 'released' || currentApproval(c)) : c.gates.G01.status === 'released';
      if (answered) { r.status = 'answered'; log(ACTOR.system(), 'The ' + r.kind + ' reminder sent ' + fWhen(r.sent) + ' was answered', Object.assign(cf(c), { result: 'Answered' })); changed = true; return; }
      if (r.expires <= now()) {
        r.status = 'expired';
        raise(c, r.kind === 'approval' ? 'CLT-05' : 'CLT-01', { by: ACTOR.system(), note: 'The ' + r.kind + ' reminder sent ' + fWhen(r.sent) + ' expired without a response. An expired reminder never counts as approval.' });
        changed = true;
      }
    });
    const ret = c.retention;
    if (c.submission && c.submission.ok && !ret.from && !ret.raised.meta) { ret.raised.meta = true; raise(c, 'RET-05', { by: ACTOR.system(), note: 'Submitted, but no retention start date is recorded' }); changed = true; }
    if (ret.review && isoDay(now()) >= ret.review) {
      let hit = false;
      if (!ret.raised.review) { ret.raised.review = true; raise(c, 'RET-03', { by: ACTOR.system(), note: 'Retention review date ' + ret.review + ' reached. Nothing is deleted automatically.', noSettle: true }); hit = true; }
      ret.holds.filter((h) => !h.released && !exOf(c).some((x) => x.holdId === h.id && x.status !== 'closed')).forEach((h) => {
        raise(c, h.kind === 'dispute' ? 'RET-02' : (h.kind === 'legal' ? 'RET-04' : 'RET-01'), { by: ACTOR.system(), holdId: h.id, note: h.label + ' is still active at the review date', noSettle: true });
        hit = true;
      });
      if (hit) { settle(c); changed = true; }
    }
    return changed;
  }
  function watch() {
    let changed = false;
    for (const c of S.cases) {
      if (c.archived) continue;
      try { if (watchCase(c)) changed = true; } catch (e) { S.watchErrors = (S.watchErrors || 0) + 1; }  // one bad case must not stop the others
    }
    return changed;
  }
  TICKERS.push(() => watch());

  /* ===================== The Cases board ===================== */
  function columnOf(c) {
    if (c.archived) return 'closed';
    const g = currentGate(c);
    if (!g) return 'closed';
    if (g === 'G12' && !c.ita34) return 'after-filing';
    return (BOARD.find((col) => col.gates.includes(g)) || BOARD[BOARD.length - 1]).key;
  }
  const colIndex = (k) => BOARD.findIndex((x) => x.key === k);
  // Dragging forward asks to pass the gates of the card's current column. One column at a time; client gates and G18 never pass by drag.
  function dragForward(c, a, toKey) {
    const from = columnOf(c); const i = colIndex(from);
    // The next column, skipping columns whose gates do not apply to this case.
    const nexts = []; for (let j = i + 1; j < BOARD.length; j++) { nexts.push(BOARD[j].key); if (BOARD[j].gates.some((g) => applies(c, g))) break; }
    const audit = { gate: currentGate(c) };
    if (toKey && !nexts.includes(toKey)) return refuse(a, c, 'Move of ' + c.id + ' refused', 'Cards move one column at a time; the next column is ' + (nexts.length ? BOARD[colIndex(nexts[nexts.length - 1])].label : 'none'), audit);
    for (let k = 0; k < 6; k++) {
      const g = currentGate(c);
      if (!g) break;
      if (RELEASE[g].by === 'client') return refuse(a, c, 'Move of ' + c.id + ' refused', g + ' (' + GATE[g].control + ') passes only through the client’s PaperSync portal action', { gate: g });
      if (g === 'G18') return refuse(a, c, 'Move of ' + c.id + ' refused', 'Submission needs G18 on the SARS link: two sign-offs and all 8 checks', { gate: g });
      if (c.gates[g].status === 'released') return refuse(a, c, 'Move of ' + c.id + ' refused', g + ' is released; the card moves when SARS confirms its transaction (G18 on the SARS link)', { gate: g });
      if (g === 'G07') { const r7 = canRelease(c, 'G07', ACTOR.system()); return refuse(a, c, 'Move of ' + c.id + ' refused', 'G07 is Operon’s own freeze: ' + (r7.why || 'waiting'), { gate: g, code: list(r7.codes) || null }, { codes: r7.codes }); }
      const r = release(c, g, a);
      if (!r.ok) { log(a, 'Move of ' + c.id + ' snapped back to ' + from, Object.assign(cf(c), { gate: g, code: list(r.codes) || null, result: 'Refused', reason: r.why })); return fail(r.why, { codes: r.codes, blockers: r.blockers, from, to: from }); }
      if (!stepDone(c, g)) {
        log(a, g + ' released by drag; ' + c.id + ' stays in ' + from + ' until SARS confirms the transaction (G18 on the SARS link)', Object.assign(cf(c), { gate: g, result: 'Released' }));
        return okr({ from, to: columnOf(c), awaiting: 'G18' });
      }
      if (columnOf(c) !== from) break;
    }
    const to = columnOf(c);
    if (to === from) return refuse(a, c, 'Move of ' + c.id + ' refused', 'Nothing left to release in ' + from, audit);
    log(a, 'Moved ' + c.id + ' from ' + from + ' to ' + to, Object.assign(cf(c), { before: from, after: to, result: 'Moved' }));
    return okr({ from, to });
  }
  // Dragging backward is "return for rework": a reason, backward only, before submission only. It re-opens from the target column's first
  // gate (from G06 when the client's approval is superseded) and holds that gate for the consultant (the AI will not pass it by itself).
  function returnForRework(c, a, toKey, reason) {
    const w = staffWhy(a, 'Tax Consultant'); if (w) return refuse(a, c, 'Return for rework refused', w);
    const from = columnOf(c); const ti = colIndex(toKey);
    if (ti < 0 || ti >= colIndex(from)) return refuse(a, c, 'Return for rework refused', 'Rework moves a card backward only');
    if (c.submission && c.submission.ok) return refuse(a, c, 'Return for rework refused', 'The return is submitted; a correction goes through G15');
    const fl = itr12InFlight(c); if (fl) return refuse(a, c, 'Return for rework refused', 'The ITR12 ' + fl.id + ' may already be with SARS (' + fl.status + '); establish its status first', { sarsTx: fl.id });
    reason = String(reason || '').trim(); if (!reason) return refuse(a, c, 'Return for rework refused', 'Give the reason for the rework');
    const g0 = BOARD[ti].gates.find((g) => applies(c, g)) || BOARD[ti].gates[0];
    const supersede = currentApproval(c) && SEQ.indexOf(g0) <= SEQ.indexOf('G07');
    if (c.frozen) raise(c, 'VER-01', { by: a, note: 'Returned for rework after the version was frozen: ' + reason, noSettle: true });
    if (supersede) c.approval.superseded = true;
    reopenFrom(c, supersede && SEQ.indexOf(g0) > SEQ.indexOf('G06') ? 'G06' : g0, a, 'Returned for rework: ' + reason);
    c.gates[g0].rework = { by: a.id, at: now(), reason };
    log(a, 'Returned ' + c.id + ' from ' + from + ' to ' + toKey + ' for rework: ' + reason, Object.assign(cf(c), { before: from, after: toKey, reason, gate: g0, result: 'Rework' }));
    settle(c);
    return okr({ from, to: columnOf(c) });
  }

  /* ===================== Platform and simulation controls ===================== */
  function rulesetChange(a, o) {
    o = o || {};
    if (!(a.type === 'platform' || a.type === 'system')) return refuse(a, null, 'Ruleset change refused', 'The platform team changes the ruleset');
    if (o.version && typeof CALC !== 'undefined' && !rulesetOf(o.version)) return refuse(a, null, 'Ruleset change refused', 'There is no ruleset ' + o.version);
    const before = S.rulesetVersion; S.rulesetVersion = String(o.version || before);
    const rs = rulesetOf(S.rulesetVersion);
    log(a, 'Changed the tax ruleset from ' + before + ' to ' + S.rulesetVersion + (rs ? ' (the ' + rs.year + ' year of assessment)' : ''), { before, after: S.rulesetVersion, result: 'Changed' });
    S.cases.filter((c) => !(c.submission && c.submission.ok) && c.calc).forEach((c) => {
      c.rerun = true;
      raise(c, 'AI-07', { by: ACTOR.system(), note: 'Ruleset ' + before + ' → ' + S.rulesetVersion + ' after material processing', noSettle: true });
      if (rs && rs.year !== c.year) raise(c, 'TAX-06', { by: ACTOR.system(), noSettle: true, note: 'Ruleset ' + S.rulesetVersion + ' is for the ' + rs.year + ' year of assessment, not ' + c.year });
      settle(c);
    });
    return okr();
  }
  function setReviewer(c, g, verdict) {
    if (!['G04', 'G08', 'G12'].includes(g)) return fail('The independent reviewer checks G04, G08 and G12 only');
    c.ai[g] = verdict === 'disagree' ? 'disagree' : 'agree';
    log(ACTOR.reviewer(), 'Independent reviewer ' + (verdict === 'disagree' ? 'disagreed with ' : 'agreed with ') + g + ' (simulated)', Object.assign(cf(c), { gate: g, result: verdict === 'disagree' ? 'Disagreed' : 'Agreed' }));
    if (verdict === 'disagree') c.gates[g].routed = false;
    settle(c);
    return okr();
  }
  function setAiUp(up, a) {
    if (!(a.type === 'platform' || a.type === 'system')) return refuse(a, null, 'AI service change refused', 'The platform team runs the AI service');
    S.aiUp = !!up;
    log(a, up ? 'The AI service is back (simulated)' : 'The AI service is down (simulated)', { result: up ? 'Up' : 'Down' });
    if (up) S.exceptions.filter((x) => x.code === 'AI-06' && isOpen(x)).forEach((x) => finishResolve(x, ACTOR.platform('Platform Administrator'), 'Service restored', null));
    S.cases.forEach(settle);
    return okr();
  }
  function setLink(patch, a) {
    if (!(a.type === 'platform' || a.type === 'system')) { const w = staffWhy(a, 'Integration Administrator'); if (w) return refuse(a, null, 'SARS link change refused', w); }
    const before = Object.assign({}, S.link);
    Object.keys(patch || {}).forEach((k) => { if (k in S.link) S.link[k] = !!patch[k]; });
    log(a, 'SARS link (simulated): interface ' + (S.link.up ? 'up' : 'down') + ', authentication ' + (S.link.auth ? 'ok' : 'failing') + ', eFiling rights ' + (S.link.rights ? 'ok' : 'missing'), { before, after: Object.assign({}, S.link), result: 'Changed' });
    S.cases.forEach(settle);
    return okr();
  }

  /* ===================== Exports ===================== */
  function auditCsv() {
    const cell = (v) => {
      let s = v == null ? '' : (v instanceof Date ? v.toISOString() : String(v));
      if (/^[=+\-@\t\r]/.test(s)) s = '\'' + s;  // spreadsheet formula injection guard
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [AUDIT_FIELDS.join(',')].concat(S.audit.map((a) => AUDIT_FIELDS.map((k) => cell(a[k])).join(','))).join('\n');
  }
  const auditJson = () => JSON.stringify(S.audit, null, 2);
  // Recomputes every hash and link, and compares the newest entry and the count with the seal kept outside S (shell.js), so a
  // truncated, replaced or edited trail is reported.
  function verifyChain() {
    for (let i = 0; i < S.audit.length; i++) {
      const a = S.audit[i];
      if (a.prev !== (i ? S.audit[i - 1].hash : ZERO)) return { ok: false, n: S.audit.length, badAt: i, why: 'broken link' };
      if (a.hash !== auditHash(a)) return { ok: false, n: S.audit.length, badAt: i, why: 'hash mismatch' };
    }
    const seal = AUDIT_SEAL.get();
    if (seal.n !== S.audit.length || (S.audit.length && seal.hash !== S.audit[S.audit.length - 1].hash)) return { ok: false, n: S.audit.length, badAt: Math.min(seal.n, S.audit.length), why: 'the trail was truncated or replaced' };
    return { ok: true, n: S.audit.length, badAt: -1 };
  }

  /* ===================== The calculation (calc.js) ===================== */
  // Runs the calculator on the case's extracted values, records the result as a new version, then raises what it found:
  // TAX-01 validation errors, TAX-06 a ruleset for another year, TAX-02/AI-05 undecided judgement items, TAX-05 a material
  // unexplained year-on-year change (once per figure).
  function calculate(c, a, o) {
    o = o || {};
    if (typeof CALC === 'undefined') return fail('The calculator is not loaded');
    if (!c.inputs) return fail('No extracted values on ' + c.id);
    const data = CALC.forCase(c); const k = data.calc;
    k.inputs = digest(c.inputs);  // the extracted values this calculation used (calcStale compares it)
    const r = change(c, a, data, { reason: o.reason || 'Calculation on ruleset ' + k.ruleset, material: o.material });
    if (!r.ok) return r;
    const ai = ACTOR.ai(); const sys = ACTOR.system();
    if (k.errors.length) raise(c, 'TAX-01', { by: sys, note: k.errors.join('; '), noSettle: true });
    if (k.wrongYear) raise(c, 'TAX-06', { by: sys, note: 'Ruleset ' + k.ruleset + ' is for the ' + k.year + ' year of assessment, not ' + c.year, noSettle: true });
    k.pending.forEach((p) => raise(c, p.code, { by: ai, calcRef: p.line, noSettle: true,
      note: p.label + ' (' + p.line + ', ' + CALC.rand(p.amount) + '): ' + (p.code === 'AI-05' ? 'needs interpretation beyond the approved rules' : 'a judgement for the Tax Consultant; left out of the calculation') }));
    const vr = k.variance;
    const cur = vr && vr.material ? 'TI ' + vr.current : null;
    // A TAX-05 raised on an earlier figure no longer describes the case: the system withdraws it.
    openOf(c, 'TAX-05').filter((x) => x.calcRef && /^TI /.test(x.calcRef) && x.calcRef !== cur).forEach((x) => finishResolve(x, sys,
      'Superseded: taxable income is now ' + CALC.rand(k.summary.taxableIncome) + (cur ? '' : ', no longer a material change on last year'), null));
    if (cur && !exOf(c).some((x) => x.code === 'TAX-05' && x.calcRef === cur)) {
      raise(c, 'TAX-05', { by: ai, calcRef: cur, noSettle: true, note: 'Taxable income ' + CALC.rand(vr.current) + ' against ' + CALC.rand(vr.prior) + ' last year (' + (Math.round(vr.ratio * 1000) / 10) + '% change)' });
    }
    settle(c);
    return r;
  }
  // The values extracted from the case's documents (simulated) or entered by the Tax Consultant. calculate() reads them.
  function setInputs(c, a, inputs, o) {
    o = o || {};
    if (a.type === 'ai') { const w = aiWhy(a); if (w) return refuse(a, c, 'Extracted values refused', w); }
    else if (a.type !== 'system') { const w = staffWhy(a, 'Tax Consultant'); if (w) return refuse(a, c, 'Extracted values refused', w); }
    if (c.submission && c.submission.ok) return refuse(a, c, 'Extracted values refused', 'The return is submitted; a correction goes through G15 (Request for Correction)');
    const fl = itr12InFlight(c); if (fl) return refuse(a, c, 'Extracted values refused', 'The ITR12 ' + fl.id + ' may already be with SARS (' + fl.status + '); establish its status first', { sarsTx: fl.id });
    if (!inputs || !Array.isArray(inputs.lines)) return fail('Give the extracted values as { lines: [...] }');
    const before = c.inputs ? c.inputs.lines.length : 0;
    c.inputs = structuredClone(inputs);
    const docs = new Set(c.inputs.lines.map((l) => l.docId).filter(Boolean));
    log(a, (o.note || 'Recorded the extracted values') + ': ' + c.inputs.lines.length + ' value' + (c.inputs.lines.length === 1 ? '' : 's') + ' from ' + docs.size + ' document' + (docs.size === 1 ? '' : 's'),
      Object.assign(cf(c), { before, after: c.inputs.lines.length, result: 'Recorded' }));
    return okr();
  }
  // Drafted answers to a Declaration Questionnaire ('da') or a verification request ('vrf'), each tied to its evidence.
  function draftResponse(c, a, kind, drafts) {
    const w = a.type === 'ai' ? aiWhy(a) : staffWhy(a, 'Tax Consultant'); if (w) return refuse(a, c, 'Draft refused', w);
    const t = kind === 'da' ? c.da : kind === 'vrf' ? c.vrf : null;
    if (!t) return fail('No ' + (kind === 'da' ? 'Declaration Questionnaire' : 'verification request') + ' on ' + c.id);
    if (kind === 'da' && (t.submitted || t.moved)) return fail('The Declaration Questionnaire is already answered or has moved to verification');
    t.drafts = (drafts || []).map((d) => ({ q: String(d.q || ''), a: String(d.a || ''), evidence: d.evidence || null }));
    t.draftedBy = whoOf(a); t.draftedAt = now();
    log(a, 'Drafted ' + t.drafts.length + ' answer' + (t.drafts.length === 1 ? '' : 's') + ' to ' + t.ref + (a.type === 'ai' ? ' for the Tax Consultant to review (simulated)' : ''),
      Object.assign(cf(c), { sarsRef: t.ref, result: 'Drafted' }));
    return kind === 'da' ? markReq(c, 'G10', 'draft', a) : okr();
  }
  // The Tax Consultant's decision on a judgement item: the amount and the treatment, authority or rationale. calculate() then uses it.
  function decideItem(c, lineId, a, o) {
    o = o || {};
    const w = staffWhy(a, 'Tax Consultant'); if (w) return refuse(a, c, 'Decision refused', w);
    if (c.submission && c.submission.ok) return refuse(a, c, 'Decision refused', 'The return is submitted; a correction goes through G15 (Request for Correction)');
    const fl = itr12InFlight(c); if (fl) return refuse(a, c, 'Decision refused', 'The ITR12 ' + fl.id + ' may already be with SARS (' + fl.status + '); establish its status first', { sarsTx: fl.id });
    const l = c.inputs && (c.inputs.lines || []).find((x) => x.id === lineId); if (!l) return fail('No extracted value ' + lineId);
    const f = typeof CALC !== 'undefined' ? CALC.FIELDS[l.field] : null;
    if (!f || !f.judgement) return fail(lineId + ' is not a judgement item');
    const rationale = String(o.rationale || '').trim();
    if (!rationale) return refuse(a, c, 'Decision refused', 'Record the treatment, the authority or rationale, and the conclusion');
    const amount = o.amount == null ? l.amount : Number(o.amount);
    if (!isFinite(amount) || (amount < 0 && !f.signed)) return refuse(a, c, 'Decision refused', 'Give a valid amount');
    const before = l.amount; l.amount = amount; l.decided = { by: a.id, at: now(), rationale };
    log(a, 'Decided ' + f.label + ' (' + l.id + '): ' + CALC.rand(amount) + '. ' + rationale, Object.assign(cf(c), { before, after: amount, reason: rationale, result: 'Decided' }));
    return okr();
  }

  /* ===================== drive(): the happy path, used by the tests and the seed ===================== */
  // Moves a case forward with the right actor at each gate until `until` is the current gate. Options: answers, data, route, decision.
  function stubData(c) {
    const summary = {}; ITA34_FIELDS.forEach((f) => { summary[f.key] = 0; });
    return { calc: { ruleset: S.rulesetVersion, summary, stub: true }, schedules: { stub: true }, itr12: { taxRef: clientOf(c).taxRef, year: c.year, stub: true } };
  }
  function drive(c, until, o) {
    o = o || {};
    const tc = ACTOR.as('Tax Consultant', c.consultant); const ad = ACTOR.as('Administrator'); const ia = ACTOR.as('Integration Administrator');
    const sendTx = (fn, gate) => {
      const t = S.txs.filter((x) => x.caseId === c.id && x.fn === fn && x.gate === gate).pop();
      if (!t) return fail('No transaction for ' + fn);
      if (t.status === 'awaiting G18') { const s1 = signG18(t, ia); if (!s1.ok) return s1; const s2 = signG18(t, tc); if (!s2.ok) return s2; }
      return transmit(t, ia, 'success');
    };
    for (let i = 0; i < 40; i++) {
      const g = currentGate(c);
      if (!g || g === until || g === 'G16') return okr({ gate: g });  // G16 waits for the retention review date
      let r;
      switch (g) {
        case 'G01': r = release(c, 'G01', ad); break;
        case 'G02': markAll(c, 'G02', tc); r = release(c, 'G02', tc); break;
        case 'G03':
          c.questionnaire.required.concat(c.priorYear).forEach((k) => { if (!(k in c.questionnaire.answers)) portal(c, 'answer', { key: k, value: (o.answers && k in o.answers) ? o.answers[k] : (c.priorYear.includes(k) || ['employment', 'medical'].includes(k)) }); });
          r = portal(c, 'submitQuestionnaire'); break;
        case 'G04':
          c.items.forEach((it) => { if (itemState(c, it) === 'requested') upload(c, it.id, { name: FILE_FOR[it.kind] || (it.kind + '_2026.pdf'), size: 245760 }, ACTOR.client(c.clientId)); });
          r = c.gates.G04.status === 'released' ? okr() : release(c, 'G04', tc); break;
        case 'G05':
          if (!c.calc || !c.versions.length || c.calc.ruleset !== S.rulesetVersion || c.rerun || calcStale(c)) {
            const ch = o.data ? change(c, tc, o.data, { reason: 'Calculation' })
              : c.inputs && typeof CALC !== 'undefined' ? calculate(c, tc) : change(c, tc, stubData(c), { reason: 'Calculation (test stub)' });
            if (!ch.ok) { r = ch; break; }
          }
          r = release(c, 'G05', tc); break;
        case 'G06': r = portal(c, 'approve', { version: vN(c), declaration: true }); break;
        case 'G07': r = fail('G07 did not release: ' + canRelease(c, 'G07', ACTOR.system()).why); break;
        case 'G08': r = release(c, 'G08', tc); break;
        case 'G09': r = release(c, 'G09', tc); break;
        case 'G18': r = sendTx('itr12', 'G09'); break;
        case 'G10': markAll(c, 'G10', tc); r = c.gates.G10.status === 'released' ? okr() : release(c, 'G10', tc); if (r.ok && !daMoved(c)) r = sendTx('da', 'G10'); break;
        case 'G11': markAll(c, 'G11', tc); r = c.gates.G11.status === 'released' ? okr() : release(c, 'G11', tc); if (r.ok) r = sendTx('vrf', 'G11'); break;
        case 'G12':
          if (!c.ita34) receive({ fn: 'ita34', taxRef: clientOf(c).taxRef, year: c.year, ref: 'ITA34-' + c.id, date: isoDay(now()), data: (c.calc && c.calc.summary) || {}, submissionRef: c.submission ? c.submission.ref : null });
          r = c.gates.G12.status === 'released' ? okr() : release(c, 'G12', tc); break;
        case 'G13': markAll(c, 'G13', tc); r = release(c, 'G13', tc); break;
        case 'G14': r = portal(c, 'decide', { choice: o.decision || 'accept', note: o.decisionNote || '' }); break;
        case 'G15': {
          const route = o.route || 'objection';
          if (!c.remedy || c.remedy.route !== route) { r = chooseRemedy(c, tc, route, { evidence: 'Grounds and supporting evidence on file' }); if (!r.ok) break; }
          if (route !== 'advice' && !(c.remedy.authority && c.remedy.authority.route === route)) portal(c, 'authorise');
          r = c.gates.G15.status === 'released' ? okr() : release(c, 'G15', tc);
          if (r.ok && route !== 'advice') r = sendTx(route, 'G15');
          break;
        }
        default: r = fail(g + ' is not part of the automatic path');
      }
      if (!r || !r.ok) return fail('Stopped at ' + g + ': ' + (r ? r.why : 'no action'), { gate: g });
    }
    return fail('drive() did not finish', { gate: currentGate(c) });
  }

  return {
    // configuration
    KYC_ITEMS, QUESTIONS, FILE_FOR, INCIDENT_STEPS, IN_FLIGHT,
    // helpers
    canon, digest, isoDay, clientOf, caseById, exById, txById, incById, exOf, liveEx, openOf, hasOpen, isOpen, curVersion, vN, personFor, currentApproval,
    // state and gates
    newClient, setKyc, newCase, addItem, markReq, applies, seq, stepDone, currentGate, pendingBefore, blocksNow, gateBlockers, itemState, drift,
    approvalProblem, criteria, actorCheck, canRelease, release, reopenFrom, gateState, settle, gatesDone, preBlockers,
    // exceptions
    raise, raiseManual, resolve, close, resolverCheck, resolveGuard, setSeverity, approveSeverity, eligibleWhy, overrideWhy, requestOverride, approveOverride,
    setOverridable, recordFallback, reconcileFallback,
    // versions
    change, outsideEdit, restoreVersion, calculate, decideItem, setInputs, draftResponse,
    // SARS link and inbound
    requestTx, g18Checks, g18Blockers, signG18, transmit, checkStatus, retry, manualFallback, receive, routeInbound, confirmInboundDate, remedyDeadline,
    // documents, portal and withdrawals
    upload, aiCheckFile, approveNa, portal, recordWithdrawal,
    // remedies, retention, incidents
    chooseRemedy, setRemedyEvidence, remind, addHold, legalHold, releaseHold, incidentStep, closeIncident,
    // ticker, board, platform
    watch, columnOf, dragForward, returnForRework, rulesetChange, setReviewer, setAiUp, setLink,
    // exports and test drive
    auditCsv, auditJson, verifyChain, drive, stubData,
  };
})();
