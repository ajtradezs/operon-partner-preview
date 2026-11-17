"""The admin screens on the seeded demo firm: Clients and one client (views-clients.js), Deadlines (views-deadlines.js), Controls
(views-controls.js), Incidents, one incident, Retention and the Audit trail (views-records.js) and Import clients (views-import.js).
Every screen renders for every role with its review keys; the demo cases appear where the plan puts them; every action changes
state only through ENGINE and leaves an audit entry (refusals included, with the reason shown); data is escaped and identities masked."""
from pathlib import Path
import csv
import io
import json

import openpyxl
import pytest

TZ = "Africa/Johannesburg"
ROLES = ["Tax Consultant", "Administrator", "Integration Administrator", "Information Officer", "Records/Compliance Owner"]
SCREENS = {
    "clients": ["adm-clients-head", "adm-clients-list", "adm-clients-sars", "adm-clients-kyc", "adm-clients-fields"],
    "client-CL16": ["adm-client-head", "adm-client-master", "adm-client-columns", "adm-client-kyc", "adm-client-cases", "adm-client-sars", "adm-client-activity"],
    "deadlines": ["adm-deadlines-head", "adm-deadlines-all", "adm-deadlines-columns", "adm-deadlines-filing", "adm-deadlines-reminders", "adm-deadlines-sars",
                  "adm-deadlines-remedies", "adm-deadlines-retention", "adm-deadlines-calc", "adm-deadlines-holidays", "adm-deadlines-rules"],
    "controls": ["adm-controls-head", "adm-controls-tiers", "adm-controls-gates", "adm-controls-columns", "adm-controls-severity", "adm-controls-policy",
                 "adm-controls-questions", "adm-controls-sod", "adm-controls-roles", "adm-controls-rulesets", "adm-controls-checklist", "adm-controls-register"],
    "incidents": ["adm-incidents-head", "adm-incidents-list", "adm-incidents-rule"],
    "incident-INC01": ["adm-incident-head", "adm-incident-facts", "adm-incident-steps", "adm-incident-columns", "adm-incident-exceptions", "adm-incident-trail"],
    "retention": ["adm-retention-head", "adm-retention-rule", "adm-retention-cases", "adm-retention-columns", "adm-retention-holds", "adm-retention-exceptions"],
    "audit": ["adm-audit-head", "adm-audit-integrity", "adm-audit-trail", "adm-audit-fields"],
    "import": ["adm-import-head", "adm-import-template", "adm-import-upload"],
}
EVIL = "\"'><img src=x onerror=alert(1)>"  # quotes too, so an attribute break-out would show


# The firm prefix is the first token of the input file names in the Operon folder. It is derived at run time, never written here.
FIRM_TOKENS = sorted({p.name.split("_")[0].lower() for p in Path(__file__).resolve().parents[2].glob("*_PaperSync_ITR12_*")})


@pytest.fixture
def page(browser, site):
    """A fresh seeded firm per test (the actions change state)."""
    ctx = browser.new_context(timezone_id=TZ, viewport={"width": 1280, "height": 900}, accept_downloads=True)
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.on("dialog", lambda d: (pg.errors.append("native dialog: " + d.message), d.dismiss()))
    pg.goto(site + "#today")
    pg.wait_for_function("typeof VK !== 'undefined' && typeof ADM !== 'undefined' && typeof DEMO !== 'undefined' && !!S && S.cases.length > 0")
    pg.evaluate("() => { TICKERS.splice(0); DEMO.cases = true; seed(); }")
    yield pg
    ctx.close()


def go(pg, role, route):
    """Sign in the way the shell's code form does (S.signedIn, S.role), then render the route."""
    pg.evaluate("([r, h]) => { S.signedIn = true; S.role = r; if (location.hash !== '#' + h) location.hash = '#' + h; render(); }", [role, route])
    pg.wait_for_selector("#app h1")


def click(pg, selector):
    """Click through the review layer's first-visit tip, which may sit over the page."""
    pg.locator(selector).first.evaluate("el => el.click()")


def toast(pg):
    return pg.evaluate("document.getElementById('toasts').textContent")


def audit_len(pg):
    return pg.evaluate("S.audit.length")


def client_of(pg, key):
    return pg.evaluate("k => ENGINE.caseById(DEMO.keys[k]).clientId", key)


def test_every_screen_renders_for_every_role_with_review_keys(page):
    routes = dict(SCREENS)
    routes["client-" + client_of(page, "onboarding")] = routes.pop("client-CL16")
    for role in ROLES:
        for route, keys in routes.items():
            go(page, role, route)
            r = page.evaluate("""() => ({ keys: Array.from(document.querySelectorAll('#app [data-rv-key]')).map((e) => e.getAttribute('data-rv-key')),
                h1: document.querySelector('#app h1').textContent, placeholder: document.getElementById('app').textContent.includes('is being rebuilt') })""")
            for k in keys:
                assert k in r["keys"], (role, route, k)
            assert all(k.startswith("adm-") for k in r["keys"]), (role, route, r["keys"])
            assert len(r["keys"]) == len(set(r["keys"])), (role, route)
            assert r["h1"] and not r["placeholder"], (role, route)
    assert page.errors == []


def test_unknown_ids_show_a_plain_not_found_page(page):
    for route in ["client-CL99", "incident-INC99"]:
        go(page, "Tax Consultant", route)
        assert "not found" in page.locator("#app h1").inner_text()
    assert page.errors == []


def test_clients_show_kyc_gaps_and_sars_differences(page):
    go(page, "Administrator", "clients")
    onb = client_of(page, "onboarding")
    det = client_of(page, "details")
    r = page.evaluate("""([onb, det]) => {
        const list = document.querySelector('[data-rv-key="adm-clients-list"]');
        const row = (id) => Array.from(list.querySelectorAll('tbody tr')).find((tr) => tr.querySelector(`a[href="#client-${id}"]`));
        const sars = document.querySelector('[data-rv-key="adm-clients-sars"]');
        return { rows: list.querySelectorAll('tbody tr').length, n: S.clients.length,
          onb: row(onb).textContent, det: Array.from(row(det).querySelectorAll('.vk-code')).map((e) => e.textContent),
          sars: Array.from(sars.querySelectorAll('.vk-code')).map((e) => e.textContent),
          kycMissing: document.querySelector('[data-rv-key="adm-clients-kyc"]').querySelectorAll('.adm-no').length }; }""", [onb, det])
    assert r["rows"] == r["n"] == 16
    assert "4 of 6" in r["onb"] and "Address" in r["onb"] and "Mandate" in r["onb"] and "G01 Blocked" in r["onb"]
    assert set(r["det"]) == {"MD-05", "MD-01"}
    assert set(r["sars"]) == {"MD-05", "MD-01"}
    assert r["kycMissing"] == 2
    # Filters and search
    click(page, "button[data-act='adm.clf'][data-v='sars']")
    assert page.locator("[data-rv-key='adm-clients-list'] tbody tr").count() == 1
    click(page, "button[data-act='adm.clf'][data-v='kyc']")
    assert page.locator("[data-rv-key='adm-clients-list'] tbody tr").count() == 1
    click(page, "button[data-act='adm.clf'][data-v='all']")
    page.fill("#adm-cl-q", "molefe")
    assert page.locator("[data-rv-key='adm-clients-list'] tbody tr").count() == 1
    assert page.errors == []


def test_client_page_compares_with_sars_side_by_side(page):
    det = client_of(page, "details")
    go(page, "Tax Consultant", "client-" + det)
    rows = page.evaluate("""() => Array.from(document.querySelectorAll('[data-rv-key="adm-client-sars"] tbody tr')).map((tr) =>
        ({ item: tr.cells[0].textContent, sars: tr.cells[2].textContent, codes: Array.from(tr.querySelectorAll('.vk-code')).map((e) => e.textContent) }))""")
    assert len(rows) == 5
    by = {r["item"]: r for r in rows}
    bank = next(r for r in rows if r["item"].startswith("Banking"))
    contact = next(r for r in rows if r["item"].startswith("Contact"))
    assert bank["codes"] == ["MD-05"] and "different account" in bank["sars"]
    assert contact["codes"] == ["MD-01"] and "Pretoria" in contact["sars"]
    assert all(not r["codes"] for k, r in by.items() if not (k.startswith("Banking") or k.startswith("Contact")))
    master = page.locator("[data-rv-key='adm-client-master']").inner_text()
    for group in ["Taxpayer identification", "Contact details", "Residential and postal information", "Marital information", "Tax residency", "Banking information"]:
        assert group.lower() in master.lower()
    assert page.errors == []


def test_kyc_changes_go_through_engine_and_refusals_are_audited(page):
    cl = client_of(page, "onboarding")
    go(page, "Administrator", "client-" + cl)
    n0 = audit_len(page)
    click(page, "[data-rv-key='adm-client-kyc'] button[data-act='adm.kyc'][data-key='address']")
    r = page.evaluate("""([id, n0]) => ({ ok: ENGINE.clientOf(id).kyc.find((k) => k.key === 'address').ok,
        hit: S.audit.slice(n0).some((a) => a.client === id && a.who === 'AD1' && a.text.includes('Proof of address')), chain: ENGINE.verifyChain().ok })""", [cl, n0])
    assert r == {"ok": True, "hit": True, "chain": True}
    assert "Marked as received" in toast(page)

    go(page, "Information Officer", "client-" + cl)
    n1 = audit_len(page)
    click(page, "[data-rv-key='adm-client-kyc'] button[data-act='adm.kyc'][data-key='mandate']")
    r = page.evaluate("""([id, n1]) => ({ ok: ENGINE.clientOf(id).kyc.find((k) => k.key === 'mandate').ok,
        refused: S.audit.slice(n1).some((a) => a.result === 'Refused' && a.who === 'IO1' && a.client === id) })""", [cl, n1])
    assert r == {"ok": False, "refused": True}
    assert "Not done: Only an Administrator or a Tax Consultant can do this" in toast(page)
    assert page.errors == []


def test_deadlines_list_the_demo_dates_with_their_rules(page):
    go(page, "Tax Consultant", "deadlines")
    keys = page.evaluate("DEMO.keys")
    r = page.evaluate("""() => { const t = (k) => document.querySelector(`[data-rv-key="${k}"]`).textContent; return {
        all: t('adm-deadlines-all'), sars: t('adm-deadlines-sars'), rem: t('adm-deadlines-remedies'), ret: t('adm-deadlines-retention'),
        reminders: t('adm-deadlines-reminders'), rules: t('adm-deadlines-rules'), filing: t('adm-deadlines-filing'),
        filingRows: Array.from(document.querySelectorAll('[data-rv-key="adm-deadlines-all"] tbody tr')).filter((tr) => tr.textContent.includes('filing season closes')).length }; }""")
    assert "DA-2026-118204" in r["sars"] and "17 Nov 2026" in r["sars"]
    assert "VRF-2026-554310" in r["sars"] and "12 Nov 2026" in r["sars"]
    assert keys["remedy"] in r["rem"] and "28 Jan 2027" in r["rem"] and "rule 7(1)" in r["rem"]
    assert keys["assessment"] in r["rem"] and "if the client disputes" in r["rem"]
    assert keys["approval"] in r["reminders"] and "Waiting" in r["reminders"]
    assert keys["closed"] in r["ret"] and "22 Jul 2031" in r["ret"] and "active hold" in r["ret"]
    assert "s29(3)(a)" in r["rules"] and "rule 6(1)" in r["rules"]
    assert r["filingRows"] == 1  # one row for the provisional close, listing the cases
    assert "Closed 23 Oct" in r["filing"]
    for code in ["VRF-03", "DA-05", "REM-05"]:
        assert code in r["all"], code
    click(page, "button[data-act='adm.dlk'][data-v='remedy']")
    assert page.locator("[data-rv-key='adm-deadlines-all'] tbody tr").count() == 1
    assert page.errors == []


def test_business_day_calculator_matches_dates(page):
    go(page, "Tax Consultant", "deadlines")
    page.fill("#adm-dc-s", "2026-12-01")
    page.fill("#adm-dc-e", "2027-01-31")
    page.check("#adm-dc-c")
    click(page, "form[data-form='adm.dlCount'] button[type=submit]")
    want = page.evaluate("DATES.countRange(DATES.dt('2026-12-01'), DATES.dt('2027-01-31'), 'es', true).business")
    assert page.locator("form[data-form='adm.dlCount'] .adm-big").inner_text() == f"{want} business days"
    page.fill("#adm-da-s", "2026-11-09")
    page.fill("#adm-da-n", "80")
    page.check("#adm-da-c")
    click(page, "form[data-form='adm.dlAdd'] button[type=submit]")
    want = page.evaluate("fDate(VK.toDay(DATES.iso(DATES.addBusinessDays(DATES.dt('2026-11-09'), 80, { ch9: true }))))")
    assert page.locator("form[data-form='adm.dlAdd'] .adm-big").inner_text() == want
    page.fill("#adm-dv-s", "2026-11-12")
    click(page, "form[data-form='adm.dlV21'] button[type=submit]")
    want = page.evaluate("fDate(VK.toDay(DATES.iso(DATES.verification21(DATES.dt('2026-11-12'), 'after').target)))")
    assert page.locator("form[data-form='adm.dlV21'] .adm-big").inner_text() == want
    page.fill("#adm-dc-e", "2026-11-01")
    click(page, "form[data-form='adm.dlCount'] button[type=submit]")
    assert "before the start date" in page.locator("form[data-form='adm.dlCount'] .err").inner_text()
    assert page.errors == []


def test_controls_show_the_register_rules_and_questions(page):
    go(page, "Tax Consultant", "controls")
    r = page.evaluate("""() => { const q = (k) => document.querySelector(`[data-rv-key="${k}"]`);
        return { gates: q('adm-controls-gates').querySelectorAll('tbody tr').length, questions: q('adm-controls-questions').querySelectorAll('.adm-q').length,
          want: PENDING_JOHAN.length, hash: q('adm-controls-register').textContent.includes(REGISTER.source.sha256) && q('adm-controls-register').textContent.includes(WORKFLOW.source.sha256),
          codes: q('adm-controls-register').querySelectorAll('tbody tr').length, nCodes: REGISTER.codes.length,
          tiers: Array.from(q('adm-controls-tiers').querySelectorAll('.tier')).map((e) => e.textContent),
          checklist: q('adm-controls-checklist').querySelectorAll('tbody tr').length, sod: q('adm-controls-sod').querySelectorAll('tbody tr').length,
          pending: q('adm-controls-policy').textContent.split('Pending Johan').length - 1, rulesets: q('adm-controls-rulesets').textContent,
          roles: q('adm-controls-roles').textContent }; }""")
    assert r["gates"] == 18 and r["questions"] == r["want"] >= 15 and r["hash"] and r["codes"] == r["nCodes"] == 116
    assert r["tiers"] == ["Auto", "Auto + hold", "Held for a human", "Forbidden"]
    assert r["checklist"] == 11 and r["sod"] == 20 and r["pending"] == 6
    assert "Ruleset 2026.1" in r["rulesets"] and "In use" in r["rulesets"] and "Ruleset 2027.1" in r["rulesets"]
    assert "Records/Compliance Owner" in r["roles"] and not any(t in page.content().lower() for t in FIRM_TOKENS)
    for sheet, rows in [("gates", 18), ("stages", 45), ("audit", 24), ("instructions", 18)]:
        click(page, f"button[data-act='adm.sheet'][data-v='{sheet}']")
        assert page.locator("[data-rv-key='adm-controls-register'] tbody tr").count() == rows, sheet
    click(page, "button[data-act='adm.sheet'][data-v='codes']")
    page.select_option("#adm-reg-fam", "MD")
    assert page.locator("[data-rv-key='adm-controls-register'] tbody tr").count() == 6
    page.fill("#adm-reg-q", "banking")
    assert page.locator("[data-rv-key='adm-controls-register'] tbody tr").count() == 1
    assert page.errors == []


def test_override_policy_changes_go_through_engine(page):
    go(page, "Tax Consultant", "controls")
    code = page.evaluate("document.getElementById('adm-ov-code').value")
    n0 = audit_len(page)
    click(page, "form[data-form='adm.ovAdd'] button[type=submit]")
    r = page.evaluate("""([c, n0]) => ({ on: S.policy.overridable.includes(c), refused: S.audit.slice(n0).some((a) => a.result === 'Refused' && a.code === c && a.who === 'TC1') })""", [code, n0])
    assert r == {"on": False, "refused": True}
    assert "Not done: Only a Records/Compliance Owner can do this" in toast(page)

    go(page, "Records/Compliance Owner", "controls")
    page.select_option("#adm-ov-code", code)
    click(page, "form[data-form='adm.ovAdd'] button[type=submit]")
    assert page.evaluate("c => S.policy.overridable.includes(c)", code)
    assert code in page.locator("[data-rv-key='adm-controls-policy']").inner_text()
    n1 = audit_len(page)
    click(page, f"button[data-act='adm.ovOff'][data-code='{code}']")
    r = page.evaluate("""([c, n1]) => ({ on: S.policy.overridable.includes(c), hit: S.audit.slice(n1).some((a) => a.code === c && a.who === 'RC1' && a.result === 'Changed'), chain: ENGINE.verifyChain().ok })""", [code, n1])
    assert r == {"on": False, "hit": True, "chain": True}
    never = page.evaluate("Array.from(document.querySelectorAll('#adm-ov-code option')).map((o) => o.value)")
    assert not {"CLT-04", "DOC-04", "SEC-01", "INT-04", "RET-01"} & set(never)
    assert page.errors == []


def test_incident_steps_and_close_go_through_engine(page):
    inc = page.evaluate("S.incidents[0].id")
    assert page.evaluate("ENGINE.caseById(S.incidents[0].caseId).id") == page.evaluate("DEMO.keys.wrongTaxpayer")
    go(page, "Tax Consultant", "incidents")
    assert inc in page.locator("[data-rv-key='adm-incidents-list']").inner_text()
    go(page, "Tax Consultant", "incident-" + inc)
    n0 = audit_len(page)
    page.fill("#adm-inc-containment", "Removed the spouse's IRP5 from the case")
    click(page, "form[data-form='adm.incStep'][data-step='containment'] button[type=submit]")
    assert "Not done: Only an Information Officer can do this" in toast(page)
    assert page.evaluate("([id, n0]) => !ENGINE.incById(id).steps.containment && S.audit.slice(n0).some((a) => a.result === 'Refused' && a.who === 'TC1')", [inc, n0])

    go(page, "Information Officer", "incident-" + inc)
    click(page, "button[data-act='adm.incClose']")
    page.wait_for_selector("#dlg[open]")
    page.click("#dlg-ok")
    page.wait_for_function("document.getElementById('dlg-err').textContent.startsWith('Not done: Still to record')")
    page.click("#dlg [data-close]")
    for step in ["containment", "investigation", "remediation", "notification"]:
        page.fill(f"#adm-inc-{step}", f"Recorded {step} <b>{EVIL}</b>")
        click(page, f"form[data-form='adm.incStep'][data-step='{step}'] button[type=submit]")
    assert page.locator("#app img").count() == 0
    assert EVIL in page.locator("[data-rv-key='adm-incident-steps']").inner_text()
    click(page, "button[data-act='adm.incClose']")
    page.wait_for_selector("#dlg[open]")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    r = page.evaluate("""id => { const i = ENGINE.incById(id); return { status: i.status, gate: i.gate.status, by: i.closed.by,
        sec: S.exceptions.filter((x) => i.exceptionIds.includes(x.id) && x.code.startsWith('SEC-')).every((x) => !ENGINE.isOpen(x)), chain: ENGINE.verifyChain().ok }; }""", inc)
    assert r == {"status": "closed", "gate": "released", "by": "IO1", "sec": True, "chain": True}
    assert "Closed" in page.locator("[data-rv-key='adm-incident-facts']").inner_text()
    assert page.errors == []


def test_retention_holds_go_through_engine(page):
    closed = page.evaluate("DEMO.keys.closed")
    go(page, "Tax Consultant", "retention")
    text = page.locator("[data-rv-key='adm-retention-holds']").inner_text()
    assert "VRF-2026-554310" in text and "Active" in text
    click(page, f"button[data-act='adm.holdAdd'][data-case='{closed}']")
    page.wait_for_selector("#dlg[open]")
    page.fill("#adm-hold-label", "Litigation notice")
    page.click("#dlg-ok")
    page.wait_for_function("document.getElementById('dlg-err').textContent.startsWith('Not done')")
    assert "Records/Compliance Owner" in page.locator("#dlg-err").inner_text()
    page.click("#dlg [data-close]")
    assert page.evaluate("id => ENGINE.caseById(id).retention.holds.length", closed) == 0

    go(page, "Records/Compliance Owner", "retention")
    click(page, f"button[data-act='adm.holdAdd'][data-case='{closed}']")
    page.wait_for_selector("#dlg[open]")
    page.click("#dlg-ok")
    assert page.locator("#dlg-err").inner_text() == "Say why the hold is needed."
    page.fill("#adm-hold-label", "Litigation notice " + EVIL)
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    hold = page.evaluate("id => ENGINE.caseById(id).retention.holds[0]", closed)
    assert hold["kind"] == "legal" and hold["released"] is None
    assert page.locator("#app img").count() == 0
    n0 = audit_len(page)
    click(page, f"button[data-act='adm.holdRel'][data-hold='{hold['id']}']")
    page.wait_for_selector("#dlg[open]")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    r = page.evaluate("""([id, n0]) => ({ rel: ENGINE.caseById(id).retention.holds[0].released.by, hit: S.audit.slice(n0).some((a) => a.result === 'Released' && a.gate === 'G16' && a.who === 'RC1') })""", [closed, n0])
    assert r == {"rel": "RC1", "hit": True}
    assert page.errors == []


def test_audit_trail_checks_the_chain_filters_and_downloads(page):
    go(page, "Tax Consultant", "audit")
    assert "The chain is intact" in page.locator("[data-rv-key='adm-audit-integrity']").inner_text()
    assert page.locator("[data-rv-key='adm-audit-trail'] tbody tr").count() == 100
    click(page, "button[data-act='adm.more']")
    assert page.locator("[data-rv-key='adm-audit-trail'] tbody tr").count() == 200
    page.select_option("#adm-af-actor", "ai")
    r = page.evaluate("""() => ({ shown: document.querySelectorAll('[data-rv-key="adm-audit-trail"] tbody tr').length, want: S.audit.filter((a) => a.actor === 'ai').length })""")
    assert r["shown"] == min(100, r["want"]) and r["want"] > 0
    page.select_option("#adm-af-actor", "all")
    page.fill("#adm-af-q", "MD-05")
    assert all("MD-05" in t for t in page.locator("[data-rv-key='adm-audit-trail'] tbody tr").all_inner_texts())
    with page.expect_download() as d:
        click(page, "button[data-act='adm.csv']")
    body = open(d.value.path(), encoding="utf-8").read()
    assert body == page.evaluate("ENGINE.auditCsv()")
    assert len(list(csv.reader(io.StringIO(body)))) == page.evaluate("S.audit.length") + 1
    with page.expect_download() as d:
        click(page, "button[data-act='adm.json']")
    data = json.load(open(d.value.path(), encoding="utf-8"))
    assert len(data) == page.evaluate("S.audit.length") and data[-1]["hash"] == page.evaluate("S.audit[S.audit.length - 1].hash")
    click(page, "button[data-act='adm.verify']")
    assert "The chain is intact" in toast(page)
    assert page.errors == []


def test_import_templates_download(page):
    go(page, "Administrator", "import")
    labels = page.evaluate("ADM.FIELDS.map((f) => f.label)")
    with page.expect_download() as d:
        click(page, "button[data-act='adm.tplXlsx']")
    assert d.value.suggested_filename.endswith(".xlsx")
    wb = openpyxl.load_workbook(io.BytesIO(open(d.value.path(), "rb").read()))
    assert wb.sheetnames == ["Clients", "Instructions"]
    assert [c.value for c in wb["Clients"][1]] == labels
    assert wb["Clients"]["A1"].number_format == "@"
    assert sum(1 for r in wb["Instructions"].iter_rows(values_only=True) if r[0] in labels) == len(labels)
    with page.expect_download() as d:
        click(page, "button[data-act='adm.tplCsv']")
    raw = open(d.value.path(), "rb").read()
    assert raw.startswith(b"\xef\xbb\xbf")
    assert next(csv.reader(io.StringIO(raw.decode("utf-8-sig")))) == labels
    assert page.errors == []


def _csv(rows, delim=","):
    out = io.StringIO()
    w = csv.writer(out, delimiter=delim, lineterminator="\r\n")
    w.writerow(["Surname", "First name", "RSA ID number", "Income tax reference number", "Email address", "Provisional taxpayer", "Street number and street or farm name", "City or town", "Bank", "Favourite colour"])
    w.writerows(rows)
    return out.getvalue()


def test_import_checks_each_field_then_creates_clients_through_engine(page):
    existing_ref = page.evaluate("S.clients[0].taxRef")
    text = _csv([
        ["Mahlaba", "Ntombi", "9001015009087", "1234567890", "ntombi@example.test", "Yes", "12 Oak Street", "Durban", "Demo Bank", "blue"],
        ["Example " + EVIL, "Johan", "8505055009081", "2234567890", "", "no", "", "", "", ""],
        ["Broken", "Row", "12345", existing_ref, "not-an-email", "maybe", "", "", "", ""],
    ])
    go(page, "Tax Consultant", "import")
    page.fill("#adm-imp-text", text)
    click(page, "button[data-act='adm.impCheck']")
    sec = page.locator("[data-rv-key='adm-import-check']")
    t = sec.inner_text()
    assert "3 rows checked" in t and "2 ready, 1 with errors" in t and "Favourite colour" in t
    assert "RSA ID number must be 13 digits." in t and "Already in the client master" in t and "not an email address" in t and "write Yes or No" in t
    assert "check digit does not match" in t  # 9001015009087 fails the SA ID check digit: a warning, not an error
    assert "Every column is kept in the client master" in t
    assert page.locator("#app img").count() == 0 and EVIL in t
    assert "9001015009087" not in sec.inner_html() and "1234567890" not in sec.inner_html()  # masked in the check table
    lock = sec.locator(".locked").inner_text()
    assert "Administrators only" in lock and sec.locator("button[data-act='adm.impCreate']").count() == 0

    go(page, "Administrator", "import")
    n0 = page.evaluate("[S.clients.length, S.audit.length]")
    click(page, "button[data-act='adm.impCreate']")
    page.wait_for_selector("#dlg[open]")
    assert page.locator("#dlg img").count() == 0
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    r = page.evaluate("""([c0, a0]) => { const added = S.clients.slice(c0);
        return { n: added.length, names: added.map((c) => c.name), prov: added.map((c) => c.provisional), kyc: added.every((c) => c.kyc.every((k) => !k.ok)),
          audit: S.audit.slice(a0).filter((a) => a.text.startsWith('Added client')).length, chain: ENGINE.verifyChain().ok }; }""", n0)
    assert r["n"] == 2 and r["names"] == ["Ntombi Mahlaba", "Johan Example " + EVIL] and r["prov"] == [True, False]
    assert r["kyc"] and r["audit"] == 2 and r["chain"]
    assert page.locator("[data-rv-key='adm-import-done'] a[href^='#client-']").count() == 2
    assert page.locator("#app img").count() == 0
    assert page.errors == []


def test_import_reads_an_uploaded_semicolon_csv(page):
    go(page, "Administrator", "import")
    body = "﻿" + _csv([["Mahlaba", "Ntombi", "9001015009087", "1234567890", "ntombi@example.test", "Yes", "12 Oak Street", "Durban", "Demo Bank", ""]], ";")
    page.set_input_files("#adm-imp-file", files=[{"name": "clients.csv", "mimeType": "text/csv", "buffer": body.encode("utf-8")}])
    page.wait_for_selector("[data-rv-key='adm-import-check']")
    t = page.locator("[data-rv-key='adm-import-check']").inner_text()
    assert "1 row checked from clients.csv: 1 ready" in t
    page.set_input_files("#adm-imp-file", files=[{"name": "clients.xlsx", "mimeType": "application/octet-stream", "buffer": b"PK"}])
    page.wait_for_function("document.querySelector('[data-rv-key=\"adm-import-upload\"] .err')")
    assert "Save As > CSV UTF-8" in page.locator("[data-rv-key='adm-import-upload'] .err").inner_text()
    assert page.errors == []


def test_client_names_are_escaped_everywhere(page):
    # The name, and an exception note on the client's case (shown on Clients, the client page and the audit trail).
    page.evaluate("""n => { const cl = ENGINE.newClient({ name: n }); const c = ENGINE.newCase(cl, {});
        ENGINE.raise(c, 'MD-01', { by: ACTOR.ai(), note: n }); ENGINE.raise(c, 'KYC-01', { by: ACTOR.ai(), note: n }); }""", EVIL)
    cl = page.evaluate("S.clients[S.clients.length - 1].id")
    for route in ["clients", "client-" + cl, "deadlines", "audit", "retention", "incidents", "controls"]:
        go(page, "Administrator", route)
        assert page.locator("#app img").count() == 0 and page.locator("#app [onerror]").count() == 0, route
    go(page, "Administrator", "client-" + cl)
    assert EVIL in page.locator("[data-rv-key='adm-client-sars']").inner_text()
    go(page, "Administrator", "client-" + cl)
    assert page.locator("#app h1").inner_text() == EVIL
    assert page.errors == []


def test_identities_are_masked_on_every_admin_screen(page):
    ids = page.evaluate("S.clients.map((c) => [c.idNo, c.taxRef])")
    routes = list(SCREENS) + ["client-" + client_of(page, "details")]
    for role in ["Tax Consultant", "Administrator"]:
        for route in routes:
            go(page, role, route)
            html = page.evaluate("document.getElementById('app').innerHTML")
            for id_no, tax_ref in ids:
                assert id_no not in html and tax_ref not in html, (role, route)
    assert page.errors == []


@pytest.mark.parametrize("width,scheme", [(390, "dark"), (1280, "light")])
def test_admin_screens_never_scroll_sideways(browser, site, width, scheme):
    ctx = browser.new_context(timezone_id=TZ, viewport={"width": width, "height": 900}, color_scheme=scheme)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(site + "#today")
    pg.wait_for_function("typeof ADM !== 'undefined' && !!S && S.cases.length > 0")
    pg.evaluate("() => TICKERS.splice(0)")
    for role in ROLES:
        for route in SCREENS:
            go(pg, role, route)
            assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), (role, route)
    ctx.close()
    assert errors == []
