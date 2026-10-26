"""Document collections tests: create and send, the client portal, uploads, task integration, reminders, reset,
security (escaping, no external links, no FileReader), rendering at 1280/390 in light and dark, and the review layer.

Run from partner-preview/:  python -m pytest tests -q
"""
import os
import re

import pytest
from playwright.sync_api import expect

from conftest import identity_script
from test_review import arrange, drag, named, no_errors, note_on, select_block

NO_FILEREADER = ("window.__fr = 0; window.FileReader = function () { window.__fr += 1; "
                 "throw new Error('FileReader must not be used'); };")
EVIL_TITLE = '<img src=x onerror="window.__xss=1">'
LONG = "\\\\?\\"
EVIL_FILE ='<img src=x onerror="window.__xss=2">.pdf'


def signed(s):
    """Sign in and dismiss the first-visit tip so it never covers the controls under test."""
    s.sign_in()
    tip = s.page.locator('[data-rv="tipok"]')
    if tip.count() and tip.first.is_visible():
        tip.first.click()
    s.page.evaluate("document.querySelectorAll('.toast').forEach(t => t.remove())")
    return s


def col(s, key):
    return s.page.locator(f'#app [data-rv-key="coll-col-{key}"]')


def token_of(s, cid):
    return s.page.evaluate("id => S.coll.list.find(k => k.id === id).token", cid)


def open_portal(s, cid, verify=True):
    s.go("#portal-" + token_of(s, cid))
    if verify:
        p = s.page
        answer = p.locator("#app .dc-portal .hint .mono").text_content()
        p.fill("#dc-v", answer)
        p.click("#app form[data-form=dcVerify] button[type=submit]")
        expect(p.locator("#app .dc-pitem").first).to_be_visible()


def upload(s, item_locator, name, body=b"%PDF-1.4 synthetic demo file\n", mime="application/pdf", rerender=False):
    """Click Upload (opens the OS picker), optionally let the app re-render, then choose an in-memory file."""
    p = s.page
    with p.expect_file_chooser():
        item_locator.locator('button[data-act="dcUp"]').click()
    if rerender:
        # A timer tick re-renders #app while the picker is open; the input lives outside #app, so the choice still lands.
        p.evaluate("document.querySelector('#app').firstElementChild.dataset.stale = '1'; schedule(0, () => {});")
        p.wait_for_function("!document.querySelector('#app [data-stale]')", timeout=5000)
    p.set_input_files("#dc-file", files=[{"name": name, "mimeType": mime, "buffer": body}])


def create_collection(s, client_id, title, send=None, rows=None):
    p = s.page
    s.go("#collections")
    p.click('#app button[data-act="dcNew"]')
    p.wait_for_function("location.hash === '#collection-new'")
    p.select_option("#dc-n-client", client_id)
    p.fill("#dc-n-title", title)
    p.fill("#dc-n-period", "October 2026")
    p.click('#app button[data-act="dcMode"][data-v="specific"]')
    if rows:
        names = p.locator("#app .dc-row input[data-k=name]")
        for i, r in enumerate(rows):
            names.nth(i).fill(r)
    if send:
        p.click(f'#app button[data-act="dcSendVia"][data-v="{send}"]')
    p.click("#app form[data-form=dcCreate] button[type=submit]")
    p.wait_for_function("/^#collection-DC\\d+$/.test(location.hash)")
    return p.evaluate("location.hash.slice(12)")


def audit_count(s, pattern, **match):
    return s.page.evaluate("""([src, m]) => { const re = new RegExp(src);
        return S.audit.filter(a => re.test(a.text) && Object.entries(m).every(([k, v]) => a[k] === v)).length; }""", [pattern, match])


# ---------------------------------------------------------------- the main flow

def test_create_send_portal_complete_moves_task_once(session):
    s = signed(session(init=[identity_script(named("Coll")), NO_FILEREADER]))
    p = s.page
    s.go("#collections")
    expect(col(s, "pending")).to_be_visible()
    # Create and send: Kloof Street Bakery, which feeds task J15 (waiting on the client).
    s.go("#collection-new")
    p.select_option("#dc-n-client", "C16")
    expect(p.locator("#dc-n-feeds")).to_have_value("J15")
    p.fill("#dc-n-title", "Bank statements {prev_month} {year}")
    expect(p.locator("#dc-n-preview")).to_have_text("Bank statements September 2026")
    p.click('#app button[data-act="dcMode"][data-v="specific"]')
    expect(p.locator("#app .dc-row")).to_have_count(2)
    p.click('#app button[data-act="dcRowAdd"]')
    expect(p.locator("#app .dc-row")).to_have_count(3)
    p.locator("#app .dc-row").nth(2).locator('button[data-act="dcRowDel"]').click()
    expect(p.locator("#app .dc-row")).to_have_count(2)
    p.locator("#app .dc-row input[data-k=name]").nth(0).fill("Bank statement September 2026")
    p.locator("#app .dc-row input[data-k=name]").nth(1).fill("Bank statement August 2026")
    p.click("#app form[data-form=dcCreate] button[type=submit]")
    p.wait_for_function("location.hash === '#collection-DC14'")
    expect(p.locator("#app h1")).to_have_text("Bank statements September 2026")
    assert audit_count(s, "^Sent the document request “Bank statements September 2026”", tier="auto", who="Comms Triage") == 1
    s.go("#collections")
    card = col(s, "pending").locator('a[href="#collection-DC14"]')
    expect(card).to_contain_text("Feeds task J15")
    expect(card).to_contain_text("0/2 docs")
    # Open the portal from the detail page, in-app.
    s.go("#collection-DC14")
    p.click('#app button[data-act="dcPreview"]')
    tok = token_of(s, "DC14")
    p.wait_for_function("t => location.hash === '#portal-' + t", arg=tok)
    expect(p.locator("#app h1")).to_have_text("Verify your identity")
    p.fill("#dc-v", "000000")
    p.click("#app form[data-form=dcVerify] button[type=submit]")
    expect(p.locator("#dc-v-err")).to_contain_text("doesn’t match")
    p.fill("#dc-v", p.locator("#app .dc-portal .hint .mono").text_content())
    p.click("#app form[data-form=dcVerify] button[type=submit]")
    items = p.locator("#app .dc-pitem")
    expect(items).to_have_count(2)
    # Upload a synthetic in-memory file, with a re-render while the picker is open.
    requests = []
    p.on("request", lambda r: requests.append(r.url))
    upload(s, items.nth(0), "statement-sep-2026.pdf", rerender=True)
    expect(items.nth(0)).to_contain_text("statement-sep-2026.pdf")
    expect(p.locator("#app .dc-progline")).to_contain_text("1 of 2 documents uploaded")
    assert requests == [], requests
    assert p.evaluate("S.coll.list.find(k => k.id === 'DC14').status") == "in_progress"
    # Mark the other item N/A: the client is asked "Is that everything?" (the seed asks for confirmation) and says yes.
    items.nth(1).locator('button[data-act="dcNa"]').click()
    expect(p.locator("#app h1")).to_have_text("Is that everything?")
    p.click('#app button[data-act="dcConfirm"][data-v="yes"]')
    expect(p.locator("#app h1")).to_have_text("All documents submitted")
    expect(p.locator("#app .dc-portal")).to_contain_text("Thank you! Acacia & Partners Inc. (Demo) has been notified.")
    # The firm board, the task and the audit.
    s.go("#collections")
    expect(col(s, "complete").locator('a[href="#collection-DC14"]')).to_have_count(1)
    assert p.evaluate("task('J15').state") == "ai"
    s.go("#task-J15")
    expect(p.locator("#app .pagehead")).to_contain_text("AI at work")
    expect(p.locator("#app")).to_contain_text("Moved from Awaiting client to AI at work")
    assert audit_count(s, "from Awaiting client to AI at work", task="J15", tier="auto") == 1
    assert audit_count(s, "uploaded “statement-sep-2026.pdf”", who="Client portal") == 1
    assert audit_count(s, "submitted all documents for “Bank statements September 2026”") == 1
    s.go("#observe")
    expect(p.locator("#app table")).to_contain_text("from Awaiting client to AI at work")
    # Completing the other J15 collection from the firm side does not move the task again.
    s.go("#collection-DC02")
    p.click('#app button[data-act="dcDone"]')
    p.click("#dlg-ok")
    expect(p.locator("#app .pagehead")).to_contain_text("Complete")
    assert audit_count(s, "from Awaiting client to AI at work", task="J15") == 1
    assert p.evaluate("task('J15').log.filter(l => /to AI at work/.test(l.text)).length") == 1
    assert p.evaluate("window.__fr") == 0
    no_errors(s)


def test_firm_completion_of_j14_moves_it_from_needs_you(session):
    s = signed(session(init=identity_script(named("CollJ14"))))
    p = s.page
    assert p.evaluate("task('J14').state") == "needs"
    s.go("#task-J14")
    expect(s.block("coll-task")).to_contain_text("Bank statements Aug–Sep 2026")
    s.go("#collection-DC01")
    p.click('#app button[data-act="dcDone"]')
    p.click("#dlg-ok")
    assert p.evaluate("task('J14').state") == "ai"
    assert audit_count(s, "to AI at work", task="J14", tier="auto") == 1
    s.go("#collection-DC01")
    p.click('#app button[data-act="dcReopen"]')
    p.click('#app button[data-act="dcDone"]')
    p.click("#dlg-ok")
    assert audit_count(s, "to AI at work", task="J14") == 1
    no_errors(s)


def test_reminders_run_is_logged(session):
    s = signed(session(init=identity_script(named("Remind"))))
    p = s.page
    s.go("#collections")
    p.click('#app button[data-act="dcTab"][data-v="settings"]')
    expect(p.locator("#app h2", has_text="Automatic reminders")).to_be_visible()
    p.click('#app button[data-act="dcCad"][data-v="3"]')
    expect(p.locator('#app button[data-act="dcCad"][data-v="3"]')).to_have_attribute("aria-pressed", "true")
    before = p.evaluate("S.audit.length")
    p.click('#app button[data-act="dcRun"]')
    run = s.block("coll-rem-run")
    expect(run).to_contain_text("Last run at")
    expect(run).to_contain_text("Skipped: Mokoena Holdings: ITR12 2026: Naledi Mokoena (director) (Awaiting the client’s confirmation)")
    expect(run).to_contain_text("Sent: Limpopo Agri Supplies: Bank statements Aug–Sep 2026")
    sent = p.evaluate("S.coll.lastRun.sent")
    assert "DC01" in sent and "DC09" not in sent and "DC06" not in sent, sent
    new = p.evaluate("n => S.audit.slice(n)", before)
    rem = [a for a in new if a["text"].startswith("Sent reminder")]
    assert len(rem) == len(sent) and all(a["tier"] == "auto" and a["who"] == "Comms Triage" and a["rule"] == "R03" for a in rem), rem
    assert any(a["text"].startswith("Ran today’s document reminders") and a["tier"] == "auto" for a in new)
    assert p.evaluate("S.coll.list.find(k => k.id === 'DC01').reminders") == 5
    s.go("#collection-DC01")
    expect(s.block("coll-detail-activity")).to_contain_text("Reminder 5 sent by email (Auto, Comms Triage)")
    s.go("#task-J14")
    expect(p.locator("#app")).to_contain_text("Document reminder 5 sent")
    no_errors(s)


def test_reset_restores_collections_and_keeps_notes(session):
    s = signed(session(init=identity_script(named("CollReset"))))
    p = s.page
    s.go("#collections")
    note_on(s, "coll-board", "Make the overdue column louder")
    expect(s.block("coll-board").locator(":scope > .rv-pin")).to_contain_text("1 note")
    create_collection(s, "C2", "Extra request", rows=["Fuel slips", "Toll statements"])
    s.go("#collection-DC04")
    p.click('#app button[data-act="dcCancel"]')
    p.click("#dlg-ok")
    assert p.evaluate("S.coll.list.length") == 14
    assert p.evaluate("S.coll.list.find(k => k.id === 'DC04').status") == "cancelled"
    s.go("#account")
    p.click('#app button[data-act="reset"]')
    p.click("#dlg-ok")
    s.go("#collections")
    assert p.evaluate("S.coll.list.length") == 13
    assert p.evaluate("S.coll.list.find(k => k.id === 'DC04').status") == "pending"
    expect(col(s, "pending").locator('a[href="#collection-DC04"]')).to_have_count(1)
    expect(s.block("coll-board").locator(":scope > .rv-pin")).to_contain_text("1 note")
    no_errors(s)


# ---------------------------------------------------------------- uploads and inputs

def test_file_input_lives_outside_app_and_drag_and_drop_works(session):
    s = signed(session(init=[identity_script(named("Drop")), NO_FILEREADER]))
    p = s.page
    s.go("#collections")
    open_portal(s, "DC02")
    assert p.locator("#app input[type=file]").count() == 0
    row = p.locator("#app .dc-pitem").filter(has_text="Bank statement August 2026")
    upload(s, row, "first.pdf")
    expect(p.locator("#app h1")).to_have_text("Is that everything?")  # that was the last missing document
    p.click('#app button[data-act="dcConfirm"][data-v="no"]')
    expect(row).to_contain_text("first.pdf")
    p.evaluate("render(); render();")
    assert p.evaluate("document.querySelectorAll('input[type=file]').length") == 1
    assert p.evaluate("document.getElementById('dc-file').parentElement === document.body")
    row.locator('button[data-act="dcUnup"]').click()
    expect(row.locator('button[data-act="dcUp"]')).to_be_visible()
    # Desktop drag-and-drop of a file onto the row.
    p.evaluate("""() => { const row = [...document.querySelectorAll('#app .dc-pitem')].find(r => r.textContent.includes('Bank statement August 2026'));
        const dt = new DataTransfer(); dt.items.add(new File(['synthetic'], 'dropped-aug.pdf', { type: 'application/pdf' }));
        row.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        row.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""")
    expect(p.locator("#app h1")).to_have_text("Is that everything?")
    p.click('#app button[data-act="dcConfirm"][data-v="no"]')
    expect(p.locator("#app .dc-pitem").filter(has_text="Bank statement August 2026")).to_contain_text("dropped-aug.pdf")
    expect(p.locator("#app button[data-act=dcSubmit]")).to_be_enabled()
    assert p.evaluate("window.__fr") == 0
    no_errors(s)


def test_typed_text_survives_timer_rerenders(session):
    s = signed(session(init=identity_script(named("Typing"))))
    p = s.page

    def tick_render():
        p.evaluate("document.querySelector('#app').firstElementChild.dataset.stale = '1'; schedule(0, () => {});")
        p.wait_for_function("!document.querySelector('#app [data-stale]')", timeout=5000)

    s.go("#collection-new")
    p.select_option("#dc-n-client", "C5")
    p.fill("#dc-n-title", "Half-typed titl")
    p.fill("#dc-n-period", "Q3")
    p.locator("#app .dc-row input[data-k=name]").nth(0).fill("Edited row name")
    p.focus("#dc-n-title")
    tick_render()
    expect(p.locator("#dc-n-title")).to_have_value("Half-typed titl")
    expect(p.locator("#dc-n-period")).to_have_value("Q3")
    expect(p.locator("#app .dc-row input[data-k=name]").nth(0)).to_have_value("Edited row name")
    assert p.evaluate("document.activeElement.id") == "dc-n-title"
    p.keyboard.type("e")
    expect(p.locator("#dc-n-title")).to_have_value("Half-typed title")
    # Structure changes keep what was typed too.
    p.click('#app button[data-act="dcRowAdd"]')
    expect(p.locator("#dc-n-title")).to_have_value("Half-typed title")
    expect(p.locator("#app .dc-row input[data-k=name]").nth(0)).to_have_value("Edited row name")
    # Templates: the add-item form and the document-type form.
    s.go("#collections")
    p.click('#app button[data-act="dcTab"][data-v="templates"]')
    p.fill("#dc-ta-name", "Vehicle logbook")
    p.fill("#dc-ta-desc", "For travel claims")
    tick_render()
    expect(p.locator("#dc-ta-name")).to_have_value("Vehicle logbook")
    expect(p.locator("#dc-ta-desc")).to_have_value("For travel claims")
    p.click("#app form[data-form=dcTplAdd] button[type=submit]")
    expect(s.block("coll-tpl-checklist")).to_contain_text("Vehicle logbook")
    expect(p.locator("#dc-ta-name")).to_have_value("")
    p.click('#app button[data-act="dcTplTab"][data-v="doc"]')
    p.fill("#dc-dt-name", "Fuel card statement")
    tick_render()
    expect(p.locator("#dc-dt-name")).to_have_value("Fuel card statement")
    # Settings: the custom cadence number.
    p.click('#app button[data-act="dcTab"][data-v="settings"]')
    p.click('#app button[data-act="dcCad"][data-v="custom"]')
    p.fill("#dc-s-custom", "9")
    tick_render()
    expect(p.locator("#dc-s-custom")).to_have_value("9")
    assert p.evaluate("S.coll.set.custom") == 9
    no_errors(s)


# ---------------------------------------------------------------- security

def test_markup_in_title_file_name_and_templates_renders_as_text(session):
    s = signed(session(init=[identity_script(named("CollXss")), NO_FILEREADER]))
    p = s.page
    cid = create_collection(s, "C2", EVIL_TITLE, rows=["<b onmouseover=\"window.__xss=3\">Docs</b>", "Second"])
    expect(p.locator("#app h1")).to_have_text(EVIL_TITLE)
    s.go("#collections")
    expect(p.locator(f'#app a[href="#collection-{cid}"] .jc-title')).to_have_text(EVIL_TITLE)
    open_portal(s, cid)
    expect(p.locator("#app .dc-portal h1")).to_have_text(EVIL_TITLE)
    upload(s, p.locator("#app .dc-pitem").nth(0), EVIL_FILE)
    expect(p.locator("#app .dc-pitem").nth(0).locator(".dc-file")).to_contain_text(EVIL_FILE)
    for h in ["#collection-" + cid, "#collections", "#today", "#client-C2", "#observe"]:
        s.go(h)
        assert EVIL_FILE in p.locator("#app").text_content() or h in ("#client-C2",), h
    s.go("#client-C2")
    expect(s.block("coll-client")).to_contain_text(EVIL_TITLE)
    # Template and document-type text.
    s.go("#collections")
    p.click('#app button[data-act="dcTab"][data-v="templates"]')
    p.fill("#dc-ta-name", '<svg onload="window.__xss=4">')
    p.click("#app form[data-form=dcTplAdd] button[type=submit]")
    expect(s.block("coll-tpl-checklist")).to_contain_text('<svg onload="window.__xss=4">')
    p.click('#app button[data-act="dcTplTab"][data-v="doc"]')
    p.fill("#dc-dt-name", '<iframe src="x">')
    p.click("#app form[data-form=dcDtAdd] button[type=submit]")
    expect(s.block("coll-doctypes")).to_contain_text('<iframe src="x">')
    # Bad ids and tokens from the hash never render anything from the hash.
    s.go("#collection-zz9")
    expect(p.locator("#app h1")).to_contain_text("Collection not found")
    s.go("#portal-zz9")
    expect(p.locator("#app h1")).to_have_text("This link doesn’t work")
    p.wait_for_timeout(200)
    assert p.evaluate("window.__xss") is None
    assert p.locator("img[src=x], #app svg[onload], #app iframe, #app b[onmouseover]").count() == 0
    no_errors(s)


def _views(s):
    """Yield (label) after putting each collections view on screen."""
    p = s.page
    s.go("#collections")
    yield "board"
    p.click('#app button[data-act="dcTab"][data-v="templates"]')
    yield "templates"
    p.click('#app button[data-act="dcTplTab"][data-v="doc"]')
    yield "doctypes"
    p.click('#app button[data-act="dcTab"][data-v="settings"]')
    yield "reminders"
    p.click('#app button[data-act="dcTab"][data-v="board"]')
    for cid in ["DC02", "DC01", "DC08", "DC12", "DC13"]:
        s.go("#collection-" + cid)
        yield "detail-" + cid
    s.go("#collection-new")
    yield "new"
    s.go("#collection-nothere1")
    yield "notfound"
    open_portal(s, "DC02", verify=False)
    yield "portal-verify"
    open_portal(s, "DC02")
    yield "portal-checklist"
    p.evaluate("S.coll.set.confirm = true; render();")
    p.locator("#app .dc-pitem").filter(has_text="Bank statement August 2026").locator('button[data-act="dcNa"]').click()
    expect(p.locator("#app h1")).to_have_text("Is that everything?")
    yield "portal-confirm"
    p.click('#app button[data-act="dcConfirm"][data-v="yes"]')
    yield "portal-done"
    s.go("#portal-" + token_of(s, "DC12"))
    yield "portal-cancelled"
    s.go("#portal-nope1")
    yield "portal-unknown"
    for h in ["#today", "#task-J16", "#task-J14", "#client-C1"]:
        s.go(h)
        yield h[1:]


def test_collections_views_have_no_external_links_and_no_data_in_attributes(session):
    s = signed(session(init=identity_script(named("Links"))))
    s.ctx.grant_permissions(["clipboard-read", "clipboard-write"])
    p = s.page
    check = """() => {
      const out = [];
      const roots = [...document.querySelectorAll('#app .dc, #app [data-rv-key^="coll-"], #dlg')];
      for (const r of roots) {
        for (const a of r.querySelectorAll('[href]')) { const h = a.getAttribute('href'); if (!/^#[A-Za-z0-9\\-]*$/.test(h)) out.push('href ' + h); }
        for (const e of r.querySelectorAll('[src], [srcset], [action], [formaction]')) out.push('src ' + e.outerHTML.slice(0, 80));
        for (const e of r.querySelectorAll('[style]')) { if (!/^gap:\\d+(px)?$/.test(e.getAttribute('style'))) out.push('style ' + e.getAttribute('style')); }
        if (/https?:|wa\\.me|mailto:|whatsapp:\\/\\//i.test(r.innerHTML)) out.push('external text in ' + (r.id || r.className));
      }
      return out;
    }"""
    for label in _views(s):
        assert p.evaluate(check) == [], label
    # Copy portal link shows and copies the simulated link; WhatsApp is a modal with the message, not a link.
    s.go("#collection-DC03")
    p.click('#app button[data-act="dcCopy"]')
    tok = token_of(s, "DC03")
    expect(p.locator("#dc-link")).to_have_value("SIMULATED-PORTAL:" + tok)
    p.wait_for_function("t => navigator.clipboard.readText().then(x => x === 'SIMULATED-PORTAL:' + t)", arg=tok, timeout=5000)
    assert p.evaluate(check) == []
    p.click("#dlg [data-close]")
    p.click('#app button[data-act="dcWa"]')
    expect(p.locator("#dc-wa-text")).to_contain_text("SIMULATED-PORTAL:" + tok)
    assert p.evaluate(check) == []
    p.click("#dlg-ok")
    expect(s.block("coll-detail-activity")).to_contain_text("by WhatsApp")
    no_errors(s)


# ---------------------------------------------------------------- rendering

@pytest.mark.parametrize("width,scheme", [(1280, "light"), (1280, "dark"), (390, "light"), (390, "dark")])
def test_collections_views_render_cleanly(session, shots, width, scheme):
    s = signed(session(width=width, scheme=scheme, init=identity_script(named("CollRoutes"))))
    p = s.page
    small = """() => [...document.querySelectorAll('#app .dc button, #app .dc a, #app .dc select, #app .dc input:not([type=checkbox]):not([type=hidden]), #app .dc label.dc-check, ' +
                  '#app [data-rv-key^="coll-"] button, #app [data-rv-key^="coll-"] a, #app [data-rv-key^="coll-"] select')]
        .filter(e => !e.closest('[data-rv-ui]') && e.offsetParent !== null)
        .filter(e => e.getBoundingClientRect().height < 32).map(e => e.tagName + ' ' + (e.textContent || e.id).trim().slice(0, 40))"""
    named_shots = {"board": "board", "templates": "templates", "reminders": "reminders", "detail-DC02": "detail", "new": "new",
                   "portal-verify": "portal-verify", "portal-checklist": "portal-checklist", "portal-done": "portal-done"}
    for label in _views(s):
        assert p.locator("#app h1").count() >= 1, label
        sw = p.evaluate("document.documentElement.scrollWidth")
        assert sw <= width, f"horizontal scroll on {label}: {sw}px"
        if not label.startswith(("today", "task", "client")):
            assert p.evaluate(small) == [], label
        else:
            assert p.locator('#app [data-rv-key^="coll-"]').count() >= 1, label
        if label in named_shots:
            p.evaluate("document.querySelectorAll('.toast').forEach(t => t.remove()); document.querySelectorAll('.rv-bar, .rv-tip').forEach(e => e.style.visibility = 'hidden')")
            png = p.screenshot(full_page=True)
            out = str((shots / f"collections-{named_shots[label]}-{width}-{scheme}.png").resolve())
            if os.name == "nt" and len(out) > 240 and not out.startswith(LONG):
                out = LONG + out  # long scratchpad paths exceed MAX_PATH on Windows
            with open(out, "wb") as fh:
                fh.write(png)
            p.evaluate("document.querySelectorAll('.rv-bar, .rv-tip').forEach(e => e.style.visibility = '')")
    no_errors(s)


# ---------------------------------------------------------------- review layer on the collections pages

def test_notes_and_arrange_work_on_collections_pages(session):
    s = signed(session(init=identity_script(named("CollArr")), height=1400))
    p = s.page
    s.go("#collections")
    for key in ["coll-head", "coll-stats", "coll-actions", "coll-board", "coll-col-overdue", "coll-col-complete", "coll-recent", "coll-stat-docs"]:
        expect(s.block(key)).to_have_count(1)
    note_on(s, "coll-col-overdue", "Overdue cards should show the client phone")
    expect(s.block("coll-col-overdue").locator(":scope > .rv-pin")).to_contain_text("1 note")
    # A note on the detail checklist applies to every collection page (same route type, same key).
    s.go("#collection-DC02")
    note_on(s, "coll-detail-checklist", "Show who uploaded each file")
    s.go("#collection-DC03")
    expect(s.block("coll-detail-checklist").locator(":scope > .rv-pin")).to_contain_text("1 note")
    # Arrange the board page: reorder columns, hide a block, make a stat half width, rename a heading.
    s.go("#collections")
    arrange(s)
    order = "() => [...document.querySelectorAll('#app .dc-board > [data-rv-b]')].map(e => e.getAttribute('data-rv-b')).join(',')"
    before = p.evaluate(order)
    drag(p, s.block("coll-col-complete"), s.block("coll-col-overdue"), where=0.3, fx=0.12)
    after = p.evaluate(order)
    assert after != before and after.split(",")[0] == "coll-col-complete", after
    select_block(s, "coll-recent")
    p.click('.rv-abar [data-rv="hide"]')
    expect(s.block("coll-recent")).to_have_class(re.compile(r"\brv-hidden\b"))
    p.dblclick('#app [data-rv-b="coll-board"] h2')
    p.keyboard.press("Control+A")
    p.keyboard.type("What came back")
    p.keyboard.press("Enter")
    expect(p.locator('#app [data-rv-b="coll-board"] h2')).to_have_text("What came back")
    p.click('.rv-abar [data-rv="done"]')
    p.reload()
    p.wait_for_selector(".rv-bar:not([hidden])")
    s.go("#collections")
    assert p.evaluate(order).split(",")[0] == "coll-col-complete"
    expect(s.block("coll-recent")).to_be_hidden()
    expect(p.locator('#app [data-rv-b="coll-board"] h2')).to_have_text("What came back")
    expect(s.block("coll-col-overdue").locator(":scope > .rv-pin")).to_contain_text("1 note")
    # Arrange mode on the portal and the detail page does not error.
    s.go("#collection-DC02")
    arrange(s)
    s.go("#portal-" + token_of(s, "DC02"))
    s.go("#collection-new")
    p.click('.rv-abar [data-rv="done"]')
    no_errors(s)


# ---------------------------------------------------------------- review findings: lifecycle, reminders, audit, templates

def coll(s, cid):
    return s.page.evaluate("""id => { const k = S.coll.list.find(k => k.id === id);
        return { status: k.status, awaiting: k.awaitingConfirm, fed: k.fed, task: k.task && task(k.task) ? task(k.task).state : null,
                 act: k.act.map(a => a.text), reminders: k.reminders }; }""", cid)


def test_f1_without_confirmation_the_last_upload_completes(session):
    s = signed(session(init=identity_script(named("F1"))))
    p = s.page
    # The seed never shows a client as awaiting confirmation unless the setting asks for it.
    assert p.evaluate("S.coll.set.confirm || !S.coll.list.some(k => dcActive(k) && k.awaitingConfirm)")
    p.evaluate("S.coll.set.confirm = false")
    open_portal(s, "DC04")
    items = p.locator("#app .dc-pitem")
    expect(items).to_have_count(3)
    upload(s, items.nth(0), "lumen.pdf")
    upload(s, items.nth(1), "kraal.pdf")
    upload(s, items.nth(2), "bright-spark.pdf")
    expect(p.locator("#app h1")).to_have_text("All documents submitted")
    k = coll(s, "DC04")
    assert (k["status"], k["awaiting"], k["task"]) == ("complete", False, "ai"), k
    s.go("#collections")
    card = col(s, "complete").locator('a[href="#collection-DC04"]')
    expect(card).to_have_count(1)
    expect(card).not_to_contain_text("Awaiting client confirmation")
    no_errors(s)


def test_f2_reopen_after_a_portal_submission_lets_the_client_upload_again(session):
    s = signed(session(init=identity_script(named("F2"))))
    p = s.page
    p.evaluate("S.coll.set.confirm = true")
    open_portal(s, "DC06")
    items = p.locator("#app .dc-pitem")
    upload(s, items.nth(0), "municipal-account.pdf")
    items.nth(1).locator('button[data-act="dcNa"]').click()
    if p.locator('#app button[data-act="dcSubmit"]').count():
        p.click('#app button[data-act="dcSubmit"]')
    p.click('#app button[data-act="dcConfirm"][data-v="yes"]')
    expect(p.locator("#app h1")).to_have_text("All documents submitted")
    s.go("#collection-DC06")
    p.click('#app button[data-act="dcReopen"]')
    assert coll(s, "DC06")["status"] == "in_progress"
    open_portal(s, "DC06", verify=False)
    expect(p.locator("#app .dc-portal h1")).to_have_text("New registered address")
    expect(p.locator('#app button[data-act="dcUnup"]')).to_have_count(1)
    expect(p.locator('#app button[data-act="dcUnna"]')).to_have_count(1)
    no_errors(s)


def test_f3_awaiting_confirmation_only_while_the_question_is_pending(session):
    s = signed(session(init=identity_script(named("F3"))))
    p = s.page
    p.evaluate("S.coll.set.confirm = true")
    open_portal(s, "DC05")
    items = p.locator("#app .dc-pitem")
    upload(s, items.nth(0), "count-sheet.pdf")
    assert coll(s, "DC05")["awaiting"] is False
    upload(s, items.nth(1), "valuation.pdf")
    # The client is asked as soon as everything is in, and only then is the collection awaiting confirmation.
    expect(p.locator("#app h1")).to_have_text("Is that everything?")
    assert coll(s, "DC05")["awaiting"] is True
    p.click('#app button[data-act="dcConfirm"][data-v="no"]')
    expect(p.locator("#app .dc-pitem")).to_have_count(2)
    k = coll(s, "DC05")
    assert (k["status"], k["awaiting"]) == ("in_progress", False), k
    s.go("#collections")
    card = col(s, "in_progress").locator('a[href="#collection-DC05"]')
    expect(card).not_to_contain_text("Awaiting client confirmation")
    expect(card).to_contain_text("AI chasing")
    p.evaluate("dcRunReminders()")
    assert not [x for x in p.evaluate("S.coll.lastRun.skipped") if x["id"] == "DC05" and "confirmation" in x["why"]]
    no_errors(s)


def test_f4_reminder_run_respects_cadence_last_reminder_and_switch(session):
    s = signed(session(init=identity_script(named("F4"))))
    p = s.page
    s.go("#collections")
    p.click('#app button[data-act="dcTab"][data-v="settings"]')
    p.click('#app button[data-act="dcRun"]')
    run = p.evaluate("S.coll.lastRun")
    why = {x["id"]: x["why"] for x in run["skipped"]}
    # DC04 was reminded at 09:00 today and the cadence is weekly, so it is not reminded again an hour later.
    assert "DC04" not in run["sent"] and "Reminded" in why.get("DC04", ""), run
    assert "DC01" in run["sent"], run
    expect(s.block("coll-rem-run")).to_contain_text("Supplier tax invoices for VAT201 (Reminded")
    p.click('#app button[data-act="dcRun"]')
    assert p.evaluate("S.coll.lastRun.sent") == []
    # With automatic reminders off, the run sends nothing and says why.
    p.click("#dc-s-auto")
    assert p.evaluate("S.coll.set.auto") is False
    p.evaluate("S.coll.list.find(k => k.id === 'DC01').lastRem = day(-30, 9, 0)")
    before = coll(s, "DC01")["reminders"]
    p.click('#app button[data-act="dcRun"]')
    assert p.evaluate("S.coll.lastRun.sent") == []
    assert coll(s, "DC01")["reminders"] == before
    expect(s.block("coll-rem-run")).to_contain_text("Automatic reminders are off")
    no_errors(s)


def test_f5_activity_events_reach_the_audit_trail(session):
    s = signed(session(init=[identity_script(named("F5")), NO_FILEREADER]))
    p = s.page
    cid = create_collection(s, "C2", "Fuel and tolls", send="link", rows=["Fuel slips", "Toll statements"])
    expect(p.locator("#dc-link")).to_be_visible()
    p.click("#dlg [data-close]")
    assert audit_count(s, "^Created the document collection “Fuel and tolls”") == 1
    assert audit_count(s, "portal link for “Fuel and tolls”") >= 2  # ready to copy, then copied
    open_portal(s, cid)
    items = p.locator("#app .dc-pitem")
    upload(s, items.nth(0), "fuel.pdf")
    assert audit_count(s, "“Fuel and tolls”.*In progress", who="Client portal") == 1
    items.nth(0).locator('button[data-act="dcUnup"]').click()
    assert audit_count(s, "removed “fuel.pdf” from Fuel slips", who="Client portal") == 1
    items.nth(1).locator('button[data-act="dcNa"]').click()
    items.nth(1).locator('button[data-act="dcUnna"]').click()
    assert audit_count(s, "undid not applicable for Toll statements", who="Client portal") == 1
    s.go("#collection-DC10")
    p.click('#app button[data-act="dcArchive"]')
    p.click('#app button[data-act="dcUnarchive"]')
    assert audit_count(s, "^Unarchived the document collection “AFS pack FY2026”") == 1
    no_errors(s)


def test_f6_feeds_task_offers_only_tasks_waiting_on_the_client(session):
    s = signed(session(init=identity_script(named("F6"))))
    p = s.page
    s.go("#collection-new")
    for cid in ["C2", "C16", "C17"]:
        p.select_option("#dc-n-client", cid)
        assert p.evaluate("[...document.querySelectorAll('#dc-n-feeds option')].filter(o => o.value).every(o => dcWaiting(task(o.value)))"), cid
    p.select_option("#dc-n-client", "C16")
    expect(p.locator("#dc-n-feeds")).to_have_value("J15")
    # A collection linked to a task that is not waiting leaves the task alone and says so.
    k = p.evaluate("""() => { const k = dcMake({ c: 'C2', title: 'Linked to a task that is not waiting', task: 'J01', type: 'custom', items: [{ sec: 'General', name: 'A' }] });
        dcComplete(k, false); return { fed: k.fed, state: task('J01').state, act: k.act.map(a => a.text).join(' | '), id: k.id }; }""")
    assert (k["fed"], k["state"]) == (False, "signoff"), k
    assert "not waiting on the client" in k["act"], k
    s.go("#collection-" + k["id"])
    expect(s.block("coll-detail-task")).not_to_contain_text("fed the task")
    expect(s.block("coll-detail-task")).to_contain_text("not waiting on the client")
    no_errors(s)


def test_f7_task_page_shows_the_linked_collection_after_it_completes(session):
    s = signed(session(init=identity_script(named("F7"))))
    p = s.page
    s.go("#collection-DC04")
    p.click('#app button[data-act="dcDone"]')
    p.click("#dlg-ok")
    assert coll(s, "DC04")["task"] == "ai"
    s.go("#task-J17")
    card = s.block("coll-task")
    expect(card).to_have_count(1)
    expect(card).to_contain_text("Complete")
    expect(card.locator('a[href="#collection-DC04"]').first).to_be_visible()
    expect(card).not_to_contain_text("Send a reminder now")
    no_errors(s)


def test_f8_document_type_used_in_counts_match_whole_names(session):
    s = signed(session(init=identity_script(named("F8"))))
    p = s.page
    s.go("#collections")
    p.click('#app button[data-act="dcTab"][data-v="templates"]')
    p.click('#app button[data-act="dcTplTab"][data-v="doc"]')
    used = dict(p.evaluate("[...document.querySelectorAll('#app [data-rv-key=coll-doctypes] tbody tr')].map(r => [r.cells[0].textContent, +r.cells[3].textContent])"))
    assert used["Bank confirmation letter"] == 1, used
    assert used["ID copy"] == 1, used
    assert used["Proof of address"] == 1, used
    assert used["Share register"] == 0, used
    assert used["Directors’ resolution"] == 0, used
    assert used["Bank statement"] == 2, used
    assert used["IRP5 / IT3(a)"] == 1, used
    no_errors(s)


def test_f9_copy_to_is_not_offered_on_a_one_section_template(session):
    s = signed(session(init=identity_script(named("F9"))))
    p = s.page
    s.go("#collections")
    p.click('#app button[data-act="dcTab"][data-v="templates"]')
    expect(p.locator('#app button[data-act="dcTiCopy"]').first).to_be_visible()
    p.click('#app button[data-act="dcTplSel"][data-id="payroll"]')
    expect(s.block("coll-tpl-checklist")).to_contain_text("Timesheets for the month")
    expect(p.locator('#app button[data-act="dcTiCopy"]')).to_have_count(0)
    no_errors(s)


def test_f10_custom_cadence_copy_follows_the_number(session):
    s = signed(session(init=identity_script(named("F10"))))
    p = s.page
    s.go("#collections")
    p.click('#app button[data-act="dcTab"][data-v="settings"]')
    p.click('#app button[data-act="dcCad"][data-v="custom"]')
    p.fill("#dc-s-custom", "10")
    expect(s.block("coll-rem-auto")).to_contain_text("who still owes documents, every 10 days.")
    assert p.evaluate("document.activeElement.id") == "dc-s-custom"
    no_errors(s)


# ---------------------------------------------------------------- review findings: layout

def test_ux4_phone_detail_puts_the_checklist_first(session):
    s = signed(session(width=390, init=identity_script(named("UX4"))))
    s.go("#collection-DC02")
    check, acts = s.block("coll-detail-checklist").bounding_box()["y"], s.block("coll-detail-actions").bounding_box()["y"]
    assert check < acts and check < 700, (check, acts)
    no_errors(s)


@pytest.mark.parametrize("width", [1024, 1180, 1280, 1440])
def test_ux5_board_columns_line_up(session, width):
    s = signed(session(width=width, init=identity_script(named("UX5"))))
    p = s.page
    s.go("#collections")
    hs = p.evaluate("[...document.querySelectorAll('#app .dc-board > .col > header')].map(h => Math.round(h.getBoundingClientRect().height))")
    tops = p.evaluate("[...document.querySelectorAll('#app .dc-board > .col')].map(c => { const f = c.querySelector('.dc-card, .empty-col'); return f ? Math.round(f.getBoundingClientRect().top) : null; })")
    assert len(hs) == 5 and len(set(hs)) == 1, (width, hs)
    assert len(set(tops)) == 1, tops
    no_errors(s)


def test_ux7_counts_are_pluralised(session):
    s = signed(session(init=identity_script(named("UX7"))))
    p = s.page
    one = re.compile(r"(?<![\d.,/])1 (documents|sections|docs|reminders)\b")
    s.go("#collections")
    p.click('#app button[data-act="dcTab"][data-v="templates"]')
    expect(s.block("coll-tpl-types")).to_contain_text("1 section")
    assert not one.search(p.locator("#app").text_content())
    s.go("#task-J16")  # DC03 has sent 1 reminder
    expect(s.block("coll-task")).to_contain_text("1 reminder sent")
    assert not one.search(p.locator("#app").text_content())
    no_errors(s)


def test_ux8_search_without_matches_shows_one_message(session):
    s = signed(session(init=identity_script(named("UX8"))))
    p = s.page
    s.go("#collections")
    p.fill("#dc-q", "zzzz")
    board = s.block("coll-board")
    expect(board).to_contain_text("No collections match “zzzz”.")
    expect(board.locator(".dc-board")).to_have_count(0)
    expect(board.locator(".empty-col")).to_have_count(0)
    board.locator('button[data-act="dcQClear"]').click()
    expect(p.locator("#dc-q")).to_have_value("")
    expect(board.locator(".dc-board > .col")).to_have_count(5)
    no_errors(s)


@pytest.mark.parametrize("width", [1280, 390])
def test_segmented_controls_and_template_buttons_are_not_stretched(session, width):
    s = signed(session(width=width, init=identity_script(named("Seg"))))
    p = s.page
    slack = """() => [...document.querySelectorAll('#app .dc .seg')].filter(g => g.offsetParent).map(g => {
        const rows = {}; for (const b of g.querySelectorAll('button')) { const r = b.getBoundingClientRect(); const k = Math.round(r.top); rows[k] = (rows[k] || 0) + r.width; }
        // a control that wraps onto several rows fills the line by design; one that fits on a row must hug its buttons
        return Object.keys(rows).length > 1 ? 0 : Math.round(g.getBoundingClientRect().width - Math.max(...Object.values(rows))); }).filter(x => x > 4)"""
    for h, tab in [("#collections", "templates"), ("#collections", "settings"), ("#collection-new", None)]:
        s.go(h)
        if tab:
            p.click(f'#app button[data-act="dcTab"][data-v="{tab}"]')
        assert p.evaluate(slack) == [], (h, tab)
    s.go("#collections")
    p.click('#app button[data-act="dcTab"][data-v="templates"]')
    ws = p.evaluate("[...document.querySelectorAll('#app .dc-tlist .ti')].map(b => Math.round(b.getBoundingClientRect().width))")
    assert len(set(ws)) == 1, ws
    no_errors(s)
