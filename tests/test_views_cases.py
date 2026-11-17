"""The Cases board (src/itr12/views-cases.js) and the case page (src/itr12/views-case.js) on the seeded demo firm: every role sees
the sections with their review keys, the demo cases sit where ENGINE puts them, every move and action goes through ENGINE (the
audit trail grows and a refusal shows its reason), dynamic text is escaped and identities masked, and nothing scrolls sideways."""
import pytest

TZ = "Africa/Johannesburg"
ROLES = ["Tax Consultant", "Administrator", "Integration Administrator", "Information Officer", "Records/Compliance Owner"]
COLUMNS = ["onboarding", "sars-details", "questionnaire", "documents", "calculation", "client-approval", "final-checks", "submission",
           "after-filing", "assessment", "decision", "closed"]
CASE_ALWAYS = ["cases-case-head", "cases-case-summary", "cases-case-gates", "cases-case-exceptions", "cases-case-sources", "cases-case-checklist",
               "cases-case-documents", "cases-case-calc", "cases-case-approval", "cases-case-sars", "cases-case-audit", "cases-case-retention"]
# Sections that appear only when they apply: the demo case that shows each one.
CASE_WHEN = {"cases-case-da": ["declaration"], "cases-case-verification": ["verification"], "cases-case-ita34": ["assessment", "remedy", "closed"]}


@pytest.fixture
def page(browser, site):
    """A fresh seeded firm per test (the moves change state). The demo clock's ticker is stopped so nothing renders by itself."""
    ctx = browser.new_context(timezone_id=TZ, viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.on("dialog", lambda d: (pg.errors.append("native dialog: " + d.message), d.dismiss()))
    pg.goto(site + "#today")
    pg.wait_for_function("typeof CASES_BOARD !== 'undefined' && typeof DEMO !== 'undefined' && !!S && S.cases.length > 0")
    pg.evaluate("() => { TICKERS.splice(0); DEMO.cases = true; seed(); try { localStorage.removeItem('op-cases-view'); } catch (e) {} }")
    yield pg
    ctx.close()


def go(pg, role, hash_):
    """Sign in as a role the way the shell's code form does, then render the route synchronously."""
    pg.evaluate("([r, h]) => { S.signedIn = true; S.role = r; if (location.hash !== h) history.replaceState(null, '', h); render(); }", [role, hash_])


def click(pg, selector):
    """Click through the review layer's first-visit tip, which may sit over the page."""
    pg.locator(selector).first.evaluate("el => el.click()")


def case_of(pg, key):
    return pg.evaluate("k => DEMO.keys[k]", key)


def test_board_renders_for_every_role_with_cases_in_their_columns(page):
    for role in ROLES:
        go(page, role, "#cases")
        page.wait_for_function("document.querySelectorAll('#app [data-rv-b]').length > 0")
        r = page.evaluate("""() => ({
            keys: Array.from(document.querySelectorAll('#app [data-rv-key]')).map((e) => e.getAttribute('data-rv-key')),
            blocks: Array.from(document.querySelectorAll('#app [data-rv-b]')).map((e) => e.getAttribute('data-rv-key')),
            cols: Array.from(document.querySelectorAll('#app .cb-col')).map((e) => e.dataset.col),
            cards: Object.fromEntries(Array.from(document.querySelectorAll('#app .cb-card')).map((e) => [e.dataset.case, e.closest('.cb-list').dataset.col])),
            want: Object.fromEntries(S.cases.map((c) => [c.id, ENGINE.columnOf(c)])) })""")
        assert "cases-head" in r["keys"] and "cases-board" in r["keys"], role
        assert r["blocks"] and all(k.startswith("cases-") for k in r["blocks"]), (role, r["blocks"])
        assert r["cols"] == COLUMNS, role
        assert r["cards"] == r["want"], role
    # The plan's stages: one demo case per column, as the engine places them.
    where = page.evaluate("() => Object.fromEntries(Object.entries(DEMO.keys).map(([k, id]) => [k, document.querySelector(`.cb-card[data-case='${id}']`).closest('.cb-list').dataset.col]))")
    assert where["onboarding"] == "onboarding" and where["details"] == "sars-details" and where["questionnaire"] == "questionnaire"
    assert where["documents"] == where["wrongTaxpayer"] == "documents"
    assert where["judgement"] == where["calcReady"] == "calculation"
    assert where["approval"] == where["rework"] == "client-approval"
    assert where["ready"] == where["unknown"] == "submission"
    assert where["declaration"] == where["verification"] == "after-filing"
    assert where["assessment"] == "assessment" and where["remedy"] == "decision" and where["closed"] == "closed"
    # Codes named by the plan show on their cards; the incident is a badge on the card, not a column.
    codes = page.evaluate("""() => Object.fromEntries(Object.entries(DEMO.keys).map(([k, id]) => [k,
        Array.from(document.querySelectorAll(`.cb-card[data-case='${id}'] .vk-code`)).map((e) => e.textContent)]))""")
    assert {"KYC-01", "KYC-05"} <= set(codes["onboarding"]) and {"MD-05", "MD-01"} <= set(codes["details"])
    assert {"DOC-04", "SEC-01"} <= set(codes["wrongTaxpayer"]) and {"TAX-02", "TAX-05"} <= set(codes["judgement"])
    assert "INT-04" in codes["unknown"] and {"DA-01", "DA-05"} <= set(codes["declaration"]) and "ASM-02" in codes["assessment"]
    inc = page.evaluate("id => ({ badge: !!document.querySelector(`.cb-card[data-case='${id}'] .cb-inc[href^='#incident-']`), col: !!document.querySelector('.cb-col[data-col*=incident]') })", case_of(page, "wrongTaxpayer"))
    assert inc == {"badge": True, "col": False}
    assert page.errors == []


def test_table_view_is_sorted_by_deadline(page):
    go(page, "Tax Consultant", "#cases")
    click(page, "button[data-act='cases.mode'][data-mode='table']")
    page.wait_for_selector("[data-rv-key='cases-table']")
    r = page.evaluate("""() => {
        const rows = Array.from(document.querySelectorAll('[data-rv-key="cases-table"] tbody tr'));
        const dl = {}; VK.deadlines({ days: 100000 }).forEach((d) => { if (d.c && !dl[d.c.id]) dl[d.c.id] = d.date; });
        const ids = rows.map((tr) => tr.querySelector('a[href^="#case-"]').getAttribute('href').slice(6));
        return { ids, dates: ids.map((id) => dl[id] || null), n: S.cases.length, board: !!document.querySelector('[data-rv-key="cases-board"]'),
          pressed: document.querySelector('button[data-mode="table"]').getAttribute('aria-pressed') }; }""")
    assert len(r["ids"]) == r["n"] and not r["board"] and r["pressed"] == "true"
    dated = [d for d in r["dates"] if d]
    assert dated == sorted(dated)
    assert r["dates"][:len(dated)] == dated  # cases with no deadline come last
    click(page, "button[data-act='cases.mode'][data-mode='board']")
    page.wait_for_selector("[data-rv-key='cases-board']")
    assert page.errors == []


def test_case_page_renders_for_every_role_and_every_case(page):
    for role in ROLES:
        r = page.evaluate("""r => { S.signedIn = true; S.role = r; const out = {};
            Object.entries(DEMO.keys).forEach(([k, id]) => {
              history.replaceState(null, '', '#case-' + id); render();
              out[k] = { keys: Array.from(document.querySelectorAll('#app [data-rv-key]')).map((e) => e.getAttribute('data-rv-key')),
                gates: document.querySelectorAll('[data-rv-key="cases-case-gates"] tbody tr').length,
                h1: document.querySelector('#app h1').textContent, id };
            }); return out; }""", role)
        for k, v in r.items():
            assert v["h1"].startswith(v["id"] + " · "), (role, k)
            for key in CASE_ALWAYS:
                assert key in v["keys"], (role, k, key)
            for key, demo in CASE_WHEN.items():
                assert (key in v["keys"]) == (k in demo), (role, k, key)
            assert v["gates"] == 18, (role, k)
            assert all(x.startswith("cases-") for x in v["keys"]), (role, k)
    go(page, "Tax Consultant", "#case-C99")
    assert page.locator("#app h1").inner_text() == "Case not found"
    assert page.errors == []


def test_case_page_content_matches_engine(page):
    go(page, "Tax Consultant", "#case-" + case_of(page, "verification"))
    v = page.evaluate("""() => { const t = document.querySelector('[data-rv-key="cases-case-verification"]').textContent;
        const c = ENGINE.caseById(DEMO.keys.verification);
        return { ref: t.includes(c.vrf.ref), clock: t.includes('21-business-day'), drafts: c.vrf.drafts.every((d) => t.includes(d.q)) }; }""")
    assert v == {"ref": True, "clock": True, "drafts": True}
    go(page, "Tax Consultant", "#case-" + case_of(page, "declaration"))
    d = page.evaluate("""() => { const t = document.querySelector('[data-rv-key="cases-case-da"]').textContent; const c = ENGINE.caseById(DEMO.keys.declaration);
        return c.da.drafts.length > 0 && c.da.drafts.every((x) => t.includes(x.q)) && t.includes(c.da.ref); }""")
    assert d
    go(page, "Tax Consultant", "#case-" + case_of(page, "assessment"))
    a = page.evaluate("""() => { const sec = document.querySelector('[data-rv-key="cases-case-ita34"]'); const c = ENGINE.caseById(DEMO.keys.assessment);
        return { rows: sec.querySelectorAll('tbody tr').length, diff: sec.querySelectorAll('tr.cs-diff').length, want: c.ita34.recon.diffs.length, fields: ITA34_FIELDS.length }; }""")
    assert a["rows"] == a["fields"] and a["diff"] == a["want"] > 0
    go(page, "Tax Consultant", "#case-" + case_of(page, "judgement"))
    j = page.evaluate("""() => { const c = ENGINE.caseById(DEMO.keys.judgement); const sec = document.querySelector('[data-rv-key="cases-case-calc"]');
        const docs = document.querySelector('[data-rv-key="cases-case-documents"]');
        return { lines: c.calc.lines.every((l) => sec.textContent.includes(l.label)), ruleset: sec.textContent.includes(c.calc.ruleset),
          decide: sec.querySelectorAll('button[data-act="cases.decide"]').length, pending: c.calc.pending.length,
          lineage: docs.querySelectorAll('tbody tr').length, want: c.docs.length + CALC.lineage(c).length }; }""")
    assert j["lines"] and j["ruleset"] and j["decide"] == j["pending"] == 1 and j["lineage"] == j["want"]
    assert page.errors == []


def test_dragging_forward_past_a_blocked_gate_snaps_back_and_lists_codes(page):
    go(page, "Tax Consultant", "#cases")
    case = case_of(page, "details")
    n0 = page.evaluate("S.audit.length")
    page.evaluate("id => CASES_BOARD.drop(id, 'questionnaire')", case)
    r = page.evaluate("""([id, n0]) => ({ col: document.querySelector(`.cb-card[data-case='${id}']`).closest('.cb-list').dataset.col,
        g02: ENGINE.caseById(id).gates.G02.status, codes: Array.from(document.querySelectorAll('.cb-last .vk-code')).map((e) => e.textContent),
        refused: S.audit.slice(n0).filter((a) => a.caseId === id && a.result === 'Refused' && a.who === 'TC1').length,
        toast: document.getElementById('toasts').textContent, last: document.querySelector('.cb-last').textContent })""", [case, n0])
    assert r["col"] == "sars-details" and r["g02"] == "pending"
    assert {"MD-05"} <= set(r["codes"]) and r["refused"] >= 1
    assert r["toast"].startswith("Not done") and "MD-05" in r["last"]
    # Two columns at once is refused too (and audited).
    n1 = page.evaluate("S.audit.length")
    page.evaluate("id => CASES_BOARD.drop(id, 'calculation')", case_of(page, "onboarding"))
    assert page.evaluate("n => S.audit.slice(n).some((a) => a.result === 'Refused' && /one column at a time/.test(a.reason))", n1)
    assert page.errors == []


def test_next_stage_button_releases_the_gate_through_engine(page):
    go(page, "Tax Consultant", "#cases")
    case = case_of(page, "calcReady")
    n0 = page.evaluate("S.audit.length")
    click(page, f".cb-card[data-case='{case}'] button[data-act='cases.fwd']")
    r = page.evaluate("""([id, n0]) => { const c = ENGINE.caseById(id); const fresh = S.audit.slice(n0);
        return { g05: c.gates.G05.status, by: c.gates.G05.by, col: ENGINE.columnOf(c),
          shown: document.querySelector(`.cb-card[data-case='${id}']`).closest('.cb-list').dataset.col,
          released: fresh.some((a) => a.gate === 'G05' && a.result === 'Released' && a.who === 'TC1'), moved: fresh.some((a) => a.result === 'Moved'),
          chain: ENGINE.verifyChain().ok, toast: document.getElementById('toasts').textContent }; }""", [case, n0])
    assert r["g05"] == "released" and r["by"] == ["TC1"] and r["col"] == r["shown"] == "client-approval"
    assert r["released"] and r["moved"] and r["chain"] and "Moved" in r["toast"]
    assert page.errors == []


def test_client_gates_and_other_roles_are_refused(page):
    go(page, "Tax Consultant", "#cases")
    approval = case_of(page, "approval")
    n0 = page.evaluate("S.audit.length")
    click(page, f".cb-card[data-case='{approval}'] button[data-act='cases.fwd']")
    r = page.evaluate("""([id, n0]) => ({ g06: ENGINE.caseById(id).gates.G06.status, last: document.querySelector('.cb-last').textContent,
        refused: S.audit.slice(n0).some((a) => a.caseId === id && a.result === 'Refused' && /PaperSync portal/.test(a.reason)) })""", [approval, n0])
    assert r["g06"] == "pending" and "PaperSync portal" in r["last"] and r["refused"]

    go(page, "Administrator", "#cases")
    case = case_of(page, "calcReady")
    n1 = page.evaluate("S.audit.length")
    click(page, f".cb-card[data-case='{case}'] button[data-act='cases.fwd']")
    r = page.evaluate("""([id, n]) => ({ g05: ENGINE.caseById(id).gates.G05.status, toast: document.getElementById('toasts').textContent,
        refused: S.audit.slice(n).some((a) => a.caseId === id && a.result === 'Refused' && a.who === 'AD1') })""", [case, n1])
    assert r["g05"] == "pending" and r["refused"] and "Not done" in r["toast"]
    assert page.errors == []


def test_return_for_rework_asks_for_a_reason(page):
    go(page, "Tax Consultant", "#cases")
    case = case_of(page, "calcReady")
    click(page, f".cb-card[data-case='{case}'] button[data-act='cases.back']")
    page.wait_for_selector("#dlg[open]")
    page.click("#dlg-ok")
    assert page.locator("#dlg-err").inner_text() == "Write the reason for the rework."
    page.select_option("#cb-rw-to", "documents")
    page.fill("#cb-rw-reason", "Medical certificate is for the wrong scheme year")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    r = page.evaluate("""id => { const c = ENGINE.caseById(id);
        return { col: ENGINE.columnOf(c), shown: document.querySelector(`.cb-card[data-case='${id}']`).closest('.cb-list').dataset.col,
          g04: c.gates.G04.status, rework: c.gates.G04.rework && c.gates.G04.rework.reason,
          audit: S.audit.some((a) => a.caseId === id && a.result === 'Rework' && a.who === 'TC1') }; }""", case)
    assert r == {"col": "documents", "shown": "documents", "g04": "invalidated", "rework": "Medical certificate is for the wrong scheme year", "audit": True}

    # Another role: the engine refuses, the dialog stays open with the reason, and the refusal is audited.
    go(page, "Information Officer", "#cases")
    other = case_of(page, "judgement")
    page.evaluate("id => CASES_BOARD.drop(id, 'documents')", other)
    page.wait_for_selector("#dlg[open]")
    page.fill("#cb-rw-reason", "Trying anyway")
    page.click("#dlg-ok")
    page.wait_for_function("document.getElementById('dlg-err').textContent.startsWith('Not done')")
    r = page.evaluate("""id => ({ open: document.getElementById('dlg').open, col: ENGINE.columnOf(ENGINE.caseById(id)),
        refused: S.audit.some((a) => a.caseId === id && a.result === 'Refused' && a.who === 'IO1') })""", other)
    assert r == {"open": True, "col": "calculation", "refused": True}
    assert page.errors == []


def test_real_drag_is_gate_checked_and_defers_rendering(page):
    go(page, "Tax Consultant", "#cases")
    if not page.evaluate("!!window.Sortable"):
        try:
            page.wait_for_function("!!window.Sortable", timeout=8000)
        except Exception:
            pytest.skip("Sortable did not load from its CDN here; the button and drop tests cover the moves")
        go(page, "Tax Consultant", "#cases")
    page.wait_for_function("document.querySelectorAll('.cb-list').length === 12 && !!Sortable.get(document.querySelector('.cb-list'))")
    page.add_style_tag(content=".rv-bar,.rv-tip,[data-rv-ui]{display:none!important}")
    case = case_of(page, "details")
    n0 = page.evaluate("S.audit.length")
    src = page.locator(f".cb-card[data-case='{case}'] .cb-meta").bounding_box()
    dst = page.locator(".cb-list[data-col='questionnaire']").bounding_box()
    page.mouse.move(src["x"] + 10, src["y"] + src["height"] / 2)
    page.mouse.down()
    page.mouse.move(src["x"] + 30, src["y"] + 20, steps=5)
    page.mouse.move(dst["x"] + dst["width"] / 2, dst["y"] + dst["height"] - 10, steps=20)
    held = page.evaluate("() => { render(); return { pending: REVIEW.pending, busy: REVIEW.busy() }; }")
    page.mouse.up()
    page.wait_for_function("n => S.audit.length > n", arg=n0)
    r = page.evaluate("""([id, n0]) => ({ col: document.querySelector(`.cb-card[data-case='${id}']`).closest('.cb-list').dataset.col,
        refused: S.audit.slice(n0).some((a) => a.caseId === id && a.result === 'Refused'), busy: REVIEW.busy() })""", [case, n0])
    assert held == {"pending": True, "busy": True}
    assert r == {"col": "sars-details", "refused": True, "busy": False}
    # Arranging the page (the review layer) switches card dragging off.
    on = page.evaluate("async () => { RV.arranging = true; render(); await new Promise((r) => setTimeout(r, 0)); const s = !!Sortable.get(document.querySelector('.cb-list')); RV.arranging = false; render(); await new Promise((r) => setTimeout(r, 0)); return [s, !!Sortable.get(document.querySelector('.cb-list'))]; }")
    assert on == [False, True]
    assert page.errors == []


def test_case_page_actions_go_through_engine(page):
    case = case_of(page, "judgement")
    go(page, "Administrator", "#case-" + case)
    n0 = page.evaluate("S.audit.length")
    click(page, "[data-rv-key='cases-case-calc'] button[data-act='cases.recalc']")
    page.wait_for_selector("#dlg[open]")
    page.click("#dlg-ok")
    page.wait_for_function("document.getElementById('dlg-err').textContent.startsWith('Not done')")
    assert page.evaluate("([id, n]) => ENGINE.caseById(id).versions.length === 1 && S.audit.slice(n).some((a) => a.result === 'Refused' && a.who === 'AD1')", [case, n0])
    page.click("#dlg button[data-close]")

    go(page, "Tax Consultant", "#case-" + case)
    click(page, "[data-rv-key='cases-case-calc'] button[data-act='cases.decide']")
    page.wait_for_selector("#dlg[open]")
    page.click("#dlg-ok")
    page.wait_for_function("document.getElementById('dlg-err').textContent.startsWith('Not done')")  # no rationale: the engine refuses
    page.fill("#cs-dec-amount", "18000")
    page.fill("#cs-dec-why", "Dedicated room, 12% of the floor area; s11(a) and s23(b) met")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    click(page, "[data-rv-key='cases-case-calc'] button[data-act='cases.recalc']")
    page.wait_for_selector("#dlg[open]")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    r = page.evaluate("""id => { const c = ENGINE.caseById(id); const l = c.inputs.lines.find((x) => x.field === 'homeOffice');
        return { amount: l.amount, by: l.decided.by, versions: c.versions.length, pending: c.calc.pending.length,
          decided: S.audit.some((a) => a.caseId === id && a.result === 'Decided' && a.who === 'TC1'),
          version: S.audit.some((a) => a.caseId === id && a.result === 'Version' && a.who === 'TC1'),
          shown: document.querySelectorAll('[data-rv-key="cases-case-calc"] button[data-act="cases.decide"]').length, chain: ENGINE.verifyChain().ok }; }""", case)
    assert r == {"amount": 18000, "by": "TC1", "versions": 2, "pending": 0, "decided": True, "version": True, "shown": 0, "chain": True}

    # The kit's release from the gate table, on the clean calculation.
    ready = case_of(page, "calcReady")
    go(page, "Tax Consultant", "#case-" + ready)
    click(page, f"[data-rv-key='cases-case-gates'] button[data-act='vk.release'][data-gate='G05']")
    page.wait_for_selector("#dlg[open]")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    assert page.evaluate("id => ENGINE.caseById(id).gates.G05.status", ready) == "released"
    assert page.errors == []


def test_dynamic_text_is_escaped(page):
    evil = "<img src=x onerror=alert(1)>"
    cid = page.evaluate("""n => { const cl = ENGINE.newClient({ name: n }); const c = ENGINE.newCase(cl, {});
        ENGINE.raise(c, 'KYC-01', { by: ACTOR.system(), note: n }); return c.id; }""", evil)
    go(page, "Tax Consultant", "#cases")
    r = page.evaluate("n => ({ imgs: document.querySelectorAll('#app img').length, shown: document.getElementById('app').textContent.includes(n) })", evil)
    assert r == {"imgs": 0, "shown": True}
    click(page, "button[data-act='cases.mode'][data-mode='table']")
    assert page.evaluate("n => document.querySelectorAll('#app img').length === 0 && document.getElementById('app').textContent.includes(n)", evil)
    go(page, "Tax Consultant", "#case-" + cid)
    r = page.evaluate("n => ({ imgs: document.querySelectorAll('#app img').length, h1: document.querySelector('#app h1').textContent, note: document.querySelector('[data-rv-key=\"cases-case-exceptions\"]').textContent.includes(n) })", evil)
    assert r == {"imgs": 0, "h1": cid + " · " + evil, "note": True}
    click(page, f".pagehead button[data-act='cases.fwd'][data-case='{cid}']")
    assert page.evaluate("document.querySelectorAll('#app img, #toasts img').length") == 0
    assert page.errors == []


def test_identities_are_masked(page):
    ids = page.evaluate("S.clients.map((c) => [c.idNo, c.taxRef])")
    pages = ["#cases"] + ["#case-" + c for c in page.evaluate("Object.values(DEMO.keys)")]
    for h in pages:
        go(page, "Tax Consultant", h)
        html = page.evaluate("document.getElementById('app').innerHTML")
        for id_no, tax_ref in ids:
            assert id_no not in html and tax_ref not in html, h
    go(page, "Tax Consultant", "#case-" + case_of(page, "closed"))
    shown = page.locator("[data-rv-key='cases-case-summary'] .vk-masked").all_inner_texts()
    want = page.evaluate("(() => { const cl = ENGINE.clientOf(ENGINE.caseById(DEMO.keys.closed)); return [VK.maskId(cl.idNo), VK.maskTaxRef(cl.taxRef)]; })()")
    assert shown == want
    assert page.errors == []


@pytest.mark.parametrize("width,scheme", [(390, "dark"), (1280, "light")])
def test_cases_screens_never_scroll_sideways(browser, site, width, scheme):
    ctx = browser.new_context(timezone_id=TZ, viewport={"width": width, "height": 900}, color_scheme=scheme)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(site + "#today")
    pg.wait_for_function("typeof CASES_BOARD !== 'undefined' && !!S && S.cases.length > 0")
    pg.evaluate("() => TICKERS.splice(0)")
    hashes = ["#cases"] + ["#case-" + c for c in pg.evaluate("Object.values(DEMO.keys)")]
    for role in ["Tax Consultant", "Records/Compliance Owner"]:
        for h in hashes:
            go(pg, role, h)
            assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), (role, h)
        go(pg, role, "#cases")
        pg.locator("button[data-act='cases.mode'][data-mode='table']").evaluate("el => el.click()")
        assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), (role, "table")
        pg.locator("button[data-act='cases.mode'][data-mode='board']").evaluate("el => el.click()")
    ctx.close()
    assert errors == []


def test_four_source_analysis_lists_the_open_exceptions_on_each_topic(page):
    """The plan's documents case: the IRP5 differs from SARS's pre-populated figure (DOC-02). It has no extracted values yet, so only
    the exception carries the difference; it must show on the employment row, not a 'Consistent' pill."""
    go(page, "Tax Consultant", "#case-" + case_of(page, "documents"))
    rows = page.evaluate("""() => Array.from(document.querySelectorAll('[data-rv-key="cases-case-sources"] tbody tr')).map((tr) => ({
        topic: tr.cells[0].textContent, codes: Array.from(tr.cells[5].querySelectorAll('.vk-code')).map((e) => e.textContent), text: tr.cells[5].textContent }))""")
    emp = next(r for r in rows if "employed" in r["topic"])
    assert "DOC-02" in emp["codes"] and "AI-01" in emp["codes"] and "differs from the SARS pre-populated" in emp["text"] and "Consistent" not in emp["text"]
    go(page, "Tax Consultant", "#case-" + case_of(page, "questionnaire"))
    rows = page.evaluate("""() => Object.fromEntries(Array.from(document.querySelectorAll('[data-rv-key="cases-case-sources"] tbody tr')).map((tr) => [
        tr.cells[0].textContent, Array.from(tr.cells[5].querySelectorAll('.vk-code')).map((e) => e.textContent)]))""")
    assert any("rental" in k and "QUE-03" in v for k, v in rows.items()) and any("retirement" in k and "QUE-04" in v for k, v in rows.items())
    assert page.errors == []


def test_approve_na_goes_through_engine(page):
    case = case_of(page, "approval")
    item = page.evaluate("id => { const c = ENGINE.caseById(id); const it = c.items[1]; ENGINE.portal(c, 'na', { itemId: it.id, reason: 'Scheme closed; certificate not issued' }); return it.id; }", case)
    go(page, "Administrator", "#case-" + case)
    n0 = page.evaluate("S.audit.length")
    click(page, f"[data-rv-key='cases-case-checklist'] button[data-act='cases.na'][data-item='{item}']")
    r = page.evaluate("""([id, it, n]) => ({ na: ENGINE.caseById(id).items.find((x) => x.id === it).na, toast: document.getElementById('toasts').textContent,
        refused: S.audit.slice(n).some((a) => a.caseId === id && a.result === 'Refused' && a.who === 'AD1') })""", [case, item, n0])
    assert r["na"] == "requested" and r["refused"] and "Not done" in r["toast"]
    go(page, "Tax Consultant", "#case-" + case)
    click(page, f"[data-rv-key='cases-case-checklist'] button[data-act='cases.na'][data-item='{item}']")
    r = page.evaluate("""([id, it]) => ({ na: ENGINE.caseById(id).items.find((x) => x.id === it).na,
        audit: S.audit.some((a) => a.caseId === id && a.result === 'Approved' && a.who === 'TC1'),
        button: !!document.querySelector(`[data-rv-key='cases-case-checklist'] button[data-act='cases.na'][data-item='${it}']`) })""", [case, item])
    assert r == {"na": "approved", "audit": True, "button": False}
    assert page.errors == []


def test_keyboard_move_keeps_focus_on_the_card(page):
    go(page, "Tax Consultant", "#cases")
    case = case_of(page, "calcReady")
    page.focus(f"#cb-fwd-{case}")
    page.keyboard.press("Enter")
    r = page.evaluate("""id => ({ focus: document.activeElement.id, col: document.activeElement.closest('.cb-list').dataset.col,
        status: document.querySelector('.cb-last[role=status]').textContent.includes('Moved ' + id) })""", case)
    assert r == {"focus": "cb-fwd-" + case, "col": "client-approval", "status": True}
    assert page.errors == []


def test_rework_after_freeze_raises_ver01_and_submitted_cases_refuse_at_once(page):
    go(page, "Tax Consultant", "#cases")
    ready = case_of(page, "ready")
    assert page.evaluate("id => !!ENGINE.caseById(id).frozen", ready)
    page.evaluate("id => CASES_BOARD.drop(id, 'calculation')", ready)
    page.wait_for_selector("#dlg[open]")
    page.fill("#cb-rw-reason", "PAYE on the IRP5 was mis-keyed")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    r = page.evaluate("""id => { const c = ENGINE.caseById(id); return { col: ENGINE.columnOf(c), ver01: ENGINE.openOf(c, 'VER-01').length > 0,
        approval: ENGINE.approvalProblem(c) }; }""", ready)
    assert r["col"] == "calculation" and r["ver01"] and r["approval"]
    # A submitted return cannot be reworked: the drop is refused (and audited) without asking for a reason.
    filed = case_of(page, "declaration")
    n0 = page.evaluate("S.audit.length")
    page.evaluate("id => CASES_BOARD.drop(id, 'calculation')", filed)
    r = page.evaluate("""([id, n]) => ({ dlg: document.getElementById('dlg').open, last: document.querySelector('.cb-last').textContent,
        refused: S.audit.slice(n).some((a) => a.caseId === id && a.result === 'Refused' && /submitted/.test(a.reason)) })""", [filed, n0])
    assert r["dlg"] is False and "submitted" in r["last"] and r["refused"]
    assert page.errors == []


def test_case_page_survives_a_stub_calculation_and_attribute_quotes(page):
    """A case driven without extracted values carries the engine's stub calculation (no lines); a name with quotes must not
    break out of an attribute."""
    evil = 'Q" onmouseover="alert(1)" data-pwned="1\' data-pwned2=\'1'
    cid = page.evaluate("n => { const cl = ENGINE.newClient({ name: n }); const c = ENGINE.newCase(cl, {}); ENGINE.drive(c, 'G06'); return c.id; }", evil)
    for h in ["#cases", "#case-" + cid]:
        go(page, "Tax Consultant", h)
        r = page.evaluate("n => ({ attr: document.querySelectorAll('[onmouseover], [data-pwned], [data-pwned2]').length, shown: document.getElementById('app').textContent.includes(n) })", evil)
        assert r == {"attr": 0, "shown": True}, h
    assert page.locator("[data-rv-key='cases-case-calc']").count() == 1
    assert page.errors == []
