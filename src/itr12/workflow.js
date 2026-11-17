/* ITR12 workflow configuration. REGISTER (the exception register workbook) and WORKFLOW (the master workflow document)
   are generated verbatim from Johan's two files; this module adds the preview's lookups and the control choices that
   his files leave open. Every such choice is listed in PENDING_JOHAN and shown on the Controls page. */

/* ---------- Exception codes: the register rows keyed by code, with severity, blocking and gates parsed ---------- */
const SEV = ['S1', 'S2', 'S3', 'S4'];
const SEV_LABEL = { S1: 'S1 Critical', S2: 'S2 High', S3: 'S3 Medium', S4: 'S4 Low' };
const CODE = {};
REGISTER.codes.forEach((r) => {
  const parts = r.gates.split(';').map((s) => s.trim()).filter(Boolean);
  CODE[r.code] = Object.assign({}, r, {
    sev: r.severity.slice(0, 2),
    fam: r.code.split('-')[0],
    gateList: parts.filter((p) => /^G\d\d$/.test(p)),
    // 'Relevant gate' (AI-06), 'Relevant substantive gate' (INT-09, INT-13) or 'Any substantive gate' (INT-11), resolved at run time.
    runtime: parts.find((p) => !/^G\d\d$/.test(p)) || null,
  });
});
const FAMILY_ORDER = Array.from(new Set(REGISTER.codes.map((r) => r.code.split('-')[0])));

/* ---------- Gates: the register's Gate Map joined with the document's gate boxes and the preview's release rules ---------- */
const GATE_BOX = {};
WORKFLOW.phases.forEach((ph) => ph.gates.forEach((g) => { GATE_BOX[g.gate] = Object.assign({ phase: ph.n, phaseTitle: ph.title }, g); }));
// Who can release each gate. 'role': a person holding that role. 'client': the client, only through a PaperSync portal action.
// 'ai': the AI check passes it when nothing blocks and the independent reviewer agrees, otherwise the named role (for exceptions).
// 'system': Operon only. 'dual': two different people, the Integration Administrator and the substantive gate owner.
const RELEASE = {
  G01: { by: 'role', role: 'Administrator' },
  G02: { by: 'role', role: 'Tax Consultant' },
  G03: { by: 'client' },
  G04: { by: 'ai', role: 'Tax Consultant' },
  G05: { by: 'role', role: 'Tax Consultant' },
  G06: { by: 'client' },
  G07: { by: 'system' },
  G08: { by: 'ai', role: 'Tax Consultant' },
  G09: { by: 'role', role: 'Tax Consultant' },  // "No system or AI may approve this gate."
  G10: { by: 'role', role: 'Tax Consultant' },
  G11: { by: 'role', role: 'Tax Consultant' },
  G12: { by: 'ai', role: 'Tax Consultant' },
  G13: { by: 'role', role: 'Tax Consultant' },
  G14: { by: 'client' },
  G15: { by: 'role', role: 'Tax Consultant' },
  G16: { by: 'role', role: 'Records/Compliance Owner' },
  G17: { by: 'role', role: 'Information Officer' },
  G18: { by: 'dual', roles: ['Integration Administrator', 'Tax Consultant'] },
};
const GATE = {};
REGISTER.gates.forEach((g) => {
  const box = GATE_BOX[g.gate] || null;
  GATE[g.gate] = Object.assign({}, g, { box, phase: box ? box.phase : null, release: RELEASE[g.gate] });
});
const GATE_IDS = REGISTER.gates.map((g) => g.gate);

/* ---------- The order a case passes its gates ---------- */
// G10 applies only after a Declaration Alert, G11 only after verification or audit, G15 only when a remedy is needed.
// G17 is per incident and runs in parallel. For G09, G10, G11 and G15 the outbound SARS transaction follows through G18.
const SEQ = ['G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G08', 'G09', 'G18', 'G10', 'G11', 'G12', 'G13', 'G14', 'G15', 'G16'];
const OPTIONAL_GATE = { G10: 'da', G11: 'vrf', G15: 'remedy' };  // case.flags key that switches the gate on (vrf also covers audit)
const SUBSTANTIVE = ['G09', 'G10', 'G11', 'G15'];

/* ---------- The Cases board: columns grouped by phase ---------- */
const BOARD = [
  { key: 'onboarding', label: 'Onboarding', gates: ['G01'] },
  { key: 'sars-details', label: 'SARS details', gates: ['G02'] },
  { key: 'questionnaire', label: 'Questionnaire', gates: ['G03'] },
  { key: 'documents', label: 'Documents', gates: ['G04'] },
  { key: 'calculation', label: 'Calculation & review', gates: ['G05'] },
  { key: 'client-approval', label: 'Client approval', gates: ['G06'] },
  { key: 'final-checks', label: 'Freeze & final checks', gates: ['G07', 'G08', 'G09'] },
  { key: 'submission', label: 'Submission', gates: ['G18'] },
  { key: 'after-filing', label: 'After filing', gates: ['G10', 'G11'] },
  { key: 'assessment', label: 'Assessment', gates: ['G12', 'G13'] },
  { key: 'decision', label: 'Decision & remedies', gates: ['G14', 'G15'] },
  { key: 'closed', label: 'Closed & retained', gates: ['G16'] },
];

/* ---------- The simulated SARS link ---------- */
// 'gate' is the substantive gate an outbound function needs first. 'approved' marks functions inside the SARS-approved
// interface capability the documents assume; any other function raises INT-08. Nothing here connects to SARS.
const SARS_FN = {
  itr12: { label: 'ITR12 submission', dir: 'out', gate: 'G09', approved: true },
  da: { label: 'Declaration Alert response', dir: 'out', gate: 'G10', approved: true },
  vrf: { label: 'Verification or audit response upload', dir: 'out', gate: 'G11', approved: true },
  rfc: { label: 'Request for Correction', dir: 'out', gate: 'G15', approved: true },
  reasons: { label: 'Request for reasons', dir: 'out', gate: 'G15', approved: true },
  objection: { label: 'Notice of objection', dir: 'out', gate: 'G15', approved: true },
  appeal: { label: 'Notice of appeal', dir: 'out', gate: 'G15', approved: true },
  payment: { label: 'Payment arrangement request', dir: 'out', gate: 'G15', approved: false },
  prepop: { label: 'Pre-populated ITR12 data', dir: 'in' },
  notice: { label: 'SARS notice or letter', dir: 'in' },
  daIn: { label: 'Declaration Alert questionnaire', dir: 'in' },
  vrfIn: { label: 'Verification request', dir: 'in' },
  audIn: { label: 'Audit or expanded enquiry', dir: 'in' },
  ita34: { label: 'ITA34 assessment', dir: 'in' },
  outcome: { label: 'Remedy outcome', dir: 'in' },
};
const REMEDY_FN = ['rfc', 'reasons', 'objection', 'appeal', 'payment'];

/* ---------- Statutory periods and the 2026 filing season ---------- */
// Each value carries its source. Business days follow the Tax Administration Act definition; the dispute periods sit in
// Chapter 9, so they also skip 16 December to 15 January. Checked against these sources on 9 Nov 2026.
// Entries with 'days' drive deadlines; entries marked info are shown with their source but do not set a due date.
const SRC = {
  taa: 'https://www.parliament.gov.za/storage/app/media/Acts/2011/Act_28_of_2011_Tax_Administration_Act.pdf',
  rules: 'https://www.sars.gov.za/legal-lsec-tadm-pn-2023-03-notice-3146-gg-48188-new-dispute-resolution-rules-promulgated-under-s-103-10-march-2023/',
  talaa2024: 'https://www.sars.gov.za/wp-content/uploads/Legal/AmendActs/Legal-LPrim-AA-2024-03-Tax-Administration-Laws-Amendment-Act-43-of-2024-GG-51827-24-December-2024.pdf',
  verifyAudit: 'https://www.sars.gov.za/individuals/what-if-i-do-not-agree/being-audited-or-selected-for-verification/',
  efilingGuide: 'https://www.sars.gov.za/wp-content/uploads/Ops/Guides/IT-AE-36-G06-Guide-to-submit-your-individual-income-tax-return-via-eFiling-External-Guide.pdf',
};
const RULES = 'Dispute rules (GN R.3146, GG 48188, 10 March 2023)';
const PERIODS = {
  reasons: { days: 30, ch9: true, label: 'Request for reasons', from: 'the date of assessment', rule: RULES + ', rule 6(1)',
    note: 'SARS may extend the period by up to 45 days (rule 6(3)).', src: SRC.rules },
  objection: { days: 80, ch9: true, label: 'Notice of objection', from: 'delivery of the rule 6(4) notice or the reasons (where reasons were requested), otherwise the date of assessment',
    rule: RULES + ', rule 7(1)', note: 'An objection SARS treats as invalid may be resubmitted within 20 days of delivery of that notice, if the first one was lodged in time (rule 7(5)).', src: SRC.rules },
  appeal: { days: 30, ch9: true, label: 'Notice of appeal', from: 'delivery of the rule 9 notice of disallowance of the objection', rule: RULES + ', rule 10(1)', src: SRC.rules },
  objectionLate: { info: true, label: 'Late objection', rule: 'Tax Administration Act s104(4) and (5), as substituted by Act 43 of 2024 (in force 24 December 2024)',
    text: 'SARS may extend the period by up to 30 business days on reasonable grounds, or by more for exceptional circumstances; never beyond three years from the date of assessment, nor where the grounds are a change in a practice generally prevailing.', src: SRC.talaa2024 },
  appealLate: { info: true, label: 'Late appeal', rule: 'Tax Administration Act s107(2)',
    text: 'SARS may extend the period by up to 21 business days on reasonable grounds, or up to 45 business days for exceptional circumstances.', src: SRC.taa },
  verification: { days: 21, ch9: false, label: 'SARS verification target', from: 'the upload of the requested documents (Day 0)', rule: 'SARS service standard',
    text: '“We will attempt to verify your information within 21 business days after you have uploaded the requested documents.”', src: SRC.verifyAudit },
  audit: { info: true, days: 90, ch9: false, label: 'SARS audit target', from: 'receipt of the audit documents SARS requested', rule: 'SARS service standard',
    text: 'SARS prioritises finalising an audit within 90 business days of receiving the requested documents, and gives progress reports every 90 calendar days from the Notification of Audit.', src: SRC.verifyAudit },
  daWindow: { info: true, label: 'Declaration Questionnaire window', rule: 'SARS eFiling guide IT-AE-36-G06 (Rev 32, effective 24 July 2026)',
    text: 'The questionnaire is available for completion for 24 working hours (8 working hours per day); after that it shows as “Not Completed”. The preview takes the response due date from the SARS notice.', src: SRC.efilingGuide },
  retention: { years: 5, label: 'Record retention', from: 'the date the return was submitted', rule: 'Tax Administration Act s29(3)(a); s32 extends it until an audit is concluded or the assessment or decision becomes final',
    src: SRC.taa },
  businessDay: { label: 'Business day', rule: 'Tax Administration Act s1',
    text: 'Not a Saturday, Sunday or public holiday; for Chapter 9 periods it also excludes 16 December to 15 January, both inclusive. A public holiday on a Sunday moves to the Monday (Public Holidays Act s2(1)).', src: SRC.taa },
};
const FILING_2026 = {
  year: 2026, period: '1 March 2025 to 28 February 2026',
  autoAssessment: { from: '2026-07-01', to: '2026-07-12', label: 'Auto-assessments issued' },
  nonProvisional: { opens: '2026-07-13', closes: '2026-10-23', label: 'Individuals who are not provisional taxpayers' },
  provisional: { opens: '2026-07-13', closes: '2027-01-22', label: 'Provisional taxpayers' },
  src: 'https://www.sars.gov.za/latest-news/changes-for-filing-season-2026/',
};

/* ---------- Policy values Johan has not set yet (conservative defaults; the Records/Compliance Owner can change them) ---------- */
const POLICY0 = {
  overridable: [],          // S2 codes that may be overridden. Empty until Johan decides.
  warnDays: 10,             // business days before a deadline at which PRE-04, DA-05, VRF-03 and REM-09 are raised
  materiality: { amount: 1000, ratio: 0.2 },  // DOC-02 / ASM-02 rand difference and TAX-05 year-on-year ratio
  aiConfidence: 0.85,       // AI-01 below this
  reminderDays: { onboarding: 14, approval: 7 },  // days after the last reminder before CLT-01 / CLT-05
  retentionYears: 5,        // the TAA minimum; a longer firm policy is Johan's call
};
const POLICY_PENDING = ['overridable', 'warnDays', 'materiality', 'aiConfidence', 'reminderDays', 'retentionYears'];

/* ---------- Exception handling rules ---------- */
// No override may bypass a statutory restriction, missing taxpayer authority, a security control or SARS-interface authorisation.
const NEVER_OVERRIDE = {
  authority: [
    'KYC-04',  // the client refuses or cannot give the mandate or engagement information: no authority to act
    'KYC-05',  // the appointment letter and mandate are unsigned, incomplete or out of scope: no authority to act
    'CLT-04',  // the client withholds authority to submit
    'CLT-06',  // the client withdraws approval or authority
    'PRE-03',  // no valid client authority for the version being submitted
    'SUB-05',  // a submission after the client withdrew authority
  ],
  security: ['DOC-04', 'DOC-10'],  // another taxpayer's document; an unsafe file. Plus every SEC-* code (families below)
  statutory: [
    'KYC-06',  // POPIA privacy notice and consent incomplete: a statutory restriction on processing personal information
  ],
  sarsInterface: [
    'MD-06',   // the taxpayer identity or tax-reference link the SARS interface relies on fails (it maps to G18)
  ],
  families: { SEC: 'a security control', INT: 'SARS-interface authorisation', RET: 'a statutory hold' },
};
// Resolved only by the client's own PaperSync portal action (fresh, explicit, version-specific approval). CLT-02 is not here: the
// register makes the Tax Consultant its owner, who resolves it once the concern is investigated (and a revised pack issued if needed).
const PORTAL_ONLY = ['CLT-04', 'CLT-05', 'CLT-06'];
// Codes whose resolution criterion is the approval (and, where there is one, the SARS submission) of their own gate.
// They mark which gates must be passed (again) instead of blocking them; passing those gates closes them.
const BY_GATE = ['DA-01', 'VRF-01', 'AUD-02', 'VRF-04', 'AUD-03', 'REM-02', 'REM-03', 'REM-04', 'REM-05', 'REM-06', 'REM-08', 'SUB-04', 'CLT-07'];
// Raising one of these switches on the optional gate it belongs to.
const OPENS_FLAG = { 'DA-01': 'da', 'VRF-01': 'vrf', 'DA-04': 'vrf', 'AUD-01': 'aud', 'AUD-02': 'aud', 'CLT-07': 'remedy', 'SUB-04': 'remedy',
  'REM-01': 'remedy', 'REM-02': 'remedy', 'REM-03': 'remedy', 'REM-04': 'remedy', 'REM-05': 'remedy', 'REM-06': 'remedy' };

/* ---------- The mandatory exception object (master document, Phase 20) and where each field lives ---------- */
const EX_OBJECT = [
  { label: 'Exception ID and code', keys: ['id', 'code'] },
  { label: 'Client and tax year/case', keys: ['clientId', 'year', 'caseId'] },
  { label: 'Workflow stage and approval gate', keys: ['stage', 'gates'] },
  { label: 'Severity and blocking status', keys: ['severity', 'blocking'] },
  { label: 'Trigger and source', keys: ['trigger', 'source'] },
  { label: 'Raised by AI/system/human/SARS', keys: ['raisedBy'] },
  { label: 'Owner and secondary reviewer', keys: ['owner', 'secondary'] },
  { label: 'Client action required and due date', keys: ['clientAction', 'clientDue'] },
  { label: 'SARS statutory/procedural deadline', keys: ['sarsDeadline'] },
  { label: 'Related exception', keys: ['related', 'parent'] },
  { label: 'Resolution action/evidence', keys: ['resolution', 'evidence'] },
  { label: 'Resolved by/timestamp', keys: ['resolvedBy', 'resolvedAt'] },
  { label: 'Human approval required', keys: ['humanApproval'] },
  { label: 'Gate released status', keys: ['gateReleased'] },
];

/* ---------- Texts the engine uses, taken verbatim from the master document ---------- */
const STEP = {};
WORKFLOW.phases.forEach((ph) => ph.steps.forEach((s) => { STEP[s.n] = Object.assign({ phase: ph.n, phaseTitle: ph.title }, s); }));
const G18_CHECKS = STEP[17].items.slice();   // step 17: the eight G18 integration gatekeeper checks, in order
const DECLARATION = STEP[14].text[0];        // step 14: the client's affirmative, version-specific declaration
const AUDIT_ITEMS = STEP[26].items.slice();  // step 26: what the immutable event history records
// Step 22: the values compared between the firm's final approved calculation and the ITA34.
const ITA34_FIELDS = [
  { key: 'taxableIncome', label: 'Taxable income' }, { key: 'normalTax', label: 'Normal tax' }, { key: 'rebates', label: 'Rebates' },
  { key: 'medicalCredits', label: 'Medical credits' }, { key: 'paye', label: 'PAYE' }, { key: 'provisional', label: 'Provisional tax' },
  { key: 'otherCredits', label: 'Other credits' }, { key: 'result', label: 'Refund (−) or payment (+)' },
];

/* ---------- Simulated AI checks on uploads: file name and size only; file contents are never read ---------- */
const UPLOAD = {
  unsafe: /\.(exe|bat|cmd|com|scr|js|jse|vbs|vbe|ps1|msi|jar|dll|hta|wsf|lnk|iso)$/i,
  ok: /\.(pdf|jpe?g|png|heic|tiff?|docx?|xlsx?|csv)$/i,
  maxBytes: 20 * 1024 * 1024,
  minBytes: 20 * 1024,
  encrypted: /encrypt|password|protected|locked/i,
  lowConfidence: /scan|photo|img[_-]?\d|whatsapp|blurry|screenshot/i,
};
const DOC_KINDS = [
  { kind: 'irp5', label: 'IRP5 employee tax certificate', rx: /irp\s?-?5|employee tax cert/i },
  { kind: 'it3b', label: 'IT3(b) investment income certificate', rx: /it3\s?\(?b\)?|interest cert|investment income/i },
  { kind: 'it3c', label: 'IT3(c) capital gains statement', rx: /it3\s?\(?c\)?|capital gain|\bcgt\b/i },
  { kind: 'medical', label: 'Medical scheme tax certificate', rx: /medical|med\s?aid|scheme cert/i },
  { kind: 'ra', label: 'Retirement annuity certificate', rx: /retirement annuity|\bra\b|annuity/i },
  { kind: 'rental', label: 'Rental income and expenses', rx: /rent|lease|letting/i },
  { kind: 'logbook', label: 'Travel logbook', rx: /log\s?book|travel/i },
  { kind: 'homeoffice', label: 'Home office expenses', rx: /home\s?office/i },
  { kind: 'donation', label: 'Section 18A donation receipt', rx: /18a|donation/i },
  { kind: 'foreign', label: 'Foreign income statement', rx: /foreign|offshore/i },
  { kind: 'bank', label: 'Bank confirmation letter', rx: /bank conf|bank letter|bank statement/i },
  { kind: 'notice', label: 'SARS notice or letter', rx: /sars|notice|letter/i },
  // Added for the step 5 questionnaire areas (trade or business, trust distributions, pension or annuity income, disability).
  { kind: 'business', label: 'Business income and expense records', rx: /business|self.?employ|trading/i },
  { kind: 'trust', label: 'Trust distribution statement', rx: /trust/i },
  { kind: 'pension', label: 'Pension or annuity income certificate', rx: /pension/i },
  { kind: 'disability', label: 'Confirmation of disability (ITR-DD)', rx: /itr.?dd|disab/i },
];

/* ---------- Choices and gaps put to Johan (shown on the Controls page). The register wins where his files differ. ---------- */
const PENDING_JOHAN = [
  { id: 'q-g08-pre', topic: 'G08 box vs register', text: 'The document’s G08 box lists PRE-03 and PRE-04; the register maps both to G09 only. The preview follows the register.' },
  { id: 'q-g11-box', topic: 'G11 box vs register', text: 'The document’s G11 box covers VRF-01 to VRF-05 and AUD-01 to AUD-03; the register maps VRF-04 and AUD-03 to G12, G13 and G15. The preview follows the register.' },
  { id: 'q-g12-asm04', topic: 'G12 box vs register', text: 'The document’s G12 box lists ASM-04; the register maps it to G13 only. The preview follows the register.' },
  { id: 'q-owners', topic: 'Owners missing from the role table', text: 'The register names a PaperSync Administrator (AI-06, VER-02), a PaperSync Product Owner (AI-07; secondary on TAX-06), a Compliance Owner and a Records Owner. The role table has one Records/Compliance Owner and no platform roles. The preview uses one Records/Compliance Owner and simulates the platform team.' },
  { id: 'q-relevant', topic: '“Relevant gate”', text: 'AI-06 is mapped to “Relevant gate” and appears in no Gate Map row; INT-09, INT-11 and INT-13 use “Relevant/Any substantive gate”. The preview resolves these when the exception is raised: the case’s current gate for AI-06, and the transaction’s substantive gate (G09, G10, G11 or G15) for the INT codes.' },
  { id: 'q-policy', topic: 'Policy values', text: 'Not defined yet, so the preview uses conservative defaults: which S2 codes may be overridden (none), materiality thresholds (DOC-02, TAX-05, ASM-02), the AI confidence threshold (AI-01), reminder expiry (CLT-01, CLT-05), the deadline warning window and any retention period beyond the statutory five years.' },
  { id: 'q-stage-labels', topic: 'Cosmetic', text: 'Stage labels mix “Phase 7-8” and “Phases 7-8”, and the Stage Map sheet joins gate strings. The preview derives its stage map from the register rows.' },
  { id: 'q-by-gate', topic: 'Codes resolved by their own gate', text: 'DA-01, VRF-01, AUD-02, VRF-04, AUD-03, REM-02 to REM-06, REM-08, SUB-04 and CLT-07 are blocking on a gate whose approval (or submission) is their own resolution criterion, so read literally they could never clear. The preview treats them as resolved by passing those gates, and re-opens a gate that had already passed when one is raised later (for example REM-08 re-opens G12 to G14).' },
  { id: 'q-clt07', topic: 'CLT-07', text: 'CLT-07 is resolved when the remedy route is approved and initiated (G15), or by the Tax Consultant documenting advice. The client’s instruction itself passes G14, which then raises CLT-07 and REM-01 for G15.' },
  { id: 'q-secondary', topic: 'Secondary reviewer', text: 'Where the register names a secondary reviewer, the preview has that role close the exception after the owner resolves it, and the reviewer must be a different person. The exception keeps blocking until it is closed.' },
  { id: 'q-s1-scope', topic: 'Scope of an S1 hard stop', text: '“S1 Critical is always a hard stop for the affected process.” The preview stops every gate and SARS transaction on the case except incident handling (G17).' },
  { id: 'q-override', topic: 'Overrides', text: 'An override is approved by the Records/Compliance Owner, who must not be the person who asked for it. It applies to the version it was approved on and lapses when a new version is created.' },
  { id: 'q-ret', topic: 'Retention holds', text: 'The register raises RET-01 and RET-02 when retention expires while a verification, audit or dispute is still open. The preview records the hold when that process starts (TAA s32) and raises the RET code at the review date if the hold is still active.' },
  { id: 'q-da-name', topic: 'Declaration Alert', text: 'The documents say “Declaration Alert”. SARS’s eFiling guide (IT-AE-36-G06) calls it the “Declaration Questionnaire” and its filing-season 2026 page the “Alert Declaration questionnaire”. The preview uses Johan’s term. The guide says the questionnaire stays open for 24 working hours; the preview takes the response due date from the SARS notice and shows that window beside it.' },
  { id: 'q-multi-gate', topic: 'Codes mapped to several gates', text: 'QUE-03 (G03, G05), MD-04 (G02, G05), DOC-09 (G04, G05), CLT-03 (G05 to G07) and VER-03 (G07, G09) block every gate they are mapped to, so while one is open the earliest of those gates cannot pass, even where its resolution (for example “technical treatment is approved”) belongs to a later step. The preview has the owner resolve it at the earliest gate; the later gates then re-check the outcome through their own criteria.' },
  { id: 'q-g10-da04', topic: 'G10 box vs register', text: 'The document’s G10 box lists DA-04 (“routed to verification”); the register maps DA-04 to G11 only. The preview follows the register for the exception. It follows the G10 box (“or move to verification”) for the gate: once SARS moves the questionnaire to verification, G10 passes without a response.' },
  { id: 'q-conditional', topic: '“Conditional” blocking', text: 'The register marks AI-06, INT-03, INT-13 and INT-15 “Conditional” but does not say what the condition is. The preview reads it as: the code blocks its gates until the service is restored or a retry succeeds, or until a manual fallback is recorded by one person and reconciled by a different person. Other readings are possible: it could block only while the service is down, never block once a fallback is recorded, or block only for some transactions. Which does Johan mean?' },
  { id: 'q-standins', topic: 'Who may resolve for the client, the AI or the system', text: 'Client-owned codes (QUE-01, QUE-02, QUE-04, DOC-01, DOC-03, DOC-07, DA-02, VRF-02, ASM-04, REM-07) may also be recorded as resolved by the Tax Consultant or the Administrator. DOC-05 (owner: AI Agent) and PRE-02 (owner: the system) may be resolved by the Tax Consultant.' },
  { id: 'q-s3-gate', topic: 'S3 codes that block', text: 'The Instructions sheet says S3 holds the affected item while unrelated work continues. The Gate Map says a gate cannot be released while a blocking mapped exception is open. The preview follows the Gate Map: an S3 code marked Blocking = Yes stops every gate it is mapped to, not only the item.' },
  { id: 'q-never-override', topic: 'Codes that may never be overridden', text: 'Missing taxpayer authority: KYC-04, KYC-05, CLT-04, CLT-06, PRE-03 and SUB-05. Security controls: DOC-04, DOC-10 and every SEC code. Statutory restrictions: KYC-06 (POPIA) and every RET code (statutory holds). SARS-interface authorisation: MD-06 and every INT code. The preview never offers these for override. Is the list complete?' },
  { id: 'q-ai-lower', topic: 'The AI and severity', text: 'The document stops the AI lowering an S1 or S2 severity. The preview goes further: the AI may raise any severity but may not lower any, including S3 to S4.' },
  { id: 'q-severity-blocking', topic: 'Severity and blocking', text: 'The register keeps Severity and Blocking as separate columns. In the preview a severity change never changes Blocking: a code the register marks blocking still blocks at S4. Only the code’s owner may ask to lower the severity of a blocking code, and the Records/Compliance Owner (a different person) approves it.' },
  { id: 'q-g01-master', topic: 'What G01 checks', text: 'G01 checks the six KYC items on the client record. It does not check the Phase 1 client master fields. Which of those fields are mandatory before G01 can pass is Johan’s call.' },
  { id: 'q-g01-scope', topic: 'G01 and G02 on each annual case', text: 'The document makes KYC (G01) and the SARS details check (G02) client-level, and creates the annual case after G02. The preview opens the annual case first and tracks G01 and G02 on it, so a returning client goes through them again each year.' },
  { id: 'q-engagement', topic: 'Engagement terms', text: 'G01 asks for “Engagement terms accepted” as well as the five Phase 2 items. The signed appointment letter and mandate already cover scope, responsibilities and fees. Does Johan want separate engagement terms, or should the item go?' },
];
