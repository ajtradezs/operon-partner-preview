/* Records: Incidents (G17) and one incident, Retention (G16) and the Audit trail.
   Incident steps and closing go through ENGINE.incidentStep and ENGINE.closeIncident (the Information Officer); holds through
   ENGINE.legalHold and ENGINE.releaseHold (the Records/Compliance Owner). Anyone else is refused by ENGINE, which records the
   refusal; the screen shows the reason. The audit trail is read through ENGINE.verifyChain, ENGINE.auditCsv and ENGINE.auditJson. */
(() => {
  const STEPS = ENGINE.INCIDENT_STEPS;
  const stepsDone = (inc) => Object.keys(STEPS).filter((k) => inc.steps[k]).length;
  const incStatus = (inc) => (inc.status === 'open' ? VK.pill('Open', 'bad') : VK.pill('Closed', 'ok'));
  const exRow = (x) => `<div class="adm-exrow"><div class="vk-row-b"><div class="vk-row-t">${VK.codeChip(x.code, x)} ${VK.sevChip(x.sev, { short: true })} ${esc(x.title)}</div>
    <div class="vk-meta">${VK.exStatus(x)}${x.caseId ? VK.caseWho(x.caseId) : ''}<span>${esc(VK.scrub(x.note || ''))}</span></div></div>
    <div class="adm-exact">${x.status === 'closed' ? '' : VK.exceptionBtn({ x, need: ENGINE.isOpen(x) ? 'resolve' : 'close' })}</div></div>`;

  /* ===================== Incidents (G17) ===================== */
  VIEWS.incidents = () => {
    const rows = S.incidents.slice().reverse().map((inc) => [
      `<strong>${VK.link('incident', inc.id)}</strong>`,
      inc.caseId ? VK.caseWho(inc.caseId) : esc(VK.clientName(inc.clientId) || 'No case'),
      `<div class="vk-codes">${inc.codes.map((c, i) => VK.codeChip(c, inc.exceptionIds[i])).join(' ')}</div>`,
      VK.when(inc.opened),
      `${VK.pill(stepsDone(inc) + ' of ' + Object.keys(STEPS).length + ' steps', stepsDone(inc) === Object.keys(STEPS).length ? 'ok' : 'warn')}`,
      incStatus(inc),
      VK.safeId(inc.id) ? `<a class="btn sm" href="#incident-${inc.id}">Open</a>` : '',
    ]);
    const open = S.incidents.filter((i) => i.status === 'open').length;
    const table = VK.section('adm-incidents-list', 'Security and privacy incidents', VK.table([{ label: 'Incident' }, { label: 'Case' }, { label: 'Codes' }, { label: 'Opened' }, { label: 'Steps' }, { label: 'Status' }, { label: '', cls: 'vk-act' }], rows,
      { caption: 'Incidents', empty: 'No incidents have been opened.' }), {
      count: open,
      intro: esc('An S1 security exception (SEC-*) or a wrong-taxpayer upload (DOC-04) opens an incident. While it is open, no SARS transaction on that case can run. The Information Officer records containment, investigation, remediation and the notification assessment, then closes it, which releases G17.'),
    });
    const g = GATE.G17;
    const rule = VK.section('adm-incidents-rule', 'G17: ' + g.control, VK.facts([['Owner', esc(g.owner)], ['Release criterion', esc(g.criterion)], ['Blocking codes', `<span class="vk-codes">${g.codes.map((c) => VK.codeChip(c)).join(' ')}</span>`]]), {});
    return VK.page('Incidents', esc('Privacy and security incidents (G17), handled by the Information Officer under POPIA. All data is made up.'), table + rule, { key: 'adm-incidents' });
  };

  VIEWS.incident = (id) => {
    const inc = ENGINE.incById(String(id || ''));
    if (!inc) return VK.page('Incident not found', esc('There is no incident ' + (id || '') + '. ') + '<a href="#incidents">All incidents</a>', '', { key: 'adm-incident' });
    const facts = VK.facts([
      ['Status', incStatus(inc) + (inc.closed ? ` <span class="small muted">Closed by ${esc(pname(inc.closed.by))}, ${VK.when(inc.closed.at)}</span>` : '')],
      ['Case', inc.caseId ? VK.caseWho(inc.caseId) : '<span class="muted">Not tied to a case</span>'],
      ['Client', inc.clientId ? VK.clientLink(inc.clientId) : '<span class="muted">—</span>'],
      ['Codes', `<span class="vk-codes">${inc.codes.map((c, i) => VK.codeChip(c, inc.exceptionIds[i])).join(' ')}</span>`],
      ['Opened', VK.when(inc.opened)],
      ['SARS transactions', inc.status === 'open' && inc.caseId ? 'Stopped on this case until the incident closes' : 'Not stopped'],
    ]);
    const summary = VK.section('adm-incident-facts', 'Summary', facts, {});
    const stepItems = Object.keys(STEPS).map((k) => {
      const s = inc.steps[k];
      if (s) return `<div class="adm-step done"><div class="adm-step-h">${ADM.yes(STEPS[k])}<span class="small muted">${esc(pname(s.by))} · ${VK.when(s.at)}</span></div><p class="small">${esc(VK.scrub(s.note))}</p></div>`;
      if (inc.status !== 'open') return `<div class="adm-step"><div class="adm-step-h">${ADM.no(STEPS[k])}<span class="small muted">Not recorded</span></div></div>`;
      return `<form class="adm-step" data-form="adm.incStep" data-inc="${esc(inc.id)}" data-step="${esc(k)}" novalidate><div class="adm-step-h"><strong>${esc(STEPS[k])}</strong><span class="small muted">Not recorded yet</span></div>
        <label class="f" for="adm-inc-${esc(k)}">What was done<textarea id="adm-inc-${esc(k)}" name="note" maxlength="1000"></textarea></label>
        <div><button class="btn sm" type="submit">Record ${esc(STEPS[k].toLowerCase())}</button></div></form>`;
    });
    const left = Object.keys(STEPS).filter((k) => !inc.steps[k]).map((k) => STEPS[k]);
    const closeBtn = inc.status === 'open' ? `<div class="adm-gateline"><span class="small">${esc(left.length ? 'Still to record: ' + left.join(', ') + '.' : 'Every step is recorded. Closing releases G17.')}</span>${btn('Close incident and release G17', 'adm.incClose', { cls: 'sm' + (left.length ? '' : ' primary'), data: { inc: inc.id } })}</div>` : '';
    const steps = VK.section('adm-incident-steps', 'G17 steps', `<div class="adm-steps">${stepItems.join('')}</div>${closeBtn}`, {
      intro: esc('Only the Information Officer records steps and closes the incident. Anyone else is refused, and the refusal is recorded in the audit trail.'),
    });
    const xs = inc.exceptionIds.map(ENGINE.exById).filter(Boolean);
    const linked = VK.section('adm-incident-exceptions', 'Linked exceptions', VK.list(xs.map(exRow), { empty: 'No linked exceptions.' }), {
      intro: esc('Closing the incident resolves its SEC-* exceptions. Other codes (for example DOC-04) are resolved on their own.'),
    });
    const idRx = new RegExp('\\b' + inc.id + '\\b');  // INC01 must not match INC010
    const trail = S.audit.filter((a) => idRx.test(String(a.text)) || (a.exceptionId && inc.exceptionIds.includes(a.exceptionId))).slice().reverse();
    const log = VK.section('adm-incident-trail', 'Incident history', VK.list(trail.map(ADM.auditRow), { empty: 'Nothing recorded yet.' }), { count: trail.length, actions: '<a href="#audit">Audit trail</a>' });
    return VK.page('Incident ' + inc.id, esc('A privacy or security incident under G17. ') + '<a href="#incidents">All incidents</a>', summary + steps + `<div class="grid2 vk-grid" data-rv-key="adm-incident-columns">${linked}${log}</div>`, { key: 'adm-incident' });
  };

  /* ===================== Retention (G16) ===================== */
  VIEWS.retention = () => {
    const p = PERIODS.retention;
    const rule = VK.section('adm-retention-rule', 'The retention rule', VK.facts([
      ['Period', esc(plural(S.policy.retentionYears, 'year') + ' from ' + p.from)],
      ['Rule', esc(p.rule) + ' · ' + ADM.extLink(p.src, 'Source')],
      ['Firm policy', VK.pill('Pending Johan', 'warn') + ' ' + esc('A longer firm period is Johan’s call; the preview uses the statutory minimum.')],
      ['At the review date', esc('Operon raises RET-03 and, for each hold still active, RET-01, RET-02 or RET-04. Nothing is deleted automatically.')],
      ['G16', esc(GATE.G16.control + ': ' + GATE.G16.criterion)],
    ]), {});
    const cs = S.cases.filter((c) => c.retention.from || c.retention.holds.length);
    const rows = cs.map((c) => {
      const active = c.retention.holds.filter((h) => !h.released);
      return [VK.caseWho(c), VK.date(c.retention.from), VK.date(c.retention.until), VK.date(c.retention.review),
        active.length ? VK.pill(plural(active.length, 'active hold'), 'warn') : '<span class="muted">None</span>', VK.gateChip(c, 'G16'),
        btn('Add legal hold', 'adm.holdAdd', { cls: 'sm', data: { case: c.id } })];
    });
    const waiting = S.cases.filter((c) => !c.retention.from && !c.archived).length;
    const cases = VK.section('adm-retention-cases', 'Retention periods', VK.table([{ label: 'Case' }, { label: 'Runs from' }, { label: 'Keep until' }, { label: 'Review on' }, { label: 'Holds' }, { label: 'G16' }, { label: '', cls: 'vk-act' }], rows,
      { caption: 'Retention periods by case', empty: 'No return has been submitted yet.' }), {
      count: rows.length,
      intro: esc('A retention period starts when the return is submitted. ' + plural(waiting, 'case is', 'cases are') + ' not submitted yet, so retention has not started for them.'),
    });
    const holds = [];
    S.cases.forEach((c) => c.retention.holds.forEach((h) => holds.push({ c, h })));
    const holdRows = holds.reverse().map(({ c, h }) => [`<span class="mono">${esc(h.id)}</span>`, VK.caseWho(c), `${esc(h.label)}<div class="small muted">${esc({ legal: 'Legal or compliance hold', verification: 'Verification (TAA s32)', audit: 'Audit (TAA s32)', dispute: 'Dispute (TAA s32)' }[h.kind] || h.kind)}</div>`,
      VK.when(h.since), h.released ? `${VK.pill('Released', 'ok')}<div class="small muted">${esc(pname(h.released.by))}, ${VK.when(h.released.at)}</div>` : VK.pill('Active', 'warn'),
      h.released ? '' : btn('Release hold', 'adm.holdRel', { cls: 'sm', data: { case: c.id, hold: h.id } })]);
    const holdSec = VK.section('adm-retention-holds', 'Holds', VK.table([{ label: 'Hold' }, { label: 'Case' }, { label: 'Why' }, { label: 'Since' }, { label: 'Status' }, { label: '', cls: 'vk-act' }], holdRows,
      { caption: 'Retention holds', empty: 'No holds.' }), {
      count: holds.filter(({ h }) => !h.released).length,
      intro: esc('A verification, audit or dispute holds the records until it is concluded (TAA s32). Only the Records/Compliance Owner places a legal hold or releases one; anyone else is refused, and the refusal is recorded.'),
    });
    const ret = S.exceptions.filter((x) => /^RET-/.test(x.code) && x.status !== 'closed');
    const exSec = VK.section('adm-retention-exceptions', 'Retention exceptions', VK.list(ret.map(exRow), { empty: 'No open retention exceptions.' }), { count: ret.length });
    return VK.page('Retention', esc('Record retention and holds (G16). All data is made up.'), rule + cases + `<div class="grid2 vk-grid" data-rv-key="adm-retention-columns">${holdSec}${exSec}</div>`, { key: 'adm-retention' });
  };

  /* ===================== Audit trail ===================== */
  const AF = { actor: 'all', role: 'all', result: 'all', caseId: 'all', q: '', limit: 100 };
  const ACTORS = [['all', 'Everyone'], ['human', 'People and clients'], ['ai', 'AI (simulated)'], ['system', 'Operon and SARS']];
  function filtered() {
    const q = AF.q.trim().toLowerCase();
    return S.audit.filter((a) => (AF.actor === 'all' || a.actor === AF.actor) && (AF.role === 'all' || a.role === AF.role) &&
      (AF.result === 'all' || a.result === AF.result) && (AF.caseId === 'all' || a.caseId === AF.caseId) &&
      (!q || [a.id, VK.scrub(a.text), a.code, a.gate, a.caseId, VK.who(a.who)].some((v) => String(v || '').toLowerCase().includes(q))));
  }
  const distinct = (k) => Array.from(new Set(S.audit.map((a) => a[k]).filter(Boolean))).sort();
  const sel = (id, k, label, opts) => `<label class="f" for="${id}">${esc(label)}<select id="${id}" data-on="adm.af" data-k="${k}">${opts.map(([v, t]) => `<option value="${esc(v)}"${AF[k] === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  VIEWS.audit = () => {
    const v = ENGINE.verifyChain(); const last = S.audit[S.audit.length - 1];
    const integrity = VK.section('adm-audit-integrity', 'Chain check', `${v.ok ? `<p class="vk-okline">${I.check} The chain is intact: ${esc(plural(v.n, 'entry', 'entries'))}, each linked to the one before by its SHA-256 hash.</p>`
      : `<p class="err">${I.alert} The chain is broken at entry ${esc(v.badAt + 1)}: ${esc(v.why)}.</p>`}
      ${VK.facts([['Newest entry', last ? esc(last.id) + ' · ' + VK.when(last.at) : '—'], ['Newest hash', last ? `<span class="hash">${esc(last.hash)}</span>` : '—']])}
      <div class="actions">${btn('Check the chain again', 'adm.verify', { cls: 'sm' })}${btn('Download CSV', 'adm.csv', { cls: 'sm' })}${btn('Download JSON', 'adm.json', { cls: 'sm' })}</div>`, {
      intro: esc('The trail is append-only. Operon recomputes every hash and compares the newest one with a seal kept outside the data, so an edited, shortened or replaced trail is reported. Downloads include identities in full: handle them as client data.'),
    });
    const rows = filtered(); const shown = rows.slice(-AF.limit).reverse();
    const filters = `<div class="filters adm-filters">${sel('adm-af-actor', 'actor', 'Actor', ACTORS)}${sel('adm-af-role', 'role', 'Role', [['all', 'Any role']].concat(distinct('role').map((r) => [r, r])))}
      ${sel('adm-af-result', 'result', 'Result', [['all', 'Any result']].concat(distinct('result').map((r) => [r, r])))}${sel('adm-af-case', 'caseId', 'Case', [['all', 'Any case']].concat(S.cases.map((c) => [c.id, c.id + ' · ' + VK.clientName(c.clientId)])))}
      <label class="f" for="adm-af-q">Search<input id="adm-af-q" class="search" type="search" data-on="adm.afq" value="${esc(AF.q)}" placeholder="Words, code, gate, entry" autocomplete="off"></label>
      <span class="small muted" role="status">${esc(plural(rows.length, 'entry', 'entries') + ' of ' + S.audit.length)}</span></div>`;
    const table = VK.table([{ label: 'When' }, { label: 'Who' }, { label: 'What happened' }, { label: 'Case' }, { label: 'Gate and code' }, { label: 'Entry' }], shown.map((a) => [
      `<span class="vk-when">${VK.when(a.at)}</span>`,
      `${esc(VK.who(a.who))}<div class="small muted">${esc(a.role || a.actor)}</div>`,
      `${esc(VK.scrub(a.text))}${a.result && a.result !== 'Done' ? ' ' + VK.pill(a.result, a.result === 'Refused' ? 'bad' : '') : ''}${a.reason && a.result !== 'Refused' ? `<div class="small muted">Reason: ${esc(VK.scrub(a.reason))}</div>` : ''}${a.evidence ? `<div class="small muted">Evidence: ${esc(VK.scrub(a.evidence))}</div>` : ''}`,
      a.caseId ? VK.caseLink(a.caseId) : (a.client ? VK.clientLink(a.client) : '<span class="muted">—</span>'),
      `${a.gate ? `<span class="vk-gate vk-g-idle"><b>${esc(a.gate)}</b></span> ` : ''}${a.code ? VK.codeChip(a.code, a.exceptionId) : ''}`,
      `<span class="mono small">${esc(a.id)}</span><div class="hash" title="${esc(a.hash)}">${esc(a.hash.slice(0, 12))}…</div>`,
    ]), { caption: 'Audit trail entries, newest first', empty: 'No entry matches these filters.' });
    const more = rows.length > shown.length ? `<div class="adm-more-btn">${btn('Show ' + Math.min(100, rows.length - shown.length) + ' more', 'adm.more', { cls: 'sm' })}</div>` : '';
    const trail = VK.section('adm-audit-trail', 'Entries', filters + table + more, { count: rows.length, intro: esc('Newest first. ID numbers and tax references in the text are masked on screen.') });
    const fields = VK.section('adm-audit-fields', 'What every entry records', `<ul class="adm-items">${AUDIT_ITEMS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul><p class="small muted">Fields in the export: <span class="mono">${esc(AUDIT_FIELDS.join(', '))}</span></p>`, {
      intro: esc('From the master document, Phase 20 (audit trail).'),
    });
    return VK.page('Audit trail', esc('Every action, approval, refusal and AI step, hash-chained so nothing can be changed quietly. All data is made up; the AI and the SARS link are simulated.'), integrity + trail + fields, { key: 'adm-audit' });
  };

  /* ===================== Actions ===================== */
  const stamp = () => ENGINE.isoDay(now()).replace(/-/g, '');
  Object.assign(FORMS, {
    'adm.incStep': (f) => {
      const inc = ENGINE.incById(f.dataset.inc); const k = f.dataset.step;
      if (!inc || !STEPS[k]) { toast('That incident is no longer here.'); render(); return; }
      const note = String(f.elements.note.value || '').trim();
      if (!note) { toast('Write what was done first.'); return; }
      VK.done(ENGINE.incidentStep(inc, k, ACTOR.me(), { note }), STEPS[k] + ' recorded for ' + inc.id + '.');
    },
  });
  Object.assign(ACT, {
    'adm.incClose': (t) => {
      const inc = ENGINE.incById(t.dataset.inc); if (!inc) { toast('That incident is no longer here.'); render(); return; }
      modal('Close ' + inc.id, `<p>Close the incident and release G17? Closing resolves its SEC-* exceptions, and SARS transactions on the case can run again.</p>
        <p class="hint">You close it as ${esc(S.role)} (${esc(me().name)}). Only the Information Officer can.</p>`, 'Close incident', () => ADM.finish(ENGINE.closeIncident(inc, ACTOR.me()), 'Closed ' + inc.id + ' and released G17.'));
    },
    'adm.holdAdd': (t) => {
      const c = ENGINE.caseById(t.dataset.case); if (!c) { toast('That case is no longer here.'); render(); return; }
      modal('Legal hold on ' + c.id, `<p>A legal or compliance hold keeps every record of ${esc(c.id)} past its review date until it is released.</p>
        <label class="f" for="adm-hold-label">Why (required)<input id="adm-hold-label" name="label" maxlength="200" autocomplete="off"></label>
        <p class="hint">Only the Records/Compliance Owner can place a legal hold.</p>`, 'Place hold', (fd) => {
        const label = String(fd.label || '').trim(); if (!label) return 'Say why the hold is needed.';
        return ADM.finish(ENGINE.legalHold(c, ACTOR.me(), label), 'Legal hold placed on ' + c.id + '.');
      });
    },
    'adm.holdRel': (t) => {
      const c = ENGINE.caseById(t.dataset.case); const h = c && c.retention.holds.find((x) => x.id === t.dataset.hold);
      if (!h) { toast('That hold is no longer here.'); render(); return; }
      modal('Release hold ' + h.id, `<p>Release “${esc(h.label)}” on ${esc(c.id)}? Retention is then reassessed.</p><p class="hint">Only the Records/Compliance Owner can release a hold.</p>`,
        'Release hold', () => ADM.finish(ENGINE.releaseHold(c, h.id, ACTOR.me()), 'Released hold ' + h.id + '.'));
    },
    'adm.verify': () => { const v = ENGINE.verifyChain(); toast(v.ok ? 'The chain is intact: ' + plural(v.n, 'entry', 'entries') + '.' : 'The chain is broken at entry ' + (v.badAt + 1) + ': ' + v.why + '.'); render(); },
    'adm.csv': () => { ADM.download('operon-demo-audit-trail-' + stamp() + '.csv', ENGINE.auditCsv(), 'text/csv;charset=utf-8'); toast('Audit trail downloaded as CSV.'); },
    'adm.json': () => { ADM.download('operon-demo-audit-trail-' + stamp() + '.json', ENGINE.auditJson(), 'application/json'); toast('Audit trail downloaded as JSON.'); },
    'adm.more': () => { AF.limit += 100; render(); },
  });
  EXT_FIELD['adm.af'] = (el) => { const k = el.dataset.k; if (['actor', 'role', 'result', 'caseId'].includes(k)) { AF[k] = String(el.value); AF.limit = 100; } };
  EXT_FIELD['adm.afq'] = (el) => { AF.q = String(el.value || '').slice(0, 80); AF.limit = 100; };
})();
