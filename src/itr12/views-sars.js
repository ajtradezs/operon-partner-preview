/* SARS link (simulated): the link's status, the transaction log (S.txs) with each open transaction's eight G18 checks and blockers,
   the two-person sign-off, sending with a chosen simulated outcome, the no-blind-retry rule (check the status before any retry,
   INT-04), the manual fallback (INT-13) and its independent reconciliation, and the inbound items (S.inbound) with routing and
   date confirmation, and "Simulate SARS sending an ITA34" for a submitted return (ENGINE.receive: SARS acts, not the signed-in
   person). Nothing here connects to SARS. Every other button calls ENGINE with ACTOR.me(); a refusal shows ENGINE's reason.
   Locked buttons say which role acts; ENGINE checks the role again whatever the screen shows. */
(() => {
  const finish = (r, msg) => (r && r.ok ? () => VK.done(r, msg) : 'Not done: ' + ((r && r.why) || 'Operon refused this.'));
  const IA = 'Integration Administrator'; const TC = 'Tax Consultant';
  const OPEN_TX = ['awaiting G18', 'ready', 'unknown', 'no-response', 'manual', 'blocked', 'not processed'];
  const TX_STATUS = {
    'awaiting G18': ['Awaiting G18', 'warn'], ready: ['Signed, ready to send', 'info'], success: ['Accepted by SARS', 'ok'], rejected: ['Rejected by SARS', 'bad'],
    unknown: ['Status unknown', 'bad'], 'no-response': ['No reference back', 'bad'], manual: ['Filed manually, to reconcile', 'warn'], 'not processed': ['Not processed', 'warn'],
    superseded: ['Superseded by a retry', ''], blocked: ['Blocked: unsupported', 'bad'], cancelled: ['Cancelled', ''],
  };
  const txPill = (t) => { const s = TX_STATUS[t.status] || [t.status, '']; return VK.pill(s[0], s[1]); };
  const txNow = (t) => { const x = ENGINE.txById(t.dataset.tx); if (!x) { toast('That SARS transaction is no longer here.'); render(); } return x; };
  // A button for one role only: other roles see it locked, with who acts. ENGINE enforces the role again.
  const roleBtn = (roles, label, act, o) => btn(label, act, Object.assign({}, o, { lock: [].concat(roles).includes(S.role) ? null : [].concat(roles).join(' or ') + ' only' }));
  const openEx = (t, code) => S.exceptions.find((x) => x.txId === t.id && x.code === code && ENGINE.isOpen(x)) || null;
  const openInt15 = (it) => S.exceptions.find((x) => x.code === 'INT-15' && x.inboundId === it.id && ENGINE.isOpen(x)) || null;

  /* ---------- link status ---------- */
  function linkBlock() {
    const L = S.link;
    const rows = [
      ['up', 'SARS interface', L.up ? ['Up', 'ok'] : ['Down', 'bad'], L.up ? 'Take it down' : 'Bring it back', 'A send while it is down raises INT-03; the Tax Consultant may then file manually (INT-13).'],
      ['auth', 'Authentication', L.auth ? ['Working', 'ok'] : ['Failing', 'bad'], L.auth ? 'Make it fail' : 'Restore it', 'A G18 sign-off while it fails raises INT-01; check 3 fails.'],
      ['rights', 'eFiling rights', L.rights ? ['In place', 'ok'] : ['Missing', 'bad'], L.rights ? 'Remove them' : 'Restore them', 'A G18 sign-off while they are missing raises INT-02; check 3 fails.'],
    ];
    const table = VK.table([{ label: 'Part' }, { label: 'Status' }, { label: 'What it affects' }, { label: '', cls: 'vk-act' }],
      rows.map(([k, label, st, act, note]) => [esc(label), VK.pill(st[0], st[1]), `<span class="small">${esc(note)}</span>`, roleBtn(IA, act, 'ops.link', { cls: 'sm', data: { k, v: L[k] ? '0' : '1' } })]),
      { caption: 'Simulated SARS link status' });
    return VK.section('ops-sars-link', 'Link status (simulated)', table, {
      intro: esc('In real life SARS and the platform team decide these. In the preview the Integration Administrator can switch them to try the failure paths. Each change is audited.'),
    });
  }

  /* ---------- transaction log ---------- */
  function txActions(t) {
    const out = [];
    switch (t.status) {
      case 'awaiting G18': {
        const signedMine = t.signoffs.some((s) => s.role === S.role);
        if (signedMine) out.push(`<span class="lock">${I.hourglass}${esc('You signed. The ' + (S.role === IA ? TC : IA) + ' signs next.')}</span>`);
        else out.push(roleBtn([IA, TC], 'Sign G18', 'vk.release', { cls: 'sm', data: { case: t.caseId, gate: 'G18', tx: t.id } }));
        break;
      }
      case 'ready':
        out.push(roleBtn(IA, 'Send to SARS', 'ops.tx.send', { cls: 'sm primary', data: { tx: t.id } }));
        if (!S.link.up || openEx(t, 'INT-03')) out.push(roleBtn(TC, 'Record manual filing', 'ops.tx.manual', { cls: 'sm', data: { tx: t.id } }));
        break;
      case 'unknown': case 'no-response':
        out.push(roleBtn(IA, 'Check SARS status', 'ops.tx.check', { cls: 'sm primary', data: { tx: t.id } }));
        out.push(roleBtn(IA, 'Retry', 'ops.tx.retry', { cls: 'sm', data: { tx: t.id }, title: 'Refused until the status is checked: unknown calls are never retried blindly' }));
        break;
      case 'not processed':
        out.push(roleBtn(IA, 'Retry under a fresh G18', 'ops.tx.retry', { cls: 'sm', data: { tx: t.id } }));
        break;
      case 'manual': {
        const x = openEx(t, 'INT-13');
        if (x) out.push(btn('Reconcile independently', 'ops.fbRecon', { cls: 'sm primary', data: { ex: x.id } }));
        break;
      }
      case 'blocked':
        out.push(roleBtn(TC, 'Record manual filing', 'ops.tx.manual', { cls: 'sm', data: { tx: t.id } }));
        break;
      default: break;
    }
    return out.length ? `<span class="ops-btns">${out.join('')}</span>` : '';
  }
  function logBlock() {
    const txs = S.txs.slice().reverse();
    const codes = (t) => { const xs = S.exceptions.filter((x) => x.txId === t.id); return xs.length ? `<div class="vk-codes">${xs.map((x) => VK.codeChip(x.code, x) + (ENGINE.isOpen(x) ? '' : '<span class="small muted">done</span>')).join(' ')}</div>` : ''; };
    const signed = (t) => (t.signoffs.length ? t.signoffs.map((s) => `<div class="small">${esc(VK.who(s.id))} <span class="muted">(${esc(s.role)})</span></div>`).join('') : '<span class="small muted">Nobody yet</span>');
    const result = (t) => {
      const parts = [];
      if (t.ref) parts.push(`<div class="small">Reference <span class="mono">${esc(t.ref)}</span></div>`);
      if (t.manual) parts.push(`<div class="small">Manual reference <span class="mono">${esc(VK.scrub(t.manual.ref))}</span> · ${esc(VK.who(t.manual.by))}</div>`);
      if (t.attempts.length) parts.push(`<div class="small muted">${esc(plural(t.attempts.length, 'send'))}, last ${VK.when(t.attempts[t.attempts.length - 1].at)}</div>`);
      if (t.parentTx) parts.push(`<div class="small muted">Retry of ${esc(t.parentTx)}</div>`);
      return parts.join('');
    };
    const table = VK.table([{ label: 'Transaction' }, { label: 'Case' }, { label: 'Status' }, { label: 'G18 sign-off' }, { label: 'Result' }, { label: '', cls: 'vk-act' }],
      txs.map((t) => ({ cls: OPEN_TX.includes(t.status) ? 'ops-live' : '', cells: [
        `<span class="mono">${esc(t.id)}</span> ${esc(t.label)}<div class="small muted">${esc(t.gate)} · version ${esc(t.version)} · queued ${VK.when(t.created)}</div>`,
        VK.caseWho(t.caseId), txPill(t) + codes(t), signed(t), result(t), txActions(t)] })),
      { caption: 'SARS transaction log (simulated)', empty: 'No SARS transactions yet.' });
    return VK.section('ops-sars-txs', 'Transaction log', table, {
      count: txs.filter((t) => OPEN_TX.includes(t.status)).length,
      intro: esc('Every outbound call, newest first. The Integration Administrator sends; the outcome is chosen by you, because the SARS side is simulated.'),
    });
  }

  /* ---------- the eight G18 checks for each open transaction ---------- */
  function checksBlock() {
    const txs = S.txs.filter((t) => OPEN_TX.includes(t.status)).reverse();
    const card = (t) => {
      const ck = ENGINE.g18Checks(t); const gb = ENGINE.g18Blockers(t); const bad = ck.filter((k) => !k.ok).length;
      return `<div class="ops-tx"><div class="row"><span class="mono">${esc(t.id)}</span><strong>${esc(t.label)}</strong>${txPill(t)}</div>
        <div class="vk-meta">${VK.caseWho(t.caseId)}<span>${esc(bad ? bad + ' of 8 checks fail' : 'All 8 checks pass')}</span></div>
        <ol class="vk-checks">${ck.map((k) => `<li class="${k.ok ? 'ok' : 'bad'}">${k.ok ? I.check : I.alert}<span>${esc(k.n + '. ' + k.label)}${k.ok ? '' : `<br><span class="err">${esc(VK.scrub(k.why))}</span>`}</span></li>`).join('')}</ol>
        ${gb.length ? `<p class="err small">Also blocked by ${esc(gb.map(VK.scrub).join(', '))}</p>` : ''}</div>`;
    };
    return VK.section('ops-sars-checks', 'G18 checks on open transactions', txs.length ? `<div class="ops-txgrid">${txs.map(card).join('')}</div>` : VK.empty('No open transactions.'), {
      count: txs.length,
      intro: esc('The eight checks from the master workflow document (step 17), worked out now by the gate engine. Both people must sign while all eight pass, and they are checked again before anything is sent.'),
    });
  }

  /* ---------- inbound ---------- */
  function inboundBlock() {
    const items = S.inbound.slice().reverse();
    const iacts = (it) => {
      const out = [];
      if (it.status === 'unrouted') out.push(roleBtn(IA, 'Route to a case', 'ops.in.route', { cls: 'sm primary', data: { in: it.id } }));
      // INT-15: one person confirms the dates from the notice, then a different person reconciles them. Nothing once it is done.
      const int15 = openInt15(it);
      if (int15 && !int15.fallback.recorded) out.push(roleBtn([IA, TC], 'Confirm dates', 'ops.in.date', { cls: 'sm', data: { in: it.id } }));
      else if (int15 && !int15.fallback.reconciled) out.push(btn('Reconcile dates', 'ops.fbRecon', { cls: 'sm', data: { ex: int15.id }, title: 'A different person from the one who confirmed them' }));
      return out.length ? `<span class="ops-btns">${out.join('')}</span>` : '';
    };
    const who = (it) => { const cl = S.clients.find((x) => x.taxRef === it.taxRef); return `${VK.taxRefHtml(it.taxRef)}${cl ? `<div class="small">${VK.clientLink(cl)}</div>` : '<div class="small muted">No client with this tax reference</div>'}<div class="small muted">Tax year ${esc(it.year || '—')}</div>`; };
    const where = (it) => {
      const xs = S.exceptions.filter((x) => x.inboundId === it.id);
      const chips = xs.length ? `<div class="vk-codes">${xs.map((x) => VK.codeChip(x.code, x)).join(' ')}</div>` : '';
      return (it.caseId ? `${VK.pill('Routed', 'ok')} ${VK.caseWho(it.caseId)}` : VK.pill(it.status === 'unrouted' ? 'Not matched to a case' : it.status, 'bad')) + chips;
    };
    const dates = (it) => {
      const rawText = it.raw ? [it.raw.date ? 'date “' + it.raw.date + '”' : '', it.raw.due ? 'due “' + it.raw.due + '”' : ''].filter(Boolean).join(', ') : '';
      const x15 = openInt15(it);
      const raw = !it.raw ? '' : (x15 && !x15.fallback.recorded ? `<div class="small err">${esc('Unreadable on the notice: ' + rawText)}</div>`
        : `<div class="small muted">${esc('Received as ' + rawText + '; ' + (x15 ? 'confirmed from the notice, to reconcile' : 'confirmed from the notice'))}</div>`);
      return `<div class="small">Dated ${VK.date(it.date)}</div>${it.due ? `<div class="small">Due ${VK.date(it.due)}</div>` : ''}${raw}`;
    };
    const table = VK.table([{ label: 'Item' }, { label: 'Taxpayer' }, { label: 'Case' }, { label: 'Dates' }, { label: '', cls: 'vk-act' }],
      items.map((it) => [`${esc(it.label)} <span class="mono small">${esc(it.ref || it.id)}</span><div class="small muted">${esc(it.id)} · received ${VK.when(it.at)} · hash <span class="mono">${esc(String(it.hash || '').slice(0, 12))}…</span></div>`,
        who(it), where(it), dates(it), iacts(it)]),
      { caption: 'Inbound items from SARS (simulated)', empty: 'Nothing has arrived from SARS.' });
    const waiting = awaitingIta34();
    return VK.section('ops-sars-inbound', 'Inbound from SARS', table, {
      count: items.filter((it) => it.status === 'unrouted').length || null,
      intro: esc('Notices, assessments and requests, newest first. Each is hashed and matched to a case by tax reference and year; one that matches no case raises INT-14 and waits for the Integration Administrator. An unreadable date is never guessed (INT-15). '
        + (waiting.length ? plural(waiting.length, 'submitted return') + ' ' + (waiting.length === 1 ? 'waits' : 'wait') + ' for SARS’s assessment: “Simulate SARS sending an ITA34” plays SARS’s part.' : 'No submitted return is waiting for SARS’s assessment.')),
      actions: waiting.length ? btn('Simulate SARS sending an ITA34', 'ops.in.ita34', { cls: 'sm', id: 'ops-sim-ita34' }) : '',
    });
  }

  // Submitted returns with no assessment yet: the ones the simulated SARS can send an ITA34 for.
  const awaitingIta34 = () => S.cases.filter((c) => !c.archived && c.submission && c.submission.ok && !c.ita34 && !c.pendingIta34 && c.calc && c.calc.summary);

  /* ---------- the rules on this link ---------- */
  function rulesBlock() {
    const rule = (codes, text) => `<div class="vk-row"><span class="vk-codes">${codes.map((c) => VK.codeChip(c)).join(' ')}</span><div class="vk-row-b"><div class="vk-row-t">${esc(text)}</div></div></div>`;
    const items = [
      rule(['G18'], 'Two different people sign every outbound transaction: the Integration Administrator and the Tax Consultant, each only while all eight checks pass.'),
      rule(['INT-11'], 'A call made before its substantive gate (G09, G10, G11 or G15) has passed is blocked as a gate-bypass attempt (S1).'),
      rule(['INT-04', 'INT-05'], 'When the outcome is unknown there is no retry until “Check SARS status” has reconciled it, and a second filing of the same return is refused as a duplicate.'),
      rule(['INT-09', 'SUB-01'], 'A rejection re-opens the gate behind the transaction; the return is fixed and goes through G18 again.'),
      rule(['INT-10', 'SUB-03'], 'If SARS processes it but no reference comes back, the status is checked before anything else happens.'),
      rule(['INT-03', 'INT-13'], 'When the interface is down after G18, the Tax Consultant may file manually; a different person then reconciles that filing to the case.'),
      rule(['INT-14', 'INT-15'], 'An inbound item that matches no case, or carries an unreadable date, waits for a person to route it or confirm the date from the notice.'),
    ];
    return VK.section('ops-sars-rules', 'How the link is guarded', VK.list(items), { intro: esc('The rules the gate engine applies on this link, from Johan’s register.') });
  }

  VIEWS.sars = () => {
    const intro = esc('The SARS link is simulated: nothing here connects to SARS or eFiling. ' + S.role + ' · ' + me().name + '. The Integration Administrator runs the link; the Tax Consultant co-signs G18 and may file manually when the link is down.');
    return VK.page('SARS link', intro, linkBlock() + logBlock() + checksBlock() + inboundBlock() + rulesBlock(), { key: 'ops-sars' });
  };

  /* ---------- actions ---------- */
  function actLink(t) {
    const k = t.dataset.k; if (!['up', 'auth', 'rights'].includes(k)) return;
    const on = t.dataset.v === '1';
    VK.done(ENGINE.setLink({ [k]: on }, ACTOR.me()), 'SARS link (simulated): ' + ({ up: 'interface', auth: 'authentication', rights: 'eFiling rights' }[k]) + (on ? ' restored.' : ' switched off.'));
  }
  const OUTCOMES = [
    ['success', 'SARS accepts it', 'A SARS reference comes back.'],
    ['reject', 'SARS rejects it', 'Raises INT-09 and SUB-01 and re-opens the gate.'],
    ['unknown', 'Timeout: outcome unknown', 'Raises INT-04. No retry until the status is checked.'],
    ['no-response', 'Processed, but no reference back', 'Raises INT-10 and SUB-03.'],
  ];
  function actSend(t) {
    const tx = txNow(t); if (!tx) return;
    const ck = ENGINE.g18Checks(tx); const bad = ck.filter((k) => !k.ok);
    modal('Send ' + tx.id + ' to SARS (simulated)', `${VK.facts([['Transaction', esc(tx.id + ' · ' + tx.label + ' · version ' + tx.version)], ['Case', esc(tx.caseId + ' · ' + VK.clientName(tx.clientId))],
      ['G18', esc(tx.signoffs.map((s) => VK.who(s.id) + ' (' + s.role + ')').join(' and '))], ['Checks now', esc(bad.length ? bad.length + ' of 8 fail' : 'All 8 pass')]])}
      <fieldset class="ops-radios"><legend class="small muted">What the simulated SARS does</legend>
      ${OUTCOMES.map(([v, label, note], i) => `<label><input type="radio" name="outcome" value="${v}"${i === 0 ? ' checked' : ''}> <span><strong>${esc(label)}</strong><br><span class="small muted">${esc(note)}</span></span></label>`).join('')}</fieldset>
      <p class="hint">Operon re-checks the gates and the eight G18 checks before sending. Nothing leaves the browser.</p>`,
    'Send', (fd) => {
      const o = String(fd.outcome || 'success');
      return finish(ENGINE.transmit(tx, ACTOR.me(), o), 'Sent ' + tx.id + ': ' + (OUTCOMES.find((x) => x[0] === o) || [o, o])[1].toLowerCase() + ' (simulated).');
    });
  }
  function actCheck(t) {
    const tx = txNow(t); if (!tx) return;
    const codes = S.exceptions.filter((x) => x.txId === tx.id && ENGINE.isOpen(x) && ['INT-04', 'INT-10', 'SUB-03'].includes(x.code)).map((x) => x.code);
    const closes = codes.length ? ' and resolve ' + codes.join(' and ') : '';
    modal('Check the SARS status of ' + tx.id, `<p>${esc(tx.label + ' for ' + tx.caseId + ' is ' + (TX_STATUS[tx.status] || [tx.status])[0].toLowerCase() + '.')} ${esc('Operon never retries it blindly: first confirm what SARS has.')}</p>
      <fieldset class="ops-radios"><legend class="small muted">What SARS’s records show (simulated)</legend>
      <label><input type="radio" name="truth" value="processed" checked> <span><strong>Processed</strong><br><span class="small muted">${esc('The return is with SARS: record its reference' + closes + '.')}</span></span></label>
      <label><input type="radio" name="truth" value="not processed"> <span><strong>Not processed</strong><br><span class="small muted">${esc('SARS does not have it' + (codes.length ? ': Operon resolves ' + codes.join(' and ') + ', and' : ':') + ' a retry is allowed under a fresh G18.')}</span></span></label></fieldset>`,
    'Record status', (fd) => finish(ENGINE.checkStatus(tx, ACTOR.me(), fd.truth === 'not processed' ? 'not processed' : 'processed'), 'Checked the SARS status of ' + tx.id + '.'));
  }
  const actRetry = (t) => { const tx = txNow(t); if (!tx) return; const r = ENGINE.retry(tx, ACTOR.me()); VK.done(r, r.ok && r.tx ? 'Retry queued as ' + r.tx.id + '; it needs a fresh G18.' : ''); };
  function actManual(t) {
    const tx = txNow(t); if (!tx) return;
    modal('Record a manual filing for ' + tx.id, `<p>${esc('Use this only when the SARS interface is down after G18 (INT-03), or for a function outside the interface once the alternative channel is approved (INT-08). It raises INT-13; a different person then reconciles it.')}</p>
      <label class="f" for="ops-man-ref">Reference from the manual channel (required)<input id="ops-man-ref" name="ref" maxlength="80" autocomplete="off" placeholder="For example the eFiling case number"></label>
      <label class="f" for="ops-man-note">Note (optional)<input id="ops-man-note" name="note" maxlength="300" autocomplete="off"></label>`,
    'Record manual filing', (fd) => {
      const ref = String(fd.ref || '').trim(); if (!ref) return 'Give the reference from the manual channel.';
      return finish(ENGINE.manualFallback(tx, ACTOR.me(), { ref, note: String(fd.note || '').trim() }), 'Recorded the manual filing for ' + tx.id + ' (INT-13). Someone else reconciles it.');
    });
  }
  const inNow = (t) => { const it = S.inbound.find((x) => x.id === t.dataset.in); if (!it) { toast('That inbound item is no longer here.'); render(); } return it; };
  function actRoute(t) {
    const it = inNow(t); if (!it) return;
    const cases = S.cases.slice().sort((p, q) => p.id.localeCompare(q.id));
    modal('Route ' + it.id + ' to a case', `${VK.facts([['Item', esc(it.label + ' ' + (it.ref || ''))], ['Tax reference', VK.taxRefHtml(it.taxRef)], ['Tax year', esc(it.year || '—')]])}
      <label class="f" for="ops-route-case">Case<select id="ops-route-case" name="case">${cases.map((c) => `<option value="${esc(c.id)}">${esc(c.id + ' · ' + VK.clientName(c.clientId) + ' · ' + c.year)}</option>`).join('')}</select></label>
      <p class="hint">Operon checks that the tax reference and the year match the case before routing it.</p>`,
    'Route', (fd) => finish(ENGINE.routeInbound(it, String(fd.case || ''), ACTOR.me()), 'Routed ' + it.id + ' to ' + fd.case + '.'));
  }
  function actDate(t) {
    const it = inNow(t); if (!it) return;
    const raw = it.raw || {};
    modal('Confirm the dates on ' + it.id, `<p>${esc('Read the dates from the notice itself. A different person then reconciles them (INT-15) before any deadline runs.')}</p>
      ${raw.date || raw.due ? `<p class="note">${esc('As received: ' + [raw.date ? 'date “' + raw.date + '”' : '', raw.due ? 'due “' + raw.due + '”' : ''].filter(Boolean).join(', '))}</p>` : ''}
      <label class="f" for="ops-in-date">Date on the notice<input id="ops-in-date" name="date" type="date" value="${esc(it.date || '')}"></label>
      <label class="f" for="ops-in-due">Due date (if any)<input id="ops-in-due" name="due" type="date" value="${esc(it.due || '')}"></label>`,
    'Confirm dates', (fd) => finish(ENGINE.confirmInboundDate(it, ACTOR.me(), { date: String(fd.date || ''), due: String(fd.due || '') }), 'Confirmed the dates on ' + it.id + '.'));
  }
  // The simulated SARS issues the assessment (ITA34) for a submitted return: the firm's approved figures, or with one figure
  // changed to show a difference (ASM-02). ENGINE.receive records SARS as the actor and routes it to the case by tax reference and year.
  function actIta34(t) {
    const cases = awaitingIta34();
    if (!cases.length) { toast('No submitted return is waiting for an assessment.'); render(); return; }
    const pre = cases.find((c) => c.id === (t.dataset.case || '')) || cases[0];
    const today = ENGINE.isoDay(now());
    modal('Simulate SARS sending an ITA34', `<p class="note">${esc('This plays SARS’s part: nothing is received from SARS. Operon records it as SARS (simulated) and compares it figure by figure with the approved calculation (G12).')}</p>
      <label class="f" for="ops-ita-case">Submitted return<select id="ops-ita-case" name="case">${cases.map((c) => `<option value="${esc(c.id)}"${c === pre ? ' selected' : ''}>${esc(c.id + ' · ' + VK.clientName(c.clientId) + ' · ' + c.year + ' · reference ' + c.submission.ref)}</option>`).join('')}</select></label>
      <label class="f" for="ops-ita-date">Date of assessment<input id="ops-ita-date" name="date" type="date" value="${esc(today)}"></label>
      <fieldset class="ops-radios"><legend class="small muted">What SARS assesses (simulated)</legend>
        <label><input type="radio" name="how" value="same" checked> <span><strong>The firm’s approved figures</strong><br><span class="small muted">The assessment agrees with the approved calculation.</span></span></label>
        <label><input type="radio" name="how" value="diff"> <span><strong>One figure differs</strong><br><span class="small muted">${esc('SARS uses a different amount for the figure below; a difference over ' + CALC.rand(S.policy.materiality.amount) + ' raises ASM-02.')}</span></span></label></fieldset>
      <div class="ops-ita-diff"><label class="f" for="ops-ita-field">Figure that differs<select id="ops-ita-field" name="field">${ITA34_FIELDS.map((f) => `<option value="${esc(f.key)}">${esc(f.label)}</option>`).join('')}</select></label>
      <label class="f" for="ops-ita-amount">SARS’s amount (rand)<input id="ops-ita-amount" name="amount" inputmode="decimal" autocomplete="off"></label></div>`,
    'Send the ITA34 (simulated)', (fd) => {
      const c = cases.find((x) => x.id === String(fd.case || ''));
      if (!c || !awaitingIta34().includes(c)) return 'Pick a submitted return that has no assessment yet.';
      const date = String(fd.date || '');
      if (!DATES.dt(date)) return 'Give the date of assessment.';
      const data = Object.assign({}, c.calc.summary);
      if (fd.how === 'diff') {
        const key = String(fd.field || ''); const raw = String(fd.amount || '').replace(/[\sR,]/g, '');
        if (!ITA34_FIELDS.some((f) => f.key === key)) return 'Choose the figure that differs.';
        if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) return 'Give SARS’s amount as a number, for example 498000.';
        data[key] = Number(raw);
      }
      const n = S.inbound.filter((it) => it.fn === 'ita34').length + 1;
      const it = ENGINE.receive({ fn: 'ita34', taxRef: ENGINE.clientOf(c).taxRef, year: c.year, ref: 'ITA34-SIM-' + c.id + '-' + n, date, data, submissionRef: c.submission.ref });
      const ok = !!(it && it.caseId === c.id && c.ita34 && c.ita34.ref === it.ref);
      return finish({ ok, why: ok ? '' : 'The simulated ITA34 did not reach ' + c.id }, 'SARS (simulated) sent ITA34 ' + it.ref + ' for ' + c.id + (ok && !c.ita34.recon.ok ? ': it differs from the approved calculation (ASM-02).' : ': it agrees with the approved calculation.'));
    });
  }
  Object.assign(ACT, { 'ops.in.ita34': actIta34, 'ops.link': actLink, 'ops.tx.send': actSend, 'ops.tx.check': actCheck, 'ops.tx.retry': actRetry, 'ops.tx.manual': actManual, 'ops.in.route': actRoute, 'ops.in.date': actDate });

  // Header count: transactions whose outcome is in doubt, and inbound items no case has claimed.
  NAV_COUNT.sars = () => S.txs.filter((t) => ['unknown', 'no-response', 'manual'].includes(t.status)).length + S.inbound.filter((it) => it.status === 'unrouted').length;
})();
