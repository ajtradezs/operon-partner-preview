"""Try it (src/itr12/views-try.js): every role sees the scenarios with review keys; each one-click scenario goes through ENGINE
(S.audit grows, the expected codes are raised, refusals carry their reason and are audited), says what happened and links to
where to look; reset re-seeds the demo; dynamic text is escaped; nothing scrolls sideways."""
import pytest

TZ = "Africa/Johannesburg"
ROLES = ["Tax Consultant", "Administrator", "Integration Administrator", "Information Officer", "Records/Compliance Owner"]
SCEN = ["wrong", "drag", "timeout", "withdraw", "ruleset", "malware", "override"]


@pytest.fixture
def page(browser, site):
    ctx = browser.new_context(timezone_id=TZ, viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.on("dialog", lambda d: (pg.errors.append("native dialog: " + d.message), d.dismiss()))
    pg.goto(site + "#today")
    pg.wait_for_function("typeof VK !== 'undefined' && typeof DEMO !== 'undefined' && !!S && S.cases.length > 0")
    pg.evaluate("() => { TICKERS.splice(0); DEMO.cases = true; seed(); }")
    yield pg
    ctx.close()


def as_role(pg, role):
    pg.evaluate("r => { S.signedIn = true; S.role = r; if (location.hash !== '#try') location.hash = '#try'; render(); }", role)
    pg.wait_for_selector("#app [data-rv-key='ps-try-grid']")


def run(pg, sid):
    """Click a scenario's button (through the review layer's tip) and return what changed."""
    n0 = pg.evaluate("[S.audit.length, S.exceptions.length, S.cases.length]")
    pg.locator(f"button[data-act='ps.try'][data-id='{sid}']").first.evaluate("el => el.click()")
    return pg.evaluate("""([a0, x0, c0]) => ({ audit: S.audit.length - a0, raised: S.exceptions.slice(x0).map((x) => x.code), newCases: S.cases.slice(c0).map((c) => c.id),
        chain: ENGINE.verifyChain().ok, toast: document.getElementById('toasts').textContent })""", n0)


def result(pg, sid):
    sec = f"[data-rv-key='ps-try-{'ruleset' if sid == 'restore' else sid}'] .ps-res"
    return pg.evaluate(f"""() => {{ const r = document.querySelector("{sec}"); return r ? {{ text: r.innerText, cls: r.className,
        links: Array.from(r.querySelectorAll('.ps-res-a a')).map((a) => a.getAttribute('href')) }} : null; }}""")


def test_try_renders_for_every_role_with_review_keys(page):
    for role in ROLES:
        as_role(page, role)
        page.wait_for_function("document.querySelectorAll('#app [data-rv-b]').length > 0")
        keys = page.evaluate("Array.from(document.querySelectorAll('#app [data-rv-key]')).map((e) => e.getAttribute('data-rv-key'))")
        for k in ["ps-try-head", "ps-try-grid"] + ["ps-try-" + s for s in SCEN]:
            assert k in keys, (role, k)
        blocks = page.evaluate("Array.from(document.querySelectorAll('#app [data-rv-b]')).map((e) => e.getAttribute('data-rv-key'))")
        assert blocks and all(k.startswith("ps-try-") for k in blocks), (role, blocks)
        assert page.locator("button[data-act='ps.reset']").count() == 1
    assert page.errors == []


def test_wrong_taxpayer_upload(page):
    as_role(page, "Tax Consultant")
    r = run(page, "wrong")
    assert r["audit"] > 0 and r["chain"] and len(r["newCases"]) == 1
    assert {"DOC-04", "SEC-01"} <= set(r["raised"])
    c = r["newCases"][0]
    st = page.evaluate("""id => { const c = ENGINE.caseById(id); return { doc: c.docs.slice(-1)[0].status, inc: S.incidents.some((i) => i.caseId === id && i.status === 'open'),
        byClient: S.audit.some((a) => a.caseId === id && a.role === 'Client' && /^Uploaded IRP5_2026_Naledi/.test(a.text)) }; }""", c)
    assert st == {"doc": "quarantined", "inc": True, "byClient": True}
    res = result(page, "wrong")
    assert "DOC-04" in res["text"] and "simulated" in res["text"]
    assert f"#case-{c}" in res["links"] and f"#portal-{c}" in res["links"] and any(h.startswith("#incident-") for h in res["links"])
    assert page.errors == []


def test_dragging_past_a_gate_is_refused_and_audited(page):
    for role, who in [("Tax Consultant", "TC1"), ("Administrator", "AD1")]:
        as_role(page, role)
        r = run(page, "drag")
        case = page.evaluate("DEMO.keys.details")
        st = page.evaluate("""([id, who]) => ({ g02: ENGINE.caseById(id).gates.G02.status, col: ENGINE.columnOf(ENGINE.caseById(id)),
            refused: S.audit.some((a) => a.caseId === id && a.who === who && a.result === 'Refused') })""", [case, who])
        assert st == {"g02": "pending", "col": "sars-details", "refused": True}, role
        assert r["audit"] >= 1 and r["raised"] == []
        res = result(page, "drag")
        assert res["text"].startswith("Refused:") and "ps-res-stop" in res["cls"], role
        assert f"#case-{case}" in res["links"] and "#cases" in res["links"]
    assert "MD-05" in result(page, "drag")["text"]
    assert page.errors == []


def test_sars_timeout_has_no_blind_retry(page):
    for role in ["Integration Administrator", "Tax Consultant"]:
        as_role(page, role)
        r = run(page, "timeout")
        assert "INT-04" in r["raised"] and r["chain"]
        c = r["newCases"][0]
        me = page.evaluate("ME_BY_ROLE[S.role]")
        st = page.evaluate("""([id, me]) => { const t = S.txs.filter((x) => x.caseId === id && x.fn === 'itr12').pop();
            return { status: t.status, attempts: t.attempts.length, refused: S.audit.some((a) => a.caseId === id && a.who === me && a.result === 'Refused' && a.sarsTx === t.id) }; }""", [c, me])
        assert st == {"status": "unknown", "attempts": 1, "refused": True}, role
        res = result(page, "timeout")
        assert "Refused:" in res["text"] and "#sars" in res["links"]
        # The engine's own no-blind-retry refusal is shown for every role, not only the role check.
        tx = page.evaluate("id => S.txs.filter((x) => x.caseId === id && x.fn === 'itr12').pop().id", c)
        assert f"Refused: The status of {tx} is not known" in res["text"], role
        assert page.evaluate("id => S.audit.filter((a) => a.caseId === id && a.result === 'Refused' && /never retried blindly/.test(a.reason || '')).length", c) >= 1, role
    assert page.errors == []


def test_client_withdrawing_approval(page):
    as_role(page, "Information Officer")
    r = run(page, "withdraw")
    assert "CLT-06" in r["raised"]
    c = r["newCases"][0]
    st = page.evaluate("""id => { const c = ENGINE.caseById(id); return { g06: c.gates.G06.status !== 'released', withdrawn: !!c.approval.withdrawn,
        byClient: S.audit.some((a) => a.caseId === id && a.role === 'Client' && a.result === 'Withdrawn') }; }""", c)
    assert st == {"g06": True, "withdrawn": True, "byClient": True}
    assert "CLT-06" in result(page, "withdraw")["text"]
    assert page.errors == []


def test_ruleset_change_then_restore_and_rerun(page):
    as_role(page, "Tax Consultant")
    r = run(page, "ruleset")
    assert page.evaluate("S.rulesetVersion") == "2027.1"
    assert "AI-07" in r["raised"] and "TAX-06" in r["raised"]
    judged = page.evaluate("DEMO.keys.calcReady")
    assert page.evaluate("id => ENGINE.hasOpen(ENGINE.caseById(id), 'TAX-06') && ENGINE.caseById(id).rerun", judged)
    assert "2027.1" in result(page, "ruleset")["text"]
    r = run(page, "restore")
    st = page.evaluate("""id => { const c = ENGINE.caseById(id); return { v: S.rulesetVersion, rerun: c.rerun, calc: c.calc.ruleset,
        guard: ENGINE.resolveGuard(c, ENGINE.exOf(c).find((x) => x.code === 'TAX-06' && ENGINE.isOpen(x))) }; }""", judged)
    assert st == {"v": "2026.1", "rerun": False, "calc": "2026.1", "guard": None}
    res = result(page, "restore")
    assert res["text"].startswith("Restored 2026.1") and "#exceptions" in res["links"]
    assert page.evaluate("S.audit.some((a) => a.who === 'Platform Product Owner (simulated)' && a.after === '2026.1')")
    assert page.errors == []


def test_malware_upload_is_quarantined(page):
    as_role(page, "Records/Compliance Owner")
    r = run(page, "malware")
    assert "DOC-10" in r["raised"]
    c = r["newCases"][0]
    assert page.evaluate("id => ENGINE.caseById(id).docs.slice(-1)[0].status", c) == "quarantined"
    assert "quarantined" in result(page, "malware")["text"]
    assert page.errors == []


def test_override_on_missing_authority_is_refused(page):
    for role, who in [("Tax Consultant", "TC1"), ("Records/Compliance Owner", "RC1")]:
        as_role(page, role)
        r = run(page, "override")
        assert "CLT-04" in r["raised"]
        c = r["newCases"][0]
        st = page.evaluate("""([id, who]) => { const x = ENGINE.exOf(ENGINE.caseById(id)).find((y) => y.code === 'CLT-04');
            return { override: x.override, refused: S.audit.some((a) => a.exceptionId === x.id && a.who === who && a.result === 'Refused' && /missing taxpayer authority/.test(a.reason)) }; }""", [c, who])
        assert st == {"override": None, "refused": True}, role
        res = result(page, "override")
        assert res["text"].startswith("Refused: No override may bypass missing taxpayer authority"), role
    assert page.errors == []


def test_reset_reseeds_the_demo(page):
    as_role(page, "Administrator")
    run(page, "wrong")
    run(page, "ruleset")
    assert page.evaluate("S.cases.length") == 17
    page.locator("button[data-act='ps.reset']").evaluate("el => el.click()")
    r = page.evaluate("""() => ({ cases: S.cases.length, ruleset: S.rulesetVersion, problems: DEMO.problems.length, signedIn: S.signedIn, role: S.role,
        results: document.querySelectorAll('#app .ps-res').length, chain: ENGINE.verifyChain().ok })""")
    assert r == {"cases": 16, "ruleset": "2026.1", "problems": 0, "signedIn": True, "role": "Administrator", "results": 0, "chain": True}
    assert page.errors == []


def test_try_results_escape_names(page):
    evil = "<img src=x onerror=alert(1)>"
    page.evaluate("n => { S.clients.find((c) => c.id === ENGINE.caseById(DEMO.keys.details).clientId).name = n; }", evil)
    as_role(page, "Tax Consultant")
    run(page, "drag")
    r = page.evaluate("n => ({ imgs: document.querySelectorAll('#app img').length, shown: document.querySelector('[data-rv-key=\"ps-try-drag\"]').textContent.includes(n) })", evil)
    assert r == {"imgs": 0, "shown": True}
    assert page.errors == []


@pytest.mark.parametrize("width,scheme", [(390, "dark"), (1280, "light")])
def test_try_never_scrolls_sideways(browser, site, width, scheme):
    ctx = browser.new_context(timezone_id=TZ, viewport={"width": width, "height": 900}, color_scheme=scheme)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(site + "#today")
    pg.wait_for_function("typeof VK !== 'undefined' && !!S && S.cases.length > 0")
    pg.evaluate("() => TICKERS.splice(0)")
    as_role(pg, "Tax Consultant")
    for sid in SCEN:
        run(pg, sid)
    for role in ROLES:
        as_role(pg, role)
        assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), role
    ctx.close()
    assert errors == []
