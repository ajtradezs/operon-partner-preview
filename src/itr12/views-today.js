/* Today: what is waiting for the signed-in role (S.role), the deadlines coming up, and what came in since yesterday evening.
   Read-only: the buttons use the kit's shared actions (ACT 'vk.*'), which go through ENGINE with ACTOR.me(). */
(() => {
  const PORTAL_N = 8; const INBOUND_N = 6; const AI_N = 10;

  function approvalsBlock(role) {
    const rows = VK.waitingGates(role);
    const ready = rows.filter((r) => r.ready).length;
    const status = (r) => {
      if (r.ready) return `${VK.pill(r.kind === 'g18' ? 'Your sign-off is next' : 'Ready for you', 'ok')}${r.note ? `<div class="small muted">${esc(VK.scrub(r.note))}</div>` : ''}`;
      const codes = r.blockers.length ? `<div class="vk-codes">${r.blockers.map((x) => VK.codeChip(x.code, x) + VK.sevChip(x.sev, { short: true })).join(' ')}</div>` : '';
      const miss = r.blockers.length ? '' : `<div class="small">${esc(VK.scrub(r.why.replace(/^Not ready: /, '')))}</div>`;
      return `${VK.pill(r.blockers.length ? 'Blocked' : 'Waiting', r.blockers.length ? 'bad' : 'warn')}${codes}${miss}`;
    };
    const table = VK.table([{ label: 'Gate' }, { label: 'Case' }, { label: 'What it approves' }, { label: 'Status' }, { label: '', cls: 'vk-act' }],
      rows.map((r) => [VK.gateChip(r.c, r.g, { bare: true }), r.c ? VK.caseWho(r.c) : '<span class="muted">No case</span>', esc(r.label), status(r), VK.releaseBtn(r)]),
      { caption: 'Gates waiting for the ' + role, empty: 'No gates are waiting for the ' + role + ' role.' });
    const intro = rows.length
      ? esc(plural(ready, 'gate') + ' ready to release, ' + (rows.length - ready) + ' waiting on something else. A release is a human approval: Operon checks it and records who released it.')
      : esc(ROLE_INFO[role] || '');
    return VK.section('today-approvals', 'Your gate approvals', table, { count: rows.length, intro, actions: '<a href="#approvals">All approvals</a>' });
  }

  function exceptionsBlock(role) {
    const rows = VK.myExceptions(role, { sev: ['S1', 'S2'] });
    const need = (r) => {
      const x = r.x;
      const due = x.sarsDeadline || x.clientDue;
      const lines = [r.need === 'close' ? 'Close as secondary reviewer (resolved by ' + (x.resolvedBy || 'someone else') + ')' : 'Resolve: ' + ((CODE[x.code] || {}).resolution || '')];
      return `<div class="small">${esc(lines[0])}</div>${x.assignee === me().id ? '<div>' + VK.pill('Assigned to you', 'info') + '</div>' : ''}${due ? `<div class="small muted">Due ${VK.date(due)}</div>` : ''}`;
    };
    const table = VK.table([{ label: 'Severity' }, { label: 'Exception' }, { label: 'Case' }, { label: 'Needed' }, { label: '', cls: 'vk-act' }],
      rows.map((r) => [VK.sevChip(r.x.sev), `${VK.codeChip(r.x.code, r.x)} ${esc(r.x.title)}`, r.x.caseId ? VK.caseWho(r.x.caseId) : esc(VK.clientName(r.x.clientId) || 'No case'), need(r), VK.exceptionBtn(r)]),
      { caption: 'S1 and S2 exceptions for the ' + role, empty: 'No S1 or S2 exceptions are assigned to the ' + role + ' role.' });
    return VK.section('today-exceptions', 'S1 and S2 exceptions for your role', table, {
      count: rows.length,
      intro: esc('S1 is a hard stop for the whole case; S2 blocks its gates until resolved. Lower severities are on the Exceptions page.'),
      actions: '<a href="#exceptions">All exceptions</a>',
    });
  }

  function deadlinesBlock() {
    const rows = VK.deadlines({ days: 10 });
    const items = rows.map((d) => `<div class="vk-row">${VK.datebox(d.date)}<div class="vk-row-b">
      <div class="vk-row-t">${esc(d.what)}</div>
      <div class="vk-meta">${d.c ? VK.caseWho(d.c) : ''}${d.codes.length ? `<span class="vk-codes">${d.codes.map((x) => VK.codeChip(x.code, x)).join(' ')}</span>` : ''}</div>
      <div class="vk-meta">${VK.leftPill(d.left)}<span>${VK.dateShort(d.date)}</span>${d.ch9 ? '<span>16 Dec to 15 Jan not counted</span>' : ''}</div></div></div>`);
    return VK.section('today-deadlines', 'Deadlines in the next 10 business days', VK.list(items, { empty: 'Nothing is due in the next 10 business days.' }), {
      count: rows.length,
      intro: esc('Business days skip weekends and South African public holidays. Overdue items stay until they are done.'),
      actions: '<a href="#deadlines">All deadlines</a>',
    });
  }

  function portalBlock() {
    const acts = S.audit.filter((a) => a.role === 'Client').slice(-PORTAL_N).reverse();
    const items = acts.map((a) => `<div class="vk-row vk-row-log"><span class="vk-when">${VK.when(a.at)}</span><div class="vk-row-b">
      <div class="vk-row-t">${esc(VK.scrub(a.text))}${a.result === 'Refused' ? ' ' + VK.pill('Refused', 'bad') : ''}</div>
      <div class="vk-meta">${VK.clientLink(a.who)}${a.caseId ? ' · ' + VK.caseLink(a.caseId) : ''}</div></div></div>`);
    return VK.section('today-portal', 'PaperSync portal activity', VK.list(items, { empty: 'No client activity in the PaperSync portal yet.' }), {
      intro: esc('What clients did in the PaperSync portal, newest first. Clients never sign in to Operon; the portal is simulated here.'),
      actions: '<a href="#papersync">PaperSync</a>',
    });
  }

  function sarsBlock() {
    const items = S.inbound.slice(-INBOUND_N).reverse().map((it) => {
      const cl = S.clients.find((x) => x.taxRef === it.taxRef);
      const routed = it.caseId ? `${VK.pill('Routed', 'ok')} ${VK.caseWho(it.caseId)}` : VK.pill(it.status === 'unrouted' ? 'Not matched to a case' : it.status, 'bad');
      return `<div class="vk-row">${VK.datebox(it.date)}<div class="vk-row-b">
        <div class="vk-row-t">${esc(it.label)} <span class="mono small">${esc(it.ref || it.id)}</span></div>
        <div class="vk-meta">${routed}</div>
        <div class="vk-meta"><span>Received ${VK.date(it.date)}</span>${it.due ? `<span>Due ${VK.date(it.due)}</span>` : ''}<span>Tax ref ${VK.taxRefHtml(it.taxRef)}</span>${cl && !it.caseId ? `<span>${esc(cl.name)}</span>` : ''}</div></div></div>`;
    });
    return VK.section('today-sars', 'SARS inbound', VK.list(items, { empty: 'Nothing has arrived from SARS.' }), {
      count: S.inbound.filter((it) => it.status === 'unrouted').length || null,
      intro: esc('Notices, assessments and requests from SARS, newest first. The SARS link is simulated: nothing here connects to SARS.'),
      actions: '<a href="#sars">SARS link</a>',
    });
  }

  function aiBlock() {
    const since = sod(now()); since.setDate(since.getDate() - 1); since.setHours(18, 0, 0, 0);
    const all = S.audit.filter((a) => a.actor === 'ai');
    const night = all.filter((a) => a.at >= since);
    const row = (a) => `<div class="vk-row vk-row-log"><span class="vk-when">${VK.when(a.at)}</span><div class="vk-row-b">
      <div class="vk-row-t">${esc(VK.scrub(a.text))}${a.result === 'Refused' ? ' ' + VK.pill('Refused', 'bad') : ''}</div>
      ${a.caseId ? `<div class="vk-meta">${VK.caseWho(a.caseId)}</div>` : ''}</div></div>`;
    let body;
    if (night.length) {
      body = VK.list(night.slice(-AI_N).reverse().map(row)) + (night.length > AI_N ? `<p class="small muted">${esc(plural(night.length - AI_N, 'earlier entry', 'earlier entries'))} in the <a href="#audit">audit trail</a>.</p>` : '');
    } else {
      const last = all.slice(-3).reverse();
      body = VK.empty('No AI work ran since 18:00 yesterday (' + fShort(since) + ').', { html: last.length ? '<p class="small muted">Most recent AI work:</p>' + VK.list(last.map(row), { cls: 'vk-list-quiet' }) : '' });
    }
    return VK.section('today-ai', 'Overnight AI work', body, {
      count: night.length,
      intro: esc('What the AI agent did since 18:00 yesterday: checks, extractions, drafts and routing. The AI is simulated; every gate it cannot pass goes to a person.'),
      actions: '<a href="#audit">Audit trail</a>',
    });
  }

  VIEWS.today = () => {
    const role = S.role; const m = me();
    const first = m.name.split(' ')[0];
    const intro = `${esc(role)} · ${esc(FIRM)} · demo clock ${esc(fShort(now()) + ' ' + fTime(now()))}. ` +
      'What is waiting for your role, what is due soon and what came in since yesterday evening. All data is made up; the AI, the PaperSync portal and the SARS link are simulated.';
    return VK.page(greeting() + ', ' + first, intro,
      approvalsBlock(role) + exceptionsBlock(role) +
      `<div class="grid2 vk-grid" data-rv-key="today-columns-dates">${deadlinesBlock()}${sarsBlock()}</div>` +
      `<div class="grid2 vk-grid" data-rv-key="today-columns-activity">${portalBlock()}${aiBlock()}</div>`,
      { key: 'today' });
  };
})();
