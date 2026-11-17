/* Deadlines: everything the due-date engine drives (the 2026 filing season, Declaration Alert, verification and audit due dates,
   remedy deadlines, retention reviews and PaperSync reminders), each with its rule and source (PERIODS, FILING_2026), and a
   business-day calculator on DATES (the firm's SARS Business Day Calculator, ported line for line).
   Read-only: the calculator changes nothing in the firm's data. */
(() => {
  const DAY = DATES.DAY;
  const today = () => ENGINE.isoDay(now());
  const plusDays = (iso, n) => DATES.iso(DATES.add(DATES.dt(iso), n));
  const UI = {
    kind: 'all',
    count: { s: null, e: null, mode: 'es', ch9: false, res: null, err: '' },
    add: { s: null, n: 21, ch9: false, res: null, err: '' },
    v21: { s: null, method: 'after', res: null, err: '' },
  };
  const ensure = () => {
    if (!UI.count.s) { UI.count.s = today(); UI.count.e = plusDays(today(), 30); }
    if (!UI.add.s) UI.add.s = today();
    if (!UI.v21.s) UI.v21.s = today();
  };
  const src = (p) => (p && p.src ? ADM.extLink(p.src, 'Source') : '');
  const KINDS = [['all', 'All'], ['filing', 'Filing season'], ['sars', 'SARS requests'], ['remedy', 'Remedies'], ['reminder', 'Reminders'], ['exception', 'Exceptions']];
  const kindOf = (d) => (d.kind === 'client' ? 'exception' : d.kind);
  function ruleOf(d) {
    if (d.kind === 'filing') return `SARS filing season 2026 · ${ADM.extLink(FILING_2026.src, 'Source')}`;
    if (d.kind === 'sars') return `Due date on the SARS notice${d.what.startsWith('Verification') ? ' · ' + src(PERIODS.verification) : ''}`;
    if (d.kind === 'remedy') { const p = d.c && d.c.remedy ? PERIODS[d.c.remedy.route] : null; return `${esc(d.source)}${p ? ' · ' + esc(p.days + ' business days from ' + p.from) + ' · ' + src(p) : ''}`; }
    if (d.kind === 'reminder') return esc('Firm policy: reminder lapses after ' + S.policy.reminderDays.approval + ' days (approval) or ' + S.policy.reminderDays.onboarding + ' days (onboarding). Pending Johan.');
    return esc(d.source || '');
  }

  function allBlock() {
    // The filing-season close is one date for many cases: one row per date, listing the cases.
    const rows = []; const filing = {};
    VK.deadlines({ days: 100000 }).filter((d) => UI.kind === 'all' || kindOf(d) === UI.kind).forEach((d) => {
      if (d.kind !== 'filing') { rows.push(Object.assign({ cases: d.c ? [d.c] : [] }, d)); return; }
      const k = d.date + '|' + d.what;
      if (filing[k]) { filing[k].cases.push(d.c); return; }
      filing[k] = Object.assign({ cases: [d.c] }, d); rows.push(filing[k]);
    });
    const items = rows.map((d) => [
      `<div class="adm-dl-date">${VK.datebox(d.date)}<span>${VK.date(d.date)}</span></div>`,
      `<div>${esc(d.what)}</div>${d.codes.length ? `<div class="vk-codes">${d.codes.map((x) => VK.codeChip(x.code, x) + VK.sevChip(x.sev, { short: true })).join(' ')}</div>` : ''}`,
      d.cases.length > 1 ? `<span class="small">${esc(plural(d.cases.length, 'case') + ' not yet submitted:')}</span> ${d.cases.map((c) => VK.caseLink(c)).join(', ')}` : (d.c ? VK.caseWho(d.c) : '<span class="muted">No case</span>'),
      `${VK.leftPill(d.left)}${d.ch9 ? '<div class="small muted">16 Dec to 15 Jan not counted</div>' : ''}`,
      `<span class="small">${ruleOf(d)}</span>`,
    ]);
    const filters = `<div class="filters adm-filters">${ADM.seg('adm.dlk', UI.kind, KINDS, 'Show deadlines of type')}</div>`;
    return VK.section('adm-deadlines-all', 'Everything due', filters + VK.table([{ label: 'Due' }, { label: 'What' }, { label: 'Case' }, { label: 'Time left' }, { label: 'Rule and source' }], items,
      { caption: 'Every open deadline, soonest first', empty: 'Nothing of this type is due.' }), {
      count: rows.length,
      intro: esc('Soonest first, overdue included. Time left is in business days from the demo clock (' + fShort(now()) + '): weekends and South African public holidays are skipped. Operon raises PRE-04, DA-05, VRF-03 or REM-09 ' + S.policy.warnDays + ' business days before a deadline (warning window pending Johan).'),
    });
  }

  function filingBlock() {
    const F = FILING_2026; const open = S.cases.filter((c) => !c.archived && c.year === F.year && !(c.submission && c.submission.ok));
    const n = (k) => open.filter((c) => c.filing === k).length;
    const closes = (iso) => { const left = VK.bizLeft(iso); return left < 0 ? VK.pill('Closed ' + VK.toDay(iso).getDate() + ' ' + MON[VK.toDay(iso).getMonth()], '') : VK.leftPill(left); };
    const rows = [
      [esc(F.autoAssessment.label), `${VK.date(F.autoAssessment.from)} to ${VK.date(F.autoAssessment.to)}`, '<span class="muted">—</span>', '<span class="muted">—</span>'],
      [esc(F.nonProvisional.label), `${VK.date(F.nonProvisional.opens)} to ${VK.date(F.nonProvisional.closes)}`, closes(F.nonProvisional.closes), esc(plural(n('nonProvisional'), 'case'))],
      [esc(F.provisional.label), `${VK.date(F.provisional.opens)} to ${VK.date(F.provisional.closes)}`, closes(F.provisional.closes), esc(plural(n('provisional'), 'case'))],
    ];
    return VK.section('adm-deadlines-filing', 'Filing season 2026', VK.table([{ label: 'Who' }, { label: 'Dates' }, { label: 'Closes' }, { label: 'Not yet submitted' }], rows, { caption: 'ITR12 filing season 2026' }), {
      intro: `${esc('Year of assessment ' + F.period + '. A case that is not submitted counts against its group’s closing date.')} ${ADM.extLink(F.src, 'SARS: changes for filing season 2026')}`,
    });
  }

  function sarsBlock() {
    const rows = [];
    S.cases.forEach((c) => {
      [['da', 'Declaration Alert', PERIODS.daWindow], ['vrf', 'Verification', PERIODS.verification], ['aud', 'Audit', PERIODS.audit]].forEach(([k, label, p]) => {
        const r = c[k]; if (!r) return;
        const done = k === 'da' ? r.submitted || r.moved : r.uploaded;
        const status = done ? VK.pill(k === 'da' ? 'Answered' : 'Documents uploaded', 'ok') : VK.leftPill(VK.bizLeft(r.due));
        const target = r.target ? `<div class="small">SARS target: ${VK.date(r.target)} (${esc(p.days + ' business days from upload')})</div>` : '';
        rows.push([`${esc(label)} <span class="mono small">${esc(r.ref)}</span>`, VK.caseWho(c), VK.date(r.received), `${VK.date(r.due)}${target}`, status,
          `<span class="small">${esc(p.label + ': ' + (p.text || (p.days + ' business days from ' + p.from)))} ${src(p)}</span>`]);
      });
    });
    return VK.section('adm-deadlines-sars', 'SARS requests', VK.table([{ label: 'Request' }, { label: 'Case' }, { label: 'Received' }, { label: 'Due' }, { label: 'Status' }, { label: 'Rule' }], rows,
      { caption: 'Declaration Alerts, verifications and audits', empty: 'No open SARS requests.' }), {
      count: rows.length,
      intro: esc('Due dates come from the SARS notice. Notices arrive through the simulated SARS link; nothing here connects to SARS.'),
    });
  }

  function remedyBlock() {
    const rows = [];
    S.cases.filter((c) => c.ita34 && !c.archived).forEach((c) => {
      if (c.remedy) {
        const p = PERIODS[c.remedy.route];
        rows.push([VK.caseWho(c), `<strong>${esc(p ? p.label : c.remedy.route)}</strong> ${VK.pill('Chosen', 'info')}`, `${VK.date(c.remedy.from)}<div class="small muted">${esc(c.remedy.basis || '')}</div>`,
          c.remedy.deadline ? `${VK.date(c.remedy.deadline)}<div>${VK.leftPill(VK.bizLeft(c.remedy.deadline, true))}</div>` : '<span class="muted">Not set</span>',
          `<span class="small">${esc(c.remedy.rule || '')} ${src(p)}</span>`]);
        return;
      }
      if (c.decision && c.decision.choice === 'accept') return;
      ['reasons', 'objection'].forEach((route) => {
        const r = ENGINE.remedyDeadline(c, route); const p = PERIODS[route];
        rows.push([VK.caseWho(c), `${esc(p.label)} <span class="small muted">if the client disputes</span>`, `${VK.date(r.from)}<div class="small muted">${esc(r.basis || '')}</div>`,
          r.deadline ? `${VK.date(r.deadline)}<div>${VK.leftPill(VK.bizLeft(r.deadline, true))}</div>` : '<span class="muted">Not set</span>', `<span class="small">${esc(p.rule)} ${src(p)}</span>`]);
      });
    });
    return VK.section('adm-deadlines-remedies', 'Remedy deadlines (Chapter 9)', VK.table([{ label: 'Case' }, { label: 'Remedy' }, { label: 'Counted from' }, { label: 'Deadline' }, { label: 'Rule' }], rows,
      { caption: 'Statutory deadlines for requests for reasons, objections and appeals', empty: 'No assessment is open to a remedy.' }), {
      count: rows.length,
      intro: esc('Business days from the date the dispute rules name, skipping 16 December to 15 January (Chapter 9). The deadline is set when the remedy is chosen; the rows marked “if the client disputes” show what it would be today.'),
    });
  }

  function retentionBlock() {
    const cs = S.cases.filter((c) => c.retention.from);
    const rows = cs.map((c) => {
      const active = c.retention.holds.filter((h) => !h.released);
      return [VK.caseWho(c), VK.date(c.retention.from), VK.date(c.retention.until), VK.date(c.retention.review),
        active.length ? `${VK.pill(plural(active.length, 'active hold'), 'warn')}<div class="small">${esc(active.map((h) => h.label).join('; '))}</div>` : '<span class="muted">None</span>'];
    });
    const p = PERIODS.retention;
    return VK.section('adm-deadlines-retention', 'Retention reviews', VK.table([{ label: 'Case' }, { label: 'Runs from' }, { label: 'Keep until' }, { label: 'Review on' }, { label: 'Holds' }], rows,
      { caption: 'Retention periods and review dates', empty: 'No return has been submitted yet, so no retention period has started.' }), {
      count: rows.length,
      intro: `${esc(S.policy.retentionYears + ' years from ' + p.from + ' (' + p.rule + '). A longer firm period is pending Johan. Nothing is deleted automatically: the Records/Compliance Owner reviews it.')} ${src(p)} · <a href="#retention">Retention</a>`,
    });
  }

  function reminderBlock() {
    const rows = [];
    S.cases.forEach((c) => c.reminders.forEach((r) => rows.push([VK.caseWho(c), esc(r.kind === 'approval' ? 'Client approval (G06)' : 'Onboarding (G01)'), VK.when(r.sent), VK.when(r.expires),
      VK.pill({ sent: 'Waiting', answered: 'Answered', expired: 'Expired' }[r.status] || r.status, r.status === 'expired' ? 'bad' : (r.status === 'answered' ? 'ok' : 'warn'))])));
    return VK.section('adm-deadlines-reminders', 'PaperSync reminders', VK.table([{ label: 'Case' }, { label: 'Reminder' }, { label: 'Sent' }, { label: 'Lapses' }, { label: 'Status' }], rows,
      { caption: 'Reminders sent through the PaperSync portal', empty: 'No reminders have been sent.' }), {
      count: rows.length,
      intro: esc('A lapsed reminder raises CLT-05 (approval) or CLT-01 (onboarding). It never counts as approval. Lapse periods: ' + S.policy.reminderDays.approval + ' days for approval, ' + S.policy.reminderDays.onboarding + ' days for onboarding (pending Johan). The portal is simulated.'),
    });
  }

  function rulesBlock() {
    const rows = Object.keys(PERIODS).map((k) => {
      const p = PERIODS[k];
      const len = p.years ? plural(p.years, 'year') : (p.days ? p.days + ' business days' + (p.ch9 ? '; 16 Dec to 15 Jan not counted' : '') : '');
      return [`<strong>${esc(p.label)}</strong>${p.info ? ' <span class="small muted">(shown for reference)</span>' : ''}`, len ? esc(len) : '<span class="muted">—</span>',
        esc(p.from || ''), `<span class="small">${esc(p.rule || '')}${p.text ? '<br>' + esc(p.text) : ''}${p.note ? '<br>' + esc(p.note) : ''}</span>`, src(p)];
    });
    return VK.section('adm-deadlines-rules', 'The rules behind the dates', VK.table([{ label: 'Period' }, { label: 'Length' }, { label: 'Counted from' }, { label: 'Rule' }, { label: 'Source' }], rows,
      { caption: 'Statutory and service periods with their sources' }), { intro: esc('Each period with its legal or SARS source, checked on 9 Nov 2026.') });
  }

  /* ---------- Business-day calculator ---------- */
  function calcBlock() {
    ensure();
    const C = UI.count; const A = UI.add; const V = UI.v21;
    const ch9Box = (id, on) => `<label class="adm-check" for="${id}"><input type="checkbox" id="${id}" name="ch9"${on ? ' checked' : ''}> Chapter 9 period (skip 16 Dec to 15 Jan)</label>`;
    const modes = [['es', 'Exclude the start, include the end'], ['both', 'Include both dates'], ['neither', 'Exclude both dates'], ['ee', 'Include the start, exclude the end']];
    let countRes = '';
    if (C.err) countRes = `<p class="err">${esc(C.err)}</p>`;
    else if (C.res) {
      const ex = C.res.rows.filter((r) => !r.business);
      countRes = `<div class="adm-result" role="status"><p class="adm-big">${esc(plural(C.res.business, 'business day'))}</p><p class="small muted">${esc(plural(C.res.total, 'calendar day') + ' counted, ' + C.res.excluded + ' excluded.')}</p>
        ${ex.length ? `<details><summary>Excluded days (${ex.length})</summary><ul class="adm-days">${ex.slice(0, 120).map((r) => `<li><span class="mono">${esc(r.date)}</span> ${esc(r.reason)}</li>`).join('')}</ul>${ex.length > 120 ? '<p class="small muted">First 120 shown.</p>' : ''}</details>` : ''}</div>`;
    }
    let addRes = '';
    if (A.err) addRes = `<p class="err">${esc(A.err)}</p>`;
    else if (A.res) addRes = `<div class="adm-result" role="status"><p class="adm-big">${VK.date(A.res)}</p><p class="small muted">${esc(plural(A.n, 'business day') + ' after ' + A.s + ' (the start date is Day 0)' + (A.ch9 ? ', skipping 16 Dec to 15 Jan' : ''))}</p></div>`;
    let vRes = '';
    if (V.err) vRes = `<p class="err">${esc(V.err)}</p>`;
    else if (V.res) {
      const r = V.res;
      vRes = `<div class="adm-result" role="status"><p class="adm-big">${VK.date(DATES.iso(r.target))}</p>
        <p class="small muted">${esc('Day 1 is ' + DATES.iso(r.day1) + '. Follow up with SARS from ' + DATES.iso(r.follow) + ' if nothing has arrived.')}</p>
        <details><summary>All 21 business days</summary><ol class="adm-days">${r.rows.map(([n, d]) => `<li><span class="mono">Day ${esc(n)}</span> ${esc(DATES.iso(d))}</li>`).join('')}</ol></details></div>`;
    }
    const body = `<div class="adm-calc">
      <form data-form="adm.dlCount" class="adm-tool" novalidate><h3>Business days between two dates</h3>
        <div class="adm-two"><label class="f" for="adm-dc-s">Start<input id="adm-dc-s" name="s" type="date" value="${esc(C.s)}" required></label>
        <label class="f" for="adm-dc-e">End<input id="adm-dc-e" name="e" type="date" value="${esc(C.e)}" required></label></div>
        <label class="f" for="adm-dc-m">How to count the two dates<select id="adm-dc-m" name="mode">${modes.map(([v, t]) => `<option value="${v}"${C.mode === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        ${ch9Box('adm-dc-c', C.ch9)}<div><button class="btn primary" type="submit">Count</button></div>${countRes}</form>
      <form data-form="adm.dlAdd" class="adm-tool" novalidate><h3>Add business days</h3>
        <div class="adm-two"><label class="f" for="adm-da-s">Start (Day 0)<input id="adm-da-s" name="s" type="date" value="${esc(A.s)}" required></label>
        <label class="f" for="adm-da-n">Business days<input id="adm-da-n" name="n" type="number" min="0" max="1000" step="1" value="${esc(A.n)}" required></label></div>
        ${ch9Box('adm-da-c', A.ch9)}<div><button class="btn primary" type="submit">Work out the date</button></div>${addRes}</form>
      <form data-form="adm.dlV21" class="adm-tool" novalidate><h3>21-business-day verification tracker</h3>
        <label class="f" for="adm-dv-s">Documents uploaded to SARS on<input id="adm-dv-s" name="s" type="date" value="${esc(V.s)}" required></label>
        <fieldset class="adm-radios"><legend class="small muted">Counting</legend>
          <label><input type="radio" name="method" value="after"${V.method === 'after' ? ' checked' : ''}> Upload date is Day 0 (recommended)</label>
          <label><input type="radio" name="method" value="include"${V.method === 'include' ? ' checked' : ''}> Upload date is Day 1 if it is a business day</label></fieldset>
        <div><button class="btn primary" type="submit">Track</button></div>${vRes}</form></div>`;
    return VK.section('adm-deadlines-calc', 'Business-day calculator', body, {
      intro: esc('The firm’s SARS Business Day Calculator (5 Oct 2026), rebuilt in Operon. A business day is not a Saturday, Sunday or public holiday (Tax Administration Act s1); a public holiday on a Sunday moves to the Monday. Tick Chapter 9 for objection, appeal and reasons periods.') + ' ' + src(PERIODS.businessDay),
    });
  }
  function holidaysBlock() {
    const y = now().getFullYear();
    const rows = [];
    [y, y + 1].forEach((yr) => {
      const m = new Map(DATES.holidays(yr));
      DATES.EXTRA.forEach((n, k) => { if (k.startsWith(yr + '-')) m.set(k, m.has(k) ? m.get(k) + '; ' + n : n); });
      [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([k, n]) => rows.push([`<span class="mono">${esc(k)}</span>`, esc(DOW[DATES.dt(k).getUTCDay()]), esc(n)]));
    });
    return VK.section('adm-deadlines-holidays', 'Public holidays the calculator skips', `<details class="adm-more"><summary>${esc(y + ' and ' + (y + 1) + ': ' + plural(rows.length, 'day'))}</summary>${VK.table([{ label: 'Date' }, { label: 'Day' }, { label: 'Holiday' }], rows, { caption: 'South African public holidays' })}</details>`, {
      intro: esc('Fixed holidays, Good Friday and Family Day from Easter, Sunday holidays observed on the Monday, and the 4 November 2026 local government elections (Proclamation 346 of 2026).'),
    });
  }

  VIEWS.deadlines = () => {
    const intro = esc('Every date the due-date engine tracks, with the rule and source behind it, and a business-day calculator. Dates come from the made-up cases; the SARS link and the PaperSync portal are simulated.');
    return VK.page('Deadlines', intro, allBlock() +
      `<div class="grid2 vk-grid" data-rv-key="adm-deadlines-columns">${filingBlock()}${reminderBlock()}</div>` +
      sarsBlock() + remedyBlock() + retentionBlock() + calcBlock() + holidaysBlock() + rulesBlock(), { key: 'adm-deadlines' });
  };

  /* ---------- Calculator forms ---------- */
  const dayOf = (v) => (DATES.dt(String(v || '')) ? String(v) : null);
  Object.assign(FORMS, {
    'adm.dlCount': (f) => {
      const C = UI.count; C.s = f.elements.s.value; C.e = f.elements.e.value; C.mode = ['es', 'both', 'neither', 'ee'].includes(f.elements.mode.value) ? f.elements.mode.value : 'es'; C.ch9 = f.elements.ch9.checked;
      C.res = null; C.err = '';
      const s = dayOf(C.s); const e = dayOf(C.e);
      if (!s || !e) C.err = 'Enter both dates.';
      else if (e < s) C.err = 'The end date is before the start date.';
      else if ((DATES.dt(e) - DATES.dt(s)) / DAY > 3660) C.err = 'Keep the range under ten years.';
      else C.res = DATES.countRange(DATES.dt(s), DATES.dt(e), C.mode, C.ch9);
      render();
    },
    'adm.dlAdd': (f) => {
      const A = UI.add; A.s = f.elements.s.value; A.n = f.elements.n.value; A.ch9 = f.elements.ch9.checked; A.res = null; A.err = '';
      const s = dayOf(A.s); const n = Number(A.n);
      if (!s) A.err = 'Enter a start date.';
      else if (!Number.isInteger(n) || n < 0 || n > 1000) A.err = 'Enter a whole number of business days from 0 to 1,000.';
      else { A.n = n; A.res = DATES.iso(DATES.addBusinessDays(DATES.dt(s), n, { ch9: A.ch9 })); }
      render();
    },
    'adm.dlV21': (f) => {
      const V = UI.v21; V.s = f.elements.s.value; V.method = f.elements.method.value === 'include' ? 'include' : 'after'; V.res = null; V.err = '';
      const s = dayOf(V.s);
      if (!s) V.err = 'Enter the upload date.'; else V.res = DATES.verification21(DATES.dt(s), V.method);
      render();
    },
  });
  ACT['adm.dlk'] = (t) => { UI.kind = KINDS.some(([k]) => k === t.dataset.v) ? t.dataset.v : 'all'; render(); };
})();
