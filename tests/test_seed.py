"""The demo firm's synthetic cases (src/itr12/seed.js): one or two per workflow stage, each at its stage with the exception codes the
plan's scenario table names; every figure reproduces through calc.js; every identity is made up; the audit trail is in date order.
"""
import pytest

TZ = "Africa/Johannesburg"

# scenario key -> (current gate, codes that must be open)
STAGES = {
    "onboarding": ("G01", ["KYC-01", "KYC-05"]),
    "details": ("G02", ["MD-05", "MD-01"]),
    "questionnaire": ("G03", ["QUE-04", "QUE-03"]),
    "documents": ("G04", ["AI-01", "DOC-02", "DOC-01"]),
    "wrongTaxpayer": ("G04", ["DOC-04", "SEC-01"]),
    "judgement": ("G05", ["TAX-02", "TAX-05"]),
    "calcReady": ("G05", []),
    "approval": ("G06", []),
    "rework": ("G06", ["VER-01"]),
    "ready": ("G18", []),
    "unknown": ("G18", ["INT-04"]),
    "declaration": ("G10", ["DA-01", "DA-05"]),
    "verification": ("G11", ["VRF-01", "VRF-05"]),
    "assessment": ("G12", ["ASM-02"]),  # the register maps ASM-02 to G12 only: the ITA34 check waits; G13 (the review) is next
    "remedy": ("G15", ["CLT-07", "REM-05"]),
    "closed": ("G16", []),
}


@pytest.fixture(scope="module")
def page(browser, site):
    ctx = browser.new_context(timezone_id=TZ)
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.goto(site)
    pg.wait_for_function("typeof DEMO !== 'undefined' && typeof ENGINE !== 'undefined' && !!S && S.cases.length > 0")
    pg.evaluate("() => { TICKERS.splice(0); DEMO.cases = true; seed(); }")
    yield pg
    ctx.close()


def state(page):
    return page.evaluate("""() => {
      const out = {};
      Object.entries(DEMO.keys).forEach(([k, id]) => {
        const c = ENGINE.caseById(id);
        out[k] = { id, gate: ENGINE.currentGate(c), open: ENGINE.exOf(c).filter(ENGINE.isOpen).map((x) => x.code), all: ENGINE.exOf(c).map((x) => x.code) };
      });
      return out;
    }""")


def test_seed_runs_without_refusals(page):
    assert page.evaluate("() => DEMO.problems") == []


def test_every_stage_is_present_with_its_codes(page):
    st = state(page)
    assert sorted(st) == sorted(STAGES)
    for key, (gate, codes) in STAGES.items():
        assert st[key]["gate"] == gate, (key, st[key])
        missing = [c for c in codes if c not in st[key]["open"]]
        assert not missing, (key, "missing open codes", missing, st[key]["open"])


def test_every_seeded_figure_reproduces_through_calc(page):
    bad = page.evaluate("""() => S.cases.filter((c) => c.calc).map((c) => {
        const want = CALC.forCase(c, c.calc.ruleset); want.calc.inputs = ENGINE.digest(c.inputs);  // the engine binds the values used
        const same = (a, b) => ENGINE.canon(a) === ENGINE.canon(b);
        return { id: c.id, calc: same(want.calc, c.calc), schedules: same(want.schedules, c.schedules), itr12: same(want.itr12, c.itr12), stub: !!c.calc.stub };
      }).filter((r) => !r.calc || !r.schedules || !r.itr12 || r.stub)""")
    assert bad == []


def test_the_seeded_figures(page):
    r = page.evaluate("""() => Object.fromEntries(['calcReady', 'unknown', 'closed', 'assessment', 'remedy'].map((k) => [k, ENGINE.caseById(DEMO.keys[k]).calc.summary]))""")
    # Tebogo Sithole, 51: 948,000 + 71,100 + 120,000 to s11F (limit 27.5% x 948,000 = 260,700) -> 191,100; before s18A 756,900;
    # donations 30,000 (limit 75,690); taxable 726,900: 179,147 + 39% x 53,900 = 200,168; s6A (364+364+246) x 12 = 11,688;
    # s6B 25% x max(0, 64,800 - 46,752 + 9,500 - 54,517.50) = 0. 200,168 - 17,235 - 11,688 - 268,400 = -97,155.
    assert r["calcReady"] == {"taxableIncome": 726900, "normalTax": 200168, "rebates": 17235, "medicalCredits": 11688, "paye": 268400,
                              "provisional": 0, "otherCredits": 0, "result": -97155}
    # Ingrid Fourie, 76: 296,000 + (88,000 - 34,500) = 349,500: 42,678 + 26% x 112,400 = 71,902; rebates 17,235 + 9,444 + 3,145 = 29,824;
    # s6A 728 x 12 = 8,736; s6B 33.3% x (69,600 - 26,208) + 33.3% x 41,200 = 28,169.136, truncated to 28,169.13 (the tax left is 33,342).
    assert r["closed"] == {"taxableIncome": 349500, "normalTax": 71902, "rebates": 29824, "medicalCredits": 36905.13, "paye": 28400,
                           "provisional": 0, "otherCredits": 0, "result": -23227.13}


def test_sars_figures_differ_only_where_the_story_says(page):
    r = page.evaluate("""() => ({ asm: ENGINE.caseById(DEMO.keys.assessment).ita34.recon, rem: ENGINE.caseById(DEMO.keys.remedy).ita34.recon,
      closed: ENGINE.caseById(DEMO.keys.closed).ita34.recon })""")
    assert r["closed"] == {"ok": True, "diffs": []}
    assert not r["asm"]["ok"] and {d["key"] for d in r["asm"]["diffs"]} >= {"taxableIncome", "normalTax", "result"}
    assert not r["rem"]["ok"] and {d["key"] for d in r["rem"]["diffs"]} >= {"taxableIncome", "normalTax", "result"}


def test_identities_are_made_up(page):
    r = page.evaluate("() => S.clients.map((c) => ({ name: c.name, idNo: c.idNo, taxRef: c.taxRef, email: c.email }))")
    def luhn_ok(s):
        total = 0
        for i, ch in enumerate(reversed(s)):
            d = int(ch)
            if i % 2 == 1:
                d *= 2
                d -= 9 if d > 9 else 0
            total += d
        return total % 10 == 0
    assert len(r) == len(STAGES)
    assert all(len(c["idNo"]) == 13 and c["idNo"].isdigit() and not luhn_ok(c["idNo"]) for c in r), "Every ID number fails the SA ID checksum"
    assert len({c["name"] for c in r}) == len(r) and len({c["taxRef"] for c in r}) == len(r)
    assert all(c["email"] is None for c in r)


def test_audit_trail_is_chronological_and_verifies(page):
    r = page.evaluate("""() => { const at = S.audit.map((a) => +new Date(a.at || a.time || a.when || 0));
      let back = 0; for (let i = 1; i < at.length; i++) if (at[i] < at[i - 1]) back++;
      return { n: S.audit.length, back, chain: ENGINE.verifyChain(), first: S.audit[0] && Object.keys(S.audit[0]) }; }""")
    assert r["n"] > 100
    assert r["back"] == 0, r
    assert r["chain"]["ok"], r["chain"]


def test_the_clock_keeps_running_after_the_seed(page):
    r = page.evaluate("""() => { ENGINE.watch(); return { errs: S.watchErrors, problems: DEMO.problems.length,
      approval: ENGINE.caseById(DEMO.keys.approval).reminders.map((x) => [x.kind, x.status]) }; }""")
    assert r == {"errs": 0, "problems": 0, "approval": [["approval", "sent"]]}


def test_zz_no_page_errors(page):
    assert page.errors == []
