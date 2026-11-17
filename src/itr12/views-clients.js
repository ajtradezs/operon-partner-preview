/* Clients: the permanent client master (the Phase 1 field groups of the master workflow document), the KYC repository (G01)
   and a side-by-side comparison with the SARS registered details (G02, MD-* codes).
   This file also defines ADM, the few helpers the admin screens share (views-deadlines, views-controls, views-records and
   views-import): the Phase 1 field list, downloads, outside links and the modal result helper.
   Views only read state: a KYC change goes through ENGINE.setKyc with ACTOR.me(), and ENGINE audits every refusal. */
const ADM = (() => {
  /* ---------- The Phase 1 field groups, as the master document lists them (Phase 1, step 1) ---------- */
  const P1 = ((WORKFLOW.phases.find((p) => p.n === 1) || { steps: [] }).steps[0]) || { groups: [], responsible: '', reviewer: '' };
  const GROUP_TITLES = ['Taxpayer identification', 'Contact details', 'Residential and postal information', 'Marital information', 'Tax residency', 'Banking information'];
  const GROUPS = GROUP_TITLES.map((t) => { const g = P1.groups.find((x) => x.title === t); return { title: t, items: g ? g.items.slice() : [] }; });
  const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];
  // One column per Phase 1 item. grp is the index into GROUPS (6 = a column the preview adds). mask: 'id' shows the date of birth only,
  // 'tail' the last 4 characters. kind drives the import checks.
  const F = (key, label, grp, o) => Object.assign({ key, label, grp, kind: 'text', req: false, mask: null, hint: '' }, o || {});
  const FIELDS = [
    F('surname', 'Surname', 0, { req: true }),
    F('first_name', 'First name', 0, { req: true }),
    F('other_names', 'Other names', 0),
    F('initials', 'Initials', 0),
    F('date_of_birth', 'Date of birth', 0, { kind: 'date', hint: 'YYYY-MM-DD; checked against the ID number' }),
    F('id_number', 'RSA ID number', 0, { kind: 'id', mask: 'id', hint: '13 digits' }),
    F('gender', 'Gender', 0),
    F('tax_ref', 'Income tax reference number', 0, { kind: 'taxref', mask: 'tail', hint: '10 digits' }),
    F('passport_number', 'Passport number', 0, { mask: 'tail', hint: 'For a client who also holds a passport' }),
    F('passport_country', 'Passport country', 0),
    F('passport_issue_date', 'Passport issue date', 0, { kind: 'date', hint: 'YYYY-MM-DD' }),
    F('nationality', 'Nationality or citizenship', 0),
    F('email', 'Email address', 1, { kind: 'email' }),
    F('mobile', 'Cell or mobile number', 1, { kind: 'phone', hint: 'For example 082 123 4567 or +27 82 123 4567' }),
    F('home_phone', 'Home telephone', 1, { kind: 'phone' }),
    F('work_phone', 'Business telephone', 1, { kind: 'phone' }),
    F('preferred_contact', 'Preferred contact method', 1, { kind: 'choice', choices: ['Email', 'Cell', 'Home telephone', 'Business telephone'] }),
    F('unit_complex', 'Unit number and complex name', 2),
    F('street', 'Street number and street or farm name', 2),
    F('suburb', 'Suburb or district', 2),
    F('city', 'City or town', 2),
    F('province', 'Province', 2, { kind: 'choice', choices: PROVINCES }),
    F('postal_code', 'Postal code', 2, { kind: 'postcode', hint: '4 digits' }),
    F('country', 'Country', 2),
    F('postal_address', 'Postal address if different', 2),
    F('marital_status', 'Marital status', 3),
    F('marriage_regime', 'Marriage regime', 3, { kind: 'choice', choices: ['In community of property', 'Out of community of property', 'Not applicable'] }),
    F('spouse_name', 'Spouse full names', 3),
    F('spouse_id', 'Spouse RSA ID or passport', 3, { mask: 'id' }),
    F('spouse_tax_ref', 'Spouse income tax reference number', 3, { kind: 'taxref', mask: 'tail' }),
    F('sa_resident', 'Currently an RSA tax resident', 4, { kind: 'yesno' }),
    F('never_resident', 'Never an RSA resident', 4, { kind: 'yesno' }),
    F('residency_date', 'Date residency started, ceased or was reinstated', 4, { kind: 'date', hint: 'YYYY-MM-DD' }),
    F('foreign_country', 'Foreign country of tax residence', 4),
    F('foreign_tin', 'Foreign tax identification number', 4, { mask: 'tail' }),
    F('account_holder', 'Account-holder legal name', 5),
    F('bank', 'Bank', 5),
    F('branch_code', 'Branch code', 5, { kind: 'branch', hint: '6 digits' }),
    F('account_number', 'Account number', 5, { kind: 'account', mask: 'tail' }),
    F('account_type', 'Account type', 5),
    F('held_by_taxpayer', 'Account held by the taxpayer', 5, { kind: 'yesno' }),
    F('provisional', 'Provisional taxpayer', 6, { kind: 'yesno', hint: 'Sets the filing-season deadline; not a Phase 1 item' }),
  ];
  const GROUP_LABEL = (g) => (GROUPS[g] ? GROUPS[g].title : 'Added by the preview');

  /* ---------- Reading a client record ---------- */
  const splitName = (n) => { const p = String(n || '').trim().split(/\s+/); return { first: p[0] || '', last: p.slice(1).join(' ') }; };
  // Date of birth from the first six digits of an SA ID number (YYMMDD); the century is the one that keeps it in the past.
  function dobFromId(id) {
    const m = /^(\d{2})(\d{2})(\d{2})\d{7}$/.exec(String(id || ''));
    if (!m) return null;
    const yy = +m[1]; const cut = now().getFullYear() % 100;
    const iso = (yy > cut ? 1900 : 2000) + yy + '-' + m[2] + '-' + m[3];
    return DATES.dt(iso) ? iso : null;
  }
  // The value the client record holds for a field: the imported value when there is one, otherwise what the core record carries.
  function valueOf(cl, f) {
    const m = cl.master || {};
    if (m[f.key] != null && String(m[f.key]).trim() !== '') return { v: String(m[f.key]), from: 'record' };
    const n = splitName(cl.name);
    switch (f.key) {
      case 'surname': return n.last ? { v: n.last, from: 'record' } : null;
      case 'first_name': return n.first ? { v: n.first, from: 'record' } : null;
      case 'id_number': return cl.idNo ? { v: cl.idNo, from: 'record' } : null;
      case 'tax_ref': return cl.taxRef ? { v: cl.taxRef, from: 'record' } : null;
      case 'date_of_birth': { const d = dobFromId(cl.idNo); return d ? { v: d, from: 'id' } : null; }
      case 'email': return cl.email ? { v: cl.email, from: 'record' } : null;
      case 'provisional': return { v: cl.provisional ? 'Yes' : 'No', from: 'record' };
      default: return null;
    }
  }
  // A field's value as HTML: masked where it identifies someone, a muted note where the demo record has nothing.
  function valueHtml(cl, f) {
    const x = valueOf(cl, f);
    if (!x) return '<span class="muted">Not in the demo record</span>';
    const tail = f.key === 'tax_ref' || f.key === 'spouse_tax_ref' ? VK.taxRefHtml(x.v)
      : `<span class="mono vk-masked" title="${esc(f.label + ', masked: only the last 4 characters show')}">${esc(VK.maskTaxRef(x.v))}</span>`;
    const v = f.mask === 'id' ? VK.idHtml(x.v) : (f.mask === 'tail' ? tail : (f.kind === 'date' ? VK.date(x.v) + (x.from === 'id' ? ' <span class="small muted">(from the ID number)</span>' : '') : esc(x.v)));
    return v;
  }

  /* ---------- Small shared pieces ---------- */
  // A file the browser saves. Nothing leaves the browser.
  function download(name, text, type) {
    const blob = text instanceof Blob ? text : new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  // A link to a published source (configuration, never user data): only https URLs become links.
  const extLink = (url, label) => (/^https:\/\/[^\s"'<>]+$/.test(String(url || '')) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label || url)}</a>` : esc(label || ''));
  // Modal flows: success closes the dialog (VK.done then toasts and renders); a refusal stays in the dialog.
  const finish = (r, okMessage) => (r && r.ok ? () => VK.done(r, okMessage) : 'Not done: ' + ((r && r.why) || 'Operon refused this.'));
  const yes = (t) => `<span class="adm-yes">${I.check}${esc(t)}</span>`;
  const no = (t) => `<span class="adm-no">${I.alert}${esc(t)}</span>`;
  const seg = (act, cur, opts, label) => `<div class="seg adm-seg" role="group" aria-label="${esc(label)}">${opts.map(([v, t]) => `<button type="button" data-act="${esc(act)}" data-v="${esc(v)}" aria-pressed="${cur === v}">${esc(t)}</button>`).join('')}</div>`;
  const auditRow = (a) => `<div class="vk-row vk-row-log"><span class="vk-when">${VK.when(a.at)}</span><div class="vk-row-b">
      <div class="vk-row-t">${esc(VK.scrub(a.text))}${a.result === 'Refused' ? ' ' + VK.pill('Refused', 'bad') : ''}</div>
      <div class="vk-meta"><span>${esc(VK.who(a.who))}${a.role ? ' · ' + esc(a.role) : ''}</span>${a.caseId ? VK.caseLink(a.caseId) : ''}</div></div></div>`;
  return { P1, GROUPS, FIELDS, GROUP_LABEL, PROVINCES, splitName, dobFromId, valueOf, valueHtml, download, extLink, finish, yes, no, seg, auditRow };
})();

(() => {
  const UI = { q: '', f: 'all' };
  const caseOfClient = (cl) => S.cases.filter((c) => c.clientId === cl.id);
  const latestCase = (cl) => { const cs = caseOfClient(cl); return cs.length ? cs[cs.length - 1] : null; };
  const mdOf = (c) => (c ? ENGINE.exOf(c).filter((x) => /^MD-/.test(x.code)) : []);
  const kycOf = (c) => (c ? ENGINE.exOf(c).filter((x) => /^KYC-/.test(x.code) || x.code === 'CLT-01') : []);
  const KYC_SHORT = { id: 'ID', address: 'Address', bank: 'Bank', mandate: 'Mandate', popia: 'POPIA', engagement: 'Engagement' };

  /* ---------- The G02 comparison: the five items Phase 3 compares, with the MD codes that belong to each ---------- */
  const P3 = ((WORKFLOW.phases.find((p) => p.n === 3) || { steps: [] }).steps[0]) || { items: [] };
  const CMP = [
    { key: 'name', codes: [], rx: /\bname|surname/i, rec: (cl) => esc(cl.name) },
    { key: 'id', codes: ['MD-06'], rx: /\bID\b|identity|passport|tax ref|reference/i, rec: (cl) => `${VK.idHtml(cl.idNo)} · ${VK.taxRefHtml(cl.taxRef)}` },
    { key: 'contact', codes: [], rx: /address|contact|email|phone|cell/i, rec: (cl) => fieldsHtml(cl, ['email', 'mobile', 'street', 'suburb', 'city']) },
    { key: 'marital', codes: ['MD-04'], rx: /marital|spouse|residen/i, rec: (cl) => fieldsHtml(cl, ['marital_status', 'sa_resident']) },
    { key: 'bank', codes: ['MD-05'], rx: /bank|account/i, rec: (cl) => fieldsHtml(cl, ['bank', 'account_number']) || (cl.kyc.find((k) => k.key === 'bank' && k.ok) ? 'Bank confirmation letter on file' : '') },
  ].map((r, i) => Object.assign(r, { label: P3.items[i] || r.key }));
  function fieldsHtml(cl, keys) {
    const parts = keys.map((k) => ADM.FIELDS.find((f) => f.key === k)).filter((f) => f && ADM.valueOf(cl, f)).map((f) => ADM.valueHtml(cl, f));
    return parts.join(' · ');
  }
  // Which comparison row an MD exception belongs to: by its code, then by what its note mentions; MD-01 to MD-03 default to contact.
  const rowOf = (x) => (CMP.find((r) => r.codes.includes(x.code)) || CMP.find((r) => r.rx.test(String(x.note || ''))) || CMP[2]).key;

  function comparison(c) {
    const cl = ENGINE.clientOf(c);
    const st = ENGINE.gateState(c, 'G02'); const req = (c.req.G02 || []).find((r) => r.key === 'compare');
    const compared = !!(req && req.done); const md = mdOf(c);
    const rows = CMP.map((r) => {
      const hits = md.filter((x) => rowOf(x) === r.key);
      const sars = hits.length
        ? hits.map((x) => `<div>${esc(VK.scrub(x.note || x.title))}</div>`).join('')
        : (compared ? '<span>Same as the client record</span>' : '<span class="muted">Not compared yet</span>');
      const result = hits.length
        ? `<div class="vk-codes">${hits.map((x) => VK.codeChip(x.code, x) + ' ' + VK.exStatus(x)).join(' ')}</div>`
        : (compared ? ADM.yes('Matches') : `<span class="muted">${esc(st.state === 'not started' ? 'G02 has not started' : 'Waiting for the comparison')}</span>`);
      // An empty record row with a difference: the difference note says what the record holds, so do not imply there is nothing.
      const rec = r.rec(cl) || (hits.length ? '<span class="muted">Not in the demo record; the difference shows what it holds</span>' : '<span class="muted">Not in the demo record</span>');
      return { cells: [esc(r.label), rec, sars, result], cls: hits.some((x) => ENGINE.isOpen(x)) ? 'adm-diff' : '' };
    });
    return VK.table([{ label: 'Compared item' }, { label: 'Client record (Operon)' }, { label: 'SARS registered details (simulated)' }, { label: 'Result' }], rows,
      { caption: 'Client record compared with the SARS registered details for ' + c.id });
  }

  /* ---------- Clients list ---------- */
  function matches(cl) {
    const c = latestCase(cl);
    if (UI.q && !cl.name.toLowerCase().includes(UI.q.toLowerCase()) && cl.id.toLowerCase() !== UI.q.toLowerCase()) return false;
    if (UI.f === 'kyc') return cl.kyc.some((k) => !k.ok) || kycOf(c).some(ENGINE.isOpen);
    if (UI.f === 'sars') return mdOf(c).some(ENGINE.isOpen);
    return true;
  }
  function listBlock() {
    const all = S.clients; const shown = all.filter(matches);
    const rows = shown.map((cl) => {
      const c = latestCase(cl); const okN = cl.kyc.filter((k) => k.ok).length; const miss = cl.kyc.filter((k) => !k.ok);
      const md = mdOf(c).filter(ENGINE.isOpen);
      return [
        `<strong>${VK.clientLink(cl)}</strong><div class="small muted">${esc(cl.id)}${cl.provisional ? ' · provisional taxpayer' : ''}</div>`,
        `${VK.idHtml(cl.idNo)}<div class="small">${VK.taxRefHtml(cl.taxRef)}</div>`,
        `${VK.pill(okN + ' of ' + cl.kyc.length, miss.length ? 'warn' : 'ok')}${miss.length ? `<div class="small">Missing: ${esc(miss.map((k) => KYC_SHORT[k.key] || k.label).join(', '))}</div>` : ''}`,
        c ? VK.gateChip(c, 'G01') : '<span class="muted">No case</span>',
        c ? `${VK.gateChip(c, 'G02')}${md.length ? `<div class="vk-codes">${md.map((x) => VK.codeChip(x.code, x)).join(' ')}</div>` : ''}` : '<span class="muted">No case</span>',
        caseOfClient(cl).map((k) => VK.caseLink(k)).join(', ') || '<span class="muted">None yet</span>',
      ];
    });
    const filters = `<div class="filters adm-filters">
      <label class="f" for="adm-cl-q">Find a client<input id="adm-cl-q" class="search" type="search" data-on="adm.clq" value="${esc(UI.q)}" placeholder="Name or client number" autocomplete="off"></label>
      ${ADM.seg('adm.clf', UI.f, [['all', 'All'], ['kyc', 'KYC incomplete'], ['sars', 'SARS differences']], 'Show')}</div>`;
    return VK.section('adm-clients-list', 'Permanent client master', filters + VK.table(
      [{ label: 'Client' }, { label: 'ID and tax reference' }, { label: 'KYC repository' }, { label: 'Onboarding (G01)' }, { label: 'SARS details (G02)' }, { label: 'ITR12 cases' }],
      rows, { caption: 'Clients in the permanent client master', empty: all.length ? 'No client matches this filter.' : 'No clients yet. Import them from a template.' }), {
      count: shown.length,
      intro: esc('Kept separately from the annual ITR12 cases. ID numbers show only the date of birth; tax references only the last 4 digits.'),
      actions: '<a href="#import">Import clients</a>',
    });
  }
  function kycBlock() {
    const head = [{ label: 'Client' }].concat(ENGINE.KYC_ITEMS.map((k) => ({ label: KYC_SHORT[k.key] || k.label })));
    const rows = S.clients.filter(matches).map((cl) => [VK.clientLink(cl)].concat(ENGINE.KYC_ITEMS.map((k) => {
      const it = cl.kyc.find((x) => x.key === k.key); return it && it.ok ? ADM.yes('Received') : ADM.no('Missing');
    })));
    return VK.section('adm-clients-kyc', 'KYC repository (G01)', VK.table(head, rows, { caption: 'KYC documents held for each client', empty: 'No client matches this filter.', cls: 'adm-matrix' }), {
      intro: esc('The permanent documents Phase 2 requires: ' + ENGINE.KYC_ITEMS.map((k) => k.label.toLowerCase()).join(', ') + '. The Administrator approves G01 once they are all valid. Files arrive through the PaperSync portal (simulated).'),
    });
  }
  function sarsBlock() {
    const xs = S.exceptions.filter((x) => /^MD-/.test(x.code) && x.status !== 'closed').filter((x) => { const cl = ENGINE.clientOf(x.clientId); return !cl || matches(cl); });
    const rows = xs.map((x) => {
      const r = CMP.find((k) => k.key === rowOf(x));
      return [x.caseId ? VK.caseWho(x.caseId) : esc(VK.clientName(x.clientId)), esc(r.label), esc(VK.scrub(x.note || x.title)),
        `${VK.codeChip(x.code, x)} ${VK.sevChip(x.sev, { short: true })}<div>${VK.exStatus(x)}</div>`, VK.exceptionBtn({ x, need: ENGINE.isOpen(x) ? 'resolve' : 'close' })];
    });
    return VK.section('adm-clients-sars', 'Differences with SARS registered details (G02)', VK.table(
      [{ label: 'Client' }, { label: 'Item' }, { label: 'What differs' }, { label: 'Code' }, { label: '', cls: 'vk-act' }], rows,
      { caption: 'Open differences between the client record and SARS', empty: 'No open differences with the SARS registered details.' }), {
      count: rows.length,
      intro: esc('The AI compares the client record with what SARS holds; the Tax Consultant clears each difference. The SARS link is simulated: the differences come from the demo cases. Material identity, residency or banking differences need a person; the AI may not resolve them by assumption.'),
    });
  }
  function fieldsBlock() {
    const groups = ADM.GROUPS.map((g) => `<div class="adm-group"><h3>${esc(g.title)}</h3><ul class="adm-items">${g.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('');
    return VK.section('adm-clients-fields', 'What the client master holds (Phase 1)', `<div class="adm-groups">${groups}</div>`, {
      intro: esc('The field groups of the master workflow document, Phase 1, step 1. Responsible: ' + (ADM.P1.responsible || 'Administrator') + '. Reviewer: ' + (ADM.P1.reviewer || '') + '.'),
      actions: '<a href="#import">Template to fill in</a>',
    });
  }
  VIEWS.clients = () => {
    const intro = esc('The permanent client master and KYC repository in PaperSync, and how each client compares with the details SARS holds. All clients are made up; the PaperSync portal and the SARS link are simulated.');
    return VK.page('Clients', intro, listBlock() + sarsBlock() + kycBlock() + fieldsBlock(), { key: 'adm-clients' });
  };

  /* ---------- One client ---------- */
  function masterBlock(cl) {
    const groups = [0, 1, 2, 3, 4, 5, 6].map((g) => {
      const fs = ADM.FIELDS.filter((f) => f.grp === g);
      const have = fs.filter((f) => ADM.valueOf(cl, f)); const gap = fs.filter((f) => !ADM.valueOf(cl, f));
      return `<div class="adm-group"><h3>${esc(ADM.GROUP_LABEL(g))}</h3>${have.length ? VK.facts(have.map((f) => [f.label, ADM.valueHtml(cl, f)])) : ''}${gap.length
        ? `<p class="small muted adm-gap"><span class="adm-gap-h">${esc(have.length ? 'Not in the demo record:' : 'Nothing in the demo record yet:')}</span> ${esc(gap.map((f) => f.label).join(', '))}</p>` : ''}</div>`;
    }).join('');
    const held = ADM.FIELDS.filter((f) => ADM.valueOf(cl, f)).length;
    return VK.section('adm-client-master', 'Client master record', `<div class="adm-groups">${groups}</div>`, {
      intro: esc('The Phase 1 field groups. ' + held + ' of ' + ADM.FIELDS.length + ' fields are in this demo record; a real record is captured at onboarding or imported from the template. Numbers that identify someone are masked.'),
      actions: '<a href="#import">Import template</a>',
    });
  }
  function kycClientBlock(cl) {
    const c = latestCase(cl);
    const rows = cl.kyc.map((k) => [esc(k.label), k.ok ? ADM.yes('Received and valid') : ADM.no('Missing'),
      btn(k.ok ? 'Mark missing' : 'Mark received', 'adm.kyc', { cls: 'sm' + (k.ok ? '' : ' primary'), data: { client: cl.id, key: k.key, ok: k.ok ? '0' : '1' } })]);
    const table = VK.table([{ label: 'Document' }, { label: 'Status' }, { label: '', cls: 'vk-act' }], rows, { caption: 'KYC documents for ' + cl.name });
    let gate = '';
    if (c) {
      const xs = kycOf(c).filter((x) => x.status !== 'closed');
      const g01 = c.gates.G01.status === 'released' ? '' : VK.releaseBtn((() => { const r = ENGINE.canRelease(c, 'G01', ACTOR.me()); return { kind: 'gate', c, g: 'G01', ready: r.ok, why: r.why }; })());
      gate = `<div class="adm-gateline"><span>${VK.gateChip(c, 'G01')} <span class="small muted">${esc(VK.gateName('G01'))}</span></span>${g01}</div>` +
        (xs.length ? VK.list(xs.map((x) => `<div class="adm-exrow"><div class="vk-row-b"><div class="vk-row-t">${VK.codeChip(x.code, x)} ${VK.sevChip(x.sev, { short: true })} ${esc(x.title)}</div>
          <div class="vk-meta">${VK.exStatus(x)}<span>${esc(VK.scrub(x.note || ''))}</span></div></div><div class="adm-exact">${VK.exceptionBtn({ x, need: ENGINE.isOpen(x) ? 'resolve' : 'close' })}</div></div>`)) : '');
    }
    return VK.section('adm-client-kyc', 'KYC repository (G01)', table + gate, {
      intro: esc('Marking a document received or missing is recorded in the audit trail. The Administrator or the Tax Consultant can change it; anyone else is refused, and the refusal is recorded too.'),
    });
  }
  function sarsClientBlock(cl) {
    const cs = caseOfClient(cl);
    if (!cs.length) return VK.section('adm-client-sars', 'Compared with SARS registered details (G02)', VK.empty('No ITR12 case yet, so nothing has been compared with SARS.'), {});
    const body = cs.map((c) => `${cs.length > 1 ? `<h3 class="adm-h3">${VK.caseLink(c)} · ${esc(c.year)}</h3>` : ''}<div class="adm-gateline"><span>${VK.gateChip(c, 'G02')} <span class="small muted">${esc(VK.gateName('G02'))}</span></span></div>${comparison(c)}`).join('');
    return VK.section('adm-client-sars', 'Compared with SARS registered details (G02)', body, {
      intro: esc('Side by side: what the client record holds and what the simulated SARS link returned. The comparison items are the ones Phase 3 lists. A difference is an MD code that the Tax Consultant clears before G02 can pass.'),
    });
  }
  function casesBlock(cl) {
    const rows = caseOfClient(cl).map((c) => {
      const col = BOARD.find((b) => b.key === ENGINE.columnOf(c)); const g = ENGINE.currentGate(c);
      const open = ENGINE.exOf(c).filter(ENGINE.isOpen);
      return [VK.caseLink(c), esc(c.year), esc(col ? col.label : ''), g ? VK.gateChip(c, g) : VK.pill('All gates passed', 'ok'),
        open.length ? `<div class="vk-codes">${open.map((x) => VK.codeChip(x.code, x)).join(' ')}</div>` : '<span class="muted">None</span>'];
    });
    return VK.section('adm-client-cases', 'Annual ITR12 cases', VK.table([{ label: 'Case' }, { label: 'Year' }, { label: 'Stage' }, { label: 'Current gate' }, { label: 'Open exceptions' }], rows,
      { caption: 'ITR12 cases for ' + cl.name, empty: 'No ITR12 case yet.' }), { count: rows.length, intro: esc('Each tax year is a separate case in the annual case repository.') });
  }
  function activityBlock(cl) {
    const items = S.audit.filter((a) => a.client === cl.id || a.who === cl.id).slice(-12).reverse().map(ADM.auditRow);
    return VK.section('adm-client-activity', 'Recent activity', VK.list(items, { empty: 'Nothing recorded for this client yet.' }), {
      intro: esc('The latest entries for this client from the audit trail, newest first.'), actions: '<a href="#audit">Audit trail</a>',
    });
  }
  VIEWS.client = (id) => {
    const cl = ENGINE.clientOf(String(id || ''));
    if (!cl) return VK.page('Client not found', esc('There is no client ' + (id || '') + '. ') + '<a href="#clients">All clients</a>', '', { key: 'adm-client' });
    const intro = `${esc(cl.id)} · permanent client master in PaperSync · ${cl.provisional ? 'provisional taxpayer' : 'not a provisional taxpayer'} · <a href="#clients">All clients</a>`;
    return VK.page(cl.name, intro, masterBlock(cl) + `<div class="grid2 vk-grid" data-rv-key="adm-client-columns">${kycClientBlock(cl)}${casesBlock(cl)}</div>` + sarsClientBlock(cl) + activityBlock(cl), { key: 'adm-client' });
  };

  /* ---------- Actions ---------- */
  Object.assign(ACT, {
    'adm.kyc': (t) => {
      const cl = ENGINE.clientOf(t.dataset.client); if (!cl) { toast('That client is no longer here.'); render(); return; }
      const k = cl.kyc.find((x) => x.key === t.dataset.key); if (!k) return;
      const ok = t.dataset.ok === '1';
      VK.done(ENGINE.setKyc(cl, k.key, ok, ACTOR.me()), (ok ? 'Marked as received: ' : 'Marked as missing: ') + k.label + '.');
    },
    'adm.clf': (t) => { UI.f = ['all', 'kyc', 'sars'].includes(t.dataset.v) ? t.dataset.v : 'all'; render(); },
  });
  EXT_FIELD['adm.clq'] = (el) => { UI.q = String(el.value || '').slice(0, 80); };
})();
