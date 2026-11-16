"""Regression tests for the independent review of section 3 (16 Nov 2026): the medical-credit check (MED-1 to MED-4), the check of
the other rules and their sources (SO-1 to SO-4), the adversarial review of calc.js (ADV-01 to ADV-16) and of the engine's use of
it (ENG-1 to ENG-7). Each test pins the ruling on its finding.
"""
import pytest

from test_calc import L, compute, ev

TZ = "Africa/Johannesburg"


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


# ------------------------------------------------------------------------------------------------------------------- medical

def test_med1_s6a_is_apportioned_by_the_share_of_the_fees(page):
    """s6A(3A): half the fees paid by someone else -> half the credit. (364 + 364) x 12 = 8,736 x 50% = 4,368."""
    r = compute(page, {"lines": [L(1, "remuneration", 400000), L(2, "medicalFees", 30000)], "medical": {"months": 12, "dependants": 1, "share": 0.5}}, 40)
    assert r["schedules"]["medical"]["s6a"] == 4368 and r["summary"]["medicalCredits"] == 4368
    bad = compute(page, {"lines": [L(1, "remuneration", 1)], "medical": {"months": 12, "dependants": 0, "share": 1.5}}, 40)
    assert any("share of the medical scheme fees" in e for e in bad["errors"])


def test_med2_dependants_can_change_during_the_year(page):
    """6 months alone (364) and 6 months with a spouse (728): 2,184 + 4,368 = 6,552."""
    r = compute(page, {"lines": [L(1, "remuneration", 400000), L(2, "medicalFees", 30000)],
                       "medical": {"periods": [{"months": 6, "dependants": 0}, {"months": 6, "dependants": 1}]}}, 40)
    assert r["schedules"]["medical"]["s6a"] == 6552 and r["schedules"]["medical"]["months"] == 12
    s6a = next(l for l in r["lines"] if l["key"] == "s6a")
    assert "R364.00 × 6 months + R728.00 × 6 months" in s6a["basis"]
    over = compute(page, {"lines": [L(1, "remuneration", 1)], "medical": {"periods": [{"months": 8, "dependants": 0}, {"months": 6, "dependants": 1}]}}, 40)
    assert any("more than 12 months" in e for e in over["errors"])


def test_med3_s6b_is_truncated_to_the_cent(page):
    r = page.evaluate("() => [CALC.t2(17912.736), CALC.t2(0.019), CALC.t2(-5)]")
    assert r == [17912.73, 0.01, 0]


def test_med4_fees_label_says_which_fees_count(page):
    assert "taxed as a fringe benefit" in page.evaluate("() => CALC.FIELDS.medicalFees.label")


# ------------------------------------------------------------------------------------------------------------ rules, sources

def test_so1_so2_the_act_is_cited_for_the_inclusion_rate_and_the_s11f_limits(page):
    r = page.evaluate("() => ['2026.1', '2027.1'].map((v) => [RULESETS[v].src.cgt, RULESETS[v].src.s11f, RULESETS[v].src.s18a])")
    for cgt, s11f, s18a in r:
        assert "act8" in cgt and "actS11f" in s11f and "actS18a" in s18a
    assert "ratesBill26" in r[1][0] and "ratesBill26" in r[1][1], "The 2027 cap and exclusions are in the 2026 Rates Bill"


def test_so3_assessed_capital_loss_brought_forward(page):
    """Gain 100,000 - 40,000 = 60,000 against 70,000 brought forward: nothing taxable, 10,000 carried.
    Gain 200,000 - 40,000 = 160,000 - 30,000 = 130,000 x 40% = 52,000."""
    a = compute(page, {"lines": [L(1, "remuneration", 300000), L(2, "capitalGain", 100000)], "carried": {"capitalLoss": 70000}}, 50)
    assert a["schedules"]["cgt"]["taxable"] == 0 and a["schedules"]["cgt"]["lossCarried"] == 10000
    b = compute(page, {"lines": [L(1, "remuneration", 300000), L(2, "capitalGain", 200000)], "carried": {"capitalLoss": 30000}}, 50)
    assert b["schedules"]["cgt"]["taxable"] == 52000 and b["schedules"]["cgt"]["lossCarried"] == 0
    c = compute(page, {"lines": [L(1, "remuneration", 300000), L(2, "capitalGain", -50000)], "carried": {"capitalLoss": 5000}}, 50)
    assert c["schedules"]["cgt"]["lossCarried"] == 15000, "10,000 this year after the exclusion, plus 5,000 brought forward"


def test_so4_a_deceased_taxpayer_goes_to_the_consultant(page):
    r = ev(page, """
      const cl = ENGINE.newClient({ name: 'Late Client', taxRef: '9300000777' }); cl.deceased = true;
      const c = ENGINE.newCase(cl, { items: ['irp5'] }); ENGINE.drive(c, 'G05');
      ENGINE.setInputs(c, ai, { lines: [{ id: 'L1', docId: c.docs[0].id, field: 'remuneration', amount: 100000 }] });
      ENGINE.calculate(c, ai);
      return { pending: c.calc.pending.map((p) => [p.line, p.code]), sum: c.calc.summary.taxableIncome, ai05: ENGINE.exOf(c).filter((x) => x.code === 'AI-05').map((x) => x.calcRef) };
    """)
    assert r == {"pending": [["deceased", "AI-05"]], "sum": 0, "ai05": ["deceased"]}


# ------------------------------------------------------------------------------------------------------------------ calc.js

def test_adv01_object_prototype_names_are_unknown_fields(page):
    r = ev(page, """
      const out = {};
      for (const f of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
        out[f] = CALC.compute({ lines: [{ id: 'L1', field: f, amount: 5 }] }, { year: 2026, yearEnd: '2026-02-28', age: 40 }, RULESETS['2026.1']).errors.join('|');
      }
      const c = mk({}, { items: [] }); c.inputs = { lines: [{ id: 'L1', field: 'constructor', amount: 1 }] };
      let threw = null; try { CALC.forCase(c); } catch (e) { threw = e.message; }
      return { out, threw, proto: Object.prototype.amount === undefined, own: CALC.rulesetOf('constructor') };
    """)
    assert all("unknown calculator field" in v for v in r["out"].values()), r["out"]
    assert r["threw"] is None and r["proto"] and r["own"] is None


def test_adv02_amounts_are_whole_cents_and_itr12_sums_match(page):
    bad = compute(page, {"lines": [L(1, "remuneration", 100.005)]}, 40)
    assert any("whole number of cents" in e for e in bad["errors"])
    r = ev(page, """
      const c = mk({}, { items: ['irp5'] }); ENGINE.drive(c, 'G05', { answers: { medical: false } });
      const d = c.docs[0].id;
      c.inputs = { lines: [0.1, 0.2, 0.7, 1.15, 2.3].map((a, i) => ({ id: 'L' + (i + 1), docId: d, field: 'remuneration', amount: a })) };
      const k = CALC.forCase(c); return [k.recon, k.itr12.declared.remuneration.amount, k.calc.summary.taxableIncome];
    """)
    assert r == [{"ok": True, "issues": []}, 4.45, 4.45]


def test_adv03_no_variance_when_the_calculation_did_not_run(page):
    r = ev(page, """
      const c = mk({ idNo: '2001015009088' }, { items: [] });   // 2020 or 1920: the age cannot be settled from the ID
      c.inputs = { lines: [{ id: 'L1', field: 'remuneration', amount: 1 }], prior: { taxableIncome: 400000 } };
      const k = CALC.forCase(c); return { v: k.calc.variance, e: k.calc.errors };
    """)
    assert r["v"] is None and any("record the date of birth" in e for e in r["e"])


def test_adv04_adv05_dates_of_birth(page):
    r = page.evaluate("""() => [CALC.dobOf({ idNo: '2601015009088' }, 2026), CALC.dobOf({ idNo: '2605015009088' }, 2026), CALC.dobOf({ idNo: '0705015009088' }, 2026),
      CALC.dobOf({ idNo: '8001015009088', dob: '1980-02-30' }, 2026), CALC.dobOf({ idNo: '8001015009088', dob: '01/01/1980' }, 2026), CALC.dobOf({ dob: '1955-07-04' }, 2026)]""")
    assert r == [None, "1926-05-01", "2007-05-01", "1980-01-01", "1980-01-01", "1955-07-04"]


def test_adv06_to_adv09_basis_texts_say_what_was_computed(page):
    loss = compute(page, {"lines": [L(1, "remuneration", 300000), L(2, "capitalGain", -50000)]}, 40)
    small = compute(page, {"lines": [L(1, "remuneration", 300000), L(2, "capitalGain", 30000)]}, 40)
    basis = lambda r, k: next(l["basis"] for l in r["lines"] if l["key"] == k)
    assert "assessed capital loss of R10,000.00 carried forward" in basis(loss, "taxableCapitalGain")
    assert basis(small, "taxableCapitalGain") == "Gain of R30,000.00 within the R40,000.00 annual exclusion"
    young = compute(page, {"lines": [L(1, "remuneration", 600000), L(2, "medicalFees", 20000), L(3, "medicalExpenses", 80000)], "medical": {"months": 12, "dependants": 2}}, 40)
    assert "excess fees R0.00" in basis(young, "s6b") and "not below nil" in basis(young, "s6b")
    senior = compute(page, {"lines": [L(1, "remuneration", 100000), L(2, "medicalFees", 90000), L(3, "medicalExpenses", 90000)], "medical": {"months": 12, "dependants": 0}}, 70)
    assert basis(senior, "s6b").endswith("limited to the tax left")
    s6b_from = next(l["from"] for l in senior["lines"] if l["key"] == "s6b")
    assert s6b_from == ["L2", "L3"], "The s6B line lists the fees and the expenses it used"
    nomonths = compute(page, {"lines": [L(1, "remuneration", 100000), L(2, "medicalFees", 1000)], "medical": {"months": 0, "dependants": 0}}, 40)
    assert basis(nomonths, "s6a") == "Fees recorded but no months of membership"
    credit = compute(page, {"lines": [L(1, "remuneration", 400000), L(2, "foreignTaxCredit", 1000, decided={"by": "TC1", "rationale": "s6quat: tax paid abroad"})]}, 40)
    assert basis(credit, "otherCredits") == "Recorded by the Tax Consultant"


def test_adv10_variance_ratio_and_note(page):
    r = ev(page, """
      const c = mk({}, { items: ['irp5'] }); ENGINE.drive(c, 'G05', { answers: { medical: false } });
      ENGINE.setInputs(c, ai, { lines: [{ id: 'L1', docId: c.docs[0].id, field: 'remuneration', amount: 120490 }], prior: { taxableIncome: 100000 } });
      ENGINE.calculate(c, ai);
      const x = ENGINE.exOf(c).find((y) => y.code === 'TAX-05');
      return [c.calc.variance.ratio, c.calc.variance.material, x && x.note];
    """)
    assert r[0] == 0.2049 and r[1] is True and "20.5% change" in r[2]


def test_adv11_reconciliation_flags_an_unclassified_document(page):
    r = ev(page, """
      const c = mk({}, { items: [] });
      c.docs.push({ id: 'D900', name: 'unknown.pdf', status: 'validated', kind: null });
      c.inputs = { lines: [{ id: 'L1', docId: 'D900', field: 'remuneration', amount: 1000 }] };
      return CALC.forCase(c).recon.issues;
    """)
    assert r == ["L1 (Remuneration) comes from unknown.pdf, which could not be classified"]


def test_adv12_rounding_at_any_size(page):
    r = page.evaluate("() => [CALC.r2(16700000.005), CALC.r2(0.0049999999), CALC.r2(1.005), CALC.r2(-2.675), Object.is(CALC.r2(-0.001), 0)]")
    assert r == [16700000.01, 0, 1.01, -2.68, True]


def test_adv13_adv14_adv15_bad_shapes_are_errors_not_crashes(page):
    r = ev(page, """
      const c = mk({}, { items: [] }); c.year = '2026'; c.inputs = { lines: [{ id: 'L1', field: 'remuneration', amount: 1 }] };
      const y = CALC.forCase(c);
      const bad = CALC.compute({ lines: [null, 5, { id: 'L1', field: 'ra', amount: 1000 }], carried: { s11f: '2000' } }, { year: 2026, yearEnd: '2026-02-28', age: 40 }, RULESETS['2026.1']);
      return { year: [y.calc.wrongYear, y.calc.errors], errs: bad.errors, contrib: bad.schedules.retirement.contributions };
    """)
    assert r["year"][0] is False and any("no valid year" in e for e in r["year"][1])
    assert "Extracted value 1 is empty" in r["errs"] and "Extracted value 2 is empty" in r["errs"]
    assert any("zero or a positive amount" in e for e in r["errs"]) and r["contrib"] == 1000


def test_adv16_threshold_edges(page):
    r = page.evaluate("""() => { const rs = RULESETS['2026.1']; const z = Object.assign({}, rs, { rebates: { primary: 0, secondary: 0, tertiary: 0 } });
      return [CALC.threshold(rs, null), CALC.threshold(rs, -1), Object.is(CALC.threshold(z, 40), 0)]; }""")
    assert r == [None, None, True]


# ------------------------------------------------------------------------------------------------------------------- engine

def test_eng1_a_decision_after_approval_needs_a_rerun_and_supersedes_the_approval(page):
    r = ev(page, """
      const c = mk({}, { items: ['irp5', 'homeoffice'] }); ENGINE.drive(c, 'G05', { answers: { medical: false } });
      const irp5 = c.docs.find((d) => d.kind === 'irp5').id, ho = c.docs.find((d) => d.kind === 'homeoffice').id;
      ENGINE.setInputs(c, ai, { lines: [{ id: 'L1', docId: irp5, field: 'remuneration', amount: 400000 },
        { id: 'L2', docId: ho, field: 'homeOffice', amount: 12000, decided: { by: 'TC1', rationale: 's23(m): dedicated study' } }] });
      const d = ENGINE.drive(c, 'G18');
      const o = { at: ENGINE.currentGate(c), why: d.why };
      o.decide = ENGINE.decideItem(c, 'L2', tc, { amount: 9000, rationale: 'Only 75% of the room is used for work' }).ok;
      const t = S.txs.filter((x) => x.caseId === c.id && x.fn === 'itr12').pop();
      o.g18 = ENGINE.g18Blockers(t).join('|');
      o.g08 = ENGINE.criteria(c, 'G08').join('|');
      ENGINE.calculate(c, tc);
      o.after = [c.versions.length, ENGINE.exOf(c).filter(ENGINE.isOpen).map((x) => x.code).includes('VER-01'), ENGINE.currentGate(c), c.calc.summary.taxableIncome];
      // and while the ITR12 may be with SARS, no decision at all
      const e = mk({}, { items: ['irp5', 'homeoffice'] }); ENGINE.drive(e, 'G05', { answers: { medical: false } });
      ENGINE.setInputs(e, ai, { lines: [{ id: 'L1', docId: e.docs.find((x) => x.kind === 'irp5').id, field: 'remuneration', amount: 400000 },
        { id: 'L2', docId: e.docs.find((x) => x.kind === 'homeoffice').id, field: 'homeOffice', amount: 12000, decided: { by: 'TC1', rationale: 's23(m)' } }] });
      ENGINE.drive(e, 'G18');
      const te = S.txs.filter((x) => x.caseId === e.id && x.fn === 'itr12').pop();
      ENGINE.signG18(te, ACTOR.as('Integration Administrator', 'IA1')); ENGINE.signG18(te, tc); ENGINE.transmit(te, ACTOR.as('Integration Administrator', 'IA1'), 'unknown');
      o.inflight = [ENGINE.decideItem(e, 'L2', tc, { amount: 1, rationale: 'x' }).ok, ENGINE.setInputs(e, ai, { lines: [] }).ok];
      return o;
    """)
    assert r["at"] == "G18", r["why"]
    assert r["decide"] is True
    assert "The extracted values changed after version 1: rerun the calculation" in r["g18"]
    assert "rerun the calculation" in r["g08"]
    assert r["after"][0] == 2 and r["after"][1] is True and r["after"][2] == "G05" and r["after"][3] == 391000
    assert r["inflight"] == [False, False]


def test_eng2_a_superseded_tax05_is_withdrawn(page):
    r = ev(page, """
      const c = mk({}, { items: ['irp5'] }); ENGINE.drive(c, 'G05', { answers: { medical: false } });
      ENGINE.setInputs(c, ai, { lines: [{ id: 'L1', docId: c.docs[0].id, field: 'remuneration', amount: 480000 }], prior: { taxableIncome: 300000 } });
      ENGINE.calculate(c, ai);
      ENGINE.setInputs(c, ai, { lines: [{ id: 'L1', docId: c.docs[0].id, field: 'remuneration', amount: 310000 }], prior: { taxableIncome: 300000 } });
      ENGINE.calculate(c, ai);
      return ENGINE.exOf(c).filter((x) => x.code === 'TAX-05').map((x) => [x.status, x.resolvedBy, x.resolution]);
    """)
    assert len(r) == 1 and r[0][0] == "resolved" and r[0][1] == "Operon"
    assert r[0][2] == "Superseded: taxable income is now R310,000.00, no longer a material change on last year"


def test_eng3_eng4_rulesets_are_looked_up_by_own_key_and_only_a_real_year_mismatch_raises_tax06(page):
    r = ev(page, """
      const c = mk({}, { items: ['irp5'] }); ENGINE.drive(c, 'G05', { answers: { medical: false } });
      ENGINE.setInputs(c, ai, { lines: [{ id: 'L1', docId: c.docs[0].id, field: 'remuneration', amount: 100000 }] }); ENGINE.calculate(c, ai);
      return { ctor: ENGINE.rulesetChange(pp, { version: 'constructor' }).ok, proto: ENGINE.rulesetChange(pp, { version: '__proto__' }).ok, now: S.rulesetVersion,
        flag: (ENGINE.rulesetChange(pp, { wrongYear: true }), ENGINE.exOf(c).some((x) => x.code === 'TAX-06')) };
    """)
    assert r == {"ctor": False, "proto": False, "now": "2026.1", "flag": False}


def test_eng5_only_the_working_ai_agent_calculates(page):
    r = ev(page, """
      const c = mk({}, { items: ['irp5'] }); ENGINE.drive(c, 'G05', { answers: { medical: false } });
      ENGINE.setInputs(c, ai, { lines: [{ id: 'L1', docId: c.docs[0].id, field: 'remuneration', amount: 100000 }] });
      const o = { reviewer: ENGINE.calculate(c, ACTOR.reviewer()).why };
      S.aiUp = false; o.down = ENGINE.calculate(c, ai).why; o.downInputs = ENGINE.setInputs(c, ai, { lines: [] }).ok; S.aiUp = true;
      S.paused = 'test'; o.paused = ENGINE.calculate(c, ai).why; S.paused = null;
      o.ok = ENGINE.calculate(c, ai).ok;
      return o;
    """)
    assert r == {"reviewer": "Only the Operon AI agent can do this", "down": "The AI service is unavailable", "downInputs": False,
                 "paused": "AI work is paused", "ok": True}


def test_eng6_drive_reruns_a_stale_or_flagged_calculation(page):
    r = ev(page, """
      const c = mk({}, { items: ['irp5', 'homeoffice'] }); ENGINE.drive(c, 'G05', { answers: { medical: false } });
      ENGINE.setInputs(c, ai, { lines: [{ id: 'L1', docId: c.docs.find((d) => d.kind === 'irp5').id, field: 'remuneration', amount: 400000 },
        { id: 'L2', docId: c.docs.find((d) => d.kind === 'homeoffice').id, field: 'homeOffice', amount: 12000 }] });
      ENGINE.calculate(c, ai);
      ENGINE.decideItem(c, 'L2', tc, { rationale: 's23(m): dedicated study' });
      ENGINE.drive(c, 'G06');
      return [c.versions.length, c.calc.pending.length, c.calc.summary.taxableIncome];
    """)
    assert r == [2, 0, 388000]


def test_eng7_ai07_waits_for_the_approved_ruleset(page):
    r = ev(page, """
      const c = mk({}, { items: ['irp5'] }); ENGINE.drive(c, 'G05', { answers: { medical: false } });
      ENGINE.setInputs(c, ai, { lines: [{ id: 'L1', docId: c.docs[0].id, field: 'remuneration', amount: 100000 }] }); ENGINE.calculate(c, ai);
      ENGINE.rulesetChange(pp, { version: '2027.1' }); ENGINE.calculate(c, tc);
      const a7 = ENGINE.exOf(c).find((x) => x.code === 'AI-07');
      return ENGINE.resolve(a7, pp, { action: 'Impact assessed' }).why;
    """)
    assert "restore the approved ruleset first" in r


def test_zz_no_page_errors(page):
    assert page.errors == []
