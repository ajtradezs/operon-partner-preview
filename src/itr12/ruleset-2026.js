/* Tax rulesets for individuals. Every value names its sources (RULESET_SRC) and the date it was checked against them.
   2026.1 is the approved ruleset for the 2026 year of assessment (1 March 2025 to 28 February 2026).
   2027.1 holds the 2027 values; the preview loads it only to demonstrate a wrong-year configuration (TAX-06).
   The tax thresholds are not stored: CALC.threshold() derives them from the brackets and rebates, and tests/test_calc.py
   checks the result against the thresholds SARS publishes. */
const RULESET_SRC = {
  rates: { title: 'SARS: Rates of tax for individuals', url: 'https://www.sars.gov.za/tax-rates/income-tax/rates-of-tax-for-individuals/' },
  mtc: { title: 'SARS: Medical tax credit rates', url: 'https://www.sars.gov.za/tax-rates/medical-tax-credit-rates/' },
  it07: { title: 'SARS Guide IT07: Determination of Medical Tax Credits (Issue 18)', url: 'https://www.sars.gov.za/wp-content/uploads/Ops/Guides/Legal-Pub-Guide-IT07-Guide-on-the-Determination-of-Medical-Tax-Credits.pdf' },
  guide25: { title: 'Budget 2025 Tax Guide (National Treasury and SARS)', url: 'https://archive.treasury.gov.za/documents/National%20Budget/2025Mar/sars/Budget%202025%20Tax%20Guide.pdf' },
  guide26: { title: 'Budget 2026 Tax Guide (National Treasury and SARS)', url: 'https://archive.treasury.gov.za/documents/national%20budget/2026/sars/Budget%202026%20Tax%20guide.pdf' },
  cgtExclusion: { title: 'SARS: Capital gains tax, annual exclusion', url: 'https://www.sars.gov.za/types-of-tax/capital-gains-tax/proceeds/calculation-of-taxable-capital-gains-and-assessed-capital-losses/annual-exclusion/' },
  cgtInclusion: { title: 'SARS: Capital gains tax, inclusion rate', url: 'https://www.sars.gov.za/types-of-tax/capital-gains-tax/proceeds/calculation-of-taxable-capital-gains-and-assessed-capital-losses/inclusion-rate/' },
  cgt02: { title: 'SARS Guide CGT02: Basic Guide to Capital Gains Tax for Individuals (Issue 13)', url: 'https://www.sars.gov.za/wp-content/uploads/Ops/Guides/Legal-Pub-Guide-CGT02-ABC-Guide-on-CGT-for-Individuals.pdf' },
  faqCgt: { title: 'SARS FAQ: the effect of CGT on the donations, medical and retirement fund deductions', url: 'https://www.sars.gov.za/faq/faq-what-will-the-effect-of-cgt-be-when-calculating-the-deduction-for-donations-medical-and-retirement-fund-contributions/' },
  // The Act's own text, for the rules the guides only summarise (consolidated text published by Acts Online).
  actS11f: { title: 'Income Tax Act 58 of 1962, s11F (the three limits in s11F(2) and the carry-forward in s11F(3))', url: 'https://api.acts.co.za/income-tax-act-1962/11f__deduction_in_respect_of_c.php' },
  actS18a: { title: 'Income Tax Act 58 of 1962, s18A(1) (the 10% limit and the carry-forward)', url: 'https://api.acts.co.za/income-tax-act-1962/18a__deduction_of_donations_to_certain_public_benefit_organisations.php' },
  act8: { title: 'Income Tax Act 58 of 1962, Eighth Schedule Part II (annual exclusion, aggregate gain or loss, inclusion rate in para 10(1)(a))', url: 'https://api.acts.co.za/income-tax-act-1962/sch8_part_ii__taxable_capital_gains_and_assessed_capital_losses.php' },
  // The 2027 s11F cap and CGT exclusions are announced amounts, in the Rates and Monetary Amounts Bill introduced on 21 October 2026.
  ratesBill26: { title: 'Rates and Monetary Amounts and Amendment of Revenue Laws Bill [B34-2026]', url: 'https://www.parliament.gov.za/storage/app/media/Bills/2026/B34-2026_Rates_and_Monetary_Amounts.pdf' },
};

const RULESETS = (() => {
  const freeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') freeze(v); }); return Object.freeze(o); };
  // Brackets: [taxable income above, rate on the amount above it, tax on the amount up to it], as SARS publishes them.
  const r2026 = {
    version: '2026.1', year: 2026, period: '1 March 2025 to 28 February 2026', yearEnd: '2026-02-28', checked: '2026-11-09',
    brackets: [[0, 0.18, 0], [237100, 0.26, 42678], [370500, 0.31, 77362], [512800, 0.36, 121475], [673000, 0.39, 179147], [857900, 0.41, 251258], [1817000, 0.45, 644489]],
    rebates: { primary: 17235, secondary: 9444, tertiary: 3145 },             // secondary from age 65, tertiary from 75 (age on the last day of the year)
    mtc: { main: 364, first: 364, additional: 246 },                           // s6A, per month
    s6b: { rate: 0.25, rateSenior: 0.333, multiple: 4, multipleSenior: 3, floor: 0.075 },  // s6B(3); "senior" = 65 or older, or a disability
    interestExemption: { under65: 23800, over65: 34500 },                     // s10(1)(i), local interest only
    s11f: { rate: 0.275, cap: 350000 },
    cgt: { exclusion: 40000, deathExclusion: 300000, inclusion: 0.4 },  // the death exclusion is recorded but unused: deceased estates go to the consultant (AI-05)
    s18a: { rate: 0.1 },
    src: {
      brackets: ['rates', 'guide25'], rebates: ['rates', 'guide25'], mtc: ['mtc', 'it07', 'guide25'], s6b: ['it07'],
      interestExemption: ['guide25'], s11f: ['actS11f', 'faqCgt', 'guide25'], cgt: ['cgtExclusion', 'act8', 'guide25'], s18a: ['actS18a', 'guide25', 'faqCgt'],
    },
  };
  const r2027 = {
    version: '2027.1', year: 2027, period: '1 March 2026 to 28 February 2027', yearEnd: '2027-02-28', checked: '2026-11-09',
    brackets: [[0, 0.18, 0], [245100, 0.26, 44118], [383100, 0.31, 79998], [530200, 0.36, 125599], [695800, 0.39, 185215], [887000, 0.41, 259783], [1878600, 0.45, 666339]],
    rebates: { primary: 17820, secondary: 9765, tertiary: 3249 },
    mtc: { main: 376, first: 376, additional: 254 },
    s6b: { rate: 0.25, rateSenior: 0.333, multiple: 4, multipleSenior: 3, floor: 0.075 },
    interestExemption: { under65: 23800, over65: 34500 },
    s11f: { rate: 0.275, cap: 430000 },
    cgt: { exclusion: 50000, deathExclusion: 440000, inclusion: 0.4 },
    s18a: { rate: 0.1 },
    src: {
      brackets: ['rates', 'guide26'], rebates: ['rates', 'guide26'], mtc: ['mtc', 'guide26'], s6b: ['it07'],
      interestExemption: ['guide26'], s11f: ['actS11f', 'guide26', 'ratesBill26'], cgt: ['guide26', 'ratesBill26', 'act8'], s18a: ['actS18a', 'guide26'],
    },
  };
  return freeze({ '2026.1': r2026, '2027.1': r2027 });
})();
// The approved ruleset for the 2026 filing season. The engine starts S.rulesetVersion from RULESET.version.
const RULESET = RULESETS['2026.1'];
