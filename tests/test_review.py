"""Review layer tests: notes, arranging, sync, security and rendering of every route.

Run from partner-preview/:  python -m pytest tests -q
Live-sync tests use the `test` space only (TEST_CODE from the codes file outside the repo; never printed).
"""
import json
import re
import time
import urllib.error
import urllib.request
import uuid

import pytest
from playwright.sync_api import expect

from conftest import ENDPOINT, RUN, MockSync, identity_script, store_script

ROUTES = ["today", "tasks", "signoff", "lodge", "needs", "done", "clients", "rules", "observe", "import", "try", "people",
          "account", "feedback", "collections", "task-J11", "task-J01", "task-J07", "task-J21", "client-C1", "entity-E1",
          "collection-x1", "portal-x1", "idea-nothere1"]


def named(tag):
    return f"{tag} {RUN}{uuid.uuid4().hex[:3]}"


def open_pin(s, key, wait=True):
    blk = s.block(key)
    blk.hover()
    blk.locator(":scope > .rv-pin").click()
    if wait:
        s.page.wait_for_selector("#rv-drawer:not([hidden])")


def write_note(s, change, better="", kind="change", prio="medium"):
    p = s.page
    p.wait_for_selector('#rv-drawer form[data-rv-form=note], #rv-drawer [data-rv="compose"]')
    if p.locator("#rv-drawer form[data-rv-form=note]").count() == 0:
        p.click('#rv-drawer [data-rv="compose"]')  # the section already has notes (synced from other reviewers)
    p.check(f'#rv-drawer input[name=rvtype][value="{kind}"]')
    p.fill("#rv-change", change)
    if better:
        p.fill("#rv-better", better)
    p.check(f'#rv-drawer input[name=rvprio][value="{prio}"]')
    p.click("#rv-drawer form[data-rv-form=note] button[type=submit]")
    expect(p.locator("#rv-drawer .rv-note").filter(has_text=change[:20]).first).to_be_visible()


def note_on(s, key, change, **kw):
    open_pin(s, key)
    write_note(s, change, **kw)
    s.page.click('#rv-drawer [data-rv="dwclose"]')


def arrange(s):
    s.page.click('.rv-bar [data-rv="arrange"]')
    s.page.wait_for_selector(".rv-abar:not([hidden])")


def select_block(s, key):
    b = s.block(key)
    b.click(position={"x": 30, "y": 30})
    expect(b).to_have_class(re.compile(r"\brv-sel\b"))


def drag(page, src, dst, where=0.8, fx=0.5):
    sb, db = src.bounding_box(), dst.bounding_box()
    x0, y0 = sb["x"] + sb["width"] / 2, sb["y"] + min(24, sb["height"] / 2)
    page.mouse.move(x0, y0)
    page.mouse.down()
    page.mouse.move(x0 + 8, y0 + 10, steps=4)
    tx, ty = db["x"] + db["width"] * fx, db["y"] + db["height"] * where
    page.mouse.move(tx, ty, steps=20)
    page.wait_for_timeout(250)
    page.mouse.move(tx, ty + 3, steps=3)
    page.wait_for_timeout(150)
    page.mouse.up()
    page.wait_for_timeout(250)


def no_errors(s):
    assert not s.errors, "\n".join(s.errors[:10])
    assert not s.dialogs, s.dialogs


# ---------------------------------------------------------------- rendering

@pytest.mark.parametrize("width,scheme", [(1280, "light"), (1280, "dark"), (390, "light"), (390, "dark")])
def test_every_route_renders(session, width, scheme):
    s = session(width=width, scheme=scheme, init=identity_script(named("Routes"))).sign_in()
    for r in ROUTES:
        s.go("#" + r)
        assert s.page.locator("#app h1").count() >= 1, r
        assert s.page.locator(".rv-bar:not([hidden])").count() == 1, r
        if width <= 400:
            sw = s.page.evaluate("document.documentElement.scrollWidth")
            assert sw <= width, f"horizontal scroll on #{r}: {sw}px"
    # Arrange mode on a busy page must not error either.
    s.go("#today")
    arrange(s)
    s.go("#task-J11")
    s.go("#client-C1")
    s.page.click('.rv-abar [data-rv="done"]')
    no_errors(s)
    assert s.page.evaluate("document.documentElement.getAttribute('data-theme')") in (None, "light", "dark")


@pytest.mark.parametrize("width", [1280, 390])
def test_layer_does_not_shift_the_page(session, width):
    """With no layout saved, the review layer adds pins only: every block keeps its exact position and size."""
    s = session(width=width, init=identity_script(named("Geo"))).sign_in()
    geo = """() => Array.from(document.querySelectorAll('#app *')).filter(e => !e.closest('[data-rv-ui]')).slice(0, 400)
               .map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.top + scrollY), Math.round(r.left), Math.round(r.width), Math.round(r.height)].join(','); }).join(';')"""
    for r in ["today", "tasks", "task-J11", "client-C1", "rules", "account"]:
        s.go("#" + r)
        with_layer = s.page.evaluate(geo)
        s.page.evaluate("window.__rvA = afterRender; window.__rvH = afterHeader; window.afterRender = function(){}; window.afterHeader = function(){}; "
                        "document.querySelectorAll('[data-rv-ui]').forEach(e => e.remove()); render();")
        without = s.page.evaluate(geo)
        s.page.evaluate("window.afterRender = window.__rvA; window.afterHeader = window.__rvH; render();")
        assert with_layer == without, f"layout shifted on #{r} at {width}px"
    no_errors(s)


# ---------------------------------------------------------------- notes

def test_note_survives_reload_and_updates_badge(session):
    s = session().sign_in()
    open_pin(s, "deadlines-at-risk-this-week", wait=False)
    # First use asks for the name once, prefilled from the demo sign-in.
    expect(s.page.locator("#rv-name")).to_have_value("Johan")
    name = named("Johan")
    s.page.fill("#rv-name", name)
    s.page.click("#dlg-ok")
    s.page.wait_for_selector("#rv-drawer:not([hidden])")
    expect(s.page.locator("#rv-drawer")).to_contain_text("Don’t include real client details")
    write_note(s, "Put the client name first", better="Sort by days left", kind="better", prio="high")
    pin = s.block("deadlines-at-risk-this-week").locator(":scope > .rv-pin")
    expect(pin).to_contain_text("1 note")
    s.page.reload()
    s.page.wait_for_selector(".rv-bar:not([hidden])")
    pin = s.block("deadlines-at-risk-this-week").locator(":scope > .rv-pin")
    expect(pin).to_contain_text("1 note")
    expect(pin).to_contain_text(name.split()[0][0])
    open_pin(s, "deadlines-at-risk-this-week")
    note = s.page.locator("#rv-drawer .rv-note").first
    expect(note).to_contain_text("Put the client name first")
    expect(note).to_contain_text("Sort by days left")
    expect(note).to_contain_text("Do it better")
    expect(note).to_contain_text("High")
    # Asked only once.
    s.page.click('#rv-drawer [data-rv="compose"]')
    assert s.page.locator("#dlg[open]").count() == 0
    no_errors(s)


def test_pin_anywhere_lands_on_a_button(session):
    s = session(init=identity_script(named("Pinner"))).sign_in()
    s.page.click('.rv-bar [data-rv="pick"]')
    target = s.page.locator('#app .seg button[data-act="mine"][data-v="1"]')
    target.click()
    expect(s.page.locator("#rv-drawer .rv-anchorline")).to_contain_text("button “Mine”")
    write_note(s, "This filter should remember my choice")
    s.page.click('#rv-drawer [data-rv="dwclose"]')
    target = s.page.locator('#app .seg button[data-act="mine"][data-v="1"]')
    expect(target).to_have_attribute("data-rv-n", "1")
    # The click did not reach the app (the filter stayed on Everyone).
    expect(s.page.locator('#app .seg button[data-act="mine"][data-v="0"]')).to_have_attribute("aria-pressed", "true")
    s.page.reload()
    s.page.wait_for_selector(".rv-bar:not([hidden])")
    expect(s.page.locator('#app .seg button[data-act="mine"][data-v="1"]')).to_have_attribute("data-rv-n", "1")
    # A pin on a menu tab belongs to the header and survives tab reordering.
    s.page.click('.rv-bar [data-rv="pick"]')
    s.page.click('#hdr nav.nav a[href="#rules"]')
    expect(s.page.locator("#rv-drawer .rv-anchorline")).to_contain_text("Rules")
    write_note(s, "Rules deserves a better name")
    s.page.click('#rv-drawer [data-rv="dwclose"]')
    expect(s.page.locator('#hdr nav.nav a[href="#rules"]')).to_have_attribute("data-rv-n", "1")
    expect(s.page.locator("#hdr .rv-navpin")).to_contain_text("1 note")
    no_errors(s)


def test_reply_and_status(session):
    name = named("Thread")
    s = session(init=identity_script(name)).sign_in()
    open_pin(s, "overnight")
    write_note(s, "Overnight should show amounts")
    note = s.page.locator("#rv-drawer .rv-note").first
    note.locator("textarea[name=rvreply]").fill("Agreed, with a total")
    note.locator("form[data-rv-form=reply] button[type=submit]").click()
    expect(s.page.locator("#rv-drawer .rv-replies")).to_contain_text("Agreed, with a total")
    s.page.locator("#rv-drawer select[data-rv-status]").first.select_option("planned")
    expect(s.page.locator("#rv-drawer .rv-strow").first).to_contain_text("Planned · set by " + name)
    s.page.reload()
    s.page.wait_for_selector(".rv-bar:not([hidden])")
    open_pin(s, "overnight")
    expect(s.page.locator("#rv-drawer .rv-replies")).to_contain_text("Agreed, with a total")
    expect(s.page.locator("#rv-drawer select[data-rv-status]").first).to_have_value("planned")
    no_errors(s)


def test_stored_html_renders_as_text(session):
    evil = '<img src=x onerror="window.__xss=1;alert(1)">'
    s = session(init=identity_script('<b onmouseover="window.__xss=3">Eve</b>')).sign_in()
    open_pin(s, "overnight")
    write_note(s, evil, better='<script>window.__xss=2</script>')
    t = s.page.locator("#rv-drawer .rv-note .rv-t").first
    assert t.text_content() == evil
    expect(s.page.locator("#rv-drawer .rv-note").first).to_contain_text('<b onmouseover="window.__xss=3">Eve</b>')
    s.page.click('#rv-drawer [data-rv="dwclose"]')
    s.go("#feedback")
    expect(s.page.locator("#app .rv-inrow").first).to_contain_text(evil)
    # An added block and a text edit with markup also stay text.
    s.go("#today")
    arrange(s)
    select_block(s, "pagehead")
    s.page.click('.rv-abar [data-rv="addsel"]')
    s.page.fill("#rv-btitle", '<img src=x onerror="window.__xss=4">')
    s.page.fill("#rv-bbody", '<svg onload="window.__xss=5">')
    s.page.click('#rv-drawer form[data-rv-form=addblock] button[type=submit]')
    expect(s.page.locator("#app .rv-added h2")).to_have_text('<img src=x onerror="window.__xss=4">')
    s.page.dblclick('#app [data-rv-b="overnight"] h2')
    s.page.keyboard.type('<i onclick="x">Night</i>')
    s.page.keyboard.press("Enter")
    expect(s.page.locator('#app [data-rv-b="overnight"] h2')).to_have_text('<i onclick="x">Night</i>')
    s.page.click('.rv-abar [data-rv="done"]')
    s.page.wait_for_timeout(300)
    assert s.page.evaluate("window.__xss") is None
    assert s.page.locator("img[src=x], #app svg[onload], #app i[onclick]").count() == 0
    no_errors(s)


# ---------------------------------------------------------------- arranging

def test_arrange_changes_survive_reload(session):
    s = session(init=identity_script(named("Arranger"))).sign_in()
    p = s.page
    assert p.evaluate("!!window.Sortable"), "SortableJS did not load from cdnjs"
    arrange(s)
    expect(p.locator(".rv-abar")).to_contain_text("Arranging Today. Changes are saved on this device only.")  # no review link in this test
    # Drag the Overnight card from the main column into the tray rail, below Going out soon.
    drag(p, s.block("overnight"), s.block("going"))
    expect(p.locator('#app .rail > [data-rv-b="overnight"]')).to_have_count(1)
    # Hide a block: it shows as a ghost bar while arranging.
    select_block(s, "deadlines-at-risk-this-week")
    p.click('.rv-abar [data-rv="hide"]')
    expect(s.block("deadlines-at-risk-this-week")).to_have_class(re.compile(r"\brv-hidden\b"))
    expect(s.block("deadlines-at-risk-this-week").locator(".rv-ghost")).to_contain_text("Hidden: Deadlines at risk this week")
    # Half width.
    select_block(s, "pagehead")
    p.click('.rv-abar [data-rv="size"]')
    expect(s.block("pagehead")).to_have_class(re.compile(r"\brv-half\b"))
    # Edit a heading as plain text.
    p.dblclick('#app [data-rv-b="tasks-board"] h2')
    assert p.evaluate("REVIEW.busy()") is True
    p.keyboard.type("AI work in progress")
    p.keyboard.press("Enter")
    expect(p.locator('#app [data-rv-b="tasks-board"] h2')).to_have_text("AI work in progress")
    # Add a Checklist block below the page heading.
    select_block(s, "pagehead")
    p.click('.rv-abar [data-rv="addsel"]')
    p.check('#rv-drawer input[name=rvbtype][value="checklist"]')
    p.fill("#rv-btitle", "Client onboarding steps")
    p.fill("#rv-bbody", "Engagement letter\nFICA documents\nSARS tax number")
    p.click('#rv-drawer form[data-rv-form=addblock] button[type=submit]')
    added = p.locator("#app .rv-added-checklist")
    expect(added.locator("h2")).to_have_text("Client onboarding steps")
    expect(added.locator("li")).to_have_count(3)
    assert p.evaluate("""() => { const a = document.querySelector('#app .rv-added-checklist'); const h = document.querySelector('#app [data-rv-b="pagehead"]');
                        return h.nextElementSibling === a; }""")
    p.click('.rv-abar [data-rv="done"]')
    p.reload()
    p.wait_for_selector(".rv-bar:not([hidden])")
    expect(p.locator('#app .rail > [data-rv-b="overnight"]')).to_have_count(1)
    expect(s.block("deadlines-at-risk-this-week")).to_be_hidden()
    expect(s.block("pagehead")).to_have_class(re.compile(r"\brv-half\b"))
    expect(p.locator('#app [data-rv-b="tasks-board"] h2')).to_have_text("AI work in progress")
    expect(p.locator("#app .rv-added-checklist h2")).to_have_text("Client onboarding steps")
    # The Review notes page describes the changes in words.
    s.go("#feedback")
    summary = p.locator('#app section[aria-label="Changes summary"]')
    expect(summary).to_contain_text("moved ‘Overnight’ into “Tray rail”")
    expect(summary).to_contain_text("hid ‘Deadlines at risk this week’")
    expect(summary).to_contain_text("made ‘Page heading’ half width")
    expect(summary).to_contain_text("renamed ‘What the AI is working on’ → ‘AI work in progress’")
    expect(summary).to_contain_text("added a Checklist block ‘Client onboarding steps’")
    no_errors(s)


def test_board_columns_reorder_and_reset_page_with_undo(session):
    s = session(init=identity_script(named("Resetter")), height=2800).sign_in()
    p = s.page
    arrange(s)
    order = "() => Array.from(document.querySelectorAll('#app .board > [data-rv-b]')).map(e => e.getAttribute('data-rv-b')).join(',')"
    before = p.evaluate(order)
    drag(p, s.block("done-this-week"), s.block("on-you"), where=0.3, fx=0.12)
    after = p.evaluate(order)
    assert after != before and after.split(",")[0] == "done-this-week", after
    select_block(s, "overnight")
    p.click('.rv-abar [data-rv="hide"]')
    expect(s.block("overnight")).to_have_class(re.compile(r"\brv-hidden\b"))
    p.click('.rv-abar [data-rv="resetpage"]')
    p.click("#dlg-ok")
    expect(s.block("overnight")).not_to_have_class(re.compile(r"\brv-hidden\b"))
    assert p.evaluate(order) == before
    p.click('.rv-abar [data-rv="undo"]')
    expect(s.block("overnight")).to_have_class(re.compile(r"\brv-hidden\b"))
    assert p.evaluate(order) == after
    no_errors(s)


def test_render_is_deferred_during_a_drag(session):
    s = session(init=identity_script(named("Dragger"))).sign_in()
    p = s.page
    arrange(s)
    p.evaluate("document.querySelector('#app').firstElementChild.setAttribute('data-marker', '1')")
    src = s.block("overnight").bounding_box()
    x, y = src["x"] + src["width"] / 2, src["y"] + 24
    p.mouse.move(x, y)
    p.mouse.down()
    p.mouse.move(x + 10, y + 15, steps=4)
    p.mouse.move(x + 10, y + 60, steps=6)
    assert p.evaluate("RV.dragging") is True
    p.evaluate("render()")  # what tick() does when a hold fires
    assert p.evaluate("REVIEW.pending") is True
    assert p.locator("#app [data-marker]").count() == 1, "render ran during the drag"
    p.mouse.up()
    p.wait_for_function("document.querySelector('#app [data-marker]') === null")
    assert p.evaluate("REVIEW.pending") is False
    no_errors(s)


def test_nav_tabs_and_suggested_page_survive_reload(session):
    s = session(init=identity_script(named("Navver"))).sign_in()
    p = s.page
    arrange(s)
    p.click('.rv-abar [data-rv="tabs"]')
    p.wait_for_selector("#rv-drawer [data-rv-tabs]")
    for _ in range(3):
        p.click('#rv-drawer [data-rv="tabup"][data-href="#feedback"]')
    p.uncheck('#rv-drawer input[data-rv-tabshow="#import"]')
    p.fill('#rv-drawer input[data-rv-tabname="#try"]', "Playground")
    p.press('#rv-drawer input[data-rv-tabname="#try"]', "Tab")
    p.fill("#rv-ptitle", "Client onboarding")
    p.fill("#rv-pabout", "Everything a new client needs in week one")
    p.click('#rv-drawer form[data-rv-form=page] button[type=submit]')
    p.wait_for_function("location.hash.indexOf('#idea-') === 0")
    expect(p.locator("#app h1")).to_have_text("Client onboarding")
    expect(p.locator(".rv-abar")).to_be_visible()
    select_block(s, "pagehead")
    p.click('.rv-abar [data-rv="addsel"]')
    p.check('#rv-drawer input[name=rvbtype][value="text"]')
    p.fill("#rv-btitle", "Welcome pack")
    p.fill("#rv-bbody", "Letter, FICA list, portal link")
    p.click('#rv-drawer form[data-rv-form=addblock] button[type=submit]')
    expect(p.locator("#app .rv-added h2")).to_have_text("Welcome pack")
    p.click('.rv-abar [data-rv="done"]')
    idea = p.evaluate("location.hash")
    p.reload()
    p.wait_for_selector(".rv-bar:not([hidden])")
    tabs = p.evaluate("Array.from(document.querySelectorAll('#hdr nav.nav > a')).filter(a => getComputedStyle(a).display !== 'none').map(a => a.getAttribute('href'))")
    assert "#import" not in tabs
    assert tabs.index("#feedback") < tabs.index("#people"), tabs
    assert idea in tabs
    expect(p.locator('#hdr nav.nav a[href="#try"]')).to_contain_text("Playground")
    expect(p.locator(f'#hdr nav.nav a[href="{idea}"]')).to_have_text("Client onboarding")
    expect(p.locator("#app .rv-added h2")).to_have_text("Welcome pack")
    expect(p.locator("#app .rv-idea-empty")).to_be_hidden()
    no_errors(s)


def test_reset_demo_data_keeps_notes_and_layout(session):
    s = session(init=identity_script(named("Keeper"))).sign_in()
    p = s.page
    note_on(s, "overnight", "Keep me after a reset")
    arrange(s)
    select_block(s, "status")
    p.click('.rv-abar [data-rv="hide"]')
    p.click('.rv-abar [data-rv="done"]')
    s.go("#account")
    p.click('#app [data-act="reset"]')
    p.click("#dlg-ok")
    s.go("#today")
    expect(s.block("overnight").locator(":scope > .rv-pin")).to_contain_text("1 note")
    expect(s.block("status")).to_be_hidden()
    no_errors(s)


def test_up_down_work_without_sortable(session):
    s = session(init=identity_script(named("NoDrag")), block_sortable=True).sign_in()
    p = s.page
    assert p.evaluate("!window.Sortable")
    arrange(s)
    expect(p.locator(".rv-abar")).to_contain_text("use Up and Down")
    keys = "() => Array.from(document.querySelectorAll('#app .today > .stack > [data-rv-b]')).map(e => e.getAttribute('data-rv-b'))"
    before = p.evaluate(keys)
    i = before.index("overnight")
    select_block(s, "overnight")
    p.click('.rv-abar [data-rv="up"]')
    after = p.evaluate(keys)
    assert after.index("overnight") == i - 1, after
    expect(s.block("overnight")).to_have_class(re.compile(r"\brv-sel\b"))
    p.click('.rv-abar [data-rv="down"]')
    p.click('.rv-abar [data-rv="down"]')
    assert p.evaluate(keys).index("overnight") == i + 1
    p.click('.rv-abar [data-rv="done"]')
    p.reload()
    p.wait_for_selector(".rv-bar:not([hidden])")
    assert p.evaluate(keys).index("overnight") == i + 1
    no_errors(s)


# ---------------------------------------------------------------- live sync (test space only)

def chip(s):
    return s.page.locator(".rv-bar .rv-chip")


def post(body):
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def test_two_reviewers_see_each_other_and_cannot_overwrite(session, test_code):
    na, nb = named("Partner A"), named("Partner B")
    a = session(init=identity_script(na, test_code)).sign_in()
    b = session(init=identity_script(nb, test_code)).sign_in("roelof.demo@example.test")
    expect(chip(a)).to_contain_text("Synced", timeout=30000)
    expect(chip(b)).to_contain_text("Synced", timeout=30000)
    text = "Sync check " + RUN + uuid.uuid4().hex[:4]
    note_on(a, "overnight", text)
    arrange(a)
    select_block(a, "status")
    a.page.click('.rv-abar [data-rv="hide"]')
    a.page.click('.rv-abar [data-rv="done"]')
    expect(chip(a)).to_contain_text("Synced", timeout=30000)
    assert a.page.evaluate("SYNC.status().dirty") == 0
    # B gets both within one poll (every 20 s), without forcing a sync.
    t0 = time.time()
    b.page.wait_for_function("t => SYNC.list('note').some(n => n.data.change === t)", arg=text, timeout=30000)
    assert time.time() - t0 < 26
    open_pin(b, "overnight")
    theirs = b.page.locator("#rv-drawer .rv-note").filter(has_text=text)
    expect(theirs).to_contain_text(na)
    expect(theirs.locator('[data-rv="editnote"], [data-rv="delnote"]')).to_have_count(0)
    b.page.click('#rv-drawer [data-rv="dwclose"]')
    b.page.wait_for_function("n => Array.from(document.querySelectorAll('.rv-bar select[data-rv-view] option')).some(o => o.textContent === n + '’s')", arg=na, timeout=30000)
    b.page.select_option(".rv-bar select[data-rv-view]", label=na + "’s")
    expect(b.block("status")).to_be_hidden()
    expect(b.page.locator(".rv-bar .rv-viewing")).to_contain_text(na + "’s layout")
    b.page.click('.rv-bar [data-rv="copymine"]')
    expect(b.page.locator(".rv-bar .rv-viewing")).to_have_count(0)
    expect(b.block("status")).to_be_hidden()
    # B cannot overwrite A's note: the client refuses, and so does the server.
    nid = a.page.evaluate("t => SYNC.list('note').find(n => n.data.change === t).id", text)
    assert b.page.evaluate("id => SYNC.put({ id, kind: 'note', route: 'today', data: { change: 'hijack' } })", nid) is None
    me_b = json.loads(b.page.evaluate("localStorage.getItem('operon-preview-review-v1-me')"))
    status, body = post({"code": test_code, "reviewer": {"id": me_b["id"], "secret": me_b["secret"], "name": nb},
                         "items": [{"id": nid, "kind": "note", "route": "today", "data": {"change": "hijack"}}]})
    assert status == 200 and {"id": nid, "reason": "not_owner"} in body.get("rejected", [])
    b.page.evaluate("SYNC.now()")
    assert b.page.evaluate("id => SYNC.get(id).data.change", nid) == text
    b.errors = [e for e in b.errors if "belongs to another reviewer" not in e]  # the refusal above is expected
    no_errors(a)
    no_errors(b)


def test_offline_change_is_kept_and_syncs_when_back(session, test_code):
    a = session(init=identity_script(named("Offline A"), test_code)).sign_in()
    expect(chip(a)).to_contain_text("Synced", timeout=30000)
    a.ctx.route(ENDPOINT, lambda r: r.abort())
    text = "Written offline " + RUN + uuid.uuid4().hex[:4]
    note_on(a, "status", text)
    expect(chip(a)).to_contain_text("Offline: saved here, will sync", timeout=20000)
    a.page.reload()
    a.page.wait_for_selector(".rv-bar:not([hidden])")
    expect(a.block("status").locator(":scope > .rv-pin")).not_to_have_class(re.compile(r"\brv-empty\b"))
    assert a.page.evaluate("SYNC.status().dirty") >= 1
    a.ctx.unroute(ENDPOINT)
    a.page.evaluate("window.dispatchEvent(new Event('online'))")
    expect(chip(a)).to_contain_text("Synced", timeout=30000)
    assert a.page.evaluate("SYNC.status().dirty") == 0
    b = session(init=identity_script(named("Offline B"), test_code)).sign_in()
    b.page.wait_for_function("t => SYNC.list('note').some(n => n.data.change === t)", arg=text, timeout=30000)
    no_errors(b)


def test_review_link_code_is_stored_stripped_and_copyable(session, browser, site, test_code):
    s = session(init=identity_script(named("Linker")), query="?review=" + test_code)
    assert s.page.evaluate("location.search") == ""
    assert s.page.evaluate("location.hash") == "#today"
    assert s.page.evaluate("c => localStorage.getItem('operon-preview-review-v1-code') === c", test_code)
    s.sign_in()
    expect(chip(s)).to_contain_text("Synced", timeout=30000)
    s.ctx.grant_permissions(["clipboard-read", "clipboard-write"])
    s.page.click('.rv-bar [data-rv="menu"]')
    s.page.click('.rv-menu [data-rv="copylink"]')
    s.page.wait_for_timeout(300)
    assert s.page.evaluate("async c => (await navigator.clipboard.readText()) === location.origin + location.pathname + '?review=' + encodeURIComponent(c)", test_code)
    no_errors(s)
    # A bad code says so and keeps notes local.
    bad = session(init=identity_script(named("Bad")), query="?review=" + "nope" * 5 + RUN).sign_in()
    expect(chip(bad)).to_contain_text("Review link not valid", timeout=30000)
    note_on(bad, "overnight", "Kept locally")
    assert bad.page.evaluate("SYNC.status().state") == "badcode"
    # No code: works locally, and the code can be entered by hand.
    none = session(init=identity_script(named("NoCode"))).sign_in()
    expect(chip(none)).to_contain_text("Not syncing: open the review link Aidan sent")
    chip(none).click()
    none.page.fill("#rv-code", "https://ajtradezs.github.io/operon-partner-preview/?review=" + test_code)
    none.page.click("#dlg-ok")
    expect(chip(none)).to_contain_text("Synced", timeout=30000)
    no_errors(none)


# ---------------------------------------------------------------- local features

LEGACY = """try { if (!localStorage.getItem('operon-partner-preview-v1-feedback')) localStorage.setItem('operon-partner-preview-v1-feedback',
  JSON.stringify([{ id: 'fb1abc', category: 'Idea', text: 'Legacy idea from the old preview', page: 'Today (#today)', at: '2026-10-20T10:00:00.000Z', uid: 'this-browser' }])); } catch (e) {}"""


def test_legacy_feedback_is_migrated_once(session):
    s = session(init=[identity_script(named("Legacy")), LEGACY]).sign_in()
    s.go("#feedback")
    expect(s.page.locator("#app")).to_contain_text("Legacy idea from the old preview")
    s.page.reload()
    s.page.wait_for_selector(".rv-bar:not([hidden])")
    assert s.page.evaluate("SYNC.list('feedback').filter(f => f.data.text === 'Legacy idea from the old preview').length") == 1
    assert s.page.evaluate("localStorage.getItem('operon-partner-preview-v1-feedback') !== null")
    no_errors(s)


def test_banner_feedback_joins_the_store(session):
    s = session(init=identity_script(named("Banner"))).sign_in()
    s.page.click("#fb-open")
    s.page.fill("#fb-text", "The banner feedback still works")
    s.page.click("#dlg-ok")
    s.page.wait_for_function("SYNC.list('feedback').some(f => f.data.text === 'The banner feedback still works')")
    assert s.page.evaluate("S.fb.some(f => f.text === 'The banner feedback still works')")
    s.go("#feedback")
    expect(s.page.locator("#app .rv-infb")).to_contain_text("The banner feedback still works")
    no_errors(s)


def test_inbox_filters_jump_and_exports(session):
    s = session(init=identity_script(named("Inbox"))).sign_in()
    p = s.page
    note_on(s, "overnight", "Overnight needs totals", kind="missing")
    s.go("#task-J11")
    note_on(s, "where-it-stands", "Say who fixes it", kind="bug", prio="high")
    s.go("#feedback")
    expect(p.locator("#app .rv-ingroup")).to_have_count(2)
    p.select_option("#rv-in-type", "bug")
    expect(p.locator("#app button.rv-inrow")).to_have_count(1)
    expect(p.locator("#app button.rv-inrow")).to_contain_text("Say who fixes it")
    expect(p.locator("#app button.rv-inrow")).to_contain_text("#task-J11")
    with p.expect_download() as d:
        p.click('#app [data-rv="export"][data-fmt="md"]')
    md = open(d.value.path(), encoding="utf-8").read()
    assert "Overnight needs totals" in md and "## Task page" in md
    with p.expect_download() as d:
        p.click('#app [data-rv="export"][data-fmt="csv"]')
    assert "Say who fixes it" in open(d.value.path(), encoding="utf-8-sig").read()
    with p.expect_download() as d:
        p.click('#app [data-rv="export"][data-fmt="json"]')
    data = json.load(open(d.value.path(), encoding="utf-8"))
    assert len(data["notes"]) == 2
    p.click("#app button.rv-inrow")
    p.wait_for_function("location.hash === '#task-J11'")
    expect(p.locator("#rv-drawer .rv-note.rv-focus")).to_contain_text("Say who fixes it")
    expect(s.block("where-it-stands")).to_have_class(re.compile(r"\brv-flash\b"))
    no_errors(s)


def test_works_when_storage_is_blocked(session):
    block = "Storage.prototype.setItem = function () { throw new DOMException('blocked', 'SecurityError'); };"
    s = session(init=block)
    s.sign_in()
    open_pin(s, "overnight", wait=False)
    s.page.fill("#rv-name", "Blocked Browser")
    s.page.click("#dlg-ok")
    write_note(s, "Still works without storage")
    expect(s.block("overnight").locator(":scope > .rv-pin")).to_contain_text("1 note")
    arrange(s)
    select_block(s, "status")
    s.page.click('.rv-abar [data-rv="hide"]')
    expect(s.block("status")).to_have_class(re.compile(r"\brv-hidden\b"))
    no_errors(s)


@pytest.mark.parametrize("width,scheme", [(1280, "light"), (1280, "dark"), (390, "light"), (390, "dark")])
def test_screenshots(session, shots, width, scheme):
    s = session(width=width, scheme=scheme, init=identity_script(named("Shots"))).sign_in()
    p = s.page
    p.click('.rv-tip [data-rv="tipok"]')
    note_on(s, "overnight", "Show the amounts next to each overnight count", better="Link each number to the list", kind="better", prio="high")
    note_on(s, "deadlines-at-risk-this-week", "Group these by client", kind="change")
    arrange(s)
    select_block(s, "deadlines-at-risk-this-week")
    p.wait_for_timeout(300)
    p.screenshot(path=str(shots / f"today-arrange-{width}-{scheme}.png"))
    p.click('.rv-abar [data-rv="done"]')
    p.evaluate("window.scrollTo(0, 0)")
    open_pin(s, "overnight")
    p.wait_for_timeout(300)
    p.screenshot(path=str(shots / f"notes-drawer-{width}-{scheme}.png"))
    p.click('#rv-drawer [data-rv="dwclose"]')
    s.go("#feedback")
    p.wait_for_timeout(300)
    p.screenshot(path=str(shots / f"review-notes-{width}-{scheme}.png"))
    if width <= 400:
        assert p.evaluate("document.documentElement.scrollWidth") <= width
    no_errors(s)


def test_sign_out_hides_the_review_tools_and_keeps_notes(session):
    s = session(init=identity_script(named("Leaver"))).sign_in()
    p = s.page
    note_on(s, "overnight", "Still here after signing out")
    s.page.click('.rv-bar [data-rv="pick"]')
    s.page.click("#fb-open")  # pin-anywhere also works on the preview banner
    write_note(s, "The banner could be shorter")
    s.page.click('#rv-drawer [data-rv="dwclose"]')
    expect(p.locator("#fb-open")).to_have_attribute("data-rv-n", "1")
    s.go("#account")
    p.click('#app [data-act="signOut"]')
    p.wait_for_selector("#si-email")
    expect(p.locator(".rv-bar")).to_be_hidden()
    expect(p.locator("#rv-drawer")).to_be_hidden()
    expect(p.locator("#fb-open")).not_to_have_attribute("data-rv-n", "1")
    s.sign_in()
    expect(s.block("overnight").locator(":scope > .rv-pin")).to_contain_text("1 note")
    expect(p.locator("#fb-open")).to_have_attribute("data-rv-n", "1")
    no_errors(s)


# ---------------------------------------------------------------- review findings (security, sync, ux): mocked backend or seeded store

MOCK_A, MOCK_B = "MOCK-CODE-AAAA-0001", "MOCK-CODE-BBBB-0002"


def sign_in_page(p, email="johan.demo@example.test"):
    p.fill("#si-email", email)
    p.click("form[data-form=email] button[type=submit]")
    p.fill("#si-code", "123456")
    p.click("form[data-form=code] button[type=submit]")
    p.wait_for_selector(".rv-bar:not([hidden])")


def toasts(s):
    return s.page.locator("#toasts")


def drop_expected(s, *parts):
    s.errors = [e for e in s.errors if not any(x in e for x in parts)]


def test_ids_that_name_me_are_ignored_when_another_reviewer_wrote_them(session):
    """SEC-1: a layout, menu or status row whose id names A but that B wrote is never shown as A's, and A is told when a write is refused."""
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    forged = [
        {"id": f"layout:{a}:today", "kind": "layout", "route": "today", "reviewer": b,
         "data": {"hidden": ["status"], "added": [{"id": "a_forged0001", "type": "text", "title": "Forged by B", "body": "", "zone": "", "after": ""}]}},
        {"id": f"layout:{a}:_nav", "kind": "layout", "route": "_nav", "reviewer": b, "data": {"hidden": ["#rules"]}},
        {"id": "n_mine0000001", "kind": "note", "route": "today", "reviewer": a, "data": {"block": "overnight", "label": "Overnight", "change": "My own note", "type": "change"}},
        {"id": f"st:n_mine0000001:{a}", "kind": "status", "route": "today", "reviewer": b, "data": {"note": "n_mine0000001", "status": "done"}},
    ]
    s = session(init=[identity_script("Alice Owner", rid=a), store_script(forged, [{"id": b, "name": "Bee", "last_seen": ""}])]).sign_in()
    p = s.page
    expect(s.block("status")).to_be_visible()
    expect(p.locator("#app .rv-added")).to_have_count(0)
    expect(p.locator('#hdr nav.nav a[href="#rules"]')).to_be_visible()
    assert p.evaluate("rvStatusOf('n_mine0000001').status") == "open"
    assert p.evaluate("RV.viewOwner === SYNC.me().id")
    s.go("#feedback")
    expect(p.locator('#app section[aria-label="Changes summary"]')).not_to_contain_text("Forged by B")
    expect(p.locator('#app section[aria-label="Changes summary"]')).not_to_contain_text("hid ‘Status")
    # The status write is refused (the row belongs to B): no "Status set" toast, a message instead.
    s.go("#today")
    open_pin(s, "overnight")
    p.locator("#rv-drawer select[data-rv-status]").first.select_option("planned")
    expect(toasts(s)).to_contain_text("couldn’t be saved")
    expect(toasts(s)).not_to_contain_text("Status set to")
    drop_expected(s, "belongs to another reviewer")
    no_errors(s)


def test_synced_keys_named_like_object_builtins_do_not_break_the_layer(session):
    """SEC-2: notes whose block or label is 'constructor' or '__proto__' render like any other note."""
    b = str(uuid.uuid4())
    seeded = [
        {"id": "n_proto000001", "kind": "note", "route": "today", "reviewer": b, "data": {"block": "constructor", "label": "__proto__", "change": "proto block one", "type": "change"}},
        {"id": "n_proto000002", "kind": "note", "route": "today", "reviewer": b, "data": {"block": "__proto__", "label": "constructor", "change": "proto block two", "type": "change"}},
        {"id": "n_proto000003", "kind": "note", "route": "today", "reviewer": b, "data": {"block": "overnight", "label": "prototype", "change": "proto block three", "type": "change"}},
    ]
    s = session(init=[identity_script(named("Proto")), store_script(seeded, [{"id": b, "name": "Bee", "last_seen": ""}])]).sign_in()
    p = s.page
    assert p.locator("#app .rv-pin").count() > 10
    expect(s.block("overnight").locator(":scope > .rv-pin")).to_contain_text("1 note")
    p.click('.rv-bar [data-rv="pagenotes"]')
    expect(p.locator("#rv-drawer")).to_contain_text("proto block one")
    expect(p.locator("#rv-drawer")).to_contain_text("proto block two")
    p.click('#rv-drawer [data-rv="dwclose"]')
    arrange(s)
    assert p.locator("#app .rv-handle").count() > 5
    p.click('.rv-abar [data-rv="done"]')
    s.go("#feedback")
    with p.expect_download() as d:
        p.click('#app [data-rv="export"][data-fmt="md"]')
    md = open(d.value.path(), encoding="utf-8").read()
    assert "proto block one" in md and "proto block two" in md and "proto block three" in md
    no_errors(s)


def test_deleting_a_note_scrubs_its_text_locally_and_in_the_push(session):
    """SEC-3: a delete sends data {} and the local copy keeps no text."""
    mock = MockSync()
    s = session(init=identity_script(named("Scrub"), MOCK_A), mock=mock).sign_in()
    p = s.page
    expect(chip(s)).to_contain_text("Synced", timeout=15000)
    secret = "Client Mrs X ID 8001015009087 owes R12,000"
    note_on(s, "overnight", secret)
    p.wait_for_function("SYNC.status().dirty === 0 && SYNC.status().state === 'synced'", timeout=15000)
    nid = p.evaluate("t => SYNC.list('note').find(n => n.data.change === t).id", secret)
    open_pin(s, "overnight")
    p.click(f'#rv-drawer [data-rv="delnote"][data-id="{nid}"]')
    p.click("#dlg-ok")
    stored = json.loads(p.evaluate("localStorage.getItem('operon-preview-review-v1')"))["items"][nid]
    assert stored["deleted"] is True and stored["data"] == {}, stored
    p.wait_for_function("SYNC.status().dirty === 0 && SYNC.status().state === 'synced'", timeout=15000)
    pushed = [it for r in mock.requests for it in (r.get("items") or []) if it["id"] == nid and it.get("deleted")]
    assert pushed and all(it["data"] == {} for it in pushed), pushed
    assert secret not in p.evaluate("localStorage.getItem('operon-preview-review-v1')")
    no_errors(s)


QUOTA = """(() => { const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'operon-preview-review-v1' && String(v).length > LIMIT) throw new DOMException('full', 'QuotaExceededError');
    return set.call(this, k, v); }; })();"""


def test_unsynced_notes_survive_a_full_storage_quota(session):
    """SEC-4: when other reviewers' rows fill the browser's storage, my unsynced note is still kept across a reload."""
    b = str(uuid.uuid4())
    bulk = [{"id": f"n_bulk{i:07d}", "kind": "note", "route": "clients", "reviewer": b, "data": {"block": "x", "label": "Bulk", "change": "y" * 6000}} for i in range(80)]
    s = session(init=[identity_script(named("Quota"), MOCK_A), store_script(bulk, [{"id": b, "name": "Bee", "last_seen": ""}]), QUOTA.replace("LIMIT", "300000")],
                mock=MockSync()).sign_in()
    p = s.page
    s.ctx.route(ENDPOINT, lambda r: r.abort())
    note_on(s, "overnight", "Written while storage is full")
    expect(chip(s)).to_contain_text("Offline", timeout=20000)
    assert p.evaluate("SYNC.status().storageOk") is True
    p.reload()
    p.wait_for_selector(".rv-bar:not([hidden])")
    assert p.evaluate("SYNC.list('note').some(n => n.data.change === 'Written while storage is full')")
    no_errors(s)


def test_failed_local_save_and_server_rejections_are_shown(session):
    """SEC-4: if this browser cannot save at all, the chip says so instead of "saved here"; quota rejections are shown."""
    blocked = "(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'operon-preview-review-v1') throw new DOMException('full', 'QuotaExceededError'); return set.call(this, k, v); }; })();"
    mock = MockSync()
    mock.fail = "abort"
    s = session(init=[identity_script(named("NoSave"), MOCK_A), blocked], mock=mock).sign_in()
    note_on(s, "overnight", "Cannot be stored")
    expect(chip(s)).to_contain_text("not saved", timeout=20000)
    expect(chip(s)).not_to_contain_text("saved here")
    mock2 = MockSync()
    mock2.reject = {"*": "quota"}
    t = session(init=identity_script(named("Rejected"), MOCK_A), mock=mock2).sign_in()
    expect(chip(t)).to_contain_text("Synced", timeout=15000)
    note_on(t, "overnight", "Over the limit")
    expect(toasts(t)).to_contain_text("storage limit", timeout=15000)
    expect(chip(t)).to_contain_text("not synced", timeout=5000)
    open_pin(t, "overnight")
    expect(t.page.locator("#rv-drawer .rv-note").first).to_contain_text("storage limit reached")
    no_errors(t)


def test_switching_review_code_does_not_carry_the_old_space_across(session):
    """F1: after a new review code, the old space's rows are neither shown nor re-uploaded into the new space."""
    mock = MockSync({MOCK_A: "a", MOCK_B: "b"})
    x = str(uuid.uuid4())
    mock.reviewers[x] = {"secret": "0" * 64, "space": "a", "name": "Xavier", "last_seen": mock.now()}
    mock.seed("a", {"id": "n_spaceAnote01", "kind": "note", "route": "today", "reviewer": x, "data": {"block": "overnight", "label": "Overnight", "change": "SPACE-A note by someone else", "type": "change"}})
    s = session(init=identity_script(named("Switcher"), MOCK_A), mock=mock).sign_in()
    p = s.page
    expect(chip(s)).to_contain_text("Synced", timeout=15000)
    p.wait_for_function("SYNC.list('note').length === 1")
    arrange(s)
    select_block(s, "pagehead")
    p.click('.rv-abar [data-rv="hide"]')
    p.click('.rv-abar [data-rv="done"]')
    open_pin(s, "overnight")
    p.locator("#rv-drawer select[data-rv-status]").first.select_option("planned")
    p.click('#rv-drawer [data-rv="dwclose"]')
    p.wait_for_function("SYNC.status().dirty === 0 && SYNC.status().state === 'synced'", timeout=15000)
    assert any(i.startswith("layout:") for i in mock.space_rows("a"))
    p.evaluate("c => SYNC.setCode(c)", MOCK_B)
    p.wait_for_function("SYNC.status().state === 'synced' && SYNC.status().dirty === 0", timeout=15000)
    p.wait_for_timeout(300)
    rows_b = mock.space_rows("b")
    assert not [i for i in rows_b if i.startswith(("layout:", "st:"))], list(rows_b)
    assert p.evaluate("SYNC.list('note').length") == 0
    assert "Xavier" not in p.evaluate("Object.values(SYNC.reviewers()).map(r => r.name).join(',')")
    expect(s.block("pagehead")).to_be_visible()
    no_errors(s)


def test_two_tabs_do_not_overwrite_each_others_notes(session, site):
    """F2: two tabs of the same browser each save a note; both survive, and each tab sees the other's note."""
    s = session(init=identity_script(named("Tabs")))
    a = s.page
    b = s.ctx.new_page()
    b.goto(site + "#today")
    a.evaluate("SYNC.put({ id: 'n_tabA0000001', kind: 'note', route: 'today', data: { block: 'overnight', change: 'note from tab A' } })")
    b.wait_for_function("!!SYNC.get('n_tabA0000001')", timeout=5000)
    b.evaluate("SYNC.put({ id: 'n_tabB0000001', kind: 'note', route: 'today', data: { block: 'overnight', change: 'note from tab B' } })")
    a.close()
    b.close()
    c = s.ctx.new_page()
    c.goto(site + "#today")
    got = sorted(c.evaluate("SYNC.list('note').map(n => n.data.change)"))
    assert got == ["note from tab A", "note from tab B"], got


def test_same_reviewer_layout_changes_in_two_tabs_combine(session, site):
    """F3: a layout change in one tab is not erased by a later change in another tab."""
    s = session(init=identity_script(named("TwoTabs"))).sign_in()
    a = s.page
    b = s.ctx.new_page()
    b.goto(site + "#today")
    if b.locator("#si-email").count():
        sign_in_page(b)
    b.wait_for_selector(".rv-bar:not([hidden])")
    a.evaluate("rvToggle('hidden', 'overnight')")
    b.evaluate("rvToggle('hidden', 'status')")
    hid = "() => (SYNC.get('layout:' + SYNC.me().id + ':today') || { data: {} }).data.hidden"
    a.wait_for_function("() => { const l = SYNC.get('layout:' + SYNC.me().id + ':today'); return l && l.data.hidden.length === 2; }", timeout=5000)
    assert sorted(a.evaluate(hid)) == ["overnight", "status"]
    assert sorted(b.evaluate(hid)) == ["overnight", "status"]
    no_errors(s)


def test_preview_renders_while_sortable_is_still_loading(session):
    """F4: a cdnjs request that hangs does not hold up the preview; arrange mode picks Sortable up once it arrives."""
    s = session(init=identity_script(named("SlowCdn")), hold_sortable=True, wait_until="commit")
    p = s.page
    p.wait_for_selector("#si-email", timeout=5000)
    s.sign_in()
    arrange(s)
    expect(p.locator(".rv-abar")).to_contain_text("use Up and Down")
    assert s.held, "the Sortable request was not made"
    for r in s.held:
        r.continue_()
    p.wait_for_function("!!window.Sortable", timeout=20000)
    p.wait_for_function("RV.sortables.length > 0", timeout=5000)
    expect(p.locator(".rv-abar")).not_to_contain_text("not available")
    no_errors(s)


def test_text_edit_open_during_back_navigation_saves_to_the_edited_page(session):
    """F5: a text edit committed after the route changed is stored for the page that was edited."""
    s = session(init=identity_script(named("Back"))).sign_in()
    p = s.page
    s.go("#clients")
    s.go("#today")
    arrange(s)
    p.dblclick('#app [data-rv-b="pagehead"] h1')
    p.keyboard.type("EDITED HEADING")
    p.evaluate("history.back()")
    p.wait_for_function("location.hash === '#clients'")
    p.keyboard.press("Enter")
    p.wait_for_timeout(200)
    texts = dict(p.evaluate("SYNC.list('layout').filter(l => l.reviewer === SYNC.me().id).map(l => [l.route, l.data.texts.map(t => t.text)])"))
    assert texts.get("today") == ["EDITED HEADING"], texts
    assert not texts.get("clients"), texts
    s.go("#today")
    expect(p.locator('#app [data-rv-b="pagehead"] h1')).to_have_text("EDITED HEADING")
    no_errors(s)


def test_server_errors_are_not_reported_as_offline(session):
    """F6: 5xx and 429 say there is a sync problem (and retry); 400 too_many_reviewers is final and explained."""
    mock = MockSync()
    mock.fail = (502, "sync_failed")
    s = session(init=identity_script(named("Errors"), MOCK_A), mock=mock).sign_in()
    expect(chip(s)).to_contain_text("Sync problem", timeout=15000)
    expect(chip(s)).not_to_contain_text("Offline")
    mock.fail = (429, "rate_limited")
    s.page.evaluate("SYNC.now()")
    expect(chip(s)).to_contain_text("busy", timeout=15000)
    mock.fail = None
    s.page.evaluate("SYNC.now()")
    expect(chip(s)).to_contain_text("Synced", timeout=15000)
    full = MockSync()
    full.fail = (400, "too_many_reviewers")
    t = session(init=identity_script(named("Full"), MOCK_A), mock=full).sign_in()
    expect(chip(t)).to_contain_text("Review is full", timeout=15000)
    n = len(full.requests)
    t.page.wait_for_timeout(4500)
    assert len(full.requests) == n, "retried a final error"
    chip(t).click()
    expect(t.page.locator("#dlg")).to_contain_text("maximum number of reviewers")
    no_errors(s)
    no_errors(t)


def test_tabs_drawer_does_not_stack_sortables(session):
    """F7: re-rendering with the Tabs & pages drawer open keeps one Sortable on its list."""
    s = session(init=identity_script(named("Stack"))).sign_in()
    p = s.page
    arrange(s)
    p.click('.rv-abar [data-rv="tabs"]')
    p.wait_for_selector("#rv-drawer [data-rv-tabs]")
    p.evaluate("""() => { const c = Sortable.create; window.__tabsCreates = 0;
        Sortable.create = function (el, o) { if (el.matches && el.matches('[data-rv-tabs]')) window.__tabsCreates++; return c.call(this, el, o); }; }""")
    for _ in range(10):
        p.evaluate("render()")
    assert p.evaluate("window.__tabsCreates") <= 1
    no_errors(s)


def test_markdown_export_neutralises_markup_from_reviewers(session):
    """SEC-6: names, labels, notes and replies cannot add HTML, links, images or fake entries to the Markdown export."""
    b = str(uuid.uuid4())
    seeded = [
        {"id": "n_mdevil00001", "kind": "note", "route": "today", "reviewer": b,
         "data": {"block": "overnight", "label": '<img src=x onerror="window.__xss=1"> # Label', "type": "change",
                  "change": "see ![t](https://evil.example/beacon.png) and <b>bold</b> [link](https://evil.example)", "better": "`code` | pipe _under_"}},
        {"id": "n_mdevil00002", "kind": "note", "route": "today", "reviewer": b, "data": {"parent": "n_mdevil00001", "block": "overnight", "text": "ok\n## Injected heading\n- **Aidan** (Change): fake"}},
    ]
    evil_name = "X** (Change, High, Done by Aidan): <i>forged</i>"
    s = session(init=[identity_script(named("Md")), store_script(seeded, [{"id": b, "name": evil_name, "last_seen": ""}])]).sign_in()
    p = s.page
    s.go("#feedback")
    with p.expect_download() as d:
        p.click('#app [data-rv="export"][data-fmt="md"]')
    md = open(d.value.path(), encoding="utf-8").read()
    assert "<" not in md and ">" not in md.replace("&gt;", ""), md
    assert "](" not in md.replace("\\](", ""), md
    assert not any(line.lstrip().startswith("## Injected") for line in md.splitlines()), md
    assert "- **X\\*\\* (Change" in md, md
    assert "see !\\[t\\]" in md
    no_errors(s)


CONTROLS = "a[href], button, input, select, textarea, label, summary, [role=tab], [tabindex]:not([tabindex=\"-1\"])"
PIN_HITS = """(sel) => {
  const touch = matchMedia('(hover: none)').matches; const pad = touch ? 6 : 0;
  const ctrls = Array.from(document.querySelectorAll(sel.split(',').map(x => '#app ' + x.trim()).join(','))).filter(c => !c.closest('[data-rv-ui]'))
    .map(c => [c, c.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && r.height > 0);
  const out = [];
  for (const p of document.querySelectorAll('#app .rv-pin')) {
    const r = p.getBoundingClientRect(); if (!r.width || getComputedStyle(p).display === 'none') continue;
    for (const [c, q] of ctrls) {
      if (c.contains(p)) continue;
      if (r.left - pad < q.right - 1 && r.right + pad > q.left + 1 && r.top - pad < q.bottom - 1 && r.bottom + pad > q.top + 1)
        out.push(p.getAttribute('data-k') + ' pin over ' + c.tagName + ' "' + (c.textContent || c.getAttribute('aria-label') || '').trim().slice(0, 30) + '"');
    }
  }
  return out;
}"""
TEXT_RECTS = """() => { const out = []; const w = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; if (!n.nodeValue.trim() || n.parentElement.closest('[data-rv-ui]')) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    for (const q of r.getClientRects()) if (q.width > 1 && q.height > 1) out.push({ l: q.left, r: q.right, t: q.top, b: q.bottom, s: n.nodeValue.trim().slice(0, 30) }); }
  return out; }"""


def _pin_text_hits(p, key):
    pin = p.locator(f'#app [data-rv-b="{key}"] > .rv-pin').bounding_box()
    hits = [t["s"] for t in p.evaluate(TEXT_RECTS)
            if pin["x"] < t["r"] - 1 and pin["x"] + pin["width"] > t["l"] + 1 and pin["y"] < t["b"] - 1 and pin["y"] + pin["height"] > t["t"] + 1]
    return hits


@pytest.mark.parametrize("width,touch", [(1280, False), (390, True)])
def test_pins_never_cover_controls(session, width, touch):
    """UX-1: no note pin (empty or not) sits over a button, link, tab or field, and a click on a control reaches it."""
    s = session(width=width, touch=touch, init=identity_script(named("Pins"))).sign_in()
    p = s.page
    found = []
    for r in ["today", "collections", "tasks", "task-J11", "client-C1", "clients", "feedback", "account"]:
        s.go("#" + r)
        p.wait_for_timeout(120)
        found += [r + ": " + x for x in p.evaluate(PIN_HITS, CONTROLS)]
    s.go("#collections")
    for v in ["templates", "settings", "board"]:
        p.evaluate("v => { const b = document.querySelector('#app button[data-act=dcTab][data-v=\"' + v + '\"]'); if (b) b.click(); }", v)
        p.wait_for_timeout(120)
        found += ["collections/" + v + ": " + x for x in p.evaluate(PIN_HITS, CONTROLS)]
    assert not found, "\n".join(found)
    tab = p.locator('#app [data-rv-b="coll-tabs"] button[data-v="settings"]')
    box = tab.bounding_box()
    for fx in (0.8, 0.9):
        assert p.evaluate("([x, y]) => !!document.elementFromPoint(x, y).closest('button[data-v=\"settings\"]')", [box["x"] + box["width"] * fx, box["y"] + box["height"] / 2])
    if not touch:
        p.mouse.click(box["x"] + box["width"] - 20, box["y"] + box["height"] / 2)
        expect(p.locator('#app button[data-act=dcTab][data-v="settings"]')).to_have_attribute("aria-pressed", "true")
        assert p.locator("#dlg[open]").count() == 0
    no_errors(s)


def test_board_pin_does_not_cover_the_hint_line(session):
    """UX-8 (pin part): the board's note pin, shown on hover, does not sit on the board's hint text."""
    s = session(init=identity_script(named("Hint"))).sign_in()
    p = s.page
    s.go("#collections")
    key = p.evaluate("() => { const h = Array.from(document.querySelectorAll('#app [data-rv-b]')).find(e => /^Collections board/.test((e.querySelector('h2') || {}).textContent || '') && e.querySelector(':scope > .rv-pin')); return h && h.getAttribute('data-rv-b'); }")
    assert key, "no board block"
    s.block(key).hover(position={"x": 40, "y": 40})
    p.wait_for_timeout(150)
    assert not _pin_text_hits(p, key), _pin_text_hits(p, key)
    no_errors(s)


TOUCH_GEO = """() => {
  const vis = (e) => { const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  const pins = Array.from(document.querySelectorAll('#app .rv-pin')).filter(vis).map(e => e.getBoundingClientRect()).filter(r => r.width);
  const handles = Array.from(document.querySelectorAll('#app .rv-handle')).filter(vis).map(e => e.getBoundingClientRect()).filter(r => r.width);
  const gap = (a, b) => Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
  let minGap = 1e9; for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) minGap = Math.min(minGap, gap(pins[i], pins[j]));
  const hits = []; const top = document.getElementById('top').getBoundingClientRect().bottom;
  for (const p of document.querySelectorAll('#app .rv-pin')) {
    const r = p.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (!r.width || cy < top + 20 || cy > innerHeight - 140 || r.left < 18 || r.right > innerWidth - 18) continue;
    for (const [dx, dy] of [[-15, 0], [15, 0], [0, -15], [0, 15]]) { const e = document.elementFromPoint(cx + dx, cy + dy); if (!e || !p.contains(e)) hits.push([p.getAttribute('data-k'), dx, dy, e && e.tagName]); }
  }
  return { pins: pins.length, minGap, hits, handles: handles.map(r => [r.left, r.top, r.width, r.height]) };
}"""


def test_touch_targets_are_large_and_apart(session):
    """UX-2: on a phone, pins have a 30px+ tap area, sit 12px+ apart, and the Move handle is 32px tall."""
    s = session(width=390, touch=True, init=identity_script(named("Thumb"))).sign_in()
    p = s.page
    p.wait_for_timeout(150)
    g = p.evaluate(TOUCH_GEO)
    assert g["pins"] > 5 and g["minGap"] >= 12, g
    assert not g["hits"], g["hits"]
    arrange(s)
    select_block(s, "overnight")
    g = p.evaluate(TOUCH_GEO)
    assert g["handles"] and all(h[3] >= 32 for h in g["handles"]), g["handles"]
    no_errors(s)


def test_touch_arrange_shows_one_handle_clear_of_text(session):
    """UX-3: on a phone in arrange mode, only the selected block shows its Move handle, and it covers no text."""
    s = session(width=390, touch=True, init=identity_script(named("Chips"))).sign_in()
    p = s.page
    arrange(s)
    for key in ["trays", "pagehead", "overnight"]:
        if not s.block(key).count():
            continue
        p.evaluate("k => rvSelect(k)", key)
        s.block(key).scroll_into_view_if_needed()
        p.wait_for_timeout(100)
        handles = p.evaluate(TOUCH_GEO)["handles"]
        assert len(handles) == 1, (key, handles)
        x, y, w, h = handles[0]
        cover = [t["s"] for t in p.evaluate(TEXT_RECTS) if x < t["r"] - 1 and x + w > t["l"] + 1 and y < t["b"] - 1 and y + h > t["t"] + 1]
        assert not cover, (key, cover)
    no_errors(s)


NAV_GEO = """() => { const nav = document.querySelector('#hdr nav.nav'); const n = nav.getBoundingClientRect();
  const tabs = Array.from(nav.querySelectorAll(':scope > a')).filter(a => getComputedStyle(a).display !== 'none').map(a => { const r = a.getBoundingClientRect(); return { h: a.getAttribute('href'), l: r.left, r: r.right, cur: a.getAttribute('aria-current') === 'page' }; });
  return { l: n.left, r: n.right, sw: nav.scrollWidth, cw: nav.clientWidth, vw: innerWidth, tabs }; }"""


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_nav_tabs_fit_at_1280_and_active_tab_shows_on_phone(session, shots, scheme):
    """UX-6: every tab fits unclipped at 1280; on a phone the nav scrolls and the active tab is scrolled into view."""
    s = session(width=1280, scheme=scheme, init=identity_script(named("Nav"))).sign_in()
    p = s.page
    for r in ["#feedback", "#collections", "#today"]:
        s.go(r)
        g = p.evaluate(NAV_GEO)
        assert g["sw"] <= g["cw"] + 1, g
        bad = [t["h"] for t in g["tabs"] if t["l"] < max(0, g["l"]) - 0.5 or t["r"] > min(g["vw"], g["r"]) + 0.5]
        assert not bad, (r, bad, g)
    s.go("#feedback")
    p.screenshot(path=str(shots / f"nav-1280-{scheme}.png"), clip={"x": 0, "y": 0, "width": 1280, "height": 140})
    m = session(width=390, scheme=scheme, init=identity_script(named("NavPhone"))).sign_in()
    q = m.page
    for r in ["#feedback", "#collections", "#account", "#today"]:
        m.go(r)
        q.wait_for_timeout(50)
        q.evaluate("render()")
        g = q.evaluate(NAV_GEO)
        cur = [t for t in g["tabs"] if t["cur"]]
        assert cur and cur[0]["l"] >= g["l"] - 0.5 and cur[0]["r"] <= g["r"] + 0.5, (r, cur, g["l"], g["r"])
    m.go("#feedback")
    q.screenshot(path=str(shots / f"nav-390-{scheme}.png"), clip={"x": 0, "y": 0, "width": 390, "height": 260})
    no_errors(s)
    no_errors(m)


def test_toasts_match_the_sync_state_and_the_device(session):
    """UX-9: without a review link the toasts say the note stays on this device; touch copy says tap, not click or Esc."""
    s = session(init=identity_script(named("Copy"))).sign_in()
    p = s.page
    expect(p.locator(".rv-tip")).not_to_contain_text("syncs to Aidan automatically")
    note_on(s, "overnight", "Where does this go")
    expect(toasts(s)).to_contain_text("on this device only")
    expect(toasts(s)).not_to_contain_text("automatically")
    arrange(s)
    expect(p.locator(".rv-abar")).not_to_contain_text("sync automatically")
    p.click('.rv-abar [data-rv="done"]')
    expect(toasts(s)).to_contain_text("on this device only")
    t = session(width=390, touch=True, init=identity_script(named("Tap"))).sign_in()
    q = t.page
    q.click('.rv-bar [data-rv="pick"]')
    expect(q.locator(".rv-bar .rv-pickmsg")).to_contain_text("tap anything")
    q.click('.rv-bar [data-rv="pickcancel"]')
    arrange(t)
    q.evaluate("rvSelect('pagehead')")
    q.click('.rv-abar [data-rv="edittext"]')
    expect(toasts(t)).to_contain_text("tap outside")
    expect(toasts(t)).not_to_contain_text("Esc")
    no_errors(s)
    no_errors(t)


def test_toasts_are_capped_and_stay_clear_while_arranging_on_phone(session):
    """UX-10: at most two toasts at once, never tappable, above the arrange bar and below the header; gone within 3.5 s."""
    s = session(width=390, touch=True, init=identity_script(named("Toasty"))).sign_in()
    p = s.page
    arrange(s)
    p.evaluate("rvSelect('overnight')")
    p.evaluate("toast('one'); toast('two'); toast('three'); toast('three')")
    g = p.evaluate("""() => { const ts = Array.from(document.querySelectorAll('#toasts .toast'));
        const ab = document.querySelector('.rv-abar').getBoundingClientRect(); const top = document.getElementById('top').getBoundingClientRect().bottom;
        return { n: ts.length, pe: ts.map(t => getComputedStyle(t).pointerEvents), clear: ts.every(t => { const r = t.getBoundingClientRect(); return r.bottom <= ab.top + 0.5 && r.top >= top - 0.5; }) }; }""")
    assert g["n"] <= 2 and all(x == "none" for x in g["pe"]) and g["clear"], g
    p.wait_for_timeout(3500)
    assert p.locator("#toasts .toast").count() == 0
    no_errors(s)


def test_tab_name_inputs_show_the_current_name(session):
    """UX-11: the Tabs & pages inputs hold the tab's name; saving it unchanged stores no rename; placeholder is readable in dark."""
    s = session(scheme="dark", init=identity_script(named("Names"))).sign_in()
    p = s.page
    arrange(s)
    p.click('.rv-abar [data-rv="tabs"]')
    inp = p.locator('#rv-drawer input[data-rv-tabname="#today"]')
    expect(inp).to_have_value("Today")
    inp.fill("Today")
    inp.press("Tab")
    names = "() => { const l = SYNC.get('layout:' + SYNC.me().id + ':_nav'); return l ? l.data.names : {}; }"
    assert p.evaluate(names) == {}
    inp = p.locator('#rv-drawer input[data-rv-tabname="#today"]')
    inp.fill("Home")
    inp.press("Tab")
    p.wait_for_function("() => { const l = SYNC.get('layout:' + SYNC.me().id + ':_nav'); return l && l.data.names['#today'] === 'Home'; }")
    inp = p.locator('#rv-drawer input[data-rv-tabname="#today"]')
    expect(inp).to_have_value("Home")
    inp.fill("Today")
    inp.press("Tab")
    p.wait_for_function("() => { const l = SYNC.get('layout:' + SYNC.me().id + ':_nav'); return l && !l.data.names['#today']; }")
    ratio = p.evaluate("""() => { const i = document.querySelector('#rv-drawer input[data-rv-tabname]');
        const lum = (c) => { const v = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        let bgEl = i, bg = getComputedStyle(bgEl).backgroundColor; while (/rgba\\(0, 0, 0, 0\\)|transparent/.test(bg) && bgEl.parentElement) { bgEl = bgEl.parentElement; bg = getComputedStyle(bgEl).backgroundColor; }
        const a = lum(getComputedStyle(i, '::placeholder').color), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }""")
    assert ratio >= 4.5, ratio
    no_errors(s)
