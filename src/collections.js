/* Document collections: the firm sends a checklist, the client uploads through a portal, the firm sees what came back.
   Uses app globals (S, $, $$, esc, btn, modal, closeDialog, toast, client, task, me, pname, addAudit, jobLog, roleOf,
   stateWord, tierBadge, jobCard, fDM, fWhen, fTime, daysTo, day, now, hash, pad2, FIRM, ACT, FORMS, EXT_FIELD, render).
   Security: every data string (client names, titles, item and file names, settings and template text, ids and tokens)
   goes through esc() or textContent. Data never goes into href, src or style: links use app-generated ids that are
   checked against [A-Za-z0-9]. There are no external links. Uploaded files are never read or sent: only File.name and
   File.size are kept, in memory. */

const DC_ALNUM = /^[A-Za-z0-9]{1,40}$/;
const dcOk = (s) => typeof s === 'string' && DC_ALNUM.test(s);
const DC_SECS = ['General', 'Banking', 'Sales & purchases', 'Payroll', 'Tax', 'Company/CIPC', 'Stock'];
const DC_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DC_STATUS = { draft: 'Draft', pending: 'Pending', in_progress: 'In progress', complete: 'Complete', overdue: 'Overdue', cancelled: 'Cancelled', archived: 'Archived' };
const DC_COLS = [
  ['overdue', 'Overdue', 'Past due, not complete'],
  ['pending', 'Pending', 'Sent. Nothing back yet'],
  ['in_progress', 'In progress', 'Some documents are in'],
  ['complete', 'Complete', 'Everything is in'],
  ['filed', 'Filed on SARS', 'Return filed on eFiling'],
];
const DC_CADENCE = [['2', 'Every 2 days'], ['3', 'Every 3 days'], ['7', 'Every week (recommended)'], ['14', 'Every 2 weeks'], ['custom', 'Custom']];
const DC_VERIFY = {
  reg: ['Company registration number', 'The 6 middle digits of the company registration number'],
  phone: ['Cellphone number on file', 'The last 4 digits of your cellphone number'],
  code: ['One-time code by SMS (simulated)', 'The 6-digit code we sent you by SMS'],
};
const DC_REC = [['', 'Does not repeat'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['annually', 'Annually']];
const DC_MAX_FILE = 50 * 1024 * 1024;

/* ---------- small helpers ---------- */
const dcClean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 120);
const dcHref = (id) => (dcOk(id) ? '#collection-' + id : '#collections');
const dcGet = (id) => (S.coll && dcOk(id) ? S.coll.list.find((k) => k.id === id) : null) || null;
const dcByToken = (t) => (S.coll && dcOk(t) ? S.coll.list.find((k) => k.token === t) : null) || null;
const dcTpl = (id) => S.coll.tpls.find((t) => t.id === id) || null;
const dcTypeName = (id) => { const t = dcTpl(id); return t ? t.name : 'Custom'; };
const dcIsDone = (it) => it.state === 'uploaded' || it.state === 'na';
const dcActive = (k) => k.status === 'pending' || k.status === 'in_progress';
const dcOverdue = (k) => dcActive(k) && !!k.due && daysTo(k.due) < 0;
const dcNid = (p) => p + (++S.coll.n);
function dcRand(n) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(n);
  try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 4294967295); }
  let out = ''; for (let i = 0; i < n; i++) out += abc[a[i] % abc.length];
  return out;
}
function dcSize(b) {
  const n = Math.max(0, Number(b) || 0);
  if (n < 1024) return n + ' B';
  if (n < 1048576) return Math.round(n / 1024) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function dcProg(k) {
  const n = k.items.length; const up = k.items.filter((i) => i.state === 'uploaded').length; const na = k.items.filter((i) => i.state === 'na').length;
  const d = up + na;
  return { n, up, na, d, pct: n ? Math.round(d * 100 / n) : 0 };
}
const dcPl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const dcBar = (p) => `<span class="dc-bar${p.d === p.n && p.n ? ' ok' : ''}" role="img" aria-label="${p.d} of ${p.n} documents done"><i class="dc-p${Math.round(p.pct / 5)}"></i></span>`;
function dcColumn(k) {
  if (k.status === 'complete') return S.coll.set.filedCol && k.filed ? 'filed' : 'complete';
  if (!dcActive(k)) return null;
  return dcOverdue(k) ? 'overdue' : k.status;
}
function dcStatusWord(k) { return DC_STATUS[dcOverdue(k) ? 'overdue' : k.status] || k.status; }
function dcStatusPill(k) {
  const s = dcOverdue(k) ? 'overdue' : k.status;
  const cls = s === 'overdue' ? ' bad' : s === 'complete' ? ' ok' : s === 'cancelled' || s === 'archived' ? '' : s === 'in_progress' ? ' warn' : '';
  return `<span class="pill${cls}">${esc(DC_STATUS[s] || s)}${s === 'complete' && k.filed ? ' · Filed on SARS' : ''}</span>`;
}
function dcDue(k) {
  if (k.status === 'complete' || k.status === 'archived') return { text: k.completedAt ? 'Completed ' + fDM(k.completedAt) : 'Complete', red: false };
  if (k.status === 'cancelled') return { text: 'Cancelled', red: false };
  if (!k.due) return { text: 'No due date', red: false };
  const n = daysTo(k.due);
  if (n < 0) return { text: (-n) + 'd overdue', red: true };
  if (n === 0) return { text: 'Due today', red: true };
  return { text: n + 'd left', red: n <= 7 };
}
const dcCadDays = () => { const s = S.coll.set; return s.cadence === 'custom' ? Math.max(1, Math.min(60, +s.custom || 5)) : +s.cadence; };
const dcCadWord = () => { const s = S.coll.set; return s.cadence === 'custom' ? 'every ' + dcCadDays() + ' days' : (DC_CADENCE.find((c) => c[0] === s.cadence) || DC_CADENCE[2])[1].replace(' (recommended)', '').toLowerCase(); };
function dcUnopened(k) {
  if (!dcActive(k)) return false;
  const last = k.opened || k.sent;
  return !!last && now().getTime() - last.getTime() > 36 * 3600e3;
}
function dcNextRem(k) {
  const last = k.lastRem || k.sent; const d = new Date(last.getTime() + dcCadDays() * 864e5);
  return k.due && daysTo(k.due) - daysTo(d) > 3 ? new Date(k.due.getTime() - 3 * 864e5) : d;
}
const dcChasing = (k) => dcActive(k) && S.coll.set.auto && !k.awaitingConfirm;
const dcWaiting = (j) => !!j && (j.state === 'client' || (j.state === 'needs' && !!j.tray && j.tray.code === 'silent'));
function dcTokens(s, c) {
  const n = now(); const m = n.getMonth(); const pm = (m + 11) % 12; const py = m === 0 ? n.getFullYear() - 1 : n.getFullYear();
  const v = { client_name: c ? c.short : 'Client', month: DC_MONTHS[m], year: String(n.getFullYear()), prev_month: DC_MONTHS[pm], prev_year: String(py) };
  return String(s == null ? '' : s).replace(/\{(client_name|month|year|prev_month|prev_year)\}/g, (_, t) => v[t]);
}
const dcIso = (d) => (d ? d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) : '');
function dcParseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d.getTime()) || d.getFullYear() < 2000 || d.getFullYear() > 2100 ? null : d;
}
function dcContact(c, name, num) {
  const nm = name || c.contacts[0].name;
  const local = nm.replace(/^Dr /, '').toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.+|\.+$/g, '') || 'client';
  return { name: nm, email: local + '.demo@example.test', phone: '+27 00 000 ' + String(num).padStart(4, '0') };
}
function dcAct(k, text, by) { k.act.push({ at: now(), text: dcClean(text, 300), by: by || 'Operon' }); }
function dcVerifyAnswer(k) {
  const m = S.coll.set.verify;
  if (m === 'phone') return k.contact.phone.replace(/\D/g, '').slice(-4);
  if (m === 'code') return '123456';
  const c = client(k.c); return (c.reg.split('/')[1] || '').replace(/\D/g, '');
}
function dcPs(token) {
  const ps = S.coll.ps;
  if (!ps[token]) ps[token] = { verified: false, step: 'list' };
  return ps[token];
}

/* ---------- seed ---------- */
function dcSeedTemplates() {
  const it = (sec, name, desc, parked) => ({ id: dcNid('t'), sec, name, desc: desc || '', parked: !!parked });
  return [
    { id: 'company', name: 'Company (Pty) Ltd', secs: DC_SECS.slice(), files: [{ name: 'Document checklist for companies.pdf', size: 182340 }, { name: 'How to download bank statements.pdf', size: 96410 }], items: [
      it('General', 'Signed engagement letter', 'Only for new engagements'),
      it('Banking', 'Bank statements for the period', 'All pages, as a PDF from the bank'),
      it('Banking', 'Credit card statements', 'Business cards only'),
      it('Sales & purchases', 'Sales invoices', 'Or a sales report from your till or system'),
      it('Sales & purchases', 'Supplier tax invoices', 'Needed to claim input VAT'),
      it('Payroll', 'Payroll reports and EMP201 proof of payment'),
      it('Tax', 'SARS letters received this period', 'Notices, audits or verification requests'),
      it('Company/CIPC', 'Changes to directors or shareholders', 'Resolutions and updated registers'),
      it('Stock', 'Stock count sheet', 'Signed by whoever did the count'),
      it('Stock', 'Consignment stock schedule', '', true),
    ] },
    { id: 'individual', name: 'Individual (ITR12)', secs: ['General', 'Tax', 'Banking'], files: [{ name: 'ITR12 checklist.pdf', size: 74120 }], items: [
      it('General', 'Changes to your personal details', 'New address, bank account or marital status'),
      it('Tax', 'IRP5 / IT3(a) from each employer'),
      it('Tax', 'Medical aid tax certificate'),
      it('Tax', 'Retirement annuity certificate'),
      it('Tax', 'IT3(b) interest certificate'),
      it('Banking', 'Rental income and expenses', 'Only if you let property'),
    ] },
    { id: 'newclient', name: 'New client onboarding', secs: ['General', 'Company/CIPC', 'Tax', 'Banking'], files: [{ name: 'Welcome letter.pdf', size: 120500 }, { name: 'FICA requirements.pdf', size: 88200 }], items: [
      it('General', 'ID copy of each director', 'Certified, not older than 3 months'),
      it('General', 'Proof of address', 'A municipal account or lease, not older than 3 months'),
      it('Company/CIPC', 'Registration certificate (CoR14.3)'),
      it('Company/CIPC', 'Memorandum of incorporation'),
      it('Tax', 'SARS registration notice'),
      it('Banking', 'Bank confirmation letter'),
      it('Banking', 'Last trial balance from your previous accountant'),
    ] },
    { id: 'payroll', name: 'Monthly payroll', secs: ['Payroll'], files: [{ name: 'Payroll input template.xlsx', size: 41230 }], items: [
      it('Payroll', 'Timesheets for the month'),
      it('Payroll', 'New starters and leavers', 'Contracts and tax numbers for new starters'),
      it('Payroll', 'Overtime and commission schedule'),
      it('Payroll', 'Leave taken this month'),
    ] },
    { id: 'afs', name: 'Annual financial statements', secs: ['General', 'Banking', 'Sales & purchases', 'Stock', 'Company/CIPC'], files: [{ name: 'Year-end pack instructions.pdf', size: 151870 }], items: [
      it('General', 'Signed management representation letter'),
      it('Banking', 'Bank statements for the full year'),
      it('Banking', 'Loan agreements'),
      it('Sales & purchases', 'Debtors and creditors lists at year-end'),
      it('Stock', 'Stock count at year-end'),
      it('Company/CIPC', 'Minutes of directors’ meetings'),
    ] },
  ];
}
function dcSeedDocTypes() {
  return [
    ['Bank statement', 'Banking', 'Full statement for the period, all pages'], ['Bank confirmation letter', 'Banking', 'Stamped by the bank, not older than 3 months'],
    ['Sales invoices', 'Sales & purchases', 'Or a sales report from the till'], ['Supplier tax invoice', 'Sales & purchases', 'A valid tax invoice for input VAT'],
    ['Timesheets', 'Payroll', 'For hourly staff'], ['EMP201 proof of payment', 'Payroll', 'From eFiling or the bank'],
    ['IRP5 / IT3(a)', 'Tax', 'From each employer'], ['Medical aid tax certificate', 'Tax', ''], ['Retirement annuity certificate', 'Tax', ''],
    ['IT3(b) interest certificate', 'Tax', ''], ['ID copy', 'General', 'Certified, not older than 3 months'], ['Proof of address', 'General', 'Not older than 3 months'],
    ['Share register', 'Company/CIPC', 'Updated after any share transfer'], ['Directors’ resolution', 'Company/CIPC', 'Signed by all directors'], ['Stock count sheet', 'Stock', 'Signed by whoever did the count'],
  ].map(([name, sec, desc]) => ({ id: dcNid('d'), name, sec, desc }));
}
function seedCollections() {
  S.coll = {
    n: 0, cn: 13, list: [], tpls: [], dtypes: [], ps: Object.create(null),
    tab: 'board', tplTab: 'client', tplSel: 'company', q: '', draft: null, upTarget: null, lastRun: null,
    set: { auto: true, cadence: '7', custom: 5, wa: false, confirm: true, filedCol: true, verify: 'reg' },
  };
  S.coll.tpls = dcSeedTemplates();
  S.coll.dtypes = dcSeedDocTypes();
  const up = (name, size, at) => ({ state: 'uploaded', file: { name, size, at } });
  const na = () => ({ state: 'na', file: null });
  const IT = (sec, name, desc, x) => Object.assign({ id: dcNid('i'), sec, name, desc: desc || '', due: null, state: 'missing', file: null }, x || {});
  const K = (id, cn, o) => {
    const c = client('C' + cn);
    const k = Object.assign({ id, token: 'pt' + hash('operon-dc-' + id).slice(0, 18), c: c.id, title: '', titleTpl: '', period: '', due: null, status: 'pending', type: 'company',
      task: null, fed: false, filed: false, sent: null, via: 'Email', opened: null, reminders: 0, lastRem: null, awaitingConfirm: false, rec: null, completedAt: null, items: [], act: [] }, o);
    k.contact = dcContact(c, o.contactName, 100 + cn);
    const a = (at, text, by) => k.act.push({ at, text, by: by || 'Operon' });
    a(k.sent, 'Sent the document request by email to ' + k.contact.email + ' (simulated)');
    const last = k.lastRem || now();
    for (let r = 0; r < k.reminders; r++) a(new Date(k.sent.getTime() + (last.getTime() - k.sent.getTime()) * (r + 1) / k.reminders), 'Reminder ' + (r + 1) + ' sent (Auto, Comms Triage)');
    if (k.opened) a(k.opened, 'Client opened the portal and verified', 'Client');
    for (const it of k.items) if (it.file) a(it.file.at, 'Client uploaded “' + it.file.name + '” for ' + it.name, 'Client');
    for (const it of k.items) if (it.state === 'na') a(k.opened || k.sent, 'Client marked ' + it.name + ' as not applicable', 'Client');
    if (k.completedAt) a(k.completedAt, k.status === 'archived' ? 'Marked complete, then archived' : 'Marked complete');
    if (k.status === 'cancelled') a(day(-2, 11, 15), 'Cancelled by ' + pname('M2'));
    k.act.sort((x, y) => x.at - y.at);
    S.coll.list.push(k);
    return k;
  };
  K('DC01', 17, { task: 'J14', title: 'Bank statements Aug–Sep 2026', period: 'August–September 2026', due: day(-6), sent: day(-22, 9, 0), reminders: 4, lastRem: day(-7, 9, 0),
    items: [IT('Banking', 'Bank statement August 2026', 'All pages, as a PDF from the bank'), IT('Banking', 'Bank statement September 2026', 'All pages, as a PDF from the bank')] });
  K('DC02', 16, { task: 'J15', title: 'September bookkeeping documents', period: 'September 2026', due: day(2), sent: day(-8, 9, 0), opened: day(0, 7, 5), reminders: 2, lastRem: day(-2, 9, 0), status: 'in_progress',
    items: [IT('Banking', 'Bank statement August 2026', 'Still outstanding from last month', { due: day(2) }), IT('Banking', 'Bank statement September 2026', '', up('FNB-Sep-2026-statement.pdf', 421880, day(0, 7, 12))), IT('Sales & purchases', 'Sales summary September 2026', '', up('Sales-summary-Sep-2026.xlsx', 58210, day(-1, 15, 30)))] });
  K('DC03', 12, { task: 'J16', title: 'BO declaration: shareholder documents', period: 'Share transfer 6 Oct 2026', due: day(4), sent: day(-3, 9, 0), opened: day(-1, 18, 20), reminders: 1, lastRem: day(0, 9, 0), status: 'in_progress',
    items: [IT('Company/CIPC', 'ID copy: T. Govender (new shareholder)', 'Certified, not older than 3 months', { due: day(1) }), IT('Company/CIPC', 'Updated share register', '', up('Share-register-Oct-2026.pdf', 96400, day(-1, 18, 25))), IT('Company/CIPC', 'Signed BO mandate', '', up('BO-mandate-signed.pdf', 133020, day(-1, 18, 27)))] });
  K('DC04', 14, { task: 'J17', title: 'Supplier tax invoices for VAT201', period: 'August–September 2026', due: day(3), sent: day(-5, 9, 0), opened: day(-1, 12, 10), reminders: 1, lastRem: day(0, 9, 0),
    items: [IT('Sales & purchases', 'Tax invoice: Lumen Print Supplies (Demo), 12 Aug', 'R 2,480.00 of VAT'), IT('Sales & purchases', 'Tax invoice: Kraal Studio Hire (Demo), 2 Sep', 'R 1,920.00 of VAT'), IT('Sales & purchases', 'Tax invoice: Bright Spark Electrical (Demo), 19 Sep', 'R 1,740.00 of VAT')] });
  K('DC05', 19, { task: 'J18', title: 'September stock count', period: 'Month ended 30 September 2026', due: day(3), sent: day(-4, 9, 0), opened: day(-3, 10, 0), reminders: 1, lastRem: day(-1, 9, 0),
    items: [IT('Stock', 'Stock count sheet 30 Sep 2026', 'Signed by whoever did the count'), IT('Stock', 'Stock valuation summary')] });
  K('DC06', 18, { task: 'J19', title: 'New registered address', period: '', due: day(8), sent: day(-2, 9, 0), opened: day(0, 8, 40),
    items: [IT('Company/CIPC', 'Proof of the new registered address', 'A municipal account or lease, not older than 3 months'), IT('Company/CIPC', 'Signed directors’ resolution', 'Approving the change of address')] });
  K('DC07', 20, { task: 'J20', type: 'newclient', title: 'New client documents and income estimate', period: 'Onboarding', due: day(2), sent: day(-2, 9, 0), opened: day(0, 8, 50), reminders: 1, lastRem: day(-1, 9, 0), status: 'in_progress',
    items: [IT('General', 'ID copy of the director', 'Certified, not older than 3 months', up('ID-copy-director.pdf', 220310, day(0, 8, 55))), IT('General', 'Proof of address', 'Not older than 3 months'), IT('Tax', 'Signed income estimate confirmation (IRP6)', 'Confirms the R 640,000.00 estimate', { due: day(1) }), IT('Banking', 'Bank confirmation letter')] });
  K('DC08', 1, { type: 'individual', contactName: 'Kagiso Mokoena', title: 'ITR12 2026: Kagiso Mokoena (director)', period: 'Tax year 2026', due: day(-10), sent: day(-30, 9, 0), opened: day(-25, 19, 0), status: 'complete', filed: true, completedAt: day(-9, 11, 0),
    items: [IT('Tax', 'IRP5 / IT3(a) from each employer', '', up('IRP5-2026-K-Mokoena.pdf', 64200, day(-25, 19, 5))), IT('Tax', 'Medical aid tax certificate', '', up('Medical-aid-certificate-2026.pdf', 51300, day(-25, 19, 8))), IT('Tax', 'Retirement annuity certificate', '', na()), IT('Tax', 'IT3(b) interest certificate', '', up('IT3b-2026.pdf', 33900, day(-24, 8, 30)))] });
  K('DC09', 1, { type: 'individual', contactName: 'Naledi Mokoena', title: 'ITR12 2026: Naledi Mokoena (director)', period: 'Tax year 2026', due: day(6), sent: day(-6, 9, 0), opened: day(-1, 20, 5), reminders: 0, status: 'in_progress', awaitingConfirm: true,
    items: [IT('Tax', 'IRP5 / IT3(a) from each employer', '', up('IRP5-2026-N-Mokoena.pdf', 61880, day(-1, 20, 10))), IT('Tax', 'Medical aid tax certificate', '', up('Medical-aid-2026-N.pdf', 49020, day(-1, 20, 12))), IT('Tax', 'Retirement annuity certificate', '', na()), IT('Tax', 'IT3(b) interest certificate', '', up('IT3b-2026-N.pdf', 31010, day(0, 6, 40)))] });
  K('DC10', 6, { type: 'afs', title: 'AFS pack FY2026', period: 'Year ended 30 June 2026', due: day(-4), sent: day(-35, 9, 0), opened: day(-33, 10, 0), status: 'complete', completedAt: day(-3, 14, 0),
    items: [IT('General', 'Signed management representation letter', '', up('Management-rep-letter-signed.pdf', 88100, day(-5, 16, 0))), IT('Banking', 'Bank statements for the full year', '', up('Bank-statements-FY2026.zip', 4210400, day(-20, 9, 30))), IT('Banking', 'Loan agreements', '', up('Loan-agreement-vehicle.pdf', 301200, day(-20, 9, 40))), IT('Sales & purchases', 'Debtors and creditors lists at year-end', '', up('Age-analysis-30-Jun-2026.xlsx', 77300, day(-12, 11, 0))), IT('Stock', 'Stock count at year-end', '', up('Stock-count-30-Jun-2026.pdf', 154000, day(-12, 11, 5))), IT('Company/CIPC', 'Minutes of directors’ meetings', '', na())] });
  K('DC11', 3, { type: 'payroll', title: 'Payroll inputs October 2026', titleTpl: 'Payroll inputs {month} {year}', rec: 'monthly', period: 'October 2026', due: day(11), sent: day(-1, 9, 0),
    items: [IT('Payroll', 'Timesheets for the month'), IT('Payroll', 'New starters and leavers'), IT('Payroll', 'Overtime and commission schedule')] });
  K('DC12', 13, { title: 'Fixed asset register update', period: 'September 2026', due: day(5), sent: day(-6, 9, 0), status: 'cancelled',
    items: [IT('General', 'Fixed asset additions and disposals'), IT('General', 'Supplier invoices for new assets')] });
  K('DC13', 10, { title: 'IRP6 August 2026 supporting documents', period: 'First period 2027', due: day(-48), sent: day(-60, 9, 0), opened: day(-58, 9, 0), status: 'archived', completedAt: day(-50, 10, 0),
    items: [IT('Tax', 'Management accounts to July 2026', '', up('Mgmt-accounts-Jul-2026.pdf', 240100, day(-55, 12, 0))), IT('Tax', 'Estimate of taxable income', '', up('IRP6-estimate.xlsx', 22100, day(-55, 12, 5)))] });
}

/* ---------- state changes ---------- */
function dcAudit(k, o) {
  return addAudit(Object.assign({ c: k.c, task: k.task && task(k.task) ? k.task : null, evidence: 'Document collection ' + k.id }, o));
}
function dcAdvanceTask(k) {
  if (!k.task || k.fed) return;
  const j = task(k.task); if (!j) return;
  if (!dcWaiting(j)) { dcAct(k, 'Task ' + j.id + ' is not waiting on the client, so it was left as it is'); return; }
  k.fed = true;
  const from = stateWord(j)[1]; const c = client(j.c); const p = dcProg(k);
  j.state = 'ai'; j.stage = Math.max(1, j.stage); j.wait = null;
  j.text = 'The documents came back through Document collections (“' + k.title + '”). The AI picked the task up again.';
  j.next = 'Works with the new documents, then the Supervisor checks';
  jobLog(j, 'Documents back from the client: “' + k.title + '” is complete. Moved from ' + from + ' to AI at work', { tier: 'auto', who: roleOf(j) });
  addAudit({ kind: 'agent', who: roleOf(j), text: 'Moved ' + j.title + ' for ' + c.short + ' from ' + from + ' to AI at work: the document collection is complete', c: j.c, task: j.id, tier: 'auto', rule: 'R02', result: 'Done', evidence: 'Document collection ' + k.id + ': ' + p.d + ' of ' + p.n + ' items in', verdict: 'Invariants passed' });
  dcAct(k, 'Task ' + j.id + ' moved from ' + from + ' to AI at work');
  toast('Task ' + j.id + ' moved to AI at work. The documents are in.');
}
function dcComplete(k, byClient) {
  if (k.status === 'complete') return;
  const p = dcProg(k);
  k.status = 'complete'; k.completedAt = now(); k.awaitingConfirm = false;
  if (byClient) {
    dcAct(k, 'Client submitted all documents. Collection complete', 'Client');
    dcAudit(k, { kind: 'system', who: 'Client portal', text: k.contact.name + ' submitted all documents for “' + k.title + '” (' + client(k.c).short + ')', result: 'Done', evidence: 'Client portal: ' + p.d + ' of ' + p.n + ' items' });
  } else {
    dcAct(k, 'Marked complete by ' + me().name, me().name);
    dcAudit(k, { text: 'Marked the document collection “' + k.title + '” complete for ' + client(k.c).short, result: 'Done', evidence: 'Document collection ' + k.id + ': ' + p.d + ' of ' + p.n + ' items in' });
  }
  dcAdvanceTask(k);
}
function dcRemindOne(k, why) {
  const c = client(k.c);
  k.reminders += 1; k.lastRem = now();
  const via = S.coll.set.wa ? 'email and WhatsApp' : 'email';
  dcAct(k, 'Reminder ' + k.reminders + ' sent by ' + via + ' (Auto, Comms Triage)');
  dcAudit(k, { kind: 'agent', who: 'Comms Triage', text: 'Sent reminder ' + k.reminders + ' to ' + k.contact.email + ' for “' + k.title + '” (' + c.short + ')', tier: 'auto', rule: 'R03', result: 'Sent', evidence: why || ('Reminder cadence: ' + dcCadWord()), verdict: 'Invariants passed' });
  const j = k.task ? task(k.task) : null;
  if (j && j.state !== 'done') { jobLog(j, 'Document reminder ' + k.reminders + ' sent for “' + k.title + '”', { tier: 'auto', who: 'Comms Triage' }); if (j.wait) j.wait.rem = (j.wait.rem || 0) + 1; }
}
function dcRunReminders() {
  const sent = [], skipped = [];
  for (const k of S.coll.list) {
    if (!dcActive(k)) continue;
    if (!S.coll.set.auto) { skipped.push({ id: k.id, why: 'Automatic reminders are off' }); continue; }
    if (k.awaitingConfirm) { skipped.push({ id: k.id, why: 'Awaiting the client’s confirmation' }); continue; }
    const n = k.due ? daysTo(k.due) : null;
    if (n != null && n > 3) { skipped.push({ id: k.id, why: 'Due in ' + n + ' days' }); continue; }
    const next = dcNextRem(k);
    if (daysTo(next) > 0) { skipped.push({ id: k.id, why: (k.lastRem ? 'Reminded ' + fDM(k.lastRem) : 'Sent ' + fDM(k.sent)) + '; next ' + fDM(next) + ', ' + dcCadWord() }); continue; }
    dcRemindOne(k, 'Today’s reminder run: ' + (n == null ? 'no due date' : n < 0 ? 'overdue' : 'due within 3 days') + ', ' + dcCadWord());
    sent.push(k.id);
  }
  addAudit({ kind: 'agent', who: 'Comms Triage', text: 'Ran today’s document reminders: ' + sent.length + ' sent, ' + skipped.length + ' skipped', tier: 'auto', rule: 'R03', result: 'Done', evidence: 'Document collections reminder run (' + dcCadWord() + ')', verdict: 'Invariants passed' });
  S.coll.lastRun = { at: now(), sent, skipped };
  toast(S.coll.set.auto ? 'Reminders run: ' + sent.length + ' sent, ' + skipped.length + ' skipped. All logged in the audit trail.' : 'Automatic reminders are off, so nothing was sent.');
}
function dcSendEmail(k, again) {
  const c = client(k.c);
  dcAct(k, (again ? 'Portal link sent again' : 'Sent the document request') + ' by email to ' + k.contact.email + ' (simulated)');
  dcAudit(k, { kind: 'agent', who: 'Comms Triage', text: (again ? 'Resent the portal link for “' : 'Sent the document request “') + k.title + '” to ' + k.contact.email + ' (' + c.short + ')', tier: 'auto', rule: 'R04', result: 'Sent', verdict: 'Invariants passed' });
  toast((again ? 'Portal link resent' : 'Request sent') + ' to ' + k.contact.email + ' (simulated: nothing left this browser).');
}
function dcMake(o) {
  const c = client(o.c);
  const k = Object.assign({ id: 'DC' + (++S.coll.cn), token: 'pt' + dcRand(18), status: 'pending', fed: false, filed: false, sent: now(), via: 'Email', opened: null, reminders: 0, lastRem: null, awaitingConfirm: false, completedAt: null, act: [] }, o);
  k.contact = dcContact(c, null, 100 + (+c.id.slice(1)));
  k.items = (o.items || []).map((it) => ({ id: dcNid('i'), sec: it.sec, name: it.name, desc: it.desc || '', due: it.due || null, state: 'missing', file: null }));
  S.coll.list.push(k);
  dcAct(k, 'Created by ' + me().name, me().name);
  dcAudit(k, { text: 'Created the document collection “' + k.title + '” for ' + c.short, result: 'Done' });
  return k;
}
function dcAskConfirm(k) {
  dcPs(k.token).step = 'confirm';
  if (k.awaitingConfirm) return;
  k.awaitingConfirm = true;
  dcAct(k, 'Client was asked “Is that everything?”', 'Client portal');
  dcAudit(k, { kind: 'system', who: 'Client portal', text: 'Asked ' + k.contact.name + ' to confirm “' + k.title + '” is everything (' + client(k.c).short + ')', result: 'Done' });
}
function dcMaybeProgress(k) {
  if (k.status === 'pending') {
    k.status = 'in_progress'; dcAct(k, 'Moved to In progress');
    dcAudit(k, { kind: 'system', who: 'Client portal', text: 'Moved “' + k.title + '” (' + client(k.c).short + ') to In progress: the first document is in', result: 'Done' });
  }
  if (!k.items.length || !k.items.every(dcIsDone)) return;
  if (S.coll.set.confirm) dcAskConfirm(k);
  else { dcComplete(k, true); dcPs(k.token).step = 'done'; }
}
function dcAttach(target, f) {
  const name = dcClean(f.name, 180) || 'file'; const size = Math.max(0, Number(f.size) || 0);
  if (size > DC_MAX_FILE) { toast('That file is over 50 MB. Send a smaller file.'); return; }
  if (target.kind === 'tpl') {
    const t = dcTpl(target.tpl); if (!t) return;
    t.files.push({ name, size });
    addAudit({ text: 'Added the template file “' + name + '” to ' + t.name, result: 'Done', evidence: 'Document collections templates' });
    toast('Added ' + name + ' (' + dcSize(size) + '). Only its name and size are kept.'); render(); return;
  }
  const k = dcByToken(target.token); const it = k && k.items.find((x) => x.id === target.item);
  if (!k || !it || !dcActive(k)) { toast('This request is closed. Nothing was uploaded.'); return; }
  it.state = 'uploaded'; it.file = { name, size, at: now() };
  dcAct(k, 'Client uploaded “' + name + '” (' + dcSize(size) + ') for ' + it.name, 'Client');
  dcAudit(k, { kind: 'system', who: 'Client portal', text: k.contact.name + ' uploaded “' + name + '” for ' + it.name + ' (' + client(k.c).short + ')', result: 'Done', evidence: 'Client portal upload, ' + dcSize(size) + ' (simulated: the file was not read or sent)' });
  dcMaybeProgress(k);
  toast('Uploaded ' + name + '.');
  render();
}

/* ---------- uploads: one hidden file input outside #app, so a timer render can't destroy it mid-dialog ---------- */
function dcFileInput() {
  let el = document.getElementById('dc-file');
  if (!el) {
    el = document.createElement('input');
    el.type = 'file'; el.id = 'dc-file'; el.hidden = true; el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    el.addEventListener('change', () => {
      const f = el.files && el.files[0]; const target = S.coll ? S.coll.upTarget : null;
      if (S.coll) S.coll.upTarget = null;
      if (f && target) dcAttach(target, { name: f.name, size: f.size });
      el.value = '';
    });
    document.body.appendChild(el);
  }
  return el;
}
function dcPick(target) { S.coll.upTarget = target; const el = dcFileInput(); el.value = ''; el.click(); }
const dcHasFiles = (e) => { try { return !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'); } catch (x) { return false; } };
const dcOnPortal = () => { try { return routeOf().name === 'portal'; } catch (x) { return false; } };
document.addEventListener('dragover', (e) => {
  if (!dcHasFiles(e) || !dcOnPortal()) return;
  e.preventDefault();
  const row = e.target.closest && e.target.closest('[data-dc-drop]');
  $$('.dc-over').forEach((x) => { if (x !== row) x.classList.remove('dc-over'); });
  if (row) { row.classList.add('dc-over'); e.dataTransfer.dropEffect = 'copy'; } else e.dataTransfer.dropEffect = 'none';
});
document.addEventListener('dragleave', (e) => { const row = e.target.closest && e.target.closest('[data-dc-drop]'); if (row && !row.contains(e.relatedTarget)) row.classList.remove('dc-over'); });
document.addEventListener('drop', (e) => {
  if (!dcHasFiles(e) || !dcOnPortal()) return;
  e.preventDefault();
  $$('.dc-over').forEach((x) => x.classList.remove('dc-over'));
  const row = e.target.closest && e.target.closest('[data-dc-drop]');
  if (!row) { toast('Drop the file on the document it belongs to.'); return; }
  const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
  dcAttach({ token: row.dataset.token, item: row.dataset.dcDrop }, { name: f.name, size: f.size });
});

/* ---------- shared pieces ---------- */
function dcCard(k) {
  const c = client(k.c); const p = dcProg(k); const due = dcDue(k);
  return `<a class="jobcard dc-card" href="${dcHref(k.id)}">
    <span class="jc-client">${esc(c.short)}</span>
    <div class="jc-title">${esc(k.title)}</div>
    <div class="jc-meta"><span class="pill">${esc(dcTypeName(k.type))}</span>${k.period ? `<span>${esc(k.period)}</span>` : ''}</div>
    <div class="dc-prog">${dcBar(p)}<span class="small mono">${p.d}/${p.n} docs · ${p.pct}%</span></div>
    <div class="jc-meta"><span class="dc-due${due.red ? ' bad' : ''}">${esc(due.text)}</span>${dcUnopened(k) ? '<span class="dc-bang" title="Not opened by the client in 36 hours" aria-hidden="true">!</span><span class="sr">Not opened by the client in 36 hours</span>' : ''}${k.awaitingConfirm && dcActive(k) ? '<span class="pill warn">Awaiting client confirmation</span>' : ''}</div>
    ${k.task || dcChasing(k) || k.rec ? `<div class="jc-meta">${k.task ? `<span class="wait">Feeds task <b>${esc(k.task)}</b></span>` : ''}${dcChasing(k) ? `<span class="dc-chase">AI chasing ${tierBadge('auto')}</span>` : ''}${k.rec ? `<span class="pill">Repeats ${esc(k.rec)}</span>` : ''}</div>` : ''}
  </a>`;
}
function dcRecent() {
  const out = [];
  for (const k of S.coll.list) if (k.status !== 'cancelled') for (const it of k.items) if (it.file && it.file.at) out.push({ k, it, at: it.file.at });
  return out.sort((a, b) => b.at - a.at);
}
function dcMiniRow(r) {
  return `<li><a class="dc-minirow" href="${dcHref(r.k.id)}"><span class="dc-mt">${esc(r.it.file.name)}</span><span class="small muted">${esc(r.it.name)} · ${esc(client(r.k.c).short)} · ${esc(fWhen(r.at))}</span></a></li>`;
}

/* ---------- board, templates and settings ---------- */
function viewCollections() {
  const D = S.coll; const tab = ['board', 'templates', 'settings'].includes(D.tab) ? D.tab : 'board';
  const tabs = [['board', 'Board'], ['templates', 'Templates'], ['settings', 'Reminders & settings']];
  const body = tab === 'templates' ? dcViewTemplates() : tab === 'settings' ? dcViewSettings() : dcViewBoard();
  return `<div class="stack dc">
    <div class="pagehead" data-rv-key="coll-head"><div class="stack" style="gap:6px"><h1>Document collections</h1><p class="muted">Send a client a checklist. They upload through a simple portal, Operon chases them, and the task moves on by itself when everything is in.</p></div>
      <div class="row">${btn('+ New collection', 'dcNew', { cls: 'primary' })}</div></div>
    <div class="seg dc-tabs" role="group" aria-label="Document collections sections" data-rv-key="coll-tabs">${tabs.map(([k, l]) => `<button type="button" data-act="dcTab" data-v="${k}" aria-pressed="${tab === k}">${l}</button>`).join('')}</div>
    ${body}
  </div>`;
}
function dcViewBoard() {
  const D = S.coll; const q = D.q.trim().toLowerCase();
  const live = D.list.filter((k) => k.status !== 'cancelled' && k.status !== 'archived');
  const shown = live.filter((k) => !q || k.title.toLowerCase().includes(q) || client(k.c).name.toLowerCase().includes(q));
  const docs = D.list.reduce((a, k) => a + k.items.filter((i) => i.state === 'uploaded').length, 0);
  const stat = (key, n, label, sub) => `<div class="card dc-stat" data-rv-key="coll-stat-${key}"><span class="dc-num">${n}</span><span class="dc-lbl">${label}</span><span class="small muted">${sub}</span></div>`;
  const cols = DC_COLS.filter(([k]) => k !== 'filed' || D.set.filedCol);
  const byDue = (a, b) => (a.due ? a.due.getTime() : 9e15) - (b.due ? b.due.getTime() : 9e15);
  const recent = dcRecent().slice(0, 6);
  const closed = D.list.filter((k) => k.status === 'cancelled' || k.status === 'archived');
  return `<section class="dc-stats" aria-label="Collection numbers" data-rv-key="coll-stats" data-rv-zone="coll-stats">
      ${stat('clients', new Set(live.map((k) => k.c)).size, 'Total clients', 'with a collection on the board')}
      ${stat('active', live.filter(dcActive).length, 'Active collections', live.filter(dcOverdue).length + ' overdue')}
      ${stat('complete', live.filter((k) => k.status === 'complete').length, 'Complete', live.filter((k) => k.status === 'complete' && k.filed).length + ' filed on SARS')}
      ${stat('docs', docs, 'Documents collected', 'across all collections')}
    </section>
    <div class="dc-actions" data-rv-key="coll-actions">
      ${btn('Bulk send', 'dcBulk')}${btn('Templates', 'dcTab', { data: { v: 'templates' } })}${btn('Reminders & settings', 'dcTab', { data: { v: 'settings' } })}
      <label class="f dc-search" for="dc-q">Search<input id="dc-q" class="search" type="search" data-on="dcQ" value="${esc(D.q)}" placeholder="Client or collection"></label>
    </div>
    <section class="stack boardsec" style="gap:10px" aria-label="Collections board" data-rv-key="coll-board">
      <div class="row between"><h2>Collections board</h2><p class="small muted">Overdue is worked out from the due date. Cards move by themselves as clients upload.</p></div>
      ${q && !shown.length ? `<div class="card dc-empty"><p>No collections match “${esc(D.q.trim())}”.</p>${btn('Clear search', 'dcQClear', { cls: 'sm' })}</div>` : `<div class="board dc-board${cols.length === 5 ? ' dc-cols5' : ''}">${cols.map(([key, label, sub]) => {
        const ks = shown.filter((k) => dcColumn(k) === key || (key === 'complete' && !D.set.filedCol && dcColumn(k) === 'filed')).sort(byDue);
        return `<section class="col" aria-label="${esc(label)}" data-rv-key="coll-col-${key}"><header><h3>${esc(label)}</h3><p>${esc(sub)} · ${ks.length}</p></header>${ks.map(dcCard).join('') || '<p class="empty-col">Nothing here.</p>'}</section>`;
      }).join('')}</div>`}
    </section>
    <section class="card" data-rv-key="coll-recent"><h2>Just came back</h2><p class="small muted">The latest uploads from clients, newest first.</p>
      ${recent.length ? `<ul class="plain dc-mini">${recent.map(dcMiniRow).join('')}</ul>` : '<p class="muted">Nothing has come back yet.</p>'}</section>
    ${closed.length ? `<section class="card" data-rv-key="coll-closed"><h2>Cancelled and archived</h2><ul class="plain dc-mini">${closed.map((k) => `<li><a class="dc-minirow" href="${dcHref(k.id)}"><span class="dc-mt">${esc(k.title)}</span><span class="small muted">${esc(client(k.c).short)} · ${esc(DC_STATUS[k.status])}</span></a></li>`).join('')}</ul></section>` : ''}`;
}
function dcViewTemplates() {
  const D = S.coll;
  const sub = `<div class="seg" role="group" aria-label="Template kind" data-rv-key="coll-tpl-tabs">${[['client', 'Client types'], ['doc', 'Document types']].map(([k, l]) => `<button type="button" data-act="dcTplTab" data-v="${k}" aria-pressed="${D.tplTab === k}">${l}</button>`).join('')}</div>`;
  if (D.tplTab === 'doc') {
    const used = (dt) => {  // the whole name (or its plural), not inside another word
      const re = new RegExp('(?<![a-z0-9])' + dt.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?(?![a-z0-9])');
      return D.tpls.filter((t) => t.items.some((i) => re.test(i.name.toLowerCase()))).length;
    };
    return `${sub}<section class="card stack" style="gap:10px" data-rv-key="coll-doctypes"><h2>Document types</h2><p class="small muted">The documents you ask for most, with the wording clients see. Client-type checklists draw on these.</p>
      <div class="tablewrap"><table><thead><tr><th>Document</th><th>Section</th><th>What the client sees</th><th class="r">Used in</th></tr></thead><tbody>${D.dtypes.map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.sec)}</td><td class="small">${esc(d.desc || '–')}</td><td class="r num">${used(d)}</td></tr>`).join('')}</tbody></table></div>
      <form data-form="dcDtAdd" class="dc-addform" novalidate><label class="f" for="dc-dt-sec">Section<select id="dc-dt-sec" name="sec">${DC_SECS.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>
        <label class="f" for="dc-dt-name">Document<input id="dc-dt-name" name="name" maxlength="120" placeholder="e.g. Fuel card statement"></label>
        <label class="f" for="dc-dt-desc">What the client sees (optional)<input id="dc-dt-desc" name="desc" maxlength="200"></label>
        <button class="btn primary" type="submit">+ Add document type</button></form>
      <p class="err" id="dc-dt-err" role="alert"></p></section>`;
  }
  const t = dcTpl(D.tplSel) || D.tpls[0];
  const secs = t.secs.map((s, i) => {
    const its = t.items.filter((x) => x.sec === s);
    return `<div class="dc-group"><div class="row between"><p class="eyebrow">${esc(s)}</p>${btn('Rename section', 'dcSecRen', { cls: 'sm ghost', data: { i } })}</div>
      ${its.length ? `<ul class="plain dc-titems">${its.map((x) => `<li class="dc-titem${x.parked ? ' dc-parked' : ''}"><span class="stack" style="gap:2px"><span class="dc-tn">${esc(x.name)}${x.parked ? ' <span class="pill">Parked</span>' : ''}</span>${x.desc ? `<span class="small muted">${esc(x.desc)}</span>` : ''}</span>
        <span class="actions">${btn('Edit', 'dcTiEdit', { cls: 'sm', data: { id: x.id } })}${btn(x.parked ? 'Unpark' : 'Park', 'dcTiPark', { cls: 'sm', data: { id: x.id } })}${t.secs.length > 1 ? btn('Copy to…', 'dcTiCopy', { cls: 'sm', data: { id: x.id } }) : ''}</span></li>`).join('')}</ul>` : '<p class="small muted">No items in this section yet.</p>'}</div>`;
  }).join('');
  return `${sub}<div class="dc-tplgrid" data-rv-zone="coll-tpl" data-rv-key="coll-tpl-area">
    <section class="card stack" style="gap:8px" data-rv-key="coll-tpl-types"><h2>Client types</h2><p class="small muted">Each client type has a master checklist. A new collection starts from it.</p>
      <ul class="plain dc-tlist">${D.tpls.map((x) => `<li><button type="button" class="ti" data-act="dcTplSel" data-id="${esc(x.id)}" aria-current="${x.id === t.id}"><span class="t1">${esc(x.name)}</span><span class="t2"><span>${dcPl(x.items.filter((i) => !i.parked).length, 'document')}</span><span>${dcPl(x.secs.length, 'section')}</span></span></button></li>`).join('')}</ul></section>
    <section class="card stack" style="gap:10px" data-rv-key="coll-tpl-checklist"><div class="row between"><h2>Master checklist</h2>${btn('+ Add section', 'dcSecAdd', { cls: 'sm' })}</div>
      <p class="small muted">Client type: <strong>${esc(t.name)}</strong>. Parked items stay in the template but are left out of new collections.</p>
      ${secs}
      <form data-form="dcTplAdd" class="dc-addform" novalidate><label class="f" for="dc-ta-sec">Section<select id="dc-ta-sec" name="sec">${t.secs.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>
        <label class="f" for="dc-ta-name">Document<input id="dc-ta-name" name="name" maxlength="120" placeholder="e.g. Vehicle logbook"></label>
        <label class="f" for="dc-ta-desc">Description (optional)<input id="dc-ta-desc" name="desc" maxlength="200"></label>
        <button class="btn primary" type="submit">+ Add item</button></form>
      <p class="err" id="dc-ta-err" role="alert"></p></section>
    <section class="card stack dc-files" style="gap:8px" data-rv-key="coll-tpl-files"><div class="row between"><h2>Template files</h2>${btn('+ Add a file', 'dcTplFile', { cls: 'sm' })}</div><p class="small muted">Files clients see next to this checklist, such as a request letter. Only the name and size are kept in the preview.</p>
      ${t.files.length ? `<ul class="plain dc-mini">${t.files.map((f, i) => `<li class="row between dc-frow"><span class="dc-file">${esc(f.name)} <span class="muted">· ${esc(dcSize(f.size))}</span></span>${btn('Download', 'dcFileDl', { cls: 'sm', data: { i } })}</li>`).join('')}</ul>` : '<p class="muted">No files yet.</p>'}</section>
  </div>`;
}
function dcViewSettings() {
  const st = S.coll.set; const run = S.coll.lastRun;
  const chk = (k, label, sub) => `<label class="dc-check" for="dc-s-${k}"><input type="checkbox" id="dc-s-${k}" data-on="dcSet" data-k="${k}"${st[k] ? ' checked' : ''}><span>${label}${sub ? `<br><span class="hint">${sub}</span>` : ''}</span></label>`;
  const name = (id) => { const k = dcGet(id); return k ? client(k.c).short + ': ' + k.title : id; };
  return `<div class="dc-setgrid" data-rv-zone="coll-settings" data-rv-key="coll-settings-area">
    <section class="card stack" style="gap:12px" data-rv-key="coll-rem-auto"><h2>Automatic reminders</h2>
      ${chk('auto', 'Send reminders automatically', 'Reminders are Auto tier: Comms Triage sends them and logs each one.')}
      <div class="stack" style="gap:6px"><p class="small muted">How often</p><div class="seg" role="group" aria-label="Reminder cadence">${DC_CADENCE.map(([v, l]) => `<button type="button" data-act="dcCad" data-v="${v}" aria-pressed="${st.cadence === v}">${l}</button>`).join('')}</div></div>
      ${st.cadence === 'custom' ? `<label class="f dc-narrow" for="dc-s-custom">Every how many days<input id="dc-s-custom" type="number" min="1" max="60" inputmode="numeric" data-on="dcSet" data-k="custom" value="${esc(st.custom)}"></label>` : ''}
      <p class="small">Every morning at about 9:00, Operon reminds each client who still owes documents, <span id="dc-s-cadword">${esc(dcCadWord())}</span>. Clients who have uploaded everything and only need to confirm are left alone.</p>
      ${chk('wa', 'Also remind by WhatsApp', 'Only clients who opted in. Simulated in the preview: nothing is sent.')}
    </section>
    <section class="card stack" style="gap:12px" data-rv-key="coll-rem-run"><h2>Today’s reminders</h2>
      <p class="small muted">Reminds collections that are pending or in progress and are overdue, due within 3 days, or have no due date, once the cadence has passed since the last reminder. Skips any waiting for the client’s confirmation, and sends nothing while automatic reminders are off. Everything is logged.</p>
      <div>${btn('Run today’s reminders now (demo)', 'dcRun', { cls: 'primary' })}</div>
      ${run ? `<div class="well stack" style="gap:6px"><p><strong>Last run at ${esc(fTime(run.at))}</strong>: ${run.sent.length} sent, ${run.skipped.length} skipped.</p>
        ${run.sent.length ? `<ul class="plain small">${run.sent.map((id) => `<li>Sent: ${esc(name(id))}</li>`).join('')}</ul>` : ''}
        ${run.skipped.length ? `<ul class="plain small muted">${run.skipped.map((x) => `<li>Skipped: ${esc(name(x.id))} (${esc(x.why)})</li>`).join('')}</ul>` : ''}</div>` : ''}
    </section>
    <section class="card stack" style="gap:12px" data-rv-key="coll-settings"><h2>Further settings</h2>
      ${chk('confirm', 'Ask “Is that everything?” before completing', 'The client confirms before the collection moves to Complete.')}
      ${chk('filedCol', 'Show a Filed on SARS column on the board', 'For returns that have been filed on eFiling.')}
      <label class="f dc-narrow" for="dc-s-verify">How clients verify in the portal<select id="dc-s-verify" data-on="dcSet" data-k="verify">${Object.entries(DC_VERIFY).map(([k, v]) => `<option value="${k}"${st.verify === k ? ' selected' : ''}>${esc(v[0])}</option>`).join('')}</select></label>
    </section>
  </div>`;
}

/* ---------- one collection ---------- */
function viewCollection(id) {
  if (id === 'new') return dcViewNew();
  const k = dcGet(id);
  if (!k) return `<div class="stack dc"><nav class="crumbs" aria-label="Breadcrumb" data-rv-key="coll-detail-crumbs"><a href="#collections">Document collections</a></nav>
    <h1>Collection not found</h1><p class="muted">There is no collection with that link in this demo. It may have been made before the demo data was reset.</p><p><a class="btn" href="#collections">Back to Document collections</a></p></div>`;
  const c = client(k.c); const p = dcProg(k); const due = dcDue(k); const j = k.task ? task(k.task) : null;
  const secs = []; for (const it of k.items) if (!secs.includes(it.sec)) secs.push(it.sec);
  const itemRow = (it) => {
    let st;
    if (it.state === 'uploaded') st = `<span class="pill ok">${I.check} Uploaded</span><span class="dc-file">${esc(it.file.name)} · ${esc(dcSize(it.file.size))} · ${esc(fWhen(it.file.at))}</span>${btn('Download', 'dcDl', { cls: 'sm', data: { id: k.id, item: it.id } })}`;
    else if (it.state === 'na') st = '<span class="pill">Not applicable</span>';
    else st = '<span class="pill bad">Missing</span>';
    return `<li class="dc-item"><span class="stack" style="gap:2px"><strong>${esc(it.name)}</strong>${it.desc ? `<span class="small muted">${esc(it.desc)}</span>` : ''}</span>
      <span class="dc-istate">${st}${it.due && it.state === 'missing' ? `<span class="pill warn">Due ${esc(fDM(it.due))}</span>` : ''}</span></li>`;
  };
  const A = (l, a, o) => btn(l, a, Object.assign({ cls: 'sm' }, o, { data: Object.assign({ id: k.id }, (o && o.data) || {}) }));
  let acts = '';
  if (dcActive(k)) acts = A('Preview portal', 'dcPreview', { cls: 'sm primary' }) + A('Copy portal link', 'dcCopy') + A('Resend portal link', 'dcResend') + A('Send via WhatsApp', 'dcWa') + A('Send a reminder now', 'dcRemind') + A('Mark complete', 'dcDone') + A('Download all (.zip)', 'dcZip') + A('Cancel', 'dcCancel', { cls: 'sm danger' });
  else if (k.status === 'complete') acts = A('Preview portal', 'dcPreview') + A('Reopen', 'dcReopen') + A('Download all (.zip)', 'dcZip') + A(k.filed ? 'Unfile' : 'File on SARS', 'dcFile') + A('Archive', 'dcArchive');
  else if (k.status === 'archived') acts = A('Unarchive', 'dcUnarchive') + A('Download all (.zip)', 'dcZip');
  else acts = A('Reopen', 'dcReopen') + A('Preview portal', 'dcPreview');
  const next = dcChasing(k) ? (() => { const d = dcNextRem(k); return daysTo(d) > 0 ? fDM(d) + ', about 09:00' : 'due today'; })() : (dcActive(k) ? (k.awaitingConfirm ? 'none while the client confirms' : 'Automatic reminders are off') : '–');
  return `<div class="stack dc">
    <nav class="crumbs" aria-label="Breadcrumb" data-rv-key="coll-detail-crumbs"><a href="#collections">Document collections</a><span>/</span><a href="#client-${c.id}">${esc(c.name)}</a></nav>
    <div class="pagehead" data-rv-key="coll-detail-head"><div class="stack" style="gap:6px"><h1>${esc(k.title)}</h1>
      <div class="row">${dcStatusPill(k)}<span class="dc-due${due.red ? ' bad' : ''}">${esc(due.text)}</span><span class="pill">${esc(dcTypeName(k.type))}</span>${k.period ? `<span class="small muted">${esc(k.period)}</span>` : ''}${k.awaitingConfirm && dcActive(k) ? '<span class="pill warn">Awaiting client confirmation</span>' : ''}${dcUnopened(k) ? '<span class="pill warn">Not opened in 36 hours</span>' : ''}</div></div></div>
    <div class="dc-detail" data-rv-key="coll-detail-body">
      <div class="stack" data-rv-zone="coll-detail-main">
        <section class="card stack" style="gap:10px" data-rv-key="coll-detail-checklist"><div class="row between"><h2>Checklist</h2><span class="small muted">${p.d} of ${p.n} done · ${p.up} uploaded, ${p.na} not applicable</span></div>
          <div class="dc-prog">${dcBar(p)}<span class="small mono">${p.pct}%</span></div>
          ${secs.map((s) => `<div class="dc-group"><p class="eyebrow">${esc(s)}</p><ul class="plain dc-items">${k.items.filter((i) => i.sec === s).map(itemRow).join('')}</ul></div>`).join('')}
          <p class="small muted">No per-document accept or reject: when everything you need is in, the collection is complete.</p></section>
        <section class="card stack" style="gap:8px" data-rv-key="coll-detail-activity"><h2>Activity</h2><p class="small muted">Also written to the audit trail. Reminders and chases are Auto tier (Comms Triage).</p>
          <ul class="steps">${k.act.slice().reverse().map((a) => `<li><div class="step-h"><span class="st">${esc(a.text)}</span></div><div class="step-m"><span class="mono">${esc(fWhen(a.at))}</span><span>${esc(a.by)}</span></div></li>`).join('')}</ul></section>
      </div>
      <div class="stack dc-side" data-rv-zone="coll-detail-side">
        <section class="card stack" style="gap:10px" data-rv-key="coll-detail-actions"><h2>Send and manage</h2><p class="small muted">All simulated: nothing is sent, downloaded or filed for real.</p><div class="actions">${acts}</div></section>
        <section class="card" data-rv-key="coll-detail-facts"><h2>Details</h2><dl class="facts">
          <dt>Client</dt><dd><a href="#client-${c.id}">${esc(c.short)}</a></dd>
          <dt>Contact</dt><dd>${esc(k.contact.name)}<br><span class="mono small">${esc(k.contact.email)}</span><br><span class="mono small">${esc(k.contact.phone)}</span> <span class="small muted">(demo)</span></dd>
          <dt>Sent</dt><dd>${k.sent ? esc(fWhen(k.sent)) : '–'} · ${esc(k.via)}</dd>
          <dt>Last opened</dt><dd>${k.opened ? esc(fWhen(k.opened)) : 'Not opened yet'}</dd>
          <dt>Reminders</dt><dd>${k.reminders} sent · next ${esc(next)}</dd>
          <dt>Repeats</dt><dd>${k.rec ? esc(k.rec) + (k.titleTpl ? ` <span class="small muted">(${esc(k.titleTpl)})</span>` : '') : 'No'}</dd>
          <dt>Portal check</dt><dd>${esc(DC_VERIFY[S.coll.set.verify][0])}</dd></dl></section>
        <section class="card stack" style="gap:10px" data-rv-key="coll-detail-task"><h2>Linked task</h2>
          ${j ? `<p class="small muted">${k.fed ? 'This collection fed the task when it was completed.' : dcWaiting(j) ? 'When this collection is complete, the task moves from Awaiting client to AI at work.' : 'Task ' + esc(j.id) + ' is not waiting on the client, so ' + (k.status === 'complete' || k.status === 'archived' ? 'completing this collection left it as it is.' : 'completing this collection will not move it.')}</p>${jobCard(j)}` : '<p class="muted">Not linked to a task.</p>'}</section>
      </div>
    </div>
  </div>`;
}

/* ---------- new collection ---------- */
function dcTplRows(tid) {
  const t = dcTpl(tid); if (!t) return [];
  return t.items.filter((x) => !x.parked).map((x) => ({ id: dcNid('r'), sec: x.sec, name: x.name, desc: x.desc, due: '' }));
}
function dcDefaultType(cid) { return cid === 'C20' ? 'newclient' : 'company'; }
function dcDraft() {
  if (!S.coll.draft) {
    S.coll.draft = { c: '', title: '', period: '', due: dcIso(day(7)), mode: 'template', type: 'company', rows: dcTplRows('company'), send: 'email', rec: '', feeds: '', err: '' };
  }
  return S.coll.draft;
}
function dcDraftSetClient(d, cid) {
  d.c = client(cid) ? cid : '';
  d.type = dcDefaultType(d.c);
  if (d.mode === 'template') d.rows = dcTplRows(d.type);
  const w = S.tasks.find((j) => j.c === d.c && dcWaiting(j));
  d.feeds = w ? w.id : '';
}
function dcViewNew() {
  const d = dcDraft(); const c = d.c ? client(d.c) : null;
  const opts = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const tasks = c ? S.tasks.filter((j) => j.c === c.id && dcWaiting(j)) : [];
  const secsFor = d.mode === 'template' && dcTpl(d.type) ? dcTpl(d.type).secs : DC_SECS;
  const rowSecs = (r) => (secsFor.includes(r.sec) ? secsFor : [r.sec].concat(secsFor));
  const rows = d.rows.map((r, i) => `<li class="dc-row">
      <label class="f" for="dc-r-${r.id}-sec">Category<select id="dc-r-${r.id}-sec" data-on="dcRow" data-id="${r.id}" data-k="sec">${rowSecs(r).map((s) => `<option${s === r.sec ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <label class="f dc-rname" for="dc-r-${r.id}-name">Document ${i + 1}<input id="dc-r-${r.id}-name" data-on="dcRow" data-id="${r.id}" data-k="name" maxlength="120" value="${esc(r.name)}" placeholder="e.g. Bank statement September"></label>
      <label class="f" for="dc-r-${r.id}-due">Due (optional)<input id="dc-r-${r.id}-due" type="date" data-on="dcRow" data-id="${r.id}" data-k="due" value="${esc(r.due)}"></label>
      ${btn('Remove', 'dcRowDel', { cls: 'sm', data: { id: r.id } })}</li>`).join('');
  const seg = (act, cur, list, label) => `<div class="seg" role="group" aria-label="${label}">${list.map(([v, l]) => `<button type="button" data-act="${act}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
  const sendHelp = { email: c ? 'Operon emails the portal link to ' + dcContact(c, null, 0).email + ' straight away (simulated).' : 'Operon emails the portal link to the client contact straight away (simulated).', whatsapp: 'You see the WhatsApp message with the portal link before anything goes (simulated).', link: 'You get the portal link to send yourself (simulated).' };
  return `<div class="stack dc">
    <nav class="crumbs" aria-label="Breadcrumb" data-rv-key="coll-new-crumbs"><a href="#collections">Document collections</a></nav>
    <div class="pagehead" data-rv-key="coll-new-head"><div class="stack" style="gap:6px"><h1>New collection</h1><p class="muted">Pick a client, say what you need and choose how to send it. Nothing is really sent in the preview.</p></div></div>
    <form data-form="dcCreate" class="stack dc-form" novalidate data-rv-key="coll-new-form">
      <section class="card stack" style="gap:10px" data-rv-key="coll-new-client"><h2>1. Client</h2>
        <label class="f dc-narrow" for="dc-n-client">Client<select id="dc-n-client" data-on="dcDraft" data-k="c"><option value="">Choose a client</option>${opts(S.clients.map((x) => [x.id, x.short]), d.c)}</select></label></section>
      <section class="card stack" style="gap:10px" data-rv-key="coll-new-details"><h2>2. Details</h2>
        <div class="dc-fields"><label class="f" for="dc-n-title">Title (required)<input id="dc-n-title" data-on="dcDraft" data-k="title" maxlength="140" value="${esc(d.title)}" placeholder="e.g. September bookkeeping documents"></label>
        <label class="f" for="dc-n-period">Period<input id="dc-n-period" data-on="dcDraft" data-k="period" maxlength="80" value="${esc(d.period)}" placeholder="e.g. September 2026"></label>
        <label class="f" for="dc-n-due">Due date<input id="dc-n-due" type="date" data-on="dcDraft" data-k="due" value="${esc(d.due)}"></label></div></section>
      <section class="card stack" style="gap:10px" data-rv-key="coll-new-docs"><h2>3. Documents</h2>
        ${seg('dcMode', d.mode, [['template', 'From template'], ['specific', 'Specific documents']], 'Where the checklist comes from')}
        ${d.mode === 'template' ? `<label class="f dc-narrow" for="dc-n-type">Client type<select id="dc-n-type" data-on="dcDraft" data-k="type">${opts(S.coll.tpls.map((t) => [t.id, t.name]), d.type)}</select></label><p class="hint">Rows come from the client type’s master checklist. Change them here; the template stays as it is.</p>` : '<p class="hint">List exactly what you need.</p>'}
        <ul class="dc-rows">${rows || '<li class="muted">No documents yet. Add one below.</li>'}</ul>
        <div>${btn('+ Add document', 'dcRowAdd', { cls: 'sm' })}</div></section>
      <section class="card stack" style="gap:10px" data-rv-key="coll-new-send"><h2>4. How to send it</h2>
        ${seg('dcSendVia', d.send, [['email', 'Email'], ['whatsapp', 'WhatsApp'], ['link', 'Copy link']], 'How to send it')}
        <p class="hint">${esc(sendHelp[d.send] || '')}</p></section>
      <section class="card stack" style="gap:10px" data-rv-key="coll-new-options"><h2>Options</h2>
        <div class="dc-fields"><label class="f" for="dc-n-rec">Repeat<select id="dc-n-rec" data-on="dcDraft" data-k="rec">${opts(DC_REC, d.rec)}</select></label>
        <label class="f" for="dc-n-feeds">Feeds task (optional)<select id="dc-n-feeds" data-on="dcDraft" data-k="feeds"><option value="">${tasks.length ? 'No task' : 'No task is waiting on this client'}</option>${tasks.map((j) => `<option value="${esc(j.id)}"${j.id === d.feeds ? ' selected' : ''}>${esc(j.id + ' · ' + j.title + ' (' + stateWord(j)[1] + ')')}</option>`).join('')}</select></label></div>
        <p class="hint">Tokens you can use in the title: {client_name} {month} {year} {prev_month} {prev_year}${d.rec ? '. Each new ' + esc(d.rec) + ' collection fills them in again.' : '.'}</p>
        <p class="small">Title preview: <strong id="dc-n-preview">${esc(dcTokens(d.title, c) || '–')}</strong></p>
        ${d.feeds ? '<p class="small muted">When the collection is complete, that task moves from Awaiting client to AI at work by itself.</p>' : ''}</section>
      <p class="err" id="dc-n-err" role="alert">${esc(d.err)}</p>
      <div class="row"><button class="btn primary" type="submit">Create and send</button><a class="btn" href="#collections">Cancel</a></div>
    </form>
  </div>`;
}
function dcSyncDraft(root) {
  $$('[data-on="dcDraft"],[data-on="dcRow"]', root || document).forEach((el) => {
    const d = dcDraft(); const k = el.dataset.k;
    if (el.dataset.on === 'dcRow') { const r = d.rows.find((x) => x.id === el.dataset.id); if (r && ['sec', 'name', 'due'].includes(k)) r[k] = String(el.value).slice(0, 140); }
    else if (['title', 'period', 'due'].includes(k)) d[k] = String(el.value).slice(0, 140);
  });
}

/* ---------- client portal ---------- */
function viewPortal(token) {
  const k = dcByToken(token);
  const strip = `<div class="dc-strip" data-rv-key="coll-portal-strip"><span>You’re viewing the client portal</span><a class="btn sm" href="${k ? dcHref(k.id) : '#collections'}">Back to Operon</a></div>`;
  const brand = `<header class="dc-brand"><span class="dc-mono" aria-hidden="true">AP</span><span class="stack" style="gap:0"><span class="dc-firm">${esc(FIRM)}</span><span class="small muted">Secure document upload · demo</span></span></header>`;
  const wrap = (key, inner, extra) => `<div class="stack dc dc-portalpage">${strip}<section class="card dc-portal stack" data-rv-key="${key}">${brand}${inner}</section>${extra || ''}</div>`;
  if (!k) return wrap('coll-portal-unknown', '<h1>This link doesn’t work</h1><p>The link may be old or mistyped. Ask your accountant to send it again.</p>');
  const c = client(k.c); const ps = dcPs(k.token); const first = k.contact.name.replace(/^Dr /, '').split(' ')[0];
  if (k.status === 'cancelled') return wrap('coll-portal-cancelled', `<h1>This request was cancelled</h1><p>${esc(FIRM)} no longer needs these documents. You don’t have to do anything.</p>`);
  if (k.status === 'archived') return wrap('coll-portal-closed', `<h1>This request is closed</h1><p>${esc(FIRM)} has everything it needs. Thank you.</p>`);
  if (k.status === 'complete') {
    return wrap('coll-portal-done', `<div class="dc-donebox stack"><span class="dc-tick" aria-hidden="true">${ico('<path d="m3 8.5 3.2 3L13 4.5"/>', 28)}</span><h1>All documents submitted</h1><p>Thank you! ${esc(FIRM)} has been notified.</p><p class="small muted">You can close this page. If you need to send something else, reply to the email from your accountant.</p></div>`);
  }
  if (!ps.verified) {
    const m = DC_VERIFY[S.coll.set.verify] || DC_VERIFY.reg;
    return wrap('coll-portal-verify', `<div class="stack" style="gap:6px"><h1>Verify your identity</h1><p>Hello ${esc(first)}. ${esc(FIRM)} has asked for documents for “${esc(k.title)}”. First confirm it’s you.</p></div>
      <form data-form="dcVerify" data-token="${esc(k.token)}" class="stack" style="gap:10px" novalidate>
        <label class="f" for="dc-v">${esc(m[1])}<input id="dc-v" name="answer" inputmode="numeric" autocomplete="off" maxlength="12"></label>
        <p class="hint">Demo hint: the answer is <span class="mono">${esc(dcVerifyAnswer(k))}</span>.</p>
        <p class="err" id="dc-v-err" role="alert">${ps.err ? esc(ps.err) : ''}</p>
        <button class="btn primary" type="submit">Access documents</button></form>`);
  }
  if ((ps.step === 'confirm' || k.awaitingConfirm) && k.items.every(dcIsDone)) {
    return wrap('coll-portal-confirm', `<div class="stack" style="gap:6px"><h1>Is that everything?</h1><p>You’ve uploaded or marked every document. Once you confirm, ${esc(FIRM)} is told that everything is in.</p></div>
      <div class="row">${btn('Yes, submit', 'dcConfirm', { cls: 'primary', data: { token: k.token, v: 'yes' } })}${btn('No, I have more', 'dcConfirm', { data: { token: k.token, v: 'no' } })}</div>`);
  }
  const p = dcProg(k); const due = k.due ? 'Due ' + fDM(k.due) : 'No due date';
  const secs = []; for (const it of k.items) if (!secs.includes(it.sec)) secs.push(it.sec);
  const T = { token: k.token };
  const row = (it) => {
    let body;
    if (it.state === 'uploaded') body = `<span class="dc-pstate"><span class="pill ok">${I.check} Uploaded</span><span class="dc-file">${esc(it.file.name)} · ${esc(dcSize(it.file.size))}</span></span><span class="row">${btn('Remove', 'dcUnup', { cls: 'sm', data: Object.assign({ id: it.id }, T) })}</span>`;
    else if (it.state === 'na') body = `<span class="dc-pstate"><span class="pill">Not applicable</span></span><span class="row">${btn('Undo', 'dcUnna', { cls: 'sm', data: Object.assign({ id: it.id }, T) })}</span>`;
    else body = `<span class="row">${btn('Upload', 'dcUp', { cls: 'sm primary', data: Object.assign({ id: it.id }, T) })}${btn('Mark N/A', 'dcNa', { cls: 'sm', data: Object.assign({ id: it.id }, T) })}<span class="small muted dc-dropnote">or drop a file here</span></span>`;
    return `<li class="dc-pitem${dcIsDone(it) ? ' dc-isdone' : ''}" data-dc-drop="${esc(it.id)}" data-token="${esc(k.token)}"><span class="stack" style="gap:2px"><strong>${esc(it.name)}</strong>${it.desc ? `<span class="small muted">${esc(it.desc)}</span>` : ''}${it.due && it.state === 'missing' ? `<span><span class="pill warn">Due ${esc(fDM(it.due))}</span></span>` : ''}</span>${body}</li>`;
  };
  const t = dcTpl(k.type); const files = t ? t.files : [];
  const all = k.items.length > 0 && k.items.every(dcIsDone);
  return wrap('coll-portal-checklist', `<div class="stack" style="gap:4px"><h1>${esc(k.title)}</h1><p class="small muted">For ${esc(c.short)}${k.period ? ' · ' + esc(k.period) : ''} · ${esc(due)}</p></div>
      <div class="stack" style="gap:6px"><p class="dc-progline" aria-live="polite">${p.up} of ${p.n - p.na} documents uploaded${p.na ? ' · ' + p.na + ' not applicable' : ''}</p><div class="dc-prog">${dcBar(p)}</div></div>
      ${secs.map((s) => `<div class="dc-group"><p class="eyebrow">${esc(s)}</p><ul class="plain dc-pitems">${k.items.filter((i) => i.sec === s).map(row).join('')}</ul></div>`).join('')}
      <div class="stack" style="gap:6px">${all ? btn('Submit documents', 'dcSubmit', { cls: 'primary', data: T }) : '<button type="button" class="btn primary" disabled>Submit documents</button><p class="hint">Upload or mark N/A every document to submit.</p>'}</div>`,
    files.length ? `<section class="card dc-portal stack" style="gap:8px" data-rv-key="coll-portal-files"><h2>Files from your accountant</h2><ul class="plain dc-mini">${files.map((f, i) => `<li class="row between dc-frow"><span class="dc-file">${esc(f.name)} <span class="muted">· ${esc(dcSize(f.size))}</span></span>${btn('Download', 'dcPortalFile', { cls: 'sm', data: { i } })}</li>`).join('')}</ul></section>` : '');
}

/* ---------- cards on other pages ---------- */
function clientCollectionsSection(c) {
  if (!S.coll || !c) return '';
  const ks = S.coll.list.filter((k) => k.c === c.id);
  if (!ks.length) return '';
  return `<section class="card stack" style="gap:8px" data-rv-key="coll-client"><div class="row between"><h2>Document collections</h2>${btn('+ New collection', 'dcNewFor', { cls: 'sm', data: { c: c.id } })}</div>
    <ul class="plain dc-mini">${ks.map((k) => { const p = dcProg(k); return `<li><a class="dc-minirow" href="${dcHref(k.id)}"><span class="dc-mt">${esc(k.title)}</span><span class="row small" style="gap:8px">${dcStatusPill(k)}<span class="mono">${p.d}/${p.n} docs</span><span class="muted">${esc(dcDue(k).text)}</span></span></a></li>`; }).join('')}</ul></section>`;
}
function todayCollectionsCard() {
  if (!S.coll) return '';
  const since = now().getTime() - 24 * 3600e3;
  const ups = dcRecent().filter((r) => r.at.getTime() >= since);
  const ready = S.coll.list.filter((k) => dcActive(k) && k.awaitingConfirm).length;
  const open = S.coll.list.filter(dcActive).length; const late = S.coll.list.filter(dcOverdue).length;
  return `<section class="card stack" style="gap:8px" data-rv-key="coll-today"><div class="row between"><h2>Back from clients</h2><a class="small dc-link" href="#collections">Document collections</a></div>
    <p class="small muted">${dcPl(ups.length, 'document')} came back in the last 24 hours. ${dcPl(open, 'collection')} open, ${late} overdue${ready ? ', ' + ready + ' waiting for the client to confirm' : ''}.</p>
    ${ups.length ? `<ul class="plain dc-mini">${ups.slice(0, 3).map(dcMiniRow).join('')}</ul>` : ''}</section>`;
}
function taskCollectionCard(j) {
  if (!S.coll || !j) return '';
  const ks = S.coll.list.filter((k) => k.task === j.id && k.status !== 'cancelled');
  const k = ks.find(dcActive) || ks.find((x) => x.fed) || ks[ks.length - 1];
  if (!k) return '';
  const p = dcProg(k); const live = dcActive(k); const miss = live ? k.items.filter((i) => i.state === 'missing') : [];
  const note = live ? (dcWaiting(j) ? 'Document collections is chasing this for the task. When it is complete, the task moves to AI at work by itself.' : 'The task is not waiting on the client, so completing this collection will not move it.')
    : k.fed ? 'The documents came back through this collection, and the task moved on to AI at work.' : 'This collection is closed. It did not move the task.';
  return `<section class="card stack" style="gap:10px" data-rv-key="coll-task"><div class="row between"><h2>Document collection</h2>${dcStatusPill(k)}</div>
    <p><a href="${dcHref(k.id)}">${esc(k.title)}</a> <span class="small muted">· ${esc(dcDue(k).text)} · ${dcPl(k.reminders, 'reminder')} sent</span></p>
    <div class="dc-prog">${dcBar(p)}<span class="small mono">${p.d}/${p.n} docs</span></div>
    ${miss.length ? `<p class="small">Still missing: ${miss.map((i) => esc(i.name)).join('; ')}</p>` : ''}
    <p class="small muted">${note}</p>
    <div class="actions"><a class="btn sm" href="${dcHref(k.id)}">Open collection</a>${live ? btn('Preview portal', 'dcPreview', { cls: 'sm', data: { id: k.id } }) + btn('Send a reminder now', 'dcRemind', { cls: 'sm', data: { id: k.id } }) : ''}</div></section>`;
}

/* ---------- modals ---------- */
function dcCopyModal(k) {
  const link = 'SIMULATED-PORTAL:' + k.token;
  dcAct(k, 'Portal link copied by ' + me().name, me().name);
  dcAudit(k, { text: 'Copied the portal link for “' + k.title + '” (' + client(k.c).short + ')', result: 'Done', evidence: 'Simulated link: nothing was sent' });
  modal('Copy portal link', `<p>This is a simulated link. It only works inside this preview, through Preview portal.</p><input id="dc-link" readonly class="mono" value="${esc(link)}" aria-label="Portal link">`, null, null,
    { extra: '<button type="button" class="btn" data-act="copy" data-src="dc-link">Copy link</button>' });
  try { navigator.clipboard.writeText(link).then(() => toast('Copied ' + link), () => {}); } catch (e) { /* the field is shown to copy by hand */ }
}
function dcWaModal(k) {
  const first = k.contact.name.replace(/^Dr /, '').split(' ')[0];
  const msg = 'Hi ' + first + ', ' + FIRM + ' needs a few documents for “' + k.title + '”' + (k.due ? ' by ' + fDM(k.due) : '') + '. Upload them here: SIMULATED-PORTAL:' + k.token + ' Thank you!';
  modal('Send via WhatsApp', `<p class="small muted">To ${esc(k.contact.name)}, ${esc(k.contact.phone)} (demo). Simulated: no WhatsApp link opens and nothing is sent.</p>
    <label class="f" for="dc-wa-text">Message<textarea id="dc-wa-text" readonly>${esc(msg)}</textarea></label>`, 'Mark as sent (simulated)', () => {
    dcAct(k, 'Portal link sent by WhatsApp to ' + k.contact.phone + ' (simulated)');
    dcAudit(k, { kind: 'agent', who: 'Comms Triage', text: 'Sent the portal link for “' + k.title + '” by WhatsApp to ' + k.contact.name + ' (' + client(k.c).short + ')', tier: 'auto', rule: 'R04', result: 'Sent', verdict: 'Invariants passed' });
    toast('Marked as sent by WhatsApp (simulated).');
    return () => render();
  }, { extra: '<button type="button" class="btn" data-act="copy" data-src="dc-wa-text">Copy message</button>' });
}
function dcSecModal(t, i) {
  const old = i == null ? '' : t.secs[i];
  modal(i == null ? 'Add a section' : 'Rename section', `<label class="f" for="dc-sec-name">Section name<input id="dc-sec-name" name="name" maxlength="60" value="${esc(old)}"></label>`, i == null ? 'Add section' : 'Rename', (fd) => {
    const name = dcClean(fd.name, 60);
    if (!name) return 'Enter a section name.';
    if (t.secs.some((s, x) => s.toLowerCase() === name.toLowerCase() && x !== i)) return 'That section already exists.';
    if (i == null) t.secs.push(name);
    else { t.secs[i] = name; t.items.forEach((x) => { if (x.sec === old) x.sec = name; }); }
    addAudit({ text: (i == null ? 'Added the section “' + name + '”' : 'Renamed the section “' + old + '” to “' + name + '”') + ' in ' + t.name, result: 'Done', evidence: 'Document collections templates' });
    return () => render();
  });
}

/* ---------- handlers ---------- */
const dcFrom = (t) => dcGet(t.dataset.id);
const dcPortalOf = (t) => { const k = dcByToken(t.dataset.token); return k && dcActive(k) && dcPs(k.token).verified ? k : null; };
Object.assign(ACT, {
  dcTab: (t) => { S.coll.tab = ['board', 'templates', 'settings'].includes(t.dataset.v) ? t.dataset.v : 'board'; if (routeOf().name !== 'collections') location.hash = '#collections'; else render(); },
  dcTplTab: (t) => { S.coll.tplTab = t.dataset.v === 'doc' ? 'doc' : 'client'; render(); },
  dcTplSel: (t) => { if (dcTpl(t.dataset.id)) S.coll.tplSel = t.dataset.id; S.noRestore = true; render(); },
  dcNew: () => { location.hash = '#collection-new'; },
  dcQClear: () => { S.coll.q = ''; S.noRestore = true; render(); const el = document.getElementById('dc-q'); if (el) el.focus(); },
  dcNewFor: (t) => { const d = dcDraft(); dcDraftSetClient(d, t.dataset.c); location.hash = '#collection-new'; },
  dcPreview: (t) => { const k = dcFrom(t); if (k) location.hash = '#portal-' + k.token; },
  dcCopy: (t) => { const k = dcFrom(t); if (k) dcCopyModal(k); },
  dcResend: (t) => { const k = dcFrom(t); if (!k) return; dcSendEmail(k, true); render(); },
  dcWa: (t) => { const k = dcFrom(t); if (k) dcWaModal(k); },
  dcRemind: (t) => { const k = dcFrom(t); if (!k || !dcActive(k)) return; dcRemindOne(k, 'Sent now by ' + me().name); toast('Reminder sent to ' + k.contact.email + ' (simulated). Logged as Auto, Comms Triage.'); render(); },
  dcDone: (t) => {
    const k = dcFrom(t); if (!k || !dcActive(k)) return;
    const miss = k.items.filter((i) => !dcIsDone(i)).length;
    const go = () => { dcComplete(k, false); toast('Collection marked complete.'); render(); };
    if (!miss) { go(); return; }
    modal('Mark complete', `<p>${miss} ${miss === 1 ? 'document is' : 'documents are'} still missing. Mark the collection complete anyway?</p><p class="small muted">Reminders stop. ${k.task && !k.fed && dcWaiting(task(k.task)) ? 'Task ' + esc(k.task) + ' moves to AI at work.' : ''}</p>`, 'Mark complete', () => () => go());
  },
  dcReopen: (t) => {
    const k = dcFrom(t); if (!k) return;
    k.status = k.items.some(dcIsDone) ? 'in_progress' : 'pending'; k.completedAt = null; k.filed = false; k.awaitingConfirm = false;
    if (S.coll.ps[k.token]) S.coll.ps[k.token].step = 'list';
    dcAct(k, 'Reopened by ' + me().name, me().name);
    dcAudit(k, { text: 'Reopened the document collection “' + k.title + '” for ' + client(k.c).short, result: 'Done' });
    toast('Reopened. The client can upload again.'); render();
  },
  dcZip: () => toast('Simulated: Download all would give you a .zip. Nothing is downloaded in the preview.'),
  dcDl: (t) => { const k = dcFrom(t); const it = k && k.items.find((i) => i.id === t.dataset.item); if (it && it.file) toast('Simulated download of ' + it.file.name + '. The preview never keeps file contents.'); },
  dcCancel: (t) => {
    const k = dcFrom(t); if (!k || !dcActive(k)) return;
    modal('Cancel this collection', `<p>Cancel “${esc(k.title)}”? Reminders stop and the client’s link shows that the request was cancelled.</p>`, 'Cancel collection', () => {
      k.status = 'cancelled'; k.awaitingConfirm = false; dcAct(k, 'Cancelled by ' + me().name, me().name);
      dcAudit(k, { text: 'Cancelled the document collection “' + k.title + '” for ' + client(k.c).short, result: 'Cancelled' });
      toast('Collection cancelled.'); return () => render();
    }, { danger: true, cancelLabel: 'Keep it' });
  },
  dcArchive: (t) => { const k = dcFrom(t); if (!k || k.status !== 'complete') return; k.status = 'archived'; dcAct(k, 'Archived by ' + me().name, me().name); dcAudit(k, { text: 'Archived the document collection “' + k.title + '”', result: 'Done' }); toast('Archived. It is listed under Cancelled and archived.'); render(); },
  dcUnarchive: (t) => { const k = dcFrom(t); if (!k || k.status !== 'archived') return; k.status = 'complete'; dcAct(k, 'Unarchived by ' + me().name, me().name); dcAudit(k, { text: 'Unarchived the document collection “' + k.title + '”', result: 'Done' }); toast('Back on the board under Complete.'); render(); },
  dcFile: (t) => {
    const k = dcFrom(t); if (!k || k.status !== 'complete') return;
    k.filed = !k.filed; dcAct(k, (k.filed ? 'Marked as filed on SARS' : 'Unfiled') + ' by ' + me().name, me().name);
    dcAudit(k, { text: (k.filed ? 'Marked “' : 'Unmarked “') + k.title + '” as filed on SARS', result: 'Done', evidence: 'Board flag only: filing happens on eFiling' });
    toast(k.filed ? 'Moved to Filed on SARS.' : 'Moved back to Complete.'); render();
  },
  dcBulk: () => {
    const chips = S.clients.map((c) => `<label><input type="checkbox" name="bc_${c.id}" value="1"> ${esc(c.short)}</label>`).join('');
    modal('Bulk send', `<p class="small muted">Send the same checklist to several clients. Each client gets their own portal link. Simulated: nothing is sent.</p>
      <label class="f" for="dc-b-tpl">Checklist<select id="dc-b-tpl" name="tpl">${S.coll.tpls.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label>
      <label class="f" for="dc-b-title">Title<input id="dc-b-title" name="title" maxlength="140" value="${esc('Documents for {month} {year}')}"></label>
      <p class="hint">Tokens: {client_name} {month} {year} {prev_month} {prev_year}</p>
      <label class="f" for="dc-b-due">Due date<input id="dc-b-due" name="due" type="date" value="${dcIso(day(14))}"></label>
      <fieldset class="dc-fs"><legend class="small muted">Clients</legend><div class="chips">${chips}</div></fieldset>`, 'Send to selected clients', (fd) => {
      const ids = S.clients.filter((c) => fd['bc_' + c.id]).map((c) => c.id);
      const title = dcClean(fd.title, 140); const t = dcTpl(fd.tpl);
      if (!t) return 'Choose a checklist.';
      if (!title) return 'Enter a title.';
      if (!ids.length) return 'Choose at least one client.';
      for (const cid of ids) {
        const c = client(cid);
        const k = dcMake({ c: cid, title: dcTokens(title, c), titleTpl: /\{/.test(title) ? title : '', period: '', due: dcParseDate(fd.due), type: t.id, task: null, rec: null, items: t.items.filter((x) => !x.parked) });
        dcSendEmail(k, false);
      }
      toast('Sent to ' + ids.length + (ids.length === 1 ? ' client' : ' clients') + ' (simulated).');
      return () => render();
    });
  },
  dcRun: () => { dcRunReminders(); render(); },
  dcCad: (t) => { if (DC_CADENCE.some((c) => c[0] === t.dataset.v)) S.coll.set.cadence = t.dataset.v; addAudit({ text: 'Set document reminders to ' + dcCadWord(), result: 'Done', evidence: 'Document collections settings' }); render(); },
  dcMode: (t) => { const d = dcDraft(); dcSyncDraft(); d.mode = t.dataset.v === 'specific' ? 'specific' : 'template'; d.rows = d.mode === 'template' ? dcTplRows(d.type) : [{ id: dcNid('r'), sec: 'Banking', name: 'Bank statements', due: '' }, { id: dcNid('r'), sec: 'Sales & purchases', name: 'Supplier tax invoices', due: '' }]; S.noRestore = true; render(); },
  dcSendVia: (t) => { const d = dcDraft(); dcSyncDraft(); if (['email', 'whatsapp', 'link'].includes(t.dataset.v)) d.send = t.dataset.v; render(); },
  dcRowAdd: () => { const d = dcDraft(); dcSyncDraft(); const r = { id: dcNid('r'), sec: d.mode === 'template' && dcTpl(d.type) ? dcTpl(d.type).secs[0] : 'General', name: '', due: '' }; d.rows.push(r); render(); const el = document.getElementById('dc-r-' + r.id + '-name'); if (el) el.focus(); },
  dcRowDel: (t) => { const d = dcDraft(); dcSyncDraft(); d.rows = d.rows.filter((r) => r.id !== t.dataset.id); render(); },
  dcTiEdit: (t) => {
    const tp = dcTpl(S.coll.tplSel); const x = tp && tp.items.find((i) => i.id === t.dataset.id); if (!x) return;
    modal('Edit checklist item', `<label class="f" for="dc-te-name">Document<input id="dc-te-name" name="name" maxlength="120" value="${esc(x.name)}"></label><label class="f" for="dc-te-desc">Description (optional)<input id="dc-te-desc" name="desc" maxlength="200" value="${esc(x.desc)}"></label>`, 'Save', (fd) => {
      const name = dcClean(fd.name, 120); if (!name) return 'Enter the document name.';
      x.name = name; x.desc = dcClean(fd.desc, 200);
      addAudit({ text: 'Edited the checklist item “' + name + '” in ' + tp.name, result: 'Done', evidence: 'Document collections templates' });
      return () => render();
    });
  },
  dcTiPark: (t) => { const tp = dcTpl(S.coll.tplSel); const x = tp && tp.items.find((i) => i.id === t.dataset.id); if (!x) return; x.parked = !x.parked; toast(x.parked ? 'Parked. New collections leave it out.' : 'Back in the checklist.'); render(); },
  dcTiCopy: (t) => {
    const tp = dcTpl(S.coll.tplSel); const x = tp && tp.items.find((i) => i.id === t.dataset.id); if (!x) return;
    if (!tp.secs.some((s) => s !== x.sec)) { toast('Add another section first.'); return; }
    modal('Copy to another section', `<p>Copy “${esc(x.name)}” to:</p><label class="f" for="dc-tc-sec">Section<select id="dc-tc-sec" name="sec">${tp.secs.filter((s) => s !== x.sec).map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>`, 'Copy', (fd) => {
      if (!tp.secs.includes(fd.sec)) return 'Choose a section.';
      tp.items.push({ id: dcNid('t'), sec: fd.sec, name: x.name, desc: x.desc, parked: false });
      return () => render();
    });
  },
  dcSecRen: (t) => { const tp = dcTpl(S.coll.tplSel); const i = +t.dataset.i; if (tp && tp.secs[i] != null) dcSecModal(tp, i); },
  dcSecAdd: () => { const tp = dcTpl(S.coll.tplSel); if (tp) dcSecModal(tp, null); },
  dcTplFile: () => { const tp = dcTpl(S.coll.tplSel); if (tp) dcPick({ kind: 'tpl', tpl: tp.id }); },
  dcFileDl: () => toast('Simulated download. The preview keeps only file names and sizes.'),
  dcPortalFile: () => toast('Simulated download. The preview keeps only file names and sizes.'),
  dcUp: (t) => { const k = dcPortalOf(t); if (k && k.items.some((i) => i.id === t.dataset.id)) dcPick({ token: k.token, item: t.dataset.id }); },
  dcUnup: (t) => {
    const k = dcPortalOf(t); const it = k && k.items.find((i) => i.id === t.dataset.id); if (!it || it.state !== 'uploaded') return;
    dcAct(k, 'Client removed “' + it.file.name + '” from ' + it.name, 'Client');
    dcAudit(k, { kind: 'system', who: 'Client portal', text: k.contact.name + ' removed “' + it.file.name + '” from ' + it.name + ' (' + client(k.c).short + ')', result: 'Done' });
    it.state = 'missing'; it.file = null; k.awaitingConfirm = false; render();
  },
  dcNa: (t) => {
    const k = dcPortalOf(t); const it = k && k.items.find((i) => i.id === t.dataset.id); if (!it || it.state !== 'missing') return;
    it.state = 'na'; dcAct(k, 'Client marked ' + it.name + ' as not applicable', 'Client');
    dcAudit(k, { kind: 'system', who: 'Client portal', text: k.contact.name + ' marked ' + it.name + ' as not applicable (' + client(k.c).short + ')', result: 'Done' });
    dcMaybeProgress(k); render();
  },
  dcUnna: (t) => { const k = dcPortalOf(t); const it = k && k.items.find((i) => i.id === t.dataset.id); if (!it || it.state !== 'na') return; it.state = 'missing'; k.awaitingConfirm = false; dcAct(k, 'Client undid not applicable for ' + it.name, 'Client');
    dcAudit(k, { kind: 'system', who: 'Client portal', text: k.contact.name + ' undid not applicable for ' + it.name + ' (' + client(k.c).short + ')', result: 'Done' }); render(); },
  dcSubmit: (t) => {
    const k = dcPortalOf(t); if (!k) return;
    if (!k.items.every(dcIsDone)) { toast('Upload or mark N/A every document first.'); return; }
    const ps = dcPs(k.token);
    if (S.coll.set.confirm) { dcAskConfirm(k); render(); return; }
    dcComplete(k, true); ps.step = 'done'; render();
  },
  dcConfirm: (t) => {
    const k = dcPortalOf(t); if (!k) return; const ps = dcPs(k.token);
    if (t.dataset.v === 'yes' && k.items.every(dcIsDone)) { dcComplete(k, true); ps.step = 'done'; }
    else {
      ps.step = 'list'; k.awaitingConfirm = false; dcAct(k, 'Client has more to send', 'Client');
      dcAudit(k, { kind: 'system', who: 'Client portal', text: k.contact.name + ' has more to send for “' + k.title + '” (' + client(k.c).short + ')', result: 'Done' });
    }
    render();
  },
});
Object.assign(FORMS, {
  dcCreate: (f) => {
    const d = dcDraft(); dcSyncDraft(f);
    const c = client(d.c); const title = dcClean(d.title, 140);
    const rows = d.rows.map((r) => ({ sec: dcClean(r.sec, 60) || 'General', name: dcClean(r.name, 120), desc: dcClean(r.desc, 200), due: dcParseDate(r.due) })).filter((r) => r.name);
    const err = !c ? 'Choose a client.' : !title ? 'Enter a title. The client sees it in the portal.' : !rows.length ? 'Add at least one document.' : '';
    if (err) { d.err = err; const e = $('#dc-n-err'); if (e) e.textContent = err; return; }
    const jt = d.feeds ? task(d.feeds) : null; const j = jt && jt.c === c.id && dcWaiting(jt) ? jt.id : null;
    const k = dcMake({ c: c.id, title: dcTokens(title, c), titleTpl: d.rec ? title : '', period: dcClean(d.period, 80), due: dcParseDate(d.due), type: d.mode === 'template' ? d.type : 'custom', task: j, rec: d.rec || null, items: rows, via: d.send === 'whatsapp' ? 'WhatsApp' : d.send === 'link' ? 'Link' : 'Email' });
    const via = d.send;
    S.coll.draft = null; S.noRestore = true;
    if (via === 'email') dcSendEmail(k, false);
    else {
      dcAct(k, via === 'whatsapp' ? 'Ready to send by WhatsApp' : 'Portal link ready to copy');
      dcAudit(k, { text: (via === 'whatsapp' ? 'Prepared the portal link for “' + k.title + '” to send by WhatsApp' : 'Made the portal link for “' + k.title + '” ready to copy') + ' (' + c.short + ')', result: 'Done' });
    }
    if (j) { dcAct(k, 'Feeds task ' + j); dcAudit(k, { text: 'Linked “' + k.title + '” to task ' + j + ': it moves on when the documents are in', result: 'Done' }); }
    location.hash = dcHref(k.id);
    if (via === 'whatsapp') setTimeout(() => dcWaModal(k), 30);
    else if (via === 'link') setTimeout(() => dcCopyModal(k), 30);
  },
  dcVerify: (f) => {
    const k = dcByToken(f.dataset.token); if (!k || !dcActive(k)) { render(); return; }
    const ps = dcPs(k.token); const ans = String(f.elements.answer.value || '').replace(/\s+/g, '');
    if (ans !== dcVerifyAnswer(k)) { ps.err = 'That doesn’t match what we have. Check it and try again.'; const e = $('#dc-v-err'); if (e) e.textContent = ps.err; return; }
    ps.verified = true; ps.err = ''; k.opened = now();
    dcAct(k, 'Client opened the portal and verified', 'Client');
    dcAudit(k, { kind: 'system', who: 'Client portal', text: k.contact.name + ' verified and opened the portal for “' + k.title + '” (' + client(k.c).short + ')', result: 'Done' });
    S.noRestore = true; render();
  },
  dcTplAdd: (f) => {
    const tp = dcTpl(S.coll.tplSel); if (!tp) return;
    const name = dcClean(f.elements.name.value, 120); const sec = f.elements.sec.value;
    if (!name) { $('#dc-ta-err').textContent = 'Enter the document name.'; return; }
    if (!tp.secs.includes(sec)) { $('#dc-ta-err').textContent = 'Choose a section.'; return; }
    tp.items.push({ id: dcNid('t'), sec, name, desc: dcClean(f.elements.desc.value, 200), parked: false });
    addAudit({ text: 'Added “' + name + '” to the ' + tp.name + ' checklist', result: 'Done', evidence: 'Document collections templates' });
    S.noRestore = true; toast('Added to the checklist.'); render();
  },
  dcDtAdd: (f) => {
    const name = dcClean(f.elements.name.value, 120); const sec = f.elements.sec.value;
    if (!name) { $('#dc-dt-err').textContent = 'Enter the document name.'; return; }
    S.coll.dtypes.push({ id: dcNid('d'), name, sec: DC_SECS.includes(sec) ? sec : 'General', desc: dcClean(f.elements.desc.value, 200) });
    S.noRestore = true; toast('Document type added.'); render();
  },
});
Object.assign(EXT_FIELD, {
  dcQ: (el) => { S.coll.q = String(el.value).slice(0, 80); },
  dcDraft: (el) => {
    const d = dcDraft(); const k = el.dataset.k; const v = String(el.value);
    if (k === 'c') { dcSyncDraft(); dcDraftSetClient(d, v); S.noRestore = true; return; }
    if (k === 'type') { dcSyncDraft(); if (dcTpl(v)) { d.type = v; d.rows = dcTplRows(v); } S.noRestore = true; return; }
    if (k === 'rec') { d.rec = DC_REC.some((r) => r[0] === v) ? v : ''; return; }
    if (k === 'feeds') { d.feeds = v && task(v) ? v : ''; return; }
    if (['title', 'period', 'due'].includes(k)) {
      d[k] = v.slice(0, 140); if (d.err) d.err = '';
      if (k === 'title') { const pv = document.getElementById('dc-n-preview'); if (pv) pv.textContent = dcTokens(d.title, client(d.c)) || '–'; }
    }
    return false;
  },
  dcRow: (el) => { const d = dcDraft(); const r = d.rows.find((x) => x.id === el.dataset.id); if (r && ['sec', 'name', 'due'].includes(el.dataset.k)) r[el.dataset.k] = String(el.value).slice(0, 140); return false; },
  dcSet: (el) => {
    const st = S.coll.set; const k = el.dataset.k;
    if (['auto', 'wa', 'confirm', 'filedCol'].includes(k)) { st[k] = !!el.checked; addAudit({ text: 'Document collections setting changed: ' + k + ' ' + (st[k] ? 'on' : 'off'), result: 'Done', evidence: 'Document collections settings' }); return; }
    if (k === 'verify') { if (DC_VERIFY[el.value]) st.verify = el.value; return; }
    if (k === 'custom') {
      const n = parseInt(el.value, 10); if (n >= 1 && n <= 60) st.custom = n;
      const w = document.getElementById('dc-s-cadword'); if (w) w.textContent = dcCadWord();
      return false;
    }
    return false;
  },
});
