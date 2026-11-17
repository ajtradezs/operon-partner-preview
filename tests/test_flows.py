"""End-to-end flows driven through the screens the way a person would: the sign-in form, the role switcher in the header, the
main navigation, buttons, forms and dialogs on the staff screens, and the PaperSync portal for everything the client does.

ENGINE is used directly only to read and check state. Where a step has no screen at all, the flow does not hide it: it calls
`Flow.bridge(defect, ...)`, which records the defect (with its repro) and performs that one missing step through ENGINE so the
rest of the flow can still be checked on the screens. A flow that needed a bridge, or that found a screen misbehaving
(`Flow.defect`), ends with pytest.xfail naming every defect. Any other failed check is a real failure, not an xfail.

Every flow ends by checking that ENGINE.verifyChain() is ok and that the page logged no errors.

Run against a private build: python -I tools/build.py --out <dir>/index.html, then OPERON_PREVIEW_DIR=<dir>."""
import re

import pytest

TZ = "Africa/Johannesburg"
IA, TC, AD = "Integration Administrator", "Tax Consultant", "Administrator"

# Every step of the seven flows now has a screen: opening a case (client page), ticking gate checklist items and recording the
# values read from each document (case page), the simulated SARS sending the ITA34 (SARS link), choosing the remedy (case page) and
# the simulated platform team's part (exception buttons). Flow.bridge stays for any step a future change leaves without a screen.

HIDE_REVIEW_UI = ".rv-bar,.rv-tip,[data-rv-ui]{display:none!important}"


class Flow:
    """One signed-in person at one browser: screen helpers, read-only state checks and the defect log."""

    def __init__(self, browser, site, width=1280):
        self.site = site
        self.ctx = browser.new_context(timezone_id=TZ, viewport={"width": width, "height": 900}, accept_downloads=True)
        self.page = self.ctx.new_page()
        self.errors, self.defects = [], []
        self.page.on("pageerror", lambda e: self.errors.append("pageerror: %s" % e))
        self.page.on("console", self._console)
        self.page.on("dialog", lambda d: (self.errors.append("native dialog: " + d.message), d.dismiss()))
        self.page.goto(site + "#today")
        self.page.wait_for_function("typeof ENGINE !== 'undefined' && typeof DEMO !== 'undefined' && !!S && S.cases.length > 0")
        # The review layer's bar and first-visit tip float over the page; they are not part of the workflow screens.
        self.page.add_style_tag(content=HIDE_REVIEW_UI)

    def _console(self, m):
        if m.type == "error" and "Failed to load resource" not in m.text and "net::ERR_FAILED" not in m.text:
            self.errors.append("console error: " + m.text)

    # ---------- reading state (ENGINE and S are only read) ----------
    def js(self, expr, arg=None):
        return self.page.evaluate(expr, arg)

    def case(self, case_id, expr):
        """Evaluate expr with c = the case, cl = its client (read only)."""
        return self.js("([id, body]) => { const c = ENGINE.caseById(id); const cl = ENGINE.clientOf(c); return (new Function('c', 'cl', 'return (' + body + ');'))(c, cl); }", [case_id, expr])

    def audit_n(self):
        return self.js("S.audit.length")

    def audit_since(self, n):
        return self.js("n => S.audit.slice(n).map((a) => ({ who: a.who, role: a.role, text: a.text, result: a.result, reason: a.reason || '', caseId: a.caseId || null, gate: a.gate || null, code: a.code || null }))", n)

    # ---------- screens ----------
    def sign_in(self, role, email="johan.demo@example.test"):
        p = self.page
        p.fill("#si-email", email)
        p.select_option("#si-role", role)
        p.click("form[data-form=email] button[type=submit]")
        p.fill("#si-code", "123456")
        p.click("form[data-form=code] button[type=submit]")
        p.wait_for_selector("#role-sw")
        assert self.js("S.role") == role
        return self

    def as_role(self, role):
        """Switch role with the header's role switcher."""
        self.clear_toasts()
        self.page.select_option("#role-sw", role)
        assert self.toast().startswith("Now viewing as " + role), self.toast()
        assert self.js("S.role") == role

    def nav(self, route):
        """Follow a link in the header's main navigation."""
        self.page.click(f"#hdr nav a[href='#{route}']")
        self.page.wait_for_function("r => (location.hash || '#today') === '#' + r", arg=route)
        self.page.wait_for_selector("#app .pagehead")

    def follow(self, href):
        """Follow a link that is on the current screen (the first one with this href)."""
        self.page.locator(f"#app a[href='{href}']").first.click()
        self.page.wait_for_function("h => location.hash === h", arg=href)
        self.page.wait_for_selector("#app .pagehead")

    def open_link(self, href):
        """Open a deep link (a case, client or portal page) as a person following a link from elsewhere would."""
        self.page.evaluate("""h => new Promise((resolve) => {
            if (location.hash === h) { render(); return resolve(); }
            addEventListener('hashchange', () => setTimeout(resolve, 0), { once: true });
            location.hash = h;
        })""", href)
        self.page.wait_for_selector("#app .pagehead")

    def clear_toasts(self):
        self.js("document.getElementById('toasts').innerHTML = ''")

    def toast(self, timeout=5000):
        self.page.wait_for_selector("#toasts .toast", timeout=timeout)
        return self.js("Array.from(document.querySelectorAll('#toasts .toast')).map((t) => t.textContent).pop()")

    def click(self, selector):
        self.clear_toasts()
        loc = self.page.locator(selector)
        assert loc.count() >= 1, "Nothing on the screen matches " + selector
        loc.first.click()

    def act(self, selector, ok=True):
        """Click a button that acts straight away and return the toast. ok=True: it must not be a refusal."""
        self.click(selector)
        t = self.toast()
        if ok:
            assert not t.startswith("Not done"), t
        return t

    def dialog(self, fill=None, check=None, radio=None, ok=True, select=None):
        """Fill the open dialog and press its submit button. Returns the toast (ok) or the error shown in the dialog (not ok)."""
        p = self.page
        p.wait_for_selector("#dlg[open] #dlg-ok")
        for sel, val in (select or {}).items():
            p.select_option(sel, val)
        for sel, val in (fill or {}).items():
            p.fill(sel, val)
        for sel in (check or []):
            p.check(sel)
        if radio:
            p.check(f"#dlg input[type=radio][value='{radio}']")
        self.clear_toasts()
        p.click("#dlg-ok")
        if not ok:
            p.wait_for_function("() => document.getElementById('dlg-err') && document.getElementById('dlg-err').textContent.trim() !== ''")
            return p.text_content("#dlg-err")
        p.wait_for_function("!document.getElementById('dlg').open")
        t = self.toast()
        assert not t.startswith("Not done"), t
        return t

    def release(self, case_id, gate, where="[data-rv-key='cases-case-gates']"):
        """Release a gate with its Release button (case page by default) and the confirm dialog."""
        self.click(f"{where} button[data-act='vk.release'][data-case='{case_id}'][data-gate='{gate}']")
        t = self.dialog(fill={"#vk-rel-ev": "Checked on the screen"})
        assert t == f"Released {gate} for {case_id}.", t
        assert self.case(case_id, f"c.gates.{gate}.status") == "released"

    def tick(self, case_id, gate):
        """Tick every open checklist item of a gate with its 'Mark done' button on the case page (the gate owner's action)."""
        keys = self.case(case_id, f"(c.req.{gate} || []).filter((r) => !r.done).map((r) => r.key)")
        for k in keys:
            t = self.act(f"[data-rv-key='cases-case-checklist'] button[data-act='cases.req'][data-case='{case_id}'][data-gate='{gate}'][data-key='{k}']")
            assert t.startswith("Done: "), t
        assert self.case(case_id, f"(c.req.{gate} || []).every((r) => r.done)")
        return keys

    def portal(self, case_id):
        """Open the client's PaperSync portal from the firm's PaperSync page and pass the one-time code."""
        self.nav("papersync")
        self.follow(f"#portal-{case_id}")
        self.page.wait_for_selector("#ps-v-code, [data-rv-key='ps-portal-steps']")
        if self.page.locator("#ps-v-code").count():  # once per portal per browser tab
            self.page.fill("#ps-v-code", "123456")
            self.click("form[data-form='ps.verify'] button[type=submit]")
            assert self.toast().startswith("Portal opened for")
        self.page.wait_for_selector("[data-rv-key='ps-portal-steps']")

    def text(self, selector):
        return self.page.locator(selector).first.inner_text()

    # ---------- defects ----------
    def bridge(self, defect, expr, arg=None):
        """A step with no screen: record the defect, then do that one step through ENGINE so the rest of the flow stays testable."""
        if defect not in self.defects:
            self.defects.append(defect)
        r = self.js(expr, arg)
        assert r is None or not isinstance(r, dict) or r.get("ok", True) is not False, r
        return r

    def defect(self, text):
        if text not in self.defects:
            self.defects.append(text)

    def finish(self):
        chain = self.js("ENGINE.verifyChain()")
        assert chain["ok"], chain
        assert self.errors == [], self.errors
        self.ctx.close()
        if self.defects:
            pytest.xfail(" | ".join(self.defects))


@pytest.fixture
def flow(browser, site):
    made = []

    def make(**kw):
        f = Flow(browser, site, **kw)
        made.append(f)
        return f

    yield make
    for f in made:
        try:
            f.ctx.close()
        except Exception:
            pass


def demo(f, key):
    return f.js("k => DEMO.keys[k]", key)


def bad_check_id(dob, serial):
    """An SA-ID-shaped number whose check digit is deliberately wrong, so it is never a real ID (as the seed does)."""
    body = dob[2:4] + dob[5:7] + dob[8:10] + str(serial).zfill(4) + "08"
    total = 0
    for i, ch in enumerate(reversed(body)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return body + str(((10 - total % 10) % 10 + 5) % 10)


# ====================================================================================================== (1) the happy path
def test_new_client_from_import_to_closed_and_retained(flow):
    f = flow().sign_in(AD)
    p = f.page

    # Import clients: paste a filled-in template, check it field by field, create the client.
    idno = bad_check_id("1990-04-21", 4417)
    csv = ("Surname,First name,RSA ID number,Income tax reference number,Email address,Cell or mobile number,"
           "Street number and street or farm name,City or town,Bank,Account number,Provisional taxpayer\n"
           f"Nxumalo,Bheki,{idno},4711230986,bheki.nxumalo@example.test,082 555 0101,12 Acacia Road,Durban,Demo Bank,62001234567,Yes\n")
    f.nav("import")
    p.fill("#adm-imp-text", csv)
    f.click("button[data-act='adm.impCheck']")
    summary = f.text("[data-rv-key='adm-import-check'] .adm-sum")
    assert "1 row checked" in summary and "1 ready, 0 with errors" in summary, summary
    n0 = f.audit_n()
    f.click("button[data-act='adm.impCreate']")
    assert f.dialog() == "Added 1 client to the client master."
    cl = f.js("S.clients[S.clients.length - 1]")
    assert cl["name"] == "Bheki Nxumalo" and cl["idNo"] == idno and cl["provisional"] is True
    assert all(k["ok"] is False for k in cl["kyc"])
    assert any("Added client " + cl["id"] in a["text"] and a["who"] == "AD1" for a in f.audit_since(n0))
    f.follow(f"#client-{cl['id']}")
    assert "No ITR12 case yet" in f.text("[data-rv-key='adm-client-cases']")

    # Opening the 2026 case on the client page: the Administrator chooses the Tax Consultant and opens it.
    n1 = f.audit_n()
    f.click(f"[data-rv-key='adm-client-cases'] button[data-act='adm.newCase'][data-client='{cl['id']}']")
    t = f.dialog(select={"#adm-nc-tc": "TC1"})
    case = f.js("id => S.cases.filter((c) => c.clientId === id).map((c) => c.id).pop()", cl["id"])
    assert case and t == f"Opened {case}, the 2026 ITR12 case for Bheki Nxumalo.", t
    assert f.case(case, "[c.year, c.consultant, ENGINE.currentGate(c)]") == [2026, "TC1", "G01"]
    assert any(f"Opened the 2026 ITR12 case {case}" in a["text"] for a in f.audit_since(n1))
    assert case in f.text("[data-rv-key='adm-client-cases']")
    assert f.page.locator(f"button[data-act='adm.newCase'][data-client='{cl['id']}']").count() == 0  # one case per tax year

    # Onboarding: the Administrator marks each KYC document received on the client page, then releases G01.
    for key in f.js("id => ENGINE.clientOf(id).kyc.map((k) => k.key)", cl["id"]):
        t = f.act(f"[data-rv-key='adm-client-kyc'] button[data-act='adm.kyc'][data-key='{key}'][data-ok='1']")
        assert t.startswith("Marked as received:"), t
    assert f.js("id => ENGINE.clientOf(id).kyc.every((k) => k.ok)", cl["id"])
    f.release(case, "G01", where="[data-rv-key='adm-client-kyc']")
    assert f.case(case, "c.gates.G01.by") == ["AD1"]

    # G02: the Tax Consultant ticks the comparison with the SARS registered details on the case page, then releases G02.
    f.as_role(TC)
    f.open_link(f"#case-{case}")
    if not f.case(case, "c.req.G02.every((r) => r.done)"):
        assert "SARS registered details compared" in f.case(case, "ENGINE.canRelease(c, 'G02', ACTOR.me()).why")
        f.tick(case, "G02")
    f.release(case, "G02")

    # G03 and G04 in the client's PaperSync portal: the questionnaire, then the documents (one picked file, one sample file).
    f.portal(case)
    required = f.case(case, "c.questionnaire.required")
    for key in required:
        p.check(f"#ps-q-{key}-{1 if key in ('employment', 'medical') else 0}")
    assert f.case(case, "Object.keys(c.questionnaire.answers).length") == len(required)
    assert f.act("button[data-act='ps.submitQ']") == "Questionnaire submitted. Your checklist is updated."
    assert f.case(case, "c.gates.G03.status + '|' + c.gates.G03.byType + '|' + c.gates.G03.via") == "released|client|portal"
    items = f.case(case, "Object.fromEntries(c.items.map((it) => [it.kind, it.id]))")
    assert set(items) == {"irp5", "medical"}
    with p.expect_file_chooser() as fc:
        f.click(f"button[data-act='ps.pick'][data-item='{items['irp5']}']")
    f.clear_toasts()
    fc.value.set_files(files=[{"name": "IRP5_2026.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4 demo " * 18000}])
    assert f.toast().startswith("Uploaded IRP5_2026.pdf: accepted")
    t = f.act(f"button[data-act='ps.sample'][data-item='{items['medical']}']")
    assert t.startswith("Uploaded Medical_scheme_certificate_2026.pdf: accepted"), t
    assert f.act("button[data-act='ps.submitDocs']") == "Sent. Your accountant has been told everything is in."
    # G04 is the AI's gate: with both documents validated and nothing blocking, it passes by itself.
    assert f.case(case, "[c.gates.G04.status, c.gates.G04.byType]") == ["released", "ai"]

    # G05: the Tax Consultant records the values read from each checked document on the case page, then recalculates.
    f.open_link(f"#case-{case}")
    assert "no values have been extracted" in f.text("[data-rv-key='cases-case-calc']")
    assert p.locator("[data-rv-key='cases-case-calc'] button[data-act='cases.recalc']").count() == 0
    docs = f.case(case, "Object.fromEntries(c.docs.filter((d) => d.status === 'validated').map((d) => [d.kind, d.id]))")
    f.click(f"[data-rv-key='cases-case-documents'] button[data-act='cases.values'][data-case='{case}'][data-doc='{docs['irp5']}']")
    t = f.dialog(select={"#cs-v-f0": "remuneration", "#cs-v-f1": "paye"},
                 fill={"#cs-v-r0": "IRP5 code 3601: income", "#cs-v-a0": "455000", "#cs-v-r1": "IRP5 code 4102: PAYE", "#cs-v-a1": "84 300"})
    assert t == "Recorded 2 values from the IRP5 employee tax certificate. Recalculate to use them.", t
    f.click(f"[data-rv-key='cases-case-documents'] button[data-act='cases.values'][data-case='{case}'][data-doc='{docs['medical']}']")
    t = f.dialog(select={"#cs-v-f0": "medicalFees"}, fill={"#cs-v-r0": "Medical scheme certificate: contributions", "#cs-v-a0": "31200", "#cs-v-months": "12", "#cs-v-deps": "0"})
    assert t == "Recorded 1 value from the Medical scheme tax certificate. Recalculate to use them.", t
    lines = f.case(case, "c.inputs.lines.map((l) => [l.id, l.field, l.amount, l.docId === c.docs.find((d) => d.kind === (l.field === 'medicalFees' ? 'medical' : 'irp5')).id])")
    assert lines == [["L1", "remuneration", 455000, True], ["L2", "paye", 84300, True], ["L3", "medicalFees", 31200, True]], lines
    assert f.case(case, "c.inputs.medical") == {"months": 12, "dependants": 0}
    assert any(a["result"] == "Recorded" and a["who"] == "TC1" for a in f.audit_since(n1))
    assert "IRP5 code 3601: income" in f.text("[data-rv-key='cases-case-documents']")
    f.click(f"[data-rv-key='cases-case-calc'] button[data-act='cases.recalc'][data-case='{case}']")
    assert f.dialog(fill={"#cs-rc-why": "First calculation"}) == f"Recalculated {case}: version 1."
    calc = f.case(case, "({ v: ENGINE.vN(c), ruleset: c.calc.ruleset, errors: c.calc.errors.length, pending: c.calc.pending.length, recon: c.recon.ok, ti: c.calc.summary.taxableIncome })")
    assert calc["v"] == 1 and calc["ruleset"] == "2026.1" and calc["errors"] == calc["pending"] == 0 and calc["recon"] is True and calc["ti"] > 0, calc
    f.release(case, "G05")

    # G06: the client approves version 1 with the declaration in the portal.
    f.portal(case)
    p.check("#ps-decl")
    f.click("form[data-form='ps.approve'] button[type=submit]")
    assert f.toast().startswith("Approved version 1.")
    # Freeze and final checks: G07 is Operon's own freeze, G08 the AI's final reconciliation.
    st = f.case(case, "({ g06: c.gates.G06.byType, g07: [c.gates.G07.status, c.gates.G07.byType], g08: [c.gates.G08.status, c.gates.G08.byType], frozen: c.frozen && c.frozen.version, gate: ENGINE.currentGate(c) })")
    assert st == {"g06": "client", "g07": ["released", "system"], "g08": ["released", "ai"], "frozen": 1, "gate": "G09"}, st
    f.open_link(f"#case-{case}")
    assert "Frozen" in f.text("[data-rv-key='cases-case-summary']")
    f.release(case, "G09")
    tx = f.case(case, "c.subTx")
    assert f.js("id => ENGINE.txById(id).status", tx) == "awaiting G18"

    # G18 on the SARS link: two different people sign, each through the header's role switcher.
    f.as_role(IA)
    f.nav("sars")
    f.click(f"[data-rv-key='ops-sars-txs'] button[data-act='vk.release'][data-tx='{tx}']")
    assert f.dialog() == f"Signed G18 for {tx}."
    assert "You signed. The Tax Consultant signs next." in f.text("[data-rv-key='ops-sars-txs'] tbody")
    f.as_role(TC)
    f.click(f"[data-rv-key='ops-sars-txs'] button[data-act='vk.release'][data-tx='{tx}']")
    assert f.dialog() == f"Signed G18 for {tx}."
    t18 = f.js("id => { const t = ENGINE.txById(id); return { status: t.status, by: t.signoffs.map((s) => s.id) }; }", tx)
    assert t18 == {"status": "ready", "by": ["IA1", "TC1"]}, t18
    assert f.case(case, "c.gates.G18.status") == "released"

    # The simulated submission: the Integration Administrator sends; the simulated SARS accepts.
    f.as_role(IA)
    f.click(f"button[data-act='ops.tx.send'][data-tx='{tx}']")
    assert f.dialog(radio="success").startswith(f"Sent {tx}: sars accepts it")
    sub = f.case(case, "({ ok: c.submission.ok, ref: c.submission.ref, from: c.retention.from, until: c.retention.until, col: ENGINE.columnOf(c) })")
    assert sub["ok"] and sub["ref"].startswith("SARS-") and sub["from"] and sub["until"] and sub["col"] == "after-filing", sub

    # The simulated SARS sends the ITA34 on the SARS link (it plays SARS's part, with the firm's approved figures).
    assert f.js("id => S.inbound.filter((it) => it.caseId === id).length", case) == 0
    f.open_link("#sars")
    assert "Simulate SARS sending an ITA34" in f.text("[data-rv-key='ops-sars-inbound']")
    f.click("[data-rv-key='ops-sars-inbound'] button[data-act='ops.in.ita34']")
    t = f.dialog(select={"#ops-ita-case": case}, radio="same")
    ita = f.case(case, "({ ref: c.ita34.ref, date: c.ita34.date, by: S.audit.filter((a) => a.caseId === c.id && a.sarsRef === c.ita34.ref).map((a) => a.who) })")
    assert t == f"SARS (simulated) sent ITA34 {ita['ref']} for {case}: it agrees with the approved calculation.", t
    assert ita["date"] == f.js("ENGINE.isoDay(now())") and "SARS (simulated)" in ita["by"], ita
    assert f.js("id => S.inbound.filter((it) => it.caseId === id && it.fn === 'ita34').length", case) == 1
    assert ita["ref"] in f.text("[data-rv-key='ops-sars-inbound']")
    # G12 is the AI's comparison with the approved calculation: it agrees, so the gate passes by itself.
    assert f.case(case, "[c.ita34.recon.ok, c.gates.G12.status, c.gates.G12.byType]") == [True, "released", "ai"]
    f.as_role(TC)
    f.open_link(f"#case-{case}")
    assert "Agrees with the approved calculation" in f.text("[data-rv-key='cases-case-ita34']")
    # G13: the Tax Consultant ticks the G13 checklist on the case page, then releases it.
    todo = f.case(case, "c.req.G13.filter((r) => !r.done).map((r) => r.label)")
    assert todo and "Not ready: " + todo[0] in f.case(case, "ENGINE.canRelease(c, 'G13', ACTOR.me()).why")
    f.tick(case, "G13")
    f.release(case, "G13")

    # G14: the client accepts the assessment in the portal.
    f.portal(case)
    assert f.act(f"button[data-act='ps.decide'][data-case='{case}'][data-choice='accept']") == "You accepted the assessment."
    assert f.case(case, "[c.decision.choice, c.gates.G14.byType, ENGINE.applies(c, 'G15'), ENGINE.currentGate(c)]") == ["accept", "client", False, "G16"]

    # Closed and retained: the card sits in the last column; the case page shows the retention dates.
    f.nav("cases")
    col = f.js("id => { const e = document.querySelector(`.cb-card[data-case='${id}']`); return e && e.closest('.cb-list').dataset.col; }", case)
    assert col == "closed"
    f.open_link(f"#case-{case}")
    ret = f.text("[data-rv-key='cases-case-retention']")
    want = f.case(case, "[fDate(VK.toDay(c.retention.from)), fDate(VK.toDay(c.retention.until))]")
    assert want[0] in ret and want[1] in ret, (want, ret)
    assert "Closed & retained" in f.text("[data-rv-key='cases-case-summary']")
    # Who did what: each gate by the right kind of actor.
    by = f.case(case, "Object.fromEntries(ENGINE.seq(c).filter((g) => c.gates[g].status === 'released').map((g) => [g, c.gates[g].byType]))")
    assert by == {"G01": "human", "G02": "human", "G03": "client", "G04": "ai", "G05": "human", "G06": "client", "G07": "system",
                  "G08": "ai", "G09": "human", "G18": "human", "G12": "ai", "G13": "human", "G14": "client"}, by
    f.finish()


# ====================================================================================================== (2) a refused drag
def drag_card(f, case_id, to_col):
    """Drag a card on the Cases board with the mouse (Sortable). Returns False when the drag library did not load."""
    p = f.page
    try:
        p.wait_for_function("!!window.Sortable", timeout=8000)
    except Exception:
        return False
    f.open_link("#cases")
    p.wait_for_function("document.querySelectorAll('.cb-list').length === 12 && !!Sortable.get(document.querySelector('.cb-list'))")
    # The board wraps its columns into rows; a tall window keeps both the card and the target column on screen for the drag.
    p.set_viewport_size({"width": 1280, "height": 2200})
    p.evaluate("window.scrollTo(0, 0)")
    n0 = f.audit_n()
    f.clear_toasts()
    src = p.locator(f".cb-card[data-case='{case_id}'] .cb-meta").bounding_box()
    dst = p.locator(f".cb-list[data-col='{to_col}']").bounding_box()
    p.mouse.move(src["x"] + 10, src["y"] + src["height"] / 2)
    p.mouse.down()
    p.mouse.move(src["x"] + 30, src["y"] + 20, steps=5)
    tx, ty = dst["x"] + dst["width"] / 2, dst["y"] + dst["height"] - 10
    p.mouse.move(tx, ty, steps=20)
    # Let the drag library register the column under the pointer before letting go (a person pauses there too).
    over = "col => { const g = document.querySelector('.cb-ghost'); return !!g && g.closest('.cb-list').dataset.col === col; }"
    for dx in (0, 6, -6, 12):
        p.mouse.move(tx + dx, ty, steps=3)
        try:
            p.wait_for_function(over, arg=to_col, timeout=1500)
            break
        except Exception:
            continue
    p.mouse.up()
    p.wait_for_function("n => S.audit.length > n", arg=n0)
    p.set_viewport_size({"width": 1280, "height": 900})
    return True


def test_dragging_a_card_past_a_gate_it_may_not_pass_is_refused_shown_and_audited(flow):
    f = flow().sign_in(TC)
    f.nav("cases")
    case = demo(f, "details")
    assert f.js("id => document.querySelector(`.cb-card[data-case='${id}']`).closest('.cb-list').dataset.col", case) == "sars-details"
    n0 = f.audit_n()
    if not drag_card(f, case, "questionnaire"):
        pytest.skip("The drag library (Sortable) did not load from its CDN here, so a mouse drag cannot be tried")
    toast = f.toast()
    last = f.text(".cb-last")
    codes = f.js("Array.from(document.querySelectorAll('.cb-last .vk-code')).map((e) => e.textContent)")
    col = f.js("id => document.querySelector(`.cb-card[data-case='${id}']`).closest('.cb-list').dataset.col", case)
    assert col == "sars-details", col
    assert toast.startswith("Not done: Blocked by") and "MD-05" in toast, toast
    assert case + " stays in SARS details" in last and {"MD-05", "MD-01"} <= set(codes), (last, codes)
    new = [a for a in f.audit_since(n0) if a["caseId"] == case]
    assert any(a["result"] == "Refused" and a["gate"] == "G02" and a["who"] == "TC1" and "MD-05" in a["reason"] for a in new), new
    assert any("snapped back" in a["text"] for a in new), new
    assert f.case(case, "c.gates.G02.status") == "pending"
    # The case page shows the refusals in its audit trail.
    f.open_link(f"#case-{case}")
    assert "Refused" in f.text("[data-rv-key='cases-case-audit']")

    # A client gate never passes by a staff drag: the approval case dragged towards the final checks.
    f.nav("cases")
    ap = demo(f, "approval")
    n1 = f.audit_n()
    assert drag_card(f, ap, "final-checks")
    toast = f.toast()
    assert toast.startswith("Not done: G06") and "PaperSync portal" in toast, toast
    assert f.js("id => document.querySelector(`.cb-card[data-case='${id}']`).closest('.cb-list').dataset.col", ap) == "client-approval"
    assert any(a["result"] == "Refused" and a["caseId"] == ap and a["who"] == "TC1" for a in f.audit_since(n1))
    assert f.case(ap, "c.gates.G06.status") == "pending"
    f.finish()


# ====================================================================================================== (3) withdrawal
def test_client_withdraws_approval_in_the_portal_reopens_g06_and_raises_the_clt_code(flow):
    f = flow().sign_in(TC)
    case = demo(f, "ready")
    before = f.case(case, "({ ap: ENGINE.currentApproval(c), g: ['G06','G07','G08','G09'].map((g) => c.gates[g].status), tx: ENGINE.txById(c.subTx).status, frozen: !!c.frozen })")
    assert before == {"ap": True, "g": ["released"] * 4, "tx": "awaiting G18", "frozen": True}, before
    tx = f.case(case, "c.subTx")
    n0 = f.audit_n()
    f.portal(case)
    f.click(f"button[data-act='ps.withdraw'][data-case='{case}']")
    assert f.dialog(fill={"#ps-reason": "I want to check my medical aid figures first"}) == "Your approval is withdrawn. Your accountant has been told."
    # The portal says so.
    assert "You withdrew your approval of version" in f.text("[data-rv-key='ps-portal-approval']")
    after = f.case(case, """({ ap: ENGINE.currentApproval(c), withdrawn: !!c.approval.withdrawn, g: ['G06','G07','G08','G09'].map((g) => c.gates[g].status),
        tx: ENGINE.txById(c.subTx).status, frozen: c.frozen, clt: ENGINE.openOf(c, 'CLT-06').map((x) => x.raisedBy), gate: ENGINE.currentGate(c) })""")
    assert after == {"ap": False, "withdrawn": True, "g": ["invalidated"] * 4, "tx": "cancelled", "frozen": None, "clt": ["human"], "gate": "G06"}, after
    new = f.audit_since(n0)
    assert any(a["role"] == "Client" and a["result"] == "Withdrawn" and a["gate"] == "G06" for a in new), new
    assert any(a["result"] == "Re-opened" and "G06" in (a["gate"] or "") for a in new), new
    # The firm's case page shows G06 re-opened and the CLT code; the SARS link shows the queued submission cancelled.
    f.open_link(f"#case-{case}")
    g06 = f.js("() => document.querySelector(\"[data-rv-key='cases-case-gates'] tbody tr .vk-gate\") && Array.from(document.querySelectorAll(\"[data-rv-key='cases-case-gates'] tbody tr\")).find((r) => r.querySelector('.vk-gate b') && r.querySelector('.vk-gate b').textContent === 'G06').querySelector('.vk-gate').textContent")
    assert "Re-opened" in g06, g06
    assert "CLT-06" in f.text("[data-rv-key='cases-case-exceptions']")
    f.nav("sars")
    row = f.js("id => Array.from(document.querySelectorAll(\"[data-rv-key='ops-sars-txs'] tbody tr\")).map((r) => r.textContent).find((t) => t.includes(id)) || ''", tx)
    assert "Cancelled" in row, row
    f.finish()


# ====================================================================================================== (4) SARS timeout
def test_sars_timeout_raises_int04_and_no_blind_retry_until_the_status_is_checked(flow):
    f = flow().sign_in(TC)
    case = demo(f, "ready")
    tx = f.case(case, "c.subTx")
    assert f.js("id => ENGINE.txById(id).signoffs.map((s) => s.role)", tx) == [IA]
    # The Tax Consultant adds the second G18 sign-off on the SARS link.
    f.nav("sars")
    f.click(f"[data-rv-key='ops-sars-txs'] button[data-act='vk.release'][data-tx='{tx}']")
    assert f.dialog() == f"Signed G18 for {tx}."
    # The Integration Administrator sends it; the simulated SARS link times out.
    f.as_role(IA)
    f.click(f"button[data-act='ops.tx.send'][data-tx='{tx}']")
    assert f.dialog(radio="unknown") == f"Sent {tx}: timeout: outcome unknown (simulated)."
    st = f.case(case, "({ t: ENGINE.txById(c.subTx).status, int04: ENGINE.openOf(c, 'INT-04').map((x) => x.txId), sub: !!(c.submission && c.submission.ok) })")
    assert st == {"t": "unknown", "int04": [tx], "sub": False}, st
    x04 = f.case(case, "ENGINE.openOf(c, 'INT-04')[0].id")
    # No Send button any more; Retry is refused (and audited) until the status is checked.
    assert f.page.locator(f"button[data-act='ops.tx.send'][data-tx='{tx}']").count() == 0
    assert "Status unknown" in f.js("id => Array.from(document.querySelectorAll(\"[data-rv-key='ops-sars-txs'] tbody tr\")).map((r) => r.textContent).find((t) => t.includes(id))", tx)
    n0 = f.audit_n()
    t = f.act(f"button[data-act='ops.tx.retry'][data-tx='{tx}']", ok=False)
    assert t == "Not done: Check the SARS status first: unknown calls are never retried blindly", t
    assert any(a["result"] == "Refused" and a["who"] == "IA1" and "never retried blindly" in a["reason"] for a in f.audit_since(n0))
    assert f.js("id => ENGINE.txById(id).status", tx) == "unknown" and f.js("id => S.txs.filter((t) => t.parentTx === id).length", tx) == 0
    # INT-04 itself cannot be resolved by hand while the status is unknown: the case page says why.
    f.open_link(f"#case-{case}")
    assert f.page.locator(f"[data-rv-key='cases-case-exceptions'] button[data-act='vk.resolve'][data-ex='{x04}']").count() == 0
    assert f"Check the SARS status of {tx} first" in f.text("[data-rv-key='cases-case-exceptions']")
    # The Integration Administrator checks the status: SARS did not process it. INT-04 is resolved and a retry is now allowed.
    f.nav("sars")
    f.click(f"button[data-act='ops.tx.check'][data-tx='{tx}']")
    assert f.dialog(radio="not processed") == f"Checked the SARS status of {tx}."
    assert f.case(case, "[ENGINE.txById(c.subTx).status, ENGINE.exById('" + x04 + "').status]") == ["not processed", "resolved"]
    t = f.act(f"button[data-act='ops.tx.retry'][data-tx='{tx}']")
    m = re.match(r"Retry queued as (T\d+); it needs a fresh G18\.$", t)
    assert m, t
    new_tx = m.group(1)
    r = f.js("([a, b]) => ({ old: ENGINE.txById(a).status, neu: ENGINE.txById(b).status, parent: ENGINE.txById(b).parentTx, sub: ENGINE.caseById(ENGINE.txById(b).caseId).subTx })", [tx, new_tx])
    assert r == {"old": "superseded", "neu": "awaiting G18", "parent": tx, "sub": new_tx}, r
    assert f.case(case, "c.gates.G18.status") == "invalidated"
    f.finish()


# ====================================================================================================== (5) ruleset change
def test_ruleset_change_on_try_it_raises_tax06_and_ai07_then_restore_and_rerun(flow):
    f = flow().sign_in(TC)
    case = demo(f, "calcReady")
    assert f.case(case, "ENGINE.canRelease(c, 'G05', ACTOR.me()).ok") is True
    with_calc = f.js("S.cases.filter((c) => !(c.submission && c.submission.ok) && c.calc).map((c) => c.id).sort()")
    f.nav("try")
    t = f.act("[data-rv-key='ps-try-ruleset'] button[data-act='ps.try'][data-id='ruleset']")
    assert t == f"Ruleset 2026.1 → 2027.1: AI-07 and TAX-06 on {len(with_calc)} cases.", t
    assert "AI-07" in f.text("[data-rv-key='ps-try-ruleset'] .ps-res") and "TAX-06" in f.text("[data-rv-key='ps-try-ruleset'] .ps-res")
    hit = f.js("S.cases.filter((c) => ENGINE.openOf(c, 'AI-07').length && ENGINE.openOf(c, 'TAX-06').length).map((c) => c.id).sort()")
    assert hit == with_calc, (hit, with_calc)
    st = f.case(case, "({ rs: S.rulesetVersion, rerun: c.rerun, why: ENGINE.canRelease(c, 'G05', ACTOR.me()).why })")
    assert st["rs"] == "2027.1" and st["rerun"] is True and "TAX-06" in st["why"] and "AI-07" in st["why"], st
    # The case page shows the codes and the stopped calculation gate.
    f.open_link(f"#case-{case}")
    ex = f.text("[data-rv-key='cases-case-exceptions']")
    assert "TAX-06" in ex and "AI-07" in ex
    assert "Current is 2027.1" in f.text("[data-rv-key='cases-case-calc']")
    # Restore 2026.1 and rerun.
    f.nav("try")
    t = f.act("[data-rv-key='ps-try-ruleset'] button[data-act='ps.try'][data-id='restore']")
    # A return that may already be with SARS (status unknown) is never recalculated blindly: the scenario says so for that case.
    in_flight = f.js("S.cases.filter((c) => c.calc && !(c.submission && c.submission.ok) && S.txs.some((t) => t.caseId === c.id && t.fn === 'itr12' && ENGINE.IN_FLIGHT.includes(t.status))).map((c) => c.id)")
    assert t == f"Restored 2026.1 (from 2027.1); reran {len(with_calc) - len(in_flight)} of {len(with_calc)} calculations.", (t, in_flight)
    res = f.text("[data-rv-key='ps-try-ruleset'] .ps-res")
    for cid in in_flight:
        assert re.search(cid + r"[^\n]*refused: The ITR12 T\d+ may already be with SARS", res), res
    st = f.case(case, "({ rs: S.rulesetVersion, calc: c.calc.ruleset, rerun: c.rerun, v: ENGINE.vN(c), g06: ENGINE.resolveGuard(c, ENGINE.openOf(c, 'TAX-06')[0]), g07: ENGINE.resolveGuard(c, ENGINE.openOf(c, 'AI-07')[0]) })")
    assert st == {"rs": "2026.1", "calc": "2026.1", "rerun": False, "v": 2, "g06": None, "g07": "Resolve TAX-06 (wrong-year ruleset) first"}, st
    f.open_link(f"#case-{case}")
    assert "Current" in f.text("[data-rv-key='cases-case-calc']") and "Current is" not in f.text("[data-rv-key='cases-case-calc']")
    # The Tax Consultant resolves TAX-06 on the case page now that its check passes.
    x06 = f.case(case, "ENGINE.openOf(c, 'TAX-06')[0].id")
    f.click(f"[data-rv-key='cases-case-exceptions'] button[data-act='vk.resolve'][data-ex='{x06}']")
    assert f.dialog(fill={"#vk-res-action": "Calculation rerun on the approved 2026.1 ruleset"}) == f"Resolved {x06} (TAX-06)."
    assert f.js("id => ENGINE.exById(id).status", x06) == "resolved"
    assert f.case(case, "ENGINE.resolveGuard(c, ENGINE.openOf(c, 'AI-07')[0])") is None
    # The platform team's part is simulated on the same page: it resolves AI-07 (its owner) and closes TAX-06 (its secondary reviewer).
    x07 = f.case(case, "ENGINE.openOf(c, 'AI-07')[0].id")
    f.open_link(f"#case-{case}")
    assert f.page.locator(f"[data-rv-key='cases-case-exceptions'] button[data-act='vk.resolve'][data-ex='{x07}']").count() == 0
    f.click(f"[data-rv-key='cases-case-exceptions'] button[data-act='vk.platResolve'][data-ex='{x07}']")
    assert "simulated" in f.text("#dlg")
    assert f.dialog(fill={"#vk-pres-action": "Impact assessed: every affected calculation was rerun on 2026.1"}) == f"Resolved {x07} (AI-07) as the simulated Platform Product Owner."
    f.click(f"[data-rv-key='cases-case-exceptions'] button[data-act='vk.platClose'][data-ex='{x06}']")
    assert f.dialog(fill={"#vk-pclose-note": "Ruleset 2026.1 confirmed as the approved configuration"}) == f"Closed {x06} (TAX-06) as the simulated Platform Product Owner."
    st = f.js("([a, b]) => [a, b].map((id) => { const x = ENGINE.exById(id); return [x.status, x.resolvedById, x.closedById || null]; })", [x07, x06])
    assert st == [["resolved", "Platform Product Owner (simulated)", None], ["closed", "TC1", "Platform Product Owner (simulated)"]], st
    # AI-07's secondary reviewer is the Tax Consultant, who did not resolve it, so the Tax Consultant closes it.
    f.click(f"[data-rv-key='cases-case-exceptions'] button[data-act='vk.close'][data-ex='{x07}']")
    assert f.dialog() == f"Closed {x07} (AI-07)."
    assert f.js("id => [ENGINE.exById(id).status, ENGINE.exById(id).closedById]", x07) == ["closed", "TC1"]
    # Nothing blocks the case any more: the Tax Consultant releases G05 on the case page.
    assert f.case(case, "ENGINE.canRelease(c, 'G05', ACTOR.me()).why") == ""
    f.release(case, "G05")
    assert any(a["who"] == "Platform Product Owner (simulated)" and a["code"] == "AI-07" for a in f.audit_since(0))
    f.finish()


# ====================================================================================================== (6) the remedy path
def test_client_instructs_the_firm_then_the_objection_with_its_chapter9_deadline(flow):
    f = flow().sign_in(TC)
    case = demo(f, "assessment")
    assert f.case(case, "[ENGINE.currentGate(c), ENGINE.openOf(c, 'ASM-02').length]") == ["G12", 1]
    # The Tax Consultant clears the ITA34 difference (ASM-02) on the case page; the AI's G12 then passes.
    f.open_link(f"#case-{case}")
    x = f.case(case, "ENGINE.openOf(c, 'ASM-02')[0].id")
    f.click(f"[data-rv-key='cases-case-exceptions'] button[data-act='vk.resolve'][data-ex='{x}']")
    assert f.dialog(fill={"#vk-res-action": "SARS used R42,000.00 for the retirement annuity; the certificate shows R60,000.00"}) == f"Resolved {x} (ASM-02)."
    if f.case(case, "c.gates.G12.status") != "released":
        f.release(case, "G12")
    todo = f.case(case, "c.req.G13.filter((r) => !r.done).map((r) => r.label)")
    assert todo and "Not ready: " + todo[0] in f.case(case, "ENGINE.canRelease(c, 'G13', ACTOR.me()).why")
    f.open_link(f"#case-{case}")
    f.tick(case, "G13")
    f.release(case, "G13")
    # The client disagrees in the portal and instructs the firm.
    f.portal(case)
    f.click(f"button[data-act='ps.decide'][data-case='{case}'][data-choice='instruct']")
    assert f.dialog(fill={"#ps-reason": "The retirement annuity was R60,000.00, not R42,000.00"}) == "Sent to your accountant: they will propose a remedy."
    st = f.case(case, "({ d: c.decision.choice, g14: [c.gates.G14.status, c.gates.G14.byType], clt: ENGINE.openOf(c, 'CLT-07').length, rem: ENGINE.openOf(c, 'REM-01').length, g15: ENGINE.applies(c, 'G15'), gate: ENGINE.currentGate(c) })")
    assert st == {"d": "instruct", "g14": ["released", "client"], "clt": 1, "rem": 1, "g15": True, "gate": "G15"}, st
    # Before a route is chosen, Deadlines shows what the objection's Chapter 9 deadline would be.
    want = f.case(case, "(() => { const r = ENGINE.remedyDeadline(c, 'objection'); return { iso: r.deadline, text: fDate(VK.toDay(r.deadline)), from: c.ita34.date }; })()")
    assert want["iso"] > "2027-01-15", want  # 80 business days from 28 Oct 2026, with 16 Dec to 15 Jan not counted
    f.nav("deadlines")
    rows = f.js("id => Array.from(document.querySelectorAll(\"[data-rv-key='adm-deadlines-remedies'] tbody tr\")).map((r) => r.textContent).filter((t) => t.includes(id))", case)
    obj = [r for r in rows if "Notice of objection" in r]
    assert obj and "if the client disputes" in obj[0] and want["text"] in obj[0], rows
    # The Tax Consultant chooses the objection on the case page, with the grounds and evidence; the dialog shows its deadline first.
    f.open_link(f"#case-{case}")
    rem = f.case(case, "ENGINE.openOf(c, 'REM-01')[0].id")
    assert "Choose the remedy route first" in f.text("[data-rv-key='cases-case-exceptions']")
    f.click(f"[data-rv-key='cases-case-ita34'] button[data-act='cases.remedy'][data-case='{case}']")
    assert want["text"] in f.text("#dlg label:has(input[value='objection'])")
    assert f.dialog(ok=False, radio="objection") == "Record the grounds and evidence."
    t = f.dialog(radio="objection", fill={"#cs-rem-ev": "Retirement annuity certificate for R60,000.00"})
    assert t == "Chose the remedy: Notice of objection, due " + want["text"] + ".", t
    st = f.case(case, "({ route: c.remedy.route, deadline: c.remedy.deadline, rem05: ENGINE.openOf(c, 'REM-05').map((x) => x.sarsDeadline), rem01: ENGINE.exById('" + rem + "').status })")
    assert st == {"route": "objection", "deadline": want["iso"], "rem05": [want["iso"]], "rem01": "resolved"}, st
    # The deadline shows on the case page, in the client's portal and on Deadlines; the client authorises the objection.
    f.open_link(f"#case-{case}")
    sec = f.text("[data-rv-key='cases-case-ita34']")
    assert "Notice of objection" in sec and want["text"] in sec and "16 Dec to 15 Jan not counted" in sec and "rule 7(1)" in sec, sec
    f.portal(case)
    card = f.text("[data-rv-key='ps-portal-remedy']")
    assert "Notice of objection" in card and want["text"] in card, card
    assert f.act(f"button[data-act='ps.authorise'][data-case='{case}']") == "You authorised your accountant to act."
    assert f.case(case, "c.remedy.authority.route") == "objection"
    f.nav("deadlines")
    rows = f.js("id => Array.from(document.querySelectorAll(\"[data-rv-key='adm-deadlines-remedies'] tbody tr\")).map((r) => r.textContent).filter((t) => t.includes(id))", case)
    assert len(rows) == 1 and "Chosen" in rows[0] and want["text"] in rows[0], rows
    f.finish()


# ====================================================================================================== (7) a judgement item
def test_judgement_item_decided_on_the_case_page_recalculated_and_tax02_resolves(flow):
    f = flow().sign_in(TC)
    case = demo(f, "judgement")
    st = f.case(case, "({ v: ENGINE.vN(c), pending: c.calc.pending.map((p) => p.line + ':' + p.code), x: ENGINE.openOf(c, 'TAX-02').map((x) => x.id + ':' + x.calcRef) })")
    assert st["v"] == 1 and st["pending"] == ["L5:TAX-02"] and len(st["x"]) == 1 and st["x"][0].endswith(":L5"), st
    x = st["x"][0].split(":")[0]
    f.nav("cases")
    f.follow(f"#case-{case}")
    # Not resolvable yet: the case page says what is missing.
    assert f.page.locator(f"[data-rv-key='cases-case-exceptions'] button[data-act='vk.resolve'][data-ex='{x}']").count() == 0
    assert "Record the Tax Consultant’s amount and rationale for L5 first" in f.text("[data-rv-key='cases-case-exceptions']")
    # Decide on the case page.
    f.click(f"[data-rv-key='cases-case-calc'] button[data-act='cases.decide'][data-case='{case}'][data-line='L5']")
    assert f.dialog(fill={"#cs-dec-amount": "18000", "#cs-dec-why": "Home office: s23(m) met for 9 of 12 months; R24,000.00 claimed, R18,000.00 allowed"}) == "Decided L5. Recalculate to use it."
    assert f.case(case, "[c.inputs.lines.find((l) => l.id === 'L5').amount, c.inputs.lines.find((l) => l.id === 'L5').decided.by]") == [18000, "TC1"]
    assert "Rerun the calculation with the decision on L5 first" in f.text("[data-rv-key='cases-case-exceptions']")
    assert "Decided: recalculate to use it" in f.text("[data-rv-key='cases-case-calc']")
    # Recalculate: version 2 uses the decision and nothing is pending.
    f.click(f"[data-rv-key='cases-case-calc'] button[data-act='cases.recalc'][data-case='{case}']")
    assert f.dialog(fill={"#cs-rc-why": "Recalculated after the home office decision"}) == f"Recalculated {case}: version 2."
    st = f.case(case, "({ v: ENGINE.vN(c), pending: c.calc.pending.length, home: (c.calc.lines || []).some((l) => (l.from || []).includes('L5')), guard: ENGINE.resolveGuard(c, ENGINE.exById('" + x + "')) })")
    assert st == {"v": 2, "pending": 0, "home": True, "guard": None}, st
    assert "No judgement items are waiting." in f.text("[data-rv-key='cases-case-calc']")
    # TAX-02 resolves on the case page.
    f.click(f"[data-rv-key='cases-case-exceptions'] button[data-act='vk.resolve'][data-ex='{x}']")
    assert f.dialog(fill={"#vk-res-action": "Decided L5 at R18,000.00 and recalculated as version 2"}) == f"Resolved {x} (TAX-02)."
    st = f.case(case, "({ s: ENGINE.exById('" + x + "').status, by: ENGINE.exById('" + x + "').resolvedById, blocks: ENGINE.gateBlockers(c, 'G05').map((y) => y.code) })")
    assert st["s"] == "resolved" and st["by"] == "TC1" and "TAX-02" not in st["blocks"], st
    f.finish()
