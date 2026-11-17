/* Exceptions: the live register with filters (family, severity, gate, owner, status and a search), and the page for one exception
   (route exception-<id>): the full exception object (EX_OBJECT), its links, the resolution and secondary review, severity changes
   and their approval, override requests, the manual fallback for Conditional codes, and raising a further exception by hand.
   Views only read state: every button calls ENGINE with ACTOR.me(), and a refusal shows ENGINE's reason (ENGINE audits it).
   The filters live in this module only (they are not case data). */
(() => {
  /* ---------- helpers ---------- */
  // Modal flows: success closes the dialog, toasts and renders (then runs `then`); a refusal keeps the dialog open with the reason.
  const finish = (r, msg, then) => (r && r.ok ? () => { VK.done(r, msg); if (then) then(); } : 'Not done: ' + ((r && r.why) || 'Operon refused this.'));
  const exNow = (t) => { const x = ENGINE.exById(t.dataset.ex); if (!x) { toast('That exception is no longer here.'); render(); } return x; };
  const caseOfX = (x) => (x && x.caseId ? ENGINE.caseById(x.caseId) : null);
  const fam = (code) => String(code).split('-')[0];
  const famName = (f) => { const d = Object.values(CODE).find((c) => c.fam === f); return d ? d.family : f; };
  const head = (x) => `<p class="row">${VK.codeChip(x.code)}${VK.sevChip(x.sev)}<strong>${esc(x.title)}</strong></p>`;
  const caseText = (x) => (x.caseId ? VK.caseWho(x.caseId) : (x.clientId ? VK.clientLink(x.clientId) : '<span class="muted">No case</span>'));

  /* ---------- filters ---------- */
  const F0 = { fam: '', sev: '', gate: '', owner: '', status: 'live', q: '' };
  const F = Object.assign({}, F0);
  const OWNERS = ROLES.concat(['Client', 'AI Agent', 'Operon (system)', 'Platform team (simulated)']);
  const STATUS = [
    ['live', 'Not closed', (x) => x.status !== 'closed'],
    ['open', 'Open (to resolve)', (x) => ENGINE.isOpen(x)],
    ['blocking', 'Blocking now', (x) => ENGINE.blocksNow(x)],
    ['awaiting client', 'Awaiting client', (x) => x.status === 'awaiting client'],
    ['resolved', 'Resolved, to close', (x) => x.status === 'resolved'],
    ['closed', 'Closed', (x) => x.status === 'closed'],
    ['all', 'All', () => true],
  ];
  function ownerMatch(x, o) {
    if (o === 'Platform team (simulated)') return /^Platform /.test(x.owner);
    if (ROLES.includes(o)) return VK.ownedBy(x.owner, o);
    return x.owner === o;
  }
  function filtered() {
    const st = (STATUS.find((s) => s[0] === F.status) || STATUS[0])[2];
    const q = F.q.trim().toLowerCase();
    return S.exceptions.filter((x) => (!F.fam || fam(x.code) === F.fam) && (!F.sev || x.sev === F.sev) && (!F.gate || x.gates.includes(F.gate))
      && (!F.owner || ownerMatch(x, F.owner)) && st(x)
      && (!q || [x.id, x.code, x.title, x.caseId, VK.clientName(x.clientId), x.owner, x.note].some((v) => String(v || '').toLowerCase().includes(q))))
      .sort((p, q2) => ((p.status === 'closed') - (q2.status === 'closed')) || (SEV.indexOf(p.sev) - SEV.indexOf(q2.sev)) || (p.at - q2.at));
  }
  EXT_FIELD['ops.exF'] = (el) => { const k = el.dataset.k; if (!(k in F)) return false; F[k] = String(el.value || '').slice(0, 80); return true; };
  const sel = (k, label, opts) => `<label class="f" for="ops-exf-${k}">${esc(label)}<select id="ops-exf-${k}" data-on="ops.exF" data-k="${k}">${opts.map(([v, t]) => `<option value="${esc(v)}"${F[k] === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;

  function filtersBlock(n) {
    const live = S.exceptions.filter((x) => x.status !== 'closed');
    const sum = SEV.map((s) => `<span class="ops-sumi">${VK.sevChip(s)}<b>${live.filter((x) => x.sev === s).length}</b></span>`).join('');
    const blocking = S.exceptions.filter((x) => ENGINE.blocksNow(x)).length;
    const body = `<div class="ops-filters">
      ${sel('fam', 'Family', [['', 'All families']].concat(FAMILY_ORDER.map((f) => [f, f + ' · ' + famName(f)])))}
      ${sel('sev', 'Severity', [['', 'All severities']].concat(SEV.map((s) => [s, SEV_LABEL[s]])))}
      ${sel('gate', 'Gate', [['', 'All gates']].concat(GATE_IDS.map((g) => [g, g + ' · ' + VK.gateName(g)])))}
      ${sel('owner', 'Owner', [['', 'Anyone']].concat(OWNERS.map((o) => [o, o])))}
      ${sel('status', 'Status', STATUS.map((s) => [s[0], s[1]]))}
      <label class="f" for="ops-exf-q">Search<input id="ops-exf-q" type="search" data-on="ops.exF" data-k="q" value="${esc(F.q)}" maxlength="80" autocomplete="off" placeholder="Code, case, client or ID"></label>
    </div>
    <div class="row ops-sum"><span class="small muted">Not closed:</span>${sum}<span class="small muted">${esc(plural(blocking, 'exception') + ' blocking now')}</span></div>`;
    const changed = Object.keys(F0).some((k) => F[k] !== F0[k]);
    return VK.section('ops-exceptions-filters', 'Filter the register', body, {
      intro: esc('Showing ' + plural(n, 'exception') + ' of ' + S.exceptions.length + '. Each exception follows Johan’s register: its severity, blocking rule, owner and secondary reviewer come from the code.'),
      actions: `${btn('Owned by my role', 'ops.exMine', { cls: 'sm' })}${changed ? btn('Clear filters', 'ops.exClear', { cls: 'sm ghost' }) : ''}`,
    });
  }
  function listBlock(rows) {
    const status = (x) => `${VK.exStatus(x)}${ENGINE.blocksNow(x) ? `<div class="small">${esc(x.blocking === 'Conditional' ? 'Blocks until the fallback is reconciled' : 'Blocking now')}</div>` : ''}`;
    const owner = (x) => `${esc(x.owner)}${x.assignee && ENGINE.isOpen(x) ? `<div class="small muted">${esc(VK.who(x.assignee))}</div>` : ''}${x.secondary ? `<div class="small muted">Closes: ${esc(x.secondary)}</div>` : ''}`;
    const table = VK.table([{ label: 'Severity' }, { label: 'Exception' }, { label: 'Case' }, { label: 'Gates' }, { label: 'Owner' }, { label: 'Status' }],
      rows.map((x) => [VK.sevChip(x.sev), `${VK.codeChip(x.code, x)} ${VK.exLink(x, x.title)}<div class="small muted">${esc(x.id)} · raised ${VK.when(x.at)}</div>`, caseText(x),
        `<span class="mono small">${esc(x.gates.join(' · '))}</span>`, owner(x), status(x)]),
      { caption: 'Exception register', empty: 'No exception matches these filters.' });
    return VK.section('ops-exceptions-list', 'Exceptions', table, { count: rows.length });
  }

  VIEWS.exceptions = () => {
    const rows = filtered();
    const intro = esc('The live exception register for every case. Open one to see the full record, change its severity, ask for an override or record a fallback. Every change is audited.');
    return VK.page('Exceptions', intro, filtersBlock(rows.length) + listBlock(rows), { key: 'ops-exceptions', actions: btn('Raise an exception', 'ops.raise', { cls: 'primary' }) });
  };

  /* ---------- one exception ---------- */
  function fieldHtml(x, c, k) {
    const none = '<span class="muted">—</span>';
    switch (k) {
      case 'id': return `<span class="mono">${esc(x.id)}</span>`;
      case 'code': return `${VK.codeChip(x.code)} ${esc(x.title)}`;
      case 'clientId': return x.clientId ? VK.clientLink(x.clientId) : none;
      case 'year': return x.year ? 'tax year ' + esc(x.year) : none;
      case 'caseId': return x.caseId ? VK.caseLink(x.caseId) : none;
      case 'stage': return esc(x.stage);
      case 'gates': return `<span class="vk-codes">${x.gates.map((g) => (c ? VK.gateChip(c, g) : `<span class="vk-gate vk-g-idle"><b>${esc(g)}</b></span>`)).join(' ')}</span>`;
      case 'severity': return VK.sevChip(x.sev) + (CODE[x.code] && CODE[x.code].sev !== x.sev ? ` <span class="small muted">register default ${esc(CODE[x.code].sev)}</span>` : '');
      case 'blocking': return `${esc(x.blocking)} ${ENGINE.blocksNow(x) ? VK.pill('Blocking now', 'bad') : VK.pill('Not blocking now', '')}`;
      case 'trigger': return esc(x.trigger);
      case 'source': return '<span class="small muted">Source:</span> ' + esc(x.source);
      case 'raisedBy': return `${esc({ AI: 'AI (simulated)', system: 'System', SARS: 'SARS (simulated)', human: 'Human' }[x.raisedBy] || x.raisedBy)} · ${esc(VK.who(x.raisedById))}`;
      case 'owner': return `${esc(x.owner)}${x.assignee ? ` <span class="small muted">(${esc(VK.who(x.assignee))})</span>` : ''}`;
      case 'secondary': return '<span class="small muted">Secondary reviewer:</span> ' + (x.secondary ? esc(x.secondary) : 'none');
      case 'clientAction': return x.clientAction ? esc(x.clientAction) : '<span class="muted">None</span>';
      case 'clientDue': return x.clientDue ? '<span class="small muted">due</span> ' + VK.date(x.clientDue) : '';
      case 'sarsDeadline': return x.sarsDeadline ? `${VK.date(x.sarsDeadline)} ${VK.leftPill(VK.bizLeft(x.sarsDeadline, /^REM-/.test(x.code)))}` : none;
      case 'related': return x.related.length ? x.related.map((id) => { const y = ENGINE.exById(id); return y ? VK.codeChip(y.code, y) + ' ' + VK.exLink(y) : esc(id); }).join(', ') : none;
      case 'parent': { const p = x.parent ? ENGINE.exById(x.parent) : null; return p ? `<span class="small muted">parent</span> ${VK.codeChip(p.code, p)} ${VK.exLink(p)}` : ''; }
      case 'resolution': return x.resolution ? esc(VK.scrub(x.resolution)) : none;
      case 'evidence': return x.evidence ? `<span class="small muted">evidence</span> ${esc(VK.scrub(x.evidence))}` : '';
      case 'resolvedBy': return x.resolvedBy ? esc(x.resolvedBy) : none;
      case 'resolvedAt': return x.resolvedAt ? '<span class="small muted">at</span> ' + VK.when(x.resolvedAt) : '';
      case 'humanApproval': return x.humanApproval ? 'Yes' : 'No';
      case 'gateReleased': return x.gateReleased ? esc(x.gateReleased) : (c ? esc(x.gates.map((g) => g + ': ' + VK.gateStateWord(ENGINE.gateState(c, g))[0].toLowerCase()).join('; ')) : none);
      default: return x[k] == null ? none : esc(x[k]);
    }
  }
  function objectBlock(x, c) {
    const rows = EX_OBJECT.map((f) => [esc(f.label), f.keys.map((k) => fieldHtml(x, c, k)).filter(Boolean).join('<span class="muted" aria-hidden="true"> · </span>'), `<span class="mono small muted">${esc(f.keys.join(', '))}</span>`]);
    return VK.section('ops-exception-object', 'The exception record', VK.table([{ label: 'Field' }, { label: 'Value' }, { label: 'Stored as' }], rows, { caption: 'The 14 mandatory fields' }), {
      intro: esc('The 14 mandatory fields from the master workflow document (Phase 20), and the field names Operon stores them under.'),
    });
  }
  function linksBlock(x, c) {
    const pairs = [];
    if (c) pairs.push(['Case', `${VK.caseWho(c)}<div class="small muted">${esc('On the board: ' + ((BOARD.find((b) => b.key === ENGINE.columnOf(c)) || {}).label || '—'))}</div>`]);
    const parent = x.parent ? ENGINE.exById(x.parent) : null;
    if (parent) pairs.push(['Parent', `${VK.codeChip(parent.code, parent)} ${VK.exLink(parent, parent.id + ' ' + parent.title)} ${VK.exStatus(parent)}`]);
    const kids = S.exceptions.filter((y) => y.parent === x.id || (x.related.includes(y.id) && y.id !== x.parent));
    if (kids.length) pairs.push(['Related', kids.map((y) => `<div>${VK.codeChip(y.code, y)} ${VK.exLink(y, y.id + ' ' + y.title)} ${VK.exStatus(y)}</div>`).join('')]);
    const inc = x.incidentId ? ENGINE.incById(x.incidentId) : null;
    if (inc) pairs.push(['Incident (G17)', `${VK.link('incident', inc.id)} ${VK.pill(inc.status === 'open' ? 'Open' : 'Closed', inc.status === 'open' ? 'bad' : 'ok')} <span class="small muted">${esc(inc.codes.join(', '))}</span>`]);
    const t = x.txId ? ENGINE.txById(x.txId) : null;
    if (t) pairs.push(['SARS transaction', `<span class="mono">${esc(t.id)}</span> ${esc(t.label)} ${VK.pill(t.status, '')} <a href="#sars">SARS link</a>`]);
    const it = x.inboundId ? S.inbound.find((y) => y.id === x.inboundId) : null;
    if (it) pairs.push(['SARS inbound item', `<span class="mono">${esc(it.id)}</span> ${esc(it.label)} <span class="mono small">${esc(it.ref || '')}</span> <a href="#sars">SARS link</a>`]);
    const d = x.docId && c ? c.docs.find((y) => y.id === x.docId) : null;
    if (d) pairs.push(['Document', `${esc(VK.scrub(d.name))} ${VK.pill(d.status, d.status === 'held' ? 'warn' : '')}`]);
    const others = c ? ENGINE.exOf(c).filter((y) => y.id !== x.id && y.status !== 'closed' && !kids.includes(y) && y !== parent) : [];
    if (others.length) pairs.push(['Also open on this case', `<span class="vk-codes">${others.map((y) => VK.codeChip(y.code, y)).join(' ')}</span>`]);
    if (x.note) pairs.push(['Note when raised', esc(VK.scrub(x.note))]);
    return VK.section('ops-exception-links', 'Links', pairs.length ? VK.facts(pairs) : VK.empty('Nothing is linked to this exception.'));
  }
  function resolutionBlock(x, c) {
    const def = CODE[x.code] || {};
    const pairs = [['Resolved when', esc(def.resolution || '')], ['Status', VK.exStatus(x)]];
    if (x.resolution) pairs.push(['What was done', esc(VK.scrub(x.resolution)) + (x.evidence ? `<div class="small muted">Evidence: ${esc(VK.scrub(x.evidence))}</div>` : '')], ['Resolved by', `${esc(x.resolvedBy || '')} · ${VK.when(x.resolvedAt)}`]);
    if (x.secondary) pairs.push(['Secondary review', x.closedBy ? `${esc(x.closedBy)} · ${VK.when(x.closedAt)}` : esc('By a different person in the ' + x.secondary + ' role, once resolved')]);
    else if (x.closedBy) pairs.push(['Closed', `${esc(x.closedBy)} · ${VK.when(x.closedAt)}`]);
    let act = '';
    if (ENGINE.isOpen(x)) act = VK.exceptionBtn({ x, need: 'resolve' });
    else if (x.status === 'resolved' && x.secondary) act = VK.exceptionBtn({ x, need: 'close' });
    return VK.section('ops-exception-resolution', 'Resolution and secondary review', VK.facts(pairs) + (act ? `<div class="row">${act}</div>` : ''), {
      intro: esc(x.secondary ? 'The owner resolves it; then a different person in the ' + x.secondary + ' role closes it. It keeps blocking until it is closed.' : 'The owner resolves it. Codes with no secondary reviewer close when their gates are done.'),
    });
  }
  function severityBlock(x) {
    const def = CODE[x.code] || {}; const rq = x.sevRequest;
    const pairs = [['Now', VK.sevChip(x.sev)], ['Register default', VK.sevChip(def.sev || x.sev)]];
    if (rq) pairs.push(['Last request', `${esc('Lower ' + rq.from + ' to ' + rq.to + ': ' + VK.scrub(rq.reason))}<div class="small muted">${esc(VK.who(rq.by))} · ${VK.when(rq.at)} · ${esc(rq.status)}${rq.decidedBy ? esc(' by ' + VK.who(rq.decidedBy)) : ''}</div>`]);
    const btns = [];
    if (x.status !== 'closed') btns.push(btn('Change severity', 'ops.sev', { cls: 'sm', data: { ex: x.id } }));
    if (rq && rq.status === 'pending') {
      if (S.role === 'Records/Compliance Owner') btns.push(btn('Approve lowering', 'ops.sevOk', { cls: 'sm primary', data: { ex: x.id, v: '1' } }), btn('Decline', 'ops.sevOk', { cls: 'sm', data: { ex: x.id, v: '0' } }));
      else btns.push(`<span class="lock">${I.hourglass}${esc('Waiting for the Records/Compliance Owner')}</span>`);
    }
    return VK.section('ops-exception-severity', 'Severity', VK.facts(pairs) + (btns.length ? `<div class="row ops-btns">${btns.join('')}</div>` : ''), {
      intro: esc('S1 is a hard stop for the case; S2 blocks its gates; S3 blocks only the affected item; S4 is logged. Anyone may raise a severity at once. Lowering an S1 or S2 needs the Records/Compliance Owner’s approval, by a different person.'),
    });
  }
  function overrideBlock(x) {
    const why = ENGINE.overrideWhy(x); const ov = x.override;
    const list = S.policy.overridable.length ? S.policy.overridable.join(', ') : 'Empty: no S2 code may be overridden until Johan decides (pending Johan)';
    const pairs = [['Can it be overridden?', why ? `${VK.pill('No', 'bad')} ${esc(why)}` : VK.pill('Yes, on the policy list', 'ok')], ['Override policy list', esc(list)],
      ['Never overridden', esc('S1; missing taxpayer authority (' + NEVER_OVERRIDE.authority.join(', ') + '); security (SEC-*, ' + NEVER_OVERRIDE.security.join(', ') + '); SARS-interface authorisation (INT-*); statutory holds (RET-*)')]];
    if (ov) pairs.push(['Request', `${esc(VK.scrub(ov.reason))}<div class="small muted">${esc(VK.who(ov.requestedBy) + ' (' + ov.role + ') · version ' + ov.version + ' · ' + ov.status)}${ov.approvedBy ? esc(' by ' + VK.who(ov.approvedBy)) : ''}</div><div class="small muted">Evidence: ${esc(VK.scrub(ov.evidence))}</div>`]);
    const btns = [];
    if (ENGINE.isOpen(x) && !(ov && (ov.status === 'requested' || ov.status === 'approved'))) btns.push(btn('Ask for an override', 'ops.ovReq', { cls: 'sm', data: { ex: x.id } }));
    if (ov && ov.status === 'requested') {
      if (S.role === 'Records/Compliance Owner') btns.push(btn('Approve override', 'ops.ovOk', { cls: 'sm primary', data: { ex: x.id } }));
      else btns.push(`<span class="lock">${I.hourglass}${esc('Waiting for the Records/Compliance Owner')}</span>`);
    }
    return VK.section('ops-exception-override', 'Override', VK.facts(pairs) + (btns.length ? `<div class="row ops-btns">${btns.join('')}</div>` : ''), {
      intro: esc('An override lets an S2 exception stop blocking for one version. It records who asked, why and the evidence, and needs the Records/Compliance Owner’s approval.'),
    });
  }
  // The Conditional codes from the register (AI-06, INT-03, INT-13, INT-15).
  const CONDITIONAL = Object.values(CODE).filter((d) => d.blocking === 'Conditional').map((d) => d.code);
  function fallbackBlock(x) {
    const fb = x.fallback;
    if (!fb) return VK.section('ops-exception-fallback', 'Manual fallback', VK.empty(x.code + ' is not a Conditional code, so it has no manual fallback. Only ' + CONDITIONAL.join(', ') + ' have one.'));
    const rec = fb.recorded; const rcn = fb.reconciled;
    const pairs = [['Recorded', rec ? `${esc(VK.who(rec.by))} · ${VK.when(rec.at)}${rec.ref ? ` · <span class="mono">${esc(rec.ref)}</span>` : ''}${rec.note ? `<div class="small muted">${esc(VK.scrub(rec.note))}</div>` : ''}` : '<span class="muted">Not yet</span>'],
      ['Independently reconciled', rcn ? `${esc(VK.who(rcn.by))} · ${VK.when(rcn.at)}${rcn.found === false ? ' · ' + esc('not processed') : ''}${rcn.note ? `<div class="small muted">${esc(VK.scrub(rcn.note))}</div>` : ''}` : '<span class="muted">Not yet</span>']];
    // Only AI-06 records a free-text fallback. The others have a real fallback action: the manual filing on the SARS link page
    // (INT-03, INT-13) or confirming the dates from the notice (INT-15). A free-text note must not stand in for those.
    const btns = []; let how = '';
    const it = x.code === 'INT-15' && x.inboundId ? S.inbound.find((y) => y.id === x.inboundId) : null;
    const via = x.code === 'INT-03' && rec && rec.via ? ENGINE.exById(rec.via) : null;
    if (!rec) {
      if (x.code === 'INT-15' && it) btns.push(btn('Confirm the dates', 'ops.in.date', { cls: 'sm primary', data: { in: it.id } }));
      else if (x.code === 'INT-03' || x.code === 'INT-13') how = 'The fallback is the manual filing: the Tax Consultant records it on the SARS link page.';
      else if (x.code === 'INT-15') how = 'Confirm the dates from the notice on the SARS link page.';
      else btns.push(btn('Record the fallback', 'ops.fbRec', { cls: 'sm', data: { ex: x.id } }));
    } else if (!rcn) {
      if (via && ENGINE.isOpen(via)) how = 'Recorded by the manual filing ' + via.id + ' (INT-13). Reconcile that one; this closes with it.';
      else btns.push(btn('Reconcile independently', 'ops.fbRecon', { cls: 'sm primary', data: { ex: x.id } }));
    }
    const intro = {
      'INT-13': ' The manual filing itself is recorded on the SARS link page.',
      'INT-15': ' The fallback is confirming the dates from the notice itself; no deadline runs until then.',
      'INT-03': ' The fallback is a manual filing (INT-13), recorded on the SARS link page.',
    }[x.code] || '';
    const tail = (how ? `<p class="small muted">${esc(how)} <a href="#sars">SARS link</a></p>` : '') + (btns.length ? `<div class="row ops-btns">${btns.join('')}</div>` : '');
    return VK.section('ops-exception-fallback', 'Manual fallback', VK.facts(pairs) + tail, {
      intro: esc(x.code + ' is Conditional: it blocks until a manual fallback is recorded and then reconciled by a different person.' + intro),
    });
  }
  function historyBlock(x) {
    const rows = S.audit.filter((a) => a.exceptionId === x.id).slice(-15).reverse();
    const items = rows.map((a) => `<div class="vk-row vk-row-log"><span class="vk-when">${VK.when(a.at)}</span><div class="vk-row-b">
      <div class="vk-row-t">${esc(VK.scrub(a.text))}${a.result === 'Refused' ? ' ' + VK.pill('Refused', 'bad') : ''}</div>
      <div class="vk-meta">${esc(VK.who(a.who) + (a.role ? ' · ' + a.role : ''))}</div></div></div>`);
    return VK.section('ops-exception-history', 'History', VK.list(items, { empty: 'No audit entries name this exception yet.' }), {
      intro: esc('Audit entries for this exception, newest first, refusals included.'), actions: '<a href="#audit">Audit trail</a>',
    });
  }

  VIEWS.exception = (id) => {
    const x = ENGINE.exById(id);
    if (!x) return VK.page('Exception not found', esc('There is no exception with that ID.'), VK.section('ops-exception-missing', 'Not found', VK.empty('Nothing here.', { html: '<a href="#exceptions">Back to the register</a>' })), { key: 'ops-exception' });
    const c = caseOfX(x);
    const intro = `${VK.sevChip(x.sev)} ${VK.exStatus(x)} ${esc(x.title)} · ${caseText(x)} · <a href="#exceptions">All exceptions</a>`;
    const actions = btn('Raise a related exception', 'ops.raise', { cls: 'sm', data: { case: x.caseId || '', parent: x.id } });
    return VK.page(x.id + ' · ' + x.code, intro,
      `<div class="grid2 vk-grid" data-rv-key="ops-exception-columns">${resolutionBlock(x, c)}${linksBlock(x, c)}</div>` +
      objectBlock(x, c) +
      `<div class="grid2 vk-grid" data-rv-key="ops-exception-columns-controls">${severityBlock(x)}${overrideBlock(x)}</div>` +
      fallbackBlock(x) + historyBlock(x),
      { key: 'ops-exception', actions });
  };

  /* ---------- actions ---------- */
  function actSev(t) {
    const x = exNow(t); if (!x) return;
    // No severity is pre-selected: submitting the defaults must not raise an exception (an S1 is a hard stop for the whole case).
    const opts = '<option value="" selected>Choose the new severity</option>' + SEV.filter((s) => s !== x.sev).map((s) => `<option value="${esc(s)}">${esc(SEV_LABEL[s] + (SEV.indexOf(s) < SEV.indexOf(x.sev) ? ' (raise: applies at once)' : (x.sev === 'S1' || x.sev === 'S2' ? ' (lower: needs approval)' : ' (lower)')))}</option>`).join('');
    modal('Change the severity of ' + x.id, `${head(x)}
      <label class="f" for="ops-sev-to">New severity<select id="ops-sev-to" name="to">${opts}</select></label>
      <label class="f" for="ops-sev-why">Reason (required to lower it)<textarea id="ops-sev-why" name="reason" maxlength="500"></textarea></label>
      <p class="hint">You act as ${esc(S.role)} (${esc(me().name)}). Lowering an S1 or S2 goes to the Records/Compliance Owner, who must be someone else.</p>`,
    'Change severity', (fd) => {
      const to = String(fd.to || '');
      if (!SEV.includes(to)) return 'Choose the new severity.';
      const r = ENGINE.setSeverity(x, ACTOR.me(), to, { reason: String(fd.reason || '').trim() });
      return finish(r, r.pending ? 'Asked the Records/Compliance Owner to approve lowering ' + x.id + ' to ' + to + '.' : 'Changed ' + x.id + ' to ' + to + '.');
    });
  }
  function actSevOk(t) {
    const x = exNow(t); if (!x) return;
    const yes = t.dataset.v === '1';
    VK.done(ENGINE.approveSeverity(x, ACTOR.me(), { approve: yes }), (yes ? 'Approved lowering ' : 'Declined lowering ') + x.id + '.');
  }
  function actOvReq(t) {
    const x = exNow(t); if (!x) return;
    const why = ENGINE.overrideWhy(x);
    modal('Ask to override ' + x.id, `${head(x)}
      ${why ? `<p class="err">${esc('Operon will refuse this: ' + why + '.')}</p>` : ''}
      <label class="f" for="ops-ov-why">Reason (required)<textarea id="ops-ov-why" name="reason" maxlength="500"></textarea></label>
      <label class="f" for="ops-ov-ev">Evidence (required)<input id="ops-ov-ev" name="evidence" maxlength="300" autocomplete="off" placeholder="A file name or reference"></label>
      <p class="hint">${esc((ENGINE.vN(caseOfX(x)) ? 'The override covers version ' + ENGINE.vN(caseOfX(x)) + ' only' : 'An override covers one version only (this case has none yet)') + ' and needs the Records/Compliance Owner’s approval. Refusals are recorded in the audit trail.')}</p>`,
    'Ask for override', (fd) => finish(ENGINE.requestOverride(x, ACTOR.me(), { reason: String(fd.reason || '').trim(), evidence: String(fd.evidence || '').trim() }), 'Asked to override ' + x.id + '.'));
  }
  const actOvOk = (t) => { const x = exNow(t); if (!x) return; VK.done(ENGINE.approveOverride(x, ACTOR.me()), 'Approved the override of ' + x.id + '.'); };
  function actFbRec(t) {
    const x = exNow(t); if (!x) return;
    if (['INT-03', 'INT-13', 'INT-15'].includes(x.code)) { toast(x.code + ' is recorded by its own action on the SARS link page, not by a note.'); render(); return; }
    modal('Record the manual fallback for ' + x.id, `${head(x)}
      <label class="f" for="ops-fb-note">What was done instead<textarea id="ops-fb-note" name="note" maxlength="500"></textarea></label>
      <label class="f" for="ops-fb-ref">Reference (optional)<input id="ops-fb-ref" name="ref" maxlength="120" autocomplete="off"></label>
      <p class="hint">A different person then reconciles it. Until then ${esc(x.code)} keeps blocking.</p>`,
    'Record fallback', (fd) => {
      const note = String(fd.note || '').trim(); if (!note) return 'Write what was done instead.';
      return finish(ENGINE.recordFallback(x, ACTOR.me(), { note, ref: String(fd.ref || '').trim() || null }), 'Recorded the fallback for ' + x.id + '.');
    });
  }
  function actFbRecon(t) {
    const x = exNow(t); if (!x) return;
    const tx = x.code === 'INT-13' && x.txId ? ENGINE.txById(x.txId) : null;
    const rec = x.fallback && x.fallback.recorded;
    modal('Reconcile the fallback for ' + x.id, `${head(x)}
      ${rec ? VK.facts([['Recorded by', esc(VK.who(rec.by))], ['Reference', esc(rec.ref || 'None')], ['Note', esc(VK.scrub(rec.note || ''))]]) : ''}
      ${tx ? `<fieldset class="ops-radios"><legend class="small muted">What the eFiling record shows (simulated)</legend>
        <label><input type="radio" name="processed" value="yes" checked> The manual filing is on eFiling: reconcile it to the case</label>
        <label><input type="radio" name="processed" value="no"> It is not on eFiling: mark ${esc(tx.id)} as not processed</label></fieldset>` : ''}
      <label class="f" for="ops-rc-note">Reconciliation note (optional)<input id="ops-rc-note" name="note" maxlength="300" autocomplete="off"></label>
      <p class="hint">You must not be the person who recorded the fallback.</p>`,
    'Reconcile', (fd) => finish(ENGINE.reconcileFallback(x, ACTOR.me(), { note: String(fd.note || '').trim(), processed: fd.processed !== 'no' }), 'Reconciled the fallback for ' + x.id + '.'));
  }

  // Raise any of the register's codes by hand on a case. The code list is narrowed to the case's stage (the register's Stage Map);
  // "All codes" lists all of them.
  const phaseOf = (c) => { const g = c ? ENGINE.currentGate(c) : null; return g && GATE[g] ? GATE[g].phase : null; };
  function stageCovers(stage, n) {
    if (/^Any\b/i.test(stage) || n == null) return true;
    const rx = /(\d+)\s*-\s*(\d+)|(\d+)/g; let m;
    while ((m = rx.exec(stage))) { if (m[3] ? +m[3] === n : (n >= +m[1] && n <= +m[2])) return true; }
    return false;
  }
  function codeOptions(c, scope) {
    const n = scope === 'all' ? null : phaseOf(c);
    return FAMILY_ORDER.map((f) => {
      const codes = Object.values(CODE).filter((d) => d.fam === f && stageCovers(d.stage, n));
      return codes.length ? `<optgroup label="${esc(f + ' · ' + famName(f))}">${codes.map((d) => `<option value="${esc(d.code)}">${esc(d.code + ' · ' + d.title + ' (' + d.sev + ')')}</option>`).join('')}</optgroup>` : '';
    }).join('');
  }
  function actRaise(t) {
    const cases = S.cases.filter((c) => !c.archived);
    const pre = ENGINE.caseById(t.dataset.case || '') || cases[0];
    const parent = t.dataset.parent ? ENGINE.exById(t.dataset.parent) : null;
    if (!pre) { toast('There are no cases to raise an exception on.'); return; }
    const phaseText = (c) => { const p = phaseOf(c); return p ? 'Codes for this case’s stage (Phase ' + p + ')' : 'All codes'; };
    modal(parent ? 'Raise an exception related to ' + parent.id : 'Raise an exception', `
      <label class="f" for="ops-raise-case">Case<select id="ops-raise-case" name="case">${cases.map((c) => `<option value="${esc(c.id)}"${c === pre ? ' selected' : ''}>${esc(c.id + ' · ' + VK.clientName(c.clientId))}</option>`).join('')}</select></label>
      <label class="f" for="ops-raise-scope">Codes to list<select id="ops-raise-scope" name="scope"><option value="stage" id="ops-raise-stage">${esc(phaseText(pre))}</option><option value="all">All ${Object.keys(CODE).length} codes</option></select></label>
      <label class="f" for="ops-raise-code">Exception code<select id="ops-raise-code" name="code">${codeOptions(pre, 'stage')}</select></label>
      <label class="f" for="ops-raise-note">What you found (optional)<textarea id="ops-raise-note" name="note" maxlength="500"></textarea></label>
      ${parent ? `<p class="hint">It is linked to ${esc(parent.id)} (${esc(parent.code)}) as its parent.</p>` : ''}
      <p class="hint">Severity, blocking, owner and secondary reviewer come from the register. You raise it as ${esc(S.role)} (${esc(me().name)}).</p>`,
    'Raise exception', (fd) => {
      const c = ENGINE.caseById(String(fd.case || '')); const code = String(fd.code || '');
      if (!c) return 'Pick a case.';
      if (!CODE[code]) return 'Pick an exception code.';
      const r = ENGINE.raiseManual(c, code, ACTOR.me(), { note: String(fd.note || '').trim(), parent: parent ? parent.id : null });
      const nx = r && r.exception;
      return finish(r, 'Raised ' + code + (nx ? ' as ' + nx.id : '') + ' on ' + c.id + '.', () => { if (nx && VK.safeId(nx.id)) location.hash = '#exception-' + nx.id; });
    }, { onOpen: (f) => {
      const upd = () => {
        const c = ENGINE.caseById(f.elements.case.value);
        $('#ops-raise-stage').textContent = phaseText(c);
        f.elements.code.innerHTML = codeOptions(c, f.elements.scope.value);
      };
      f.elements.case.addEventListener('change', upd); f.elements.scope.addEventListener('change', upd);
    } });
  }

  Object.assign(ACT, {
    'ops.sev': actSev, 'ops.sevOk': actSevOk, 'ops.ovReq': actOvReq, 'ops.ovOk': actOvOk, 'ops.fbRec': actFbRec, 'ops.fbRecon': actFbRecon, 'ops.raise': actRaise,
    'ops.exClear': () => { Object.assign(F, F0); render(); },
    'ops.exMine': () => { Object.assign(F, F0, { owner: S.role, status: 'live' }); render(); },
  });

  // Header count: what waits for the signed-in role (open ones it owns, resolved ones it closes as secondary reviewer).
  NAV_COUNT.exceptions = () => VK.myExceptions(S.role).length;
})();
