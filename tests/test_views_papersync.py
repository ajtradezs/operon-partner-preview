"""PaperSync (src/papersync.js): the firm's page (#papersync) and the client's portal (#portal-<caseId>) on the seeded demo firm.
Every role sees the sections with their review keys, the demo cases sit where the plan puts them, firm actions go through ENGINE
with ACTOR.me() and portal actions through ENGINE.portal() as the client (S.audit grows, refusals included and shown), dynamic
text is escaped and identities masked, and nothing scrolls sideways at phone width."""
import re

import pytest

TZ = "Africa/Johannesburg"
ROLES = ["Tax Consultant", "Administrator", "Integration Administrator", "Information Officer", "Records/Compliance Owner"]
PS_KEYS = ["ps-head", "ps-board", "ps-columns-firm", "ps-na", "ps-kyc", "ps-reminders", "ps-portals", "ps-columns-template",
           "ps-questionnaire", "ps-template", "ps-settings"]
PORTAL_KEYS = ["ps-portal-head", "ps-portal-steps", "ps-portal-questionnaire", "ps-portal-documents", "ps-portal-approval", "ps-portal-messages"]


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


def go(pg, role, hash_):
    pg.evaluate("([r, h]) => { S.signedIn = true; S.role = r; if (location.hash !== h) location.hash = h; render(); }", [role, hash_])
    pg.wait_for_selector("#app [data-rv-key$='-head']")


def click(pg, selector):
    """Click through the review layer's first-visit tip, which may sit over the page."""
    pg.locator(selector).first.evaluate("el => el.click()")


def keys(pg):
    return pg.evaluate("Array.from(document.querySelectorAll('#app [data-rv-key]')).map((e) => e.getAttribute('data-rv-key'))")


def open_portal(pg, case_id, role="Tax Consultant"):
    go(pg, role, "#portal-" + case_id)
    pg.fill("#ps-v-code", "123456")
    click(pg, "form[data-form='ps.verify'] button[type=submit]")
    pg.wait_for_selector("[data-rv-key='ps-portal-documents']")


def toast(pg):
    return pg.evaluate("document.getElementById('toasts').textContent")


# ---------------------------------------------------------------- the firm's page
def test_papersync_renders_for_every_role_with_review_keys(page):
    for role in ROLES:
        go(page, role, "#papersync")
        page.wait_for_function("document.querySelectorAll('#app [data-rv-b]').length > 0")
        ks = keys(page)
        for k in PS_KEYS:
            assert k in ks, (role, k)
        blocks = page.evaluate("Array.from(document.querySelectorAll('#app [data-rv-b]')).map((e) => e.getAttribute('data-rv-key'))")
        assert blocks and all(k and k.startswith("ps-") for k in blocks), (role, blocks)
    assert page.errors == []


def test_board_puts_the_demo_cases_in_the_right_columns(page):
    go(page, "Tax Consultant", "#papersync")
    r = page.evaluate("""() => {
        const col = (k) => Array.from(document.querySelectorAll(`[data-rv-key="ps-board"] .ps-col[data-col="${k}"] .ps-card`)).map((e) => e.innerHTML);
        const has = (k, id) => col(k).some((h) => h.includes('#case-' + id + '"'));
        const K = DEMO.keys;
        const kyc = document.querySelector('[data-rv-key="ps-kyc"]').textContent;
        const hist = document.querySelector('[data-rv-key="ps-reminders"]').innerHTML;
        const portals = Array.from(document.querySelectorAll('[data-rv-key="ps-portals"] a[href^="#portal-"]')).map((a) => a.getAttribute('href'));
        return { kyc: has('kyc', K.onboarding), details: has('questionnaire', K.details), documents: has('documents', K.documents),
          approval: has('approval', K.approval), rework: has('approval', K.rework), remedy: has('authority', K.remedy),
          notReady: has('approval', K.ready), closed: col('kyc').concat(col('documents')).some((h) => h.includes('#case-' + K.closed + '"')),
          kycText: kyc.includes('Proof of address') && kyc.includes('Signed appointment letter and mandate'),
          reminder: hist.includes('#case-' + K.approval + '"'), portals: portals.length, cases: S.cases.filter((c) => !c.archived).length,
          approvalCard: col('approval').find((h) => h.includes('#case-' + K.approval + '"')) || '' };
    }""")
    assert r["kyc"] and r["details"] and r["documents"] and r["approval"] and r["rework"] and r["remedy"]
    assert not r["notReady"] and not r["closed"]
    # Documents are owed only once the questionnaire is in (the portal's steps say the same): the SARS-details and onboarding
    # cases have not submitted it, the questionnaire case has.
    d = page.evaluate("""() => { const ids = Array.from(document.querySelectorAll('[data-rv-key="ps-board"] .ps-col[data-col="documents"] .ps-card a[href^="#case-"]')).map((a) => a.getAttribute('href'));
        return { details: ids.includes('#case-' + DEMO.keys.details), onboarding: ids.includes('#case-' + DEMO.keys.onboarding), questionnaire: ids.includes('#case-' + DEMO.keys.questionnaire) }; }""")
    assert d == {"details": False, "onboarding": False, "questionnaire": True}
    assert r["kycText"] and r["reminder"]
    assert "Reminder out" in r["approvalCard"]
    assert r["portals"] == r["cases"]
    assert page.errors == []


def test_sending_a_reminder_goes_through_engine_and_a_refusal_is_shown(page):
    case = page.evaluate("DEMO.keys.approval")
    go(page, "Administrator", "#papersync")
    n0 = page.evaluate("S.audit.length")
    click(page, f"[data-rv-key='ps-reminders'] button[data-act='ps.remind'][data-case='{case}']")
    r = page.evaluate("""([id, n0]) => ({ hit: S.audit.slice(n0).some((a) => a.caseId === id && a.who === 'AD1' && a.result === 'Sent' && /approval reminder/.test(a.text)),
        n: ENGINE.caseById(id).reminders.length })""", [case, n0])
    assert r == {"hit": True, "n": 2}
    assert "Sent a PaperSync approval reminder" in toast(page)

    go(page, "Information Officer", "#papersync")
    n1 = page.evaluate("S.audit.length")
    click(page, f"[data-rv-key='ps-reminders'] button[data-act='ps.remind'][data-case='{case}']")
    r = page.evaluate("""([id, n1]) => ({ refused: S.audit.slice(n1).some((a) => a.caseId === id && a.who === 'IO1' && a.result === 'Refused'),
        n: ENGINE.caseById(id).reminders.length })""", [case, n1])
    assert r == {"refused": True, "n": 2}
    assert "Not done:" in toast(page)
    assert page.errors == []


def test_whatsapp_message_marks_a_reminder_as_sent(page):
    case = page.evaluate("DEMO.keys.onboarding")
    go(page, "Tax Consultant", "#papersync")
    click(page, f"[data-rv-key='ps-reminders'] button[data-act='ps.share'][data-case='{case}'][data-ch='whatsapp']")
    page.wait_for_selector("#dlg[open]")
    text = page.input_value("#ps-share-text")
    assert "SIMULATED-PORTAL:" + case in text and "Simulated" in page.locator("#dlg").inner_text()
    n0 = page.evaluate("S.audit.length")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    r = page.evaluate("""([id, n0]) => ({ kind: ENGINE.caseById(id).reminders.slice(-1)[0].kind, audit: S.audit.slice(n0).some((a) => a.who === 'TC1' && a.result === 'Sent') })""", [case, n0])
    assert r == {"kind": "onboarding", "audit": True}
    # A plain link copy changes nothing.
    click(page, f"[data-rv-key='ps-portals'] button[data-act='ps.share'][data-case='{case}'][data-ch='link']")
    page.wait_for_selector("#dlg[open]")
    assert page.locator("#dlg-ok").count() == 0
    assert page.errors == []


def test_kyc_received_and_na_approval_go_through_engine(page):
    case = page.evaluate("DEMO.keys.onboarding")
    cl = page.evaluate("ENGINE.caseById(DEMO.keys.onboarding).clientId")
    go(page, "Administrator", "#papersync")
    # m1: the button is an action ("Mark received"), not a status that reads "Proof of address Received".
    labels = page.locator("[data-rv-key='ps-kyc'] button[data-act='ps.kyc']").all_inner_texts()
    assert labels and all(t.strip() == "Mark received" for t in labels), labels
    n0 = page.evaluate("S.audit.length")
    click(page, f"[data-rv-key='ps-kyc'] button[data-act='ps.kyc'][data-client='{cl}'][data-key='address']")
    r = page.evaluate("""([cl, n0]) => ({ ok: S.clients.find((x) => x.id === cl).kyc.find((k) => k.key === 'address').ok,
        audit: S.audit.slice(n0).some((a) => a.who === 'AD1' && /Proof of address/.test(a.text)) })""", [cl, n0])
    assert r == {"ok": True, "audit": True}
    # Once nothing is missing the client owes no KYC, so the case leaves the board's KYC column (G01 is now the firm's step).
    click(page, f"[data-rv-key='ps-kyc'] button[data-act='ps.kyc'][data-client='{cl}'][data-key='mandate']")
    in_kyc = page.evaluate("id => Array.from(document.querySelectorAll('[data-rv-key=\"ps-board\"] .ps-col[data-col=\"kyc\"] a')).some((a) => a.getAttribute('href') === '#case-' + id)", case)
    assert in_kyc is False

    # The client says a document is not available; a Tax Consultant approves the reason on the PaperSync page.
    doc_case = page.evaluate("DEMO.keys.documents")
    item = page.evaluate("ENGINE.caseById(DEMO.keys.documents).items.find((i) => i.kind === 'medical').id")
    open_portal(page, doc_case)
    click(page, f"[data-ps-drop='{item}'] button[data-act='ps.na']")
    page.wait_for_selector("#dlg[open]")
    page.click("#dlg-ok")
    assert page.locator("#dlg-err").inner_text() == "Say why first."
    page.fill("#ps-reason", "My medical aid closed in March")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    assert page.evaluate("([c, i]) => ENGINE.caseById(c).items.find((x) => x.id === i).na", [doc_case, item]) == "requested"

    go(page, "Records/Compliance Owner", "#papersync")
    click(page, f"[data-rv-key='ps-na'] button[data-act='ps.approveNa'][data-item='{item}']")
    assert "Not done:" in toast(page)
    go(page, "Tax Consultant", "#papersync")
    click(page, f"[data-rv-key='ps-na'] button[data-act='ps.approveNa'][data-item='{item}']")
    r = page.evaluate("""([c, i]) => ({ na: ENGINE.caseById(c).items.find((x) => x.id === i).na,
        refused: S.audit.some((a) => a.who === 'RC1' && a.result === 'Refused' && a.caseId === c), approved: S.audit.some((a) => a.who === 'TC1' && a.result === 'Approved' && a.caseId === c) })""", [doc_case, item])
    assert r == {"na": "approved", "refused": True, "approved": True}
    assert page.errors == []


def test_papersync_escapes_client_names_and_masks_identities(page):
    evil = "<img src=x onerror=alert(1)>"
    page.evaluate("n => { const cl = ENGINE.newClient({ name: n, kyc: { address: false } }); ENGINE.newCase(cl, {}); }", evil)
    ids = page.evaluate("S.clients.map((c) => [c.idNo, c.taxRef])")
    for role in ROLES:
        go(page, role, "#papersync")
        r = page.evaluate("n => ({ imgs: document.querySelectorAll('#app img').length, shown: document.getElementById('app').textContent.includes(n), html: document.getElementById('app').innerHTML })", evil)
        assert r["imgs"] == 0 and r["shown"], role
        for id_no, tax_ref in ids:
            assert id_no not in r["html"] and tax_ref not in r["html"], role
    case = page.evaluate("S.cases[S.cases.length - 1].id")
    click(page, f"[data-rv-key='ps-reminders'] button[data-act='ps.share'][data-case='{case}'][data-ch='email']")
    page.wait_for_selector("#dlg[open]")
    assert page.evaluate("document.querySelectorAll('#dlg img').length") == 0
    page.evaluate("closeDialog()")
    open_portal(page, case)
    assert page.evaluate("document.querySelectorAll('#app img').length") == 0
    assert evil in page.locator("#app h1").inner_text()
    assert page.errors == []


# ---------------------------------------------------------------- the portal
def test_portal_needs_the_one_time_code_and_renders_for_every_role(page):
    case = page.evaluate("DEMO.keys.approval")
    go(page, "Tax Consultant", "#portal-" + case)
    assert "ps-portal-verify" in keys(page) and "ps-portal-documents" not in keys(page)
    page.fill("#ps-v-code", "000000")
    click(page, "form[data-form='ps.verify'] button[type=submit]")
    assert "does not match" in page.locator("#ps-v-err").inner_text()
    page.fill("#ps-v-code", "123456")
    click(page, "form[data-form='ps.verify'] button[type=submit]")
    page.wait_for_selector("[data-rv-key='ps-portal-documents']")
    for role in ROLES:
        go(page, role, "#portal-" + case)
        ks = keys(page)
        for k in PORTAL_KEYS:
            assert k in ks, (role, k)
        assert all(k.startswith("ps-") for k in ks), (role, ks)
    go(page, "Tax Consultant", "#portal-C99")
    assert "ps-portal-unknown" in keys(page)
    # After a reset the code is asked for again.
    page.evaluate("() => { const keep = { role: S.role }; seed(); Object.assign(S, keep); S.signedIn = true; render(); }")
    go(page, "Tax Consultant", "#portal-" + case)
    assert "ps-portal-verify" in keys(page)
    assert page.errors == []


def test_questionnaire_answers_and_submit_go_through_the_portal(page):
    case = page.evaluate("""() => { const cl = ENGINE.newClient({ name: 'Portal Tester' }); const c = ENGINE.newCase(cl, { items: ['irp5'] });
        ENGINE.drive(c, 'G03'); return c.id; }""")
    open_portal(page, case)
    n0 = page.evaluate("S.audit.length")
    click(page, "[data-rv-key='ps-portal-questionnaire'] button[data-act='ps.submitQ']")
    assert "Not done:" in toast(page)
    r = page.evaluate("""([id, n0]) => ({ refused: S.audit.slice(n0).some((a) => a.caseId === id && a.role === 'Client' && a.result === 'Refused'),
        que01: ENGINE.hasOpen(ENGINE.caseById(id), 'QUE-01') })""", [case, n0])
    assert r == {"refused": True, "que01": True}
    req = page.evaluate("id => ENGINE.caseById(id).questionnaire.required", case)
    for k in req:
        page.locator(f"#ps-q-{k}-{'1' if k in ('employment', 'interest') else '0'}").check()
    r = page.evaluate("""id => ({ answers: ENGINE.caseById(id).questionnaire.answers,
        audit: S.audit.filter((a) => a.caseId === id && a.role === 'Client' && /^Answered/.test(a.text)).length })""", case)
    assert r["answers"]["employment"] is True and r["answers"]["interest"] is True and r["answers"]["medical"] is False
    assert r["audit"] == len(req)
    click(page, "[data-rv-key='ps-portal-questionnaire'] button[data-act='ps.submitQ']")
    r = page.evaluate("""id => { const c = ENGINE.caseById(id); return { status: c.questionnaire.status, g03: c.gates.G03.status, it3b: c.items.some((i) => i.kind === 'it3b'),
        que01: ENGINE.hasOpen(c, 'QUE-01'), audit: S.audit.some((a) => a.caseId === id && a.role === 'Client' && a.gate === 'G03' && a.result === 'Released') }; }""", case)
    assert r == {"status": "submitted", "g03": "released", "it3b": True, "que01": False, "audit": True}
    assert page.locator("[data-rv-key='ps-portal-questionnaire'] input[type=radio]").count() == 0
    assert page.errors == []


def test_upload_by_drop_picker_and_sample_keeps_only_name_and_size(page):
    case = page.evaluate("DEMO.keys.documents")
    open_portal(page, case)
    item = page.evaluate("ENGINE.caseById(DEMO.keys.documents).items.find((i) => i.kind === 'medical').id")
    n0 = page.evaluate("S.audit.length")
    # Drop a file on the checklist row.
    page.evaluate("""([item]) => { const row = document.querySelector(`[data-ps-drop="${item}"]`);
        const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(30000)], 'Medical_scheme_certificate_2026.pdf', { type: 'application/pdf' }));
        row.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }""", [item])
    r = page.evaluate("""([id, item, n0]) => { const c = ENGINE.caseById(id); const d = c.docs.filter((x) => x.itemId === item).pop();
        return { name: d && d.name, size: d && d.size, status: d && d.status, keys: d ? Object.keys(d).sort() : [],
          audit: S.audit.slice(n0).some((a) => a.role === 'Client' && a.who === c.clientId && /^Uploaded Medical_scheme/.test(a.text)) }; }""", [case, item, n0])
    assert r["name"] == "Medical_scheme_certificate_2026.pdf" and r["size"] == 30000 and r["status"] == "validated" and r["audit"]
    assert "content" not in r["keys"] and "data" not in r["keys"]
    assert "Accepted" in page.locator(f"[data-ps-drop='{item}']").inner_text()
    # The file picker on the IRP5 row.
    irp5 = page.evaluate("ENGINE.caseById(DEMO.keys.documents).items.find((i) => i.kind === 'irp5').id")
    with page.expect_file_chooser() as fc:
        click(page, f"[data-ps-drop='{irp5}'] button[data-act='ps.pick']")
    fc.value.set_files({"name": "IRP5_2026.pdf", "mimeType": "application/pdf", "buffer": b"x" * 40000})
    page.wait_for_function("id => ENGINE.caseById(id).docs.some((d) => d.name === 'IRP5_2026.pdf')", arg=case)
    # A sample file.
    click(page, f"[data-ps-drop='{irp5}'] button[data-act='ps.sample']")
    assert page.evaluate("id => ENGINE.caseById(id).docs.filter((d) => d.name === 'IRP5_2026.pdf').length", case) == 2
    # A program is quarantined, never opened (DOC-10, an incident).
    page.evaluate("""([item]) => { const row = document.querySelector(`[data-ps-drop="${item}"]`);
        const dt = new DataTransfer(); dt.items.add(new File(['MZ'], 'invoice.exe'));
        row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }""", [irp5])
    r = page.evaluate("id => { const c = ENGINE.caseById(id); return { status: c.docs.slice(-1)[0].status, doc10: ENGINE.hasOpen(c, 'DOC-10'), inc: S.incidents.some((i) => i.caseId === id && i.codes.includes('DOC-10')) }; }", case)
    assert r == {"status": "quarantined", "doc10": True, "inc": True}
    assert "Quarantined" in page.locator(f"[data-ps-drop='{irp5}']").inner_text()
    assert page.errors == []


def test_uploaded_file_names_are_escaped(page):
    case = page.evaluate("DEMO.keys.documents")
    open_portal(page, case)
    item = page.evaluate("ENGINE.caseById(DEMO.keys.documents).items[0].id")
    page.evaluate("""([item]) => { const row = document.querySelector(`[data-ps-drop="${item}"]`);
        const dt = new DataTransfer(); dt.items.add(new File(['x'], '<img src=x onerror=alert(1)>.pdf'));
        row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }""", [item])
    r = page.evaluate("() => ({ imgs: document.querySelectorAll('#app img').length, shown: document.getElementById('app').textContent.includes('<img src=x onerror=alert(1)>.pdf') })")
    assert r == {"imgs": 0, "shown": True}
    assert page.errors == []


def test_submit_documents_flags_what_is_missing(page):
    case = page.evaluate("""() => { const cl = ENGINE.newClient({ name: 'Docs Tester' }); const c = ENGINE.newCase(cl, { items: ['irp5', 'ra'] }); ENGINE.drive(c, 'G04'); return c.id; }""")
    open_portal(page, case)
    click(page, "[data-rv-key='ps-portal-documents'] button[data-act='ps.submitDocs']")
    r = page.evaluate("id => ({ doc01: ENGINE.hasOpen(ENGINE.caseById(id), 'DOC-01'), audit: S.audit.some((a) => a.caseId === id && a.role === 'Client' && a.result === 'Submitted') })", case)
    assert r == {"doc01": True, "audit": True}
    assert "Still needed: IRP5 employee tax certificate; Retirement annuity certificate" in toast(page)
    assert page.evaluate("id => ENGINE.exOf(ENGINE.caseById(id)).filter((x) => x.code === 'DOC-01').length === ENGINE.caseById(id).items.length", case)
    # Submitting again with the same documents still missing must not tell the client everything is in.
    page.evaluate("document.getElementById('toasts').innerHTML = ''")
    click(page, "[data-rv-key='ps-portal-documents'] button[data-act='ps.submitDocs']")
    t = toast(page)
    assert "Still needed: IRP5 employee tax certificate" in t and "everything is in" not in t
    assert page.errors == []


def test_approval_is_asked_for_only_at_g06_and_rows_lock_after_submission(page):
    # The calculation case is still at G05: the client sees no approval form and no approve button.
    open_portal(page, page.evaluate("DEMO.keys.calcReady"))
    sec = page.locator("[data-rv-key='ps-portal-approval']")
    assert sec.locator("form[data-form='ps.approve']").count() == 0
    assert "still checking version 1" in sec.inner_text()
    # The approval case is at G06: the form is there.
    open_portal(page, page.evaluate("DEMO.keys.approval"))
    assert page.locator("[data-rv-key='ps-portal-approval'] form[data-form='ps.approve'] button[type=submit]").count() == 1
    # The closed case was submitted: no upload buttons and no drop targets, so a dropped file changes nothing.
    closed = page.evaluate("DEMO.keys.closed")
    open_portal(page, closed)
    assert page.locator("[data-rv-key='ps-portal-documents'] [data-ps-drop]").count() == 0
    assert page.locator("[data-rv-key='ps-portal-documents'] button[data-act='ps.pick']").count() == 0
    n = page.evaluate("id => ENGINE.caseById(id).docs.length", closed)
    page.evaluate("""() => { const row = document.querySelector('[data-rv-key="ps-portal-documents"] .ps-item');
        const dt = new DataTransfer(); dt.items.add(new File(['x'], 'IRP5_2026.pdf'));
        row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }""")
    assert page.evaluate("id => ENGINE.caseById(id).docs.length", closed) == n
    assert page.errors == []


def test_assessment_shows_sars_figures_and_the_differences(page):
    # W3: the ITA34 is in (G12 still open), so the client is told the accountant is checking it: no figures, no decision buttons.
    case = page.evaluate("DEMO.keys.assessment")
    assert page.evaluate("id => { const c = ENGINE.caseById(id); return [!!c.ita34, ENGINE.stepDone(c, 'G13')]; }", case) == [True, False]
    open_portal(page, case)
    sec = page.locator("[data-rv-key='ps-portal-assessment']")
    text = sec.inner_text()
    assert "Your accountant is checking it" in text
    assert sec.locator("button[data-act='ps.decide']").count() == 0
    diffs = page.evaluate("id => ENGINE.caseById(id).ita34.recon.diffs.map((d) => d.label)", case)
    assert diffs and not any(label in text for label in diffs)
    # The Tax Consultant reconciles the ITA34 (ASM-02, G12) and approves the explanation (G13): now the client sees it and decides.
    page.evaluate("""id => { const c = ENGINE.caseById(id); const tc = ACTOR.as('Tax Consultant');
        ENGINE.openOf(c, 'ASM-02').forEach((x) => ENGINE.resolve(x, tc, { action: 'SARS used a lower retirement annuity figure than the certificate' }));
        if (c.gates.G12.status !== 'released') ENGINE.release(c, 'G12', tc);
        ENGINE.markReq(c, 'G13', 'advice', tc); ENGINE.release(c, 'G13', tc); render(); }""", case)
    assert page.evaluate("id => ENGINE.stepDone(ENGINE.caseById(id), 'G13')", case) is True
    assert sec.locator("button[data-act='ps.decide']").count() == 2
    exp = page.evaluate("""id => { const c = ENGINE.caseById(id); return { result: c.ita34.values.result, diffs: c.ita34.recon.diffs.map((d) => d.label) }; }""", case)
    assert isinstance(exp["result"], (int, float)) and exp["diffs"], exp
    text = page.locator("[data-rv-key='ps-portal-assessment']").inner_text()
    money = page.evaluate("v => CALC.rand(Math.abs(v))", exp["result"])
    assert money in text and ("refund due to you" if exp["result"] < 0 else "payable to SARS") in text
    for label in exp["diffs"]:
        assert label in text
    assert "Not given" not in text and not re.search(r"\d{4}-\d{2}-\d{2}", text)  # dates are shown as words, not ISO strings
    assert page.errors == []


def test_notes_and_reasons_are_escaped(page):
    evil = "<img src=x onerror=alert(1)> \"quoted\" 'single' <b>bold</b>"
    case = page.evaluate("DEMO.keys.documents")
    item = page.evaluate("ENGINE.caseById(DEMO.keys.documents).items.find((i) => i.kind === 'medical').id")
    open_portal(page, case)
    click(page, f"[data-ps-drop='{item}'] button[data-act='ps.na']")
    page.wait_for_selector("#dlg[open]")
    page.fill("#ps-reason", evil)
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    check = "n => ({ imgs: document.querySelectorAll('#app img').length, bold: Array.from(document.querySelectorAll('#app b')).some((b) => b.textContent === 'bold'), shown: document.getElementById('app').textContent.includes(n) })"
    assert page.evaluate(check, evil) == {"imgs": 0, "bold": False, "shown": True}
    go(page, "Tax Consultant", "#papersync")
    assert evil in page.locator("[data-rv-key='ps-na']").inner_text()
    assert page.evaluate(check, evil) == {"imgs": 0, "bold": False, "shown": True}
    assert page.errors == []


def test_version_specific_approval_with_the_declaration(page):
    case = page.evaluate("DEMO.keys.approval")
    open_portal(page, case)
    sec = page.locator("[data-rv-key='ps-portal-approval']")
    r = page.evaluate("""id => { const v = ENGINE.curVersion(ENGINE.caseById(id)); const sec = document.querySelector('[data-rv-key="ps-portal-approval"]');
        return { hash: sec.querySelector('.ps-hash').textContent === v.itr12, decl: sec.querySelector('.ps-decl').textContent === DECLARATION,
          version: sec.querySelector('form').dataset.version === String(v.n) }; }""", case)
    assert r == {"hash": True, "decl": True, "version": True}
    n0 = page.evaluate("S.audit.length")
    click(page, "[data-rv-key='ps-portal-approval'] button[type=submit]")
    assert "Not done: Confirm the declaration first" in toast(page)
    assert page.evaluate("([id, n0]) => S.audit.slice(n0).some((a) => a.caseId === id && a.role === 'Client' && a.result === 'Refused')", [case, n0])
    page.locator("#ps-decl").check()
    click(page, "[data-rv-key='ps-portal-approval'] button[type=submit]")
    r = page.evaluate("""id => { const c = ENGINE.caseById(id); return { g06: c.gates.G06.status, ap: c.approval && c.approval.version, decl: c.approval && c.approval.declaration === DECLARATION,
        audit: S.audit.some((a) => a.caseId === id && a.role === 'Client' && a.result === 'Approved' && a.evidence === DECLARATION) }; }""", case)
    assert r == {"g06": "released", "ap": page.evaluate("id => ENGINE.vN(ENGINE.caseById(id))", case), "decl": True, "audit": True}
    assert "You approved version" in sec.inner_text()
    # Withdraw it: CLT-06 and G06 re-opened.
    click(page, "[data-rv-key='ps-portal-approval'] button[data-act='ps.withdraw']")
    page.wait_for_selector("#dlg[open]")
    page.fill("#ps-reason", "I found another certificate")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    r = page.evaluate("id => { const c = ENGINE.caseById(id); return { clt06: ENGINE.hasOpen(c, 'CLT-06'), g06: c.gates.G06.status !== 'released', withdrawn: !!c.approval.withdrawn }; }", case)
    assert r == {"clt06": True, "g06": True, "withdrawn": True}
    assert page.errors == []


def test_reject_and_withhold_raise_their_codes(page):
    case = page.evaluate("DEMO.keys.approval")
    open_portal(page, case)
    click(page, "[data-rv-key='ps-portal-approval'] button[data-act='ps.withhold']")
    page.wait_for_selector("#dlg[open]")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    click(page, "[data-rv-key='ps-portal-approval'] button[data-act='ps.reject']")
    page.wait_for_selector("#dlg[open]")
    page.fill("#ps-reason", "The medical credits look wrong")
    page.click("#dlg-ok")
    page.wait_for_function("!document.getElementById('dlg').open")
    r = page.evaluate("id => { const c = ENGINE.caseById(id); return [ENGINE.hasOpen(c, 'CLT-04'), ENGINE.hasOpen(c, 'CLT-02')]; }", case)
    assert r == [True, True]
    assert page.errors == []


def test_assessment_decision_and_remedy_authority(page):
    case = page.evaluate("""() => { const cl = ENGINE.newClient({ name: 'Decision Tester' }); const c = ENGINE.newCase(cl, {}); ENGINE.drive(c, 'G14'); return c.id; }""")
    assert page.evaluate("id => ENGINE.currentGate(ENGINE.caseById(id))", case) == "G14"
    open_portal(page, case)
    assert "ps-portal-assessment" in keys(page)
    click(page, "[data-rv-key='ps-portal-assessment'] button[data-choice='accept']")
    r = page.evaluate("id => { const c = ENGINE.caseById(id); return { g14: c.gates.G14.status, choice: c.decision.choice, by: c.gates.G14.by }; }", case)
    assert r["g14"] == "released" and r["choice"] == "accept"
    assert "You accepted the assessment" in page.locator("[data-rv-key='ps-portal-assessment']").inner_text()

    rem = page.evaluate("DEMO.keys.remedy")
    open_portal(page, rem)
    assert "ps-portal-remedy" in keys(page)
    n0 = page.evaluate("S.audit.length")
    click(page, "[data-rv-key='ps-portal-remedy'] button[data-act='ps.authorise']")
    r = page.evaluate("""([id, n0]) => { const c = ENGINE.caseById(id); return { route: c.remedy.authority && c.remedy.authority.route,
        audit: S.audit.slice(n0).some((a) => a.caseId === id && a.role === 'Client' && a.result === 'Authorised') }; }""", [rem, n0])
    assert r == {"route": "objection", "audit": True}
    assert page.errors == []


CODE_RX = re.compile(r"\b(?:[A-Z]{2,4}-\d{2}|G\d{2})\b")
FIRM_CHECKING = "Your accountant is checking something before this step completes."


def steps_of(pg):
    return pg.evaluate("""() => Object.fromEntries(Array.from(document.querySelectorAll('[data-rv-key="ps-portal-steps"] .ps-step'))
        .map((li) => [li.querySelector('.ps-step-l').textContent, li.querySelector('.pill').textContent]))""")


def test_questionnaire_can_be_sent_again_once_the_firm_has_checked_it(page):
    # B1: the questionnaire case was submitted, then G03 was held for QUE-04 and QUE-03.
    case = page.evaluate("DEMO.keys.questionnaire")
    assert page.evaluate("id => { const c = ENGINE.caseById(id); return [c.questionnaire.status, c.gates.G03.status, ENGINE.openOf(c, 'QUE-04').length, ENGINE.openOf(c, 'QUE-03').length]; }", case) == ["submitted", "pending", 1, 1]
    open_portal(page, case)
    sec = page.locator("[data-rv-key='ps-portal-questionnaire']")
    # The answers can be changed and sent again; while the firm is still checking, the step is the firm's and says so plainly.
    assert sec.locator("input[type=radio]").count() > 0
    assert sec.locator("button[data-act='ps.submitQ']").inner_text().strip() == "Send my answers again"
    assert FIRM_CHECKING in sec.inner_text()
    assert steps_of(page)["Questionnaire"] == "With your accountant"
    click(page, "[data-rv-key='ps-portal-questionnaire'] button[data-act='ps.submitQ']")
    t = toast(page)
    assert FIRM_CHECKING in t and not CODE_RX.search(t), t
    assert page.evaluate("id => ENGINE.caseById(id).gates.G03.status", case) == "pending"
    # The Tax Consultant resolves the QUE codes: it is now the client's turn.
    page.evaluate("""id => { const c = ENGINE.caseById(id); const tc = ACTOR.as('Tax Consultant');
        ['QUE-04', 'QUE-03'].forEach((k) => ENGINE.openOf(c, k).forEach((x) => ENGINE.resolve(x, tc, { action: 'Confirmed with the client by phone' }))); render(); }""", case)
    assert page.evaluate("id => ENGINE.gateState(ENGINE.caseById(id), 'G03').state", case) == "ready"
    assert steps_of(page)["Questionnaire"] == "Your turn"
    go(page, "Tax Consultant", "#papersync")
    assert page.evaluate("id => Array.from(document.querySelectorAll('[data-rv-key=\"ps-board\"] .ps-col[data-col=\"questionnaire\"] a')).some((a) => a.getAttribute('href') === '#case-' + id)", case)
    go(page, "Tax Consultant", "#portal-" + case)
    # The client corrects one answer first (recorded as their own action), then sends the answers again: G03 passes.
    key = page.evaluate("id => { const c = ENGINE.caseById(id); return ENGINE.QUESTIONS.map((q) => q.key).find((k) => !(k in c.questionnaire.answers)); }", case)
    assert key, "every question is already answered on the questionnaire case"
    n0 = page.evaluate("S.audit.length")
    page.locator(f"#ps-q-{key}-0").check()
    click(page, "[data-rv-key='ps-portal-questionnaire'] button[data-act='ps.submitQ']")
    r = page.evaluate("""([id, n0]) => { const c = ENGINE.caseById(id); const n = S.audit.slice(n0).filter((a) => a.caseId === id);
        return { g03: c.gates.G03.status, by: c.gates.G03.byType, answered: n.some((a) => a.role === 'Client' && a.result === 'Saved'),
          released: n.some((a) => a.role === 'Client' && a.gate === 'G03' && a.result === 'Released') }; }""", [case, n0])
    assert r == {"g03": "released", "by": "client", "answered": True, "released": True}, r
    assert "Your answers are sent again" in toast(page)
    assert steps_of(page)["Questionnaire"] == "Done"
    assert page.locator("[data-rv-key='ps-portal-questionnaire'] input[type=radio]").count() == 0
    assert "Sent your answers again" in page.locator("[data-rv-key='ps-portal-messages']").inner_text()
    assert page.errors == []


def test_what_you_did_shows_only_the_clients_own_actions_in_plain_words(page):
    # M3: the questionnaire case's audit has a refused G03 release with QUE codes; the client never sees it.
    case = page.evaluate("DEMO.keys.questionnaire")
    assert page.evaluate("id => S.audit.some((a) => a.caseId === id && a.role === 'Client' && a.result === 'Refused' && /QUE-04/.test(a.text))", case)
    open_portal(page, case)
    msgs = page.locator("[data-rv-key='ps-portal-messages']").inner_text()
    assert "Sent your questionnaire to your accountant" in msgs and "Opened your portal" in msgs
    assert FIRM_CHECKING in msgs
    assert "Refused" not in msgs and not CODE_RX.search(msgs), msgs
    assert page.locator("[data-rv-key='ps-portal-messages'] .pill").count() == 0
    # The remedy case: the client's decision and approval, in plain words; no "Released G14", no "Raised CLT-07".
    rem = page.evaluate("DEMO.keys.remedy")
    open_portal(page, rem)
    msgs = page.locator("[data-rv-key='ps-portal-messages']").inner_text()
    assert "Asked your accountant to act on SARS’s assessment" in msgs
    assert "Approved version 1 of your return" in msgs
    assert "Released" not in msgs and "Raised" not in msgs and not CODE_RX.search(msgs), msgs
    assert page.errors == []


def test_approval_card_holds_the_step_13_review_package(page):
    # W4: the approval case at G06. The package has the five parts the workflow's step 13 lists, from the exact version asked for.
    case = page.evaluate("DEMO.keys.approval")
    open_portal(page, case)
    want = page.evaluate("STEP[13].items.map((s) => s.replace(/\\.$/, ''))")
    assert len(want) == 5
    sec = page.locator("[data-rv-key='ps-portal-approval']")
    summaries = sec.locator(".ps-pack-i > summary").all_inner_texts()
    assert [s.split(". ", 1)[1] for s in summaries] == want, summaries
    page.evaluate("document.querySelectorAll('.ps-pack-i').forEach((d) => { d.open = true; })")
    part = lambda n: sec.locator(f".ps-pack-i[data-pack='{n}'] .ps-pack-b").inner_text()
    d = page.evaluate("""id => { const v = ENGINE.curVersion(ENGINE.caseById(id)); const k = v.data.calc;
        return { ti: CALC.rand(k.summary.taxableIncome), res: CALC.rand(Math.abs(k.summary.result)), refund: k.summary.result < 0, nt: CALC.rand(k.summary.normalTax),
          paye: CALC.rand(k.summary.paye), decl: Object.values(v.data.itr12.declared).map((e) => [e.label, CALC.rand(e.amount)]), months: v.data.itr12.medical.months }; }""", case)
    calc = part(1)
    assert "Taxable income" in calc and d["ti"] in calc and d["nt"] in calc and d["res"] in calc
    assert ("Refund due to you" if d["refund"] else "Amount you will owe SARS") in calc
    assert "s6A" not in calc and "s11F" not in calc and "Tax on your taxable income" in calc  # plain labels
    sched = part(2)
    assert "Employment:" in sched and d["paye"] in sched and "Medical:" in sched
    itr = part(3)
    for label, amount in d["decl"]:
        assert label in itr and amount in itr, label
    assert f"Medical scheme membership: {d['months']} months" in itr
    report = part(4)
    assert d["ti"] in report and d["res"] in report and "SARS makes the final assessment" in report
    matters = part(5)
    assert "Change from last year" in matters and "Nothing else is still open" in matters
    # The version hash and the declaration are still there, after the package.
    assert sec.locator(".ps-hash").count() == 1 and sec.locator(".ps-decl").count() == 1
    assert page.evaluate("""() => { const s = document.querySelector('[data-rv-key="ps-portal-approval"]');
        return s.querySelector('.ps-pack').compareDocumentPosition(s.querySelector('.ps-decl')) & Node.DOCUMENT_POSITION_FOLLOWING; }""")
    assert page.errors == []


def test_review_package_shows_judgement_decisions_and_the_year_on_year_explanation(page):
    # W4: the judgement case once the Tax Consultant has decided the home office line, explained the change and the case reached G06.
    evil = "<img src=x onerror=alert(1)> dedicated room"
    case = page.evaluate("""n => { const c = ENGINE.caseById(DEMO.keys.judgement); const tc = ACTOR.as('Tax Consultant');
        c.inputs.lines.filter((l) => CALC.FIELDS[l.field].judgement).forEach((l) => ENGINE.decideItem(c, l.id, tc, { amount: l.amount, rationale: n }));
        ENGINE.calculate(c, tc, { reason: 'Recalculated with the decision' });
        ENGINE.exOf(c).filter((x) => ENGINE.isOpen(x)).forEach((x) => ENGINE.resolve(x, tc, { action: x.code === 'TAX-05' ? 'New employer from March, higher salary' : 'Decision recorded' }));
        const r = ENGINE.drive(c, 'G06'); return r.ok ? c.id : 'drive failed: ' + r.why; }""", evil)
    assert case.startswith("C"), case
    open_portal(page, case)
    page.evaluate("document.querySelectorAll('.ps-pack-i').forEach((d) => { d.open = true; })")
    matters = page.locator("[data-rv-key='ps-portal-approval'] .ps-pack-i[data-pack='5'] .ps-pack-b").inner_text()
    assert "Home office expenses" in matters and "Your accountant’s decision: " + evil in matters
    assert "Your accountant’s explanation: New employer from March, higher salary" in matters
    assert page.evaluate("document.querySelectorAll('#app img').length") == 0
    assert page.errors == []


@pytest.mark.parametrize("width,scheme", [(390, "dark"), (1280, "light")])
def test_papersync_and_portal_never_scroll_sideways(browser, site, width, scheme):
    ctx = browser.new_context(timezone_id=TZ, viewport={"width": width, "height": 900}, color_scheme=scheme)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(site + "#today")
    pg.wait_for_function("typeof VK !== 'undefined' && !!S && S.cases.length > 0")
    pg.evaluate("() => TICKERS.splice(0)")
    for role in ROLES:
        go(pg, role, "#papersync")
        assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), role
    for key in ("documents", "approval", "remedy", "questionnaire"):
        cid = pg.evaluate(f"DEMO.keys.{key}")
        open_portal(pg, cid)
        assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), key
    ctx.close()
    assert errors == []
