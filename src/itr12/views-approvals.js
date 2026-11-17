/* Approvals: every gate waiting for the signed-in role (this replaces the old sign-off and lodge trays), the G18 two-person
   sign-offs on the simulated SARS link, and the severity and override requests the Records/Compliance Owner approves.
   Read-only: releases and G18 sign-offs use the kit's shared actions (ACT 'vk.release'); the request buttons use 'ops.sevOk' and
   'ops.ovOk' (views-exceptions.js), which call ENGINE with ACTOR.me(). */
(() => {
  const G18_ROLES = RELEASE.G18.roles;

  // Who releases a gate, in plain words (RELEASE in workflow.js).
  function releaser(g) {
    const r = RELEASE[g];
    switch (r.by) {
      case 'client': return 'The client, in the PaperSync portal (simulated)';
      case 'system': return 'Operon itself, when its checks pass';
      case 'ai': return 'The AI check with the independent reviewer (both simulated); otherwise the ' + r.role;
      case 'dual': return 'Two people: the ' + r.roles.join(' and the ');
      default: return 'The ' + r.role;
    }
  }
  const releasedBy = (g, role) => { const r = RELEASE[g]; return r.role === role || (r.roles || []).includes(role); };

  // What still stands between a gate and its release: blocking exceptions, then unmet criteria, then anything else canRelease says.
  function leftCell(r) {
    if (r.kind === 'incident') {
      return r.ready ? `<p class="vk-okline">${I.check} Every step is recorded</p>`
        : `<div class="small">Still to record:</div><ul class="ops-miss">${r.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`;
    }
    const bl = ENGINE.gateBlockers(r.c, r.g); const miss = ENGINE.criteria(r.c, r.g);
    if (r.ready) return `<p class="vk-okline">${I.check} Criteria met; nothing blocks it</p>`;
    const parts = [];
    if (bl.length) parts.push(`<div class="small">Blocked by</div><div class="vk-codes">${bl.map((x) => VK.codeChip(x.code, x) + VK.sevChip(x.sev, { short: true })).join(' ')}</div>`);
    if (miss.length) parts.push(`<div class="small">Not met yet</div><ul class="ops-miss">${miss.map((m) => `<li>${esc(VK.scrub(m))}</li>`).join('')}</ul>`);
    if (!parts.length && r.why) parts.push(`<div class="small">${esc(VK.scrub(r.why))}</div>`);
    return parts.join('');
  }

  function gatesBlock(role) {
    const rows = VK.waitingGates(role).filter((r) => r.kind !== 'g18');
    const ready = rows.filter((r) => r.ready).length;
    const caseCell = (r) => {
      if (!r.c) return '<span class="muted">No case</span>';
      const ai = RELEASE[r.g] && RELEASE[r.g].by === 'ai' && r.c.gates[r.g] && r.c.gates[r.g].routed ? `<div class="small muted">The AI check routed it to you (simulated)</div>` : '';
      return VK.caseWho(r.c) + ai;
    };
    const what = (r) => `<strong>${esc(r.kind === 'incident' ? r.label : VK.gateName(r.g))}</strong><div class="small muted">Release when: ${esc(GATE[r.g].criterion || '')}</div>`;
    const table = VK.table([{ label: 'Gate' }, { label: 'Case' }, { label: 'What it approves' }, { label: 'Still to do' }, { label: '', cls: 'vk-act' }],
      rows.map((r) => ({ cls: r.ready ? 'ops-ready' : '', cells: [r.c ? VK.gateChip(r.c, r.g) : `<span class="vk-gate vk-g-prog"><b>${esc(r.g)}</b> Open</span>`, caseCell(r), what(r), leftCell(r), VK.releaseBtn(r)] })),
      { caption: 'Gates waiting for the ' + role, empty: 'No gates are waiting for the ' + role + ' role.' });
    const intro = rows.length
      ? esc(plural(ready, 'gate') + ' ready to release, ' + (rows.length - ready) + ' waiting on something else. The criteria and blockers come from the gate engine; releasing is a human approval and goes in the audit trail.')
      : esc('Nothing is waiting for the ' + role + ' role. ' + (ROLE_INFO[role] || ''));
    return VK.section('ops-approvals-gates', 'Gates waiting for you', table, { count: rows.length, intro });
  }

  function g18Block(role) {
    const txs = S.txs.filter((t) => t.status === 'awaiting G18');
    const mine = G18_ROLES.includes(role);
    const signed = (t) => G18_ROLES.map((rl) => {
      const s = t.signoffs.find((x) => x.role === rl);
      return `<div class="small">${s ? I.check + ' ' : ''}<span class="muted">${esc(rl)}:</span> ${s ? esc(VK.who(s.id)) + ' · ' + VK.when(s.at) : 'not yet'}</div>`;
    }).join('');
    const checks = (t) => {
      const ck = ENGINE.g18Checks(t); const bad = ck.filter((k) => !k.ok); const gb = ENGINE.g18Blockers(t);
      return `${VK.pill(ck.length - bad.length + ' of ' + ck.length + ' checks pass', bad.length ? 'bad' : 'ok')}${bad.map((k) => `<div class="small">${esc(k.n + '. ' + VK.scrub(k.why))}</div>`).join('')}${gb.length ? `<div class="small err">Blocked by ${esc(gb.join(', '))}</div>` : ''}`;
    };
    const act = (t) => {
      if (!mine) return `<span class="lock">${I.lock}${esc('The Integration Administrator and the Tax Consultant sign')}</span>`;
      const me0 = t.signoffs.find((s) => s.role === role);
      if (me0) { const other = G18_ROLES.find((r) => r !== role); return `<span class="lock">${I.hourglass}${esc('You signed. The ' + other + ' signs next.')}</span>`; }
      const ok = !ENGINE.g18Checks(t).some((k) => !k.ok) && !ENGINE.g18Blockers(t).length;
      return btn('Sign G18', 'vk.release', { cls: 'sm' + (ok ? ' primary' : ''), data: { case: t.caseId, gate: 'G18', tx: t.id } });
    };
    const table = VK.table([{ label: 'Transaction' }, { label: 'Case' }, { label: 'Signed so far' }, { label: 'The 8 G18 checks' }, { label: '', cls: 'vk-act' }],
      txs.map((t) => [`<span class="mono">${esc(t.id)}</span> ${esc(t.label)}<div class="small muted">Version ${esc(t.version)} · queued ${VK.when(t.created)}</div>`, VK.caseWho(t.caseId), signed(t), checks(t), act(t)]),
      { caption: 'SARS transactions awaiting the G18 two-person sign-off', empty: 'No SARS transaction is waiting for a G18 sign-off.' });
    return VK.section('ops-approvals-g18', 'G18 two-person sign-off', table, {
      count: txs.length,
      intro: esc('Every outbound SARS transaction needs two different people: the Integration Administrator and the Tax Consultant. Each signs only when all eight checks pass. The SARS link is simulated: nothing is sent to SARS.'),
      actions: '<a href="#sars">SARS link</a>',
    });
  }

  function requestsBlock(role) {
    const rco = role === 'Records/Compliance Owner';
    const rows = [];
    S.exceptions.forEach((x) => {
      if (x.sevRequest && x.sevRequest.status === 'pending') rows.push({ kind: 'sev', x, by: x.sevRequest.by, at: x.sevRequest.at, reason: x.sevRequest.reason, what: 'Lower ' + x.sevRequest.from + ' to ' + x.sevRequest.to });
      if (x.override && x.override.status === 'requested') rows.push({ kind: 'ov', x, by: x.override.requestedBy, at: x.override.at, reason: x.override.reason, evidence: x.override.evidence, what: 'Override on version ' + x.override.version });
    });
    rows.sort((p, q) => p.at - q.at);
    const act = (r) => {
      if (!rco) return `<span class="lock">${I.hourglass}${esc('Waiting for the Records/Compliance Owner')}</span>`;
      if (r.kind === 'sev') return `<span class="ops-btns">${btn('Approve', 'ops.sevOk', { cls: 'sm primary', data: { ex: r.x.id, v: '1' } })}${btn('Decline', 'ops.sevOk', { cls: 'sm', data: { ex: r.x.id, v: '0' } })}</span>`;
      return btn('Approve override', 'ops.ovOk', { cls: 'sm primary', data: { ex: r.x.id } });
    };
    const table = VK.table([{ label: 'Request' }, { label: 'Exception' }, { label: 'Case' }, { label: 'Asked by' }, { label: 'Reason' }, { label: '', cls: 'vk-act' }],
      rows.map((r) => [esc(r.what), `${VK.codeChip(r.x.code, r.x)} ${VK.sevChip(r.x.sev, { short: true })} ${VK.exLink(r.x)}`, r.x.caseId ? VK.caseWho(r.x.caseId) : '<span class="muted">No case</span>',
        `${esc(VK.who(r.by))}<div class="small muted">${VK.when(r.at)}</div>`, `${esc(VK.scrub(r.reason))}${r.evidence ? `<div class="small muted">Evidence: ${esc(VK.scrub(r.evidence))}</div>` : ''}`, act(r)]),
      { caption: 'Severity and override requests', empty: 'No severity or override request is waiting.' });
    return VK.section('ops-approvals-requests', 'Severity and override requests', table, {
      count: rows.length,
      intro: esc('Lowering an S1 or S2 severity, and overriding an S2 exception, need the Records/Compliance Owner’s approval, and the approver must not be the person who asked. ' +
        (S.policy.overridable.length ? '' : 'No S2 code is on the override list yet (pending Johan), so override requests are refused.')),
    });
  }

  function whoBlock(role) {
    const items = GATE_IDS.map((g) => `<div class="vk-row ops-who${releasedBy(g, role) ? ' ops-mine' : ''}"><span class="vk-gate vk-g-idle"><b>${esc(g)}</b></span><div class="vk-row-b">
      <div class="vk-row-t">${esc(VK.gateName(g))}</div><div class="vk-meta"><span>${esc(releaser(g))}</span>${releasedBy(g, role) ? VK.pill('Your role', 'info') : ''}</div></div></div>`);
    return VK.section('ops-approvals-who', 'Who releases each gate', VK.list(items, { cls: 'ops-wholist' }), {
      intro: esc('No AI or system may release G09. The client gates pass only through the client’s own PaperSync portal action, and a client’s silence is never approval.'),
    });
  }

  VIEWS.approvals = () => {
    const role = S.role;
    const intro = `${esc(role)} · ${esc(me().name)}. ` + esc('Every gate waiting for your role, with its criteria and what still blocks it. This replaces the old sign-off and lodge trays.');
    return VK.page('Approvals', intro, gatesBlock(role) + g18Block(role) + requestsBlock(role) + whoBlock(role), { key: 'ops-approvals' });
  };
})();
