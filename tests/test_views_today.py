"""Today (src/itr12/views-today.js) and the shared screen kit (src/itr12/views-kit.js) on the seeded demo firm: every role sees its
blocks with review keys, the approvals agree with ENGINE, data is escaped and identities masked, and the shared actions change
state only through ENGINE (and leave an audit entry, refusals included)."""
import pytest

TZ = "Africa/Johannesburg"
ROLES = ["Tax Consultant", "Administrator", "Integration Administrator", "Information Officer", "Records/Compliance Owner"]
BLOCKS = ["today-head", "today-approvals", "today-exceptions", "today-deadlines", "today-sars", "today-portal", "today-ai"]


@pytest.fixture
def page(browser, site):
    """A fresh seeded firm per test (the release and resolve tests change state)."""
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
    """Sign in the way the shell's code form does (S.signedIn, S.role), then render Today."""
    pg.evaluate("r => { S.signedIn = true; S.role = r; if (location.hash !== '#today') location.hash = '#today'; render(); }", role)
    pg.wait_for_selector("#app [data-rv-key='today-approvals']")


def click(pg, selector):
    """Click through the review layer's first-visit tip, which may sit over the page."""
    pg.locator(selector).first.evaluate("el => el.click()")


def test_today_renders_for_every_role_with_review_keys(page):
    for role in ROLES:
        as_role(page, role)
        page.wait_for_function("document.querySelectorAll('#app [data-rv-b]').length > 0")
        r = page.evaluate("""() => ({
            h1: document.querySelector('#app h1').textContent,
            keys: Array.from(document.querySelectorAll('#app [data-rv-key]')).map((e) => e.getAttribute('data-rv-key')),
            blocks: Array.from(document.querySelectorAll('#app [data-rv-b]')).map((e) => e.getAttribute('data-rv-key')),
            name: me().name })""")
        assert r["name"].split(" ")[0] in r["h1"], (role, r["h1"])
        for k in BLOCKS:
            assert k in r["keys"], (role, k)
        assert r["blocks"] and all(k and k.startswith("today-") for k in r["blocks"]), (role, r["blocks"])
    assert page.errors == []


def test_approvals_agree_with_engine(page):
    as_role(page, "Tax Consultant")
    r = page.evaluate("""() => {
        const sec = document.querySelector('[data-rv-key="today-approvals"]');
        const btns = Array.from(sec.querySelectorAll('button[data-act="vk.release"]'));
        const shownReady = btns.filter((b) => b.classList.contains('primary') && b.dataset.gate !== 'G18').map((b) => b.dataset.case + '-' + b.dataset.gate).sort();
        const engineReady = [];
        S.cases.forEach((c) => GATE_IDS.forEach((g) => { if (ENGINE.canRelease(c, g, ACTOR.me()).ok) engineReady.push(c.id + '-' + g); }));
        const ready = DEMO.keys.ready; const tx = S.txs.find((t) => t.caseId === ready && t.status === 'awaiting G18');
        return { shownReady, engineReady: engineReady.sort(), calcReady: DEMO.keys.calcReady, rows: sec.querySelectorAll('tbody tr').length,
          count: NAV_COUNT.approvals(), navCount: document.querySelector('#hdr a[href="#approvals"] .count').textContent,
          g18: btns.filter((b) => b.dataset.gate === 'G18').map((b) => b.dataset.case + '-' + b.dataset.tx), wantG18: ready + '-' + tx.id,
          judgement: sec.innerHTML.includes('#case-' + DEMO.keys.judgement) };
    }""")
    assert r["shownReady"] == r["engineReady"]
    assert r["calcReady"] + "-G05" in r["shownReady"]
    assert r["g18"] == [r["wantG18"]]  # the Integration Administrator has signed; the consultant's sign-off is next
    assert r["judgement"]  # G05 blocked by TAX-02 and TAX-05 still shows, as waiting
    assert r["rows"] == r["count"] == int(r["navCount"])

    as_role(page, "Administrator")
    a = page.evaluate("""() => { const sec = document.querySelector('[data-rv-key="today-approvals"]');
        const row = Array.from(sec.querySelectorAll('tbody tr')).find((tr) => tr.innerHTML.includes('#case-' + DEMO.keys.onboarding));
        return { codes: row ? Array.from(row.querySelectorAll('.vk-code')).map((e) => e.textContent) : null,
          primary: !!(row && row.querySelector('button.primary')) }; }""")
    assert a["codes"] and {"KYC-01", "KYC-05"} <= set(a["codes"])
    assert not a["primary"]
    assert page.errors == []


def test_client_names_are_escaped(page):
    evil = "<img src=x onerror=alert(1)>"
    page.evaluate("""n => { const cl = ENGINE.newClient({ name: n }); ENGINE.newCase(cl, {}); }""", evil)
    as_role(page, "Administrator")
    r = page.evaluate("""n => ({ imgs: document.querySelectorAll('#app img').length,
        shown: document.querySelector('[data-rv-key="today-approvals"]').textContent.includes(n) })""", evil)
    assert r == {"imgs": 0, "shown": True}
    click(page, "[data-rv-key='today-approvals'] button.primary[data-gate='G01']")
    page.wait_for_selector("#dlg[open]")
    assert page.evaluate("document.querySelectorAll('#dlg img').length") == 0
    assert evil in page.locator("#dlg").inner_text()
    assert page.errors == []


def test_identities_are_masked(page):
    assert page.evaluate("VK.maskId('8804125185084')") == "880412•••••••"
    assert page.evaluate("VK.maskTaxRef('9061007331')") == "••••••7331"
    assert page.evaluate("VK.scrub('ID 8804125185084, tax ref 9061007331, ref ITA34-2026-7781230')") == "ID 880412•••••••, tax ref ••••••7331, ref ITA34-2026-7781230"
    ids = page.evaluate("S.clients.map((c) => [c.idNo, c.taxRef])")
    for role in ROLES:
        as_role(page, role)
        html = page.evaluate("document.getElementById('app').innerHTML")
        for id_no, tax_ref in ids:
            assert id_no not in html and tax_ref not in html, role
    shown = page.locator("[data-rv-key='today-sars'] .vk-masked").all_inner_texts()
    want = page.evaluate("S.inbound.map((i) => VK.maskTaxRef(i.taxRef))")
    assert shown and set(shown) <= set(want)
    assert page.errors == []


def test_releasing_a_gate_goes_through_engine_and_is_audited(page):
    as_role(page, "Tax Consultant")
    case = page.evaluate("DEMO.keys.calcReady")
    n0 = page.evaluate("S.audit.length")
    click(page, f"[data-rv-key='today-approvals'] button[data-act='vk.release'][data-case='{case}'][data-gate='G05']")
    page.wait_for_selector("#dlg[open]")
    page.fill("#vk-rel-ev", "Reviewed the calculation pack")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    r = page.evaluate("""([id, n0]) => { const c = ENGINE.caseById(id);
        const hit = S.audit.slice(n0).find((a) => a.caseId === id && a.gate === 'G05' && a.result === 'Released');
        return { status: c.gates.G05.status, by: c.gates.G05.by, hit: hit ? { who: hit.who, role: hit.role, evidence: hit.evidence } : null,
          chain: ENGINE.verifyChain().ok, toast: document.getElementById('toasts').textContent,
          still: !!document.querySelector(`[data-rv-key="today-approvals"] button[data-case="${id}"][data-gate="G05"]`) }; }""", [case, n0])
    assert r["status"] == "released" and r["by"] == ["TC1"]
    assert r["hit"] == {"who": "TC1", "role": "Tax Consultant", "evidence": "Reviewed the calculation pack"}
    assert r["chain"] and "Released G05" in r["toast"] and not r["still"]
    assert page.errors == []


def test_a_refused_release_stays_in_the_dialog_and_is_audited(page):
    as_role(page, "Tax Consultant")
    case = page.evaluate("DEMO.keys.details")
    click(page, f"[data-rv-key='today-approvals'] button[data-act='vk.release'][data-case='{case}'][data-gate='G02']")
    page.wait_for_selector("#dlg[open]")
    assert "MD-05" in page.locator("#dlg .err").first.inner_text()
    page.click("#dlg-ok")
    page.wait_for_function("document.getElementById('dlg-err').textContent.startsWith('Not done')")
    r = page.evaluate("""id => ({ open: document.getElementById('dlg').open, status: ENGINE.caseById(id).gates.G02.status,
        refused: S.audit.some((a) => a.caseId === id && a.gate === 'G02' && a.result === 'Refused' && a.who === 'TC1') })""", case)
    assert r == {"open": True, "status": "pending", "refused": True}
    assert page.errors == []


def test_resolve_then_close_as_secondary_reviewer(page):
    as_role(page, "Administrator")
    x = page.evaluate("ENGINE.exOf(ENGINE.caseById(DEMO.keys.onboarding)).find((y) => y.code === 'KYC-05').id")
    click(page, f"[data-rv-key='today-exceptions'] button[data-act='vk.resolve'][data-ex='{x}']")
    page.wait_for_selector("#dlg[open]")
    page.click("#dlg-ok")
    assert page.locator("#dlg-err").inner_text() == "Write what was done."
    page.fill("#vk-res-action", "Signed mandate received and filed")
    page.fill("#vk-res-ev", "Mandate_signed.pdf")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    assert page.evaluate("id => [ENGINE.exById(id).status, ENGINE.exById(id).resolvedById]", x) == ["resolved", "AD1"]

    as_role(page, "Tax Consultant")
    click(page, f"[data-rv-key='today-exceptions'] button[data-act='vk.close'][data-ex='{x}']")
    page.wait_for_selector("#dlg[open]")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    r = page.evaluate("""id => ({ status: ENGINE.exById(id).status, by: ENGINE.exById(id).closedById,
        audit: S.audit.some((a) => a.exceptionId === id && a.result === 'Closed' && a.who === 'TC1'), chain: ENGINE.verifyChain().ok })""", x)
    assert r == {"status": "closed", "by": "TC1", "audit": True, "chain": True}
    assert page.errors == []


def test_signing_g18_from_today(page):
    as_role(page, "Tax Consultant")
    case = page.evaluate("DEMO.keys.ready")
    click(page, f"[data-rv-key='today-approvals'] button[data-act='vk.release'][data-case='{case}'][data-gate='G18']")
    page.wait_for_selector("#dlg[open]")
    assert page.locator("#dlg .vk-checks li.ok").count() == 8
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    r = page.evaluate("""id => { const t = S.txs.find((x) => x.caseId === id && x.fn === 'itr12');
        return { status: t.status, roles: t.signoffs.map((s) => s.role), g18: ENGINE.caseById(id).gates.G18.status }; }""", case)
    assert r == {"status": "ready", "roles": ["Integration Administrator", "Tax Consultant"], "g18": "released"}
    assert page.errors == []


@pytest.mark.parametrize("width,scheme", [(390, "dark"), (1280, "light")])
def test_today_never_scrolls_sideways(browser, site, width, scheme):
    ctx = browser.new_context(timezone_id=TZ, viewport={"width": width, "height": 900}, color_scheme=scheme)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(site + "#today")
    pg.wait_for_function("typeof VK !== 'undefined' && !!S && S.cases.length > 0")
    for role in ROLES:
        as_role(pg, role)
        assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), role
    ctx.close()
    assert errors == []
