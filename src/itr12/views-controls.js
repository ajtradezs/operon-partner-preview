/* Controls: the gate register and its release rules, the severity and override rules, the policy values pending Johan (the
   Records/Compliance Owner keeps the override list through ENGINE.setOverridable), how the gates map onto Operon's tiers, the
   segregation of duties, the role labels, the ruleset versions with every source, Johan's implementation checklist, a read-only
   viewer for the five register sheets and the Questions for Johan. Everything here reads configuration and S; nothing else changes. */
(() => {
  const UI = { sheet: 'codes', fam: 'all', q: '' };
  const chips = (codes) => `<span class="vk-codes">${codes.map((c) => VK.codeChip(c)).join(' ')}</span>`;
  const pct = (v) => (Math.round(v * 1000) / 10) + '%';
  const rand = (n) => CALC.rand(n).replace(/\.00$/, '');

  /* ---------- Tiers ---------- */
  const tierOf = (g) => { const r = RELEASE[g] || {}; return r.by === 'system' ? 'auto' : (r.by === 'ai' ? 'hold' : 'held'); };
  function tiersBlock() {
    const gatesOf = (t) => GATE_IDS.filter((g) => tierOf(g) === t);
    const rows = [
      [tierBadge('auto'), esc('AI processing: reading documents, extracting values, the four-source checklist, drafting responses, routing exceptions. Operon itself freezes the approved version (G07).'), gatesOf('auto').map((g) => `<span class="vk-gate vk-g-idle"><b>${esc(g)}</b></span>`).join(' ')],
      [tierBadge('hold'), esc('The AI gates pass only when nothing blocks and the independent reviewer agrees; otherwise they wait for the Tax Consultant.'), gatesOf('hold').map((g) => `<span class="vk-gate vk-g-idle"><b>${esc(g)}</b></span>`).join(' ')],
      [tierBadge('held'), esc('Every other gate approval is a person (or the client in the PaperSync portal). G09 is never released by the system or the AI. G18 needs two different people.'), gatesOf('held').map((g) => `<span class="vk-gate vk-g-idle"><b>${esc(g)}</b></span>`).join(' ')],
      [tierBadge('forbidden'), `<ul class="adm-items">${[
        'Releasing a gate while a blocking exception mapped to it is open',
        'Overriding an S1, or any code that would bypass missing taxpayer authority, a security control, SARS-interface authorisation or a statutory hold',
        'The AI lowering an S1 or S2 severity',
        'Staff dragging a case past a client gate (G03, G06, G14)',
        'Retrying a SARS transaction whose status is unknown before it is reconciled',
        'One person signing both halves of G18, or approving their own override',
      ].map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`, '<span class="muted">Every attempt is refused and recorded</span>'],
    ];
    return VK.section('adm-controls-tiers', 'How the gates map onto Operon’s tiers', VK.table([{ label: 'Tier' }, { label: 'What it covers' }, { label: 'Gates' }], rows, { caption: 'Operon tiers for the ITR12 workflow' }), {
      intro: esc('AI processing is Auto, gate approvals are Held for a person, and bypasses are Forbidden. The AI is simulated in the preview.'),
    });
  }

  /* ---------- Gate register ---------- */
  const releaseText = (g) => {
    const r = RELEASE[g] || {};
    if (r.by === 'role') return r.role;
    if (r.by === 'ai') return 'AI check, with the independent reviewer; ' + r.role + ' for exceptions';
    if (r.by === 'client') return 'The client, in the PaperSync portal';
    if (r.by === 'system') return 'Operon only';
    if (r.by === 'dual') return 'Two people: ' + r.roles.join(' and ');
    return '';
  };
  function gatesBlock() {
    const rows = GATE_IDS.map((g) => {
      const G = GATE[g];
      return [`<span class="vk-gate vk-g-idle"><b>${esc(g)}</b></span>`, `<strong>${esc(G.control)}</strong><div class="small muted">${esc(G.box ? 'Phase ' + G.box.phase + ': ' + G.box.phaseTitle : 'Runs alongside the case')}</div>`,
        esc(G.owner), `<span class="small">${esc(G.criterion)}</span>`, `${esc(releaseText(g))}<div>${tierBadge(tierOf(g))}</div>`, chips(G.codes || [])];
    });
    return VK.section('adm-controls-gates', 'Gate register (G01 to G18)', VK.table([{ label: 'Gate' }, { label: 'Control' }, { label: 'Owner' }, { label: 'Release criterion' }, { label: 'Who releases it' }, { label: 'Blocking codes' }], rows,
      { caption: 'The approval gate register' }), {
      count: GATE_IDS.length,
      intro: esc('From the register’s Gate Map and the master document’s gate boxes. Where the two differ, the register wins (see Questions for Johan).'),
    });
  }

  /* ---------- Severity and override rules ---------- */
  function severityBlock() {
    const sevRows = SEV.map((s) => { const r = REGISTER.instructions.find((x) => x[0] === SEV_LABEL[s]); return [VK.sevChip(s), esc(r ? r[1] : ''), esc(plural(REGISTER.codes.filter((c) => c.severity.startsWith(s)).length, 'code'))]; });
    const rules = (WORKFLOW.sections.find((s) => s.title === 'Gate release and override rules') || { bullets: [] }).bullets;
    const fam = Object.entries(NEVER_OVERRIDE.families).map(([f, why]) => `<li><span class="vk-code">${esc(f)}-*</span> ${esc(why)}</li>`).join('');
    const body = VK.table([{ label: 'Severity' }, { label: 'Meaning' }, { label: 'Codes' }], sevRows, { caption: 'Severity levels' }) +
      `<h3 class="adm-h3">Gate release and override rules</h3><ul class="adm-items">${rules.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <h3 class="adm-h3">Never overridden</h3><ul class="adm-items"><li>Missing taxpayer authority: ${chips(NEVER_OVERRIDE.authority)}</li><li>Security controls: ${chips(NEVER_OVERRIDE.security)}</li>${fam}</ul>
      <h3 class="adm-h3">Cleared only by the client in the PaperSync portal</h3><p>${chips(PORTAL_ONLY)}</p>
      <h3 class="adm-h3">Cleared by passing their own gate</h3><p>${chips(BY_GATE)}</p>`;
    return VK.section('adm-controls-severity', 'Severity and override rules', body, {
      intro: esc('Severity meanings from the register’s Instructions sheet; the rules verbatim from the master document.'),
    });
  }

  /* ---------- Policy values pending Johan ---------- */
  const POLICY_LABEL = {
    overridable: ['S2 codes that may be overridden', (v) => (v.length ? v.join(', ') : 'None')],
    warnDays: ['Deadline warning window', (v) => plural(v, 'business day') + ' before'],
    materiality: ['Materiality (DOC-02, ASM-02, TAX-05)', (v) => rand(v.amount) + ', or a ' + pct(v.ratio) + ' change on last year'],
    aiConfidence: ['AI confidence threshold (AI-01)', (v) => 'Below ' + pct(v)],
    reminderDays: ['Reminder lapses after (CLT-01, CLT-05)', (v) => plural(v.onboarding, 'day') + ' for onboarding, ' + plural(v.approval, 'day') + ' for approval'],
    retentionYears: ['Retention period', (v) => plural(v, 'year') + ' (the statutory minimum)'],
  };
  function policyBlock() {
    const rows = POLICY_PENDING.map((k) => {
      const [label, fmt] = POLICY_LABEL[k] || [k, (v) => JSON.stringify(v)];
      const cur = S.policy[k]; const changed = JSON.stringify(cur) !== JSON.stringify(POLICY0[k]);
      const val = k === 'overridable' ? (cur.length ? `<div class="vk-codes">${cur.map((c) => `${VK.codeChip(c)} ${btn('Remove', 'adm.ovOff', { cls: 'sm ghost', data: { code: c }, title: 'Remove ' + c + ' from the override list' })}`).join(' ')}</div>` : '<span class="muted">None</span>') : esc(fmt(cur));
      return [esc(label), val, `${VK.pill('Pending Johan', 'warn')}${changed ? `<div class="small muted">Default: ${esc(fmt(POLICY0[k]))}</div>` : ''}`];
    });
    const eligible = Object.keys(CODE).filter((c) => !ENGINE.eligibleWhy(c) && !S.policy.overridable.includes(c));
    const form = `<form data-form="adm.ovAdd" class="adm-inline" novalidate><label class="f" for="adm-ov-code">Allow overrides of an S2 code<select id="adm-ov-code" name="code">${eligible.map((c) => `<option value="${esc(c)}">${esc(c + ': ' + CODE[c].title)}</option>`).join('')}</select></label>
      <button class="btn" type="submit"${eligible.length ? '' : ' disabled'}>Allow</button></form>
      <p class="hint">Only the Records/Compliance Owner changes the override list. Anyone else is refused, and the refusal is recorded. Codes that may never be overridden are not offered.</p>`;
    return VK.section('adm-controls-policy', 'Policy values pending Johan', VK.table([{ label: 'Policy' }, { label: 'Value in the preview' }, { label: 'Status' }], rows, { caption: 'Policy values Johan has not set yet' }) + form, {
      intro: esc('Johan’s files leave these open, so the preview uses conservative defaults. Removing a code from the override list cancels the overrides already approved for it.'),
    });
  }

  /* ---------- Questions for Johan ---------- */
  function questionsBlock() {
    const items = PENDING_JOHAN.map((q, i) => `<div class="adm-q"><span class="adm-qn">${i + 1}</span><div class="vk-row-b"><div class="vk-row-t">${esc(q.topic)}</div><p class="small">${esc(q.text)}</p></div></div>`);
    return VK.section('adm-controls-questions', 'Questions for Johan', VK.list(items), {
      count: PENDING_JOHAN.length,
      intro: esc('Choices the preview made where Johan’s two files differ or leave something open. Each needs his answer before the build goes live.'),
    });
  }

  /* ---------- Segregation of duties ---------- */
  const SOD_COLS = ['Tax Consultant', 'Administrator', 'Integration Administrator', 'Information Officer', 'Records/Compliance Owner', 'Client', 'AI or Operon'];
  function sodCells(g) {
    const r = RELEASE[g] || {}; const out = SOD_COLS.map(() => '');
    const put = (col, t) => { out[SOD_COLS.indexOf(col)] = t; };
    if (r.by === 'role') put(r.role, 'Releases');
    if (r.by === 'ai') { put('AI or Operon', 'Passes (simulated AI)'); put(r.role, 'Clears exceptions'); }
    if (r.by === 'client') put('Client', 'Approves (portal)');
    if (r.by === 'system') put('AI or Operon', 'Operon only');
    if (r.by === 'dual') r.roles.forEach((x) => put(x, 'Signs (a different person)'));
    return out;
  }
  function sodBlock() {
    const cell = (t) => (t ? `<strong>${esc(t)}</strong>` : '<span class="muted" aria-label="No part">—</span>');
    const rows = GATE_IDS.map((g) => [`<span class="vk-gate vk-g-idle"><b>${esc(g)}</b></span>`].concat(sodCells(g).map(cell)));
    rows.push([esc('Override approval')].concat(SOD_COLS.map((c) => cell(c === 'Records/Compliance Owner' ? 'Approves (not the requester)' : (c === 'Tax Consultant' ? 'Requests' : '')))));
    rows.push([esc('Lowering S1 or S2')].concat(SOD_COLS.map((c) => cell(c === 'Records/Compliance Owner' ? 'Approves (not the requester)' : (c === 'AI or Operon' ? 'May raise, never lower' : '')))));
    const table = VK.table([{ label: 'Gate' }].concat(SOD_COLS.map((c) => ({ label: c }))), rows, { caption: 'Segregation-of-duties matrix', cls: 'adm-matrix' });
    return VK.section('adm-controls-sod', 'Segregation of duties', `<ul class="adm-items">${SOD.map((s) => `<li>${esc(s.text)}</li>`).join('')}</ul>` + table, {
      intro: esc('The engine enforces each rule and records every refusal. Who may do what at each gate:'),
      actions: '<a href="#people">People &amp; roles</a>',
    });
  }

  /* ---------- Roles and the label map ---------- */
  function rolesBlock() {
    const roleRows = ROLES.map((r) => [`<strong>${esc(r)}</strong><div class="small muted">${esc(pname(ME_BY_ROLE[r]))} in the demo</div>`, `<span class="small">${esc(ROLE_INFO[r])}</span>`]);
    const map = (list) => VK.table([{ label: 'In Johan’s file' }, { label: 'Shown in the preview' }, { label: 'Times' }], list.map((m) => [esc(m.from), esc(m.to), esc(m.count)]), { caption: 'Role and label map' });
    return VK.section('adm-controls-roles', 'Roles and the label map', VK.table([{ label: 'Role' }, { label: 'What it owns' }], roleRows, { caption: 'Roles in the preview' }) +
      `<h3 class="adm-h3">Exception register</h3>${map(roleLabelMap())}<h3 class="adm-h3">Master workflow document</h3>${map(WORKFLOW.labelMap)}`, {
      intro: esc('Labels are firm-neutral. The firm prefix in Johan’s labels shows as [firm]; the preview replaces each label as listed. The client never signs in to Operon: the client acts only through the PaperSync portal.'),
    });
  }

  /* ---------- Rulesets ---------- */
  function rulesetsBlock() {
    const srcs = (r, k) => (r.src[k] || []).map((s) => (RULESET_SRC[s] ? ADM.extLink(RULESET_SRC[s].url, RULESET_SRC[s].title) : esc(s))).join('<br>');
    const cards = Object.keys(RULESETS).map((v) => {
      const r = RULESETS[v]; const active = S.rulesetVersion === v;
      const vals = [
        ['brackets', 'Tax brackets', r.brackets.map(([lo, rate]) => rand(lo) + '+: ' + pct(rate)).join('; ')],
        ['rebates', 'Rebates', 'Primary ' + rand(r.rebates.primary) + '; secondary ' + rand(r.rebates.secondary) + ' (65+); tertiary ' + rand(r.rebates.tertiary) + ' (75+)'],
        ['mtc', 'Medical tax credits (per month)', rand(r.mtc.main) + ' main member; ' + rand(r.mtc.first) + ' first dependant; ' + rand(r.mtc.additional) + ' each further dependant'],
        ['s6b', 'Additional medical expenses credit (s6B)', pct(r.s6b.rate) + ' (' + pct(r.s6b.rateSenior) + ' from 65 or with a disability); credits multiple ' + r.s6b.multiple + ' (' + r.s6b.multipleSenior + '); floor ' + pct(r.s6b.floor) + ' of taxable income'],
        ['interestExemption', 'Interest exemption', rand(r.interestExemption.under65) + ' under 65; ' + rand(r.interestExemption.over65) + ' from 65'],
        ['s11f', 'Retirement fund deduction (s11F)', pct(r.s11f.rate) + ', capped at ' + rand(r.s11f.cap)],
        ['cgt', 'Capital gains', 'Annual exclusion ' + rand(r.cgt.exclusion) + '; inclusion rate ' + pct(r.cgt.inclusion)],
        ['s18a', 'Donations (s18A)', pct(r.s18a.rate) + ' of taxable income'],
      ];
      const status = active ? VK.pill('In use', 'ok') : VK.pill(v === '2027.1' ? 'Loaded only to show a wrong-year ruleset (TAX-06)' : 'Not in use', '');
      return `<div class="adm-ruleset"><h3 class="adm-h3">Ruleset ${esc(v)} ${status}</h3><p class="small muted">${esc('Year of assessment ' + r.year + ' (' + r.period + '). Checked against the sources on ' + r.checked + '.')}</p>
        ${VK.table([{ label: 'Value' }, { label: 'Setting' }, { label: 'Sources' }], vals.map(([k, l, t]) => [esc(l), `<span class="small">${esc(t)}</span>`, `<span class="small">${srcs(r, k)}</span>`]), { caption: 'Ruleset ' + v })}</div>`;
    }).join('');
    return VK.section('adm-controls-rulesets', 'Ruleset versions and sources', cards, {
      intro: esc('Every figure the calculator uses, with the version it belongs to and where it comes from. Each calculation records its ruleset version; a change mid-case raises VER-02 and a wrong-year ruleset raises TAX-06.'),
    });
  }

  /* ---------- Johan's implementation checklist ---------- */
  const WHERE = [
    ['Clients and Cases', '#clients', 'In the preview', 'The permanent client master and KYC repository (Clients) are kept apart from the annual ITR12 cases (Cases).'],
    ['Gate register above; Cases board', '#cases', 'In the preview', 'G01 to G18 with their release rules; the board moves a case only when its gate releases.'],
    ['Register viewer below', '#controls', 'In the preview', 'Generated read-only from the workbook, with its SHA-256 hash.'],
    ['Exceptions', '#exceptions', 'In the preview', 'Related and parent exceptions are linked, for example DOC-04 with SEC-01.'],
    ['People & roles; segregation of duties above', '#people', 'In the preview', 'Five firm roles; the engine refuses and records any action outside a role.'],
    ['Case page: versions', '#cases', 'In the preview', 'SHA-256 hashes for documents, calculation, schedules and the ITR12 on every version.'],
    ['SARS link', '#sars', 'Simulated', 'An unknown status (INT-04) blocks a retry until SARS’s status is checked.'],
    ['Deadlines', '#deadlines', 'In the preview', 'Filing season, Declaration Alert, verification and remedy dates, with the business-day calculator.'],
    ['Retention', '#retention', 'In the preview', 'Retention starts at submission; holds and their release are recorded.'],
    ['Audit trail', '#audit', 'In the preview', 'Hash-chained, append-only events with a chain check and CSV or JSON export.'],
    ['SARS link', '#sars', 'Waiting on SARS', 'No formal SARS interface specification is available yet. The preview assumes the approved functions and raises INT-08 for any other.'],
  ];
  function checklistBlock() {
    const items = (WORKFLOW.sections.find((s) => s.title === 'Implementation checklist') || { bullets: [] }).bullets;
    const rows = items.map((t, i) => { const w = WHERE[i] || ['', '', 'Not mapped', '']; const tone = w[2] === 'In the preview' ? 'ok' : (w[2] === 'Simulated' ? 'info' : 'warn');
      return [esc(t), w[1] ? `<a href="${w[1]}">${esc(w[0])}</a>` : '', `${VK.pill(w[2], tone)}<div class="small">${esc(w[3])}</div>`]; });
    return VK.section('adm-controls-checklist', 'Johan’s implementation checklist', VK.table([{ label: 'Checklist item' }, { label: 'Where it lives' }, { label: 'Status' }], rows, { caption: 'Implementation checklist mapped to the preview' }), {
      count: items.length, intro: esc('The checklist from the master document, item by item, and where each one lives in the preview.'),
    });
  }

  /* ---------- Read-only register viewer ---------- */
  const SHEETS = [['codes', 'Exception Register'], ['gates', 'Gate Map'], ['stages', 'Stage Map'], ['audit', 'Code Audit'], ['instructions', 'Instructions']];
  function sheetBody() {
    if (UI.sheet === 'gates') return VK.table([{ label: 'Gate' }, { label: 'Control' }, { label: 'Owner' }, { label: 'Release criterion' }, { label: 'Codes' }],
      REGISTER.gates.map((g) => [esc(g.gate), esc(g.control), esc(g.owner), esc(g.criterion), chips(g.codes)]), { caption: 'Gate Map sheet' });
    if (UI.sheet === 'stages') return VK.table([{ label: 'Stage' }, { label: 'Gates' }, { label: 'Codes' }, { label: 'Families' }],
      REGISTER.stages.map((s) => [esc(s.stage), esc(s.gates), chips(s.codes), esc(s.families)]), { caption: 'Stage Map sheet' });
    if (UI.sheet === 'audit') return VK.table([{ label: 'Status' }, { label: 'Issue' }, { label: 'Treatment' }],
      REGISTER.audit.map((a) => [esc(a.status), esc(a.issue), esc(a.treatment)]), { caption: 'Code Audit sheet' });
    if (UI.sheet === 'instructions') return VK.table([{ label: 'Heading' }, { label: 'Text' }],
      REGISTER.instructions.map(([a, b]) => [a == null ? '' : `<strong>${esc(a)}</strong>`, esc(b == null ? '' : b)]), { caption: 'Instructions sheet' });
    const q = UI.q.trim().toLowerCase();
    const rows = REGISTER.codes.filter((c) => (UI.fam === 'all' || c.code.split('-')[0] === UI.fam) &&
      (!q || [c.code, c.title, c.trigger, c.resolution, c.owner, c.notes].some((v) => String(v || '').toLowerCase().includes(q))));
    const fams = FAMILY_ORDER.map((f) => { const c = REGISTER.codes.find((x) => x.code.startsWith(f + '-')); return [f, f + ' · ' + (c ? c.family : '')]; });
    const filters = `<div class="filters adm-filters"><label class="f" for="adm-reg-fam">Family<select id="adm-reg-fam" data-on="adm.regFam"><option value="all"${UI.fam === 'all' ? ' selected' : ''}>All families</option>${fams.map(([v, t]) => `<option value="${esc(v)}"${UI.fam === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="f" for="adm-reg-q">Search<input id="adm-reg-q" class="search" type="search" data-on="adm.regQ" value="${esc(UI.q)}" placeholder="Code, words, owner" autocomplete="off"></label>
      <span class="small muted" role="status">${esc(plural(rows.length, 'code') + ' of ' + REGISTER.codes.length)}</span></div>`;
    return filters + VK.table([{ label: 'Code' }, { label: 'Title, trigger and resolution' }, { label: 'Stage and gates' }, { label: 'Severity' }, { label: 'Owner' }, { label: 'Notes' }],
      rows.map((c) => [`<span class="vk-code">${esc(c.code)}</span><div class="small muted">${esc(c.family)}</div>`,
        `<strong>${esc(c.title)}</strong><div class="small"><span class="muted">Trigger:</span> ${esc(c.trigger)}</div><div class="small"><span class="muted">Resolved when:</span> ${esc(c.resolution)}</div>`,
        `${esc(c.stage)}<div class="small mono">${esc(c.gates)}</div>`, `${VK.sevChip(c.severity.slice(0, 2))}<div class="small">${esc(c.blocking === 'Yes' ? 'Blocking' : 'Blocking: ' + c.blocking)}</div>`,
        `${esc(c.owner)}${c.secondary ? `<div class="small muted">Secondary: ${esc(c.secondary)}</div>` : ''}`, `<span class="small">${esc(c.notes || '')}</span>`]),
      { caption: 'Exception Register sheet', empty: 'No code matches.' });
  }
  function registerBlock() {
    const src = REGISTER.source; const doc = WORKFLOW.source;
    const head = `${VK.facts([['Workbook', esc(src.file) + ' · ' + esc(plural(src.sheets.length, 'sheet'))], ['SHA-256', `<span class="hash">${esc(src.sha256)}</span>`],
      ['Master document', esc(doc.file)], ['SHA-256', `<span class="hash">${esc(doc.sha256)}</span>`]])}
      <div class="adm-tabs">${ADM.seg('adm.sheet', UI.sheet, SHEETS.map(([k, t]) => [k, t]), 'Register sheet')}</div>`;
    return VK.section('adm-controls-register', 'Exception register (read-only)', head + sheetBody(), {
      intro: esc(src.note + ' The workbook is the authoritative register; the preview never edits it.'),
    });
  }

  VIEWS.controls = () => {
    const intro = esc('The rules Operon enforces for the ITR12 workflow, taken from Johan’s exception register and master workflow document, and the choices still waiting for him. ') +
      esc('Signed in as ' + S.role + '.');
    return VK.page('Controls', intro, tiersBlock() + gatesBlock() + `<div class="grid2 vk-grid" data-rv-key="adm-controls-columns">${severityBlock()}${policyBlock()}</div>` +
      questionsBlock() + sodBlock() + rolesBlock() + rulesetsBlock() + checklistBlock() + registerBlock(), { key: 'adm-controls' });
  };

  /* ---------- Actions ---------- */
  Object.assign(FORMS, {
    'adm.ovAdd': (f) => {
      const code = String(f.elements.code.value || '');
      if (!CODE[code]) { toast('Pick a code first.'); return; }
      VK.done(ENGINE.setOverridable(code, true, ACTOR.me()), 'Overrides of ' + code + ' are now allowed (policy pending Johan).');
    },
  });
  Object.assign(ACT, {
    'adm.ovOff': (t) => { const code = t.dataset.code; if (!CODE[code]) return; VK.done(ENGINE.setOverridable(code, false, ACTOR.me()), 'Overrides of ' + code + ' are no longer allowed.'); },
    'adm.sheet': (t) => { UI.sheet = SHEETS.some(([k]) => k === t.dataset.v) ? t.dataset.v : 'codes'; render(); },
  });
  EXT_FIELD['adm.regFam'] = (el) => { UI.fam = el.value === 'all' || FAMILY_ORDER.includes(el.value) ? el.value : 'all'; };
  EXT_FIELD['adm.regQ'] = (el) => { UI.q = String(el.value || '').slice(0, 80); };
})();
