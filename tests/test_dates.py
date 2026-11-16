"""Parity of DATES (src/itr12/dates.js, loaded in the built index.html) with the firm's own business-day calculator, plus the
statutory periods in PERIODS and FILING_2026.

The calculator is a single HTML file kept outside the repo (INPUTS = $OPERON_ITR12_DIR or the repo's parent folder). It is opened
read-only through its file:// URL and driven through its own DOM (ids start, end, mode, chapter9, custom, calcRange, submitted,
method, calc21 ...). Nothing from it is copied into the repo; the module is skipped when it is absent.

Expected values come from the calculator and from the statutes (Public Holidays Act s2(1), the dispute rules GN R.3146, TAA s29),
not from dates.js. The calculator's custom-holiday box carries 4 November 2026 (local government elections), which DATES.EXTRA
declares too (Proclamation 346, Gazette 55352).
"""
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INPUTS = Path(os.environ.get("OPERON_ITR12_DIR") or ROOT.parent)
_CALCS = sorted(INPUTS.glob("*SARS-DateClaculator*.html"))
if not _CALCS:
    pytest.skip("the firm's business-day calculator is not available", allow_module_level=True)
CALC_URL = _CALCS[0].resolve().as_uri()

CUSTOM = "2026-11-04 | Local government elections"
TZ = "Africa/Johannesburg"


# ---------------------------------------------------------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def ctx(browser):
    c = browser.new_context(timezone_id=TZ)
    yield c
    c.close()


@pytest.fixture(scope="module")
def page(ctx, site):
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.goto(site)
    pg.wait_for_function("typeof DATES !== 'undefined' && typeof S !== 'undefined' && !!S && typeof PERIODS !== 'undefined'")
    return pg


@pytest.fixture(scope="module")
def calc(ctx):
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.goto(CALC_URL)
    pg.wait_for_function("typeof biz === 'function' && !!document.getElementById('calcRange')")
    pg.fill("#custom", CUSTOM)
    return pg


def ev(page, body, arg=None):
    """Run `body` (a JS function body; `arg` in scope) on the app page after stopping the ticker and re-seeding."""
    return page.evaluate("(arg) => { TICKERS.splice(0); seed();\n" + body + "\n}", arg)


def diffs_report(diffs, what):
    assert not diffs, "%s: %d differences from the calculator; first ones: %s" % (what, len(diffs), diffs[:8])


# ---------------------------------------------------------------------------------------------------------------------------
# 1. biz() for every calendar day
# ---------------------------------------------------------------------------------------------------------------------------

def test_biz_matches_calculator_for_every_day(page, calc):
    mine = ev(page, """
      const out = {}; let d = DATES.dt('2025-11-01'); const end = DATES.dt('2027-02-28');
      while (d <= end) { out[DATES.iso(d)] = DATES.biz(d); d = DATES.add(d, 1); }
      return out;""")
    theirs = calc.evaluate("""() => {
      const c = custom(); const out = {}; let d = dt('2025-11-01'); const end = dt('2027-02-28');
      while (d <= end) { out[iso(d)] = biz(d, c); d = add(d, 1); }
      return out;
    }""")
    assert len(mine) == len(theirs) == 485, "both sides should cover 1 Nov 2025 to 28 Feb 2027 (485 days)"
    diffs = [(k, "dates.js=%s calculator=%s" % (mine[k], theirs.get(k))) for k in mine if mine[k] != theirs.get(k)]
    diffs_report(diffs, "DATES.biz")
    # Anchors that follow from the statutes, so that agreement is not two copies of the same mistake.
    for day, want in {"2026-04-03": False, "2026-04-06": False, "2026-08-09": False, "2026-08-10": False, "2026-11-04": False,
                      "2026-11-03": True, "2026-12-16": False, "2026-12-25": False, "2027-01-01": False, "2026-08-11": True}.items():
        assert mine[day] is want, "%s should %sbe a business day" % (day, "" if want else "not ")


# ---------------------------------------------------------------------------------------------------------------------------
# 2. 21-business-day verification tracker
# ---------------------------------------------------------------------------------------------------------------------------

def _days(start, end):
    from datetime import date, timedelta
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    return [(a + timedelta(n)).isoformat() for n in range((b - a).days + 1)]


VERIFY_DATES = (_days("2026-03-30", "2026-04-10")      # Easter 2026 (Good Friday 3 Apr, Family Day 6 Apr)
                + _days("2025-12-10", "2025-12-20")    # mid-December 2025
                + _days("2026-12-10", "2026-12-20")    # mid-December 2026
                + _days("2025-12-29", "2026-01-08")    # early January 2026
                + _days("2026-12-29", "2027-01-08")    # early January 2027
                + _days("2026-08-07", "2026-08-11")    # 9 Aug is a Sunday, observed Monday 10 Aug
                + _days("2026-11-02", "2026-11-05"))   # 4 Nov 2026 election holiday


@pytest.fixture(scope="module")
def verification(page, calc):
    mine = ev(page, """
      const out = {};
      arg.forEach((s) => ['after', 'include'].forEach((m) => {
        const v = DATES.verification21(DATES.dt(s), m);
        out[s + '|' + m] = { target: DATES.iso(v.target), day1: DATES.iso(v.day1), follow: DATES.iso(v.follow),
                             rows: v.rows.map(([n, d]) => [n, DATES.iso(d)]) };
      }));
      return out;""", VERIFY_DATES)
    theirs = calc.evaluate("""(dates) => {
      const out = {};
      dates.forEach((s) => ['after', 'include'].forEach((m) => {
        $('submitted').value = s; $('method').value = m; $('calc21').click();
        const rows = [...document.querySelectorAll('#vRows tr')].map((tr) => [...tr.cells].map((c) => c.textContent));
        out[s + '|' + m] = { target: $('target').textContent, day1: $('day1').textContent, follow: $('follow').textContent, rows };
      }));
      return out;
    }""", VERIFY_DATES)
    # The calculator prints dates as "dd Mon yyyy" (en-ZA); render DATES' ISO dates the same way, and add the weekday names.
    fmt = calc.evaluate("""(isos) => Object.fromEntries(isos.map((s) => [s, [nice(dt(s)), dt(s).toLocaleDateString('en-ZA', { weekday: 'long', timeZone: 'UTC' })]]))""",
                        sorted({v[k] for v in mine.values() for k in ("target", "day1", "follow")} | {r[1] for v in mine.values() for r in v["rows"]}))
    return mine, theirs, fmt


def test_verification21_has_both_methods_and_21_rows(verification):
    mine, theirs, _ = verification
    assert len(mine) == len(VERIFY_DATES) * 2
    for key, v in mine.items():
        assert [r[0] for r in v["rows"]] == list(range(1, len(v["rows"]) + 1)) and len(v["rows"]) in (21,), key
        assert v["rows"][-1][1] == v["target"], key


def test_verification21_target_day1_follow_match_calculator(verification):
    mine, theirs, fmt = verification
    diffs = []
    for key, v in mine.items():
        for field in ("target", "day1", "follow"):
            if fmt[v[field]][0] != theirs[key][field]:
                diffs.append((key, field, "dates.js=" + v[field], "calculator=" + theirs[key][field]))
    diffs_report(diffs, "verification21 target/day1/follow")


def test_verification21_rows_match_calculator(verification):
    mine, theirs, fmt = verification
    diffs = []
    for key, v in mine.items():
        want = [[str(n), d, fmt[d][1]] for n, d in v["rows"]]
        if want != theirs[key]["rows"]:
            diffs.append((key, "dates.js=%s..." % want[:2], "calculator=%s..." % theirs[key]["rows"][:2]))
    diffs_report(diffs, "verification21 numbered rows")


def test_verification21_statutory_anchors(verification):
    """Independent of both implementations: 'after' makes the submission Day 0; 'include' makes it Day 1 only on a business day."""
    mine, _, _ = verification
    # Submitted Friday 7 Aug 2026: Day 1 is Tuesday 11 Aug (Mon 10 Aug is the observed National Women's Day).
    assert mine["2026-08-07|after"]["day1"] == "2026-08-11"
    # Submitted Monday 2 Nov 2026 (a business day): 'include' counts it as Day 1; 'after' starts on Tuesday 3 Nov.
    assert mine["2026-11-02|include"]["day1"] == "2026-11-02"
    assert mine["2026-11-02|after"]["day1"] == "2026-11-03"
    # Submitted Tuesday 3 Nov 2026: Day 1 is Thursday 5 Nov (Wednesday 4 Nov is the election holiday).
    assert mine["2026-11-03|after"]["day1"] == "2026-11-05"
    # Submitted on a Saturday: 'include' and 'after' agree because the submission date is not a business day.
    assert mine["2026-08-08|include"]["rows"] == mine["2026-08-08|after"]["rows"]


# ---------------------------------------------------------------------------------------------------------------------------
# 3. countRange
# ---------------------------------------------------------------------------------------------------------------------------

RANGES = [
    ("2025-12-01", "2026-01-31"),   # across December/January
    ("2026-12-10", "2027-01-20"),   # across December/January the following year
    ("2026-12-16", "2027-01-15"),   # exactly the Chapter 9 period
    ("2026-03-25", "2026-04-15"),   # Easter 2026
    ("2026-10-28", "2026-11-12"),   # 4 November 2026
    ("2026-11-04", "2026-11-04"),   # a single day that is the election holiday
    ("2026-08-05", "2026-08-14"),   # Sunday 9 Aug observed on Monday 10 Aug
    ("2025-11-01", "2027-02-28"),   # the whole window
]
MODES = ("es", "both", "neither", "ee")
COMBOS = [(s, e, m, c) for (s, e) in RANGES for m in MODES for c in (False, True)]


@pytest.fixture(scope="module")
def ranges(page, calc):
    mine = ev(page, """
      return arg.map(([s, e, m, c]) => DATES.countRange(DATES.dt(s), DATES.dt(e), m, c));""", COMBOS)
    theirs = calc.evaluate("""(combos) => combos.map(([s, e, m, c]) => {
      $('start').value = s; $('end').value = e; $('mode').value = m; $('chapter9').checked = c; $('calcRange').click();
      const rows = [...document.querySelectorAll('#rangeRows tr')].map((tr) => [...tr.cells].map((x) => x.textContent)).filter((r) => r.length === 4);
      return { business: +$('rangeBusiness').textContent, total: +$('rangeTotal').textContent, excluded: +$('rangeExcluded').textContent,
               err: $('rangeErr').style.display === 'block', rows };
    })""", COMBOS)
    return mine, theirs


def test_countrange_no_calculator_errors(ranges):
    _, theirs = ranges
    assert not [COMBOS[i] for i, t in enumerate(theirs) if t["err"]]


def test_countrange_counts_match_calculator(ranges):
    mine, theirs = ranges
    diffs = []
    for combo, a, b in zip(COMBOS, mine, theirs):
        got, want = (a["business"], a["total"], a["excluded"]), (b["business"], b["total"], b["excluded"])
        if got != want:
            diffs.append((combo, "dates.js (business,total,excluded)=%s" % (got,), "calculator=%s" % (want,)))
    diffs_report(diffs, "countRange counts")


def test_countrange_rows_match_calculator_date_and_business(ranges):
    mine, theirs = ranges
    diffs = []
    for combo, a, b in zip(COMBOS, mine, theirs):
        got = [(r["date"], "Yes" if r["business"] else "No") for r in a["rows"]]
        want = [(r[0], r[2]) for r in b["rows"]]
        if got != want:
            first = next((i for i, (x, y) in enumerate(zip(got, want)) if x != y), min(len(got), len(want)))
            diffs.append((combo, "row %d: dates.js=%s calculator=%s (rows %d vs %d)" % (first, got[first:first + 1], want[first:first + 1], len(got), len(want))))
    diffs_report(diffs, "countRange date and business columns")


def test_countrange_rows_match_calculator_reason_text(ranges):
    mine, theirs = ranges
    diffs = []
    for combo, a, b in zip(COMBOS, mine, theirs):
        for x, y in zip(a["rows"], b["rows"]):
            if x["date"] == y[0] and x["reason"] != y[3]:
                diffs.append((combo, x["date"], "dates.js=%r" % x["reason"], "calculator=%r" % y[3]))
                break
    diffs_report(diffs, "countRange reason text")


def test_countrange_totals_are_consistent(ranges):
    mine, _ = ranges
    for combo, a in zip(COMBOS, mine):
        assert a["business"] + a["excluded"] == a["total"] == len(a["rows"]), combo
        assert a["business"] == sum(1 for r in a["rows"] if r["business"]), combo


def test_countrange_mode_semantics_and_chapter9(page):
    r = ev(page, """
      const c = (s, e, m, ch) => DATES.countRange(DATES.dt(s), DATES.dt(e), m, ch);
      return { es: c('2026-11-02', '2026-11-06', 'es', false).total, both: c('2026-11-02', '2026-11-06', 'both', false).total,
               neither: c('2026-11-02', '2026-11-06', 'neither', false).total, ee: c('2026-11-02', '2026-11-06', 'ee', false).total,
               ch9: c('2026-12-16', '2027-01-15', 'both', true), plain: c('2026-12-16', '2027-01-15', 'both', false) };""")
    assert (r["es"], r["both"], r["neither"], r["ee"]) == (4, 5, 3, 4)
    assert r["ch9"]["business"] == 0 and r["ch9"]["excluded"] == r["ch9"]["total"] == 31
    assert r["plain"]["business"] > 0


# ---------------------------------------------------------------------------------------------------------------------------
# Statutory periods
# ---------------------------------------------------------------------------------------------------------------------------

def test_add_business_days_skips_chapter9_period(page):
    r = ev(page, """
      const a = (s, n, ch9) => DATES.iso(DATES.addBusinessDays(DATES.dt(s), n, { ch9 }));
      const never = []; // no result may fall within 16 Dec - 15 Jan
      for (const s of ['2025-12-01', '2025-12-15', '2026-12-01', '2026-12-10', '2026-12-15', '2027-01-10'])
        for (let n = 1; n <= 40; n++) { const x = a(s, n, true); if (DATES.isChapter9(DATES.dt(x))) never.push([s, n, x]); }
      return { never, dec15: a('2026-12-15', 1, true), dec15plain: a('2026-12-15', 1, false), dec10x3: a('2026-12-10', 3, true), dec10x4: a('2026-12-10', 4, true),
               y25: a('2025-12-15', 1, true), y25plain: a('2025-12-15', 1, false) };""")
    assert r["never"] == [], "a Chapter 9 period never ends on 16 December to 15 January: %s" % r["never"][:5]
    assert r["dec15"] == "2027-01-18", "from Tue 15 Dec 2026 the next Chapter 9 business day is Mon 18 Jan 2027 (16 Jan Sat, 17 Jan Sun)"
    assert r["dec15plain"] == "2026-12-17", "without Chapter 9 the 16th is a public holiday, so the next business day is the 17th"
    assert r["dec10x3"] == "2026-12-15" and r["dec10x4"] == "2027-01-18"
    assert r["y25"] == "2026-01-16", "from Mon 15 Dec 2025 the next Chapter 9 business day is Fri 16 Jan 2026"
    assert r["y25plain"] == "2025-12-17"


def test_dispute_periods_are_30_80_30_with_chapter9_and_cite_the_rules(page):
    p = ev(page, "return { r: PERIODS.reasons, o: PERIODS.objection, a: PERIODS.appeal };")
    for key, days in (("r", 30), ("o", 80), ("a", 30)):
        assert p[key]["days"] == days, "%s should be %d days" % (p[key].get("label"), days)
        assert p[key]["ch9"] is True, "%s runs under Chapter 9 (16 Dec to 15 Jan excluded)" % p[key].get("label")
        assert "GN R.3146" in p[key]["rule"], p[key]["rule"]


def test_verification_retention_and_filing_season(page):
    p = ev(page, "return { v: PERIODS.verification, ret: PERIODS.retention, np: FILING_2026.nonProvisional, pr: FILING_2026.provisional, y: FILING_2026.year };")
    assert p["v"]["days"] == 21
    assert p["ret"]["years"] == 5
    assert p["np"]["closes"] == "2026-10-23", "non-provisional taxpayers: filing season 2026 closes 23 October 2026"
    assert p["pr"]["closes"] == "2027-01-22", "provisional taxpayers: filing season 2026 closes 22 January 2027"
    assert p["y"] == 2026


def test_no_page_errors(page, calc):
    assert page.errors == [] and calc.errors == []
