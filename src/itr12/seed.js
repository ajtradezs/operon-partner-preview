/* The demo firm's synthetic cases: one or two per workflow stage, each showing the exception codes the plan names.
   Every person is made up: the names, the tax references, and the ID numbers (built from the date of birth with a check digit
   that deliberately fails the SA ID checksum). Every figure comes from CALC through ENGINE.calculate(), so the seeded numbers
   always reproduce through calc.js; SARS's ITA34 figures are calc.js run on the inputs SARS used.
   The history is replayed in date order across all cases with the demo clock moved back to each step's date, so the audit
   trail reads chronologically. Everything goes through ENGINE; anything ENGINE refuses is collected in DEMO.problems (the
   tests require it to be empty). Tests of the engine itself set DEMO.cases = false for an empty firm. */
const DEMO = { cases: true, problems: [], keys: {} };

const DEMO_SEED = (() => {
  // An SA-ID-shaped number for a date of birth whose check digit is deliberately wrong (Luhn), so it can never be a real ID.
  function demoId(dob, n) {
    const body = dob.slice(2, 4) + dob.slice(5, 7) + dob.slice(8, 10) + String(n).padStart(4, '0') + '08';
    let sum = 0;
    for (let i = 0; i < body.length; i++) { let d = +body[body.length - 1 - i]; if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
    const right = (10 - (sum % 10)) % 10;
    return body + ((right + 5) % 10);
  }
  // [date of birth, provisional taxpayer, consultant]
  const CLIENTS = {
    onboarding: { name: 'Nomvula Dlamini', dob: '1988-04-12' },
    details: { name: 'Sipho Mokoena', dob: '1979-09-03' },
    questionnaire: { name: 'Elena Rossouw', dob: '1984-01-27', tc: 'TC2' },
    documents: { name: 'Thandiwe Nkosi', dob: '1991-06-18' },
    wrongTaxpayer: { name: 'Kagiso Molefe', dob: '1982-11-05', others: ['Lindiwe Molefe'], tc: 'TC2' },
    judgement: { name: 'Ruan Botha', dob: '1986-03-30' },
    calcReady: { name: 'Tebogo Sithole', dob: '1975-08-14', tc: 'TC2' },
    approval: { name: 'Fatima Adams', dob: '1990-02-09' },
    rework: { name: 'Michael Naidoo', dob: '1981-12-01', tc: 'TC2' },
    ready: { name: 'Zanele Mthembu', dob: '1987-07-22' },
    unknown: { name: 'Hendrik Joubert', dob: '1958-05-16', tc: 'TC2' },
    declaration: { name: 'Priya Govender', dob: '1983-10-10', provisional: false },
    verification: { name: 'Andile Zulu', dob: '1980-03-03', tc: 'TC2' },
    assessment: { name: 'Grace van der Merwe', dob: '1972-06-25' },
    remedy: { name: 'Lwazi Ndlovu', dob: '1985-09-19', tc: 'TC2' },
    closed: { name: 'Ingrid Fourie', dob: '1950-01-08', provisional: false },
  };
  const ln = (doc, ref, field, amount, extra) => Object.assign({ doc, ref, field, amount }, extra || {});
  const IRP5 = (rem, paye, more) => [ln('irp5', 'IRP5 code 3601: income', 'remuneration', rem), ln('irp5', 'IRP5 code 4102: PAYE', 'paye', paye)].concat(more || []);
  const MED = (fees, exp) => [ln('medical', 'Medical scheme certificate: contributions', 'medicalFees', fees)].concat(exp ? [ln('medical', 'Medical scheme certificate: expenses not paid by the scheme', 'medicalExpenses', exp)] : []);

  return function run() {
    const P = DEMO.problems; const K = {};
    const tc = (id) => ACTOR.as('Tax Consultant', id || 'TC1');
    const ad = ACTOR.as('Administrator', 'AD1'); const ia = ACTOR.as('Integration Administrator', 'IA1'); const ai = ACTOR.ai(); const sys = ACTOR.system();
    const ok = (r, what) => { if (!r || r.ok === false) P.push(what + ': ' + (r ? r.why : 'no result')); return r; };
    // Run fn with the demo clock at a local date and time. Each read of the clock moves on a millisecond and the clock never goes
    // back (two steps at the same minute follow each other), so the audit trail stays in date order.
    let lastT = 0;
    function at(when, fn) {
      const [d, t] = when.split(' '); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = (t || '09:00').split(':').map(Number);
      let next = Math.max(new Date(y, m - 1, dd, h, mi).getTime(), lastT + 1); const real = Date.now;
      Date.now = () => { lastT = next++; return CLOCK_REAL0 + (lastT - CLOCK_START); };
      try { return fn(); } finally { Date.now = real; }
    }
    const steps = [];
    const story = (key, list) => list.forEach(([when, fn]) => steps.push({ when, key, fn }));
    let idN = 0;
    function open(key, co) {
      const p = CLIENTS[key]; idN += 1;
      const cl = ENGINE.newClient({ name: p.name, idNo: demoId(p.dob, 5000 + idN * 37), taxRef: String(9061000000 + idN * 7331), provisional: p.provisional !== false,
        others: p.others || [], kyc: co && co.kyc });
      const c = ENGINE.newCase(cl, { consultant: p.tc || 'TC1', items: co.items, priorYear: co.priorYear || ['employment', 'medical'] });
      K[key] = { cl, c, tc: tc(p.tc) };
      DEMO.keys[key] = c.id;
      return K[key];
    }
    const drive = (key, gate, o) => { const r = ENGINE.drive(K[key].c, gate, o || {}); ok(r.ok && ENGINE.currentGate(K[key].c) === gate ? r : { ok: false, why: (r.why || 'stopped') + ' at ' + ENGINE.currentGate(K[key].c) }, key + ' drive to ' + gate); };
    // The simulated extraction: each value is tied to the newest validated document of its kind.
    function extract(key, lines, medical, extra, note) {
      const { c } = K[key];
      const inputs = Object.assign({ lines: lines.map((l, i) => {
        const d = l.doc ? c.docs.filter((x) => x.kind === l.doc && x.status === 'validated').pop() : null;
        if (l.doc && !d) P.push(key + ': no validated ' + l.doc + ' document for ' + l.ref);
        return Object.assign({ id: 'L' + (i + 1), docId: d ? d.id : null, ref: l.ref, field: l.field, amount: l.amount }, l.decided ? { decided: l.decided } : {});
      }) }, medical ? { medical } : {}, extra || {});
      ok(ENGINE.setInputs(c, ai, inputs, { note: note || 'Extracted the values from the validated documents (simulated)' }), key + ' extract');
    }
    const calc = (key, a) => ok(ENGINE.calculate(K[key].c, a || ai), key + ' calculate');
    const rel = (key, g, a) => ok(ENGINE.release(K[key].c, g, a || K[key].tc), key + ' release ' + g);
    const up = (key, kind, name, size) => { const { c } = K[key]; const it = c.items.find((x) => x.kind === kind); return ok(ENGINE.upload(c, it.id, { name, size: size || 245760 }, ACTOR.client(c.clientId)), key + ' upload ' + name); };
    const itx = (key, fn) => S.txs.filter((t) => t.caseId === K[key].c.id && t.fn === (fn || 'itr12')).pop();
    const file = (key, outcome) => { const t = itx(key); ok(ENGINE.signG18(t, ia), key + ' G18 integration sign-off'); ok(ENGINE.signG18(t, K[key].tc), key + ' G18 consultant sign-off'); ok(ENGINE.transmit(t, ia, outcome || 'success'), key + ' transmit'); };
    const sarsSays = (key, patch) => { const { c, cl } = K[key]; const inp = structuredClone(c.inputs); patch(inp); return CALC.compute(inp, CALC.profileOf(cl, c.year, inp), RULESET).summary; };
    const ita34 = (key, ref, date, data) => { const { c, cl } = K[key]; ENGINE.receive({ fn: 'ita34', taxRef: cl.taxRef, year: c.year, ref, date, data, submissionRef: c.submission ? c.submission.ref : null }); };

    /* ---------- 1. Onboarding: G01 blocked by KYC-01 (proof of address) and KYC-05 (unsigned mandate) ---------- */
    story('onboarding', [
      ['2026-11-03 10:15', () => {
        open('onboarding', { items: ['irp5', 'medical'], kyc: { address: false, mandate: false } });
        const { c } = K.onboarding;
        ENGINE.raise(c, 'KYC-01', { by: sys, note: 'Proof of address not received' });
        ENGINE.raise(c, 'KYC-05', { by: sys, note: 'The appointment letter and mandate are not signed' });
      }],
    ]);
    /* ---------- 2. SARS details: MD-05 bank mismatch and MD-01 address difference at G02 ---------- */
    story('details', [
      ['2026-10-29 11:00', () => { open('details', { items: ['irp5', 'medical'] }); drive('details', 'G02'); }],
      ['2026-11-04 09:40', () => {
        const { c } = K.details;
        ok(ENGINE.markReq(c, 'G02', 'compare', ai), 'details compare');
        ENGINE.raise(c, 'MD-05', { by: ai, note: 'The bank confirmation letter shows a different account from the one SARS holds (simulated comparison)' });
        ENGINE.raise(c, 'MD-01', { by: ai, note: 'SARS holds a residential address in Pretoria; the client record says Centurion (simulated comparison)' });
      }],
    ]);
    /* ---------- 3. Questionnaire: QUE-04 retirement annuity gone, QUE-03 new rental ---------- */
    story('questionnaire', [
      ['2026-10-27 14:20', () => { open('questionnaire', { items: ['irp5', 'medical'], priorYear: ['employment', 'medical', 'ra'] }); drive('questionnaire', 'G03'); }],
      ['2026-11-05 19:05', () => {
        const { c } = K.questionnaire;
        [['employment', true], ['medical', true], ['ra', false], ['interest', false], ['rental', true], ['cgt', false], ['foreign', false]]
          .forEach(([key, value]) => ENGINE.portal(c, 'answer', { key, value }));
        ENGINE.portal(c, 'submitQuestionnaire');
      }],
    ]);
    /* ---------- 4. Documents: AI-01 low confidence, DOC-02 IRP5 against the pre-populated data, DOC-01 missing certificate ---------- */
    story('documents', [
      ['2026-10-20 08:30', () => {
        open('documents', { items: ['irp5', 'medical'] });
        const { c, cl } = K.documents;
        ENGINE.receive({ fn: 'prepop', taxRef: cl.taxRef, year: c.year, ref: 'PREPOP-2026', date: '2026-10-20', data: { remuneration: 398400, paye: 61200 } });
        drive('documents', 'G04');
      }],
      ['2026-11-04 20:12', () => {
        const { c } = K.documents;
        up('documents', 'irp5', 'IRP5_2026_scan_whatsapp.jpg', 182000);
        const d = c.docs[c.docs.length - 1];
        ENGINE.raise(c, 'DOC-02', { by: ai, docId: d.id, note: 'IRP5 remuneration R412,900.00 differs from the SARS pre-populated R398,400.00' });
        ENGINE.portal(c, 'submitDocs');
      }],
    ]);
    /* ---------- 5. Documents: DOC-04 the spouse's IRP5 (S1) with the linked SEC-01 incident ---------- */
    story('wrongTaxpayer', [
      ['2026-10-26 09:10', () => { open('wrongTaxpayer', { items: ['irp5', 'medical'] }); drive('wrongTaxpayer', 'G04'); }],
      ['2026-11-06 16:45', () => { up('wrongTaxpayer', 'irp5', 'IRP5_2026_Lindiwe_Molefe.pdf'); }],
    ]);
    /* ---------- 6. Calculation: TAX-02 home office (a judgement) and TAX-05 a material change on last year ---------- */
    story('judgement', [
      ['2026-10-14 10:00', () => { open('judgement', { items: ['irp5', 'medical', 'homeoffice'] }); drive('judgement', 'G05'); }],
      ['2026-11-05 11:30', () => {
        extract('judgement', IRP5(612400, 158900).concat(MED(52800, 6400), [ln('homeoffice', 'Home office schedule: costs claimed', 'homeOffice', 24000)]),
          { months: 12, dependants: 1 }, { prior: { taxableIncome: 402000 } });
        calc('judgement');
      }],
    ]);
    /* ---------- 7. Calculation: clean, G05 ready for the consultant (pension fund, retirement annuity, donations) ---------- */
    story('calcReady', [
      ['2026-10-12 09:00', () => { open('calcReady', { items: ['irp5', 'medical', 'ra', 'donation'], priorYear: ['employment', 'medical', 'ra'] }); drive('calcReady', 'G05'); }],
      ['2026-11-06 15:20', () => {
        extract('calcReady', IRP5(948000, 268400, [ln('irp5', 'IRP5 code 4001: pension fund contributions', 'retirementFund', 71100)])
          .concat(MED(64800, 9500), [ln('ra', 'Retirement annuity certificate: contributions', 'ra', 120000), ln('donation', 'Section 18A receipt', 'donations', 30000)]),
        { months: 12, dependants: 2 }, { prior: { taxableIncome: 731000 } });
        calc('calcReady');
      }],
    ]);
    /* ---------- 8. Client approval: pack sent, G06 pending, the CLT-05 reminder running ---------- */
    story('approval', [
      ['2026-10-08 13:00', () => { open('approval', { items: ['irp5', 'medical'] }); drive('approval', 'G05'); }],
      ['2026-11-03 10:00', () => { extract('approval', IRP5(356000, 52700).concat(MED(31200, 0)), { months: 12, dependants: 0 }); calc('approval'); rel('approval', 'G05'); }],
      ['2026-11-04 09:00', () => { ok(ENGINE.remind(K.approval.c, 'approval', ad), 'approval reminder'); }],
    ]);
    /* ---------- 9. Rework: approved, then CLT-03 new information, version 2 and VER-01 ---------- */
    story('rework', [
      ['2026-10-05 09:30', () => { open('rework', { items: ['irp5', 'medical', 'ra'], priorYear: ['employment', 'medical', 'ra'] }); drive('rework', 'G05'); }],
      ['2026-10-28 10:10', () => {
        extract('rework', IRP5(524000, 107300).concat(MED(46800, 3100), [ln('ra', 'Retirement annuity certificate: contributions', 'ra', 36000)]), { months: 12, dependants: 1 });
        calc('rework'); rel('rework', 'G05');
      }],
      ['2026-10-30 18:40', () => { ok(ENGINE.portal(K.rework.c, 'approve', { version: ENGINE.vN(K.rework.c), declaration: true }), 'rework approve'); }],
      ['2026-11-03 08:50', () => {
        const { c } = K.rework;
        ok(ENGINE.raiseManual(c, 'CLT-03', K.rework.tc, { note: 'After approving, the client sent a section 18A receipt for a R15,000.00 donation' }), 'rework CLT-03');
        ENGINE.addItem(c, 'donation');
        up('rework', 'donation', 'Section18A_receipt_2026.pdf');
      }],
      ['2026-11-04 11:25', () => {
        const { c } = K.rework;
        extract('rework', IRP5(524000, 107300).concat(MED(46800, 3100), [ln('ra', 'Retirement annuity certificate: contributions', 'ra', 36000), ln('donation', 'Section 18A receipt', 'donations', 15000)]),
          { months: 12, dependants: 1 }, null, 'Added the section 18A receipt the client sent after approving (simulated extraction)');
        calc('rework', K.rework.tc);
        const x = ENGINE.exOf(c).find((y) => y.code === 'CLT-03' && ENGINE.isOpen(y));
        if (x) ok(ENGINE.resolve(x, K.rework.tc, { action: 'The receipt is in the calculation as version 2' }), 'rework resolve CLT-03');
        rel('rework', 'G05');
      }],
    ]);
    /* ---------- 10. Ready to submit: through G07, G08 and G09; G18 has the first of its two sign-offs ---------- */
    story('ready', [
      ['2026-09-29 10:00', () => { open('ready', { items: ['irp5', 'medical', 'it3b'], priorYear: ['employment', 'medical', 'interest'] }); drive('ready', 'G05'); }],
      ['2026-10-30 14:00', () => { extract('ready', IRP5(468000, 89500).concat(MED(39600, 0), [ln('it3b', 'IT3(b): local interest', 'interest', 18750)]), { months: 12, dependants: 0 }); calc('ready'); rel('ready', 'G05'); }],
      ['2026-11-02 21:15', () => { drive('ready', 'G18'); }],
      ['2026-11-09 08:35', () => { ok(ENGINE.signG18(itx('ready'), ia), 'ready G18 integration sign-off'); }],
    ]);
    /* ---------- 11. Submission: INT-04 unknown status, no retry until SARS's status is checked (65+, medical credits) ---------- */
    story('unknown', [
      ['2026-09-15 09:00', () => { open('unknown', { items: ['irp5', 'medical', 'it3b'], priorYear: ['employment', 'medical', 'interest'] }); drive('unknown', 'G05'); }],
      ['2026-10-21 10:30', () => { extract('unknown', IRP5(384000, 41200).concat(MED(74400, 28600), [ln('it3b', 'IT3(b): local interest', 'interest', 61500)]), { months: 12, dependants: 1 }); calc('unknown'); rel('unknown', 'G05'); }],
      ['2026-10-26 12:00', () => { drive('unknown', 'G18'); }],
      ['2026-11-06 14:10', () => { file('unknown', 'unknown'); }],
    ]);
    /* ---------- 12. After filing: DA-01 with drafted answers; DA-05 as the due date nears ---------- */
    story('declaration', [
      ['2026-08-03 09:00', () => { open('declaration', { items: ['irp5', 'medical', 'ra'], priorYear: ['employment', 'medical', 'ra'] }); drive('declaration', 'G05'); }],
      ['2026-08-24 10:00', () => { extract('declaration', IRP5(587000, 133900).concat(MED(50400, 7200), [ln('ra', 'Retirement annuity certificate: contributions', 'ra', 54000)]), { months: 12, dependants: 1 }); calc('declaration'); rel('declaration', 'G05'); }],
      ['2026-08-25 19:30', () => { drive('declaration', 'G18'); }],
      ['2026-10-13 10:00', () => { file('declaration'); }],
      ['2026-11-03 07:30', () => {
        const { c, cl } = K.declaration;
        ENGINE.receive({ fn: 'daIn', taxRef: cl.taxRef, year: c.year, ref: 'DA-2026-118204', date: '2026-11-03', due: '2026-11-17', data: { questions: [
          'Confirm the retirement annuity contributions you deducted',
          'Confirm the qualifying medical expenses you claimed',
        ] } });
      }],
      ['2026-11-05 15:40', () => {
        ok(ENGINE.draftResponse(K.declaration.c, ai, 'da', [
          { q: 'Confirm the retirement annuity contributions you deducted', a: 'R54,000.00, as on the fund’s certificate', evidence: 'RA_certificate_2026.pdf' },
          { q: 'Confirm the qualifying medical expenses you claimed', a: 'R7,200.00 not paid by the scheme, as on the scheme’s tax certificate', evidence: 'Medical_scheme_certificate_2026.pdf' },
        ]), 'declaration drafts');
      }],
    ]);
    /* ---------- 13. After filing: VRF-01 verification, VRF-05 incomplete pack, the 21-business-day tracker ---------- */
    story('verification', [
      ['2026-08-10 09:00', () => { open('verification', { items: ['irp5', 'medical', 'ra'], priorYear: ['employment', 'medical', 'ra'] }); drive('verification', 'G05'); }],
      ['2026-09-07 11:00', () => { extract('verification', IRP5(702000, 171800).concat(MED(55200, 12800), [ln('ra', 'Retirement annuity certificate: contributions', 'ra', 96000)]), { months: 12, dependants: 2 }); calc('verification'); rel('verification', 'G05'); }],
      ['2026-09-09 08:15', () => { drive('verification', 'G18'); }],
      ['2026-09-25 09:45', () => { file('verification'); }],
      ['2026-10-13 07:30', () => {
        const { c, cl } = K.verification;
        const due = DATES.iso(DATES.addBusinessDays(DATES.dt('2026-10-13'), 21));
        ENGINE.receive({ fn: 'vrfIn', taxRef: cl.taxRef, year: c.year, ref: 'VRF-2026-554310', date: '2026-10-13', due, data: { requests: [
          'Retirement annuity certificates for every fund', 'Medical scheme tax certificate', 'Proof of out-of-pocket medical expenses'] } });
      }],
      ['2026-11-06 10:20', () => {
        ENGINE.raise(K.verification.c, 'VRF-05', { by: ai, note: 'Proof of the R12,800.00 out-of-pocket medical expenses is missing from the response pack' });
      }],
      // Overnight: the AI indexes the response pack for the consultant's review (it cannot pass G11 itself).
      ['2026-11-09 02:10', () => {
        ok(ENGINE.draftResponse(K.verification.c, ai, 'vrf', [
          { q: 'Retirement annuity certificates for every fund', a: 'One fund: R96,000.00 on the certificate', evidence: 'RA_certificate_2026.pdf' },
          { q: 'Medical scheme tax certificate', a: 'Contributions R55,200.00 for 12 months, two dependants', evidence: 'Medical_scheme_certificate_2026.pdf' },
          { q: 'Proof of out-of-pocket medical expenses', a: 'Still missing: the R12,800.00 of receipts (VRF-05)', evidence: null },
        ]), 'verification overnight pack index');
      }],
    ]);
    /* ---------- 14. Assessment: ASM-02 the ITA34 differs (SARS used R42,000.00 for the retirement annuity); G13 pending ---------- */
    story('assessment', [
      ['2026-08-18 09:00', () => { open('assessment', { items: ['irp5', 'medical', 'ra', 'it3c'], priorYear: ['employment', 'medical', 'ra', 'cgt'] }); drive('assessment', 'G05'); }],
      ['2026-09-21 10:00', () => {
        extract('assessment', IRP5(735000, 196500).concat(MED(57600, 0), [ln('ra', 'Retirement annuity certificate: contributions', 'ra', 60000),
          ln('it3c', 'IT3(c): listed shares', 'capitalGain', 185000), ln('it3c', 'IT3(c): unit trusts', 'capitalGain', -22000)]), { months: 12, dependants: 1 });
        calc('assessment'); rel('assessment', 'G05');
      }],
      ['2026-09-22 20:00', () => { drive('assessment', 'G18'); }],
      ['2026-10-02 09:30', () => { file('assessment'); }],
      ['2026-10-28 06:00', () => { ita34('assessment', 'ITA34-2026-7781230', '2026-10-28', sarsSays('assessment', (inp) => { inp.lines.find((l) => l.field === 'ra').amount = 42000; })); }],
    ]);
    /* ---------- 15. Remedies: CLT-07 and REM-01, then REM-05 objection with its Chapter 9 deadline ---------- */
    story('remedy', [
      ['2026-07-20 09:00', () => { open('remedy', { items: ['irp5', 'medical', 'donation'] }); drive('remedy', 'G05'); }],
      ['2026-08-04 10:00', () => {
        extract('remedy', IRP5(498000, 98600).concat(MED(42000, 5600), [ln('donation', 'Section 18A receipt', 'donations', 25000)]), { months: 12, dependants: 1 });
        calc('remedy'); rel('remedy', 'G05');
      }],
      ['2026-08-06 18:00', () => { drive('remedy', 'G18'); }],
      ['2026-08-18 09:15', () => { file('remedy'); }],
      ['2026-09-03 06:00', () => { ita34('remedy', 'ITA34-2026-6620917', '2026-09-03', sarsSays('remedy', (inp) => { inp.lines = inp.lines.filter((l) => l.field !== 'donations'); })); }],
      ['2026-09-10 11:00', () => {
        const { c } = K.remedy;
        const x = ENGINE.exOf(c).find((y) => y.code === 'ASM-02' && ENGINE.isOpen(y));
        if (x) ok(ENGINE.resolve(x, K.remedy.tc, { action: 'SARS disallowed the section 18A donation of R25,000.00; the receipt is valid', evidence: 'Section18A_receipt_2026.pdf' }), 'remedy resolve ASM-02');
        drive('remedy', 'G14');
      }],
      ['2026-09-15 17:20', () => { ok(ENGINE.portal(K.remedy.c, 'decide', { choice: 'instruct', note: 'Please object: the donation receipt is valid' }), 'remedy decide'); }],
      ['2026-09-22 10:30', () => { ok(ENGINE.chooseRemedy(K.remedy.c, K.remedy.tc, 'objection', { evidence: 'Section 18A receipt from an approved public benefit organisation' }), 'remedy objection'); }],
    ]);
    /* ---------- 16. Closed: G14 accepted, the retention date set (age 76: tertiary rebate, 65+ medical credits) ---------- */
    story('closed', [
      ['2026-07-14 09:00', () => { open('closed', { items: ['irp5', 'medical', 'it3b'], priorYear: ['employment', 'medical', 'interest'] }); drive('closed', 'G05'); }],
      ['2026-07-17 10:00', () => { extract('closed', IRP5(296000, 28400).concat(MED(69600, 41200), [ln('it3b', 'IT3(b): local interest', 'interest', 88000)]), { months: 12, dependants: 1 }); calc('closed'); rel('closed', 'G05'); }],
      ['2026-07-18 11:00', () => { drive('closed', 'G18'); }],
      ['2026-07-22 09:30', () => { file('closed'); }],
      ['2026-07-31 06:00', () => { ita34('closed', 'ITA34-2026-5102266', '2026-07-31', K.closed.c.calc.summary); }],
      ['2026-08-04 10:00', () => { drive('closed', 'G14'); }],
      ['2026-08-07 12:30', () => { ok(ENGINE.portal(K.closed.c, 'decide', { choice: 'accept', note: '' }), 'closed decide'); }],
    ]);

    steps.sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : 0));
    steps.forEach((s) => { try { at(s.when, s.fn); } catch (e) { P.push(s.key + ' at ' + s.when + ': ' + e.message); } });
    at('2026-11-09 08:58', () => ENGINE.watch());
  };
})();
SEEDERS.push(() => { DEMO.problems = []; DEMO.keys = {}; if (DEMO.cases) DEMO_SEED(); });
