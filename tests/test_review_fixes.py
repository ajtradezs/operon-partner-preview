"""Regression tests for the independent review's findings fixed in the engine, the workflow configuration, the seed and the build
(R2, R3, R4, R5/R6/W5/W6/W10/W11, W2, W7, W9, W12, D2, D3, m2, m3; M2 is in tests/test_seed.py). Each test fails on the code as
it was reviewed (commit 3767db8).

Same conventions as tests/test_engine.py: one module-scoped page (timezone Africa/Johannesburg) on the built index.html, an empty
firm (DEMO.cases = false), and a fresh seed() before each page.evaluate.
"""
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from test_engine import HELPERS, ev

ROOT = Path(__file__).resolve().parents[1]
ISO = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")


@pytest.fixture(scope="module")
def page(browser, site):
    ctx = browser.new_context(timezone_id="Africa/Johannesburg")
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.goto(site)
    pg.wait_for_function("typeof ENGINE !== 'undefined' && typeof S !== 'undefined' && !!S")
    pg.evaluate(HELPERS)
    yield pg
    ctx.close()


# ---------------------------------------------------------------------------------------------------------------------------
# R2: no override may bypass a statutory restriction, missing taxpayer authority, a security control or SARS-interface authorisation
# ---------------------------------------------------------------------------------------------------------------------------

def test_r2_authority_privacy_and_sars_link_codes_can_never_be_overridden(page):
    r = ev(page, r"""
      const o = { lists: NEVER_OVERRIDE, why: {}, policy: {} };
      ['KYC-04', 'KYC-05', 'KYC-06', 'MD-06'].forEach((k) => { o.why[k] = ENGINE.eligibleWhy(k); o.policy[k] = ENGINE.setOverridable(k, true, rc).ok; });
      o.overridable = S.policy.overridable.slice();
      // The review's scenario: KYC-05 raised, put on the policy list, overridden, and G01 released over the defective mandate.
      const c = H.mk();
      const x = ENGINE.raiseManual(c, 'KYC-05', tc, { note: 'Mandate unsigned' }).exception;
      o.req = ENGINE.requestOverride(x, ad, { reason: 'r', evidence: 'e' }).ok;
      o.approve = ENGINE.approveOverride(x, rc).ok;
      o.g01 = ENGINE.canRelease(c, 'G01', ad);
      o.stillEligible = ['MD-05', 'TAX-05'].map((k) => ENGINE.eligibleWhy(k));
      return o;
    """)
    assert "KYC-04" in r["lists"]["authority"] and "KYC-05" in r["lists"]["authority"]
    assert r["lists"]["statutory"] == ["KYC-06"] and r["lists"]["sarsInterface"] == ["MD-06"]
    assert r["why"]["KYC-04"] and "authority" in r["why"]["KYC-04"] and "authority" in r["why"]["KYC-05"]
    assert "statutory" in r["why"]["KYC-06"] and "SARS-interface" in r["why"]["MD-06"], r["why"]
    assert r["policy"] == {"KYC-04": False, "KYC-05": False, "KYC-06": False, "MD-06": False} and r["overridable"] == []
    assert not r["req"] and not r["approve"] and not r["g01"]["ok"] and "KYC-05" in r["g01"]["codes"], r
    assert r["stillEligible"] == [None, None], "Ordinary S2 codes stay eligible for the policy list"


# ---------------------------------------------------------------------------------------------------------------------------
# R3: a severity change never alters the register's Blocking value; lowering a blocking code: owner asks, approver approves
# ---------------------------------------------------------------------------------------------------------------------------

def test_r3_lowering_a_blocking_s3_code_keeps_it_blocking_and_needs_owner_and_approval(page):
    r = ev(page, r"""
      const o = {};
      const c = H.mk(null, null);
      ENGINE.setKyc(ENGINE.clientOf(c), 'address', false, ad);
      const x = ENGINE.raise(c, 'KYC-01', { by: sys });   // S3, Blocking Yes, owner Administrator
      o.byTc = ENGINE.setSeverity(x, tc, 'S4', { reason: 'Minor' });   // the review's scenario: not the owner
      o.afterTc = [x.sev, x.blocking, ENGINE.blocksNow(x)];
      o.byAd = ENGINE.setSeverity(x, ad, 'S4', { reason: 'Address proof is on its way' });
      o.pending = [x.sev, x.sevRequest && x.sevRequest.status];
      o.selfApprove = ENGINE.approveSeverity(x, ad).ok;
      o.approve = ENGINE.approveSeverity(x, rc).ok;
      ENGINE.setKyc(ENGINE.clientOf(c), 'address', true, ad);
      o.after = [x.sev, x.blocking, ENGINE.blocksNow(x)];
      o.g01 = ENGINE.canRelease(c, 'G01', ad);
      // A Conditional SARS-interface code: the Integration Administrator (its owner) lowers it, and it still blocks.
      const d = H.at('G18'); const t = H.itx(d); H.sign2(t);
      ENGINE.setLink({ up: false }, ia); ENGINE.transmit(t, ia, 'success');
      const y = H.ex(d, 'INT-03');
      ENGINE.setSeverity(y, ia, 'S4', { reason: 'Outage expected to be short' }); ENGINE.approveSeverity(y, rc);
      o.int03 = [y.sev, y.blocking, ENGINE.blocksNow(y)];
      // A code the register marks non-blocking (DOC-05, S4) that was raised to S3 can be lowered again without approval.
      const z = ENGINE.raiseManual(H.mk(), 'DOC-05', tc, { note: 'dup' }).exception;
      ENGINE.setSeverity(z, tc, 'S3', { reason: 'Check it' });
      o.doc05 = [ENGINE.setSeverity(z, tc, 'S4', { reason: 'Fine' }), z.sev, z.blocking];
      return o;
    """)
    assert not r["byTc"]["ok"] and "owner" in r["byTc"]["why"] and r["afterTc"] == ["S3", "Yes", True], r
    assert r["byAd"]["ok"] and r["byAd"].get("pending") and r["pending"] == ["S3", "pending"], r
    assert not r["selfApprove"] and r["approve"]
    assert r["after"] == ["S4", "Yes", True], "The register rules: KYC-01 still blocks at S4"
    assert not r["g01"]["ok"] and "KYC-01" in r["g01"]["codes"], r["g01"]
    assert r["int03"] == ["S4", "Conditional", True], "SARS-interface authorisation is not bypassed by a severity change"
    assert r["doc05"][0]["ok"] and not r["doc05"][0].get("pending") and r["doc05"][1:] == ["S4", "No"], r["doc05"]


def test_r3_sod_text_names_the_owner_rule(page):
    r = ev(page, "return SOD.find((s) => s.id === 'sod-severity').text;")
    assert "owner" in r and "blocking" in r and "Records/Compliance Owner" in r


# ---------------------------------------------------------------------------------------------------------------------------
# R4: CLT-02 belongs to the Tax Consultant
# ---------------------------------------------------------------------------------------------------------------------------

def test_r4_clt02_is_resolved_by_the_tax_consultant_not_by_reapproving(page):
    r = ev(page, r"""
      const o = { portalOnly: PORTAL_ONLY.slice() };
      const c = H.at('G06');
      const x = ENGINE.portal(c, 'reject', { reason: 'The medical credits look wrong' }).exception;
      o.x = [x.code, x.owner, x.status];
      o.reapprove = ENGINE.portal(c, 'approve', { version: ENGINE.vN(c), declaration: true });
      o.xAfterReapprove = x.status; o.g06 = c.gates.G06.status;
      o.byClient = ENGINE.portal(c, 'respond', { exceptionId: x.id, text: 'Never mind' }).ok;
      o.byTc = ENGINE.resolve(x, tc, { action: 'Concern investigated with the client: the credits are right; no revised pack needed' }).ok;
      o.resolvedBy = x.resolvedBy;
      o.approve = ENGINE.portal(c, 'approve', { version: ENGINE.vN(c), declaration: true }).ok;
      o.g06After = c.gates.G06.status;
      return o;
    """)
    assert r["portalOnly"] == ["CLT-04", "CLT-05", "CLT-06"]
    assert r["x"][:2] == ["CLT-02", "Tax Consultant"]
    assert not r["reapprove"]["ok"] and "CLT-02" in r["reapprove"]["why"], r["reapprove"]
    assert r["xAfterReapprove"] not in ("resolved", "closed") and r["g06"] != "released", r
    assert not r["byClient"]
    assert r["byTc"] and r["resolvedBy"] == "Ayesha Patel"
    assert r["approve"] and r["g06After"] == "released"


# ---------------------------------------------------------------------------------------------------------------------------
# R5, R6, W5, W6, W10, W11: the interpretations are put to Johan
# ---------------------------------------------------------------------------------------------------------------------------

def test_pending_johan_lists_the_reviewed_interpretations(page):
    r = ev(page, r"""
      const by = Object.fromEntries(PENDING_JOHAN.map((q) => [q.id, q.text]));
      const all = NEVER_OVERRIDE.authority.concat(NEVER_OVERRIDE.security, NEVER_OVERRIDE.statutory, NEVER_OVERRIDE.sarsInterface);
      return { by, ids: PENDING_JOHAN.map((q) => q.id), missingFromNever: all.filter((k) => !(by['q-never-override'] || '').includes(k)),
        families: Object.keys(NEVER_OVERRIDE.families).filter((f) => !(by['q-never-override'] || '').includes(f)),
        kycCount: ENGINE.KYC_ITEMS.length };
    """)
    by = r["by"]
    want = ["q-g10-da04", "q-conditional", "q-standins", "q-s3-gate", "q-never-override", "q-ai-lower", "q-g01-master", "q-g01-scope", "q-engagement"]
    assert [k for k in want if k not in by] == [], r["ids"]
    assert len(set(r["ids"])) == len(r["ids"]), "ids are unique"
    assert "DA-04" in by["q-g10-da04"] and "G11" in by["q-g10-da04"]                       # R5, W11
    assert all(k in by["q-conditional"] for k in ("AI-06", "INT-03", "INT-13", "INT-15"))   # R6 (a)
    assert "Other readings" in by["q-conditional"]
    assert "DOC-05" in by["q-standins"] and "PRE-02" in by["q-standins"]                      # R6 (b)
    assert "S3" in by["q-s3-gate"]                                                            # R6 (c)
    assert r["missingFromNever"] == [] and r["families"] == []                               # R6 (d), kept in step with the lists
    assert "S3 to S4" in by["q-ai-lower"]                                                     # R6 (e)
    assert "six KYC" in by["q-g01-master"] and r["kycCount"] == 6                             # W5
    assert "after G02" in by["q-g01-scope"]                                                   # W6
    assert "Engagement terms accepted" in by["q-engagement"]                                  # W10
    assert not any("—" in t or "--" in t for t in by.values())


# ---------------------------------------------------------------------------------------------------------------------------
# W2: G13 is the consultant's approval of the reconciliation and the client communication; the client is told after it passes
# ---------------------------------------------------------------------------------------------------------------------------

def test_w2_g13_is_the_consultants_approval_and_the_package_follows_it(page):
    r = ev(page, r"""
      const c = H.at('G13');
      const n = H.auditLen();
      const o = { req: c.req.G13.map((x) => [x.key, x.label, x.detail]), why: ENGINE.canRelease(c, 'G13', tc).why, sentBefore: !!c.assessmentPack };
      ENGINE.markReq(c, 'G13', 'advice', tc);
      o.rel = ENGINE.release(c, 'G13', tc).ok;
      const t = S.audit.slice(n).map((a) => [a.result, a.gate, a.text, a.sarsRef]);
      o.order = t.filter((a) => a[1] === 'G13' && (a[0] === 'Released' || a[0] === 'Sent')).map((a) => a[0]);
      o.sent = t.find((a) => a[0] === 'Sent'); o.pack = c.assessmentPack; o.ref = c.ita34.ref;
      return o;
    """)
    key, label, detail = r["req"][0]
    assert label == "Assessment reconciliation and client communication approved", label
    assert "advised" not in label.lower()
    assert "ITA34 and AI reconciliation" in detail and "Recommended next action" in detail, detail
    assert "Assessment reconciliation and client communication approved" in r["why"]
    assert not r["sentBefore"] and r["rel"]
    assert r["order"] == ["Released", "Sent"], "The client is told only after G13 passes"
    assert "assessment package" in r["sent"][2] and r["sent"][3] == r["ref"] and r["pack"]["ita34"]["ref"] == r["ref"]


# ---------------------------------------------------------------------------------------------------------------------------
# W7: the step 5 questionnaire areas
# ---------------------------------------------------------------------------------------------------------------------------

def test_w7_questionnaire_covers_the_step5_areas(page):
    r = ev(page, r"""
      const Q = Object.fromEntries(ENGINE.QUESTIONS.map((q) => [q.key, q]));
      const o = { keys: Object.keys(Q), material: ENGINE.QUESTIONS.filter((q) => q.material).map((q) => q.key) };
      // Each new kind has a document label and a sample file name the simulated AI classifies as that kind.
      o.kinds = ['business', 'trust', 'pension', 'disability'].map((k) => {
        const f = ENGINE.FILE_FOR[k] || ''; const plain = f.toLowerCase().replace(/[_\-.]+/g, ' ');
        const hit = DOC_KINDS.find((d) => d.rx.test(plain));
        return [k, !!DOC_KINDS.find((d) => d.kind === k), hit ? hit.kind : null];
      });
      // Answered yes: the documents are requested and the new events raise QUE-03.
      const c = H.at('G03');
      c.questionnaire.required.forEach((k) => ENGINE.portal(c, 'answer', { key: k, value: ['employment', 'medical'].includes(k) }));
      ['business', 'trust', 'pension', 'disability', 'other'].forEach((k) => ENGINE.portal(c, 'answer', { key: k, value: true }));
      ENGINE.portal(c, 'submitQuestionnaire');
      o.items = c.items.map((it) => it.kind);
      o.que03 = ENGINE.exOf(c).filter((x) => x.code === 'QUE-03').map((x) => x.item).sort();
      // The uploads validate against their own kind (no AI-02).
      const d = H.at('G04');
      o.uploads = ['business', 'trust', 'pension', 'disability'].map((k) => { const it = ENGINE.addItem(d, k); return ENGINE.upload(d, it.id, { name: ENGINE.FILE_FOR[k], size: 245760 }, ACTOR.client(d.clientId)).doc.status; });
      // drive() still works with its defaults.
      o.drive = ENGINE.drive(H.mk(), 'G16').ok;
      return o;
    """)
    for k in ("pension", "business", "trust", "disability", "other"):
        assert k in r["keys"], (k, r["keys"])
    assert {"pension", "business", "trust", "other"} <= set(r["material"]) and "disability" not in r["material"]
    assert r["kinds"] == [["business", True, "business"], ["trust", True, "trust"], ["pension", True, "pension"], ["disability", True, "disability"]], r["kinds"]
    assert {"business", "trust", "pension", "disability"} <= set(r["items"]), r["items"]
    assert r["que03"] == ["business", "other", "pension", "trust"], r["que03"]
    assert r["uploads"] == ["validated"] * 4, r["uploads"]
    assert r["drive"]


# ---------------------------------------------------------------------------------------------------------------------------
# W9: the client's G14 decision records the ITA34 it answers
# ---------------------------------------------------------------------------------------------------------------------------

def test_w9_decision_records_the_assessment_it_answers(page):
    r = ev(page, r"""
      const c = H.at('G14');
      const n = H.auditLen();
      const d = ENGINE.portal(c, 'decide', { choice: 'accept' });
      const g14 = S.audit.slice(n).find((a) => a.gate === 'G14' && a.result === 'Released');
      return { ok: d.ok, decision: c.decision, ita34: { ref: c.ita34.ref, date: c.ita34.date }, audit: g14 && { sarsRef: g14.sarsRef, evidence: g14.evidence } };
    """)
    assert r["ok"]
    assert r["decision"]["ita34"] == r["ita34"], r["decision"]
    assert r["audit"]["sarsRef"] == r["ita34"]["ref"] and r["ita34"]["ref"] in r["audit"]["evidence"], r["audit"]
    assert not ISO.search(r["audit"]["evidence"]), "The date reads as people write it"


# ---------------------------------------------------------------------------------------------------------------------------
# W12 (engine part): a passport-only client
# ---------------------------------------------------------------------------------------------------------------------------

def test_w12_passport_only_client_keeps_no_id_and_calc_asks_for_the_date_of_birth(page):
    r = ev(page, r"""
      const p = ENGINE.newClient({ name: 'Passport Only', taxRef: '9100000777', idNo: null });
      const e = ENGINE.newClient({ name: 'Blank Id', taxRef: '9100000778', idNo: '' });
      const dflt = ENGINE.newClient({ name: 'Default', taxRef: '9100000779' });
      const withDob = ENGINE.newClient({ name: 'Passport With Dob', taxRef: '9100000780', idNo: null, dob: '1980-05-01' });
      const c = ENGINE.newCase(p, {}); c.inputs = { lines: [] };
      const k = ENGINE.newCase(withDob, {}); k.inputs = { lines: [] };
      return { p: p.idNo, e: e.idNo, dflt: dflt.idNo, errs: CALC.forCase(c).calc.errors, age: CALC.profileOf(withDob, 2026, {}).age,
        errs2: CALC.forCase(k).calc.errors };
    """)
    assert r["p"] is None and r["e"] is None and r["dflt"] == "8001015009088"
    assert any("date of birth" in e for e in r["errs"]), r["errs"]
    assert r["age"] == 45 and not any("date of birth" in e for e in r["errs2"]), r


# ---------------------------------------------------------------------------------------------------------------------------
# D2: a cross-client upload is refused and audited
# ---------------------------------------------------------------------------------------------------------------------------

def test_d2_cross_client_upload_refusal_is_audited(page):
    r = ev(page, r"""
      const c = H.at('G04'); const other = ENGINE.newClient({ name: 'Other', taxRef: '9100000999' });
      const n = H.auditLen();
      const u = ENGINE.upload(c, c.items[0].id, { name: 'IRP5_2026.pdf', size: 245760 }, ACTOR.client(other.id));
      const v = ENGINE.upload(c, c.items[0].id, { name: 'IRP5_2026.pdf', size: 245760 }, ACTOR.client(c.clientId, 'email'));
      return { u: [u.ok, u.why], v: v.ok, added: S.audit.slice(n).map((a) => [a.result, a.who, a.caseId, a.text]), docs: c.docs.length, chain: ENGINE.verifyChain().ok };
    """)
    assert r["u"] == [False, "Not this client"] and not r["v"] and r["docs"] == 0
    assert len(r["added"]) == 2 and all(a[0] == "Refused" and "Upload refused" in a[3] for a in r["added"]), r["added"]
    assert r["chain"]


# ---------------------------------------------------------------------------------------------------------------------------
# m2, m3: money and dates as the rest of the app shows them; column labels, not keys
# ---------------------------------------------------------------------------------------------------------------------------

def test_m2_asm02_note_formats_money_with_calc_rand(page):
    r = ev(page, r"""
      const c = H.at('G12');
      const data = Object.assign({}, c.calc.summary, { taxableIncome: 5000, result: -1500 });
      ENGINE.receive({ fn: 'ita34', taxRef: ENGINE.clientOf(c).taxRef, year: c.year, ref: 'ITA34-M2', date: '2026-11-09', data, submissionRef: c.submission.ref });
      return H.ex(c, 'ASM-02').note;
    """)
    assert "firm R0.00, SARS R5,000.00" in r and "SARS −R1,500.00" in r, r
    assert "R " not in r and "-R" not in r, r


def test_m3_drag_and_watcher_texts_use_labels_and_readable_dates(page):
    r = ev(page, r"""
      const c = H.at('G02'); ENGINE.markReq(c, 'G02', 'compare', tc);
      ENGINE.raise(c, 'MD-05', { by: tc });
      const n = H.auditLen();
      ENGINE.dragForward(c, tc);
      const drag = S.audit.slice(n).map((a) => a.text);
      const d = H.at('G12');
      ENGINE.receive({ fn: 'daIn', taxRef: ENGINE.clientOf(d).taxRef, year: d.year, ref: 'DA-M3', due: '2026-12-15', date: '2026-11-09' });
      S.policy.warnDays = 1000; ENGINE.watch();
      return { drag, da05: H.ex(d, 'DA-05').note };
    """)
    assert any("snapped back to SARS details" in t for t in r["drag"]), r["drag"]
    assert not any("sars-details" in t for t in r["drag"]), r["drag"]
    assert r["da05"].endswith("left to 15 Dec 2026"), r["da05"]
    assert not ISO.search(r["da05"]), r["da05"]


# ---------------------------------------------------------------------------------------------------------------------------
# D3: build.py --check also checks the committed index.html
# ---------------------------------------------------------------------------------------------------------------------------

def test_d3_check_runs_the_safety_checks_and_compares_index_html_with_src(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(ROOT / "src", repo / "src")
    shutil.copytree(ROOT / "tools", repo / "tools", ignore=shutil.ignore_patterns("__pycache__"))
    inputs = tmp_path / "no-inputs"
    inputs.mkdir()
    env = dict(os.environ, OPERON_ITR12_DIR=str(inputs))
    build = [sys.executable, "-I", str(repo / "tools" / "build.py")]

    def run(*args):
        p = subprocess.run(build + list(args), cwd=str(repo), env=env, capture_output=True, text=True, encoding="utf-8")
        return p.returncode, p.stdout + p.stderr

    index = repo / "index.html"
    code, out = run("--out", str(index))
    assert code == 0, out
    code, out = run("--check")
    assert code == 0 and "matches the build of src/" in out, out
    assert "no deny-list file" in out, "check() says when the real-name check was skipped"

    good = index.read_text(encoding="utf-8")
    # Only the build timestamp differs: still the build of src/.
    index.write_text(re.sub(r'data-build="[0-9TZ]+"', 'data-build="20000101T000000Z"', good), encoding="utf-8", newline="\n")
    code, out = run("--check")
    assert code == 0, out

    # A stale or hand-edited index.html fails with a clear message.
    index.write_text(good.replace("</body>", "<!-- edited by hand --></body>"), encoding="utf-8", newline="\n")
    code, out = run("--check")
    assert code != 0 and "index.html is out of date with src/" in out, out

    # src/ moved on without a rebuild.
    index.write_text(good, encoding="utf-8", newline="\n")
    wf = repo / "src" / "itr12" / "workflow.js"
    wf.write_text(wf.read_text(encoding="utf-8") + "\n// changed\n", encoding="utf-8", newline="\n")
    code, out = run("--check")
    assert code != 0 and "out of date" in out, out

    # A key-like string in the committed page fails the safety checks.
    index.write_text(good.replace("</body>", "sb_secret_x</body>"), encoding="utf-8", newline="\n")
    code, out = run("--check")
    assert code != 0 and "safety checks" in out and "sb_secret_" in out, out


def test_zz_no_page_errors(page):
    assert page.errors == [], page.errors


def test_b1_resending_the_questionnaire_applies_only_changed_answers(page):
    """The questionnaire case (QUE-04 ra, QUE-03 rental): the consultant resolves both, the client says Yes to capital gains and
    sends the answers again. The capital gains item is added and QUE-03 is raised for cgt; the resolved codes are not raised again."""
    r = page.evaluate("""() => { TICKERS.splice(0); DEMO.cases = true; seed();
      const c = ENGINE.caseById(DEMO.keys.questionnaire); const tc = ACTOR.as('Tax Consultant', c.consultant);
      ENGINE.exOf(c).filter(ENGINE.isOpen).forEach((x) => ENGINE.resolve(x, tc, { action: 'Discussed with the client' }));
      ENGINE.portal(c, 'answer', { key: 'cgt', value: true });
      ENGINE.portal(c, 'submitQuestionnaire');
      const q = ENGINE.exOf(c).map((x) => [x.code, x.item, ENGINE.isOpen(x)]);
      return { items: c.items.map((i) => i.kind), q, g03: c.gates.G03.status }; }""")
    assert "it3c" in r["items"]
    assert ["QUE-03", "cgt", True] in r["q"]
    assert sum(1 for x in r["q"] if x[0] == "QUE-04") == 1 and sum(1 for x in r["q"] if x[0] == "QUE-03" and x[1] == "rental") == 1
    assert r["g03"] != "released"
