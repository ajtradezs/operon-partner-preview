/* Try it: one-click scenarios that show the controls at work. Each runs on a seeded demo case or on a fresh made-up case, says
   what happened and links to where to look. Everything goes through ENGINE, so every step (refusals included) is in the audit trail:
     - your own step uses ACTOR.me() (the signed-in role's person), so a role that may not do it is refused and told why;
     - the client's step goes through ENGINE.portal() (the client in the simulated PaperSync portal);
     - setting up a fresh case uses ENGINE.newClient/newCase/drive, the engine's own walk-through by the simulated team;
     - a ruleset change is the simulated platform team (ACTOR.platform), the only actor the engine lets change it.
   Results are kept for this browser tab only and vanish when the demo is reset. */
(() => {
  const RES = { s: null, map: {} };
  const results = () => { if (RES.s !== S) { RES.s = S; RES.map = {}; } return RES.map; };
  const you = () => me().name + ', ' + S.role;
  const go = (href, label) => `<a href="#${esc(href)}">${esc(label)}</a>`;
  const chips = (xs) => `<span class="vk-codes">${xs.map((x) => VK.codeChip(x.code, x) + VK.sevChip(x.sev, { short: true })).join(' ')}</span>`;
  const newEx = (n0, c) => S.exceptions.slice(n0).filter((x) => !c || x.caseId === c.id);

  /* ---------- fresh made-up cases ---------- */
  // An SA-ID-shaped number whose check digit is deliberately wrong, so it can never be a real ID (as in seed.js).
  function demoId(dob, n) {
    const body = dob.slice(2, 4) + dob.slice(5, 7) + dob.slice(8, 10) + String(n).padStart(4, '0') + '08';
    let sum = 0;
    for (let i = 0; i < body.length; i++) { let d = +body[body.length - 1 - i]; if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
    return body + (((10 - (sum % 10)) % 10 + 5) % 10);
  }
  const PEOPLE = {
    wrong: { name: 'Bongani Mahlaba', dob: '1984-02-17', others: ['Naledi Mahlaba'] },
    malware: { name: 'Carla Pretorius', dob: '1989-08-04' },
    timeout: { name: 'Yusuf Ebrahim', dob: '1977-12-11' },
    withdraw: { name: 'Annelie Swart', dob: '1983-05-29' },
    override: { name: 'Musa Khoza', dob: '1992-10-02' },
  };
  const ANSWERS = { medical: false };  // only the IRP5 is needed, so the calculation reconciles with one document
  function fresh(key, items) {
    const p = PEOPLE[key]; const n = S.clients.length + 1;
    const cl = ENGINE.newClient({ name: p.name, idNo: demoId(p.dob, 7000 + n * 13), taxRef: String(9180000000 + n * 4973), others: p.others || [] });
    const c = ENGINE.newCase(cl, { items: items || ['irp5', 'medical'], priorYear: ['employment'] });
    return { cl, c };
  }
  // A fresh case walked to `gate` by the simulated team, with values extracted from its IRP5 (simulated) so the calculation is real.
  function freshTo(key, gate) {
    const { cl, c } = fresh(key, gate === 'G04' ? ['irp5', 'medical'] : ['irp5']);
    if (gate === 'G04') { const r = ENGINE.drive(c, 'G04'); return { cl, c, r }; }
    let r = ENGINE.drive(c, 'G05', { answers: ANSWERS });
    if (!r.ok) return { cl, c, r };
    const d = c.docs.filter((x) => x.kind === 'irp5' && x.status === 'validated').pop();
    if (d) ENGINE.setInputs(c, ACTOR.ai(), { lines: [{ id: 'L1', docId: d.id, ref: 'IRP5 code 3601: income', field: 'remuneration', amount: 455000 }, { id: 'L2', docId: d.id, ref: 'IRP5 code 4102: PAYE', field: 'paye', amount: 84300 }] }, { note: 'Extracted the IRP5 values (simulated)' });
    r = ENGINE.drive(c, gate, { answers: ANSWERS });
    return { cl, c, r };
  }
  const setupLine = (c, cl, gate) => `Opened a fresh made-up case ${VK.caseLink(c)} for ${VK.clientLink(cl)} and walked it to ${esc(gate)} (the simulated team did the earlier steps).`;
  const setupFailed = (c, r) => ({ tone: 'err', head: 'Could not set up the case: ' + r.why, lines: ['The demo team could not walk ' + VK.caseLink(c) + ' forward. ' + esc(S.rulesetVersion !== '2026.1' ? 'The tax ruleset is still ' + S.rulesetVersion + ': use “Restore 2026.1 and rerun” first.' : 'If AI work is paused, resume it, or reset the demo.')], links: [VK.caseLink(c), go('audit', 'Audit trail')] });

  /* ---------- the scenarios ---------- */
  function upload(key, fileName, bytes, what) {
    const { cl, c, r } = freshTo(key, 'G04');
    if (!r.ok) return setupFailed(c, r);
    const it = c.items.find((x) => x.kind === 'irp5');
    const n0 = S.exceptions.length;
    const u = ENGINE.portal(c, 'upload', { itemId: it.id, file: { name: fileName, size: bytes } });
    const raised = newEx(n0, c); const d = u.doc;
    const inc = S.incidents.filter((i) => i.caseId === c.id && i.status === 'open').pop();
    return {
      tone: 'stop', head: (d ? d.name + ' was ' + d.status : 'Upload ' + (u.ok ? 'done' : 'refused: ' + u.why)) + (raised.length ? ': ' + raised.map((x) => x.code).join(', ') + ' raised.' : '.'),
      lines: [setupLine(c, cl, 'G04'),
        `As the client, in the simulated PaperSync portal, uploaded <span class="mono">${esc(fileName)}</span> for the IRP5. ${esc(what)}`,
        `The AI check (simulated: it looked at the file name and size only) ${esc(d ? 'marked it ' + d.status : 'did not run')}. Raised: ${raised.length ? chips(raised) : 'nothing'}.`,
        inc ? `Incident ${VK.link('incident', inc.id)} is open for the Information Officer (G17). S1 is a hard stop: every gate and SARS transaction on ${VK.caseLink(c)} waits until it closes.` : 'No incident was opened.'],
      links: [VK.caseLink(c, 'Case ' + c.id)].concat(raised.slice(0, 2).map((x) => VK.exLink(x, x.code + ' ' + x.id)), inc ? [VK.link('incident', inc.id, 'Incident ' + inc.id)] : [], [VK.link('portal', c.id, 'Client portal'), go('audit', 'Audit trail')]),
    };
  }

  function drag() {
    const c = ENGINE.caseById(DEMO.keys.details);
    if (!c) return { tone: 'err', head: 'The SARS-details demo case is not here.', lines: ['Reset the demo to bring it back.'], links: [] };
    const from = ENGINE.columnOf(c); const i = BOARD.findIndex((b) => b.key === from);
    const to = BOARD[i + 1] ? BOARD[i + 1] : null;
    const n0 = S.audit.length;
    const r = ENGINE.dragForward(c, ACTOR.me(), to ? to.key : null);
    const logged = S.audit.slice(n0).filter((a) => a.result === 'Refused').length;
    const bl = (r.blockers || []).filter((x) => x && x.code);
    const fromL = (BOARD[i] || {}).label || from;
    if (r.ok) {
      return { tone: 'ok', head: 'It moved: nothing blocked ' + c.id + ' any more.', lines: [`You (${esc(you())}) dragged ${VK.caseWho(c)} from ${esc(fromL)} towards ${esc(to ? to.label : 'the next column')}. Every check passed, so Operon released the gate and recorded it.`], links: [VK.caseLink(c), go('cases', 'Cases board'), go('audit', 'Audit trail')] };
    }
    return {
      tone: 'stop', head: 'Refused: ' + r.why,
      lines: [`You (${esc(you())}) dragged ${VK.caseWho(c)} from ${esc(fromL)} to ${esc(to ? to.label : 'the next column')} on the Cases board. A forward drag is a request to release the gate.`,
        `Operon refused it and the card snapped back: ${esc(r.why)}${bl.length ? ' ' + chips(bl) : ''}`,
        esc(plural(logged, 'refusal') + ' written to the audit trail. Nothing changed on the case.')],
      links: [VK.caseLink(c, 'Case ' + c.id), go('cases', 'Cases board')].concat(bl.slice(0, 2).map((x) => VK.exLink(x, x.code + ' ' + x.id)), [go('audit', 'Audit trail')]),
    };
  }

  function timeout() {
    const { cl, c, r } = freshTo('timeout', 'G18');
    if (!r.ok) return setupFailed(c, r);
    const t = S.txs.filter((x) => x.caseId === c.id && x.fn === 'itr12').pop();
    if (!t) return setupFailed(c, { why: 'no ITR12 transaction was queued' });
    const ia = ACTOR.as('Integration Administrator'); const tc = ACTOR.as('Tax Consultant', c.consultant);
    const s1 = ENGINE.signG18(t, ia); const s2 = s1.ok ? ENGINE.signG18(t, tc) : s1;
    if (!s2.ok) return setupFailed(c, s2);
    const n0 = S.exceptions.length;
    ENGINE.transmit(t, ia, 'unknown');
    const raised = newEx(n0, c);
    const again = ENGINE.transmit(t, ACTOR.me());
    // A role that may not send is refused for that reason alone, which hides the rule this scenario is about. So the simulated
    // Integration Administrator, who may send, tries too: that refusal is the no-blind-retry rule itself.
    const iaToo = S.role !== 'Integration Administrator' ? ENGINE.transmit(t, ia) : null;
    const k8 = ENGINE.g18Checks(t).find((k) => k.n === 8);
    const x4 = raised.find((x) => x.code === 'INT-04');
    return {
      tone: 'stop', head: t.id + ' status unknown (' + raised.map((x) => x.code).join(', ') + '). Sending it again was refused.',
      lines: [setupLine(c, cl, 'G18'),
        `The Integration Administrator and the Tax Consultant signed G18, and ${esc(t.id)} was sent through the simulated SARS link. The link timed out with no reliable answer, so the status is <strong>unknown</strong>. Raised: ${raised.length ? chips(raised) : 'nothing'}.`,
        `You (${esc(you())}) pressed Send again. ${again.ok ? 'It went through.' : 'Refused: ' + esc(again.why)}`,
        iaToo ? `The Integration Administrator (simulated), who may send, pressed Send again too. ${iaToo.ok ? 'It went through.' : 'Refused: ' + esc(iaToo.why)}` : '',
        k8 ? `G18 check 8 now fails: ${esc(k8.why || 'pending')}. Unknown calls are never retried blindly: the Integration Administrator checks the SARS status first.` : ''].filter(Boolean),
      links: [go('sars', 'SARS link'), VK.caseLink(c, 'Case ' + c.id)].concat(x4 ? [VK.exLink(x4, 'INT-04 ' + x4.id)] : [], [go('audit', 'Audit trail')]),
    };
  }

  function withdraw() {
    const { cl, c, r } = freshTo('withdraw', 'G18');
    if (!r.ok) return setupFailed(c, r);
    const ap = c.approval; const t = S.txs.filter((x) => x.caseId === c.id && x.fn === 'itr12').pop();
    const n0 = S.exceptions.length;
    const w = ENGINE.portal(c, 'withdraw', { reason: 'I want to check my medical aid figures first' });
    const raised = newEx(n0, c);
    return {
      tone: 'stop', head: w.ok ? 'Approval withdrawn: ' + (raised.map((x) => x.code).join(', ') || 'no code') + ', G06 re-opened.' : 'Refused: ' + w.why,
      lines: [setupLine(c, cl, 'G18') + ' The client approved version ' + esc(ap ? ap.version : '?') + ' on the way.',
        `As the client, in the simulated PaperSync portal, withdrew that approval before submission. Raised: ${raised.length ? chips(raised) : 'nothing'}.`,
        `G06 is now ${esc(VK.gateStateWord(ENGINE.gateState(c, 'G06'))[0].toLowerCase())}; ${t ? esc(t.id + ' is ' + t.status) : 'no SARS transaction was queued'}. Nothing goes to SARS until the client approves a version again in the portal.`],
      links: [VK.caseLink(c, 'Case ' + c.id)].concat(raised.slice(0, 1).map((x) => VK.exLink(x, x.code + ' ' + x.id)), [VK.link('portal', c.id, 'Client portal'), go('audit', 'Audit trail')]),
    };
  }

  function ruleset() {
    const n0 = S.exceptions.length; const before = S.rulesetVersion;
    const r = ENGINE.rulesetChange(ACTOR.platform('Platform Product Owner'), { version: '2027.1' });
    if (!r.ok) return { tone: 'err', head: 'Refused: ' + r.why, lines: [], links: [go('audit', 'Audit trail')] };
    const raised = newEx(n0);
    const byCase = {};
    raised.forEach((x) => { (byCase[x.caseId] = byCase[x.caseId] || []).push(x); });
    const ids = Object.keys(byCase);
    return {
      tone: 'stop', head: 'Ruleset ' + before + ' → 2027.1: AI-07 and TAX-06 on ' + plural(ids.length, 'case') + '.',
      lines: ['The platform team (simulated) switched the tax ruleset to 2027.1, the 2027 year’s values, while 2026 cases were part-way through.',
        ids.length ? `Raised on every unsubmitted case with a calculation: ${chips(byCase[ids[0]])} (AI-07 for the impact check, TAX-06 because the ruleset is for the wrong year). Cases: ${ids.map((id) => VK.caseWho(id)).join('; ')}.` : 'No unsubmitted case had a calculation, so nothing was raised.',
        'Their calculation gates are stopped. Next: restore 2026.1 and rerun.'],
      links: [go('exceptions', 'Exceptions'), go('cases', 'Cases board'), go('audit', 'Audit trail')],
    };
  }

  function restore() {
    const before = S.rulesetVersion;
    const r = ENGINE.rulesetChange(ACTOR.platform('Platform Product Owner'), { version: '2026.1' });
    if (!r.ok) return { tone: 'err', head: 'Refused: ' + r.why, lines: [], links: [go('audit', 'Audit trail')] };
    const out = S.cases.filter((c) => !c.archived && c.rerun).map((c) => {
      const k = ENGINE.calculate(c, ACTOR.ai(), { reason: 'Rerun on ruleset 2026.1 after the ruleset change' });
      return { c, k };
    });
    const ok = out.filter((o) => o.k.ok);
    const open = S.exceptions.filter((x) => ENGINE.isOpen(x) && (x.code === 'AI-07' || x.code === 'TAX-06'));
    return {
      tone: 'ok', head: 'Restored 2026.1 (from ' + before + '); reran ' + ok.length + ' of ' + out.length + ' calculations.',
      lines: ['The platform team (simulated) restored ruleset 2026.1. Each case with a calculation keeps or gets AI-07 as an impact check until it is rerun.',
        out.length ? 'The AI (simulated) reran each affected calculation:' : 'No case needed a rerun.',
        ...out.map((o) => `${VK.caseWho(o.c)}: ${o.k.ok ? esc('version ' + o.k.version + ' on 2026.1') + (ENGINE.currentApproval(o.c) ? '' : esc(o.c.approval ? ', so the client must approve again' : '')) : 'refused: ' + esc(o.k.why)}`),
        esc(plural(open.length, 'AI-07 or TAX-06 exception') + ' stay open until their owners resolve them on Exceptions; where the rerun worked, their checks now pass.')],
      links: [go('exceptions', 'Exceptions'), go('cases', 'Cases board'), go('audit', 'Audit trail')],
    };
  }

  function override() {
    const { cl, c, r } = freshTo('override', 'G06');
    if (!r.ok) return setupFailed(c, r);
    const w = ENGINE.portal(c, 'withhold', { reason: 'I want to speak to my husband before you file' });
    const x = w.exception || ENGINE.exOf(c).find((y) => y.code === 'CLT-04' && ENGINE.isOpen(y));
    if (!x) return { tone: 'err', head: 'CLT-04 was not raised: ' + (w.why || 'unknown'), lines: [], links: [VK.caseLink(c)] };
    const o = ENGINE.requestOverride(x, ACTOR.me(), { reason: 'The filing season is closing', evidence: 'Partner instruction by email' });
    return {
      tone: o.ok ? 'ok' : 'stop', head: o.ok ? 'Override requested (it should not have been).' : 'Refused: ' + o.why,
      lines: [setupLine(c, cl, 'G06'),
        `As the client, in the simulated PaperSync portal, said “I do not give authority”. Raised: ${chips([x])} (the client withholds submission authority).`,
        `You (${esc(you())}) asked to override ${VK.exLink(x)} with a reason and evidence. ${o.ok ? 'It was accepted.' : 'Refused: ' + esc(o.why) + '.'}`,
        'No override may bypass missing taxpayer authority, a security control, SARS-interface authorisation or a statutory hold. Only the client’s own approval in the portal clears it.'],
      links: [VK.exLink(x, x.code + ' ' + x.id), VK.caseLink(c, 'Case ' + c.id), VK.link('portal', c.id, 'Client portal'), go('controls', 'Controls'), go('audit', 'Audit trail')],
    };
  }

  const SCEN = [
    { id: 'wrong', title: 'A wrong-taxpayer upload', codes: ['DOC-04', 'SEC-01'], on: 'A fresh made-up case', who: 'The client, in the simulated PaperSync portal',
      what: 'The client uploads his wife’s IRP5. The AI check spots another person’s name, quarantines the file and opens a security incident.',
      run: () => upload('wrong', 'IRP5_2026_Naledi_Mahlaba.pdf', 231424, 'The file name names his wife, Naledi Mahlaba, not the taxpayer.') },
    { id: 'drag', title: 'Dragging a card past a gate', codes: ['MD-05', 'MD-01'], on: 'Demo case: SARS details', who: 'You',
      what: 'You drag a case whose SARS details do not match forward on the Cases board. The gate is checked, the move is refused and the card snaps back.', run: drag },
    { id: 'timeout', title: 'A SARS timeout', codes: ['INT-04'], on: 'A fresh made-up case', who: 'The simulated SARS link, then you',
      what: 'The ITR12 is sent and the simulated SARS link times out. The status is unknown, so sending it again is refused until someone checks with SARS.', run: timeout },
    { id: 'withdraw', title: 'A client withdrawing approval', codes: ['CLT-06'], on: 'A fresh made-up case', who: 'The client, in the simulated PaperSync portal',
      what: 'The client approved version 1 and then withdraws it before it is filed. The approval gate re-opens and the queued submission stops.', run: withdraw },
    { id: 'ruleset', title: 'A ruleset change mid-case', codes: ['AI-07', 'TAX-06'], on: 'Every demo case with a calculation', who: 'The platform team (simulated), then the AI',
      what: 'The tax ruleset is switched to the 2027 values while 2026 cases are in progress. Then restore 2026.1 and rerun the calculations.', run: ruleset,
      second: { id: 'restore', label: 'Restore 2026.1 and rerun', run: restore } },
    { id: 'malware', title: 'A malware upload', codes: ['DOC-10'], on: 'A fresh made-up case', who: 'The client, in the simulated PaperSync portal',
      what: 'The client uploads a program disguised as an IRP5. It is quarantined without being opened, and an incident is opened.',
      run: () => upload('malware', 'IRP5_2026.pdf.exe', 48211, 'It is a program (.exe), not a document.') },
    { id: 'override', title: 'An override on missing authority', codes: ['CLT-04'], on: 'A fresh made-up case', who: 'The client, then you',
      what: 'The client withholds authority to submit, and you ask to override it. Missing taxpayer authority can never be overridden.', run: override },
  ];
  const RUN = {}; SCEN.forEach((s) => { RUN[s.id] = s.run; if (s.second) RUN[s.second.id] = s.second.run; });

  function resultBox(res) {
    if (!res) return '';
    return `<div class="ps-res ps-res-${esc(res.tone)}" role="status"><p class="ps-res-h">${res.tone === 'ok' ? I.check : I.alert}<strong>${esc(res.head)}</strong></p>
      <p class="small muted">${esc('Ran ' + fWhen(res.at))}</p>
      ${res.lines.length ? `<ul class="ps-res-l">${res.lines.map((l) => `<li>${l}</li>`).join('')}</ul>` : ''}
      ${res.links.length ? `<p class="ps-res-a"><span class="small muted">Where to look:</span> ${res.links.join(' ')}</p>` : ''}</div>`;
  }
  function card(s) {
    const rs = results();
    const latest = [rs[s.id], s.second ? rs[s.second.id] : null].filter(Boolean).sort((p, q) => q.n - p.n)[0] || null;
    const body = `<p>${esc(s.what)}</p>
      <div class="vk-meta"><span>${esc(s.on)}</span><span>Acts: ${esc(s.who)}</span>${s.codes.map((k) => VK.codeChip(k)).join(' ')}</div>
      <div class="actions">${btn(rs[s.id] ? 'Run it again' : 'Run it', 'ps.try', { cls: 'primary sm', data: { id: s.id } })}${s.second ? btn(s.second.label, 'ps.try', { cls: 'sm', data: { id: s.second.id } }) : ''}</div>
      ${resultBox(latest)}`;
    return VK.section('ps-try-' + s.id, s.title, body, { cls: 'ps-try' });
  }

  let runN = 0;
  Object.assign(ACT, {
    'ps.try': (t) => {
      const fn = RUN[t.dataset.id]; if (!fn) return;
      const a0 = S.audit.length; let res;
      try { res = fn(); } catch (e) { res = { tone: 'err', head: 'Something went wrong: ' + e.message, lines: [], links: [] }; }
      res.at = now(); res.n = ++runN; res.audit = S.audit.length - a0;
      results()[t.dataset.id] = res;
      toast(res.head);
      render();
    },
    'ps.reset': () => {
      const keep = { fb: S.fb, fbNames: S.fbNames, fbState: S.fbState, role: S.role };
      seed(); Object.assign(S, keep); S.signedIn = true;
      toast('Demo reset: every case, exception and audit entry is back to the start. Your review notes are kept.');
      render();
    },
  });

  VIEWS.try = () => {
    const intro = esc('Each scenario runs straight away on a demo case or a fresh made-up case, then says what happened and where to look. Every step goes through the workflow engine and lands in the audit trail, refusals included. SARS, the AI, the platform team and the client’s PaperSync portal are simulated. Reset puts the demo back to the start.');
    return VK.page('Try it', intro, `<div class="grid2 vk-grid" data-rv-key="ps-try-grid">${SCEN.map(card).join('')}</div>`,
      { key: 'ps-try', actions: btn('Reset the demo', 'ps.reset', { cls: 'sm' }) });
  };
})();
