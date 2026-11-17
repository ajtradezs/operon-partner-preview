/* PaperSync: the firm's side (requests board, checklist template, KYC requests, questionnaire, reminders, settings and portal
   links) and the client's PaperSync portal (#portal-<caseId>). Evolved from the old Document collections module (src/collections.js):
   it keeps the portal flow (verify, checklist with upload, N/A and drop-on-row, submit), the reminders cadence and the simulated
   WhatsApp, email and link messages, but its data now comes from the ITR12 cases.
   Views only read state. Firm actions go through ENGINE with ACTOR.me(); every portal action goes through ENGINE.portal(), which
   acts as the client (ACTOR.client) and nobody else. Uploads keep only the file's name and size: nothing is read, and the AI check
   on them is simulated. Nothing is sent to anyone: the portal, the messages and the one-time code are simulated. */
(() => {
  /* ---------- this browser tab's portal session (not demo state): which portals passed the one-time code ---------- */
  const SESS = { s: null, verified: new Set(), target: null };
  const sess = () => { if (SESS.s !== S) { SESS.s = S; SESS.verified = new Set(); SESS.target = null; } return SESS; };
  const DEMO_CODE = '123456';
  // The old module's reminder cadence, kept as the firm's choice (pending Johan). The preview sends reminders by hand.
  const CADENCE = [['2', 'Every 2 days'], ['3', 'Every 3 days'], ['7', 'Every week (recommended)'], ['14', 'Every 2 weeks'], ['custom', 'Custom']];
  const CADENCE_NOW = '7';
  const SAMPLE_SIZE = 245760;

  /* ---------- small helpers ---------- */
  const first = (cl) => String((cl && cl.name) || 'there').split(' ')[0];
  const kindLabel = (k) => (DOC_KINDS.find((d) => d.kind === k) || { label: k }).label;
  function size(n) {
    n = +n || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    return (Math.round(n / 104857.6) / 10) + ' MB';
  }
  const released = (c, g) => c.gates[g] && c.gates[g].status === 'released';
  const live = () => S.cases.filter((c) => !c.archived);
  const portalLink = (c, label, cls) => VK.link('portal', c.id, label || 'Open portal', cls ? { cls } : null);
  const simLink = (c) => 'SIMULATED-PORTAL:' + c.id;
  // Which reminder the engine can send for this case now: onboarding until G01 passes, approval while G06 is the open gate.
  const remindKind = (c) => (!released(c, 'G01') ? 'onboarding' : (ENGINE.currentGate(c) === 'G06' ? 'approval' : null));
  const outReminder = (c) => c.reminders.filter((r) => r.status === 'sent').slice(-1)[0] || null;
  const fin = (r, msg) => (r && r.ok ? () => VK.done(r, msg) : 'Not done: ' + ((r && r.why) || 'Operon refused this.'));
  const caseFrom = (t) => { const c = ENGINE.caseById(t.dataset.case); if (!c) { toast('That case is no longer here.'); render(); } return c; };
  const pendingPill = () => VK.pill('Pending Johan', 'warn');

  // Documents the client still owes: nothing accepted or being checked, and no N/A on file (a DOC-01 flag holds the item but it is still owed).
  const liveDocs = (c, it) => c.docs.filter((d) => d.itemId === it.id && (d.status === 'validated' || d.status === 'held'));
  const owedItems = (c) => c.items.filter((it) => { const st = ENGINE.itemState(c, it); return st !== 'validated' && st !== 'na' && it.na !== 'requested' && !liveDocs(c, it).length; });
  // Everything the client owes on a case, as board columns. Each entry: { col, text }.
  function owes(c) {
    const out = []; const cl = ENGINE.clientOf(c); const cur = ENGINE.currentGate(c); const q = c.questionnaire;
    if (!released(c, 'G01')) {
      // Only what the client still has to send; KYC that is complete and waiting for the firm's G01 approval is not owed by the client.
      const miss = cl.kyc.filter((k) => !k.ok);
      if (miss.length) out.push({ col: 'kyc', text: 'KYC: ' + miss.map((k) => k.label).join('; ') });
    }
    if (!released(c, 'G03') && q.status !== 'submitted') {
      const n = q.required.filter((k) => k in q.answers).length;
      out.push({ col: 'questionnaire', text: 'Questionnaire: ' + n + ' of ' + q.required.length + ' required answers' });
    }
    // Documents are asked for once the questionnaire is in, because a Yes adds to the checklist (the portal's steps say the same).
    if (!released(c, 'G04') && q.status === 'submitted') {
      const items = owedItems(c);
      if (items.length) out.push({ col: 'documents', text: 'Documents: ' + items.map((it) => it.label).join('; ') });
    }
    if (cur === 'G06' && ENGINE.curVersion(c)) out.push({ col: 'approval', text: 'Approve version ' + ENGINE.vN(c) + ' and give authority to submit' });
    if (cur === 'G14' && c.ita34) out.push({ col: 'decision', text: 'Accept the assessment (ITA34 ' + c.ita34.ref + ') or instruct the firm' });
    if (c.remedy && c.remedy.route && c.remedy.route !== 'advice' && !released(c, 'G15') && !(c.remedy.authority && c.remedy.authority.route === c.remedy.route)) {
      out.push({ col: 'authority', text: 'Authorise the ' + (SARS_FN[c.remedy.route] ? SARS_FN[c.remedy.route].label.toLowerCase() : c.remedy.route) });
    }
    return out;
  }
  const BOARD_COLS = [
    { key: 'kyc', label: 'KYC and onboarding' }, { key: 'questionnaire', label: 'Questionnaire' }, { key: 'documents', label: 'Documents' },
    { key: 'approval', label: 'Approval' }, { key: 'decision', label: 'Assessment decision' }, { key: 'authority', label: 'Remedy authority' },
  ];
  const owesText = (c) => owes(c).map((o) => o.text).join('. ');

  /* ===================== The firm's PaperSync page ===================== */
  function reminderLine(c) {
    const r = outReminder(c);
    return r ? `<div class="vk-meta">${VK.pill('Reminder out', 'info')}<span>${esc(r.kind)} reminder sent ${esc(fWhen(r.sent))}, runs out ${esc(fWhen(r.expires))}</span></div>` : '';
  }
  function boardBlock() {
    const rows = live().map((c) => ({ c, o: owes(c) })).filter((r) => r.o.length);
    const cols = BOARD_COLS.map((col) => {
      const cards = rows.filter((r) => r.o.some((o) => o.col === col.key)).map(({ c, o }) => {
        const mine = o.filter((x) => x.col === col.key);
        return `<li class="ps-card"><div class="ps-card-t">${VK.clientLink(c.clientId)}</div>
          <div class="vk-meta">${VK.caseLink(c)}<span>${VK.gateChip(c, ENGINE.currentGate(c) || 'G16', { bare: true })}</span></div>
          ${mine.map((x) => `<p class="ps-owe">${esc(x.text)}</p>`).join('')}${reminderLine(c)}
          <div class="ps-card-a">${portalLink(c, 'Open portal', 'btn sm')}</div></li>`;
      });
      return `<div class="ps-col" data-col="${esc(col.key)}"><h3 class="ps-col-h">${esc(col.label)} <span class="count${cards.length ? '' : ' zero'}">${cards.length}</span></h3>
        ${cards.length ? `<ul class="ps-cards">${cards.join('')}</ul>` : '<p class="small muted">Nothing owed.</p>'}</div>`;
    }).join('');
    return VK.section('ps-board', 'Requests board: what clients owe', `<div class="ps-board">${cols}</div>`, {
      count: rows.length,
      intro: esc('Each card is a client with something to do in the PaperSync portal, grouped by what they owe. The board is worked out from each case’s gates, so it moves as clients act.'),
    });
  }
  function naBlock() {
    const rows = [];
    live().forEach((c) => c.items.filter((it) => it.na === 'requested').forEach((it) => rows.push([VK.caseWho(c), esc(it.label), esc(VK.scrub(it.naReason || '')),
      btn('Approve reason', 'ps.approveNa', { cls: 'sm', data: { case: c.id, item: it.id } })])));
    return VK.section('ps-na', 'Not-available requests', VK.table(['Case', 'Document', 'Client’s reason', { label: '', cls: 'vk-act' }], rows,
      { caption: 'Not-available requests', empty: 'No client has marked a document as not available.' }), {
      count: rows.length,
      intro: esc('A Tax Consultant approves the reason before the document stops counting as missing (DOC-01).'),
    });
  }
  function kycBlock() {
    const rows = [];
    S.clients.forEach((cl) => {
      const miss = cl.kyc.filter((k) => !k.ok); if (!miss.length) return;
      const cases = S.cases.filter((c) => c.clientId === cl.id && !c.archived);
      const c = cases.find((x) => !released(x, 'G01')) || cases[0];
      rows.push([`${VK.clientLink(cl)}<div class="small">${cases.length ? cases.map((x) => VK.caseLink(x)).join(', ') : '<span class="muted">No case</span>'}</div>`,
        `<ul class="ps-kyc">${miss.map((k) => `<li><span>${esc(k.label)}</span>${btn('Received', 'ps.kyc', { cls: 'sm', data: { client: cl.id, key: k.key }, title: 'Mark as received: ' + k.label })}</li>`).join('')}</ul>`,
        c && remindKind(c) === 'onboarding' ? btn('Send reminder', 'ps.remind', { cls: 'sm', data: { case: c.id, kind: 'onboarding' } }) : '']);
    });
    return VK.section('ps-kyc', 'KYC requests', VK.table(['Client', 'Still missing', { label: '', cls: 'vk-act' }], rows,
      { caption: 'Clients with KYC items missing', empty: 'Every client’s KYC is complete.' }), {
      count: rows.length,
      intro: esc('Every new client is asked for: ' + ENGINE.KYC_ITEMS.map((k) => k.label).join('; ') + '. The Administrator approves KYC at G01 once nothing is missing.'),
    });
  }
  function remindersBlock() {
    const sendable = live().filter((c) => remindKind(c)).map((c) => {
      const kind = remindKind(c); const r = outReminder(c);
      return [VK.caseWho(c), esc(kind === 'onboarding' ? 'Onboarding (G01)' : 'Approval (G06)'),
        r ? `${VK.pill(r.kind === kind ? 'Reminder out' : 'Other reminder out', 'info')}<div class="small muted">Runs out ${esc(fWhen(r.expires))}</div>` : VK.pill('None out', ''),
        `<div class="ps-btns">${btn('Send reminder', 'ps.remind', { cls: 'sm primary', data: { case: c.id, kind } })}${btn('WhatsApp', 'ps.share', { cls: 'sm', data: { case: c.id, ch: 'whatsapp' } })}${btn('Email', 'ps.share', { cls: 'sm', data: { case: c.id, ch: 'email' } })}</div>`];
    });
    const history = [];
    S.cases.forEach((c) => c.reminders.forEach((r) => history.push({ c, r })));
    history.sort((p, q) => q.r.sent - p.r.sent);
    const STATUS = { sent: ['Waiting', 'info'], answered: ['Answered', 'ok'], expired: ['Ran out', 'bad'] };
    const histRows = history.map(({ c, r }) => [VK.caseWho(c), esc(r.kind), VK.when(r.sent), VK.when(r.expires), VK.pill((STATUS[r.status] || [r.status])[0], (STATUS[r.status] || [])[1] || '')]);
    const days = S.policy.reminderDays;
    return VK.section('ps-reminders', 'Reminders', `${VK.table(['Case', 'Reminder', 'Already sent?', { label: '', cls: 'vk-act' }], sendable, { caption: 'Reminders you can send now', empty: 'No case is waiting on an onboarding or approval reminder.' })}
      <h3 class="ps-h3">Sent</h3>${VK.table(['Case', 'Reminder', 'Sent', 'Runs out', 'Status'], histRows, { caption: 'Reminders sent', empty: 'No reminders sent yet.' })}`, {
      count: sendable.length,
      intro: `${esc('A reminder runs out after ' + days.onboarding + ' days (onboarding) or ' + days.approval + ' days (approval). Then Operon raises CLT-01 or CLT-05. A reminder that runs out never counts as approval. The cadence is ' + (CADENCE.find((x) => x[0] === CADENCE_NOW) || CADENCE[2])[1].replace(' (recommended)', '').toLowerCase() + '.')} ${pendingPill()} ${esc('WhatsApp and email are simulated: nothing is sent.')}`,
    });
  }
  function portalsBlock() {
    const rows = live().map((c) => {
      const col = BOARD.find((b) => b.key === ENGINE.columnOf(c));
      const o = owes(c);
      return [VK.caseWho(c), esc(col ? col.label : ''), o.length ? `<ul class="ps-mini">${o.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : '<span class="muted">Nothing owed</span>',
        `<div class="ps-btns">${portalLink(c, 'Open portal', 'btn sm')}${btn('Copy link', 'ps.share', { cls: 'sm', data: { case: c.id, ch: 'link' } })}</div>`];
    });
    return VK.section('ps-portals', 'Client portals', VK.table(['Case', 'Stage', 'Client owes', { label: '', cls: 'vk-act' }], rows, { caption: 'Each case’s PaperSync portal', empty: 'No open cases.' }), {
      count: rows.length,
      intro: esc('One portal per case. Open it to see and act as the client would. Portal links are simulated (SIMULATED-PORTAL:…) and work only inside this preview.'),
    });
  }
  function templateBlock() {
    const DEFAULT = ['irp5', 'medical'];
    const rows = DOC_KINDS.map((d) => {
      const q = ENGINE.QUESTIONS.find((x) => x.kind === d.kind);
      const when = DEFAULT.includes(d.kind) ? 'Every case, plus “' + (q ? q.label : '') + '” Yes' : (q ? 'The client answers Yes to “' + q.label + '”' : 'The firm adds it (for example for a SARS letter)');
      return [`${esc(d.label)}<div class="small muted">Sample: <span class="mono">${esc(ENGINE.FILE_FOR[d.kind] || '')}</span></div>`, esc(when)];
    });
    return VK.section('ps-template', 'ITR12 personalised checklist template', VK.table(['Document', 'Added to the checklist when'], rows, { caption: 'Checklist template' }), {
      count: DOC_KINDS.length,
      intro: esc('The questionnaire personalises each client’s checklist: a Yes adds the document. The simulated AI check classifies an upload by its file name and size only; it never opens the file.'),
    });
  }
  function questionnaireBlock() {
    const cs = live();
    const sub = cs.filter((c) => c.questionnaire.status === 'submitted').length;
    const rows = ENGINE.QUESTIONS.map((q) => [esc(q.label), q.kind ? esc(kindLabel(q.kind)) : '<span class="muted">Nothing</span>',
      q.material ? `${VK.codeChip('QUE-03')} <span class="small">when it is new this year</span>` : '<span class="muted">No</span>']);
    return VK.section('ps-questionnaire', 'Annual questionnaire', VK.table(['Question', 'A Yes adds', 'Raises'], rows, { caption: 'Questionnaire' }), {
      count: ENGINE.QUESTIONS.length,
      intro: esc(sub + ' of ' + cs.length + ' open cases have submitted it. Unanswered required questions raise QUE-01; a Yes last year and a No this year raises QUE-04. Submitting it passes G03.'),
    });
  }
  function settingsBlock() {
    const pol = S.policy; const pend = (k) => (POLICY_PENDING.includes(k) ? ' ' + pendingPill() : '');
    const facts = VK.facts([
      ['Identity check', esc('A one-time code to the client’s mobile number before the portal opens. Simulated: no code is sent; the demo code is ' + DEMO_CODE + '.')],
      ['Reminder cadence', `<div class="seg ps-seg" role="group" aria-label="Reminder cadence">${CADENCE.map(([v, l]) => `<button type="button" disabled aria-pressed="${v === CADENCE_NOW}">${esc(l)}</button>`).join('')}</div> ${pendingPill()}`],
      ['Reminder runs out', esc('Onboarding ' + pol.reminderDays.onboarding + ' days (CLT-01), approval ' + pol.reminderDays.approval + ' days (CLT-05)') + pend('reminderDays')],
      ['Channels', esc('Email, WhatsApp and a portal link. All simulated: nothing leaves the preview.')],
      ['Uploads', esc('PDF, image, Word, Excel or CSV, up to ' + (UPLOAD.maxBytes / 1048576) + ' MB. Programs and scripts are quarantined unopened (DOC-10); password-protected or oversized files are rejected (DOC-11).')],
      ['AI confidence', esc('Below ' + Math.round(pol.aiConfidence * 100) + '% the document is held for a person (AI-01)') + pend('aiConfidence')],
    ]);
    return VK.section('ps-settings', 'Settings', facts, {
      intro: esc('Read-only here. Values marked “Pending Johan” are conservative defaults until he sets the firm’s policy; they are listed on Controls.'),
    });
  }

  VIEWS.papersync = () => {
    const intro = esc('The firm’s side of PaperSync: what each client owes, the checklist and questionnaire they get, KYC requests, reminders and each client’s portal. The PaperSync portal, its messages and the AI checks on uploads are simulated.');
    return VK.page('PaperSync', intro,
      boardBlock() +
      `<div class="grid2 vk-grid" data-rv-key="ps-columns-firm">${naBlock()}${kycBlock()}</div>` +
      remindersBlock() + portalsBlock() +
      `<div class="grid2 vk-grid" data-rv-key="ps-columns-template">${questionnaireBlock()}${templateBlock()}</div>` +
      settingsBlock(),
      { key: 'ps' });
  };

  /* ===================== The client's PaperSync portal ===================== */
  const DOC_WORD = { validated: ['Accepted', 'ok'], held: ['Held for a person to check', 'warn'], quarantined: ['Quarantined, never opened', 'bad'], rejected: ['Rejected', 'bad'], duplicate: ['Duplicate, not counted', ''] };
  const STEP_WORD = { done: ['Done', 'ok'], yours: ['Your turn', 'warn'], firm: ['With your accountant', 'info'], later: ['Later', ''] };
  function steps(c, verified) {
    const q = c.questionnaire; const cur = ENGINE.currentGate(c); const out = [];
    out.push(['Confirm it’s you', verified ? 'done' : 'yours']);
    out.push(['Questionnaire', released(c, 'G03') ? 'done' : (q.status === 'submitted' ? 'firm' : 'yours')]);
    out.push(['Documents', released(c, 'G04') ? 'done' : (q.status !== 'submitted' ? 'later' : (owedItems(c).length ? 'yours' : 'firm'))]);
    out.push(['Approve your return', released(c, 'G06') && ENGINE.currentApproval(c) ? 'done' : (cur === 'G06' ? 'yours' : (released(c, 'G04') ? 'firm' : 'later'))]);
    out.push(['Assessment decision', released(c, 'G14') ? 'done' : (cur === 'G14' ? 'yours' : (c.submission && c.submission.ok ? 'firm' : 'later'))]);
    if (c.remedy && c.remedy.route && c.remedy.route !== 'advice') out.push(['Authorise the remedy', c.remedy.authority && c.remedy.authority.route === c.remedy.route ? 'done' : 'yours']);
    return out;
  }
  function stepsBlock(c) {
    const st = steps(c, true);
    const now0 = st.find((s) => s[1] === 'yours');
    return VK.section('ps-portal-steps', 'Your 2026 tax return', `<ol class="ps-steps">${st.map(([label, k], i) => `<li class="ps-step ps-st-${k}"><span class="ps-step-n" aria-hidden="true">${k === 'done' ? I.check : i + 1}</span><span class="ps-step-l">${esc(label)}</span>${VK.pill(STEP_WORD[k][0], STEP_WORD[k][1])}</li>`).join('')}</ol>`, {
      intro: esc(now0 ? 'Next for you: ' + now0[0].toLowerCase() + '.' : 'Nothing is waiting for you right now.'),
    });
  }
  function questionnaireCard(c) {
    const q = c.questionnaire; const done = q.status === 'submitted';
    const row = (qq) => {
      const v = q.answers[qq.key]; const req = q.required.includes(qq.key); const id = 'ps-q-' + qq.key;
      const opts = done ? `<span class="ps-ans">${v === true ? 'Yes' : v === false ? 'No' : '<span class="muted">Not answered</span>'}</span>`
        : `<span class="ps-q-opts" role="radiogroup" aria-label="${esc(qq.label)}">${[['1', 'Yes', true], ['0', 'No', false]].map(([val, word, b]) =>
          `<label for="${id}-${val}"><input type="radio" id="${id}-${val}" name="${id}" data-on="ps.answer" data-case="${esc(c.id)}" data-key="${esc(qq.key)}" data-v="${val}"${v === b ? ' checked' : ''}> ${word}</label>`).join('')}</span>`;
      return `<li class="ps-q"><span class="ps-q-l">${esc(qq.label)}${req ? ' <span class="small muted">(required)</span>' : ''}</span>${opts}</li>`;
    };
    const n = q.required.filter((k) => k in q.answers).length;
    const foot = done ? `<p class="small muted">Submitted ${esc(q.at ? fWhen(q.at) : '')}. Your accountant uses it to personalise your checklist.</p>`
      : `<div class="actions">${btn('Submit questionnaire', 'ps.submitQ', { cls: 'primary', data: { case: c.id } })}<span class="small muted">${esc(n + ' of ' + q.required.length + ' required questions answered')}</span></div>`;
    return VK.section('ps-portal-questionnaire', 'Questionnaire', `<ul class="ps-qs">${ENGINE.QUESTIONS.map(row).join('')}</ul>${foot}`, {
      count: done ? null : q.required.length - n,
      intro: esc(done ? 'Thank you: your answers are with your accountant.' : 'Answer for 1 March 2025 to 28 February 2026. A Yes adds the matching document to your checklist.'),
    });
  }
  function itemRow(c, it) {
    const st = ENGINE.itemState(c, it);
    const docs = c.docs.filter((d) => d.itemId === it.id);
    const owed = owedItems(c).includes(it);
    const word = st === 'validated' ? ['Received', 'ok'] : st === 'na' ? ['Not available (approved)', ''] : it.na === 'requested' ? ['Not available: your accountant will confirm', 'info'] : owed ? ['Needed', 'warn'] : ['Being checked', 'warn'];
    const files = docs.map((d) => {
      const w = DOC_WORD[d.status] || [d.status, ''];
      const codes = S.exceptions.filter((x) => x.docId === d.id).map((x) => VK.codeChip(x.code)).join(' ');
      return `<li class="ps-file"><span class="ps-fname">${esc(d.name)}</span> <span class="muted small">${esc(size(d.size))} · ${esc(fWhen(d.at))}</span> ${VK.pill(w[0], w[1])}${codes ? ` <span class="vk-codes ps-codes"><span class="small muted">Raised for your accountant:</span> ${codes}</span>` : ''}</li>`;
    }).join('');
    const can = !(c.submission && c.submission.ok);
    const acts = can ? `<div class="ps-btns">${btn(st === 'validated' ? 'Upload another' : 'Upload', 'ps.pick', { cls: 'sm' + (owed ? ' primary' : ''), data: { case: c.id, item: it.id } })}${btn('Use a sample file', 'ps.sample', { cls: 'sm', data: { case: c.id, item: it.id }, title: 'Demo: uploads ' + (ENGINE.FILE_FOR[it.kind] || it.kind + '_2026.pdf') })}${owed ? btn('Not available', 'ps.na', { cls: 'sm ghost', data: { case: c.id, item: it.id } }) : ''}<span class="small muted ps-dropnote">or drop a file on this row</span></div>` : '';
    // Once the return is submitted the row is no longer a drop target either, so dropping matches the buttons.
    return `<li class="ps-item"${can ? ` data-ps-drop="${esc(it.id)}"` : ''} data-case="${esc(c.id)}"><div class="ps-item-h"><strong>${esc(it.label)}</strong>${VK.pill(word[0], word[1])}</div>${it.na && it.naReason ? `<p class="small muted">Your reason: ${esc(VK.scrub(it.naReason))}</p>` : ''}${files ? `<ul class="ps-files">${files}</ul>` : ''}${acts}</li>`;
  }
  function documentsCard(c) {
    const owed = owedItems(c);
    const body = `<ul class="ps-items">${c.items.map((it) => itemRow(c, it)).join('')}</ul>
      <div class="actions">${btn('Submit documents', 'ps.submitDocs', { cls: 'primary', data: { case: c.id } })}<span class="small muted">${esc(owed.length ? owed.length + ' still needed: anything missing is flagged to your accountant when you submit.' : 'Everything is uploaded or marked not available.')}</span></div>`;
    return VK.section('ps-portal-documents', 'Your documents', body, {
      count: owed.length,
      intro: esc('Upload each document on its row, drop a file onto the row, or say why you do not have it. Simulated: only the file’s name and size are kept; nothing is opened or sent, and the AI check looks at the name and size alone.'),
    });
  }
  function approvalCard(c) {
    const v = ENGINE.curVersion(c); const ap = c.approval; const sub = c.submission && c.submission.ok;
    if (!v) return VK.section('ps-portal-approval', 'Approve your return', VK.empty('Nothing to approve yet. Your accountant is preparing the calculation.'));
    // The client is asked only once the version reaches G06, or to act on an approval already given (withdraw, or re-confirm a
    // withdrawal held while SARS may have the return). Before that the version is still being checked by the firm.
    const asked = ENGINE.currentGate(c) === 'G06' || (ap && ap.version === v.n && !ap.superseded);
    if (!asked && !sub) return VK.section('ps-portal-approval', 'Approve your return', VK.empty('Nothing to approve yet. Your accountant is still checking version ' + v.n + ' of your return; you are asked to approve it here once it is ready.'));
    const s = (c.calc && c.calc.summary) || {};
    const res = typeof s.result === 'number' ? (s.result < 0 ? ['Refund due to you', -s.result] : ['Amount you will owe SARS', s.result]) : null;
    const state = ap ? (ap.withdrawn ? VK.pill('You withdrew your approval of version ' + ap.version + ' ' + fWhen(ap.withdrawn.at), 'bad')
      : ap.superseded || ap.version !== v.n ? VK.pill('Your approval of version ' + ap.version + ' no longer applies: there is a new version', 'warn')
        : VK.pill('You approved version ' + ap.version + ' ' + fWhen(ap.at), 'ok')) : VK.pill('Not approved yet', 'warn');
    const facts = VK.facts([
      ['Version', esc(v.n + ' · ' + fWhen(v.at) + ' · ' + v.reason)],
      ['Taxable income', VK.money(s.taxableIncome)],
      ...(res ? [[res[0], VK.money(res[1])]] : []),
      ['Your approval binds to', `<code class="hash ps-hash" title="SHA-256 of the ITR12 for version ${esc(v.n)}">${esc(v.itr12)}</code>`],
    ]);
    const current = ENGINE.currentApproval(c) && ap.version === v.n;
    const form = sub ? `<p class="note">Your return was submitted to SARS ${esc(fWhen(c.submission.at))} (reference ${esc(c.submission.ref)}). Any change now goes through your accountant, who disputes or corrects it with SARS for you.</p>`
      : `<form data-form="ps.approve" data-case="${esc(c.id)}" data-version="${esc(v.n)}" class="ps-approve" novalidate>
        <blockquote class="ps-decl">${esc(DECLARATION)}</blockquote>
        <label class="ps-check" for="ps-decl"><input type="checkbox" id="ps-decl" name="decl"> I confirm the declaration for version ${esc(v.n)}</label>
        <div class="actions">${current ? '' : `<button type="submit" class="btn primary">Approve version ${esc(v.n)}</button>`}
        ${btn('Something is wrong', 'ps.reject', { data: { case: c.id } })}${current ? btn('Withdraw my approval', 'ps.withdraw', { cls: 'danger', data: { case: c.id } }) : btn('I do not give authority', 'ps.withhold', { cls: 'ghost', data: { case: c.id } })}</div></form>`;
    return VK.section('ps-portal-approval', 'Approve your return', `<div>${state}</div>${facts}${form}`, {
      intro: esc('Your approval is for this exact version. If anything changes later, you are asked again.'),
    });
  }
  function assessmentCard(c) {
    if (!c.ita34) return '';
    // The engine keeps SARS's figures as ita34.values and its comparison with the firm's calculation as ita34.recon.
    const s = c.ita34.values || {};
    const diffs = (c.ita34.recon && c.ita34.recon.diffs) || [];
    const dec = c.decision;
    const body = `${VK.facts([['ITA34', esc(c.ita34.ref) + (c.ita34.date ? ' · ' + VK.date(c.ita34.date) : '')],
      ['SARS result', typeof s.result === 'number' ? VK.money(Math.abs(s.result)) + ` <span class="small muted">${esc(s.result < 0 ? 'refund due to you' : 'payable to SARS')}</span>` : '<span class="muted">Not given</span>'],
      ['Compared with your return', diffs.length ? `<ul class="ps-mini">${diffs.map((d) => `<li>${esc(d.label)}: your return ${VK.money(d.firm)}, SARS ${VK.money(d.sars)}</li>`).join('')}</ul>` : esc('No difference above the firm’s threshold')]])}
      ${dec ? `<p>${VK.pill(dec.choice === 'accept' ? 'You accepted the assessment' : 'You asked your accountant to act', dec.choice === 'accept' ? 'ok' : 'info')} <span class="small muted">${esc(fWhen(dec.at))}${dec.note ? ' · ' + esc(VK.scrub(dec.note)) : ''}</span></p>`
        : `<div class="actions">${btn('Accept the assessment', 'ps.decide', { cls: 'primary', data: { case: c.id, choice: 'accept' } })}${btn('I don’t agree: ask my accountant to act', 'ps.decide', { data: { case: c.id, choice: 'instruct' } })}</div>`}`;
    return VK.section('ps-portal-assessment', 'Your assessment from SARS', body, { intro: esc('SARS’s assessment (simulated). Your accountant checks it against your approved return before you decide.') });
  }
  function remedyCard(c) {
    const r = c.remedy; if (!r || !r.route) return '';
    const label = r.route === 'advice' ? 'Documented advice (no SARS action)' : (SARS_FN[r.route] ? SARS_FN[r.route].label : r.route);
    const authed = r.authority && r.authority.route === r.route;
    const body = `${VK.facts([['What your accountant proposes', esc(label)], ['Deadline', r.deadline ? VK.date(r.deadline) + ' <span class="small muted">16 Dec to 15 Jan not counted</span>' : '<span class="muted">Not set yet</span>']])}
      ${r.route === 'advice' ? '' : authed ? `<p>${VK.pill('You authorised it ' + fWhen(r.authority.at), 'ok')}</p>` : `<div class="actions">${btn('Authorise this', 'ps.authorise', { cls: 'primary', data: { case: c.id } })}</div>`}`;
    return VK.section('ps-portal-remedy', 'Disputing the assessment', body, { intro: esc('Your accountant needs your authority before anything is sent to SARS on your behalf.') });
  }
  function messagesCard(c) {
    const rem = c.reminders.slice().reverse().map((r) => `<div class="vk-row vk-row-log"><span class="vk-when">${VK.when(r.sent)}</span><div class="vk-row-b"><div class="vk-row-t">${esc('Reminder from ' + FIRM + ' (' + r.kind + ')')}</div><div class="vk-meta">${esc('Runs out ' + fWhen(r.expires))}</div></div></div>`);
    const mine = S.audit.filter((a) => a.caseId === c.id && a.role === 'Client').slice(-6).reverse().map((a) => `<div class="vk-row vk-row-log"><span class="vk-when">${VK.when(a.at)}</span><div class="vk-row-b"><div class="vk-row-t">${esc(VK.scrub(a.text))}${a.result === 'Refused' ? ' ' + VK.pill('Refused', 'bad') : ''}</div></div></div>`);
    return VK.section('ps-portal-messages', 'Messages and activity', `<h3 class="ps-h3">From your accountant</h3>${VK.list(rem, { empty: 'No reminders.' })}<h3 class="ps-h3">What you did</h3>${VK.list(mine, { empty: 'Nothing yet.' })}`, {
      intro: esc('Reminders are simulated messages. Everything you do here is recorded in the firm’s audit trail.'),
    });
  }
  function verifyCard(c, cl) {
    return VK.section('ps-portal-verify', 'Confirm it’s you', `<form data-form="ps.verify" data-case="${esc(c.id)}" class="ps-verify" novalidate>
      <p>${esc('Hello ' + first(cl) + '. ' + FIRM + ' has asked for your 2026 tax return details. We sent a one-time code to your mobile number on file.')}</p>
      <label class="f" for="ps-v-code">One-time code<input id="ps-v-code" name="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000"></label>
      <p class="hint">Simulated: no code was sent. The demo code is ${esc(DEMO_CODE)}.</p>
      <p class="err" id="ps-v-err" role="alert"></p>
      <div><button class="btn primary" type="submit">Open my portal</button></div></form>`);
  }

  VIEWS.portal = (id) => {
    const c = ENGINE.caseById(id);
    const back = '<a class="btn sm" href="#papersync">Back to PaperSync</a>';
    if (!c) return VK.page('PaperSync portal', esc('This link does not match a case in the demo. It may be from before the demo was reset.'), VK.section('ps-portal-unknown', 'This link doesn’t work', VK.empty('Ask your accountant to send the link again.')), { key: 'ps-portal', actions: back });
    const cl = ENGINE.clientOf(c);
    const ok = sess().verified.has(c.id);
    const intro = `${esc('Simulated: what ' + cl.name + ' sees for ' + c.id + '. Everything here is the client’s own action, recorded as “' + cl.name + ' (PaperSync portal)”. Nothing is sent anywhere.')} ${VK.caseLink(c, 'Firm view of ' + c.id)}`;
    const body = ok ? stepsBlock(c) + questionnaireCard(c) + documentsCard(c) + approvalCard(c) + assessmentCard(c) + remedyCard(c) + messagesCard(c) : verifyCard(c, cl);
    return VK.page('PaperSync portal · ' + cl.name, intro, body, { key: 'ps-portal', actions: back });
  };

  /* ---------- uploads: one hidden file input outside #app, so a re-render never destroys it mid-pick ---------- */
  function fileInput() {
    let el = document.getElementById('ps-file');
    if (!el) {
      el = document.createElement('input');
      el.type = 'file'; el.id = 'ps-file'; el.hidden = true; el.tabIndex = -1; el.setAttribute('aria-hidden', 'true');
      el.addEventListener('change', () => {
        const f = el.files && el.files[0]; const t = sess().target; SESS.target = null;
        if (f && t) upload(t.caseId, t.itemId, f);
        el.value = '';
      });
      document.body.appendChild(el);
    }
    return el;
  }
  // Only the name and size of the file are passed on; the file itself is never read.
  function upload(caseId, itemId, f) {
    const c = ENGINE.caseById(caseId);
    if (!c || !sess().verified.has(c.id)) { toast('Open the portal and confirm the one-time code first.'); return; }
    const r = ENGINE.portal(c, 'upload', { itemId, file: { name: String(f.name), size: +f.size || 0 } });
    const d = r && r.doc; const w = d ? (DOC_WORD[d.status] || [d.status])[0] : '';
    VK.done(r, 'Uploaded ' + (d ? d.name + ': ' + w.toLowerCase() : '') + ' (simulated AI check on the name and size only).');
  }
  const hasFiles = (e) => { try { return !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'); } catch (x) { return false; } };
  const onPortal = () => { try { return routeOf().name === 'portal'; } catch (x) { return false; } };
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e) || !onPortal()) return;
    e.preventDefault();
    const row = e.target.closest && e.target.closest('[data-ps-drop]');
    $$('.ps-over').forEach((x) => { if (x !== row) x.classList.remove('ps-over'); });
    if (row) { row.classList.add('ps-over'); e.dataTransfer.dropEffect = 'copy'; } else e.dataTransfer.dropEffect = 'none';
  });
  document.addEventListener('dragleave', (e) => { const row = e.target.closest && e.target.closest('[data-ps-drop]'); if (row && !row.contains(e.relatedTarget)) row.classList.remove('ps-over'); });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e) || !onPortal()) return;
    e.preventDefault();
    $$('.ps-over').forEach((x) => x.classList.remove('ps-over'));
    const row = e.target.closest && e.target.closest('[data-ps-drop]');
    if (!row) { toast('Drop the file on the document it belongs to.'); return; }
    const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
    upload(row.dataset.case, row.dataset.psDrop, f);
  });

  /* ---------- simulated messages (the old module's WhatsApp, email and link) ---------- */
  function shareModal(c, ch) {
    const cl = ENGINE.clientOf(c); const kind = remindKind(c); const what = owesText(c) || 'nothing at the moment';
    const link = simLink(c);
    const msg = ch === 'email'
      ? 'Subject: Your 2026 tax return: action needed\n\nDear ' + first(cl) + ',\n\n' + FIRM + ' needs the following from you: ' + what + '.\n\nPlease open your PaperSync portal: ' + link + '\n\nKind regards\n' + me().name
      : ch === 'whatsapp' ? 'Hi ' + first(cl) + ', ' + FIRM + ' needs: ' + what + '. Open your PaperSync portal: ' + link + ' Thank you!' : link;
    const title = ch === 'email' ? 'Send by email' : ch === 'whatsapp' ? 'Send by WhatsApp' : 'Copy portal link';
    const note = ch === 'link' ? 'A simulated link: it only works inside this preview (Open portal).'
      : 'To ' + cl.name + '’s ' + (ch === 'email' ? 'email address' : 'mobile number') + ' on file. Simulated: nothing is sent.' + (kind ? ' Marking it as sent records a PaperSync ' + kind + ' reminder.' : ' Only onboarding and approval reminders can be recorded in the preview, so this message is copy-only.');
    const field = ch === 'link' ? `<input id="ps-share-text" readonly class="mono" value="${esc(msg)}" aria-label="Portal link">` : `<label class="f" for="ps-share-text">Message<textarea id="ps-share-text" readonly>${esc(msg)}</textarea></label>`;
    const send = ch !== 'link' && kind;
    modal(title, `<p class="small muted">${esc(note)}</p>${field}`, send ? 'Mark as sent (simulated)' : null,
      send ? () => fin(ENGINE.remind(c, kind, ACTOR.me()), 'Recorded a PaperSync ' + kind + ' reminder to ' + cl.name + ' by ' + (ch === 'email' ? 'email' : 'WhatsApp') + ' (simulated).') : null,
      { extra: '<button type="button" class="btn" data-act="copy" data-src="ps-share-text">Copy</button>' });
  }
  function reasonModal(c, title, label, action, okMsg, o) {
    o = o || {};
    modal(title, `${o.html || ''}<label class="f" for="ps-reason">${esc(label)}<textarea id="ps-reason" name="reason" maxlength="500"></textarea></label><p class="hint">${esc(o.hint || 'Recorded in the firm’s audit trail as your action in the PaperSync portal.')}</p>`, o.submit || 'Send', (fd) => {
      const reason = String(fd.reason || '').trim();
      if (!reason && !o.optional) return 'Say why first.';
      return fin(o.call ? o.call(reason) : ENGINE.portal(c, action, { reason }), okMsg);
    }, { danger: !!o.danger });
  }

  /* ---------- actions ---------- */
  Object.assign(ACT, {
    'ps.remind': (t) => { const c = caseFrom(t); if (!c) return; const kind = t.dataset.kind; VK.done(ENGINE.remind(c, kind, ACTOR.me()), 'Sent a PaperSync ' + kind + ' reminder to ' + VK.clientName(c.clientId) + ' (simulated).'); },
    'ps.share': (t) => { const c = caseFrom(t); if (c) shareModal(c, ['whatsapp', 'email', 'link'].includes(t.dataset.ch) ? t.dataset.ch : 'link'); },
    'ps.kyc': (t) => {
      const cl = S.clients.find((x) => x.id === t.dataset.client); if (!cl) { toast('That client is no longer here.'); render(); return; }
      const k = cl.kyc.find((x) => x.key === t.dataset.key);
      VK.done(ENGINE.setKyc(cl, t.dataset.key, true, ACTOR.me()), 'Marked as received: ' + (k ? k.label : t.dataset.key) + ' for ' + cl.name + '.');
    },
    'ps.approveNa': (t) => { const c = caseFrom(t); if (!c) return; const it = c.items.find((x) => x.id === t.dataset.item); VK.done(ENGINE.approveNa(c, t.dataset.item, ACTOR.me()), 'Approved: ' + (it ? it.label : '') + ' is not available for ' + c.id + '.'); },
    // Portal actions: always the client, through ENGINE.portal().
    'ps.pick': (t) => { const c = caseFrom(t); if (!c) return; sess().target = { caseId: c.id, itemId: t.dataset.item }; const el = fileInput(); el.value = ''; el.click(); },
    'ps.sample': (t) => { const c = caseFrom(t); if (!c) return; const it = c.items.find((x) => x.id === t.dataset.item); if (!it) return; upload(c.id, it.id, { name: ENGINE.FILE_FOR[it.kind] || it.kind + '_2026.pdf', size: SAMPLE_SIZE }); },
    'ps.na': (t) => { const c = caseFrom(t); if (!c) return; const it = c.items.find((x) => x.id === t.dataset.item); if (!it) return;
      reasonModal(c, 'Not available: ' + it.label, 'Why don’t you have it?', 'na', 'Sent your reason to your accountant.', { call: (reason) => ENGINE.portal(c, 'na', { itemId: it.id, reason }), hint: 'Your accountant confirms the reason. Until then the document still counts as needed.' }); },
    'ps.submitQ': (t) => { const c = caseFrom(t); if (c) VK.done(ENGINE.portal(c, 'submitQuestionnaire'), 'Questionnaire submitted. Your checklist is updated.'); },
    'ps.submitDocs': (t) => {
      const c = caseFrom(t); if (!c) return;
      const r = ENGINE.portal(c, 'submitDocs');
      // What is still owed after the call, not only what this call newly flagged: a second submit must not say everything is in.
      const miss = owedItems(c).map((it) => it.label);
      VK.done(r, miss.length ? 'Sent. Still needed: ' + miss.join('; ') + ' (flagged to your accountant as DOC-01).' : 'Sent. Your accountant has been told everything is in.');
    },
    'ps.reject': (t) => { const c = caseFrom(t); if (c) reasonModal(c, 'Something is wrong', 'What is wrong?', 'reject', 'Sent to your accountant (CLT-02).'); },
    'ps.withhold': (t) => { const c = caseFrom(t); if (c) reasonModal(c, 'I do not give authority', 'Why not? (optional)', 'withhold', 'Recorded: you have not given authority to submit.', { optional: true, danger: true, submit: 'Withhold authority', call: (reason) => ENGINE.portal(c, 'withhold', reason ? { reason } : {}) }); },
    'ps.withdraw': (t) => { const c = caseFrom(t); if (c) reasonModal(c, 'Withdraw my approval', 'Why are you withdrawing it? (optional)', 'withdraw', 'Your approval is withdrawn. Your accountant has been told.', { optional: true, danger: true, submit: 'Withdraw approval' }); },
    'ps.decide': (t) => {
      const c = caseFrom(t); if (!c) return;
      if (t.dataset.choice === 'accept') { VK.done(ENGINE.portal(c, 'decide', { choice: 'accept' }), 'You accepted the assessment.'); return; }
      reasonModal(c, 'Ask your accountant to act', 'What do you disagree with?', 'decide', 'Sent to your accountant: they will propose a remedy.', { call: (note) => ENGINE.portal(c, 'decide', { choice: 'instruct', note }) });
    },
    'ps.authorise': (t) => { const c = caseFrom(t); if (c) VK.done(ENGINE.portal(c, 'authorise'), 'You authorised your accountant to act.'); },
  });
  Object.assign(FORMS, {
    'ps.verify': (f) => {
      const c = ENGINE.caseById(f.dataset.case); if (!c) { render(); return; }
      const code = String(f.elements.code.value || '').trim();
      if (code !== DEMO_CODE) { $('#ps-v-err').textContent = 'That code does not match. In the demo the code is ' + DEMO_CODE + '.'; return; }
      sess().verified.add(c.id);
      ENGINE.portal(c, 'verify');  // audited as the client
      toast('Portal opened for ' + VK.clientName(c.clientId) + ' (simulated one-time code).');
      render();
    },
    'ps.approve': (f) => {
      const c = ENGINE.caseById(f.dataset.case); if (!c) { render(); return; }
      VK.done(ENGINE.portal(c, 'approve', { version: +f.dataset.version, declaration: !!(f.elements.decl && f.elements.decl.checked) }), 'Approved version ' + f.dataset.version + '. Your accountant can now prepare the submission.');
    },
  });
  EXT_FIELD['ps.answer'] = (el) => {
    const c = ENGINE.caseById(el.dataset.case); if (!c) return undefined;
    const r = ENGINE.portal(c, 'answer', { key: el.dataset.key, value: el.dataset.v === '1' });
    if (!r.ok) toast('Not done: ' + r.why);
    return undefined;
  };
})();
