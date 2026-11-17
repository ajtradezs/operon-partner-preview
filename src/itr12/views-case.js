/* Case page (#case-<id>): everything about one 2026 ITR12 case, read from S through ENGINE.
   Sections: summary, the phase and gate tracker (all 18 gates), exceptions, the four-source analysis, the personalised checklist,
   documents with extracted values and lineage, the calculation pack, client approval and versions, SARS transactions, then the
   Declaration Alert, verification/audit and ITA34/remedies sections when they apply, the case's audit trail and retention.
   Every change goes through ENGINE with ACTOR.me(): the kit's shared actions (vk.release, vk.resolve, vk.close), the board's moves
   (cases.fwd, cases.back) and this page's own actions (cases.decide, cases.recalc, cases.na). Refusals show the engine's reason. */
(() => {
  const AUDIT_N = 30;
  const dd = (iso) => { const d = VK.toDay(iso); return d ? fDate(d) : String(iso || ''); };  // a calendar day as text, e.g. 8 Dec 2026
  const short = (h) => (h ? String(h).slice(0, 10) + '…' : '—');
  const lockNote = (text) => `<span class="lock">${I.lock}${esc(text)}</span>`;
  const yes = (v) => (v === true ? VK.pill('Yes', 'info') : v === false ? VK.pill('No', '') : '<span class="muted">Not answered</span>');
  const whoRel = (g) => {
    const r = RELEASE[g];
    if (g === 'G17') return 'Information Officer, per incident';
    switch (r.by) {
      case 'client': return 'The client, only in the PaperSync portal (simulated)';
      case 'system': return 'Operon itself, when its checks pass';
      case 'ai': return 'AI check (simulated) with the independent reviewer, or the ' + r.role;
      case 'dual': return 'Two people: the ' + r.roles.join(' and the ') + ', per SARS transaction';
      default: return 'The ' + r.role;
    }
  };
  const docStatus = (d) => {
    const tone = { validated: 'ok', held: 'warn', quarantined: 'bad', rejected: 'bad', duplicate: '' }[d.status];
    return VK.pill(d.status.charAt(0).toUpperCase() + d.status.slice(1), tone == null ? '' : tone);
  };
  // SARS transaction statuses in plain words, with a tone. Anything new reads as its own word, capitalised.
  const TX_STATUS = { success: ['Accepted by SARS (simulated)', 'ok'], ready: ['Ready to send', 'info'], 'awaiting G18': ['Waiting for G18 sign-offs', 'warn'],
    unknown: ['Status unknown: not resent', 'bad'], failed: ['Failed', 'bad'], rejected: ['Rejected by SARS (simulated)', 'bad'], 'not processed': ['Not processed by SARS', 'bad'],
    blocked: ['Blocked', 'bad'], manual: ['Manual fallback', 'warn'], cancelled: ['Cancelled', ''], superseded: ['Superseded', ''], invalidated: ['Invalidated', 'warn'], lapsed: ['Lapsed', 'warn'] };
  const txPill = (s) => { const k = TX_STATUS[s]; const t = String(s || ''); return VK.pill(k ? k[0] : t.charAt(0).toUpperCase() + t.slice(1), k ? k[1] : ''); };

  /* ---------- summary ---------- */
  function summaryBlock(c, cl) {
    const g = ENGINE.currentGate(c); const v = ENGINE.vN(c);
    const incs = S.incidents.filter((i) => i.caseId === c.id);
    return VK.section('cases-case-summary', 'Summary', VK.facts([
      ['Client', VK.clientLink(cl)],
      ['ID number', VK.idHtml(cl.idNo)],
      ['Tax reference', VK.taxRefHtml(cl.taxRef)],
      ['Year of assessment', esc(c.year + ' (' + FILING_2026.period + ')')],
      ['Filing', esc(c.filing === 'provisional' ? 'Provisional taxpayer: the season closes ' + fDate(VK.toDay(FILING_2026.provisional.closes)) : 'Not a provisional taxpayer: the season closed ' + fDate(VK.toDay(FILING_2026.nonProvisional.closes)))],
      ['Tax Consultant', esc(pname(c.consultant))],
      ['Stage', esc(CASES_BOARD.colLabel(ENGINE.columnOf(c)))],
      ['Next gate', g ? VK.gateChip(c, g) + ' <span class="small muted">' + esc(CASES_BOARD.waitingOn(c, g)) + '</span>' : VK.pill('Every gate is done', 'ok')],
      ['Version', v ? esc('Version ' + v) + (c.frozen && c.frozen.version === v ? ' ' + VK.pill('Frozen', 'info') : '') : '<span class="muted">None yet</span>'],
      ['Incidents', incs.length ? incs.map((i) => VK.link('incident', i.id, i.id + ' (' + (i.status === 'open' ? 'open' : 'closed') + ')')).join(', ') : '<span class="muted">None</span>'],
      ['Opened', VK.when(c.opened)],
    ]), { actions: '<a href="#cases">All cases</a>' });
  }

  /* ---------- gates ---------- */
  function gateDetail(c, g, st) {
    if (g === 'G17') return st.incidents && st.incidents.length ? 'Incident ' + esc(st.incidents.join(', ')) : '<span class="muted">No incident on this case</span>';
    if (st.state === 'n/a') return '<span class="muted">Not needed for this case</span>';
    if (st.state === 'released' || st.state === 'released, awaiting SARS') {
      const gs = c.gates[g];
      return `<div class="small">${esc((gs.by || []).map(VK.who).join(', '))}</div><div class="small muted">${VK.when(gs.at)}${gs.version ? esc(' · version ' + gs.version) : ''}</div>`;
    }
    const parts = [];
    if (st.invalidated) parts.push(`<div class="small">${esc(VK.scrub('Re-opened: ' + st.invalidated.why))}</div>`);
    if (c.gates[g].rework) parts.push(`<div class="small">${esc(VK.scrub('Returned for rework: ' + c.gates[g].rework.reason))}</div>`);
    if (st.before && st.before.length) parts.push(`<div class="small muted">${esc('After ' + st.before.join(', '))}</div>`);
    if (st.blockers && st.blockers.length) parts.push(`<div class="vk-codes">${st.blockers.map((x) => VK.codeChip(x.code, x) + VK.sevChip(x.sev, { short: true })).join(' ')}</div>`);
    if (st.missing && st.missing.length && !(st.before && st.before.length)) parts.push(`<div class="small muted">${esc(st.missing.slice(0, 3).join('; ') + (st.missing.length > 3 ? '; …' : ''))}</div>`);
    return parts.join('') || '<span class="muted">—</span>';
  }
  function gateAction(c, g, st) {
    const r = RELEASE[g];
    if (g === 'G17') {
      const inc = S.incidents.find((i) => i.caseId === c.id && i.status === 'open');
      return inc ? VK.link('incident', inc.id, 'Open ' + inc.id, { cls: 'btn sm' }) : '';
    }
    if (st.state === 'n/a' || st.state === 'released' || st.state === 'released, awaiting SARS') return '';
    if (st.before && st.before.length) return '';  // the gates before it come first
    if (g === 'G18') return S.txs.some((t) => t.caseId === c.id && t.status === 'awaiting G18') ? '<span class="small muted">Signed per transaction in SARS transactions</span>' : '';
    if (!((r.by === 'role' || r.by === 'ai') && r.role === S.role)) return '';
    const cr = ENGINE.canRelease(c, g, ACTOR.me());
    return VK.releaseBtn({ kind: 'gate', c, g, ready: cr.ok, why: cr.why });
  }
  function gatesBlock(c) {
    const order = SEQ.concat(['G17']);
    const rows = order.map((g) => {
      const st = ENGINE.gateState(c, g);
      return { cls: g === ENGINE.currentGate(c) ? 'cs-now' : '', cells: [VK.gateChip(c, g), esc(VK.gateName(g)), esc(whoRel(g)), gateDetail(c, g, st), gateAction(c, g, st)] };
    });
    const done = order.filter((g) => ['released', 'n/a'].includes(ENGINE.gateState(c, g).state)).length;
    return VK.section('cases-case-gates', 'Phases and gates', VK.tracker(c) + VK.table([{ label: 'Gate' }, { label: 'What it approves' }, { label: 'Who can release it' }, { label: 'State' }, { label: '', cls: 'vk-act' }], rows,
      { caption: 'All 18 gates for ' + c.id }), {
      count: order.length,
      intro: esc(plural(done, 'gate') + ' released or not needed. A gate passes only for its owner, after the gates before it and with no blocking exception. G10, G11 and G15 apply only when SARS raises them; G17 runs per incident.'),
    });
  }

  /* ---------- exceptions ---------- */
  function exAction(x) {
    if (ENGINE.isOpen(x)) return VK.exceptionBtn({ x, need: 'resolve' });
    if (x.status === 'resolved' && x.secondary) return x.secondary === S.role ? VK.exceptionBtn({ x, need: 'close' }) : lockNote('Closed by the ' + x.secondary);
    return '';
  }
  function exRow(x) {
    return [VK.sevChip(x.sev), `${VK.codeChip(x.code, x)} ${esc(x.title)}<div class="small muted">${VK.exLink(x)}${x.note ? ' · ' + esc(VK.scrub(x.note)) : ''}</div>`,
      `<span class="mono small">${esc(x.gates.join(', ') || '—')}</span>`,
      `${VK.exStatus(x)}<div class="small muted">${esc('Owner: ' + x.owner + (x.secondary ? '; closed by the ' + x.secondary : ''))}</div>${x.resolution ? `<div class="small">${esc(VK.scrub('Done: ' + x.resolution))}</div>` : ''}`,
      `${VK.when(x.at)}<div class="small muted">${esc(x.raisedBy || '')}</div>`, exAction(x)];
  }
  function exceptionsBlock(c) {
    const all = ENGINE.exOf(c).slice().sort((p, q) => (SEV.indexOf(p.sev) - SEV.indexOf(q.sev)) || (p.at - q.at));
    const live = all.filter((x) => x.status !== 'closed'); const closed = all.filter((x) => x.status === 'closed');
    const cols = [{ label: 'Severity' }, { label: 'Exception' }, { label: 'Gates' }, { label: 'Status' }, { label: 'Raised' }, { label: '', cls: 'vk-act' }];
    const body = VK.table(cols, live.map(exRow), { caption: 'Exceptions on ' + c.id, empty: 'No open exceptions on this case.' })
      + (closed.length ? `<details class="cs-more"><summary>${esc(plural(closed.length, 'closed exception'))}</summary>${VK.table(cols, closed.map(exRow), { caption: 'Closed exceptions on ' + c.id })}</details>` : '');
    return VK.section('cases-case-exceptions', 'Exceptions', body, {
      count: live.filter((x) => ENGINE.isOpen(x)).length,
      intro: esc('S1 stops every gate on the case; S2 blocks the gates it is mapped to. A resolved exception with a secondary reviewer keeps blocking until a different person closes it.'),
      actions: '<a href="#exceptions">Exception register</a>',
    });
  }

  /* ---------- four-source analysis ---------- */
  const TOPIC_FIELDS = { employment: ['remuneration', 'medicalFringe', 'paye', 'retirementFund'], medical: ['medicalFees', 'medicalExpenses'], ra: ['ra'], interest: ['interest', 'dividends'],
    rental: ['rentalIncome', 'rentalExpenses'], cgt: ['capitalGain'], foreign: ['foreignIncome', 'foreignTaxCredit'], travel: ['travel'], homeoffice: ['homeOffice'], donations: ['donations'] };
  function sourcesBlock(c) {
    const Q = ENGINE.QUESTIONS; const ans = c.questionnaire.answers || {}; const pre = (c.prepop && c.prepop.data) || {};
    const lines = (c.inputs && c.inputs.lines) || [];
    const topics = Q.filter((q) => c.questionnaire.required.includes(q.key) || q.key in ans || c.priorYear.includes(q.key)
      || (TOPIC_FIELDS[q.key] || []).some((f) => f in pre) || c.items.some((it) => it.kind === q.kind));
    const rows = topics.map((q) => {
      const fields = TOPIC_FIELDS[q.key] || [];
      const sars = fields.filter((f) => f in pre);
      const docs = c.docs.filter((d) => { const it = c.items.find((x) => x.id === d.itemId); return d.kind === q.kind || (it && it.kind === q.kind); });
      const got = fields.map((f) => [f, lines.filter((l) => l.field === f)]).filter(([, ls]) => ls.length);
      const prior = c.priorYear.includes(q.key);
      // Open exceptions on this topic: raised on the topic itself (QUE-*), on its checklist items or on its documents (DOC-02, AI-01 ...).
      const itemIds = c.items.filter((it) => it.kind === q.kind).map((it) => it.id); const docIds = docs.map((d) => d.id);
      const xs = ENGINE.exOf(c).filter((x) => ENGINE.isOpen(x) && (x.item === q.key || itemIds.includes(x.item) || (x.docId && docIds.includes(x.docId))));
      const find = [];
      if (prior && ans[q.key] === false) find.push(['Declared last year, not this year', 'warn']);
      if (!prior && ans[q.key] === true) find.push(['New this year', 'info']);
      if (ans[q.key] === true && !docs.some((d) => d.status === 'validated') && !c.items.some((it) => it.kind === q.kind && it.na === 'approved')) find.push(['Document outstanding', 'warn']);
      sars.forEach((f) => {
        const mine = lines.filter((l) => l.field === f).reduce((a, l) => a + l.amount, 0);
        if (got.some(([k]) => k === f) && Math.abs(mine - pre[f]) > S.policy.materiality.amount) find.push([(CALC.FIELDS[f] || {}).label + ' differs from SARS', 'bad']);
      });
      if (!find.length && !xs.length) find.push(['Consistent', 'ok']);
      return [
        `<strong>${esc(q.label)}</strong>`,
        yes(ans[q.key]),
        sars.length ? sars.map((f) => `<div class="small">${esc((CALC.FIELDS[f] || {}).label || f)}: ${VK.money(pre[f])}</div>`).join('') : '<span class="muted">Nothing</span>',
        prior ? VK.pill('Declared', 'info') : '<span class="muted">Not declared</span>',
        (docs.length ? docs.map((d) => `<div class="small">${esc(d.name)} ${docStatus(d)}</div>`).join('') : '<span class="muted">None</span>')
          + got.map(([f, ls]) => `<div class="small muted">${esc((CALC.FIELDS[f] || {}).label || f)}: ${VK.money(ls.reduce((a, l) => a + l.amount, 0))}</div>`).join(''),
        find.map(([t, tone]) => VK.pill(t, tone)).join(' ')
          + xs.map((x) => `<div class="small">${VK.codeChip(x.code, x)} ${esc(VK.scrub(x.note || x.title))}</div>`).join(''),
      ];
    });
    const intro = 'Operon compares four sources for each topic: the client’s questionnaire, SARS’s pre-populated data, last year’s return and the documents with their extracted values. The last column is Operon’s comparison, with any open exception on the topic. '
      + (c.prepop ? 'Pre-populated data ' + (c.prepop.ref || '') + ' received ' + fWhen(c.prepop.at) + '. ' : 'No pre-populated data has arrived from SARS (simulated). ')
      + (c.inputs && c.inputs.prior && typeof c.inputs.prior.taxableIncome === 'number' ? 'Last year’s taxable income: ' + CALC.rand(c.inputs.prior.taxableIncome) + '.' : '');
    return VK.section('cases-case-sources', 'Four-source analysis', VK.table([{ label: 'Topic' }, { label: 'Questionnaire' }, { label: 'SARS pre-populated' }, { label: 'Last year' }, { label: 'Documents and values' }, { label: 'Comparison' }], rows,
      { caption: 'Four-source analysis for ' + c.id, empty: 'No topics yet: the questionnaire has not been answered.' }), { intro: esc(intro) });
  }

  /* ---------- personalised checklist ---------- */
  const ITEM_STATE = { validated: ['Received and checked', 'ok'], held: ['Held by an exception', 'bad'], requested: ['Requested', 'warn'], na: ['Not available (approved)', ''] };
  function checklistBlock(c) {
    const rows = c.items.map((it) => {
      const st = ENGINE.itemState(c, it); const [word, tone] = ITEM_STATE[st] || [st, ''];
      const docs = c.docs.filter((d) => d.itemId === it.id);
      let act = '';
      if (it.na === 'requested') act = btn('Approve N/A', 'cases.na', { cls: 'sm', data: { case: c.id, item: it.id } });
      return [`<strong>${esc(it.label)}</strong><div class="small muted mono">${esc(it.id)}</div>`, VK.pill(word, tone),
        docs.length ? docs.map((d) => `<div class="small">${esc(d.name)} ${docStatus(d)}</div>`).join('') : '<span class="muted">None yet</span>',
        it.naReason ? `<div class="small">${esc(VK.scrub('Client: ' + it.naReason))}</div>${it.na === 'requested' ? '<div class="small muted">Waiting for the Tax Consultant</div>' : ''}` : '<span class="muted">—</span>', act];
    });
    const reqs = Object.keys(c.req).sort().flatMap((g) => c.req[g].map((r) => `<div class="vk-row"><span class="vk-gate vk-g-${r.done ? 'done' : 'idle'}"><b>${esc(g)}</b></span><div class="vk-row-b"><div class="vk-row-t">${esc(r.label)}</div><div class="vk-meta">${r.done ? `${VK.pill('Done', 'ok')}<span>${esc(VK.who(r.by))}</span>${VK.when(r.at)}` : VK.pill('To do', 'warn')}</div></div></div>`));
    return VK.section('cases-case-checklist', 'Personalised checklist', VK.table([{ label: 'Item' }, { label: 'State' }, { label: 'Documents' }, { label: 'Not available' }, { label: '', cls: 'vk-act' }], rows,
      { caption: 'Checklist for ' + c.id, empty: 'Nothing has been requested yet.' })
      + `<h3 class="cs-h3">Gate checklists</h3>` + VK.list(reqs, { empty: 'No gate checklist items.' }), {
      count: c.items.length,
      intro: esc('Built from the questionnaire and last year’s return: each yes adds the document it needs. The client uploads in the PaperSync portal (simulated) or asks to mark an item not available, which the Tax Consultant approves.'),
    });
  }

  /* ---------- documents and lineage ---------- */
  function documentsBlock(c) {
    const docs = c.docs.map((d) => {
      const it = c.items.find((x) => x.id === d.itemId);
      const kind = d.kind ? (DOC_KINDS.find((k) => k.kind === d.kind) || {}).label || d.kind : 'Not classified';
      return [`<strong>${esc(d.name)}</strong><div class="small muted mono">${esc(d.id)} · ${esc(Math.round(d.size / 1024) + ' KB')}</div>`, esc(it ? it.label : '—'),
        `${VK.when(d.at)}<div class="small muted">${esc(VK.who(d.by))}</div>`, docStatus(d),
        `<div class="small">${esc(kind)}</div>${d.confidence != null ? `<div class="small muted">${esc('Confidence ' + Math.round(d.confidence * 100) + '%')}</div>` : ''}`,
        `<span class="mono small" title="${esc('SHA-256 ' + (d.hash || ''))}">${esc(short(d.hash))}</span>`];
    });
    const lin = CALC.lineage(c).map((l) => [`<span class="mono">${esc(l.line)}</span>`, l.file ? `${esc(l.file)}${l.doc ? `<div class="small muted mono">${esc(l.doc)}</div>` : ''}` : '<span class="muted">No source</span>',
      esc(l.ref), VK.money(l.amount), esc(l.category), `<span class="mono small">${esc(l.field)}</span>`,
      l.judgement ? (l.decided ? `${VK.pill('Decided', 'ok')}<div class="small">${esc(VK.scrub(l.decided.rationale))}</div>` : `${VK.pill('Judgement: ' + l.judgement, 'warn')}`) : '<span class="muted">Rules</span>']);
    return VK.section('cases-case-documents', 'Documents and lineage', VK.table([{ label: 'Document' }, { label: 'Checklist item' }, { label: 'Uploaded' }, { label: 'Check' }, { label: 'AI reading (simulated)' }, { label: 'Hash' }], docs,
      { caption: 'Documents on ' + c.id, empty: 'No documents yet.' })
      + `<h3 class="cs-h3">Extracted values and where they came from</h3>`
      + VK.table([{ label: 'Value' }, { label: 'Document' }, { label: 'Reference' }, { label: 'Amount' }, { label: 'Tax category' }, { label: 'Calculator field' }, { label: 'Treatment' }], lin,
        { caption: 'Lineage for ' + c.id, empty: 'No values extracted yet.' }), {
      count: c.docs.length,
      intro: esc('The AI checks each upload by its name and size only (simulated): file contents are never read. Lineage runs from the document to the extracted value, its tax category and the calculator field.'),
    });
  }

  /* ---------- calculation pack ---------- */
  function calcBlock(c) {
    const k = c.calc; const canCalc = !!c.inputs;
    const recalc = canCalc ? btn('Recalculate', 'cases.recalc', { cls: 'sm', data: { case: c.id } }) : '';
    if (!k) {
      return VK.section('cases-case-calc', 'Calculation pack', VK.empty(canCalc ? 'Not calculated yet.' : 'No calculation yet: no values have been extracted.'), { actions: recalc });
    }
    const summary = k.summary || {}; const errors = k.errors || [];
    const sum = ITA34_FIELDS.map((f) => [f.label, VK.money(summary[f.key])]);
    const lines = (k.lines || []).map((l) => ({ cls: ['taxableIncome', 'result', 'liability'].includes(l.key) ? 'cs-total' : '',
      cells: [esc(l.label), VK.money(l.amount), `<span class="small">${esc(l.basis || '')}</span>`, l.from && l.from.length ? `<span class="mono small">${esc(l.from.join(', '))}</span>` : '<span class="muted">—</span>'] }));
    const inputLine = (id) => ((c.inputs && c.inputs.lines) || []).find((l) => l.id === id);
    const pend = (k.pending || []).map((p) => {
      const l = inputLine(p.line);
      const decided = l && l.decided;
      return [`<span class="mono">${esc(p.line)}</span>`, esc(p.label), VK.money(p.amount), VK.codeChip(p.code, ENGINE.openOf(c, p.code)[0]),
        decided ? `${VK.pill('Decided: recalculate to use it', 'info')}<div class="small">${esc(VK.scrub(decided.rationale))}</div>` : '<span class="muted">Left out until decided</span>',
        p.field ? btn('Decide', 'cases.decide', { cls: 'sm' + (decided ? '' : ' primary'), data: { case: c.id, line: p.line } }) : ''];
    });
    const sch = c.schedules || {}; const schRows = [];
    if (sch.interest && sch.interest.gross) schRows.push(['Interest', 'Gross ' + CALC.rand(sch.interest.gross) + ', exempt ' + CALC.rand(sch.interest.exempt) + ' (limit ' + CALC.rand(sch.interest.limit) + '), taxable ' + CALC.rand(sch.interest.taxable)]);
    if (sch.retirement && sch.retirement.contributions) schRows.push(['Retirement (s11F)', 'Contributions ' + CALC.rand(sch.retirement.contributions) + ', deducted ' + CALC.rand(sch.retirement.deduction) + ', carried forward ' + CALC.rand(sch.retirement.carriedForward)]);
    if (sch.donations && sch.donations.donated) schRows.push(['Donations (s18A)', 'Donated ' + CALC.rand(sch.donations.donated) + ', limit ' + CALC.rand(sch.donations.limit) + ', deducted ' + CALC.rand(sch.donations.deduction)]);
    if (sch.medical && (sch.medical.fees || sch.medical.expenses)) schRows.push(['Medical (s6A, s6B)', sch.medical.months + ' months; fees ' + CALC.rand(sch.medical.fees) + ', expenses ' + CALC.rand(sch.medical.expenses) + '; credits ' + CALC.rand(sch.medical.s6aUsed) + ' + ' + CALC.rand(sch.medical.s6bUsed)]);
    if (sch.cgt && (sch.cgt.aggregate || sch.cgt.broughtForward)) schRows.push(['Capital gains', 'Aggregate ' + CALC.rand(sch.cgt.aggregate) + ', taxable ' + CALC.rand(sch.cgt.taxable) + (sch.cgt.lossCarried ? ', loss carried forward ' + CALC.rand(sch.cgt.lossCarried) : '')]);
    if (sch.rental && (sch.rental.income || sch.rental.expenses)) schRows.push(['Rental', 'Income ' + CALC.rand(sch.rental.income) + ', expenses ' + CALC.rand(sch.rental.expenses) + ', net ' + CALC.rand(sch.rental.net)]);
    const rsOk = k.ruleset === S.rulesetVersion;
    const facts = VK.facts([
      ['Ruleset', `<span class="mono">${esc(k.ruleset || '—')}</span> ${rsOk ? VK.pill('Current', 'ok') : VK.pill('Current is ' + S.rulesetVersion, 'bad')}`],
      ['Year and age', esc((k.year || c.year) + ' year of assessment' + (k.age != null ? '; age ' + k.age + ' at the year end' : ''))],
      ['Version', esc(ENGINE.vN(c) ? 'Version ' + ENGINE.vN(c) : 'None') + (c.rerun ? ' ' + VK.pill('Rerun needed', 'warn') : '')],
      ['Last year', k.variance ? esc('Taxable income ' + CALC.rand(k.variance.prior) + ' last year; change ' + CALC.rand(k.variance.diff) + ' (' + Math.round(k.variance.ratio * 1000) / 10 + '%)') + (k.variance.material ? ' ' + VK.pill('Material', 'warn') : '') : '<span class="muted">No comparison</span>'],
      ['Reconciliation', !c.recon ? '<span class="muted">Not checked yet</span>' : c.recon.ok ? VK.pill('Documents, values, calculation and ITR12 agree', 'ok') : `${VK.pill('Fails', 'bad')}<div class="small">${esc(c.recon.issues.join('; '))}</div>`],
    ]);
    const body = facts + (errors.length ? `<p class="err">${esc(errors.join('; '))}</p>` : '')
      + `<div class="cs-split"><div><h3 class="cs-h3">Summary</h3>${VK.facts(sum.map(([a, b]) => [a, b]))}</div>`
      + `<div><h3 class="cs-h3">Schedules</h3>${schRows.length ? VK.facts(schRows.map(([a, b]) => [a, esc(b)])) : '<p class="muted small">No schedules beyond employment.</p>'}</div></div>`
      + `<h3 class="cs-h3">Judgement items for the Tax Consultant</h3>`
      + VK.table([{ label: 'Value' }, { label: 'Item' }, { label: 'Amount' }, { label: 'Code' }, { label: 'Decision' }, { label: '', cls: 'vk-act' }], pend, { caption: 'Judgement items on ' + c.id, empty: 'No judgement items are waiting.' })
      + `<h3 class="cs-h3">Calculation lines</h3>`
      + VK.table([{ label: 'Line' }, { label: 'Amount' }, { label: 'Basis' }, { label: 'From values' }], lines, { caption: 'Calculation lines for ' + c.id });
    return VK.section('cases-case-calc', 'Calculation pack', body, {
      intro: esc('Calculated by Operon’s calculator on the 2026 SARS rates from the extracted values. Judgement items (home office, travel, foreign income, trusts, trade) are left out until the Tax Consultant decides them; recalculating records a new version.'),
      actions: recalc,
    });
  }

  /* ---------- client approval and versions ---------- */
  function approvalBlock(c) {
    const ap = c.approval; const v = ENGINE.curVersion(c); const problem = ENGINE.approvalProblem(c);
    const apv = ap ? c.versions.find((x) => x.n === ap.version) : null;
    const bound = ap && apv ? (ap.calc === apv.calc && ap.itr12 === apv.itr12) : false;
    const facts = VK.facts([
      ['Status', problem ? VK.pill(problem, ap ? 'warn' : '') : VK.pill('Approved: version ' + ap.version, 'ok')],
      ['Approved', ap ? `${VK.when(ap.at)} <span class="small muted">${esc(VK.who(ap.by))}</span>` : '<span class="muted">Not yet</span>'],
      ['Bound to', ap ? `<span class="mono small">${esc('calc ' + short(ap.calc) + ' · ITR12 ' + short(ap.itr12))}</span> ${bound ? VK.pill('Matches version ' + ap.version, 'ok') : VK.pill('Does not match', 'bad')}` : '<span class="muted">—</span>'],
      ['Declaration', ap ? (ap.declaration === DECLARATION ? VK.pill('Confirmed', 'ok') : VK.pill('Not confirmed', 'bad')) : '<span class="muted">—</span>'],
      ['Withdrawn or superseded', ap ? esc(ap.withdrawn ? 'Withdrawn' : ap.superseded ? 'Superseded by a later version' : 'No') : '<span class="muted">—</span>'],
      ['Frozen for submission', c.frozen ? esc('Version ' + c.frozen.version + ', ') + VK.when(c.frozen.at) : '<span class="muted">Not frozen</span>'],
    ]);
    const drift = ENGINE.drift(c);
    const verCodes = ENGINE.exOf(c).filter((x) => /^VER-/.test(x.code));
    const rows = c.versions.slice().reverse().map((x) => [esc('Version ' + x.n) + (v && x.n === v.n ? ' ' + VK.pill('Current', 'info') : ''), `${VK.when(x.at)}<div class="small muted">${esc(VK.who(x.by))}</div>`,
      esc(VK.scrub(x.reason)), `<span class="mono small" title="${esc('calc ' + x.calc + ' / ITR12 ' + x.itr12)}">${esc(short(x.calc))}</span>`,
      ap && ap.version === x.n ? VK.pill(ap.withdrawn ? 'Withdrawn' : ap.superseded ? 'Superseded' : 'Approved', ap.withdrawn || ap.superseded ? 'warn' : 'ok') : '<span class="muted">—</span>']);
    return VK.section('cases-case-approval', 'Client approval and versions', facts
      + (drift.length ? `<p class="err">${esc('The record differs from version ' + ENGINE.vN(c) + ' (' + drift.join(', ') + '): VER-02 is raised.')}</p>` : '')
      + (verCodes.length ? `<div class="vk-codes"><span class="small muted">Version codes:</span> ${verCodes.map((x) => VK.codeChip(x.code, x) + VK.exStatus(x)).join(' ')}</div>` : '')
      + VK.table([{ label: 'Version' }, { label: 'Recorded' }, { label: 'Reason' }, { label: 'Calculation hash' }, { label: 'Client approval' }], rows, { caption: 'Versions of ' + c.id, empty: 'No versions yet.' }), {
      count: c.versions.length,
      intro: esc('The client approves one version in the PaperSync portal (simulated), with the declaration. The approval is bound to that version’s hashes: any later version supersedes it and raises VER-01.'),
    });
  }

  /* ---------- SARS transactions ---------- */
  function sarsBlock(c) {
    const txs = S.txs.filter((t) => t.caseId === c.id);
    const rows = txs.map((t) => {
      let act = '';
      if (t.status === 'awaiting G18' && RELEASE.G18.roles.includes(S.role) && !t.signoffs.some((s) => s.role === S.role)) {
        const ready = !ENGINE.g18Checks(t).some((k) => !k.ok) && !ENGINE.g18Blockers(t).length;
        act = VK.releaseBtn({ kind: 'g18', c, g: 'G18', tx: t, ready, why: ready ? '' : 'Not every G18 check passes' });
      }
      return [`<span class="mono">${esc(t.id)}</span>`, `${esc(t.label)}<div class="small muted">${esc('For ' + (t.gate || '—') + (t.version ? ', version ' + t.version : ''))}</div>`,
        txPill(t.status),
        t.signoffs.length ? t.signoffs.map((s) => `<div class="small">${esc(pname(s.id) + ' (' + s.role + ')')}</div>`).join('') : '<span class="muted">None yet</span>',
        `${t.ref ? `<div class="mono small">${esc(t.ref)}</div>` : ''}${t.sentAt ? `<div class="small muted">Sent ${VK.when(t.sentAt)}</div>` : ''}${t.attempts && t.attempts.length ? `<div class="small muted">${esc(plural(t.attempts.length, 'attempt'))}</div>` : ''}` || '<span class="muted">—</span>',
        act];
    });
    const inbound = S.inbound.filter((it) => it.caseId === c.id).map((it) => `<div class="vk-row">${VK.datebox(it.date)}<div class="vk-row-b"><div class="vk-row-t">${esc(it.label)} <span class="mono small">${esc(it.ref || it.id)}</span></div>
      <div class="vk-meta"><span>Received ${VK.date(it.date)}</span>${it.due ? `<span>Due ${VK.date(it.due)}</span>` : ''}<span class="mono" title="${esc('SHA-256 ' + it.hash)}">${esc(short(it.hash))}</span></div></div></div>`);
    const sub = c.submission;
    return VK.section('cases-case-sars', 'SARS transactions', (sub && sub.ok ? `<p class="small">${VK.pill('Submitted', 'ok')} ${esc('Reference ' + sub.ref + ', version ' + sub.version + ', ')}${VK.when(sub.at)}</p>` : '')
      + VK.table([{ label: 'Transaction' }, { label: 'What' }, { label: 'Status' }, { label: 'G18 sign-offs' }, { label: 'SARS reference' }, { label: '', cls: 'vk-act' }], rows, { caption: 'SARS transactions for ' + c.id, empty: 'Nothing has been sent to SARS for this case.' })
      + `<h3 class="cs-h3">Received from SARS</h3>` + VK.list(inbound, { empty: 'Nothing has arrived from SARS for this case.' }), {
      count: txs.length,
      intro: esc('The SARS link is simulated: nothing here connects to SARS. Every outbound item needs G18: two different people and all 8 checks. An unknown status is never retried blindly.'),
      actions: '<a href="#sars">SARS link</a>',
    });
  }

  /* ---------- Declaration Alert, verification and audit, ITA34 and remedies (when they apply) ---------- */
  function draftsList(t) {
    if (!t.drafts || !t.drafts.length) return VK.empty('No answers drafted yet.');
    return `<p class="small muted">${esc('Drafted by ' + (t.draftedBy ? VK.who(t.draftedBy) : 'nobody') + ' ' + (t.draftedAt ? fWhen(t.draftedAt) : '') + '. The Tax Consultant reviews every answer before anything goes to SARS.')}</p>`
      + VK.list(t.drafts.map((d) => `<div class="vk-row-b"><div class="vk-row-t">${esc(d.q)}</div><div>${esc(VK.scrub(d.a))}</div><div class="vk-meta">${d.evidence ? `<span>Evidence: ${esc(d.evidence)}</span>` : VK.pill('No evidence yet', 'warn')}</div></div>`));
  }
  function daBlock(c) {
    const d = c.da; if (!d) return '';
    const left = VK.bizLeft(d.due);
    const status = d.submitted ? VK.pill('Response sent ' + (d.submitted.ref || ''), 'ok') : d.moved ? VK.pill('Moved to verification ' + (d.moved.ref || ''), 'info') : VK.leftPill(left);
    return VK.section('cases-case-da', 'Declaration Alert', VK.facts([['SARS reference', `<span class="mono">${esc(d.ref)}</span>`], ['Received', VK.date(d.received)], ['Response due', VK.date(d.due) + ' ' + status], ['G10', VK.gateChip(c, 'G10')],
      ['Questions', d.questions.length ? esc(d.questions.join('; ')) : '<span class="muted">None listed</span>']])
      + `<p class="note">${esc(d.window || PERIODS.daWindow.text)} <span class="small">(${esc(PERIODS.daWindow.rule)})</span></p>`
      + `<h3 class="cs-h3">Drafted answers</h3>` + draftsList(d), {
      intro: esc('SARS’s Declaration Questionnaire (the documents call it the Declaration Alert). The AI drafts answers from the case evidence (simulated); the Tax Consultant approves the response at G10.'),
    });
  }
  function tracker21(t) {
    if (t.uploaded) {
      const r = DATES.verification21(DATES.dt(t.uploaded));
      const target = DATES.iso(r.target); const left = VK.bizLeft(target);
      const day = Math.max(0, Math.min(21, 21 - (left == null ? 21 : left)));
      return `<div class="cs-21"><div class="cs-21-bar" role="progressbar" aria-valuemin="0" aria-valuemax="21" aria-valuenow="${day}" aria-label="Business days since upload"><span style="width:${Math.round(day / 21 * 100)}%"></span></div>
        <p class="small">${esc('Uploaded ' + dd(t.uploaded) + ' (Day 0). Day 1 is ' + dd(DATES.iso(r.day1)) + '; SARS’s 21-business-day target is ' + dd(target) + ', follow up from ' + dd(DATES.iso(r.follow)) + '.')} ${VK.leftPill(left)}</p></div>`;
    }
    const r = DATES.verification21(DATES.fromLocal(now()));
    return `<p class="small">${esc('The 21-business-day clock starts when the documents are uploaded (Day 0). They are not uploaded yet: uploaded today, SARS’s target would be ' + dd(DATES.iso(r.target)) + '.')}</p>`;
  }
  function vrfBlock(c) {
    const parts = [['vrf', c.vrf, 'Verification'], ['aud', c.aud, 'Audit or expanded enquiry']].filter(([, t]) => t);
    if (!parts.length) return '';
    const body = parts.map(([k, t, label]) => `<h3 class="cs-h3">${esc(label + ' ' + t.ref)}</h3>` + VK.facts([['Received', VK.date(t.received)], ['Documents due', VK.date(t.due) + ' ' + (t.uploaded ? VK.pill('Uploaded ' + dd(t.uploaded), 'ok') : VK.leftPill(VK.bizLeft(t.due)))],
      ['SARS asked for', t.requests.length ? esc(t.requests.join('; ')) : '<span class="muted">Nothing listed</span>'], ['G11', VK.gateChip(c, 'G11')]])
      + (k === 'vrf' ? tracker21(t) : `<p class="note">${esc(PERIODS.audit.text)}</p>`)
      + `<h4 class="cs-h4">Response pack</h4>` + draftsList(t)).join('');
    return VK.section('cases-case-verification', 'Verification and audit', body, {
      intro: esc('SARS’s service standard: “' + PERIODS.verification.text.replace(/^“|”$/g, '') + '” Business days skip weekends and South African public holidays. The response pack is indexed by the AI (simulated) and released by the Tax Consultant at G11.'),
    });
  }
  function ita34Block(c) {
    if (!(c.ita34 || c.decision || c.remedy || c.outcome)) return '';
    let body = '';
    if (c.ita34) {
      const firm = (c.calc && c.calc.summary) || {}; const sars = c.ita34.values || {};
      const diff = new Set(c.ita34.recon.diffs.map((d) => d.key));
      const rows = ITA34_FIELDS.map((f) => ({ cls: diff.has(f.key) ? 'cs-diff' : '', cells: [esc(f.label), VK.money(firm[f.key]), VK.money(sars[f.key]), VK.money((+sars[f.key] || 0) - (+firm[f.key] || 0)), diff.has(f.key) ? VK.pill('Differs', 'bad') : VK.pill('Agrees', 'ok')] }));
      body += VK.facts([['ITA34', `<span class="mono">${esc(c.ita34.ref)}</span> · ${VK.date(c.ita34.date)}`], ['Comparison', c.ita34.recon.ok ? VK.pill('Agrees with the approved calculation', 'ok') : VK.pill('Differs: ASM-02', 'bad')], ['G12 · G13', VK.gateChip(c, 'G12') + ' ' + VK.gateChip(c, 'G13')]])
        + VK.table([{ label: 'Figure' }, { label: 'Firm’s approved calculation' }, { label: 'SARS ITA34' }, { label: 'Difference' }, { label: 'Result' }], rows, { caption: 'ITA34 against the approved calculation for ' + c.id });
    }
    const dec = c.decision;
    body += `<h3 class="cs-h3">Client decision</h3>` + (dec ? VK.facts([['Decision', esc(dec.choice === 'accept' ? 'Accept the assessment' : dec.choice === 'instruct' ? 'Instruct the firm to dispute it' : dec.choice)], ['When', VK.when(dec.at)], ['Note', dec.note ? esc(VK.scrub(dec.note)) : '<span class="muted">None</span>'], ['G14', VK.gateChip(c, 'G14')]])
      : '<p class="small muted">The client has not decided yet (PaperSync portal, simulated).</p>');
    const rem = c.remedy;
    if (rem) {
      const p = PERIODS[rem.route];
      body += `<h3 class="cs-h3">Remedy</h3>` + VK.facts([
        ['Route', esc(rem.route === 'advice' ? 'Documented advice, no SARS action' : (SARS_FN[rem.route] || {}).label || rem.route)],
        ['Deadline', rem.deadline ? VK.date(rem.deadline) + ' ' + VK.leftPill(VK.bizLeft(rem.deadline, true)) + ' <span class="small muted">16 Dec to 15 Jan not counted</span>' : esc(rem.basis || 'No deadline')],
        ['Counted from', rem.from ? esc(dd(rem.from) + ' (' + (p ? p.from : rem.basis) + ')') : '<span class="muted">—</span>'],
        ['Rule', esc(rem.rule || (p && p.rule) || '—') + (p && p.note ? `<div class="small muted">${esc(p.note)}</div>` : '')],
        ['Client authority', rem.authority ? VK.pill('Authorised', 'ok') : (rem.route === 'advice' ? '<span class="muted">Not needed</span>' : VK.pill('Not yet', 'warn'))],
        ['Grounds and evidence', rem.evidence ? esc(VK.scrub(rem.evidence)) : VK.pill('Not recorded', 'warn')],
        ['G15', VK.gateChip(c, 'G15')],
      ]);
    }
    if (c.outcome) body += `<p class="small">${esc('Remedy outcome ' + (c.outcome.ref || '') + ' received ' + dd(c.outcome.date))}</p>`;
    return VK.section('cases-case-ita34', 'ITA34 and remedies', body, {
      intro: esc('The ITA34 is compared figure by figure with the firm’s approved calculation (differences over ' + CALC.rand(S.policy.materiality.amount) + ' raise ASM-02). The client decides in the PaperSync portal; a dispute runs on Chapter 9 business days.'),
    });
  }

  /* ---------- audit trail and retention ---------- */
  function auditBlock(c) {
    const all = S.audit.filter((a) => a.caseId === c.id);
    const items = all.slice(-AUDIT_N).reverse().map((a) => `<div class="vk-row vk-row-log"><span class="vk-when">${VK.when(a.at)}</span><div class="vk-row-b">
      <div class="vk-row-t">${esc(VK.scrub(a.text))}${a.result === 'Refused' ? ' ' + VK.pill('Refused', 'bad') : ''}</div>
      <div class="vk-meta"><span>${esc(VK.who(a.who) + (a.role ? ' · ' + a.role : ''))}</span>${a.gate ? `<span class="mono">${esc(a.gate)}</span>` : ''}${a.code ? `<span class="mono">${esc(a.code)}</span>` : ''}</div></div></div>`);
    return VK.section('cases-case-audit', 'Audit trail', VK.list(items, { empty: 'Nothing recorded for this case yet.' })
      + (all.length > AUDIT_N ? `<p class="small muted">${esc(plural(all.length - AUDIT_N, 'earlier entry', 'earlier entries'))} in the <a href="#audit">audit trail</a>.</p>` : ''), {
      count: all.length,
      intro: esc('Every action and every refusal on this case, newest first. The trail is append-only and hash-chained.'),
      actions: '<a href="#audit">Full audit trail</a>',
    });
  }
  function retentionBlock(c) {
    const r = c.retention;
    const holds = r.holds.map((h) => `<div class="vk-row"><span class="vk-gate vk-g-${h.released ? 'done' : 'blocked'}"><b>${esc(h.id)}</b></span><div class="vk-row-b"><div class="vk-row-t">${esc(h.label)}</div>
      <div class="vk-meta"><span>Since ${VK.when(h.since)}</span>${h.released ? `<span>Released ${VK.when(h.released.at)}</span>` : VK.pill('Active', 'warn')}</div></div></div>`);
    return VK.section('cases-case-retention', 'Retention', VK.facts([
      ['Retained from', r.from ? VK.date(r.from) : '<span class="muted">Starts when the return is submitted</span>'],
      ['Retained until', r.until ? VK.date(r.until) : '<span class="muted">—</span>'],
      ['Review date', r.review ? VK.date(r.review) : '<span class="muted">—</span>'],
      ['G16', VK.gateChip(c, 'G16')],
      ['Archived', c.archived ? VK.pill('Yes: nothing is deleted', 'info') : 'No'],
    ]) + `<h3 class="cs-h3">Holds</h3>` + VK.list(holds, { empty: 'No retention holds.' }), {
      intro: esc(PERIODS.retention.years + ' years from ' + PERIODS.retention.from + ' (' + PERIODS.retention.rule + '). The Records/Compliance Owner releases G16 at the review date; nothing is deleted automatically.'),
    });
  }

  /* ---------- the page ---------- */
  VIEWS.case = (id) => {
    const c = ENGINE.caseById(id);
    if (!c) {
      return VK.page('Case not found', esc('There is no case ' + String(id || '') + ' in this demo firm. It may have been reset.'),
        VK.section('cases-case-missing', 'Where to look', '<p><a href="#cases">All cases</a></p>'), { key: 'cases-case' });
    }
    const cl = ENGINE.clientOf(c);
    const moves = [];
    if (ENGINE.columnOf(c) !== 'closed') moves.push(btn('Next stage', 'cases.fwd', { cls: 'sm', id: 'cs-fwd', data: { case: c.id }, title: 'Ask Operon to pass ' + (ENGINE.currentGate(c) || 'the next gate') }));
    if (CASES_BOARD.earlierCols(c).length && !(c.submission && c.submission.ok)) moves.push(btn('Back for rework', 'cases.back', { cls: 'sm ghost', id: 'cs-back', data: { case: c.id } }));
    const intro = `${esc(c.year + ' ITR12 · ' + CASES_BOARD.colLabel(ENGINE.columnOf(c)) + ' · Tax Consultant ' + pname(c.consultant))}. ${esc('All data is made up; the AI, the PaperSync portal and the SARS link are simulated.')}`;
    const body = summaryBlock(c, cl) + gatesBlock(c) + exceptionsBlock(c) + sourcesBlock(c) + checklistBlock(c) + documentsBlock(c) + calcBlock(c)
      + approvalBlock(c) + sarsBlock(c) + daBlock(c) + vrfBlock(c) + ita34Block(c) + auditBlock(c) + retentionBlock(c);
    return VK.page(c.id + ' · ' + cl.name, intro, body, { key: 'cases-case', actions: moves.join('') });
  };

  /* ---------- this page's actions ---------- */
  const caseOf = (t) => { const c = ENGINE.caseById(t.dataset.case); if (!c) { toast('That case is no longer here.'); render(); } return c; };
  const finish = (r, okMessage) => (r && r.ok ? () => VK.done(r, okMessage) : 'Not done: ' + ((r && r.why) || 'Operon refused this.'));
  Object.assign(ACT, {
    // The Tax Consultant's decision on a judgement item: the amount and the treatment, authority or rationale (ENGINE.decideItem).
    'cases.decide': (t) => {
      const c = caseOf(t); if (!c) return;
      const l = ((c.inputs && c.inputs.lines) || []).find((x) => x.id === t.dataset.line);
      if (!l) { toast('That value is no longer on the case.'); render(); return; }
      const f = CALC.FIELDS[l.field] || {};
      modal('Decide ' + l.id + ': ' + (f.label || l.field), `${VK.facts([['Case', VK.caseWho(c)], ['Source', esc(l.ref || '—')], ['Extracted amount', VK.money(l.amount)], ['Code', VK.codeChip(f.judgement || '')]])}
        <label class="f" for="cs-dec-amount">Amount to use (rand)<input id="cs-dec-amount" name="amount" inputmode="decimal" autocomplete="off" value="${esc(l.amount)}"></label>
        <label class="f" for="cs-dec-why">Treatment, authority or rationale, and conclusion (required)<textarea id="cs-dec-why" name="rationale" maxlength="1000"></textarea></label>
        <p class="hint">${esc('You decide as ' + S.role + ' (' + me().name + '). The calculation uses it once you recalculate, which records a new version.')}</p>`,
      'Record decision', (fd) => {
        const raw = String(fd.amount || '').replace(/[\sR,]/g, '');
        if (raw === '' || !isFinite(Number(raw))) return 'Give the amount as a number, for example 24000.';
        return finish(ENGINE.decideItem(c, l.id, ACTOR.me(), { amount: Number(raw), rationale: String(fd.rationale || '').trim() }), 'Decided ' + l.id + '. Recalculate to use it.');
      });
    },
    // Recalculate: a new version from the current extracted values and ruleset (ENGINE.calculate).
    'cases.recalc': (t) => {
      const c = caseOf(t); if (!c) return;
      const ap = ENGINE.currentApproval(c);
      modal('Recalculate ' + c.id, `<p>${esc('Runs the calculation again on ruleset ' + S.rulesetVersion + ' and records version ' + (c.versions.length + 1) + '.')}</p>
        ${ap ? `<p class="note">${esc('The client approved version ' + c.approval.version + '. A new version supersedes that approval (VER-01): the client approves again in the PaperSync portal.')}</p>` : ''}
        <label class="f" for="cs-rc-why">Reason (optional)<input id="cs-rc-why" name="reason" maxlength="300" autocomplete="off" placeholder="Recalculated after a decision"></label>`,
      'Recalculate', (fd) => {
        const reason = String(fd.reason || '').trim() || 'Recalculated by the Tax Consultant on ruleset ' + S.rulesetVersion;
        const r = ENGINE.calculate(c, ACTOR.me(), { reason });
        return finish(r, 'Recalculated ' + c.id + ': version ' + (r.version || ENGINE.vN(c)) + '.');
      });
    },
    // Approve the client's reason that a checklist item is not available (ENGINE.approveNa).
    'cases.na': (t) => {
      const c = caseOf(t); if (!c) return;
      VK.done(ENGINE.approveNa(c, t.dataset.item, ACTOR.me()), 'Approved: the item is marked not available.');
    },
  });
})();
