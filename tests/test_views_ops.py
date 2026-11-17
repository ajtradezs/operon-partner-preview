"""Approvals (views-approvals.js), Exceptions and the exception page (views-exceptions.js) and the SARS link (views-sars.js) on the
seeded demo firm: every role sees each screen with its review keys, the demo cases appear where the plan puts them, every button
changes state only through ENGINE (the audit trail grows, refusals included, and a refusal shows ENGINE's reason), dynamic text is
escaped, identities are masked, and nothing scrolls sideways at 390px or 1280px."""
import pytest

TZ = "Africa/Johannesburg"
ROLES = ["Tax Consultant", "Administrator", "Integration Administrator", "Information Officer", "Records/Compliance Owner"]
SCREENS = {
    "approvals": ["ops-approvals-head", "ops-approvals-gates", "ops-approvals-g18", "ops-approvals-requests", "ops-approvals-who"],
    "exceptions": ["ops-exceptions-head", "ops-exceptions-filters", "ops-exceptions-list"],
    "exception": ["ops-exception-head", "ops-exception-columns", "ops-exception-resolution", "ops-exception-links", "ops-exception-object",
                  "ops-exception-columns-controls", "ops-exception-severity", "ops-exception-override", "ops-exception-fallback", "ops-exception-history"],
    "sars": ["ops-sars-head", "ops-sars-link", "ops-sars-txs", "ops-sars-checks", "ops-sars-inbound", "ops-sars-rules"],
}


@pytest.fixture
def page(browser, site):
    """A fresh seeded firm per test (most tests change state)."""
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


def show(pg, role, route):
    """Sign in as a role (S.signedIn, S.role) and render a route."""
    pg.evaluate("([r, h]) => { S.signedIn = true; S.role = r; if (location.hash !== '#' + h) location.hash = '#' + h; render(); }", [role, route])
    pg.wait_for_function("h => location.hash === '#' + h && !!document.querySelector('#app h1')", arg=route)


def click(pg, selector):
    """Click through the review layer's first-visit tip, which may sit over the page."""
    pg.locator(selector).first.evaluate("el => el.click()")


def submit(pg):
    pg.click("#dlg-ok")


def closed(pg):
    pg.wait_for_function("!document.getElementById('dlg').open")


def refused(pg):
    """The dialog stays open with ENGINE's reason."""
    pg.wait_for_function("document.getElementById('dlg').open && document.getElementById('dlg-err').textContent.startsWith('Not done')")
    return pg.locator("#dlg-err").inner_text()


def pick(pg, name, value):
    pg.evaluate("([n, v]) => { const el = document.querySelector(`#dlg [name='${n}'][value='${v}']`); el.checked = true; }", [name, value])


def audit_n(pg):
    return pg.evaluate("S.audit.length")


def toast(pg):
    return pg.evaluate("document.getElementById('toasts').textContent")


# ---------------------------------------------------------------- rendering


def test_every_screen_renders_for_every_role_with_review_keys(page):
    ids = page.evaluate("[ENGINE.exOf(ENGINE.caseById(DEMO.keys.unknown)).find((x) => x.code === 'INT-04').id, ENGINE.exOf(ENGINE.caseById(DEMO.keys.wrongTaxpayer)).find((x) => x.code === 'DOC-04').id]")
    for role in ROLES:
        for route, keys in SCREENS.items():
            for target in ([route + "-" + i for i in ids] if route == "exception" else [route]):
                show(page, role, target)
                page.wait_for_function("document.querySelectorAll('#app [data-rv-b]').length > 0")
                r = page.evaluate("""() => ({ keys: Array.from(document.querySelectorAll('#app [data-rv-key]')).map((e) => e.getAttribute('data-rv-key')),
                    blocks: Array.from(document.querySelectorAll('#app [data-rv-b]')).map((e) => e.getAttribute('data-rv-key')),
                    secs: Array.from(document.querySelectorAll('#app section')).map((e) => e.getAttribute('data-rv-key')) })""")
                for k in keys:
                    assert k in r["keys"], (role, target, k)
                assert all(k and k.startswith("ops-") for k in r["keys"]), (role, target, r["keys"])
                assert all(k and k.startswith("ops-") for k in r["blocks"]), (role, target, r["blocks"])
                assert all(k and k.startswith("ops-") for k in r["secs"]), (role, target, r["secs"])
    show(page, "Tax Consultant", "exception-X9999")
    assert "not found" in page.locator("#app h1").inner_text()
    assert page.errors == []


# ---------------------------------------------------------------- approvals


def test_approvals_show_the_demo_gates_with_criteria_and_blockers(page):
    show(page, "Tax Consultant", "approvals")
    r = page.evaluate("""() => {
        const sec = document.querySelector('[data-rv-key="ops-approvals-gates"]');
        const rows = Array.from(sec.querySelectorAll('tbody tr'));
        const want = VK.waitingGates('Tax Consultant').filter((w) => w.kind !== 'g18');
        const rowFor = (id, g) => rows.find((tr) => tr.querySelector(`button[data-case="${id}"][data-gate="${g}"]`));
        const judgement = rowFor(DEMO.keys.judgement, 'G05');
        const remedy = rowFor(DEMO.keys.remedy, 'G15'); const rc = ENGINE.caseById(DEMO.keys.remedy);
        const ready = rows.filter((tr) => tr.querySelector('button.primary')).map((tr) => { const b = tr.querySelector('button'); return b.dataset.case + '-' + b.dataset.gate; });
        return { n: rows.length, want: want.length, ready, calcReady: DEMO.keys.calcReady,
          judgementCodes: Array.from(judgement.querySelectorAll('.vk-code')).map((e) => e.textContent),
          remedyText: remedy.textContent, remedyMissing: ENGINE.criteria(rc, 'G15'), criterion: GATE.G15.criterion };
    }""")
    assert r["n"] == r["want"] and r["ready"] == [r["calcReady"] + "-G05"]
    assert {"TAX-02", "TAX-05"} <= set(r["judgementCodes"])
    assert r["remedyMissing"] and all(m in r["remedyText"] for m in r["remedyMissing"]) and r["criterion"] in r["remedyText"]

    # G18 two-person sign-off: the consultant signs next; the integration administrator has signed and waits.
    g = page.evaluate("""() => { const sec = document.querySelector('[data-rv-key="ops-approvals-g18"]');
        const t = S.txs.find((x) => x.caseId === DEMO.keys.ready && x.status === 'awaiting G18');
        return { btn: !!sec.querySelector(`button[data-act="vk.release"][data-gate="G18"][data-tx="${t.id}"]`), text: sec.textContent, tx: t.id }; }""")
    assert g["btn"] and "8 of 8 checks pass" in g["text"]
    show(page, "Integration Administrator", "approvals")
    ia = page.evaluate("""() => { const sec = document.querySelector('[data-rv-key="ops-approvals-g18"]');
        return { btn: !!sec.querySelector('button[data-gate="G18"]'), text: sec.textContent }; }""")
    assert not ia["btn"] and g["tx"] in ia["text"] and "You signed. The Tax Consultant signs next." in ia["text"]

    show(page, "Administrator", "approvals")
    a = page.evaluate("""() => { const tr = Array.from(document.querySelectorAll('[data-rv-key="ops-approvals-gates"] tbody tr')).find((x) => x.innerHTML.includes('#case-' + DEMO.keys.onboarding));
        return tr ? Array.from(tr.querySelectorAll('.vk-code')).map((e) => e.textContent) : null; }""")
    assert a and {"KYC-01", "KYC-05"} <= set(a)
    show(page, "Information Officer", "approvals")
    assert page.locator("[data-rv-key='ops-approvals-gates'] a[href='#incident-INC01']").count() == 1
    assert page.errors == []


def test_release_and_g18_sign_from_approvals_go_through_engine(page):
    show(page, "Tax Consultant", "approvals")
    case = page.evaluate("DEMO.keys.calcReady")
    n0 = audit_n(page)
    click(page, f"[data-rv-key='ops-approvals-gates'] button[data-case='{case}'][data-gate='G05']")
    page.wait_for_selector("#dlg[open]")
    submit(page)
    closed(page)
    assert page.evaluate("id => ENGINE.caseById(id).gates.G05.status", case) == "released"
    assert audit_n(page) > n0
    click(page, "[data-rv-key='ops-approvals-g18'] button[data-gate='G18']")
    page.wait_for_selector("#dlg[open]")
    submit(page)
    closed(page)
    assert page.evaluate("S.txs.find((t) => t.caseId === DEMO.keys.ready && t.fn === 'itr12').status") == "ready"
    # A refused release keeps the dialog open with ENGINE's reason, and is audited.
    judgement = page.evaluate("DEMO.keys.judgement")
    n1 = audit_n(page)
    click(page, f"[data-rv-key='ops-approvals-gates'] button[data-case='{judgement}'][data-gate='G05']")
    page.wait_for_selector("#dlg[open]")
    submit(page)
    assert "TAX-02" in refused(page)
    assert page.evaluate("n => S.audit.slice(n).some((a) => a.result === 'Refused' && a.gate === 'G05')", n1)
    assert page.errors == []


def test_severity_request_and_approval(page):
    x = page.evaluate("ENGINE.exOf(ENGINE.caseById(DEMO.keys.judgement)).find((y) => y.code === 'TAX-05').id")
    show(page, "Tax Consultant", "exception-" + x)
    n0 = audit_n(page)
    click(page, "[data-rv-key='ops-exception-severity'] button[data-act='ops.sev']")
    page.wait_for_selector("#dlg[open]")
    page.select_option("#ops-sev-to", "S3")
    submit(page)
    assert "Give the reason" in refused(page)  # lowering needs a reason; ENGINE refuses and audits it
    page.fill("#ops-sev-why", "The variance is the new home office claim, already explained")
    submit(page)
    closed(page)
    r = page.evaluate("id => ({ sev: ENGINE.exById(id).sev, rq: ENGINE.exById(id).sevRequest.status })", x)
    assert r == {"sev": "S2", "rq": "pending"}
    assert page.evaluate("n => S.audit.slice(n).map((a) => a.result)", n0)[-2:] == ["Refused", "Requested"]

    show(page, "Records/Compliance Owner", "approvals")
    click(page, f"[data-rv-key='ops-approvals-requests'] button[data-act='ops.sevOk'][data-ex='{x}'][data-v='1']")
    page.wait_for_function("id => ENGINE.exById(id).sev === 'S3'", arg=x)
    assert page.evaluate("id => S.audit.some((a) => a.exceptionId === id && a.who === 'RC1' && a.after === 'S3')", x)

    # The approver may not approve a lowering they asked for themselves: the refusal reason is shown.
    y = page.evaluate("ENGINE.exOf(ENGINE.caseById(DEMO.keys.judgement)).find((z) => z.code === 'TAX-02').id")
    page.evaluate("id => ENGINE.setSeverity(ENGINE.exById(id), ACTOR.me(), 'S3', { reason: 'test' })", y)
    show(page, "Records/Compliance Owner", "exception-" + y)
    click(page, "[data-rv-key='ops-exception-severity'] button[data-act='ops.sevOk'][data-v='1']")
    page.wait_for_function("document.getElementById('toasts').textContent.includes('Not done: The approver must not be the person who asked')")
    assert page.evaluate("id => ENGINE.exById(id).sev", y) == "S2"
    assert page.errors == []


# ---------------------------------------------------------------- exceptions register


def test_register_filters(page):
    show(page, "Tax Consultant", "exceptions")

    def shown():
        return page.evaluate("Array.from(document.querySelectorAll('[data-rv-key=\"ops-exceptions-list\"] tbody tr .vk-code')).map((e) => e.textContent)")

    live = page.evaluate("S.exceptions.filter((x) => x.status !== 'closed').length")
    assert len(shown()) == live
    page.select_option("#ops-exf-sev", "S1")
    assert sorted(shown()) == ["DOC-04", "SEC-01"]
    page.select_option("#ops-exf-sev", "")
    page.select_option("#ops-exf-fam", "INT")
    assert shown() == ["INT-04"]
    page.select_option("#ops-exf-fam", "")
    page.select_option("#ops-exf-gate", "G01")
    assert sorted(shown()) == ["KYC-01", "KYC-05"]
    page.select_option("#ops-exf-gate", "")
    page.select_option("#ops-exf-owner", "Information Officer")
    assert sorted(shown()) == ["DOC-04", "SEC-01"]
    page.select_option("#ops-exf-owner", "Client")
    assert sorted(shown()) == ["DOC-01", "QUE-04"]
    page.select_option("#ops-exf-owner", "")
    page.select_option("#ops-exf-status", "closed")
    assert shown() == page.evaluate("S.exceptions.filter((x) => x.status === 'closed').map((x) => x.code)")
    page.select_option("#ops-exf-status", "live")
    page.fill("#ops-exf-q", "Sithole")  # no exception on the clean calculation case
    assert shown() == []
    click(page, "button[data-act='ops.exClear']")
    assert len(shown()) == live
    click(page, "button[data-act='ops.exMine']")
    assert len(shown()) == page.evaluate("S.exceptions.filter((x) => x.status !== 'closed' && VK.ownedBy(x.owner, 'Tax Consultant')).length")
    assert page.errors == []


def test_exception_page_shows_the_full_object_and_links(page):
    x = page.evaluate("ENGINE.exOf(ENGINE.caseById(DEMO.keys.wrongTaxpayer)).find((y) => y.code === 'DOC-04').id")
    show(page, "Information Officer", "exception-" + x)
    r = page.evaluate("""() => ({ labels: Array.from(document.querySelectorAll('[data-rv-key="ops-exception-object"] tbody tr td:first-child')).map((e) => e.textContent),
        want: EX_OBJECT.map((f) => f.label), links: document.querySelector('[data-rv-key="ops-exception-links"]').innerHTML,
        res: document.querySelector('[data-rv-key="ops-exception-resolution"]').textContent })""")
    assert r["labels"] == r["want"] and len(r["want"]) == 14
    assert "#incident-INC01" in r["links"] and "SEC-01" in r["links"] and "#case-" in r["links"]
    assert "Close incident INC01 first (G17)" in r["res"]
    t = page.evaluate("ENGINE.exOf(ENGINE.caseById(DEMO.keys.unknown)).find((y) => y.code === 'INT-04')")
    show(page, "Integration Administrator", "exception-" + t["id"])
    assert t["txId"] in page.locator("[data-rv-key='ops-exception-links']").inner_text()
    assert "Check the SARS status of " + t["txId"] in page.locator("[data-rv-key='ops-exception-resolution']").inner_text()
    assert page.errors == []


def test_override_refusals_show_the_reason_and_an_approved_override_works(page):
    x = page.evaluate("ENGINE.exOf(ENGINE.caseById(DEMO.keys.judgement)).find((y) => y.code === 'TAX-02').id")
    show(page, "Tax Consultant", "exception-" + x)
    assert "pending Johan" in page.locator("[data-rv-key='ops-exception-override']").inner_text()
    n0 = audit_n(page)
    click(page, "[data-rv-key='ops-exception-override'] button[data-act='ops.ovReq']")
    page.wait_for_selector("#dlg[open]")
    page.fill("#ops-ov-why", "Client confirmed the home office use")
    page.fill("#ops-ov-ev", "Floor_plan.pdf")
    submit(page)
    assert "not on the override policy list (pending Johan)" in refused(page)
    assert page.evaluate("n => S.audit.slice(n).some((a) => a.result === 'Refused' && a.code === 'TAX-02')", n0)

    i = page.evaluate("ENGINE.exOf(ENGINE.caseById(DEMO.keys.unknown)).find((y) => y.code === 'INT-04').id")
    show(page, "Tax Consultant", "exception-" + i)
    click(page, "[data-rv-key='ops-exception-override'] button[data-act='ops.ovReq']")
    page.wait_for_selector("#dlg[open]")
    page.fill("#ops-ov-why", "x")
    page.fill("#ops-ov-ev", "y")
    submit(page)
    assert "SARS-interface authorisation" in refused(page)

    # Once the Records/Compliance Owner puts TAX-05 on the policy list (through ENGINE), an override can be asked for and approved.
    y = page.evaluate("""() => { ENGINE.setOverridable('TAX-05', true, ACTOR.as('Records/Compliance Owner'));
        return ENGINE.exOf(ENGINE.caseById(DEMO.keys.judgement)).find((z) => z.code === 'TAX-05').id; }""")
    show(page, "Tax Consultant", "exception-" + y)
    click(page, "[data-rv-key='ops-exception-override'] button[data-act='ops.ovReq']")
    page.wait_for_selector("#dlg[open]")
    page.fill("#ops-ov-why", "The variance is the new home office claim")
    page.fill("#ops-ov-ev", "Home_office_schedule.pdf")
    submit(page)
    closed(page)
    assert page.evaluate("id => ENGINE.exById(id).override.status", y) == "requested"
    show(page, "Records/Compliance Owner", "approvals")
    click(page, f"[data-rv-key='ops-approvals-requests'] button[data-act='ops.ovOk'][data-ex='{y}']")
    page.wait_for_function("id => ENGINE.exById(id).override.status === 'approved'", arg=y)
    assert page.evaluate("id => !ENGINE.blocksNow(ENGINE.exById(id))", y)
    assert page.errors == []


def test_raise_an_exception_by_hand(page):
    show(page, "Administrator", "exceptions")
    case = page.evaluate("DEMO.keys.onboarding")
    n0 = page.evaluate("S.exceptions.length")
    click(page, "button[data-act='ops.raise']")
    page.wait_for_selector("#dlg[open]")
    page.select_option("#ops-raise-case", case)
    stage_codes = page.evaluate("document.querySelectorAll('#ops-raise-code option').length")
    page.select_option("#ops-raise-scope", "all")
    assert page.evaluate("document.querySelectorAll('#ops-raise-code option').length") == 116 > stage_codes
    page.select_option("#ops-raise-code", "KYC-03")
    page.fill("#ops-raise-note", "The ID copy is not certified")
    submit(page)
    closed(page)
    x = page.evaluate("S.exceptions[S.exceptions.length - 1]")
    assert page.evaluate("S.exceptions.length") == n0 + 1 and x["code"] == "KYC-03" and x["caseId"] == case and x["raisedById"] == "AD1"
    page.wait_for_function("id => location.hash === '#exception-' + id", arg=x["id"])
    assert page.evaluate("id => S.audit.some((a) => a.exceptionId === id && a.result === 'Raised' && a.who === 'AD1')", x["id"])
    # A related exception from the exception page carries the parent link.
    click(page, "button[data-act='ops.raise']")
    page.wait_for_selector("#dlg[open]")
    page.select_option("#ops-raise-scope", "all")
    page.select_option("#ops-raise-code", "KYC-02")
    submit(page)
    closed(page)
    assert page.evaluate("S.exceptions[S.exceptions.length - 1].parent") == x["id"]
    assert page.errors == []


# ---------------------------------------------------------------- SARS link


def sign_ready(pg):
    """The consultant signs the second G18 sign-off for the ready case from the SARS page; returns the transaction id."""
    show(pg, "Tax Consultant", "sars")
    t = pg.evaluate("S.txs.find((x) => x.caseId === DEMO.keys.ready && x.status === 'awaiting G18').id")
    click(pg, f"[data-rv-key='ops-sars-txs'] button[data-act='vk.release'][data-tx='{t}']")
    pg.wait_for_selector("#dlg[open]")
    assert pg.locator("#dlg .vk-checks li.ok").count() == 8
    submit(pg)
    closed(pg)
    assert pg.evaluate("id => ENGINE.txById(id).status", t) == "ready"
    return t


def test_send_unknown_then_no_blind_retry_then_check_status(page):
    show(page, "Tax Consultant", "sars")
    r = page.evaluate("""() => ({ checks: document.querySelectorAll('[data-rv-key="ops-sars-checks"] .ops-tx').length,
        open: S.txs.filter((t) => ['awaiting G18', 'ready', 'unknown', 'no-response', 'manual', 'blocked', 'not processed'].includes(t.status)).length,
        rows: document.querySelectorAll('[data-rv-key="ops-sars-txs"] tbody tr').length, txs: S.txs.length,
        locked: document.querySelectorAll('[data-rv-key="ops-sars-link"] button:disabled').length })""")
    assert r["checks"] == r["open"] == 2 and r["rows"] == r["txs"] and r["locked"] == 3
    t = sign_ready(page)
    show(page, "Integration Administrator", "sars")
    click(page, f"button[data-act='ops.tx.send'][data-tx='{t}']")
    page.wait_for_selector("#dlg[open]")
    pick(page, "outcome", "unknown")
    submit(page)
    closed(page)
    assert page.evaluate("id => [ENGINE.txById(id).status, S.exceptions.some((x) => x.txId === id && x.code === 'INT-04' && ENGINE.isOpen(x))]", t) == ["unknown", True]
    n0 = audit_n(page)
    click(page, f"button[data-act='ops.tx.retry'][data-tx='{t}']")
    page.wait_for_function("document.getElementById('toasts').textContent.includes('Not done: Check the SARS status first')")
    assert page.evaluate("n => S.audit.slice(n).some((a) => a.result === 'Refused')", n0)
    click(page, f"button[data-act='ops.tx.check'][data-tx='{t}']")
    page.wait_for_selector("#dlg[open]")
    pick(page, "truth", "processed")
    submit(page)
    closed(page)
    r = page.evaluate("id => ({ s: ENGINE.txById(id).status, ref: !!ENGINE.txById(id).ref, int04: S.exceptions.filter((x) => x.txId === id && x.code === 'INT-04').map((x) => x.status) })", t)
    assert r["s"] == "success" and r["ref"] and len(r["int04"]) == 1 and r["int04"][0] in ("resolved", "closed")
    assert page.evaluate("ENGINE.verifyChain().ok")
    assert page.errors == []


def test_link_down_manual_fallback_and_independent_reconciliation(page):
    t = sign_ready(page)
    show(page, "Integration Administrator", "sars")
    click(page, "[data-rv-key='ops-sars-link'] button[data-act='ops.link'][data-k='up']")
    page.wait_for_function("!S.link.up")
    assert page.evaluate("S.audit[S.audit.length - 1].text").startswith("SARS link (simulated): interface down")
    click(page, f"button[data-act='ops.tx.send'][data-tx='{t}']")
    page.wait_for_selector("#dlg[open]")
    submit(page)
    assert "INT-03" in refused(page)
    page.click("#dlg [data-close]")

    show(page, "Tax Consultant", "sars")
    click(page, f"button[data-act='ops.tx.manual'][data-tx='{t}']")
    page.wait_for_selector("#dlg[open]")
    submit(page)
    assert page.locator("#dlg-err").inner_text() == "Give the reference from the manual channel."
    page.fill("#ops-man-ref", "EF-MANUAL-0042")
    submit(page)
    closed(page)
    x = page.evaluate("id => S.exceptions.find((y) => y.txId === id && y.code === 'INT-13').id", t)
    assert page.evaluate("id => ENGINE.txById(id).status", t) == "manual"
    # The person who filed manually may not reconcile it.
    click(page, f"[data-rv-key='ops-sars-txs'] button[data-act='ops.fbRecon'][data-ex='{x}']")
    page.wait_for_selector("#dlg[open]")
    submit(page)
    assert "different person" in refused(page)
    page.click("#dlg [data-close]")
    show(page, "Integration Administrator", "exception-" + x)
    click(page, "[data-rv-key='ops-exception-fallback'] button[data-act='ops.fbRecon']")
    page.wait_for_selector("#dlg[open]")
    pick(page, "processed", "yes")
    submit(page)
    closed(page)
    r = page.evaluate("([id, x]) => ({ s: ENGINE.txById(id).status, ref: ENGINE.txById(id).ref, x: ENGINE.exById(x).status, by: ENGINE.exById(x).fallback.reconciled.by })", [t, x])
    assert r["x"] in ("resolved", "closed") and {k: r[k] for k in ("s", "ref", "by")} == {"s": "success", "ref": "EF-MANUAL-0042", "by": "IA1"}
    assert page.errors == []


def test_inbound_routing_and_date_confirmation(page):
    it = page.evaluate("""() => { const cl = ENGINE.newClient({ name: 'Route Test' });
        const a = ENGINE.receive({ fn: 'notice', taxRef: cl.taxRef, year: 2026, ref: 'NOTICE-77', date: '2026-11-06' });
        return { id: a.id, client: cl.id }; }""")
    show(page, "Tax Consultant", "sars")
    row = page.locator("[data-rv-key='ops-sars-inbound'] tbody tr", has_text=it["id"])
    assert row.locator("button:disabled", has_text="Route to a case").count() == 1 and "Integration Administrator only" in row.inner_text()
    show(page, "Integration Administrator", "sars")
    assert page.locator("[data-rv-key='ops-sars-inbound']").inner_text().count("INT-14") >= 1
    click(page, f"button[data-act='ops.in.route'][data-in='{it['id']}']")
    page.wait_for_selector("#dlg[open]")
    page.select_option("#ops-route-case", page.evaluate("DEMO.keys.declaration"))
    submit(page)
    assert "tax reference does not match" in refused(page)
    page.click("#dlg [data-close]")
    case = page.evaluate("id => ENGINE.newCase(ENGINE.clientOf(id), {}).id", it["client"])
    page.evaluate("render()")  # the new case is now listed in the routing dialog
    click(page, f"button[data-act='ops.in.route'][data-in='{it['id']}']")
    page.wait_for_selector("#dlg[open]")
    page.select_option("#ops-route-case", case)
    submit(page)
    closed(page)
    assert page.evaluate("id => [S.inbound.find((x) => x.id === id).status, ENGINE.isOpen(S.exceptions.find((x) => x.inboundId === id && x.code === 'INT-14'))]", it["id"]) == ["routed", False]

    # An unreadable date raises INT-15; one person confirms the dates from the notice, a different person reconciles them.
    bad = page.evaluate("""() => { const cl = ENGINE.clientOf(ENGINE.caseById(DEMO.keys.declaration));
        return ENGINE.receive({ fn: 'notice', taxRef: cl.taxRef, year: 2026, ref: 'NOTICE-88', date: '31/02/2026' }).id; }""")
    show(page, "Integration Administrator", "sars")
    assert "Unreadable on the notice" in page.locator("[data-rv-key='ops-sars-inbound']").inner_text()
    click(page, f"button[data-act='ops.in.date'][data-in='{bad}']")
    page.wait_for_selector("#dlg[open]")
    page.fill("#ops-in-date", "2026-11-05")
    submit(page)
    closed(page)
    x = page.evaluate("id => S.exceptions.find((y) => y.inboundId === id && y.code === 'INT-15').id", bad)
    assert page.evaluate("([i, x]) => [S.inbound.find((y) => y.id === i).date, ENGINE.exById(x).fallback.recorded.by]", [bad, x]) == ["2026-11-05", "IA1"]
    show(page, "Integration Administrator", "exception-" + x)
    click(page, "[data-rv-key='ops-exception-fallback'] button[data-act='ops.fbRecon']")
    page.wait_for_selector("#dlg[open]")
    submit(page)
    assert "different person" in refused(page)
    page.click("#dlg [data-close]")
    show(page, "Tax Consultant", "exception-" + x)
    click(page, "[data-rv-key='ops-exception-fallback'] button[data-act='ops.fbRecon']")
    page.wait_for_selector("#dlg[open]")
    submit(page)
    closed(page)
    assert page.evaluate("id => !ENGINE.isOpen(ENGINE.exById(id)) && !!ENGINE.exById(id).fallback.reconciled", x)
    assert page.errors == []


def test_int15_fallback_is_the_date_confirmation_not_a_note(page):
    """INT-15 closes only once the dates are confirmed from the notice and reconciled by someone else; a free-text note may not
    stand in for that (it would close INT-15 saying the dates were confirmed while the date is still empty)."""
    bad = page.evaluate("""() => { const cl = ENGINE.clientOf(ENGINE.caseById(DEMO.keys.declaration));
        return ENGINE.receive({ fn: 'notice', taxRef: cl.taxRef, year: 2026, ref: 'NOTICE-91', date: '31/02/2026' }).id; }""")
    x = page.evaluate("id => S.exceptions.find((y) => y.inboundId === id && y.code === 'INT-15').id", bad)
    show(page, "Integration Administrator", "exception-" + x)
    fb = "[data-rv-key='ops-exception-fallback']"
    assert page.locator(fb + " button[data-act='ops.fbRec']").count() == 0
    assert page.locator(fb + " button[data-act='ops.fbRecon']").count() == 0
    n0 = audit_n(page)
    click(page, fb + f" button[data-act='ops.in.date'][data-in='{bad}']")
    page.wait_for_selector("#dlg[open]")
    page.fill("#ops-in-date", "2026-11-04")
    submit(page)
    closed(page)
    assert audit_n(page) > n0
    assert page.evaluate("id => S.inbound.find((y) => y.id === id).date", bad) == "2026-11-04"
    # The SARS page now offers the reconciliation, not a second confirmation.
    show(page, "Tax Consultant", "sars")
    row = page.locator("[data-rv-key='ops-sars-inbound'] tbody tr", has_text=bad)
    assert row.locator("button[data-act='ops.in.date']").count() == 0 and "Unreadable on the notice" not in row.inner_text()
    click(page, f"[data-rv-key='ops-sars-inbound'] button[data-act='ops.fbRecon'][data-ex='{x}']")
    page.wait_for_selector("#dlg[open]")
    submit(page)
    closed(page)
    assert page.evaluate("id => !ENGINE.isOpen(ENGINE.exById(id))", x)
    show(page, "Tax Consultant", "sars")
    row = page.locator("[data-rv-key='ops-sars-inbound'] tbody tr", has_text=bad)
    assert row.locator("button").count() == 0 and "confirmed from the notice" in row.inner_text()
    # INT-03 and INT-13 point to the manual filing; only AI-06 records a free-text fallback.
    ids = page.evaluate("""() => { const c = ENGINE.caseById(DEMO.keys.ready); const a = ACTOR.as('Tax Consultant');
        return ['INT-03', 'INT-13', 'AI-06'].map((k) => ENGINE.raiseManual(c, k, a, {}).exception.id); }""")
    for i, code in zip(ids, ["INT-03", "INT-13", "AI-06"]):
        show(page, "Tax Consultant", "exception-" + i)
        n = page.locator(fb + " button[data-act='ops.fbRec']").count()
        assert n == (1 if code == "AI-06" else 0), code
        if code != "AI-06":
            assert "SARS link page" in page.locator(fb).inner_text()
    n1 = audit_n(page)
    click(page, fb + " button[data-act='ops.fbRec']")
    page.wait_for_selector("#dlg[open]")
    page.fill("#ops-fb-note", "Documents classified by hand while the AI service was down")
    submit(page)
    closed(page)
    assert audit_n(page) > n1 and page.evaluate("id => ENGINE.exById(id).fallback.recorded.by", ids[2]) == "TC1"
    assert page.errors == []


def test_severity_dialog_has_no_default_and_a_decline_is_recorded(page):
    x = page.evaluate("ENGINE.exOf(ENGINE.caseById(DEMO.keys.judgement)).find((y) => y.code === 'TAX-05').id")
    show(page, "Tax Consultant", "exception-" + x)
    n0 = audit_n(page)
    click(page, "[data-rv-key='ops-exception-severity'] button[data-act='ops.sev']")
    page.wait_for_selector("#dlg[open]")
    submit(page)  # nothing chosen: nothing changes (an S1 would stop the whole case)
    assert page.locator("#dlg-err").inner_text() == "Choose the new severity."
    assert page.evaluate("id => ENGINE.exById(id).sev", x) == "S2" and audit_n(page) == n0
    page.select_option("#ops-sev-to", "S3")
    page.fill("#ops-sev-why", "Explained by the new home office claim")
    submit(page)
    closed(page)
    show(page, "Records/Compliance Owner", "exception-" + x)
    click(page, "[data-rv-key='ops-exception-severity'] button[data-act='ops.sevOk'][data-v='0']")
    page.wait_for_function("id => ENGINE.exById(id).sevRequest.status === 'declined'", arg=x)
    assert page.evaluate("id => [ENGINE.exById(id).sev, S.audit[S.audit.length - 1].result, S.audit[S.audit.length - 1].who]", x) == ["S2", "Declined", "RC1"]
    assert "declined" in page.locator("[data-rv-key='ops-exception-severity']").inner_text()
    assert page.errors == []


def test_reject_and_no_reference_outcomes_then_retry_under_a_fresh_g18(page):
    t = sign_ready(page)
    show(page, "Integration Administrator", "sars")
    click(page, f"button[data-act='ops.tx.send'][data-tx='{t}']")
    page.wait_for_selector("#dlg[open]")
    pick(page, "outcome", "no-response")
    submit(page)
    closed(page)
    assert page.evaluate("id => [ENGINE.txById(id).status, S.exceptions.filter((x) => x.txId === id && ENGINE.isOpen(x)).map((x) => x.code).sort()]", t) == ["no-response", ["INT-10", "SUB-03"]]
    click(page, f"button[data-act='ops.tx.check'][data-tx='{t}']")
    page.wait_for_selector("#dlg[open]")
    text = page.locator("#dlg").inner_text()
    assert "INT-10 and SUB-03" in text and "INT-04" not in text
    pick(page, "truth", "not processed")
    submit(page)
    closed(page)
    assert page.evaluate("id => ENGINE.txById(id).status", t) == "not processed"
    click(page, f"button[data-act='ops.tx.retry'][data-tx='{t}']")
    page.wait_for_function("id => ENGINE.txById(id).status === 'superseded'", arg=t)
    n = page.evaluate("id => S.txs.find((x) => x.parentTx === id)", t)
    assert n["status"] == "awaiting G18" and n["signoffs"] == []
    assert page.locator(f"[data-rv-key='ops-sars-txs'] button[data-act='vk.release'][data-tx='{n['id']}']").count() == 1
    # A rejection re-opens the gate and raises INT-09 with SUB-01.
    page.evaluate("""id => { const t = ENGINE.txById(id); ENGINE.signG18(t, ACTOR.as('Integration Administrator')); ENGINE.signG18(t, ACTOR.as('Tax Consultant')); }""", n["id"])
    show(page, "Integration Administrator", "sars")
    click(page, f"button[data-act='ops.tx.send'][data-tx='{n['id']}']")
    page.wait_for_selector("#dlg[open]")
    pick(page, "outcome", "reject")
    submit(page)
    closed(page)
    r = page.evaluate("id => [ENGINE.txById(id).status, S.exceptions.filter((x) => x.txId === id).map((x) => x.code).sort()]", n["id"])
    assert r[0] == "rejected" and {"INT-09", "SUB-01"} <= set(r[1])
    assert "Rejected by SARS" in page.locator("[data-rv-key='ops-sars-txs']").inner_text()
    assert page.errors == []


# ---------------------------------------------------------------- escaping, masking, layout


def test_the_groups_stylesheet_is_in_the_build(page):
    """The layout tests below mean little without views-ops.css: a private build must list views-ops in --only."""
    show(page, "Tax Consultant", "exceptions")
    assert page.evaluate("getComputedStyle(document.querySelector('.ops-filters')).display") == "grid", \
        "views-ops.css is missing: build with --only ...,views-ops"


def test_dynamic_text_is_escaped(page):
    evil = "Ev\"il' <img src=x onerror=alert(1)>"
    x = page.evaluate("""n => { const cl = ENGINE.newClient({ name: n }); const c = ENGINE.newCase(cl, {});
        const r = ENGINE.raiseManual(c, 'KYC-03', ACTOR.as('Administrator'), { note: n });
        ENGINE.receive({ fn: 'notice', taxRef: '0000000001', year: 2026, ref: n, date: '2026-11-06' });
        ENGINE.receive({ fn: 'notice', taxRef: cl.taxRef, year: 2026, ref: 'R1', date: n });  // an unreadable date shows as received
        return r.exception.id; }""", evil)
    for role, route in [("Administrator", "approvals"), ("Administrator", "exceptions"), ("Administrator", "exception-" + x), ("Integration Administrator", "sars")]:
        show(page, role, route)
        assert page.evaluate("document.querySelectorAll('#app img').length") == 0, route
        assert page.evaluate("Array.from(document.querySelectorAll('#app *')).filter((e) => e.hasAttribute('onerror') || e.hasAttribute('il')).length") == 0, route
        assert evil in page.locator("#app").inner_text(), route
    show(page, "Administrator", "exception-" + x)
    click(page, "button[data-act='ops.sev']")
    page.wait_for_selector("#dlg[open]")
    assert page.evaluate("document.querySelectorAll('#dlg img').length") == 0
    page.click("#dlg [data-close]")
    show(page, "Administrator", "exceptions")
    page.fill("#ops-exf-q", evil)
    assert page.evaluate("document.querySelectorAll('#app img').length") == 0
    assert page.locator("[data-rv-key='ops-exceptions-list'] tbody tr").count() >= 1
    assert page.errors == []


def test_identities_are_masked(page):
    ids = page.evaluate("S.clients.map((c) => [c.idNo, c.taxRef])")
    x = page.evaluate("S.exceptions[0].id")
    for role in ROLES:
        for route in ["approvals", "exceptions", "exception-" + x, "sars"]:
            show(page, role, route)
            html = page.evaluate("document.getElementById('app').innerHTML")
            for id_no, tax_ref in ids:
                assert id_no not in html and tax_ref not in html, (role, route)
    show(page, "Integration Administrator", "sars")
    shown = page.locator("[data-rv-key='ops-sars-inbound'] .vk-masked").all_inner_texts()
    assert shown and set(shown) <= set(page.evaluate("S.inbound.map((i) => VK.maskTaxRef(i.taxRef))"))
    assert page.errors == []


@pytest.mark.parametrize("width,scheme", [(390, "dark"), (1280, "light")])
def test_ops_screens_never_scroll_sideways(browser, site, width, scheme):
    ctx = browser.new_context(timezone_id=TZ, viewport={"width": width, "height": 900}, color_scheme=scheme)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(site + "#approvals")
    pg.wait_for_function("typeof VK !== 'undefined' && !!S && S.cases.length > 0")
    pg.evaluate("() => TICKERS.splice(0)")
    ids = pg.evaluate("['INT-04', 'DOC-04', 'KYC-05'].map((k) => S.exceptions.find((x) => x.code === k).id)")
    for role in ROLES:
        for route in ["approvals", "exceptions", "sars"] + ["exception-" + i for i in ids]:
            show(pg, role, route)
            assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), (role, route)
    ctx.close()
    assert errors == []
