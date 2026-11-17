"""Regression tests for the 53 findings of the adversarial review of the ITR12 gate engine (src/itr12/engine.js).

One test per accepted finding; duplicates are merged under the lowest number (27=38, 12=39, 15=41, 16=42, 18=43, 19=45, 7=44,
5=49, 6=23=46, 25=30, 14=48). Each test replays the finding's failure scenario and asserts the behaviour the adjudication ruled
to be intended, so it fails on the engine as it was reviewed.

Same conventions as tests/test_engine.py: one module-scoped page (timezone Africa/Johannesburg) on the built index.html, and each
test stops the per-second ticker (TICKERS.splice(0)) and re-seeds state (seed()) before driving the engine in one page.evaluate.
"""
from datetime import date

import pytest

from test_engine import HELPERS, add_biz, ev, iso


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
# Gates (#1-#11)
# ---------------------------------------------------------------------------------------------------------------------------

def test_f01_g18_refuses_an_s3_g18_code_that_blocks(page):
    r = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c);
      const x = ENGINE.raiseManual(c, 'INT-15', ia, { note: 'clock skew' }).exception;
      const o = { x: [x.sev, x.blocking, ENGINE.blocksNow(x)], blockers: ENGINE.g18Blockers(t) };
      o.signIa = ENGINE.signG18(t, ia); o.signTc = ENGINE.signG18(t, tc).ok; o.status = t.status;
      ENGINE.recordFallback(x, ia, { note: 'Times checked by hand', ref: 'F-1' });
      o.recordedOnly = ENGINE.signG18(t, tc).ok;
      ENGINE.reconcileFallback(x, tc2, {});
      o.afterReconcile = H.sign2(t).map((s) => s.ok); o.status2 = t.status;
      // Signed first, INT-15 raised afterwards: the send is refused.
      const d = H.at('G18'); const u = H.itx(d); H.sign2(u);
      ENGINE.raiseManual(d, 'INT-15', ia, { note: 'clock skew after sign-off' });
      o.transmit = ENGINE.transmit(u, ia, 'success').ok; o.sub = d.submission;
      // INT-03 blocks G18 only while the SARS interface is down.
      const e = H.at('G18'); const v = H.itx(e);
      ENGINE.raiseManual(e, 'INT-03', ia, { note: 'brief outage, link back up' });
      o.int03Up = ENGINE.g18Blockers(v).some((b) => b.startsWith('INT-03'));
      return o;
    """)
    assert r["x"] == ["S3", "Conditional", True]
    assert any(b.startswith("INT-15") for b in r["blockers"]), r["blockers"]
    assert not r["signIa"]["ok"] and "INT-15" in r["signIa"]["why"] and not r["signTc"] and r["status"] == "awaiting G18", r
    assert not r["recordedOnly"], "A recorded but unreconciled fallback still blocks G18"
    assert r["afterReconcile"] == [True, True] and r["status2"] == "ready", r
    assert not r["transmit"] and r["sub"] is None, "transmit is refused while INT-15 blocks G18"
    assert not r["int03Up"], "INT-03 does not block G18 once the link is up"


def test_f02_pre02_raised_at_g08_g09_whoever_releases_and_whether_ai_is_up(page):
    r = ev(page, r"""
      const o = {};
      // B: a gate-critical exception raised after G08 passed.
      const c = H.at('G09');
      const x = ENGINE.raiseManual(c, 'DOC-07', tc, { note: 'IRP5 page 2 missing' }).exception;
      o.b = { blocks: ENGINE.blocksNow(x), pre02: H.openCodes(c).includes('PRE-02'), g09: ENGINE.canRelease(c, 'G09', tc) };
      o.b.rel = ENGINE.release(c, 'G09', tc).ok; o.b.sub = c.submission;
      // D: the AI is down, so the consultant releases G08 by hand after the AI-06 fallback.
      const d = H.at('G06');
      ENGINE.raiseManual(d, 'DOC-07', tc, { note: 'IRP5 page 2 missing' });
      ENGINE.setAiUp(false, ACTOR.platform());
      ENGINE.portal(d, 'approve', { version: ENGINE.vN(d), declaration: true });
      const a6 = ENGINE.exOf(d).find((y) => y.code === 'AI-06' && ENGINE.isOpen(y) && y.gates.includes('G08'));
      if (a6) { ENGINE.recordFallback(a6, tc, { note: 'Manual reconciliation' }); ENGINE.reconcileFallback(a6, tc2, {}); }
      o.d = { cur: ENGINE.currentGate(d), pre02: H.openCodes(d).includes('PRE-02'), g08: ENGINE.release(d, 'G08', tc), g08Status: d.gates.G08.status };
      return o;
    """)
    assert r["b"]["blocks"] and r["b"]["pre02"], ("PRE-02 is raised when G09 is next with DOC-07 open", r["b"])
    assert not r["b"]["g09"]["ok"] and "PRE-02" in r["b"]["g09"]["codes"], r["b"]["g09"]
    assert not r["b"]["rel"] and r["b"]["sub"] is None
    assert r["d"]["cur"] == "G08" and r["d"]["pre02"], ("PRE-02 is raised whether or not the AI is up", r["d"])
    assert not r["d"]["g08"]["ok"] and "PRE-02" in r["d"]["g08"]["codes"] and r["d"]["g08Status"] != "released", r["d"]


def test_f03_open_incident_stops_g18_after_sec_severity_is_lowered(page):
    r = ev(page, r"""
      const o = {};
      const c = H.at('G18'); const t = H.itx(c);
      const x = ENGINE.raiseManual(c, 'SEC-05', io, { note: 'Shared admin login found' }).exception;
      const inc = ENGINE.incById(x.incidentId);
      o.req = ENGINE.setSeverity(x, io, 'S3', { reason: 'Access already narrowed' }).ok;
      o.approve = ENGINE.approveSeverity(x, rc).ok; o.sev = x.sev;
      o.sign = ENGINE.signG18(t, ia); o.sign2 = ENGINE.signG18(t, tc).ok; o.inc = inc.status;
      // A transaction that was ready before the incident opened is not sent either.
      const d = H.at('G18'); const u = H.itx(d); H.sign2(u);
      const y = ENGINE.raiseManual(d, 'SEC-05', io, { note: 'Shared admin login found' }).exception;
      ENGINE.setSeverity(y, io, 'S3', { reason: 'Access already narrowed' }); ENGINE.approveSeverity(y, rc);
      o.tr = ENGINE.transmit(u, ia, 'success').ok; o.dSub = d.submission; o.ySev = y.sev;
      // F2: an S1 SEC code lowered to S4 no longer hard-stops by severity, but its open incident still stops the send. The
      // register rules (review finding R3): lowering the severity never changes Blocking, so SEC-02 stays Blocking Yes.
      const e = H.at('G09');
      const z = ENGINE.raiseManual(e, 'SEC-02', io, { note: 'Possible exposure' }).exception;
      ENGINE.setSeverity(z, io, 'S4', { reason: 'Contained' }); ENGINE.approveSeverity(z, rc);
      o.zSev = [z.sev, z.blocking];
      ENGINE.release(e, 'G09', tc);
      const v = H.itx(e);
      o.f2Sign = v ? ENGINE.signG18(v, ia).ok : null; o.f2Sub = e.submission;
      return o;
    """)
    assert r["req"] and r["approve"] and r["sev"] == "S3", "Lowering a SEC code is still allowed with Records/Compliance Owner approval"
    assert r["inc"] == "open"
    assert not r["sign"]["ok"] and "incident" in r["sign"]["why"].lower() and not r["sign2"], r["sign"]
    assert r["ySev"] == "S3" and not r["tr"] and r["dSub"] is None, "transmit is refused while an incident on the case is open"
    assert r["zSev"] == ["S4", "Yes"], "The register rules: a severity change never alters Blocking (review finding R3)"
    assert r["f2Sign"] is not True and r["f2Sub"] is None, r


def test_f04_da_moved_to_verification_passes_g10_without_a_response(page):
    r = ev(page, r"""
      const c = H.at('G12'); const ref = ENGINE.clientOf(c).taxRef;
      ENGINE.receive({ fn: 'daIn', taxRef: ref, year: c.year, ref: 'DA-9', due: '2026-12-15', date: '2026-11-09' });
      ENGINE.receive({ fn: 'vrfIn', taxRef: ref, year: c.year, ref: 'VRF-9', due: '2026-12-20', date: '2026-11-09' });
      const o = { moved: !!(c.da && c.da.moved), da04: !!H.ex(c, 'DA-04'), vrf01: H.codes(c).includes('VRF-01'), cur: ENGINE.currentGate(c) };
      o.order = (() => { const ids = ENGINE.exOf(c).map((x) => x.code); return ids.indexOf('VRF-01') < ids.indexOf('DA-04'); })();
      o.can = ENGINE.canRelease(c, 'G10', tc);   // no checklist ticks: G10's items are not required once the DA moved
      o.rel = ENGINE.release(c, 'G10', tc).ok;
      o.done = ENGINE.stepDone(c, 'G10'); o.da01 = H.ex(c, 'DA-01').status;
      o.daTx = S.txs.filter((t) => t.caseId === c.id && t.fn === 'da').length; o.cur2 = ENGINE.currentGate(c);
      S.policy.warnDays = 1000; ENGINE.watch();
      o.da05 = H.codes(c).includes('DA-05');
      return o;
    """)
    assert r["moved"] and r["da04"] and r["vrf01"] and r["order"], ("vrfIn on an unanswered DA sets da.moved and raises DA-04 after VRF-01", r)
    assert r["cur"] == "G10"
    assert r["can"]["ok"], r["can"]
    assert r["rel"] and r["done"] and r["daTx"] == 0, ("G10 passes without a Declaration response transaction", r)
    assert r["da01"] == "closed" and r["cur2"] == "G11", r
    assert not r["da05"], "No DA-05 deadline warning for a Declaration Questionnaire SARS moved to verification"


def test_f05_superseding_rework_reopens_g06_and_reapproval_releases_it(page):
    r = ev(page, r"""
      const c = H.at('G18');
      const rw = ENGINE.returnForRework(c, tc, 'final-checks', 'Check disclosure wording');
      const o = { rw: rw.ok, g06: c.gates.G06.status, cur: ENGINE.currentGate(c), sup: c.approval.superseded };
      const ap = ENGINE.portal(c, 'approve', { version: ENGINE.vN(c), declaration: true });
      o.ap = [ap.ok, ap.why]; o.g06After = [c.gates.G06.status, c.approval.superseded];
      // The frozen version was returned, so VER-01 holds G07 until the consultant resolves it; then the chain continues.
      o.ver01 = ENGINE.resolve(H.ex(c, 'VER-01'), tc, { action: 'Version re-approved by the client' }).ok;
      o.after = [c.gates.G07.status, ENGINE.currentGate(c)];
      o.refusedG06 = S.audit.some((a) => a.caseId === c.id && a.result === 'Refused' && a.gate === 'G06');
      // A released G06 whose approval is no longer valid is re-opened by the fresh portal approval.
      const e = H.at('G09');
      e.approval.superseded = true;
      const ap2 = ENGINE.portal(e, 'approve', { version: ENGINE.vN(e), declaration: true });
      o.ap2 = [ap2.ok, ap2.why, e.gates.G06.status, e.approval.superseded, ENGINE.approvalProblem(e)];
      return o;
    """)
    assert r["rw"] and r["sup"] and r["g06"] == "invalidated" and r["cur"] == "G06", ("Superseding the approval re-opens from G06", r)
    assert r["ap"] == [True, ""], r["ap"]
    assert r["g06After"] == ["released", False], r["g06After"]
    assert r["ver01"] and r["after"][0] == "released" and r["after"][1] in ("G08", "G09"), r["after"]
    assert not r["refusedG06"]
    assert r["ap2"][:4] == [True, "", "released", False] and r["ap2"][4] is None, r["ap2"]


def test_f06_reject_or_withhold_after_approval_is_a_withdrawal(page):
    r = ev(page, r"""
      const o = {};
      const clt = (c) => H.openCodes(c).filter((k) => k.startsWith('CLT'));
      const approve = (c) => ENGINE.portal(c, 'approve', { version: ENGINE.vN(c), declaration: true }).ok;
      // withhold after approving: a withdrawal (CLT-06) that re-opens G06
      const c = H.at('G09');
      const w = ENGINE.portal(c, 'withhold', { reason: 'Not happy to submit yet' });
      const x6 = H.ex(c, 'CLT-06');
      o.withhold = [w.ok, clt(c), c.gates.G06.status, !!ENGINE.approvalProblem(c), ENGINE.canRelease(c, 'G09', tc).ok];
      o.withholdResolve = [ENGINE.resolve(x6, ACTOR.client(c.clientId), { action: 'ok' }).ok, ENGINE.resolve(x6, tc, { action: 'Spoke to client' }).ok];
      o.withholdApprove = approve(c); o.x6 = x6.status;
      // reject after approving: the withdrawal path with CLT-02
      const d = H.at('G09');
      ENGINE.portal(d, 'reject', { reason: 'The numbers are wrong' });
      const x2 = H.ex(d, 'CLT-02');
      o.reject = [clt(d), d.gates.G06.status, ENGINE.canRelease(d, 'G09', tc).ok];
      // CLT-02 belongs to the Tax Consultant (register; review finding R4): re-approving alone does not clear it.
      o.rejectApproveFirst = approve(d);
      o.rejectResolve = [ENGINE.resolve(x2, ACTOR.client(d.clientId), { action: 'ok' }).ok, ENGINE.resolve(x2, ad, { action: 'ok' }).ok,
                         ENGINE.resolverCheck(x2, ACTOR.client(d.clientId)), ENGINE.resolverCheck(x2, ad),
                         ENGINE.resolve(x2, tc, { action: 'Concern investigated with the client: the figures stand, no revised pack needed' }).ok];
      o.rejectApprove = approve(d); o.x2 = x2.status;
      // at G18 (finding 46)
      const g = H.at('G18'); const t = H.itx(g);
      ENGINE.portal(g, 'withhold', { reason: 'Not yet' });
      o.g18 = [clt(g), g.gates.G06.status, t.status];
      o.g18Approve = approve(g);
      // without an approval they raise CLT-04 / CLT-02 as before
      const e = H.at('G06'); const f = H.at('G06');
      o.noApproval = [ENGINE.portal(e, 'withhold', { reason: 'x' }).exception.code, ENGINE.portal(f, 'reject', { reason: 'x' }).exception.code];
      return o;
    """)
    assert r["withhold"][:2] == [True, ["CLT-06"]] and r["withhold"][2] == "invalidated" and r["withhold"][3], r["withhold"]
    assert not r["withhold"][4], "G09 cannot release over a withheld authority"
    assert r["withholdResolve"] == [False, False], "PORTAL_ONLY codes are not resolved by ENGINE.resolve, whoever calls it"
    assert r["withholdApprove"] and r["x6"] in ("resolved", "closed"), "A fresh portal approval clears the withdrawal"
    assert r["reject"] == [["CLT-02"], "invalidated", False], r["reject"]
    assert not r["rejectApproveFirst"], "CLT-02 blocks G06 until its owner, the Tax Consultant, resolves it (review finding R4)"
    assert r["rejectResolve"][:2] == [False, False] and r["rejectResolve"][2] and r["rejectResolve"][3], r["rejectResolve"]
    assert r["rejectResolve"][4], "The Tax Consultant resolves CLT-02 with the investigation record"
    assert r["rejectApprove"] and r["x2"] in ("resolved", "closed")
    assert r["g18"] == [["CLT-06"], "invalidated", "cancelled"], r["g18"]
    assert r["g18Approve"]
    assert r["noApproval"] == ["CLT-04", "CLT-02"]


def test_f07_stale_severity_lowering_request_lapses(page):
    r = ev(page, r"""
      const c = H.at('G05');
      const x = ENGINE.raiseManual(c, 'TAX-01', tc, { note: 'calc error' }).exception;   // S2
      const o = { req: ENGINE.setSeverity(x, tc, 'S3', { reason: 'Minor rounding' }), from: x.sevRequest && x.sevRequest.from };
      o.aiRaise = ENGINE.setSeverity(x, ai, 'S1', { reason: 'Error is material' }).ok;
      o.rq = x.sevRequest.status;
      o.approve = ENGINE.approveSeverity(x, rc).ok; o.sev = x.sev;
      // A request approved after the severity moved by itself is refused and lapses.
      const y = ENGINE.raiseManual(c, 'TAX-01', tc, { note: 'second' }).exception;
      ENGINE.setSeverity(y, tc, 'S3', { reason: 'Minor' });
      y.sev = 'S1';   // moved outside setSeverity: approveSeverity must still compare with the request's `from`
      o.stale = ENGINE.approveSeverity(y, rc).ok; o.ySev = y.sev; o.yRq = y.sevRequest.status;
      return o;
    """)
    assert r["req"]["ok"] and r["req"].get("pending") and r["from"] == "S2"
    assert r["aiRaise"] and r["rq"] != "pending", "Any other severity change lapses a pending lowering request"
    assert not r["approve"] and r["sev"] == "S1", "A stale S2->S3 request never lowers an S1"
    assert not r["stale"] and r["ySev"] == "S1" and r["yRq"] == "lapsed", r


def test_f08_by_gate_code_raised_to_s1_does_not_block_its_own_gate(page):
    r = ev(page, r"""
      const c = H.at('G12');
      ENGINE.receive({ fn: 'daIn', taxRef: ENGINE.clientOf(c).taxRef, year: c.year, ref: 'DA-1', due: '2026-12-15', date: '2026-11-09' });
      const x = H.ex(c, 'DA-01');
      ['draft', 'support'].forEach((k) => ENGINE.markReq(c, 'G10', k, tc));
      const o = { raise: ENGINE.setSeverity(x, ai, 'S1', { reason: 'material' }).ok, sev: x.sev };
      o.g10 = ENGINE.canRelease(c, 'G10', tc); o.other = H.blk(c, 'G13').includes('DA-01');
      return o;
    """)
    assert r["raise"] and r["sev"] == "S1"
    assert r["g10"]["ok"] and "DA-01" not in r["g10"]["codes"], ("An S1 BY_GATE code does not block its own gate", r["g10"])
    assert r["other"], "It still hard-stops the other gates"


def test_f09_sars_work_on_an_archived_case_reopens_g16(page):
    r = ev(page, r"""
      const c = H.at('G16');
      const days = H.daysTo(c.retention.review) + 1;
      return H.withClock(days, () => {
        ENGINE.watch();
        const o = { ret03: ENGINE.resolve(H.ex(c, 'RET-03'), rc, { action: 'Retention reviewed; no hold' }).ok };
        o.g16 = ENGINE.release(c, 'G16', rc).ok; o.archived = c.archived;
        const due = DATES.iso(DATES.addBusinessDays(DATES.fromLocal(now()), 5));
        ENGINE.receive({ fn: 'vrfIn', taxRef: ENGINE.clientOf(c).taxRef, year: c.year, ref: 'VRF-LATE', due });
        o.after = [c.gates.G16.status, c.archived, ENGINE.columnOf(c), ENGINE.currentGate(c)];
        ENGINE.watch();
        o.vrf03 = H.codes(c).includes('VRF-03');
        return o;
      });
    """)
    assert r["ret03"] and r["g16"] and r["archived"]
    assert r["after"][0] == "invalidated" and r["after"][1] is False and r["after"][2] != "closed" and r["after"][3] == "G11", r["after"]
    assert r["vrf03"], "The verification deadline is watched again once the case is back from the archive"


def test_f10_g16_lists_open_incidents(page):
    r = ev(page, r"""
      const c = H.at('G16');
      const x = ENGINE.raiseManual(c, 'SEC-07', io, { note: 'Data used outside its purpose' }).exception;
      const inc = ENGINE.incById(x.incidentId);
      const days = H.daysTo(c.retention.review) + 1;
      return H.withClock(days, () => {
        ENGINE.watch();
        ENGINE.resolve(H.ex(c, 'RET-03'), rc, { action: 'Retention reviewed' });
        const o = { crit: ENGINE.criteria(c, 'G16'), can: ENGINE.canRelease(c, 'G16', rc).ok, rel: ENGINE.release(c, 'G16', rc).ok, archived: c.archived, id: inc.id };
        ['containment', 'investigation', 'remediation', 'notification'].forEach((s) => ENGINE.incidentStep(inc, s, io, { note: s + ' done' }));
        o.close = ENGINE.closeIncident(inc, io).ok;
        o.after = ENGINE.release(c, 'G16', rc).ok;
        return o;
      });
    """)
    assert any(r["id"] in m and "open" in m for m in r["crit"]), r["crit"]
    assert not r["can"] and not r["rel"] and not r["archived"], "G16 does not archive a case with an open incident"
    assert r["close"] and r["after"]


def test_f11_ai_gate_routes_when_an_item_is_held(page):
    r = ev(page, r"""
      const c = H.at('G04'); const cl = ACTOR.client(c.clientId);
      ENGINE.upload(c, 'I1', { name: 'IRP5_2026_scan.pdf', size: 245760 }, cl);
      ENGINE.upload(c, 'I2', { name: 'Medical_scheme_certificate_2026.pdf', size: 245760 }, cl);
      return { items: c.items.map((it) => ENGINE.itemState(c, it)), cur: ENGINE.currentGate(c), routed: c.gates.G04.routed,
               audit: S.audit.filter((a) => a.caseId === c.id && a.gate === 'G04' && a.result === 'Routed').length };
    """)
    assert r["items"] == ["held", "validated"] and r["cur"] == "G04"
    assert r["routed"] and r["audit"] == 1, ("G04 routes to the consultant when only exceptions hold it", r)


# ---------------------------------------------------------------------------------------------------------------------------
# SARS link (#12-#26)
# ---------------------------------------------------------------------------------------------------------------------------

def test_f12_request_tx_checks_the_gate_first_and_manual_fallback_needs_g18(page):
    r = ev(page, r"""
      const o = {};
      const c = H.mk();
      const rq = ENGINE.requestTx(c, 'payment', ia);
      o.rq = [rq.ok, H.codes(c), S.txs.filter((t) => t.caseId === c.id).length];
      // The approved alternative-channel path for a payment arrangement.
      const d = H.at('G14');
      ENGINE.portal(d, 'decide', { choice: 'instruct', note: 'Cannot pay at once' });
      o.choose = ENGINE.chooseRemedy(d, tc, 'payment', { evidence: 'Cash-flow statement' }).ok;
      ENGINE.portal(d, 'authorise');
      o.g15 = ENGINE.release(d, 'G15', tc).ok;
      const t = S.txs.filter((x) => x.caseId === d.id && x.fn === 'payment').pop();
      o.t = t && t.status;
      o.other = ENGINE.requestTx(d, 'objection', ia);   // a remedy function other than the chosen route
      o.otherTx = S.txs.filter((x) => x.caseId === d.id && x.fn === 'objection').length;
      o.early = ENGINE.manualFallback(t, tc, { ref: 'MAN-PAY-0' }).ok;   // INT-08 not yet approved
      o.res8 = ENGINE.resolve(H.ex(d, 'INT-08'), ia, { action: 'Alternative manual channel approved' }).ok;
      ENGINE.setLink({ auth: false }, ia);
      o.authDown = ENGINE.manualFallback(t, tc, { ref: 'MAN-PAY-1' });
      ENGINE.setLink({ auth: true }, ia);
      const mf = ENGINE.manualFallback(t, tc, { ref: 'MAN-PAY-2' });
      o.mf = [mf.ok, t.status];
      if (mf.ok) { o.rec = ENGINE.reconcileFallback(mf.exception, tc2, {}).ok; o.final = t.status; }
      return o;
    """)
    assert not r["rq"][0] and "INT-11" in r["rq"][1] and "INT-08" not in r["rq"][1] and r["rq"][2] == 0, (
        "requestTx checks the substantive gate (INT-11) before INT-08", r["rq"])
    assert r["choose"] and r["g15"] and r["t"] == "blocked"
    assert not r["other"]["ok"] and "remedy route" in r["other"]["why"] and r["otherTx"] == 0, r["other"]
    assert not r["early"] and r["res8"]
    assert not r["authDown"]["ok"] and "3" in r["authDown"]["why"], ("manualFallback runs the G18 checks", r["authDown"])
    assert r["mf"] == [True, "manual"] and r["rec"] and r["final"] == "success", r


def test_f13_int05_catches_a_second_identical_remedy_filing(page):
    r = ev(page, r"""
      const c = H.at('G16', {}, {}, { decision: 'instruct', route: 'objection' });
      const q = ENGINE.requestTx(c, 'objection', ia);
      const o = { q: q.ok };
      if (q.ok) { o.hashSame = S.txs.filter((t) => t.caseId === c.id && t.fn === 'objection').every((t) => t.hash === q.tx.hash);
                  H.sign2(q.tx); o.tr = ENGINE.transmit(q.tx, ia, 'success'); o.status = q.tx.status; }
      o.int05 = H.ex(c, 'INT-05') && H.ex(c, 'INT-05').sev;
      o.successes = S.txs.filter((t) => t.caseId === c.id && t.fn === 'objection' && t.status === 'success').length;
      return o;
    """)
    assert r["successes"] == 1, ("A second identical objection must not be filed", r)
    assert r["q"] and r["hashSame"], "The hash covers the payload, not the transaction id"
    assert not r["tr"]["ok"] and "INT-05" in r["tr"]["why"] and r["int05"] == "S1", r


def test_f14_fallback_cannot_be_re_recorded_or_reconciled_by_the_filer(page):
    r = ev(page, r"""
      const o = {};
      // Finding 48: re-recording after reconciliation.
      const c = H.mk();
      const x = ENGINE.raiseManual(c, 'AI-06', tc, { gate: 'G01', note: 'AI down' }).exception;
      ENGINE.recordFallback(x, tc, { note: 'Manual check A' }); ENGINE.reconcileFallback(x, tc2, { note: 'agree with A' });
      o.rerecord = ENGINE.recordFallback(x, tc2, { note: 'Manual check B (changed)' }).ok;
      o.x = [x.fallback.recorded.by, x.fallback.recorded.note, x.fallback.reconciled.by];
      // Finding 14: the person who made the manual ITR12 filing cannot become its reconciler.
      const d = H.at('G18'); const t = H.itx(d); H.sign2(t);
      ENGINE.setLink({ up: false }, ia); ENGINE.transmit(t, ia, 'success');
      const mf = ENGINE.manualFallback(t, tc, { ref: 'EF-MANUAL-1' });
      o.mf = mf.ok;
      o.overwrite = ENGINE.recordFallback(mf.exception, ad, { note: 'noted' }).ok;
      o.recordedBy = mf.exception.fallback.recorded.by;
      o.self = ENGINE.reconcileFallback(mf.exception, tc, {}).ok; o.status = t.status;
      ENGINE.setLink({ up: true }, ia);
      return o;
    """)
    assert not r["rerecord"] and r["x"] == ["TC1", "Manual check A", "TC2"], r
    assert r["mf"] and not r["overwrite"] and r["recordedBy"] == "TC1", r
    assert not r["self"] and r["status"] == "manual", "The filer cannot reconcile their own manual filing"


def test_f15_no_change_or_rework_while_the_itr12_is_in_flight(page):
    r = ev(page, r"""
      const out = {};
      for (const mode of ['unknown', 'no-response', 'manual']) {
        const c = H.at('G18'); const t = H.itx(c); H.sign2(t);
        if (mode === 'manual') { ENGINE.setLink({ up: false }, ia); ENGINE.transmit(t, ia, 'success'); ENGINE.manualFallback(t, tc, { ref: 'M-1' }); ENGINE.setLink({ up: true }, ia); }
        else ENGINE.transmit(t, ia, mode);
        const d = ENGINE.stubData(c); d.calc.summary.normalTax = 5000;
        const ch = ENGINE.change(c, tc, d, { reason: 'Late change' });
        const rw = ENGINE.returnForRework(c, tc, 'calculation', 'Late change');
        out[mode] = { status: t.status, ch: ch.ok, rw: rw.ok, v: ENGINE.vN(c), g09: c.gates.G09.status, sup: c.approval.superseded };
      }
      return out;
    """)
    for mode, o in r.items():
        assert o["status"] == mode, (mode, o)
        assert not o["ch"] and not o["rw"], (mode, "change() and returnForRework() are refused while the ITR12 is in flight", o)
        assert o["v"] == 1 and o["g09"] == "released" and o["sup"] is False, (mode, o)


def test_f16_withdrawal_while_manual_filing_awaits_reconciliation_is_held(page):
    r = ev(page, r"""
      const manual = (c) => {
        const t = H.itx(c); H.sign2(t);
        ENGINE.setLink({ up: false }, ia); ENGINE.transmit(t, ia, 'success');
        const mf = ENGINE.manualFallback(t, tc, { ref: 'EF-M-' + c.id }); ENGINE.setLink({ up: true }, ia);
        return [t, mf];
      };
      const c = H.at('G18'); const [t, mf] = manual(c);
      const w = ENGINE.portal(c, 'withdraw', { reason: 'Changed my mind' });
      const o = { w: [mf.ok, w.ok, t.status, H.codes(c).includes('CLT-06'), c.gates.G06.status] };
      const rr = ENGINE.reconcileFallback(mf.exception, tc2, {});
      o.after = [rr.ok, t.status, !!(c.submission && c.submission.ok), H.openCodes(c).includes('CLT-06'), H.codes(c).includes('SUB-05'), c.gates.G06.status, ENGINE.currentGate(c)];
      // An instruction received before the manual filing: SUB-05 once the filing is reconciled.
      // Approved on day 0; the manual filing is made the next day, a minute after the client's email.
      const d = H.at('G18');
      H.withClock(1, () => {
        const [u, mf2] = manual(d);
        const rec = ENGINE.recordWithdrawal(d, tc, { receivedAt: new Date(u.manual.at.getTime() - 60000).toISOString(), reason: 'Emailed before the filing', channel: 'email' });
        o.rec = [rec.ok, H.codes(d).includes('CLT-06'), d.gates.G06.status];
        ENGINE.reconcileFallback(mf2.exception, tc2, {});
        o.sub05 = [u.status, H.openCodes(d).includes('SUB-05')];
      });
      return o;
    """)
    assert r["w"] == [True, True, "manual", False, "released"], ("A withdrawal during a manual filing is held", r["w"])
    assert r["after"][:6] == [True, "success", True, False, False, "released"] and r["after"][6] != "G06", r["after"]
    assert r["rec"] == [True, False, "released"], r["rec"]
    assert r["sub05"] == ["success", True], "Reconciliation applies the SUB-05 rule"


def test_f17_decide_again_after_g14_keeps_the_recorded_decision(page):
    r = ev(page, r"""
      const c = H.at('G15', {}, {}, { decision: 'instruct' });
      const before = c.decision && c.decision.choice;
      const d = ENGINE.portal(c, 'decide', { choice: 'accept' });
      return { before, ok: d.ok, g14: c.gates.G14.status, after: c.decision && c.decision.choice };
    """)
    assert r["before"] == "instruct" and not r["ok"] and r["g14"] == "released"
    assert r["after"] == "instruct", "A refused second decision leaves the recorded decision unchanged"


def test_f18_remedy_authority_must_match_the_route(page):
    r = ev(page, r"""
      const o = {};
      // Finding 18: authority for reasons does not carry an appeal.
      const c = H.at('G15', {}, {}, { decision: 'instruct' });
      ENGINE.chooseRemedy(c, tc, 'reasons', { evidence: 'Grounds' }); ENGINE.portal(c, 'authorise');
      o.g15 = ENGINE.release(c, 'G15', tc).ok;
      const ap = ENGINE.requestTx(c, 'appeal', ia);
      o.appeal = [ap.ok, S.txs.filter((t) => t.caseId === c.id && t.fn === 'appeal').length];
      // Finding 43: switching to payment after G15 passed for an objection.
      const d = H.at('G14');
      ENGINE.portal(d, 'decide', { choice: 'instruct', note: 'Disagree' });
      ENGINE.chooseRemedy(d, tc, 'objection', { evidence: 'Grounds on file' }); ENGINE.portal(d, 'authorise');
      ENGINE.release(d, 'G15', tc);
      const obj = S.txs.filter((x) => x.caseId === d.id && x.fn === 'objection').pop();
      o.obj0 = obj.status;
      ENGINE.chooseRemedy(d, tc, 'payment', { evidence: 'Pay instead' });
      o.switched = [d.gates.G15.status, obj.status, ENGINE.criteria(d, 'G15').some((m) => /authorised/.test(m))];
      ENGINE.portal(d, 'authorise');
      o.check4 = ENGINE.g18Checks(obj)[3];
      o.sign = [ENGINE.signG18(obj, ia).ok, ENGINE.signG18(obj, tc).ok];
      o.sent = ENGINE.transmit(obj, ia, 'success').ok;
      o.holds = d.retention.holds.length;
      return o;
    """)
    assert r["g15"] and r["appeal"] == [False, 0], ("requestTx refuses a remedy function other than the chosen route", r)
    assert r["obj0"] == "awaiting G18"
    assert r["switched"] == ["invalidated", "cancelled", True], ("A new route after G15 re-opens G15 and cancels the queued transaction", r["switched"])
    assert not r["check4"]["ok"], ("Check 4 needs the remedy route and its authority to match the transaction", r["check4"])
    assert r["sign"] == [False, False] and not r["sent"] and r["holds"] == 0


def test_f19_routing_resolves_only_the_int14_of_that_item(page):
    r = ev(page, r"""
      const cl = ENGINE.newClient({ name: 'Late case', taxRef: '9555000001' });
      const a = ENGINE.receive({ fn: 'notice', taxRef: '9555000001', year: 2026, ref: 'LTR-1', date: '2026-11-09' });
      const b = ENGINE.receive({ fn: 'notice', taxRef: '9555000001', year: 2026, ref: 'LTR-12', date: '2026-11-09' });
      const c = ENGINE.newCase(cl);
      const xa = S.exceptions.find((x) => x.code === 'INT-14' && x.inboundId === a.id);
      const xb = S.exceptions.find((x) => x.code === 'INT-14' && x.inboundId === b.id);
      const rt = ENGINE.routeInbound(a, c.id, ia);
      return { rt: rt.ok, a: a.status, b: b.status, xa: xa && ENGINE.isOpen(xa), xb: xb && ENGINE.isOpen(xb), both: !!(xa && xb) };
    """)
    assert r["both"] and r["rt"] and r["a"] == "routed" and r["b"] == "unrouted"
    assert r["xa"] is False and r["xb"] is True, ("Only the INT-14 raised for the routed item is resolved", r)


def test_f20_routing_refuses_another_taxpayer_or_year(page):
    r = ev(page, r"""
      const c = H.at('G12'); const ref = ENGINE.clientOf(c).taxRef;
      const other = ENGINE.receive({ fn: 'ita34', taxRef: '7777777777', year: 2024, ref: 'ITA34-OTHER', date: '2026-11-09', data: { taxableIncome: 999999 } });
      const year = ENGINE.receive({ fn: 'ita34', taxRef: ref, year: 2024, ref: 'ITA34-2024', date: '2026-11-09', data: c.calc.summary });
      return { other: ENGINE.routeInbound(other, c.id, ia).ok, year: ENGINE.routeInbound(year, c.id, ia).ok, ita34: c.ita34, st: [other.status, year.status] };
    """)
    assert not r["other"] and not r["year"], "routeInbound refuses an item whose tax reference or year differ from the case"
    assert r["ita34"] is None and r["st"] == ["unrouted", "unrouted"]


def test_f21_ita34_before_submission_is_not_used_for_g12(page):
    r = ev(page, r"""
      const c = H.at('G06');
      ENGINE.receive({ fn: 'ita34', taxRef: ENGINE.clientOf(c).taxRef, year: c.year, ref: 'AUTO-ASSESS', date: '2026-11-09', data: c.calc.summary });
      const o = { ita34: c.ita34, notice: c.notices.some((n) => n.ref === 'AUTO-ASSESS') };
      o.dr = ENGINE.drive(c, 'G13').ok;
      o.after = [c.gates.G12.status, c.ita34 && c.ita34.ref, c.submission && !!c.submission.ref];
      return o;
    """)
    assert r["ita34"] is None and r["notice"], "An ITA34 that arrives before the submission is kept as a notice"
    assert r["dr"] and r["after"][0] == "released" and r["after"][1] != "AUTO-ASSESS" and r["after"][2], r["after"]


def test_f22_outside_edit_after_sign_off_is_not_sent(page):
    r = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c); H.sign2(t);
      ENGINE.outsideEdit(c, { itr12: { taxRef: '1111111111', tampered: true } });
      const tr = ENGINE.transmit(t, ia, 'success');
      const o = { tr: tr.ok, status: t.status, sub: c.submission, ver02: H.openCodes(c).includes('VER-02') };
      o.check5 = ENGINE.g18Checks(t)[4].ok;
      // Before the sign-off: signG18 settles first, so the edit is found before anyone signs.
      const d = H.at('G18'); const u = H.itx(d);
      ENGINE.outsideEdit(d, { itr12: { tampered: true } });
      o.sign = ENGINE.signG18(u, ia).ok; o.dVer02 = H.openCodes(d).includes('VER-02'); o.signoffs = u.signoffs.length;
      return o;
    """)
    assert not r["tr"] and r["sub"] is None and r["status"] == "ready" and r["ver02"], ("transmit settles first: VER-02 before anything is sent", r)
    assert not r["check5"], "Check 5 compares the live ITR12 with the transaction hash"
    assert not r["sign"] and r["dVer02"] and r["signoffs"] == 0


def test_f24_portal_withdrawal_time_is_now(page):
    r = ev(page, r"""
      const o = {};
      const c = H.at('G16');
      const w = ENGINE.portal(c, 'withdraw', { at: '2020-01-01T00:00:00Z', reason: 'backdated' });
      o.c = [w.ok, H.codes(c).includes('SUB-05'), S.incidents.filter((i) => i.caseId === c.id).length, c.approval.withdrawn.at >= c.submission.at];
      const d = H.at('G09');
      ENGINE.portal(d, 'withdraw', { at: 'not a date', reason: 'x' });
      const wa = d.approval.withdrawn.at;
      o.d = [wa instanceof Date && !isNaN(wa.getTime())];
      // Approved on day 0, filed the next day; the phone call came a minute before the filing.
      const e = H.at('G18');
      H.withClock(1, () => {
        const t = H.itx(e); H.sign2(t); ENGINE.transmit(t, H.ia, 'success');
        const before = new Date(e.submission.at.getTime() - 60000).toISOString();
        o.future = ENGINE.recordWithdrawal(e, tc, { receivedAt: new Date(now().getTime() + 3600e3).toISOString(), reason: 'x' }).ok;
        o.client = ENGINE.recordWithdrawal(e, ACTOR.client(e.clientId), { receivedAt: before, reason: 'x' }).ok;
        o.predates = ENGINE.recordWithdrawal(e, ad, { receivedAt: new Date(e.approval.at.getTime() - 60000).toISOString(), reason: 'Older than the approval' }).ok;
        o.admin = ENGINE.recordWithdrawal(e, ad, { receivedAt: before, reason: 'Phoned before the filing', channel: 'phone' }).ok;
        o.sub05 = H.openCodes(e).includes('SUB-05');
      });
      return o;
    """)
    assert r["c"] == [True, False, 0, True], ("The portal ignores a client-supplied time", r["c"])
    assert r["d"] == [True]
    assert not r["future"] and not r["client"], "recordWithdrawal is staff-only and refuses a time in the future"
    assert not r["predates"], "A withdrawal cannot predate the approval it withdraws"
    assert r["admin"] and r["sub05"], "A withdrawal recorded by staff strictly before the submission raises SUB-05"


def test_f25_objection_after_reasons_runs_from_the_reasons_outcome(page):
    want = iso(add_biz(date(2026, 12, 1), 80, ch9=True))
    r = ev(page, r"""
      const c = H.at('G16', {}, {}, { decision: 'instruct', route: 'reasons' });
      ENGINE.receive({ fn: 'outcome', taxRef: ENGINE.clientOf(c).taxRef, year: c.year, ref: 'REASONS-1', date: '2026-12-01', data: { kind: 'reasons' } });
      const dr = ENGINE.drive(c, 'G15', { decision: 'instruct', decisionNote: 'Disagree' });
      const ch = ENGINE.chooseRemedy(c, tc, 'objection', { evidence: 'Grounds' });
      return { dr: dr.ok, ch: ch.ok, from: c.remedy && c.remedy.from, basis: c.remedy && c.remedy.basis, deadline: c.remedy && c.remedy.deadline };
    """)
    assert r["dr"] and r["ch"]
    assert r["from"] == "2026-12-01" and "reasons" in (r["basis"] or ""), r
    assert r["deadline"] == want, (r["deadline"], want)


def test_f26_transmit_refuses_an_unknown_outcome(page):
    r = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c); H.sign2(t);
      const bad = ENGINE.transmit(t, ia, 'timeout');
      const o = { bad: bad.ok, status: t.status, attempts: t.attempts.length, sent: S.audit.filter((a) => a.caseId === c.id && a.result === 'Sent').length };
      o.ok = ENGINE.transmit(t, ia, 'success').ok; o.attempts2 = t.attempts.length;
      return o;
    """)
    assert not r["bad"] and r["status"] == "ready" and r["attempts"] == 0 and r["sent"] == 0, r
    assert r["ok"] and r["attempts2"] == 1


# ---------------------------------------------------------------------------------------------------------------------------
# Dates, retention, incidents and audit (#27-#37)
# ---------------------------------------------------------------------------------------------------------------------------

def test_f27_sec_code_waits_for_its_incident(page):
    r = ev(page, r"""
      const c = H.at('G09');
      const x = ENGINE.raiseManual(c, 'SEC-01', tc, { note: 'Possible breach' }).exception;
      const inc = ENGINE.incById(x.incidentId);
      const res = ENGINE.resolve(x, io, { action: 'Looked at it' });
      const o = { res: [res.ok, res.why], status: x.status, g09: ENGINE.release(c, 'G09', tc).ok };
      ['containment', 'investigation', 'remediation', 'notification'].forEach((s) => ENGINE.incidentStep(inc, s, io, { note: s + ' done' }));
      o.close = ENGINE.closeIncident(inc, io).ok; o.after = x.status;
      o.g09After = ENGINE.release(c, 'G09', tc).ok;
      return o;
    """)
    assert not r["res"][0] and "incident" in r["res"][1].lower(), r["res"]
    assert r["status"] not in ("resolved", "closed") and not r["g09"], "The S1 stop holds until the incident is closed"
    assert r["close"] and r["after"] in ("resolved", "closed") and r["g09After"]


def test_f28_bad_dates_are_dropped_and_watch_isolates_each_case(page):
    r = ev(page, r"""
      const bad = H.mk(); bad.reminders = null;   // a case that makes watchCase throw
      const c = H.at('G12');
      const e = H.mk({ provisional: false });
      const it = ENGINE.receive({ fn: 'daIn', taxRef: ENGINE.clientOf(c).taxRef, year: c.year, ref: 'DA-BAD', due: '2026-12-1', date: '2026-13-45' });
      const o = { due: c.da.due, date: it.date, logged: S.audit.some((a) => /unreadable date/i.test(a.text)) };
      c.da.due = '2026-12-1';   // even if one reaches the case, the ticker skips it
      const errs0 = S.watchErrors || 0;
      try { ENGINE.watch(); o.w = 'ok'; } catch (err) { o.w = 'threw ' + err.message; }
      o.errs = (S.watchErrors || 0) - errs0; o.pre04 = H.codes(e).includes('PRE-04'); o.da05 = H.codes(c).includes('DA-05');
      bad.reminders = [];
      // The unreadable dates stay empty and INT-15 asks for them; once confirmed from the notice and reconciled by someone else, it clears.
      o.int15 = H.openCodes(c).includes('INT-15');
      const conf = ENGINE.confirmInboundDate(it, ia, { date: '2026-11-09', due: '2026-12-01' });
      const x15 = S.exceptions.find((x) => x.code === 'INT-15' && x.inboundId === it.id);
      const rec15 = ENGINE.reconcileFallback(x15, tc, {});
      o.confirmed = [conf.ok, it.date, c.da.due, rec15.ok, ENGINE.isOpen(x15)];
      return o;
    """)
    assert r["due"] is None and r["logged"], ("receive() keeps an unreadable due date empty and flags it", r)
    assert r["date"] is None and r["int15"], ("An unreadable SARS date is never replaced with today; INT-15 asks for it", r)
    assert r["confirmed"] == [True, "2026-11-09", "2026-12-01", True, False], r["confirmed"]
    assert r["w"] == "ok" and r["errs"] >= 1, r
    assert r["pre04"], "A failing case does not stop the deadline checks for the cases after it"
    assert not r["da05"]


def test_f29_answered_reminder_never_raises_clt05_or_clt01(page):
    r = ev(page, r"""
      const c = H.at('G06');
      ENGINE.remind(c, 'approval', ad);
      ENGINE.drive(c, 'G09');
      H.withClock(8, () => ENGINE.watch());
      const o = { g06: c.gates.G06.status, clt05: H.codes(c).includes('CLT-05'), rem: c.reminders.map((x) => x.status) };
      const k = H.mk({ kyc: { address: false } });
      ENGINE.remind(k, 'onboarding', ad);
      ENGINE.setKyc(ENGINE.clientOf(k), 'address', true, ad);
      o.g01 = ENGINE.release(k, 'G01', ad).ok;
      H.withClock(15, () => ENGINE.watch());
      o.clt01 = H.codes(k).includes('CLT-01'); o.rem2 = k.reminders.map((x) => x.status);
      return o;
    """)
    assert r["g06"] == "released" and not r["clt05"] and r["rem"] == ["answered"], r
    assert r["g01"] and not r["clt01"] and r["rem2"] == ["answered"], r


def test_f31_appeal_needs_an_objection_outcome(page):
    want = iso(add_biz(date(2026, 12, 1), 30, ch9=True))
    r = ev(page, r"""
      const c = H.at('G14');
      ENGINE.portal(c, 'decide', { choice: 'instruct', note: 'x' });
      const ra = ENGINE.chooseRemedy(c, tc, 'appeal', { evidence: 'Grounds' });
      const o = { ra: ra.ok, remedy: c.remedy };
      const d = H.at('G16', {}, {}, { decision: 'instruct', route: 'objection' });
      ENGINE.receive({ fn: 'outcome', taxRef: ENGINE.clientOf(d).taxRef, year: d.year, ref: 'RULE9-1', date: '2026-12-01' });
      o.dr = ENGINE.drive(d, 'G15', { decision: 'instruct', decisionNote: 'Objection disallowed' }).ok;
      const rb = ENGINE.chooseRemedy(d, tc, 'appeal', { evidence: 'Grounds of appeal' });
      o.rb = rb.ok; o.from = d.remedy && d.remedy.from; o.deadline = d.remedy && d.remedy.deadline;
      return o;
    """)
    assert not r["ra"] and r["remedy"] is None, "No appeal without an objection and its rule 9 outcome"
    assert r["dr"] and r["rb"] and r["from"] == "2026-12-01" and r["deadline"] == want, (r, want)


def test_f32_ret_codes_cannot_be_resolved_while_their_hold_is_active(page):
    r = ev(page, r"""
      const c = H.at('G12');
      ENGINE.receive({ fn: 'vrfIn', taxRef: ENGINE.clientOf(c).taxRef, year: c.year, ref: 'VR-32', due: '2027-06-30', date: '2026-11-09' });
      ENGINE.drive(c);
      ENGINE.legalHold(c, rc, 'Court order');
      const d = H.at('G16', {}, {}, { decision: 'instruct', route: 'objection' });
      const days = H.daysTo(c.retention.review) + 1;
      return H.withClock(days, () => {
        ENGINE.watch();
        const own = (x) => ACTOR.as(x.owner);
        const xs = [H.ex(c, 'RET-01'), H.ex(c, 'RET-04'), H.ex(d, 'RET-02')];
        const o = { found: xs.map((x) => !!x) };
        o.tries = xs.map((x) => (x ? ENGINE.resolve(x, own(x), { action: 'Reassessed' }).ok : null));
        o.open = xs.map((x) => (x ? ENGINE.isOpen(x) : null));
        [c, d].forEach((k) => k.retention.holds.filter((h) => !h.released).forEach((h) => ENGINE.releaseHold(k, h.id, rc)));
        o.after = xs.map((x) => (x ? x.status : null));
        return o;
      });
    """)
    assert r["found"] == [True, True, True], r
    assert r["tries"] == [False, False, False] and r["open"] == [True, True, True], ("RET-01/02/04 wait for their hold", r)
    assert all(s in ("resolved", "closed") for s in r["after"]), r["after"]


def test_f33_pre04_only_for_the_2026_year(page):
    r = ev(page, r"""
      const c = H.mk({ provisional: false }, { year: 2027 });
      const d = H.mk({ provisional: false });
      ENGINE.watch();
      return { y: [c.year, d.year], c: H.codes(c).includes('PRE-04'), d: H.codes(d).includes('PRE-04') };
    """)
    assert r["y"] == [2027, 2026] and r["d"]
    assert not r["c"], "No PRE-04 for a year whose filing season is not verified"


def test_f34_caseless_sec_code_opens_an_incident(page):
    r = ev(page, r"""
      const rr = ENGINE.raiseManual(null, 'SEC-04', tc, { note: 'no case' });
      const x = rr.exception; const inc = x.incidentId ? ENGINE.incById(x.incidentId) : null;
      const o = { ok: rr.ok, inc: inc && [inc.caseId, inc.status] };
      o.res = ENGINE.resolve(x, io, { action: 'ok' }).ok; o.status = x.status;
      if (inc) {
        ['containment', 'investigation', 'remediation', 'notification'].forEach((s) => ENGINE.incidentStep(inc, s, io, { note: s + ' done' }));
        o.close = ENGINE.closeIncident(inc, io).ok; o.after = x.status;
      }
      return o;
    """)
    assert r["ok"] and r["inc"] == [None, "open"], ("A G17 code raised without a case opens a case-less incident", r)
    assert not r["res"] and r["status"] not in ("resolved", "closed")
    assert r["close"] and r["after"] in ("resolved", "closed")


def test_f35_holds_placed_after_the_review_date_get_a_ret_code(page):
    r = ev(page, r"""
      const c = H.at('G16');
      const days = H.daysTo(c.retention.review) + 1;
      return H.withClock(days, () => {
        ENGINE.watch();
        const h1 = ENGINE.legalHold(c, rc, 'Court order received after the review date').hold;
        ENGINE.watch();
        const h2 = ENGINE.legalHold(c, rc, 'Second court order').hold;
        ENGINE.watch();
        const ret04 = ENGINE.exOf(c).filter((x) => x.code === 'RET-04' && ENGINE.isOpen(x)).map((x) => x.holdId).sort();
        return { ret03: H.codes(c).includes('RET-03'), ret04, want: [h1.id, h2.id].sort() };
      });
    """)
    assert r["ret03"] and r["ret04"] == r["want"], ("Every active hold after the review date gets its RET code", r)


def test_f36_g16_needs_the_retention_review_raised_and_resolved(page):
    r = ev(page, r"""
      const c = H.at('G16');
      const days = H.daysTo(c.retention.review) + 1;
      return H.withClock(days, () => {
        const o = { before: ENGINE.canRelease(c, 'G16', rc) };
        ENGINE.watch();
        o.afterWatch = ENGINE.canRelease(c, 'G16', rc);
        o.res = ENGINE.resolve(H.ex(c, 'RET-03'), rc, { action: 'Retention reviewed' }).ok;
        o.rel = ENGINE.release(c, 'G16', rc).ok;
        return o;
      });
    """)
    assert not r["before"]["ok"] and any("RET-03" in m for m in r["before"]["missing"]), r["before"]
    assert not r["afterWatch"]["ok"] and "RET-03" in r["afterWatch"]["codes"], r["afterWatch"]
    assert r["res"] and r["rel"]


def test_f37_verify_chain_detects_truncation_replacement_and_date_edits(page):
    r = ev(page, r"""
      H.at('G12');
      const o = { start: ENGINE.verifyChain().ok };
      const last = S.audit.pop(); o.popped = ENGINE.verifyChain().ok; S.audit.push(last); o.back = ENGINE.verifyChain().ok;
      const keep = S.audit; S.audit = keep.slice(0, keep.length - 3); o.replaced = ENGINE.verifyChain().ok; S.audit = keep; o.back2 = ENGINE.verifyChain().ok;
      const e = S.audit[3];
      if (e.at instanceof Date) { const t0 = e.at.getTime(); e.at.setTime(0); o.dateEdit = ENGINE.verifyChain().ok; e.at.setTime(t0); }
      else o.dateEdit = 'string';
      o.back3 = ENGINE.verifyChain().ok;
      return o;
    """)
    assert r["start"] and r["back"] and r["back2"] and r["back3"]
    assert r["popped"] is False, "A truncated tail is reported"
    assert r["replaced"] is False, "A replaced trail is reported"
    assert r["dateEdit"] in (False, "string"), r


# ---------------------------------------------------------------------------------------------------------------------------
# Adversarial (#40, #47, #50-#53)
# ---------------------------------------------------------------------------------------------------------------------------

def test_f40_manual_fallback_refused_while_an_s1_incident_is_open(page):
    r = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c); H.sign2(t);
      ENGINE.raiseManual(c, 'SEC-01', tc, { note: 'Breach after sign-off' });
      const o = { tr: ENGINE.transmit(t, ia, 'success').ok };
      ENGINE.setLink({ up: false }, ia);
      const mf = ENGINE.manualFallback(t, tc, { ref: 'MAN-ITR-1' });
      o.mf = [mf.ok, t.status, c.submission, H.codes(c).includes('INT-13')];
      ENGINE.setLink({ up: true }, ia);
      return o;
    """)
    assert not r["tr"]
    assert r["mf"] == [False, "ready", None, False], ("manualFallback re-runs the G18 checks and g18Blockers", r["mf"])


def test_f47_drag_that_releases_a_sars_gate_reports_awaiting_g18(page):
    r = ev(page, r"""
      const c = H.at('G12');
      ENGINE.receive({ fn: 'daIn', taxRef: ENGINE.clientOf(c).taxRef, year: c.year, ref: 'DA-REF-1', due: '2026-12-04', date: '2026-11-09' });
      ENGINE.markReq(c, 'G10', 'draft', tc); ENGINE.markReq(c, 'G10', 'support', tc);
      const n = H.auditLen();
      const d1 = ENGINE.dragForward(c, tc);
      const o = { d1: [d1.ok, d1.awaiting || null], g10: c.gates.G10.status, txs: S.txs.filter((t) => t.caseId === c.id && t.fn === 'da').map((t) => t.status) };
      o.snapped = S.audit.slice(n).some((a) => /snapped back/.test(a.text));
      o.retried = S.audit.slice(n).some((a) => a.result === 'Refused' && a.gate === 'G10');
      const d2 = ENGINE.dragForward(c, tc);
      o.d2 = [d2.ok, d2.why];
      return o;
    """)
    assert r["d1"] == [True, "G18"] and r["g10"] == "released" and r["txs"] == ["awaiting G18"], r
    assert not r["snapped"] and not r["retried"], "No retried release and no snap-back that did not happen"
    assert not r["d2"][0] and "released" in r["d2"][1], r["d2"]


def test_f50_removing_a_code_from_the_policy_revokes_its_overrides(page):
    r = ev(page, r"""
      const setup = () => {
        const c = H.at('G05');
        ENGINE.change(c, tc, ENGINE.stubData(c), { reason: 'Calculation' });
        const x = ENGINE.raiseManual(c, 'CLT-03', tc, { note: 't' }).exception;
        ENGINE.setOverridable('CLT-03', true, rc);
        ENGINE.requestOverride(x, tc, { reason: 'r', evidence: 'e' });
        ENGINE.approveOverride(x, rc);
        return [c, x];
      };
      const [c, x] = setup();
      const o = { before: [x.override.status, ENGINE.blocksNow(x)] };
      o.off = ENGINE.setOverridable('CLT-03', false, rc).ok;
      o.after = [x.override.status, ENGINE.blocksNow(x), ENGINE.release(c, 'G05', tc).ok];
      // blocksNow itself honours an override only while the code is on the list.
      const [d, y] = setup();
      S.policy.overridable = S.policy.overridable.filter((k) => k !== 'CLT-03');
      o.direct = [y.override.status, ENGINE.blocksNow(y), ENGINE.canRelease(d, 'G05', tc).ok];
      return o;
    """)
    assert r["before"] == ["approved", False] and r["off"]
    assert r["after"] == ["lapsed", True, False], r["after"]
    assert r["direct"] == ["approved", True, False], r["direct"]


def test_f51_ai06_per_ai_gate_while_the_ai_is_down(page):
    r = ev(page, r"""
      const c = H.at('G04');
      ENGINE.setAiUp(false, ACTOR.platform());
      const o = { first: ENGINE.drive(c, 'G08').ok };
      const x = ENGINE.exOf(c).find((y) => y.code === 'AI-06' && y.gates.includes('G04'));
      ENGINE.recordFallback(x, tc, { note: 'Manual document review' }); ENGINE.reconcileFallback(x, tc2, {});
      o.dr = ENGINE.drive(c, 'G08'); o.cur = ENGINE.currentGate(c);
      o.ai06 = ENGINE.exOf(c).filter((y) => y.code === 'AI-06' && ENGINE.isOpen(y)).map((y) => y.gates[0]);
      o.g08 = ENGINE.release(c, 'G08', tc);
      return o;
    """)
    assert not r["first"] and r["dr"]["ok"] and r["cur"] == "G08", r
    assert "G08" in r["ai06"], ("AI-06 is raised for G08 too while the AI is down", r["ai06"])
    assert not r["g08"]["ok"] and "AI-06" in r["g08"]["codes"], r["g08"]


def test_f52_set_severity_refuses_clients_and_revoked_or_mismatched_staff(page):
    r = ev(page, r"""
      const c = H.mk();
      const x = ENGINE.raiseManual(c, 'DOC-05', tc, { note: 't' }).exception;   // S4
      const people = S.people.slice();
      S.people = S.people.filter((p) => p.id !== 'IA1');
      const o = { revoked: ENGINE.setSeverity(x, ACTOR.as('Integration Administrator', 'IA1'), 'S1', { reason: 'revoked user' }).ok };
      S.people = people;
      o.client = ENGINE.setSeverity(x, ACTOR.client(c.clientId), 'S1', {}).ok;
      o.otherClient = ENGINE.setSeverity(x, ACTOR.client('CL99'), 'S1', {}).ok;
      o.mismatch = ENGINE.setSeverity(x, ACTOR.as('Administrator', 'TC1'), 'S1', { reason: 'x' }).ok;
      o.sev = x.sev;
      o.ai = ENGINE.setSeverity(x, ai, 'S3', { reason: 'AI' }).ok;
      o.sys = ENGINE.setSeverity(x, sys, 'S2', { reason: 'system' }).ok;
      o.platform = ENGINE.setSeverity(x, ACTOR.platform(), 'S1', { reason: 'platform' }).ok;
      const y = ENGINE.raiseManual(c, 'DOC-05', tc, { note: 't2' }).exception;
      o.sars = ENGINE.setSeverity(y, ACTOR.sars(), 'S3', { reason: 'SARS' }).ok;
      o.staff = ENGINE.setSeverity(y, ia, 'S2', { reason: 'staff' }).ok;
      o.sevs = [x.sev, y.sev];
      return o;
    """)
    assert not r["revoked"] and not r["client"] and not r["otherClient"] and not r["mismatch"] and r["sev"] == "S4", r
    assert r["ai"] and r["sys"] and r["platform"] and r["sars"] and r["staff"] and r["sevs"] == ["S1", "S2"], r


def test_f53_default_client_id_fails_the_sa_id_checksum(page):
    r = ev(page, "return ENGINE.newClient({ name: 'Default id' }).idNo;")

    def luhn_ok(s):
        total = 0
        for i, ch in enumerate(reversed(s)):
            d = int(ch)
            if i % 2:
                d = d * 2 - 9 if d * 2 > 9 else d * 2
            total += d
        return total % 10 == 0

    assert r == "8001015009088" and len(r) == 13
    assert not luhn_ok(r), "The default ID number must not be a structurally valid SA ID"
    assert luhn_ok("8001015009087"), "sanity: the checksum function accepts the published example"


# ---------------------------------------------------------------------------------------------------------------------------
# Round 2: the 12 defects found on re-checking the fixes (NEW 1-12; duplicates merged under the lowest number: 5=11, 6=8).
# Each test replays the defect's failure scenario and asserts the behaviour the round-2 ruling made intended.
# ---------------------------------------------------------------------------------------------------------------------------

def test_n01_portal_approve_after_submission_reopens_nothing(page):
    r = ev(page, r"""
      const o = {};
      const itr = (c) => S.txs.filter((t) => t.caseId === c.id && t.fn === 'itr12').length;
      const snap = (c) => ({ gates: ['G06', 'G07', 'G08', 'G09', 'G18', 'G12', 'G13', 'G14'].map((g) => c.gates[g].status), cur: ENGINE.currentGate(c), col: ENGINE.columnOf(c) });
      const approve = (c) => ENGINE.portal(c, 'approve', { version: ENGINE.vN(c), declaration: true });
      // The client rejects the filed return in the portal, then approves the same version again.
      const c = H.at('G12'); const n0 = itr(c);
      const rj = ENGINE.portal(c, 'reject', { reason: 'I think the numbers are wrong' });
      o.reject = [rj.ok, H.openCodes(c).includes('SUB-04'), H.codes(c).includes('SUB-05'), c.gates.G06.status];
      const s0 = snap(c);
      const ap = approve(c);
      o.approve = [ap.ok, ap.why]; o.same = JSON.stringify(snap(c)) === JSON.stringify(s0); o.after = snap(c);
      o.sub = !!(c.submission && c.submission.ok); o.newTx = itr(c) - n0; o.int05 = H.codes(c).includes('INT-05');
      o.g09 = ENGINE.release(c, 'G09', tc).ok; o.newTx2 = itr(c) - n0;
      // A withdrawal or withholding after submission is only logged: no code, nothing re-opened, and a re-approval changes nothing.
      for (const act of ['withdraw', 'withhold']) {
        const d = H.at('G12'); const sd = snap(d); const m0 = itr(d);
        const w = ENGINE.portal(d, act, { reason: 'Hold off' });
        const ap2 = approve(d);
        o[act] = [w.ok, H.openCodes(d).filter((k) => /^(CLT|SUB)-/.test(k)), JSON.stringify(snap(d)) === JSON.stringify(sd), ap2.ok, itr(d) - m0];
      }
      return o;
    """)
    assert r["reject"] == [True, True, False, "released"], ("A rejection of the filed return raises SUB-04 and re-opens no gate", r["reject"])
    assert not r["approve"][0] and "already submitted" in r["approve"][1], ("Approve after submission fails", r["approve"])
    assert r["same"], ("A refused approval re-opens nothing", r["after"])
    assert r["sub"] and r["newTx"] == 0 and not r["int05"], r
    assert not r["g09"] and r["newTx2"] == 0, "No second ITR12 is queued for a filed return"
    for act in ("withdraw", "withhold"):
        assert r[act] == [True, [], True, False, 0], (act, r[act])


def test_n02_portal_approve_while_the_itr12_is_in_flight_reopens_nothing(page):
    r = ev(page, r"""
      const out = {};
      const approve = (c) => ENGINE.portal(c, 'approve', { version: ENGINE.vN(c), declaration: true });
      const fly = (c, mode) => {
        const t = H.itx(c); H.sign2(t); let mf = null;
        if (mode === 'manual') { ENGINE.setLink({ up: false }, ia); ENGINE.transmit(t, ia, 'success'); mf = ENGINE.manualFallback(t, tc, { ref: 'EF-N2-' + c.id }); ENGINE.setLink({ up: true }, ia); }
        else ENGINE.transmit(t, ia, mode);
        return [t, mf];
      };
      const settleTx = (t, mf) => (mf ? ENGINE.reconcileFallback(mf.exception, tc2, {}) : ENGINE.checkStatus(t, ia, 'processed'));
      for (const mode of ['unknown', 'no-response', 'manual']) {
        // The client withdraws (held), then re-approves the same version before the SARS status is known.
        const c = H.at('G18'); const [t, mf] = fly(c, mode);
        const w = ENGINE.portal(c, 'withdraw', { reason: 'wait' });
        const held = [w.ok, !!c.approval.withdrawn, H.codes(c).includes('CLT-06'), c.gates.G06.status];
        const ap = approve(c);
        const after = [ap.ok, c.approval.withdrawn, ['G06', 'G09', 'G18'].map((g) => c.gates[g].status), t.status];
        const st = settleTx(t, mf);
        const done = [st.ok, !!(c.submission && c.submission.ok), ENGINE.currentGate(c), ENGINE.columnOf(c),
                      H.codes(c).includes('SUB-05'), H.codes(c).includes('CLT-06'), c.gates.G09.status];
        // Without a held withdrawal, approving while the ITR12 is in flight is refused and changes nothing.
        const d = H.at('G18'); const [u] = fly(d, mode);
        const ap2 = approve(d);
        const plain = [ap2.ok, /may already be with SARS/.test(ap2.why || ''), ['G06', 'G09', 'G18'].map((g) => d.gates[g].status), u.status];
        out[mode] = { held, after, done, plain };
      }
      return out;
    """)
    for mode, o in r.items():
        assert o["held"] == [True, True, False, "released"], (mode, "the withdrawal is held", o["held"])
        assert o["after"] == [True, None, ["released", "released", "released"], mode], (mode, "re-approving cancels the held withdrawal and re-opens nothing", o["after"])
        assert o["done"][:2] == [True, True] and o["done"][2] != "G09" and o["done"][3] != "final-checks", (mode, o["done"])
        assert o["done"][4:] == [False, False, "released"], (mode, o["done"])
        assert o["plain"] == [False, True, ["released", "released", "released"], mode], (mode, o["plain"])


def test_n03_ita34_received_while_the_itr12_is_in_flight_is_applied_on_success(page):
    r = ev(page, r"""
      const o = {};
      const manual = (c, ref) => {
        const t = H.itx(c); H.sign2(t);
        ENGINE.setLink({ up: false }, ia); ENGINE.transmit(t, ia, 'success');
        const mf = ENGINE.manualFallback(t, tc, { ref }); ENGINE.setLink({ up: true }, ia);
        return [t, mf];
      };
      const ita34 = (c, ref, extra) => ENGINE.receive(Object.assign({ fn: 'ita34', taxRef: ENGINE.clientOf(c).taxRef, year: c.year, ref, date: '2026-11-09', data: c.calc.summary }, extra || {}));
      // Manual filing awaiting reconciliation: the auto-assessment arrives at once.
      const c = H.at('G18'); const [t, mf] = manual(c, 'EF-M3');
      const it = ita34(c, 'ITA34-M3', { submissionRef: 'EF-M3' });
      o.held = [it.status, c.ita34, c.pendingIta34 && c.pendingIta34.ref, c.notices.some((n) => n.ref === 'ITA34-M3')];
      ENGINE.reconcileFallback(mf.exception, tc2, {});
      o.applied = [t.status, c.submission && c.submission.ref, c.ita34 && c.ita34.ref, c.pendingIta34];
      o.g12 = [ENGINE.drive(c, 'G13').ok, c.gates.G12.status];
      // Unknown transmission that SARS did process.
      const d = H.at('G18'); const u = H.itx(d); H.sign2(u); ENGINE.transmit(u, ia, 'unknown');
      ita34(d, 'ITA34-U3');
      o.uHeld = [d.ita34, d.pendingIta34 && d.pendingIta34.ref];
      ENGINE.checkStatus(u, ia, 'processed');
      o.uApplied = [!!(d.submission && d.submission.ok), d.ita34 && d.ita34.ref, d.pendingIta34];
      o.uG12 = [ENGINE.drive(d, 'G13').ok, d.gates.G12.status];
      // The usual submissionRef check still applies once the held ITA34 is applied.
      const e = H.at('G18'); const [, mf3] = manual(e, 'EF-M4');
      ita34(e, 'ITA34-M4', { submissionRef: 'EF-OTHER' });
      ENGINE.reconcileFallback(mf3.exception, tc2, {});
      o.mismatch = [!!(e.submission && e.submission.ok), e.ita34, H.openCodes(e).includes('ASM-05')];
      return o;
    """)
    assert r["held"][1] is None and r["held"][2] == "ITA34-M3" and r["held"][3] is False, ("Parked in pendingIta34, not filed as a notice", r["held"])
    assert r["applied"] == ["success", "EF-M3", "ITA34-M3", None], ("Applied when the manual filing is reconciled", r["applied"])
    assert r["g12"] == [True, "released"], r["g12"]
    assert r["uHeld"] == [None, "ITA34-U3"] and r["uApplied"] == [True, "ITA34-U3", None], r
    assert r["uG12"] == [True, "released"], r["uG12"]
    assert r["mismatch"] == [True, None, True], ("ASM-05 when the held ITA34 names another submission", r["mismatch"])


def test_n04_verification_response_after_an_audit_response_is_not_a_duplicate(page):
    r = ev(page, r"""
      const c = H.at('G12'); const ref = ENGINE.clientOf(c).taxRef;
      ENGINE.receive({ fn: 'audIn', taxRef: ref, year: c.year, ref: 'AUD-1', due: '2027-02-15', date: '2026-11-09' });
      ENGINE.exOf(c).filter((y) => y.code === 'AUD-01' && ENGINE.isOpen(y)).forEach((y) => { ENGINE.resolve(y, tc, { action: 'Audit pack prepared' }); ENGINE.close(y, rc); });
      const d1 = ENGINE.drive(c, 'G12');
      const vrf = () => S.txs.filter((t) => t.caseId === c.id && t.fn === 'vrf');
      const o = { d1: [d1.ok, d1.why], first: vrf().map((t) => t.status) };
      ENGINE.receive({ fn: 'vrfIn', taxRef: ref, year: c.year, ref: 'VRF-2', due: '2027-03-15', date: '2026-11-09' });
      o.g11Ref = c.g11Ref;
      const d2 = ENGINE.drive(c, 'G12');
      o.d2 = [d2.ok, d2.why];
      const ts = vrf();
      o.txs = ts.map((t) => t.status); o.distinct = new Set(ts.map((t) => t.hash)).size === ts.length;
      o.int05 = H.codes(c).includes('INT-05'); o.g11 = c.gates.G11.status;
      return o;
    """)
    assert r["d1"][0] and r["first"] == ["success"], r
    assert r["g11Ref"] == "VRF-2", "The G11 response answers the newest request"
    assert r["d2"][0] and not r["int05"], ("Answering VRF-2 after AUD-1 is not a duplicate (INT-05)", r)
    assert r["txs"] == ["success", "success"] and r["distinct"] and r["g11"] == "released", r


def test_n05_independent_reconciliation_can_find_a_manual_filing_was_not_made(page):
    r = ev(page, r"""
      const o = {};
      const manual = (c, ref) => {
        const t = H.itx(c); H.sign2(t);
        ENGINE.setLink({ up: false }, ia); ENGINE.transmit(t, ia, 'success');
        const mf = ENGINE.manualFallback(t, tc, { ref }); ENGINE.setLink({ up: true }, ia);
        return [t, mf.exception];
      };
      // No withdrawal: the reconciler finds the manual filing is not on eFiling; the ITR12 can then be retried under a fresh G18.
      const c = H.at('G18'); const [t, x] = manual(c, 'EF-TYPO');
      o.self = ENGINE.reconcileFallback(x, tc, { processed: false }).ok;
      const rec = ENGINE.reconcileFallback(x, tc2, { processed: false });
      o.rec = [rec.ok, t.status, x.status, c.submission, H.openCodes(c).includes('INT-13')];
      const rt = ENGINE.retry(t, ia);
      o.retry = [rt.ok, t.status, rt.tx && rt.tx.status, c.subTx === (rt.tx && rt.tx.id), c.gates.G18.status];
      if (rt.ok) { H.sign2(rt.tx); const tr = ENGINE.transmit(rt.tx, ia, 'success'); o.sent = [tr.ok, tr.why, !!(c.submission && c.submission.ok), H.codes(c).includes('INT-05')]; }
      // Before the retry the case is no longer frozen: change() and returnForRework() are allowed again.
      const e = H.at('G18'); const [u, y] = manual(e, 'EF-WRONG');
      ENGINE.reconcileFallback(y, tc2, { processed: false });
      const dd = ENGINE.stubData(e); dd.calc.summary.normalTax = 5000;
      o.change = [u.status, ENGINE.change(e, tc, dd, { reason: 'Correct the return' }).ok];
      // A withdrawal held during the manual filing takes effect once the filing is found not to be made.
      const d = H.at('G18'); const [v, z] = manual(d, 'EF-HELD');
      ENGINE.portal(d, 'withdraw', { reason: 'Stop' });
      o.held = [H.codes(d).includes('CLT-06'), d.gates.G06.status];
      ENGINE.reconcileFallback(z, tc2, { processed: false });
      o.applied = [v.status, H.openCodes(d).includes('CLT-06'), d.gates.G06.status, ENGINE.currentGate(d), d.submission];
      return o;
    """)
    assert r["self"] is False, "The filer still cannot reconcile their own manual filing"
    assert r["rec"] == [True, "not processed", "resolved", None, False] or (
        r["rec"][:2] == [True, "not processed"] and r["rec"][2] in ("resolved", "closed") and r["rec"][3] is None and not r["rec"][4]), r["rec"]
    assert r["retry"][0] and r["retry"][1] == "superseded" and r["retry"][3] and r["retry"][4] != "released", ("Retry under a fresh G18", r["retry"])
    assert r["sent"][:3] == [True, "", True] and not r["sent"][3], r["sent"]
    assert r["change"] == ["not processed", True], r["change"]
    assert r["held"] == [False, "released"], r["held"]
    assert r["applied"][:4] == ["not processed", True, "invalidated", "G06"] and r["applied"][4] is None, ("The held withdrawal takes effect", r["applied"])


def test_n06_recorded_withdrawal_cannot_predate_the_approval(page):
    r = ev(page, r"""
      const o = {};
      const inc = (c) => S.incidents.filter((i) => i.caseId === c.id).length;
      // NEW 6: a submitted case; an email "from last month" recorded by the consultant.
      const c = H.at('G12');
      const a = ENGINE.recordWithdrawal(c, tc, { receivedAt: new Date(c.approval.at.getTime() - 30 * 864e5).toISOString(), reason: 'Email from last month saying hold off', channel: 'email' });
      o.c = [a.ok, /predate/.test(a.why || ''), c.approval.withdrawn, H.codes(c).includes('SUB-05'), inc(c)];
      // NEW 8: an Administrator records an instruction "received" a year before the approval.
      const d = H.at('G12');
      const b = ENGINE.recordWithdrawal(d, ad, { receivedAt: '2025-11-01T09:00:00+02:00', reason: 'Client said stop', channel: 'email' });
      const dr = ENGINE.drive(d);
      o.d = [b.ok, d.approval.withdrawn, H.codes(d).includes('SUB-05'), inc(d), /SUB-05/.test(dr.why || '')];
      // Control: before submission, an instruction received after the approval still takes effect.
      const e = H.at('G09');
      const w = ENGINE.recordWithdrawal(e, tc, { receivedAt: new Date(e.approval.at.getTime()).toISOString(), reason: 'Phoned to stop', channel: 'phone' });
      o.e = [w.ok, H.codes(e).includes('CLT-06'), e.gates.G06.status];
      return o;
    """)
    assert r["c"] == [False, True, None, False, 0], ("A receivedAt before the approval is refused", r["c"])
    assert r["d"] == [False, None, False, 0, False], ("No SUB-05 or incident on a correctly filed return", r["d"])
    assert r["e"] == [True, True, "invalidated"], r["e"]


def test_n07_unreadable_sars_date_is_never_replaced_with_today(page):
    want = iso(add_biz(date(2026, 11, 2), 80, ch9=True))
    r = ev(page, r"""
      const o = {};
      const c = H.at('G12'); const cl = ENGINE.clientOf(c);
      const it = ENGINE.receive({ fn: 'ita34', taxRef: cl.taxRef, year: 2026, ref: 'ITA34-X', date: '2026-11-2', data: c.calc.summary, submissionRef: c.submission.ref });
      const x15 = S.exceptions.find((x) => x.code === 'INT-15' && x.inboundId === it.id);
      o.item = [it.date, it.raw && it.raw.date, c.ita34 && c.ita34.date, !!x15 && ENGINE.isOpen(x15), x15 && x15.caseId === c.id];
      o.dr = ENGINE.drive(c, 'G14');
      ENGINE.portal(c, 'decide', { choice: 'instruct', note: 'Disagree' });
      const ch = ENGINE.chooseRemedy(c, tc, 'objection', { evidence: 'Grounds' });
      o.remedy = [ch.ok, c.remedy && c.remedy.from, c.remedy && c.remedy.deadline];
      // Confirmed from the notice by the Integration Administrator; someone else reconciles INT-15.
      const conf = ENGINE.confirmInboundDate(it, ia, { date: '2026-11-02' });
      o.confirmed = [conf.ok, it.date, c.ita34 && c.ita34.date, c.remedy && c.remedy.from, c.remedy && c.remedy.deadline];
      o.selfRec = ENGINE.reconcileFallback(x15, ia, {}).ok;
      o.rec = [ENGINE.reconcileFallback(x15, tc, {}).ok, ENGINE.isOpen(x15)];
      // An unreadable DA due date leaves no deadline, with INT-15 open (not a silent null).
      const d = H.at('G12');
      const da = ENGINE.receive({ fn: 'daIn', taxRef: ENGINE.clientOf(d).taxRef, year: 2026, ref: 'DA-X', date: '2026-11-09', due: '2026-12-1' });
      o.da = [d.da && d.da.due, da.raw && da.raw.due, S.exceptions.some((x) => x.code === 'INT-15' && x.inboundId === da.id && ENGINE.isOpen(x))];
      // An item that matches no case still raises INT-15 (case-less).
      const un = ENGINE.receive({ fn: 'notice', taxRef: '7777000001', year: 2026, ref: 'LTR-X', date: '2026-13-01' });
      const xu = S.exceptions.find((x) => x.code === 'INT-15' && x.inboundId === un.id);
      o.unrouted = [un.status, un.date, !!xu && ENGINE.isOpen(xu), xu ? xu.caseId : 'none'];
      return o;
    """)
    assert r["item"] == [None, "2026-11-2", None, True, True], ("The unreadable date stays empty and INT-15 is raised on the case", r["item"])
    assert r["remedy"] == [True, None, None], ("No remedy deadline runs from an unconfirmed date", r["remedy"])
    assert r["confirmed"] == [True, "2026-11-02", "2026-11-02", "2026-11-02", want], (r["confirmed"], want)
    assert r["selfRec"] is False and r["rec"] == [True, False], r
    assert r["da"] == [None, "2026-12-1", True], r["da"]
    assert r["unrouted"][:3] == ["unrouted", None, True] and r["unrouted"][3] is None, r["unrouted"]


def test_n09_int13_is_cleared_only_by_independent_reconciliation(page):
    r = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c); H.sign2(t);
      ENGINE.setLink({ up: false }, ia);
      const x = ENGINE.manualFallback(t, tc, { ref: 'MAN-51' }).exception;
      ENGINE.setLink({ up: true }, ia);
      const o = {};
      o.selfRec = ENGINE.reconcileFallback(x, tc, {}).why;
      const r1 = ENGINE.resolve(x, tc, { action: 'Reconciled it myself' });
      const r2 = ENGINE.resolve(x, tc2, { action: 'Looks fine' });
      o.resolve = [r1.ok, r2.ok, x.status, ENGINE.isOpen(x), t.status, H.openCodes(c).includes('INT-13')];
      const rec = ENGINE.reconcileFallback(x, tc2, {});
      o.after = [rec.ok, ENGINE.isOpen(x), t.status, !!(c.submission && c.submission.ok)];
      return o;
    """)
    assert "different person" in r["selfRec"], r
    assert r["resolve"][:2] == [False, False] and r["resolve"][3] and r["resolve"][4] == "manual" and r["resolve"][5], (
        "resolve() is refused until the manual filing is independently reconciled", r["resolve"])
    assert r["after"] == [True, False, "success", True], r["after"]


def test_n10_int15_is_cleared_only_by_independent_reconciliation(page):
    r = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c);
      const x = ENGINE.raiseManual(c, 'INT-15', ia, { txId: t.id, note: 'Payload validation service down' }).exception;
      const o = { s0: ENGINE.signG18(t, ia).ok };
      const r1 = ENGINE.resolve(x, ia, { action: 'ok' });
      o.resolve = [r1.ok, ENGINE.isOpen(x), ENGINE.blocksNow(x)];
      o.blocked = [ENGINE.signG18(t, ia).ok, ENGINE.signG18(t, tc).ok, c.submission];  // no send attempt: sending before G18 is itself a gate-bypass (INT-11)
      ENGINE.recordFallback(x, ia, { note: 'Payload validated by hand' });
      o.recorded = ENGINE.resolve(x, ia, { action: 'Recorded, not yet reconciled' }).ok;
      const rec = ENGINE.reconcileFallback(x, tc, {});
      o.after = [rec.ok, ENGINE.isOpen(x)];
      H.sign2(t);
      o.sent = [ENGINE.transmit(t, ia, 'success').ok, !!(c.submission && c.submission.ok)];
      return o;
    """)
    assert r["s0"] is False
    assert r["resolve"] == [False, True, True], ("INT-15 cannot be resolved with free text", r["resolve"])
    assert r["blocked"] == [False, False, None], r["blocked"]
    assert r["recorded"] is False, "A recorded but unreconciled fallback is not enough"
    assert r["after"] == [True, False] and r["sent"] == [True, True], r


def test_n12_lapsed_requests_and_answered_reminders_are_audited(page):
    r = ev(page, r"""
      const o = {};
      const c = H.mk();
      const x = ENGINE.raiseManual(c, 'SUB-01', tc, { note: 't' }).exception;
      ENGINE.setSeverity(x, tc, 'S3', { reason: 'Minor' });
      const n0 = H.auditLen();
      ENGINE.setSeverity(x, ai, 'S1', { reason: 'Escalated by AI' });
      o.lapse = [x.sevRequest.status, S.audit.slice(n0).some((a) => a.exceptionId === x.id && /lapsed/.test(a.text) && /S3/.test(a.text))];
      // approveSeverity on a stale request says the request lapses.
      const y = ENGINE.raiseManual(c, 'SUB-01', tc, { note: 't2' }).exception;
      ENGINE.setSeverity(y, tc, 'S3', { reason: 'Minor' }); y.sev = 'S1';
      const ap = ENGINE.approveSeverity(y, rc);
      o.stale = [ap.ok, /lapses/.test(ap.why || ''), y.sevRequest.status];
      // An answered reminder is written to the trail.
      const d = H.at('G06');
      ENGINE.remind(d, 'approval', ad);
      ENGINE.drive(d, 'G09');
      const n1 = H.auditLen();
      ENGINE.watch();
      o.rem = [d.reminders.map((m) => m.status), S.audit.slice(n1).some((a) => a.caseId === d.id && /approval reminder sent .* was answered/.test(a.text))];
      o.chain = ENGINE.verifyChain().ok;
      return o;
    """)
    assert r["lapse"] == ["lapsed", True], ("The lapse of a pending request is audited", r["lapse"])
    assert r["stale"] == [False, True, "lapsed"], r["stale"]
    assert r["rem"] == [["answered"], True], ("An answered reminder is audited", r["rem"])
    assert r["chain"]


def test_zz_no_page_errors(page):
    assert page.errors == [], page.errors
