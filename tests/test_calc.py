"""The tax rulesets (src/itr12/ruleset-2026.js) and the ITR12 calculator (src/itr12/calc.js), plus the engine's use of them.

Expected values are typed here from the sources, not read from ruleset-2026.js:
- 2026 (1 March 2025 to 28 February 2026): SARS "Rates of tax for individuals", the SARS medical tax credit rates page, SARS Guide
  IT07, and the Budget 2025 Tax Guide (National Treasury and SARS).
- 2027 (1 March 2026 to 28 February 2027): the same SARS pages and the Budget 2026 Tax Guide.
The worked examples were calculated by hand from the Income Tax Act (s6, s6A, s6B, s10(1)(i), s11F, s18A, s26A and the Eighth
Schedule); the workings are in each test's docstring.
"""
import pytest

TZ = "Africa/Johannesburg"

# ---------------------------------------------------------------------------------------------------------------------------
# Values as SARS publishes them
# ---------------------------------------------------------------------------------------------------------------------------
# [taxable income above, rate, tax up to that amount]
BRACKETS = {
    "2026.1": [[0, 0.18, 0], [237100, 0.26, 42678], [370500, 0.31, 77362], [512800, 0.36, 121475], [673000, 0.39, 179147],
               [857900, 0.41, 251258], [1817000, 0.45, 644489]],
    "2027.1": [[0, 0.18, 0], [245100, 0.26, 44118], [383100, 0.31, 79998], [530200, 0.36, 125599], [695800, 0.39, 185215],
               [887000, 0.41, 259783], [1878600, 0.45, 666339]],
}
REBATES = {"2026.1": {"primary": 17235, "secondary": 9444, "tertiary": 3145},
           "2027.1": {"primary": 17820, "secondary": 9765, "tertiary": 3249}}
THRESHOLDS = {"2026.1": {40: 95750, 65: 148217, 75: 165689}, "2027.1": {40: 99000, 65: 153250, 75: 171300}}
MTC = {"2026.1": {"main": 364, "first": 364, "additional": 246}, "2027.1": {"main": 376, "first": 376, "additional": 254}}
INTEREST = {"2026.1": {"under65": 23800, "over65": 34500}, "2027.1": {"under65": 23800, "over65": 34500}}
S11F = {"2026.1": {"rate": 0.275, "cap": 350000}, "2027.1": {"rate": 0.275, "cap": 430000}}
CGT = {"2026.1": {"exclusion": 40000, "deathExclusion": 300000, "inclusion": 0.4},
       "2027.1": {"exclusion": 50000, "deathExclusion": 440000, "inclusion": 0.4}}
S6B = {"rate": 0.25, "rateSenior": 0.333, "multiple": 4, "multipleSenior": 3, "floor": 0.075}
SUMMARY_KEYS = ["taxableIncome", "normalTax", "rebates", "medicalCredits", "paye", "provisional", "otherCredits", "result"]


@pytest.fixture(scope="module")
def page(browser, site):
    ctx = browser.new_context(timezone_id=TZ)
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.goto(site)
    pg.wait_for_function("typeof CALC !== 'undefined' && typeof ENGINE !== 'undefined' && typeof S !== 'undefined' && !!S")
    pg.evaluate("() => { DEMO.cases = false; }")
    yield pg
    ctx.close()


def ev(page, body, arg=None):
    """Run `body` (a JS function body; `arg` and the actors tc, ad, ai, sys, pp are in scope) on a freshly seeded state."""
    js = ("(arg) => { TICKERS.splice(0); seed();"
          " const tc = ACTOR.as('Tax Consultant', 'TC1'), ad = ACTOR.as('Administrator', 'AD1'), ai = ACTOR.ai(), sys = ACTOR.system(),"
          " pp = ACTOR.platform('Platform Product Owner');"
          " let n = 0; const mk = (o, co) => { n += 1; return ENGINE.newCase(ENGINE.newClient(Object.assign({ name: 'Calc Client ' + n, taxRef: String(9300000000 + n) }, o || {})), co || {}); };"
          " const codes = (c) => ENGINE.exOf(c).map((x) => x.code); const open = (c) => ENGINE.exOf(c).filter(ENGINE.isOpen).map((x) => x.code);\n"
          + body + "\n}")
    return page.evaluate(js, arg)


def compute(page, inputs, age, version="2026.1", disability=False, year=2026):
    return page.evaluate("""(a) => { const r = CALC.compute(a.inputs, { year: a.year, yearEnd: CALC.yearEnd(a.year), age: a.age, disability: a.disability },
        RULESETS[a.version], a.version); return { summary: r.summary, errors: r.errors, pending: r.pending, wrongYear: r.wrongYear,
        schedules: r.schedules, lines: r.lines }; }""",
                         {"inputs": inputs, "age": age, "version": version, "disability": disability, "year": year})


def L(i, field, amount, **kw):
    return dict({"id": "L%d" % i, "field": field, "amount": amount}, **kw)


def summary(**kw):
    s = dict.fromkeys(SUMMARY_KEYS, 0)
    s.update(kw)
    return s


# ---------------------------------------------------------------------------------------------------------------------------
# The rulesets
# ---------------------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("version", ["2026.1", "2027.1"])
def test_ruleset_values_match_sars(page, version):
    rs = page.evaluate("v => RULESETS[v]", version)
    assert rs["version"] == version and rs["year"] == int(version[:4])
    assert rs["brackets"] == BRACKETS[version]
    assert rs["rebates"] == REBATES[version]
    assert rs["mtc"] == MTC[version]
    assert rs["interestExemption"] == INTEREST[version]
    assert rs["s11f"] == S11F[version]
    assert rs["cgt"] == CGT[version]
    assert rs["s18a"] == {"rate": 0.1}
    assert rs["s6b"] == S6B
    assert rs["yearEnd"] == "%s-02-28" % version[:4]


def test_every_value_group_cites_a_primary_source(page):
    r = page.evaluate("""() => ({ src: RULESET_SRC, sets: Object.values(RULESETS).map((rs) => ({ v: rs.version, checked: rs.checked, src: rs.src,
        groups: Object.keys(rs).filter((k) => !['version', 'year', 'period', 'yearEnd', 'checked', 'src'].includes(k)) })),
        current: RULESET.version, frozen: Object.isFrozen(RULESETS['2026.1']) && Object.isFrozen(RULESETS['2026.1'].brackets[0]) })""")
    for key, s in r["src"].items():
        assert s["url"].startswith(("https://www.sars.gov.za/", "https://archive.treasury.gov.za/", "https://api.acts.co.za/income-tax-act-1962/",
                                    "https://www.parliament.gov.za/storage/app/media/Bills/2026/")), (key, s["url"])
        assert s["title"], key
    for rs in r["sets"]:
        assert rs["checked"] == "2026-11-09", rs["v"]
        assert sorted(rs["groups"]) == sorted(rs["src"]), ("every value group names its sources", rs["v"])
        for g, keys in rs["src"].items():
            assert keys and all(k in r["src"] for k in keys), (rs["v"], g, keys)
    assert r["current"] == "2026.1", "The 2026 filing season uses the 2026 ruleset"
    assert r["frozen"], "Rulesets cannot be changed at run time"


@pytest.mark.parametrize("version", ["2026.1", "2027.1"])
def test_bracket_bases_add_up(version):
    rows = BRACKETS[version]
    for (lo, rate, base), (hi, _, nxt) in zip(rows, rows[1:]):
        assert round(base + rate * (hi - lo), 2) == nxt, (version, lo, hi)


@pytest.mark.parametrize("version", ["2026.1", "2027.1"])
def test_thresholds_are_derived_and_match_sars(page, version):
    got = page.evaluate("v => [40, 64, 65, 74, 75, 90].map((a) => CALC.threshold(RULESETS[v], a))", version)
    t = THRESHOLDS[version]
    assert got == [t[40], t[40], t[65], t[65], t[75], t[75]]
    src = page.evaluate("() => Array.from(document.scripts).map((s) => s.textContent).join(' ')")
    assert "95750" not in src and "148217" not in src and "165689" not in src, "Thresholds are derived, not stored"


def test_bracket_tax_at_the_boundaries(page):
    got = page.evaluate("() => [0, 1, 237100, 237101, 370500, 1817000, 1817001, 2000000].map((t) => CALC.bracketTax(RULESETS['2026.1'], t))")
    assert got == [0, 0.18, 42678, 42678.26, 77362, 644489, 644489.45, 726839]


# ---------------------------------------------------------------------------------------------------------------------------
# Worked examples (2026)
# ---------------------------------------------------------------------------------------------------------------------------

def test_example_under_65_with_medical(page):
    """Age 46. Taxable income 480,000: 77,362 + 31% x 109,500 = 111,307. Primary rebate 17,235.
    s6A: (364 + 364 + 246) x 12 = 11,688. s6B: 25% x max(0, (48,000 - 4 x 11,688) + 12,000 - 7.5% x 480,000) = 25% x max(0, -22,752) = 0.
    111,307 - 17,235 - 11,688 - 82,000 PAYE = 384 payable."""
    r = compute(page, {"lines": [L(1, "remuneration", 480000), L(2, "paye", 82000), L(3, "medicalFees", 48000), L(4, "medicalExpenses", 12000)],
                       "medical": {"months": 12, "dependants": 2}}, 46)
    assert r["errors"] == [] and r["pending"] == []
    assert r["summary"] == summary(taxableIncome=480000, normalTax=111307, rebates=17235, medicalCredits=11688, paye=82000, result=384)


def test_example_over_65_with_interest_and_medical(page):
    """Age 67. Interest 50,000 less the 65+ exemption 34,500 = 15,500. Taxable income 315,500: 42,678 + 26% x 78,400 = 63,062.
    Rebates 17,235 + 9,444 = 26,679. s6A (364 + 364) x 12 = 8,736. s6B (65+): 33.3% x (60,000 - 3 x 8,736) + 33.3% x 20,000
    = 11,252.736 + 6,660 = 17,912.736, truncated to 17,912.73 as in SARS's IT07 examples.
    63,062 - 26,679 - 8,736 - 17,912.73 - 20,000 = -10,265.73 (refund)."""
    r = compute(page, {"lines": [L(1, "remuneration", 300000), L(2, "interest", 50000), L(3, "paye", 20000), L(4, "medicalFees", 60000),
                                 L(5, "medicalExpenses", 20000)], "medical": {"months": 12, "dependants": 1}}, 67)
    assert r["summary"] == summary(taxableIncome=315500, normalTax=63062, rebates=26679, medicalCredits=26648.73, paye=20000, result=-10265.73)
    assert r["schedules"]["interest"] == {"gross": 50000, "exempt": 34500, "taxable": 15500, "limit": 34500, "lines": ["L2"]}


def test_example_retirement_annuity_and_donations_both_limited(page):
    """Age 46, remuneration 900,000. s11F: lowest of 350,000, 27.5% x 900,000 = 247,500 and 900,000 -> 247,500 (52,500 carried).
    s18A: 10% x (900,000 - 247,500) = 65,250 of 120,000 donated (54,750 carried). Taxable income 587,250:
    121,475 + 36% x 74,450 = 148,277. Less 17,235 and PAYE 200,000 = -68,958."""
    r = compute(page, {"lines": [L(1, "remuneration", 900000), L(2, "ra", 300000), L(3, "donations", 120000), L(4, "paye", 200000)]}, 46)
    assert r["summary"] == summary(taxableIncome=587250, normalTax=148277, rebates=17235, paye=200000, result=-68958)
    assert r["schedules"]["retirement"]["deduction"] == 247500 and r["schedules"]["retirement"]["carriedForward"] == 52500
    assert r["schedules"]["donations"]["deduction"] == 65250 and r["schedules"]["donations"]["carriedForward"] == 54750


def test_example_capital_gains(page):
    """Age 46. Gains 150,000 - 10,000 = 140,000 less the 40,000 exclusion = 100,000 x 40% = 40,000 taxable.
    s11F: 50,000 within the limits (27.5% x max(400,000, 440,000) = 121,000). Taxable income 400,000 - 50,000 + 40,000 = 390,000:
    77,362 + 31% x 19,500 = 83,407. Less 17,235 and PAYE 60,000 = 6,172 payable."""
    r = compute(page, {"lines": [L(1, "remuneration", 400000), L(2, "capitalGain", 150000), L(3, "capitalGain", -10000), L(4, "ra", 50000),
                                 L(5, "paye", 60000)]}, 46)
    assert r["summary"] == summary(taxableIncome=390000, normalTax=83407, rebates=17235, paye=60000, result=6172)
    assert r["schedules"]["cgt"]["taxable"] == 40000 and r["schedules"]["retirement"]["limits"]["pct"] == 121000


def test_example_s11f_limited_to_income_excluding_capital_gains(page):
    """Age 46. Interest 30,000 - 23,800 = 6,200. Gain 540,000 - 40,000 = 500,000 x 40% = 200,000. s11F: lowest of 350,000,
    27.5% x 206,200 = 56,705 and 6,200 (income before the capital gain) -> 6,200 (93,800 carried). Taxable income 200,000:
    18% = 36,000 - 17,235 - 15,000 provisional = 3,765 payable."""
    r = compute(page, {"lines": [L(1, "interest", 30000), L(2, "capitalGain", 540000), L(3, "ra", 100000), L(4, "provisionalPaid", 15000)]}, 46)
    assert r["summary"] == summary(taxableIncome=200000, normalTax=36000, rebates=17235, provisional=15000, result=3765)
    assert r["schedules"]["retirement"]["deduction"] == 6200 and r["schedules"]["retirement"]["carriedForward"] == 93800


def test_capital_loss_is_reduced_by_the_exclusion_and_carried(page):
    """Aggregate -70,000 + 40,000 exclusion = -30,000 carried forward; nothing included."""
    r = compute(page, {"lines": [L(1, "remuneration", 300000), L(2, "capitalGain", -80000), L(3, "capitalGain", 10000)]}, 50)
    assert r["schedules"]["cgt"]["taxable"] == 0 and r["schedules"]["cgt"]["lossCarried"] == 30000
    assert r["summary"]["taxableIncome"] == 300000


def test_rebates_and_credits_never_exceed_the_tax(page):
    """Taxable income 90,000 (below the 95,750 threshold): tax 16,200, rebate limited to 16,200, medical credits 0, PAYE refunded."""
    r = compute(page, {"lines": [L(1, "remuneration", 90000), L(2, "paye", 1000), L(3, "medicalFees", 24000)], "medical": {"months": 12, "dependants": 0}}, 30)
    assert r["summary"] == summary(taxableIncome=90000, normalTax=16200, rebates=16200, paye=1000, result=-1000)


def test_age_is_taken_on_the_last_day_of_february(page):
    """Born 1 March 1961: 64 on 28 Feb 2026, so under-65 values apply (exemption 23,800; primary rebate only)."""
    r = page.evaluate("""() => ({ dob: CALC.dobOf({ idNo: '6103015009087' }, 2026), age: CALC.ageOn('1961-03-01', '2026-02-28'),
      age75: CALC.ageOn('1951-02-28', '2026-02-28'), y2k: CALC.dobOf({ idNo: '0502285009082' }, 2026), bad: CALC.dobOf({ idNo: '8013405009088' }, 2026),
      dobWins: CALC.dobOf({ idNo: '8001015009088', dob: '1950-06-30' }, 2026), leap: CALC.yearEnd(2028), def: CALC.profileOf({ idNo: '8001015009088' }, 2026, null).age })""")
    assert r == {"dob": "1961-03-01", "age": 64, "age75": 75, "y2k": "2005-02-28", "bad": None, "dobWins": "1950-06-30", "leap": "2028-02-29", "def": 46}


def test_summary_always_adds_up(page):
    bad = page.evaluate("""() => {
      const out = []; let seed = 7; const rnd = (n) => { seed = (seed * 48271) % 2147483647; return seed % n; };
      const F = ['remuneration', 'medicalFringe', 'paye', 'provisionalPaid', 'interest', 'rentalIncome', 'rentalExpenses', 'capitalGain', 'ra', 'retirementFund', 'medicalFees', 'medicalExpenses', 'donations'];
      for (let i = 0; i < 400; i++) {
        const lines = []; const k = 1 + rnd(8);
        for (let j = 0; j < k; j++) { const f = F[rnd(F.length)]; lines.push({ id: 'L' + j, field: f, amount: (f === 'capitalGain' ? rnd(400000) - 150000 : rnd(900000)) + rnd(100) / 100 }); }
        const age = [30, 64, 65, 74, 75, 88][rnd(6)];
        const r = CALC.compute({ lines, medical: { months: rnd(13), dependants: rnd(4) } }, { year: 2026, yearEnd: '2026-02-28', age, disability: !!rnd(2) }, RULESETS['2026.1']);
        if (r.errors.length) continue;
        const s = r.summary; const sum = CALC.r2(s.normalTax - s.rebates - s.medicalCredits - s.otherCredits - s.paye - s.provisional);
        if (Math.abs(sum - s.result) > 0.001 || s.rebates > s.normalTax || s.rebates + s.medicalCredits + s.otherCredits > s.normalTax + 0.001 || s.taxableIncome < 0)
          out.push({ lines, age, s });
      }
      return out.slice(0, 3);
    }""")
    assert bad == []


def test_bad_inputs_are_validation_errors(page):
    r = compute(page, {"lines": [L(1, "remuneration", -5), L(2, "nonsense", 1), L(3, "paye", "12"), L(3, "interest", 1), L(4, "medicalFees", 100)],
                       "medical": {"months": 0, "dependants": 1.5}}, 40)
    e = " | ".join(r["errors"])
    for part in ["cannot be negative", "unknown calculator field", "is not a number", "used twice", "dependants must be a whole number",
                 "no months of membership"]:
        assert part in e, (part, e)


def test_judgement_items_wait_for_the_consultant(page):
    """Home office (TAX-02) and foreign income (AI-05) are left out until decided; a decided item counts."""
    r = compute(page, {"lines": [L(1, "remuneration", 400000), L(2, "homeOffice", 18000), L(3, "foreignIncome", 25000)]}, 46)
    assert [(p["line"], p["code"]) for p in r["pending"]] == [("L2", "TAX-02"), ("L3", "AI-05")]
    assert r["summary"]["taxableIncome"] == 400000
    d = compute(page, {"lines": [L(1, "remuneration", 400000), L(2, "homeOffice", 18000, decided={"by": "TC1", "rationale": "s23(m): dedicated study"})]}, 46)
    assert d["pending"] == [] and d["summary"]["taxableIncome"] == 382000


def test_wrong_year_ruleset_is_flagged(page):
    r = compute(page, {"lines": [L(1, "remuneration", 400000)]}, 46, version="2027.1")
    assert r["wrongYear"] is True and r["errors"] == []
    assert r["summary"]["normalTax"] == 85237, "2027 brackets: 79,998 + 31% x 16,900 = 85,237, the wrong year's tax"


# ---------------------------------------------------------------------------------------------------------------------------
# A case: lineage, reconciliation and the engine
# ---------------------------------------------------------------------------------------------------------------------------

LINES_A = """
  const irp5 = c.docs.find((d) => d.kind === 'irp5'), med = c.docs.find((d) => d.kind === 'medical');
  c.inputs = { lines: [
    { id: 'L1', docId: irp5.id, ref: 'IRP5 code 3601', field: 'remuneration', amount: 480000 },
    { id: 'L2', docId: irp5.id, ref: 'IRP5 code 4102', field: 'paye', amount: 82000 },
    { id: 'L3', docId: med.id, ref: 'Total contributions', field: 'medicalFees', amount: 48000 },
    { id: 'L4', docId: med.id, ref: 'Claims not paid by the scheme', field: 'medicalExpenses', amount: 12000 } ],
    medical: { months: 12, dependants: 2 } };
"""


def test_calculate_records_a_version_with_lineage(page):
    r = ev(page, """
      const c = mk({}, { items: ['irp5', 'medical'] }); ENGINE.drive(c, 'G05');
    """ + LINES_A + """
      const k = ENGINE.calculate(c, tc);
      return { ok: k.ok, n: c.versions.length, sum: c.calc.summary, ruleset: c.calc.ruleset, recon: c.recon, open: open(c),
        lineage: CALC.lineage(c).map((l) => [l.line, l.file, l.category, l.field]), rel: ENGINE.release(c, 'G05', tc).ok,
        itr12: Object.keys(c.itr12.declared), stub: !!c.calc.stub };
    """)
    assert r["ok"] and r["n"] == 1 and r["ruleset"] == "2026.1" and not r["stub"]
    assert r["sum"] == summary(taxableIncome=480000, normalTax=111307, rebates=17235, medicalCredits=11688, paye=82000, result=384)
    assert r["recon"] == {"ok": True, "issues": []}, r["recon"]
    assert r["lineage"][0] == ["L1", "IRP5_2026.pdf", "Employment income", "remuneration"]
    assert sorted(r["itr12"]) == ["medicalExpenses", "medicalFees", "paye", "remuneration"]
    assert r["rel"], ("G05 releases on a clean calculation", r["open"])


def test_reconciliation_finds_document_problems(page):
    r = ev(page, """
      const c = mk({}, { items: ['irp5', 'medical', 'it3b'] }); ENGINE.drive(c, 'G05');
    """ + LINES_A + """
      c.inputs.lines.push({ id: 'L5', docId: 'D999', field: 'interest', amount: 1000 }, { id: 'L6', field: 'donations', amount: 500 },
                          { id: 'L7', field: 'provisionalPaid', amount: 2000 });
      const k = CALC.forCase(c);
      return k.recon.issues;
    """)
    joined = " | ".join(r)
    assert "L5 (Local interest) cites document D999, which is not on the case" in joined
    assert "L6 (Donations with s18A receipts) has no source document" in joined
    assert "IT3b_interest_2026.pdf has no extracted values in the calculation" in joined
    assert "L7" not in joined, "Provisional tax paid comes from SARS's statement of account, not a document"


def test_judgement_item_raises_tax02_until_decided_and_rerun(page):
    r = ev(page, """
      const c = mk({}, { items: ['irp5', 'homeoffice'] }); ENGINE.drive(c, 'G05');
      const irp5 = c.docs.find((d) => d.kind === 'irp5'), ho = c.docs.find((d) => d.kind === 'homeoffice');
      c.inputs = { lines: [{ id: 'L1', docId: irp5.id, field: 'remuneration', amount: 400000 }, { id: 'L2', docId: ho.id, field: 'homeOffice', amount: 18000 }] };
      const o = {};
      ENGINE.calculate(c, ai); ENGINE.calculate(c, ai);
      const xs = ENGINE.exOf(c).filter((x) => x.code === 'TAX-02');
      o.raised = xs.map((x) => [x.calcRef, x.status]);
      o.blocked = ENGINE.canRelease(c, 'G05', tc).ok;
      o.early = ENGINE.resolve(xs[0], tc, { action: 'Documented' }).why;
      o.decideByAdmin = ENGINE.decideItem(c, 'L2', ad, { rationale: 'x' }).ok;
      o.noReason = ENGINE.decideItem(c, 'L2', tc, { rationale: ' ' }).ok;
      o.notJudgement = ENGINE.decideItem(c, 'L1', tc, { rationale: 'x' }).ok;
      o.decided = ENGINE.decideItem(c, 'L2', tc, { amount: 15000, rationale: 's23(m) and s11(a): a dedicated room used mainly for work' }).ok;
      o.beforeRerun = ENGINE.resolve(xs[0], tc, { action: 'Documented' }).why;
      ENGINE.calculate(c, tc);
      o.ti = c.calc.summary.taxableIncome;
      o.resolved = ENGINE.resolve(xs[0], tc, { action: 'Treatment, rationale and conclusion recorded on L2' }).ok;
      o.after = ENGINE.exOf(c).filter((x) => x.code === 'TAX-02').length;
      o.release = ENGINE.release(c, 'G05', tc).ok;
      return o;
    """)
    assert r["raised"] == [["L2", "assigned"]] or r["raised"] == [["L2", "raised"]], ("One TAX-02 per item, not one per run", r["raised"])
    assert r["blocked"] is False, "TAX-02 blocks G05"
    assert "Record the Tax Consultant’s amount and rationale for L2 first" in r["early"]
    assert not r["decideByAdmin"] and not r["noReason"] and not r["notJudgement"] and r["decided"]
    assert "Rerun the calculation with the decision on L2 first" in r["beforeRerun"]
    assert r["ti"] == 385000 and r["resolved"] and r["after"] == 1 and r["release"]


def test_variance_raises_tax05_once_per_figure(page):
    r = ev(page, """
      const c = mk({}, { items: ['irp5'] }); ENGINE.drive(c, 'G05');
      const irp5 = c.docs.find((d) => d.kind === 'irp5');
      c.inputs = { lines: [{ id: 'L1', docId: irp5.id, field: 'remuneration', amount: 480000 }], prior: { taxableIncome: 300000 } };
      ENGINE.calculate(c, ai);
      const x = ENGINE.exOf(c).find((y) => y.code === 'TAX-05');
      const res = ENGINE.resolve(x, tc, { action: 'New employer from 1 March 2025; salary increase confirmed by the contract' }).ok;
      ENGINE.calculate(c, tc); const same = codes(c).filter((k) => k === 'TAX-05').length;
      c.inputs.lines[0].amount = 520000; ENGINE.calculate(c, tc); const changed = codes(c).filter((k) => k === 'TAX-05').length;
      c.inputs.prior.taxableIncome = 515000; c.inputs.lines[0].amount = 530000; ENGINE.calculate(c, tc);
      const small = codes(c).filter((k) => k === 'TAX-05').length;
      return { note: x && x.note, res, same, changed, small };
    """)
    assert r["note"] and "60% change" in r["note"], r
    assert r["res"] and r["same"] == 1 and r["changed"] == 2 and r["small"] == 2, r


def test_validation_error_raises_tax01_and_blocks(page):
    r = ev(page, """
      const c = mk({}, { items: ['irp5'] }); ENGINE.drive(c, 'G05');
      const irp5 = c.docs.find((d) => d.kind === 'irp5');
      c.inputs = { lines: [{ id: 'L1', docId: irp5.id, field: 'remuneration', amount: -1 }] };
      ENGINE.calculate(c, ai);
      const x = ENGINE.exOf(c).find((y) => y.code === 'TAX-01');
      const early = ENGINE.resolve(x, tc, { action: 'Fixed' }).why;
      c.inputs.lines[0].amount = 1; ENGINE.calculate(c, tc);
      return { early, ok: ENGINE.resolve(x, tc, { action: 'Corrected the sign of L1 and reran' }).ok };
    """)
    assert "still fails validation" in r["early"] and r["ok"]


def test_wrong_year_ruleset_raises_tax06_and_ai07_and_clears_after_the_rerun(page):
    r = ev(page, """
      const c = mk({}, { items: ['irp5'] }); ENGINE.drive(c, 'G05');
      const irp5 = c.docs.find((d) => d.kind === 'irp5');
      c.inputs = { lines: [{ id: 'L1', docId: irp5.id, field: 'remuneration', amount: 400000 }] };
      ENGINE.calculate(c, tc);
      const o = {};
      o.unknown = ENGINE.rulesetChange(pp, { version: '2031.9' }).ok;
      o.byConsultant = ENGINE.rulesetChange(tc, { version: '2027.1' }).ok;
      o.change = ENGINE.rulesetChange(pp, { version: '2027.1' }).ok;
      o.open = open(c).filter((k) => ['TAX-06', 'AI-07'].includes(k)).sort();
      ENGINE.calculate(c, tc);
      o.calc = [c.calc.ruleset, c.calc.wrongYear, c.calc.summary.normalTax];
      const t6 = ENGINE.exOf(c).find((x) => x.code === 'TAX-06'), a7 = ENGINE.exOf(c).find((x) => x.code === 'AI-07');
      o.t6early = ENGINE.resolve(t6, tc, { action: 'x' }).why;
      ENGINE.rulesetChange(pp, { version: '2026.1' });
      o.t6norerun = ENGINE.resolve(t6, tc, { action: 'x' }).why;
      ENGINE.calculate(c, tc);
      o.t6 = ENGINE.resolve(t6, tc, { action: 'Ruleset 2026.1 restored; every affected case rerun' }).ok;
      o.a7 = ENGINE.exOf(c).filter((x) => x.code === 'AI-07' && ENGINE.isOpen(x)).map((x) => ENGINE.resolve(x, pp, { action: 'Impact assessed; calculation rerun on 2026.1' }).ok);
      o.final = [c.calc.ruleset, c.calc.wrongYear, c.calc.summary.normalTax];
      return o;
    """)
    assert r["unknown"] is False and r["byConsultant"] is False and r["change"] is True
    assert r["open"] == ["AI-07", "TAX-06"]
    assert r["calc"] == ["2027.1", True, 85237]
    assert "is for 2027, not 2026" in r["t6early"]
    assert "Rerun the calculation on ruleset 2026.1 first" in r["t6norerun"]
    assert r["t6"] and r["a7"] and all(r["a7"])
    assert r["final"] == ["2026.1", False, 86507]


def test_only_the_consultant_ai_or_system_calculate(page):
    r = ev(page, """
      const c = mk({}, { items: ['irp5'] }); ENGINE.drive(c, 'G05');
      c.inputs = { lines: [{ id: 'L1', docId: c.docs[0].id, field: 'remuneration', amount: 100000 }] };
      return { client: ENGINE.calculate(c, ACTOR.client(c.clientId)).ok, admin: ENGINE.calculate(c, ad).ok, ghost: ENGINE.calculate(c, ACTOR.as('Tax Consultant', 'NOPE')).ok,
        ai: ENGINE.calculate(c, ai).ok, sys: ENGINE.calculate(c, sys).ok, versions: c.versions.length };
    """)
    assert r == {"client": False, "admin": False, "ghost": False, "ai": True, "sys": True, "versions": 2}


def test_drive_uses_the_calculator_when_the_case_has_inputs(page):
    r = ev(page, """
      // No medical scheme: otherwise the questionnaire asks for a certificate, whose values the calculation must then use.
      const c = mk({}, { items: ['irp5'] }); ENGINE.drive(c, 'G05', { answers: { medical: false } });
      const doc = c.docs[0].id;
      c.inputs = { lines: [{ id: 'L1', docId: doc, field: 'remuneration', amount: 250000 }, { id: 'L2', docId: doc, field: 'paye', amount: 30000 }] };
      const d = ENGINE.drive(c, 'G13');
      const stub = mk(); ENGINE.drive(stub, 'G06');
      return { ok: d.ok, why: d.why, gate: ENGINE.currentGate(c), kind: c.docs[0].kind, sum: c.calc.summary, ita34: c.ita34 && c.ita34.recon, stub: stub.calc.stub, v: c.versions[0].reason };
    """)
    assert r["kind"] == "irp5" and r["v"] == "Calculation on ruleset 2026.1", r
    assert r["ok"] and r["gate"] == "G13", r["why"]
    # 250,000: 42,678 + 26% x 12,900 = 46,032 - 17,235 = 28,797 - 30,000 PAYE = -1,203
    assert r["sum"] == summary(taxableIncome=250000, normalTax=46032, rebates=17235, paye=30000, result=-1203)
    assert r["ita34"] == {"ok": True, "diffs": []}
    assert r["stub"] is True, "Cases without extracted values keep the test stub"


def test_zz_no_page_errors(page):
    assert page.errors == []
