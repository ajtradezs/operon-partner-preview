/* The income tax calculation for an individual (ITR12), from the values extracted from the case's documents.
   CALC.compute(inputs, profile, ruleset) and CALC.forCase(c) are pure: they never change the case or the state.
   Lineage: document → extracted value (an input line: docId, ref, amount) → tax category → calculator field → calculation line.
   Judgement items (home office, travel, trade, foreign income, trusts, a deceased taxpayer) are never calculated by the preview:
   until the Tax Consultant records the amount and the rationale (line.decided), they are left out and listed in calc.pending with
   the code the engine raises (TAX-02, or AI-05 where interpretation goes beyond the approved rules).

   Order of the calculation (Income Tax Act):
     income = employment income + local interest − interest exemption (s10(1)(i)) + net rental + decided other income
     less decided deductions (home office, travel)                                  → "before s11F", excluding capital gains
     taxable capital gain (Eighth Schedule paras 5-10): aggregate gain less the annual exclusion, less any assessed capital loss
       brought forward, × the inclusion rate; a loss is reduced by the exclusion and carried forward
     s11F(2) = lowest of: the cap; 27.5% × the greater of remuneration and (before s11F + taxable capital gain); before s11F
     s18A = 10% × taxable income before s18A (capital gain included)
     normal tax on taxable income; less rebates (s6), s6A and s6B credits, other credits, each limited to the tax left
     result = tax after credits − PAYE − provisional tax paid (positive: payable; negative: refund) */
const CALC = (() => {
  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  // Calculator fields: the tax category each extracted value belongs to, how it is used, and which documents it may come from.
  const FIELDS = {
    remuneration:     { cat: 'Employment income', label: 'Remuneration', use: 'employment', kinds: ['irp5'] },
    medicalFringe:    { cat: 'Employment income', label: 'Employer-paid medical scheme fees (taxable fringe benefit)', use: 'employment', kinds: ['irp5'] },
    paye:             { cat: 'Tax paid', label: 'Employees’ tax (PAYE)', use: 'paye', kinds: ['irp5'] },
    provisionalPaid:  { cat: 'Tax paid', label: 'Provisional tax paid', use: 'provisional', kinds: ['notice'], sars: true },
    interest:         { cat: 'Local interest', label: 'Local interest', use: 'interest', kinds: ['it3b'] },
    dividends:        { cat: 'Local dividends', label: 'Local dividends (exempt)', use: 'exempt', kinds: ['it3b'] },
    rentalIncome:     { cat: 'Rental', label: 'Rental income', use: 'rental', kinds: ['rental'] },
    rentalExpenses:   { cat: 'Rental', label: 'Rental expenses', use: 'rentalCost', kinds: ['rental'] },
    capitalGain:      { cat: 'Capital gains', label: 'Capital gain or loss on a disposal', use: 'cgt', kinds: ['it3c'], signed: true },
    retirementFund:   { cat: 'Retirement fund contributions (s11F)', label: 'Pension or provident fund contributions', use: 's11f', kinds: ['irp5'] },
    ra:               { cat: 'Retirement fund contributions (s11F)', label: 'Retirement annuity contributions', use: 's11f', kinds: ['ra', 'irp5'] },
    medicalFees:      { cat: 'Medical (s6A and s6B)', label: 'Medical scheme fees paid by the taxpayer, including employer-paid fees taxed as a fringe benefit', use: 'fees', kinds: ['medical'] },
    medicalExpenses:  { cat: 'Medical (s6B)', label: 'Qualifying medical expenses not recovered', use: 'expenses', kinds: ['medical'] },
    donations:        { cat: 'Donations (s18A)', label: 'Donations with s18A receipts', use: 's18a', kinds: ['donation'] },
    homeOffice:       { cat: 'Home office', label: 'Home office expenses', use: 'deduction', kinds: ['homeoffice'], judgement: 'TAX-02' },
    travel:           { cat: 'Travel', label: 'Business travel (logbook)', use: 'deduction', kinds: ['logbook'], judgement: 'TAX-02' },
    trade:            { cat: 'Trade', label: 'Trade income (net)', use: 'other', kinds: null, judgement: 'TAX-02', signed: true },
    foreignIncome:    { cat: 'Foreign income', label: 'Foreign income', use: 'other', kinds: ['foreign'], judgement: 'AI-05', signed: true },
    foreignTaxCredit: { cat: 'Foreign income', label: 'Foreign tax credit (s6quat)', use: 'credit', kinds: ['foreign'], judgement: 'AI-05' },
    trust:            { cat: 'Trust distributions', label: 'Trust distribution', use: 'other', kinds: null, judgement: 'AI-05', signed: true },
  };
  const fieldOf = (k) => (own(FIELDS, k) ? FIELDS[k] : null);
  const rulesetOf = (v) => (own(RULESETS, v) ? RULESETS[v] : null);
  // Document kinds whose values belong in the calculation: a validated one with no extracted value fails the reconciliation.
  const FEEDS = ['irp5', 'it3b', 'it3c', 'medical', 'ra', 'rental', 'logbook', 'homeoffice', 'donation', 'foreign'];

  // Rounding to the cent, half away from zero on the decimal value (toPrecision strips binary noise), never −0.
  const r2 = (x) => { const v = Math.round(Number((Math.abs(x) * 100).toPrecision(15))) / 100; return v === 0 ? 0 : (x < 0 ? -v : v); };
  // Truncation to the cent, as SARS's worked examples do for the s6B credit (IT07).
  const t2 = (x) => Math.floor(Number((Math.max(0, x) * 100).toPrecision(15))) / 100;
  const cents = (a) => Math.abs(Number((a * 100).toPrecision(15)) - Math.round(a * 100)) < 1e-6;
  const rand = (n) => { const [i, d] = Math.abs(n).toFixed(2).split('.'); return (n < 0 ? '−R' : 'R') + i.replace(/\B(?=(\d{3})+$)/g, ',') + '.' + d; };
  const pct = (x) => r2(x * 100) + '%';

  // Normal tax from the brackets: base of the highest bracket the income passes, plus its rate on the amount above it.
  function bracketTax(rs, ti) {
    if (!(ti > 0)) return 0;
    const row = rs.brackets.slice().reverse().find((b) => ti > b[0]);
    return r2(row[2] + row[1] * (ti - row[0]));
  }
  // The tax threshold: the taxable income at which normal tax equals the rebates (rounded up to the rand, as SARS publishes it).
  function threshold(rs, age) {
    if (!(typeof age === 'number' && age >= 0)) return null;
    const reb = rs.rebates.primary + (age >= 65 ? rs.rebates.secondary : 0) + (age >= 75 ? rs.rebates.tertiary : 0);
    const rows = rs.brackets;
    for (let i = 0; i < rows.length; i++) {
      const next = rows[i + 1];
      if (!next || reb < next[2]) return Math.ceil(rows[i][0] + (reb - rows[i][2]) / rows[i][1] - 1e-6) || 0;
    }
    return null;
  }

  // Dates of birth and age on the last day of the year of assessment.
  const realDate = (y, m, d) => { const x = new Date(Date.UTC(y, m - 1, d)); return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x.toISOString().slice(0, 10) : null; };
  const yearEnd = (year) => (Number.isInteger(year) ? new Date(Date.UTC(year, 2, 0)).toISOString().slice(0, 10) : null);
  function ageOn(dob, iso) {
    if (!dob || !iso) return null;
    const [y, m, d] = dob.split('-').map(Number); const [Y, M, D] = iso.split('-').map(Number);
    return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
  }
  // The client's recorded date of birth when it is a real date; otherwise the first six digits of the SA ID number (YYMMDD).
  // The ID gives no century: a 20xx reading after the year end is 19xx; a reading that makes the filer younger than 16 could
  // equally be a centenarian, so the date of birth must then be recorded (null here).
  function dobOf(cl, year) {
    if (cl && cl.dob) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cl.dob); const d = m && realDate(+m[1], +m[2], +m[3]); if (d) return d; }
    const m = /^(\d{2})(\d{2})(\d{2})\d{7}$/.exec(String((cl && cl.idNo) || ''));
    if (!m || !Number.isInteger(year)) return null;
    const yy = +m[1]; const end = yearEnd(year);
    const d1900 = realDate(1900 + yy, +m[2], +m[3]);
    if (yy > year % 100) return d1900;
    const d2000 = realDate(2000 + yy, +m[2], +m[3]);
    if (!d2000 || d2000 > end) return d1900;
    return ageOn(d2000, end) < 16 ? null : d2000;
  }
  function profileOf(cl, year, inputs) {
    const end = yearEnd(year); const dob = dobOf(cl, year);
    return { year, yearEnd: end, dob, age: ageOn(dob, end), disability: !!(inputs && inputs.medical && inputs.medical.disability), deceased: !!(cl && cl.deceased) };
  }

  const ZERO = () => ({ taxableIncome: 0, normalTax: 0, rebates: 0, medicalCredits: 0, paye: 0, provisional: 0, otherCredits: 0, result: 0 });
  const mtcFor = (rs, deps) => rs.mtc.main + (deps >= 1 ? rs.mtc.first : 0) + Math.max(0, deps - 1) * rs.mtc.additional;

  function compute(inputs, prof, rs, version) {
    inputs = inputs && typeof inputs === 'object' ? inputs : {};
    const errors = []; const pending = []; const used = [];
    const ver = rs ? rs.version : (version || null);
    if (!rs) errors.push('Ruleset ' + (version || '(none)') + ' is not defined');
    if (!Number.isInteger(prof.year)) errors.push('The case has no valid year of assessment');
    else if (prof.age == null) errors.push('The age cannot be determined: record the date of birth (the ID number does not settle it)');
    // A ruleset for another year is not a validation error (TAX-01) but a configuration error (TAX-06): the engine raises it.
    const wrongYear = !!(rs && Number.isInteger(prof.year) && rs.year !== prof.year);
    const seen = new Set();
    (Array.isArray(inputs.lines) ? inputs.lines : []).forEach((l, i) => {
      if (!l || typeof l !== 'object') { errors.push('Extracted value ' + (i + 1) + ' is empty'); return; }
      const f = fieldOf(l.field);
      if (!l.id || seen.has(l.id)) { errors.push('Every extracted value needs its own id' + (l.id ? ': ' + l.id + ' is used twice' : '')); return; }
      seen.add(l.id);
      if (!f) { errors.push(l.id + ': unknown calculator field ' + l.field); return; }
      if (typeof l.amount !== 'number' || !isFinite(l.amount)) { errors.push(l.id + ': ' + f.label + ' is not a number'); return; }
      if (!cents(l.amount)) { errors.push(l.id + ': ' + f.label + ' is not a whole number of cents'); return; }
      if (l.amount < 0 && !f.signed) { errors.push(l.id + ': ' + f.label + ' cannot be negative'); return; }
      if (f.judgement && !(l.decided && l.decided.by && String(l.decided.rationale || '').trim())) {
        pending.push({ line: l.id, field: l.field, label: f.label, amount: r2(l.amount), code: f.judgement }); return;
      }
      used.push(l);
    });
    // Medical scheme membership: months and dependants, or periods of { months, dependants } when the cover changed in the year,
    // and the taxpayer's share of the fees when someone else paid part of them (s6A(3A)).
    const med = inputs.medical && typeof inputs.medical === 'object' ? inputs.medical : {};
    const periods = Array.isArray(med.periods) && med.periods.length ? med.periods
      : [{ months: med.months == null ? 0 : med.months, dependants: med.dependants == null ? 0 : med.dependants }];
    periods.forEach((p) => {
      if (!(p && Number.isInteger(p.months) && p.months >= 0 && p.months <= 12)) errors.push('Medical scheme months must be a whole number from 0 to 12');
      if (!(p && Number.isInteger(p.dependants) && p.dependants >= 0)) errors.push('The number of medical scheme dependants must be a whole number');
    });
    const months = periods.reduce((a, p) => a + ((p && Number.isInteger(p.months)) ? p.months : 0), 0);
    if (months > 12) errors.push('The medical scheme periods add up to more than 12 months');
    const share = med.share == null ? 1 : med.share;
    if (!(typeof share === 'number' && share > 0 && share <= 1)) errors.push('The share of the medical scheme fees must be more than 0 and at most 1');
    const carried = inputs.carried && typeof inputs.carried === 'object' ? inputs.carried : {};
    const cf = (k) => { const v = carried[k]; if (v == null) return 0; if (typeof v === 'number' && v >= 0 && cents(v)) return v; errors.push('Carried-forward ' + k + ' must be zero or a positive amount in cents'); return 0; };
    const cfS11f = cf('s11f'); const cfS18a = cf('s18a'); const cfLoss = cf('capitalLoss');
    if (prof.deceased) pending.push({ line: 'deceased', field: null, label: 'Deceased taxpayer: the year of assessment ends on the date of death', amount: 0, code: 'AI-05' });

    const tot = (use) => r2(used.filter((l) => FIELDS[l.field].use === use).reduce((a, l) => a + l.amount, 0));
    const ids = (...uses) => used.filter((l) => uses.includes(FIELDS[l.field].use)).map((l) => l.id);
    const lines = []; const put = (key, label, amount, basis, from) => { const v = r2(amount); lines.push({ key, label, amount: v, basis: basis || '', from: from || [] }); return v; };
    if (!rs || prof.age == null || !Number.isInteger(prof.year) || prof.deceased) {
      return { ruleset: ver, year: rs ? rs.year : null, summary: ZERO(), lines, pending, errors, wrongYear, profile: prof, schedules: null, used };
    }

    const senior = prof.age >= 65; const over75 = prof.age >= 75;
    const fees = tot('fees'); const exp = tot('expenses');
    if (fees > 0 && !months) errors.push('Medical scheme fees are recorded but no months of membership');
    // Income
    const emp = put('employment', 'Employment income', tot('employment'), 'Remuneration and taxable fringe benefits from the IRP5', ids('employment'));
    const intGross = put('interest', 'Local interest', tot('interest'), '', ids('interest'));
    const exLimit = senior ? rs.interestExemption.over65 : rs.interestExemption.under65;
    const intEx = Math.min(intGross, exLimit);
    put('interestExempt', 'Less: interest exemption', -intEx, 's10(1)(i): up to ' + rand(exLimit) + (senior ? ' (65 or older)' : ' (under 65)'));
    const rentIn = tot('rental'); const rentOut = tot('rentalCost');
    const rental = put('rental', 'Net rental income', rentIn - rentOut, rand(rentIn) + ' income less ' + rand(rentOut) + ' expenses', ids('rental', 'rentalCost'));
    const other = put('otherIncome', 'Other income (Tax Consultant’s decision)', tot('other'), 'Judgement items with a recorded decision', ids('other'));
    const income = put('income', 'Income', emp + intGross - intEx + rental + other, 'Gross income less exempt income');
    const ded = tot('deduction');
    put('deductions', 'Less: deductions (Tax Consultant’s decision)', -ded, 'Judgement items with a recorded decision', ids('deduction'));
    const beforeRf = r2(income - ded);
    // Capital gains (Eighth Schedule): the annual exclusion, then any assessed capital loss brought forward, then the inclusion rate.
    const agg = put('capitalGains', 'Aggregate capital gain or loss', tot('cgt'), 'Sum of the gains and losses on disposals', ids('cgt'));
    const excl = rs.cgt.exclusion;
    const aggGain = agg > 0 ? Math.max(0, agg - excl) : 0;
    const aggLoss = agg < 0 ? Math.max(0, -agg - excl) : 0;
    const netGain = r2(Math.max(0, aggGain - cfLoss));
    const lossCarried = r2(aggLoss + Math.max(0, cfLoss - aggGain));
    let cgBasis;
    if (!agg && !cfLoss) cgBasis = 'No disposals';
    else if (agg < 0) cgBasis = 'Loss of ' + rand(-agg) + ' reduced by the ' + rand(excl) + ' annual exclusion' + (cfLoss ? ', plus ' + rand(cfLoss) + ' brought forward' : '') + ': assessed capital loss of ' + rand(lossCarried) + ' carried forward';
    else if (agg <= excl && !cfLoss) cgBasis = 'Gain of ' + rand(agg) + ' within the ' + rand(excl) + ' annual exclusion';
    else cgBasis = '(' + rand(agg) + ' less the ' + rand(excl) + ' annual exclusion' + (cfLoss ? ' and the ' + rand(cfLoss) + ' assessed capital loss brought forward' : '') + ') × ' + pct(rs.cgt.inclusion) + ' inclusion rate' + (lossCarried ? '; ' + rand(lossCarried) + ' still carried forward' : '');
    const tcg = put('taxableCapitalGain', 'Taxable capital gain', netGain * rs.cgt.inclusion, cgBasis);
    // Retirement fund contributions (s11F)
    const contrib = r2(tot('s11f') + cfS11f);
    const base27 = Math.max(emp, beforeRf + tcg);
    const lim = { cap: rs.s11f.cap, pct: r2(rs.s11f.rate * base27), ti: Math.max(0, beforeRf) };
    const d11f = Math.min(contrib, lim.cap, lim.pct, lim.ti);
    put('s11f', 'Less: retirement fund contributions (s11F)', -d11f,
      contrib ? 'Lowest of ' + rand(lim.cap) + ', ' + pct(rs.s11f.rate) + ' of ' + rand(base27) + ' (' + rand(lim.pct) + ') and ' + rand(lim.ti) + '; contributions ' + rand(contrib) : 'No contributions', ids('s11f'));
    // Donations (s18A)
    const before18a = r2(beforeRf - d11f + tcg);
    const don = r2(tot('s18a') + cfS18a);
    const lim18a = r2(Math.max(0, rs.s18a.rate * before18a));
    const d18a = Math.min(don, lim18a);
    put('s18a', 'Less: donations (s18A)', -d18a, don ? 'Up to ' + pct(rs.s18a.rate) + ' of ' + rand(before18a) + ' (' + rand(lim18a) + '); donated ' + rand(don) : 'No donations', ids('s18a'));
    const tiRaw = r2(before18a - d18a);
    const ti = put('taxableIncome', 'Taxable income', Math.max(0, tiRaw), tiRaw < 0 ? 'Assessed loss of ' + rand(-tiRaw) + ' carried forward' : '');
    // Tax
    const row = ti > 0 ? rs.brackets.slice().reverse().find((b) => ti > b[0]) : rs.brackets[0];
    const nt = put('normalTax', 'Normal tax', bracketTax(rs, ti), ti > 0 ? rand(row[2]) + ' + ' + pct(row[1]) + ' of the amount above ' + rand(row[0]) : 'No taxable income');
    const rebFull = rs.rebates.primary + (senior ? rs.rebates.secondary : 0) + (over75 ? rs.rebates.tertiary : 0);
    const reb = Math.min(rebFull, nt);
    put('rebates', 'Less: rebates', -reb, 'Primary ' + rand(rs.rebates.primary) + (senior ? ' + secondary ' + rand(rs.rebates.secondary) : '') + (over75 ? ' + tertiary ' + rand(rs.rebates.tertiary) : '') +
      ' (age ' + prof.age + ' on ' + prof.yearEnd + ')' + (reb < rebFull ? '; limited to the normal tax' : ''));
    let left = r2(nt - reb);
    // Medical credits: s6A per month of membership (apportioned by the share of the fees paid), then s6B (truncated to the cent).
    const s6aFull = fees > 0 ? r2(periods.reduce((a, p) => a + mtcFor(rs, p.dependants) * p.months, 0)) : 0;
    const s6a = r2(s6aFull * share);
    const s6aUsed = Math.min(s6a, left); left = r2(left - s6aUsed);
    const seniorMed = senior || !!med.disability;
    const feesOver = seniorMed ? Math.max(0, fees - rs.s6b.multipleSenior * s6a) : Math.max(0, fees - rs.s6b.multiple * s6a);
    const s6b = seniorMed ? t2(rs.s6b.rateSenior * feesOver + rs.s6b.rateSenior * exp) : t2(rs.s6b.rate * Math.max(0, feesOver + exp - rs.s6b.floor * ti));
    const s6bUsed = Math.min(s6b, left); left = r2(left - s6bUsed);
    const per = periods.length === 1 ? rand(mtcFor(rs, periods[0].dependants)) + ' a month × ' + months + ' months'
      : periods.map((p) => rand(mtcFor(rs, p.dependants)) + ' × ' + p.months + ' months').join(' + ');
    put('s6a', 'Less: medical scheme fees tax credit (s6A)', -s6aUsed,
      fees > 0 && !months ? 'Fees recorded but no months of membership' : !fees ? 'No medical scheme fees'
        : per + (share < 1 ? ' × ' + pct(share) + ' share of the fees (s6A(3A))' : '') + (s6aUsed < s6a ? '; limited to the tax left' : ''), ids('fees'));
    const limitedNote = s6bUsed < s6b ? '; limited to the tax left' : '';
    put('s6b', 'Less: additional medical expenses tax credit (s6B)', -s6bUsed, seniorMed
      ? pct(rs.s6b.rateSenior) + ' × excess fees ' + rand(feesOver) + ' (fees ' + rand(fees) + ' − ' + rs.s6b.multipleSenior + ' × ' + rand(s6a) + ', not below nil) + ' + pct(rs.s6b.rateSenior) + ' × expenses ' + rand(exp) + (senior ? ' (65 or older)' : ' (disability)') + limitedNote
      : pct(rs.s6b.rate) + ' × (excess fees ' + rand(feesOver) + ' (fees ' + rand(fees) + ' − ' + rs.s6b.multiple + ' × ' + rand(s6a) + ', not below nil) + expenses ' + rand(exp) + ' − ' + pct(rs.s6b.floor) + ' × ' + rand(ti) + ', not below nil)' + limitedNote,
      ids('fees', 'expenses'));
    const credit = tot('credit'); const oc = Math.min(credit, left); left = r2(left - oc);
    put('otherCredits', 'Less: other credits (Tax Consultant’s decision)', -oc, credit ? (oc < credit ? 'Limited to the tax left' : 'Recorded by the Tax Consultant') : '', ids('credit'));
    const liability = put('liability', 'Tax after rebates and credits', left);
    const paye = put('paye', 'Less: PAYE', -tot('paye'), '', ids('paye'));
    const prov = put('provisional', 'Less: provisional tax paid', -tot('provisional'), '', ids('provisional'));
    const result = put('result', tot('paye') + tot('provisional') > liability ? 'Refund due' : 'Amount payable', liability + paye + prov, 'Positive: payable to SARS; negative: refund');
    const summary = { taxableIncome: ti, normalTax: nt, rebates: r2(reb), medicalCredits: r2(s6aUsed + s6bUsed), paye: tot('paye'), provisional: tot('provisional'), otherCredits: r2(oc), result };
    const schedules = {
      employment: { remuneration: emp, paye: tot('paye'), lines: ids('employment', 'paye') },
      interest: { gross: intGross, exempt: r2(intEx), taxable: r2(intGross - intEx), limit: exLimit, lines: ids('interest') },
      dividends: { exempt: tot('exempt'), lines: ids('exempt') },
      rental: { income: rentIn, expenses: rentOut, net: rental, lines: ids('rental', 'rentalCost') },
      cgt: { aggregate: agg, exclusion: excl, broughtForward: cfLoss, net: netGain, inclusion: rs.cgt.inclusion, taxable: tcg, lossCarried, lines: ids('cgt') },
      retirement: { contributions: contrib, limits: lim, deduction: r2(d11f), carriedForward: r2(contrib - d11f), lines: ids('s11f') },
      donations: { donated: don, limit: lim18a, deduction: r2(d18a), carriedForward: r2(don - d18a), lines: ids('s18a') },
      medical: { months, periods: periods.map((p) => ({ months: p.months, dependants: p.dependants })), share, disability: !!med.disability, senior: seniorMed,
        fees, s6a, expenses: exp, s6b, s6aUsed: r2(s6aUsed), s6bUsed: r2(s6bUsed), lines: ids('fees', 'expenses') },
      assessedLoss: tiRaw < 0 ? r2(-tiRaw) : 0,
      judgement: used.filter((l) => FIELDS[l.field].judgement).map((l) => ({ line: l.id, field: l.field, amount: r2(l.amount), decided: l.decided }))
        .concat(pending.filter((p) => p.field).map((p) => ({ line: p.line, field: p.field, amount: p.amount, decided: null }))),
    };
    return { ruleset: rs.version, year: rs.year, summary, lines, pending, errors, wrongYear, profile: prof, schedules, used };
  }

  // The ITR12 draft: what the firm declares (SARS assesses the tax). One entry per calculator field with its source lines.
  function itr12Of(c, cl, r, inputs) {
    const decl = Object.create(null); const raw = Object.create(null);
    r.used.forEach((l) => {
      const f = FIELDS[l.field];
      const e = decl[l.field] || (decl[l.field] = { label: f.label, category: f.cat, amount: 0, lines: [] });
      raw[l.field] = (raw[l.field] || 0) + l.amount; e.amount = r2(raw[l.field]); e.lines.push(l.id);
    });
    const med = (inputs && inputs.medical) || {};
    const periods = Array.isArray(med.periods) && med.periods.length ? med.periods : [{ months: med.months || 0, dependants: med.dependants || 0 }];
    return { taxRef: cl ? cl.taxRef : null, year: c.year, declared: Object.assign({}, decl),
      medical: { months: periods.reduce((a, p) => a + (p.months || 0), 0), periods: periods.map((p) => ({ months: p.months || 0, dependants: p.dependants || 0 })),
        share: med.share == null ? 1 : med.share, disability: !!med.disability } };
  }

  // Documents ↔ extracted values ↔ calculation ↔ ITR12. Issues fail the reconciliation (PRE-01 at G08).
  function reconcile(c, r, itr12) {
    const issues = [];
    const lines = (c.inputs && Array.isArray(c.inputs.lines)) ? c.inputs.lines : [];
    lines.forEach((l) => {
      if (!l || typeof l !== 'object') return;
      const f = fieldOf(l.field); if (!f) return;
      if (l.docId) {
        const d = (c.docs || []).find((x) => x.id === l.docId);
        if (!d) issues.push(l.id + ' (' + f.label + ') cites document ' + l.docId + ', which is not on the case');
        else if (d.status !== 'validated') issues.push(l.id + ' (' + f.label + ') comes from ' + d.name + ', which is ' + d.status);
        else if (!d.kind) issues.push(l.id + ' (' + f.label + ') comes from ' + d.name + ', which could not be classified');
        else if (f.kinds && !f.kinds.includes(d.kind)) issues.push(l.id + ': ' + f.label + ' cannot come from ' + d.name);
      } else if (!f.sars) issues.push(l.id + ' (' + f.label + ') has no source document');
    });
    const cited = new Set(lines.filter((l) => l && typeof l === 'object').map((l) => l.docId).filter(Boolean));
    (c.docs || []).filter((d) => d.status === 'validated' && FEEDS.includes(d.kind) && !cited.has(d.id))
      .forEach((d) => issues.push(d.name + ' has no extracted values in the calculation'));
    // The ITR12 must declare exactly the values and the medical membership the calculation used.
    Object.keys(FIELDS).forEach((k) => {
      const want = r2(r.used.filter((l) => l.field === k).reduce((a, l) => a + l.amount, 0));
      const got = itr12.declared[k] ? itr12.declared[k].amount : 0;
      if (Math.abs(want - got) > 0.005) issues.push('The ITR12 declares ' + rand(got) + ' for ' + FIELDS[k].label + '; the calculation used ' + rand(want));
    });
    const m = r.schedules.medical; const im = itr12.medical;
    if (im.months !== m.months || im.share !== m.share || im.disability !== m.disability || JSON.stringify(im.periods) !== JSON.stringify(m.periods)) {
      issues.push('The ITR12 medical scheme membership differs from the calculation');
    }
    return { ok: !issues.length, issues };
  }

  // The full calculation pack for a case: { calc, schedules, itr12, recon }, ready for ENGINE.change().
  function forCase(c, version) {
    const v = version || (typeof S !== 'undefined' && S && S.rulesetVersion) || RULESET.version;
    const rs = rulesetOf(v);
    const year = Number.isInteger(c.year) ? c.year : null;
    const cl = (typeof S !== 'undefined' && S && S.clients ? S.clients : []).find((x) => x.id === c.clientId) || null;
    const prof = profileOf(cl, year, c.inputs);
    const r = compute(c.inputs, prof, rs, v);
    const itr12 = itr12Of(c, cl, r, c.inputs);
    const recon = r.schedules ? reconcile(c, r, itr12) : { ok: false, issues: r.errors.concat(r.pending.filter((p) => !p.field).map((p) => p.label)) };
    // Year-on-year change in taxable income (TAX-05 when it is material and unexplained); only for a calculation that ran.
    const prior = c.inputs && c.inputs.prior; const pol = (typeof S !== 'undefined' && S && S.policy && S.policy.materiality) || { amount: 1000, ratio: 0.2 };
    let variance = null;
    if (r.schedules && !r.errors.length && prior && typeof prior.taxableIncome === 'number' && isFinite(prior.taxableIncome)) {
      const diff = r2(r.summary.taxableIncome - prior.taxableIncome);
      const ratio = prior.taxableIncome ? Math.abs(diff) / Math.abs(prior.taxableIncome) : (diff ? 1 : 0);
      variance = { prior: prior.taxableIncome, current: r.summary.taxableIncome, diff, ratio: Math.round(ratio * 10000) / 10000, material: Math.abs(diff) > pol.amount && ratio > pol.ratio };
    }
    const calc = { ruleset: r.ruleset, year: r.year, age: prof.age, summary: r.summary, lines: r.lines, pending: r.pending, errors: r.errors, wrongYear: r.wrongYear, variance };
    return { calc, schedules: r.schedules, itr12, recon };
  }

  // Lineage rows for the calculation pack: document → extracted value → category → calculator field.
  function lineage(c) {
    const lines = (c.inputs && Array.isArray(c.inputs.lines)) ? c.inputs.lines : [];
    return lines.filter((l) => l && typeof l === 'object').map((l) => {
      const f = fieldOf(l.field) || {}; const d = l.docId ? (c.docs || []).find((x) => x.id === l.docId) : null;
      return { line: l.id, doc: d ? d.id : null, file: d ? d.name : (f.sars ? 'SARS statement of account' : null), ref: l.ref || '', label: l.label || f.label || l.field,
        amount: l.amount, category: f.cat || '?', field: l.field, judgement: f.judgement || null, decided: l.decided || null };
    });
  }

  return { FIELDS, FEEDS, fieldOf, rulesetOf, r2, t2, rand, bracketTax, threshold, dobOf, yearEnd, ageOn, profileOf, compute, forCase, lineage };
})();
