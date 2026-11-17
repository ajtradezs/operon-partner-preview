"""The forked shell boots, signs in with the simulated identities, attaches the review layer and switches firm-neutral roles."""
import pytest

ROLES = ["Tax Consultant", "Administrator", "Integration Administrator", "Information Officer", "Records/Compliance Owner"]


def test_boot_sign_in_and_review_bar(session):
    s = session().sign_in()
    p = s.page
    assert p.locator(".rv-bar").is_visible()
    assert p.locator("#role-sw").input_value() == "Tax Consultant"
    assert [o.inner_text() for o in p.locator("#role-sw option").all()] == ROLES
    assert p.locator("#top .banner").inner_text().find("Partner preview") >= 0
    nav = [a.get_attribute("href") for a in p.locator("#hdr nav.nav > a").all()]
    for h in ["#today", "#cases", "#approvals", "#exceptions", "#clients", "#papersync", "#sars", "#deadlines", "#controls",
              "#incidents", "#retention", "#audit", "#try", "#import", "#people", "#account", "#feedback"]:
        assert h in nav, h
    assert p.evaluate("document.documentElement.dataset.build").startswith("20")
    assert not s.errors, s.errors


def test_sign_in_as_another_role_and_switch(session):
    s = session()
    p = s.page
    p.fill("#si-email", "roelof.demo@example.test")
    p.select_option("#si-role", "Information Officer")
    p.click("form[data-form=email] button[type=submit]")
    p.fill("#si-code", "123456")
    p.click("form[data-form=code] button[type=submit]")
    p.wait_for_selector(".rv-bar:not([hidden])")
    assert p.locator("#role-sw").input_value() == "Information Officer"
    p.select_option("#role-sw", "Administrator")
    p.wait_for_function("S.role === 'Administrator'")
    assert p.evaluate("me().name") == "Lerato Khumalo"
    assert not s.errors, s.errors


def test_sign_in_and_step_up_text_match_what_the_code_accepts(session):
    # m4: the code check accepts any 6 digits, so no text may say "enter 123456" as if only that code works.
    s = session()
    p = s.page
    assert "Any email address works" in p.locator("form[data-form=email] .hint").inner_text()
    p.fill("#si-email", "someone.else@example.test")
    p.click("form[data-form=email] button[type=submit]")
    form = p.locator("form[data-form=code]").inner_text()
    assert "any 6 digits" in form and "enter 123456" not in form, form
    p.fill("#si-code", "654321")
    p.click("form[data-form=code] button[type=submit]")
    p.wait_for_selector(".rv-bar:not([hidden])")
    assert p.evaluate("S.signedIn") is True
    # The step-up dialog says the same and accepts any 6 digits.
    p.evaluate("() => { S.stepUpUntil = 0; window.__su = 0; stepUp('Test step-up.', () => { window.__su = 1; }); }")
    p.wait_for_selector("#dlg[open]")
    dlg = p.locator("#dlg").inner_text()
    assert "any 6 digits" in dlg and "enter 123456" not in dlg, dlg
    p.fill("#su-pw", "anything")
    p.fill("#su-code", "000111")
    p.click("#dlg-ok")
    p.wait_for_function("window.__su === 1")
    assert p.evaluate("S.stepUpUntil > Date.now()")
    assert not s.errors, s.errors


def test_people_page_locks_for_non_administrators(session):
    s = session().sign_in()
    s.go("#people")
    p = s.page
    assert p.locator("#app h1").inner_text() == "People & roles"
    assert p.locator("#app .locked").count() > 0  # Tax Consultant cannot invite or revoke
    p.select_option("#role-sw", "Administrator")
    p.wait_for_function("S.role === 'Administrator'")
    assert p.locator("#app form[data-form=invite] button[type=submit]").count() == 1
    assert not s.errors, s.errors


def test_unknown_route_falls_back_to_today_and_audit_is_append_only(session):
    s = session().sign_in()
    s.go("#nonsense")
    p = s.page
    assert p.evaluate("routeOf().name") == "today"
    ok = p.evaluate("""() => { const a = S.audit[S.audit.length - 1]; try { a.text = 'changed'; } catch (e) {} return a.text !== 'changed' && Object.isFrozen(a); }""")
    assert ok
    chain = p.evaluate("S.audit.every((a, i) => i === 0 || a.prev === S.audit[i - 1].hash)")
    assert chain
    assert not s.errors, s.errors


@pytest.mark.parametrize("width,scheme", [(390, "dark"), (1280, "light")])
def test_shell_renders_at_phone_and_desktop(session, width, scheme):
    s = session(width=width, scheme=scheme).sign_in()
    for h in ["#people", "#account", "#feedback", "#today"]:
        s.go(h)
    assert s.page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    assert not s.errors, s.errors
