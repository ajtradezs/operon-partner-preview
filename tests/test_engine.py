"""ITR12 gate engine (src/itr12/engine.js) against its specification: the plan's engine rules 1-12, the engine spec decided in
session 2, Johan's exception register (REGISTER) and his master workflow document (WORKFLOW).

Every test runs in one module-scoped page (timezone Africa/Johannesburg) on the built index.html. Each test first stops the
per-second ticker (TICKERS.splice(0)) and re-seeds state (seed()), so nothing changes under it, and then drives the engine through
one or a few page.evaluate calls. Expected values come from the specification and the register, not from engine.js; where they
differ the assertion message names the rule.
"""
from datetime import date, timedelta
import csv
import io

import pytest

# ---------------------------------------------------------------------------------------------------------------------------
# Page and helpers
# ---------------------------------------------------------------------------------------------------------------------------

HELPERS = r"""
() => {
  if (typeof DEMO !== 'undefined') DEMO.cases = false;  // the engine is tested on an empty firm; tests/test_seed.py covers the demo cases
  const H = {
    tc: ACTOR.as('Tax Consultant', 'TC1'), tc2: ACTOR.as('Tax Consultant', 'TC2'), ad: ACTOR.as('Administrator', 'AD1'),
    ia: ACTOR.as('Integration Administrator', 'IA1'), io: ACTOR.as('Information Officer', 'IO1'), rc: ACTOR.as('Records/Compliance Owner', 'RC1'),
    ai: ACTOR.ai(), sys: ACTOR.system(),
    n: 0,
    // A new client and case. o: client options; co: case options.
    mk(o, co) {
      H.n += 1;
      const cl = ENGINE.newClient(Object.assign({ name: 'Test Client ' + H.n, taxRef: String(9100000000 + H.n) }, o || {}));
      return ENGINE.newCase(cl, co || {});
    },
    // A case driven along the happy path until `gate` is its current gate.
    at(gate, o, co, dopts) {
      const c = H.mk(o, co);
      const r = ENGINE.drive(c, gate, dopts || {});
      if (!r.ok || ENGINE.currentGate(c) !== gate) throw new Error('drive to ' + gate + ' failed: ' + r.why + ' (at ' + ENGINE.currentGate(c) + ')');
      return c;
    },
    codes: (c) => ENGINE.exOf(c).map((x) => x.code),
    openCodes: (c) => ENGINE.exOf(c).filter(ENGINE.isOpen).map((x) => x.code),
    ex: (c, code) => ENGINE.exOf(c).filter((x) => x.code === code).pop() || null,
    itx: (c, fn) => S.txs.filter((t) => t.caseId === c.id && t.fn === (fn || 'itr12')).pop() || null,
    blk: (c, g) => ENGINE.gateBlockers(c, g).map((x) => x.code),
    st: (c, g) => ENGINE.gateState(c, g).state,
    sign2: (t) => [ENGINE.signG18(t, H.ia), ENGINE.signG18(t, H.tc)],
    auditLen: () => S.audit.length,
    // Run fn with the demo clock moved forward by `days` (now() reads Date.now()).
    withClock(days, fn) {
      const real = Date.now; const off = days * 864e5;
      Date.now = () => real.call(Date) + off;
      try { return fn(); } finally { Date.now = real; }
    },
    daysTo(isoDay) { const [y, m, d] = isoDay.split('-').map(Number); return Math.ceil((new Date(y, m - 1, d, 12) - now()) / 864e5); },
    addPerson(id, role) { S.people.push({ id, name: 'Extra ' + id, role, email: id + '@example.test', note: '', mfa: 'On', last: '' }); return ACTOR.as(role, id); },
  };
  window.__H = H;
  return true;
}
"""


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


def ev(page, body, arg=None):
    """Run `body` (a JS function body; `arg`, `H` and the standard actors are in scope) on a freshly seeded state."""
    js = ("(arg) => { TICKERS.splice(0); seed(); const H = window.__H; "
          "const { tc, tc2, ad, ia, io, rc, ai, sys } = H;\n" + body + "\n}")
    return page.evaluate(js, arg)


# Independent South African business-day arithmetic (TAA s1; Public Holidays Act s2(1) Sunday rule; Chapter 9 excludes
# 16 December to 15 January). Used to check the engine's deadlines without relying on dates.js.
def _easter(y):
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    return date(y, (h + l - 7 * m + 114) // 31, (h + l - 7 * m + 114) % 31 + 1)


def _holidays(y):
    days = [date(y, mo, d) for mo, d in [(1, 1), (3, 21), (4, 27), (5, 1), (6, 16), (8, 9), (9, 24), (12, 16), (12, 25), (12, 26)]]
    e = _easter(y)
    days += [e - timedelta(days=2), e + timedelta(days=1)]
    out = set(days)
    out |= {d + timedelta(days=1) for d in days if d.weekday() == 6}
    if y == 2026:
        out.add(date(2026, 11, 4))  # declared: Proclamation Notice 346 of 2026, GG 55352
    return out


def _biz(d, ch9=False):
    if d.weekday() >= 5 or d in _holidays(d.year):
        return False
    return not (ch9 and ((d.month == 12 and d.day >= 16) or (d.month == 1 and d.day <= 15)))


def add_biz(d, n, ch9=False):
    k = 0
    while k < n:
        d += timedelta(days=1)
        if _biz(d, ch9):
            k += 1
    return d


def biz_between(a, b, ch9=False):
    """Business days in (a, b]: a is Day 0."""
    n, d = 0, a
    while d < b:
        d += timedelta(days=1)
        if _biz(d, ch9):
            n += 1
    return n


TODAY = date(2026, 11, 9)  # the demo clock starts at 09:00 SAST on 9 November 2026


def iso(d):
    return d.isoformat()


# ---------------------------------------------------------------------------------------------------------------------------
# Rule 1: gates G01-G18
# ---------------------------------------------------------------------------------------------------------------------------

def test_rule01_derived_states(page):
    r = ev(page, r"""
      const cl = ENGINE.newClient({ name: 'States', taxRef: '9000000101', kyc: { address: false } });
      const c = ENGINE.newCase(cl);
      const out = { start: { G01: H.st(c, 'G01'), G02: H.st(c, 'G02'), G05: H.st(c, 'G05') } };
      ENGINE.setKyc(cl, 'address', true, ad);
      out.kycDone = H.st(c, 'G01');
      out.rel = ENGINE.release(c, 'G01', ad).ok;
      out.afterRel = { G01: H.st(c, 'G01'), G02: H.st(c, 'G02') };
      ENGINE.markReq(c, 'G02', 'compare', tc);
      out.g02Ready = H.st(c, 'G02');
      ENGINE.drive(c, 'G09');
      const d = ENGINE.stubData(c); d.calc.summary.normalTax = 1234;
      out.change = ENGINE.change(c, tc, d, { reason: 'Corrected medical credits' }).ok;
      out.afterChange = { G05: H.st(c, 'G05'), G06: H.st(c, 'G06'), G08: H.st(c, 'G08'), stG05: c.gates.G05.status };
      return out;
    """)
    assert r["start"] == {"G01": "in progress", "G02": "not started", "G05": "not started"}, r
    assert r["kycDone"] == "ready"
    assert r["rel"] and r["afterRel"] == {"G01": "released", "G02": "in progress"}, r
    assert r["g02Ready"] == "ready"
    assert r["change"] and r["afterChange"]["stG05"] == "invalidated" and r["afterChange"]["G05"] == "invalidated", r
    assert r["afterChange"]["G06"] == "invalidated" and r["afterChange"]["G08"] == "invalidated", r


def test_rule01_release_needs_owner_role_and_criteria(page):
    r = ev(page, r"""
      const cl = ENGINE.newClient({ name: 'Roles', taxRef: '9000000102', kyc: { mandate: false } });
      const c = ENGINE.newCase(cl);
      const o = {};
      o.notReady = ENGINE.release(c, 'G01', ad);
      ENGINE.setKyc(cl, 'mandate', true, ad);
      o.byTc = ENGINE.release(c, 'G01', tc).ok;
      o.impostor = ENGINE.release(c, 'G01', ACTOR.as('Administrator', 'TC1')).ok;  // TC1 does not hold the Administrator role
      o.byAi = ENGINE.release(c, 'G01', ai).ok;
      o.bySys = ENGINE.release(c, 'G01', sys).ok;
      o.byAd = ENGINE.release(c, 'G01', ad).ok;
      ENGINE.markReq(c, 'G02', 'compare', tc);
      o.g02ByAd = ENGINE.release(c, 'G02', ad).ok;
      o.g02ByTc = ENGINE.release(c, 'G02', tc).ok;
      o.refusalsAudited = S.audit.filter((a) => a.caseId === c.id && a.result === 'Refused' && /G0[12]/.test(a.gate || '')).length;
      // G16 belongs to the Records/Compliance Owner and G17 to incident closure; neither a consultant nor the AI can release them.
      o.g16ByTc = ENGINE.canRelease(c, 'G16', tc).ok;
      o.g17 = ENGINE.canRelease(c, 'G17', io).ok;
      return o;
    """)
    assert not r["notReady"]["ok"] and any("Proof of address" in m or "mandate" in m.lower() for m in r["notReady"]["missing"]), r
    assert not r["byTc"] and not r["impostor"] and not r["byAi"] and not r["bySys"], "Rule 1: only the owner role (Administrator) releases G01"
    assert r["byAd"]
    assert not r["g02ByAd"] and r["g02ByTc"], "Rule 1: G02 is the Tax Consultant's"
    assert r["refusalsAudited"] >= 6, "Rule 1/11: every refused release is audited"
    assert not r["g16ByTc"] and not r["g17"]


def test_rule01_mapped_blocking_exception_blocks_its_gate(page):
    r = ev(page, r"""
      const c = H.mk();
      const x = ENGINE.raise(c, 'KYC-05', { by: ad });
      const o = { blocked: ENGINE.canRelease(c, 'G01', ad), state: H.st(c, 'G01') };
      o.resolve = ENGINE.resolve(x, ad, { action: 'Signed mandate received' }).ok;
      o.stillBlocked = ENGINE.canRelease(c, 'G01', ad).codes;   // secondary reviewer (Tax Consultant) still to close
      o.close = ENGINE.close(x, tc).ok;
      o.release = ENGINE.release(c, 'G01', ad).ok;
      return o;
    """)
    assert not r["blocked"]["ok"] and r["blocked"]["codes"] == ["KYC-05"] and r["state"] == "in progress", r
    assert r["resolve"] and r["stillBlocked"] == ["KYC-05"], "Spec: blocking stops at closed when the code has a secondary reviewer"
    assert r["close"] and r["release"]


def test_rule01_gate_map_codes_block_their_gate(page):
    """Every code in the register's Gate Map row for a gate blocks that gate when raised (Blocking Yes or Conditional),
    except the BY_GATE codes, whose resolution is passing the gate, and Blocking No (DOC-05)."""
    r = ev(page, r"""
      const bad = []; let checked = 0;
      REGISTER.gates.filter((g) => g.gate !== 'G17').forEach((row) => row.codes.forEach((code) => {
        const c = H.mk();
        const x = ENGINE.raise(c, code, { by: tc, noSettle: true });
        const def = REGISTER.codes.find((k) => k.code === code);
        const want = def.blocking !== 'No' && !BY_GATE.includes(code);
        const got = ENGINE.gateBlockers(c, row.gate).some((y) => y.id === x.id);
        checked++;
        if (want !== got) bad.push(row.gate + ' ' + code + ' want ' + want + ' got ' + got + ' gates=' + x.gates.join(';'));
      }));
      return { bad, checked };
    """)
    assert r["checked"] > 100
    assert r["bad"] == [], r["bad"]


def test_rule01_runtime_gate_resolution(page):
    r = ev(page, r"""
      const c = H.at('G02');
      const o = {};
      const ai6 = ENGINE.raise(c, 'AI-06', { by: sys });
      o.ai06 = ai6.gates; o.ai06Blocks = H.blk(c, 'G02');
      const c2 = H.mk();
      o.int11Default = ENGINE.raise(c2, 'INT-11', { by: sys }).gates;
      o.int11G10 = ENGINE.raise(H.mk(), 'INT-11', { by: sys, gate: 'G10' }).gates;
      o.int09G15 = ENGINE.raise(H.mk(), 'INT-09', { by: sys, gate: 'G15' }).gates;
      o.int13Default = ENGINE.raise(H.mk(), 'INT-13', { by: tc }).gates;
      // The transaction's own substantive gate: a Declaration Alert response (G10).
      const d = H.at('G12');
      ENGINE.receive({ fn: 'daIn', taxRef: ENGINE.clientOf(d).taxRef, year: d.year, ref: 'DA-1', due: '2027-03-01', date: '2026-11-09' });
      ENGINE.markReq(d, 'G10', 'draft', tc); ENGINE.markReq(d, 'G10', 'support', tc);
      o.g10 = ENGINE.release(d, 'G10', tc).ok;
      const t = H.itx(d, 'da');
      const i9 = ENGINE.raise(d, 'INT-09', { by: ACTOR.sars(), txId: t.id });
      o.int09Tx = i9.gates; o.int09TxLinks = H.codes(d).filter((k) => k === 'SUB-01').length;
      return o;
    """)
    assert r["ai06"] == ["G02"] and "AI-06" in r["ai06Blocks"], "Relevant gate resolves to the case's current gate and blocks it"
    assert r["int11Default"][:1] == ["G09"] and "G18" in r["int11Default"]
    assert r["int11G10"][:1] == ["G10"] and "G18" in r["int11G10"]
    assert r["int09G15"][:1] == ["G15"] and "G18" in r["int09G15"]
    assert r["int13Default"][:1] == ["G09"]
    assert r["g10"] and r["int09Tx"][:1] == ["G10"], "Relevant substantive gate resolves to the transaction's gate"
    assert r["int09TxLinks"] == 0, "Rule 3: INT-09 links to SUB-01 only for an ITR12 submission transaction"


def test_rule01_ai_and_system_never_release_g09(page):
    r = ev(page, r"""
      const c = H.at('G09');
      const o = { ai: ENGINE.release(c, 'G09', ai), sys: ENGINE.release(c, 'G09', sys), rev: ENGINE.release(c, 'G09', ACTOR.reviewer()) };
      o.statusBefore = c.gates.G09.status;
      o.tc = ENGINE.release(c, 'G09', tc).ok;
      o.byType = c.gates.G09.byType; o.by = c.gates.G09.by;
      return o;
    """)
    for k in ("ai", "sys", "rev"):
        assert not r[k]["ok"] and "No system or AI may approve G09" in r[k]["why"], (k, r[k])
    assert r["statusBefore"] == "pending"
    assert r["tc"] and r["byType"] == "human" and r["by"] == ["TC1"]


def test_rule01_client_gates_only_through_portal(page):
    r = ev(page, r"""
      const o = {};
      const c = H.at('G03');
      ENGINE.QUESTIONS.forEach((q) => ENGINE.portal(c, 'answer', { key: q.key, value: ['employment', 'medical'].includes(q.key) }));
      c.questionnaire.status = 'submitted';   // criteria met, so only the actor rule can refuse
      const other = ENGINE.newClient({ name: 'Other', taxRef: '9000000999' });
      o.g03 = [ENGINE.release(c, 'G03', tc).ok, ENGINE.release(c, 'G03', ad).ok, ENGINE.release(c, 'G03', sys).ok,
               ENGINE.release(c, 'G03', ACTOR.client(c.clientId, 'email')).ok, ENGINE.release(c, 'G03', ACTOR.client(other.id, 'portal')).ok];
      c.questionnaire.status = 'open';
      o.g03Portal = ENGINE.portal(c, 'submitQuestionnaire').ok; o.g03Via = c.gates.G03.via; o.g03By = c.gates.G03.by;
      const c6 = H.at('G06');
      o.g06 = [ENGINE.release(c6, 'G06', tc).ok, ENGINE.release(c6, 'G06', ACTOR.client(c6.clientId, 'email')).ok];
      o.g06Portal = ENGINE.portal(c6, 'approve', { version: ENGINE.vN(c6), declaration: true }).ok;
      const c14 = H.at('G14');
      c14.decision = { choice: 'accept', at: now(), note: '' };
      o.g14 = [ENGINE.release(c14, 'G14', tc).ok, ENGINE.release(c14, 'G14', ai).ok];
      c14.decision = null;
      o.g14Portal = ENGINE.portal(c14, 'decide', { choice: 'accept' }).ok;
      o.g14Status = c14.gates.G14.status;
      return o;
    """)
    assert r["g03"] == [False] * 5, "G03 passes only through the client's own portal action"
    assert r["g03Portal"] and r["g03Via"] == "portal"
    assert r["g06"] == [False, False] and r["g06Portal"]
    assert r["g14"] == [False, False] and r["g14Portal"] and r["g14Status"] == "released"


def test_rule01_g18_needs_two_different_people(page):
    r = ev(page, r"""
      const c = H.at('G18');
      const t = H.itx(c);
      const o = { status0: t.status, canRelease: ENGINE.canRelease(c, 'G18', ia).ok, viaRelease: ENGINE.release(c, 'G18', ia).ok };
      o.ai = ENGINE.signG18(t, ai).ok; o.io = ENGINE.signG18(t, io).ok;
      o.impostor = ENGINE.signG18(t, ACTOR.as('Integration Administrator', 'TC1')).ok;
      o.first = ENGINE.signG18(t, ia).ok; o.afterFirst = [t.status, c.gates.G18.status];
      o.samePerson = ENGINE.signG18(t, ia);
      const ia2 = H.addPerson('IA2', 'Integration Administrator');
      o.sameRole = ENGINE.signG18(t, ia2);
      o.transmitEarly = ENGINE.transmit(t, ia, 'success').ok;
      return o;
    """)
    assert r["status0"] == "awaiting G18" and not r["canRelease"] and not r["viaRelease"]
    assert not r["ai"] and not r["io"] and not r["impostor"]
    assert r["first"] and r["afterFirst"] == ["awaiting G18", "pending"], "One sign-off must not release G18"
    assert not r["samePerson"]["ok"], "G18: the same person cannot sign twice"
    assert not r["sameRole"]["ok"], "G18: the same role cannot sign twice"
    assert not r["transmitEarly"], "A single sign-off must not let the transaction go"
    r2 = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c);
      const a = ENGINE.signG18(t, tc).ok; const b = ENGINE.signG18(t, ia).ok;
      return { a, b, status: t.status, gate: c.gates.G18.status, by: c.gates.G18.by.slice().sort(), signoffs: t.signoffs.map((s) => s.role).sort() };
    """)
    assert r2["a"] and r2["b"] and r2["status"] == "ready" and r2["gate"] == "released", r2
    assert r2["by"] == ["IA1", "TC1"] and r2["signoffs"] == ["Integration Administrator", "Tax Consultant"]


# ---------------------------------------------------------------------------------------------------------------------------
# Rule 2: severity
# ---------------------------------------------------------------------------------------------------------------------------

def test_rule02_s1_hard_stops_every_gate_but_g17(page):
    r = ev(page, r"""
      const c = H.at('G02');
      ENGINE.markReq(c, 'G02', 'compare', tc);
      const s2 = ENGINE.raise(c, 'TAX-01', { by: tc });   // S2 on G05 only: does not touch G02
      const o = { s2Only: ENGINE.canRelease(c, 'G02', tc).ok };
      const x = ENGINE.raise(c, 'SEC-02', { by: io });   // S1 mapped to G17 only
      o.byGate = {}; GATE_IDS.forEach((g) => { o.byGate[g] = ENGINE.gateBlockers(c, g).some((y) => y.id === x.id); });
      o.g02 = ENGINE.canRelease(c, 'G02', tc);
      o.incident = S.incidents.filter((i) => i.caseId === c.id).map((i) => i.codes);
      return o;
    """)
    assert r["s2Only"], "An S2 mapped to G05 must not block G02"
    assert r["byGate"]["G17"] is False, "G17 (incident handling) is never stopped by S1"
    assert all(v for g, v in r["byGate"].items() if g != "G17"), ("Rule 2: S1 hard-stops every gate on the case", r["byGate"])
    assert not r["g02"]["ok"] and "SEC-02" in r["g02"]["codes"]
    assert r["incident"] == [["SEC-02"]]


def test_rule02_s2_blocks_without_override(page):
    r = ev(page, r"""
      const c = H.at('G02'); ENGINE.markReq(c, 'G02', 'compare', tc);
      const x = ENGINE.raise(c, 'MD-05', { by: tc });
      return { sev: x.sev, r: ENGINE.canRelease(c, 'G02', tc), blocks: ENGINE.blocksNow(x) };
    """)
    assert r["sev"] == "S2" and r["blocks"] and not r["r"]["ok"] and r["r"]["codes"] == ["MD-05"]


def test_rule02_s3_holds_only_its_item_parallel_work(page):
    r = ev(page, r"""
      const c = H.at('G04');
      const [i1, i2] = c.items;
      const cl = ACTOR.client(c.clientId);
      const u1 = ENGINE.upload(c, i1.id, { name: 'IRP5_2026_scan.pdf', size: 245760 }, cl);   // low confidence: AI-01 (S3)
      const o = { d1: u1.doc.status, i1: ENGINE.itemState(c, i1) };
      const u2 = ENGINE.upload(c, i2.id, { name: 'Medical_scheme_certificate_2026.pdf', size: 245760 }, cl);
      o.d2 = u2.doc.status; o.i2 = ENGINE.itemState(c, i2);
      const x = H.ex(c, 'AI-01'); o.sev = x.sev; o.item = x.item;
      o.g04Blockers = H.blk(c, 'G04'); o.g04 = c.gates.G04.status;
      ENGINE.resolve(x, ad, { action: 'Clear copy confirmed by the administrator' });
      o.afterResolve = c.gates.G04.status;
      ENGINE.close(x, tc);
      o.afterClose = [c.gates.G04.status, u1.doc.status, ENGINE.itemState(c, i1)];
      return o;
    """)
    assert r["sev"] == "S3" and r["d1"] == "held" and r["i1"] == "held"
    assert r["d2"] == "validated" and r["i2"] == "validated", "Rule 2: S3 holds only its item; other items still validate"
    assert "AI-01" in r["g04Blockers"] and r["g04"] == "pending", "S3 with Blocking=Yes still blocks the mapped gate"
    assert r["afterResolve"] == "pending", "AI-01 has a secondary reviewer: blocks until closed"
    assert r["afterClose"] == ["released", "validated", "validated"], r


def test_rule02_s4_only_logs(page):
    r = ev(page, r"""
      const c = H.at('G04'); const cl = ACTOR.client(c.clientId);
      const [i1, i2] = c.items;
      ENGINE.upload(c, i1.id, { name: 'IRP5_2026.pdf', size: 245760 }, cl);
      const dup = ENGINE.upload(c, i1.id, { name: 'IRP5_2026.pdf', size: 245760 }, cl);
      const x = H.ex(c, 'DOC-05');
      const o = { sev: x && x.sev, blocking: x && x.blocking, dup: dup.doc.status, i1: ENGINE.itemState(c, i1), blocks: x && ENGINE.blocksNow(x),
        logged: S.audit.some((a) => a.code === 'DOC-05' && a.result === 'Raised') };
      ENGINE.upload(c, i2.id, { name: 'Medical_scheme_certificate_2026.pdf', size: 245760 }, cl);
      o.g04 = c.gates.G04.status;
      return o;
    """)
    assert r["sev"] == "S4" and r["blocking"] == "No" and r["dup"] == "duplicate" and r["i1"] == "validated"
    assert r["blocks"] is False and r["logged"], "S4 is logged, never blocking"
    assert r["g04"] == "released"


def test_rule02_conditional_codes_need_recorded_and_reconciled_fallback(page):
    r = ev(page, r"""
      const out = {};
      for (const code of ['AI-06', 'INT-03', 'INT-13', 'INT-15']) {
        const c = H.at('G02');
        const x = ENGINE.raise(c, code, { by: sys });
        const g = x.gates[0];
        const o = { blocking: x.blocking, gate: g, raised: ENGINE.blocksNow(x), onGate: H.blk(c, g).includes(code) };
        o.reconcileFirst = ENGINE.reconcileFallback(x, tc2).ok;
        o.record = ENGINE.recordFallback(x, tc, { note: 'Manual channel used', ref: 'M-1' }).ok;
        o.afterRecord = ENGINE.blocksNow(x);
        o.samePerson = ENGINE.reconcileFallback(x, tc).ok;
        o.afterSame = ENGINE.blocksNow(x);
        o.other = ENGINE.reconcileFallback(x, tc2).ok;
        o.afterOther = ENGINE.blocksNow(x); o.onGateAfter = H.blk(c, g).includes(code);
        out[code] = o;
      }
      return out;
    """)
    for code, o in r.items():
        assert o["blocking"] == "Conditional" and o["raised"] and o["onGate"], (code, o)
        assert not o["reconcileFirst"] and o["record"] and o["afterRecord"], (code, "recorded but not reconciled still blocks", o)
        assert not o["samePerson"] and o["afterSame"], (code, "the recorder cannot reconcile their own fallback", o)
        assert o["other"] and not o["afterOther"] and not o["onGateAfter"], (code, o)


def test_rule02_ai_may_raise_severity_but_not_lower(page):
    r = ev(page, r"""
      const c = H.at('G02');
      const x = ENGINE.raise(c, 'MD-01', { by: tc });   // S3
      const o = { up: ENGINE.setSeverity(x, ai, 'S2', { reason: 'Looks material' }).ok, sev1: x.sev };
      o.down = ENGINE.setSeverity(x, ai, 'S3', { reason: 'Changed my mind' }).ok; o.sev2 = x.sev;
      const y = ENGINE.raise(c, 'MD-02', { by: tc });   // S3, owner Administrator
      o.humanDownNoReason = ENGINE.setSeverity(y, tc, 'S4', {}).ok;
      o.humanDown = ENGINE.setSeverity(y, tc, 'S4', { reason: 'Cosmetic only' }).ok;
      o.y = [y.sev, y.blocking, ENGINE.blocksNow(y)];
      o.upAgain = ENGINE.setSeverity(y, ai, 'S3', { reason: 'x' }).ok; o.y2 = [y.sev, y.blocking];
      o.audited = S.audit.filter((a) => a.exceptionId === x.id && /severity|Lowering/i.test(a.text)).length;
      return o;
    """)
    assert r["up"] and r["sev1"] == "S2"
    assert not r["down"] and r["sev2"] == "S2", "Rule 2: the AI may raise severity but never lower it"
    assert not r["humanDownNoReason"] and r["humanDown"] and r["y"] == ["S4", "No", False]
    assert r["upAgain"] and r["y2"] == ["S3", "Yes"]
    assert r["audited"] >= 2


def test_rule02_lowering_s1_s2_needs_records_compliance_approval(page):
    r = ev(page, r"""
      const c = H.at('G02'); ENGINE.markReq(c, 'G02', 'compare', tc);
      const x = ENGINE.raise(c, 'MD-05', { by: tc });   // S2
      const o = { req: ENGINE.setSeverity(x, tc, 'S3', { reason: 'Bank letter on file' }), pendingSev: x.sev, stillBlocks: ENGINE.blocksNow(x) };
      o.byTc2 = ENGINE.approveSeverity(x, tc2).ok; o.byRequester = ENGINE.approveSeverity(x, tc).ok;
      o.byRc = ENGINE.approveSeverity(x, rc).ok; o.sev = x.sev;
      const y = ENGINE.raise(c, 'VER-03', { by: tc });   // S1
      ENGINE.setSeverity(y, rc, 'S2', { reason: 'Version confirmed' });
      o.selfApprove = ENGINE.approveSeverity(y, rc).ok; o.ySev = y.sev;
      const rc2 = H.addPerson('RC2', 'Records/Compliance Owner');
      o.otherRc = ENGINE.approveSeverity(y, rc2).ok; o.ySev2 = y.sev;
      o.audit = S.audit.filter((a) => a.exceptionId === x.id || a.exceptionId === y.id).map((a) => a.result);
      return o;
    """)
    assert r["req"]["ok"] and r["req"].get("pending") and r["pendingSev"] == "S2" and r["stillBlocks"]
    assert not r["byTc2"] and not r["byRequester"], "Only the Records/Compliance Owner approves lowering an S2"
    assert r["byRc"] and r["sev"] == "S3"
    assert not r["selfApprove"] and r["ySev"] == "S1", "The approver must not be the requester"
    assert r["otherRc"] and r["ySev2"] == "S2"
    assert "Requested" in r["audit"] and "Refused" in r["audit"] and "Changed" in r["audit"]


# ---------------------------------------------------------------------------------------------------------------------------
# Rule 3: the exception object
# ---------------------------------------------------------------------------------------------------------------------------

def test_rule03_exception_object_has_the_14_document_fields(page):
    r = ev(page, r"""
      const st = WORKFLOW.phases.flatMap((p) => p.steps).find((s) => s.n === 26);
      const grp = (st.groups || []).find((g) => g.title === 'Mandatory exception object');
      const c = H.mk();
      const x = ENGINE.raise(c, 'KYC-03', { by: tc, note: 'ID number differs' });
      const missing = EX_OBJECT.flatMap((f) => f.keys).filter((k) => !(k in x));
      return { labels: EX_OBJECT.map((f) => f.label), doc: grp ? grp.items : null, missing, raisedBy: x.raisedBy, gr: x.gateReleased,
               ha: x.humanApproval, ids: [x.id, x.caseId, x.clientId, x.year] };
    """)
    assert r["doc"] is not None and len(r["doc"]) == 14
    assert r["labels"] == r["doc"], "EX_OBJECT must equal the master document's step 26 group"
    assert r["missing"] == [], r["missing"]
    assert r["raisedBy"] == "human" and r["ha"] is True and r["gr"].startswith("G01:"), r
    assert r["ids"][0].startswith("X") and r["ids"][3] == 2026


def test_rule03_defaults_come_from_the_register_for_all_116_codes(page):
    r = ev(page, r"""
      const bad = []; let n = 0;
      REGISTER.codes.forEach((row) => {
        const c = H.mk();
        const res = ENGINE.raiseManual(c, row.code, tc, { note: 'picker' });
        if (!res.ok) { bad.push(row.code + ' refused: ' + res.why); return; }
        const x = res.exception; n++;
        const regGates = (row.gates.match(/G\d\d/g) || []);
        const diff = [];
        if (x.severity !== row.severity) diff.push('severity ' + x.severity);
        if (x.blocking !== row.blocking) diff.push('blocking ' + x.blocking);
        if (x.owner !== row.owner) diff.push('owner ' + x.owner);
        if ((x.secondary || null) !== (row.secondary || null)) diff.push('secondary ' + x.secondary);
        if (x.trigger !== row.trigger) diff.push('trigger');
        if (x.stage !== row.stage) diff.push('stage');
        if (x.title !== row.title) diff.push('title');
        if (!regGates.every((g) => x.gates.includes(g))) diff.push('gates ' + x.gates.join(';'));
        if (x.humanApproval !== (row.severity.startsWith('S1') || row.severity.startsWith('S2'))) diff.push('humanApproval');
        if (diff.length) bad.push(row.code + ': ' + diff.join(', '));
      });
      const c = H.mk();
      return { bad, n, aiPicker: ENGINE.raiseManual(c, 'KYC-01', ai).ok, clientPicker: ENGINE.raiseManual(c, 'KYC-01', ACTOR.client(c.clientId)).ok };
    """)
    assert r["n"] == 116 and r["bad"] == [], r["bad"]
    assert not r["aiPicker"] and not r["clientPicker"], "The Raise-exception picker is for a person (staff)"


def test_rule03_status_lifecycle(page):
    r = ev(page, r"""
      const c = H.mk({}, { consultant: 'TC2' });
      const allowed = ['raised', 'assigned', 'awaiting client', 'resolved', 'closed'];
      const q = ENGINE.raise(c, 'QUE-01', { by: sys });
      const k = ENGINE.raise(c, 'KYC-05', { by: ad });
      const t = ENGINE.raise(c, 'MD-03', { by: tc });
      const o = { q: q.status, k: k.status, kAssignee: k.assignee, t: t.assignee, qAction: !!q.clientAction };
      o.closeEarly = ENGINE.close(k, tc).ok;
      ENGINE.resolve(k, ad, { action: 'Mandate signed', evidence: 'Mandate v2' });
      o.kResolved = [k.status, k.resolvedById, !!k.resolvedAt, k.evidence];
      ENGINE.close(k, tc);
      o.kClosed = [k.status, k.closedById];
      o.reresolve = ENGINE.resolve(k, ad, { action: 'again' }).ok;
      o.noAction = ENGINE.resolve(t, tc2, { action: '  ' }).ok;
      o.all = S.exceptions.every((x) => allowed.includes(x.status));
      return o;
    """)
    assert r["q"] == "awaiting client" and r["qAction"], "Client-owned exceptions wait for the client"
    assert r["k"] == "assigned" and r["kAssignee"] == "AD1" and r["t"] == "TC2", "Tax Consultant codes go to the case consultant"
    assert not r["closeEarly"]
    assert r["kResolved"] == ["resolved", "AD1", True, "Mandate v2"] and r["kClosed"] == ["closed", "TC1"]
    assert not r["reresolve"] and not r["noAction"] and r["all"]


def test_rule03_secondary_reviewer_must_be_a_different_person(page):
    r = ev(page, r"""
      const c = H.mk();
      const x = ENGINE.raise(c, 'KYC-05', { by: ad });   // owner Administrator, secondary Tax Consultant
      ENGINE.resolve(x, ad, { action: 'Mandate signed' });
      const o = { wrongRole: ENGINE.close(x, ad).ok };
      S.people.find((p) => p.id === 'AD1').role = 'Tax Consultant';   // the same person now holds the secondary role
      o.samePerson = ENGINE.close(x, ACTOR.as('Tax Consultant', 'AD1'));
      o.other = ENGINE.close(x, tc).ok; o.status = x.status;
      return o;
    """)
    assert not r["wrongRole"]
    assert not r["samePerson"]["ok"] and "different person" in r["samePerson"]["why"]
    assert r["other"] and r["status"] == "closed"


def test_rule03_auto_link_doc04_raises_sec01_and_an_incident(page):
    r = ev(page, r"""
      const c = H.at('G04', { others: ['Sarah Smith'] });
      const u = ENGINE.upload(c, c.items[0].id, { name: 'IRP5_2026_Sarah.pdf', size: 245760 }, ACTOR.client(c.clientId));
      const d4 = H.ex(c, 'DOC-04'); const s1 = H.ex(c, 'SEC-01');
      const inc = S.incidents.filter((i) => i.caseId === c.id);
      const o = { doc: u.doc.status, d4: !!d4, s1: !!s1, rel: d4 && s1 && d4.related.includes(s1.id) && s1.related.includes(d4.id), parent: s1 && s1.parent === d4.id,
        inc: inc.map((i) => i.codes.slice().sort()), sameInc: d4 && s1 && d4.incidentId === s1.incidentId };
      o.resolveFirst = ENGINE.resolve(d4, io, { action: 'Removed' });
      return o;
    """)
    assert r["doc"] == "quarantined" and r["d4"] and r["s1"] and r["rel"] and r["parent"], r
    assert r["inc"] == [["DOC-04", "SEC-01"]] and r["sameInc"]
    assert not r["resolveFirst"]["ok"]


def test_rule03_auto_links_sub01_int09_both_ways_on_itr12(page):
    r = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c);
      const s = ENGINE.raise(c, 'SUB-01', { by: ACTOR.sars(), txId: t.id });
      const i = H.ex(c, 'INT-09');
      const c2 = H.at('G18'); const t2 = H.itx(c2);
      const n = ENGINE.raise(c2, 'SUB-03', { by: sys, txId: t2.id }); const m = H.ex(c2, 'INT-10');
      return { i: !!i && i.related.includes(s.id) && s.related.includes(i.id), m: !!m && m.related.includes(n.id) };
    """)
    assert r["i"] and r["m"], r


def test_rule03_by_gate_codes(page):
    r = ev(page, r"""
      const o = {};
      // DA-01 does not block G10 and closes once G10 and its SARS transaction are done.
      const c = H.at('G12');
      ENGINE.receive({ fn: 'daIn', taxRef: ENGINE.clientOf(c).taxRef, year: c.year, ref: 'DA-77', due: '2027-03-01', date: '2026-11-09' });
      const da = H.ex(c, 'DA-01');
      o.flag = c.flags.da; o.cur = ENGINE.currentGate(c);
      ENGINE.markReq(c, 'G10', 'draft', tc); ENGINE.markReq(c, 'G10', 'support', tc);
      o.g10 = ENGINE.canRelease(c, 'G10', tc);
      o.manualResolve = ENGINE.resolve(da, tc, { action: 'done' }).ok;
      ENGINE.release(c, 'G10', tc);
      o.afterRelease = da.status;
      const t = H.itx(c, 'da'); H.sign2(t); ENGINE.transmit(t, ia, 'success');
      o.afterTx = [da.status, da.resolvedBy, da.closedBy];
      // REM-08 raised after G12-G14 passed re-opens them; it does not block them.
      const d = H.at('G16');
      const pre = ['G12', 'G13', 'G14'].map((g) => d.gates[g].status);
      const n = H.auditLen();
      const x = ENGINE.raise(d, 'REM-08', { by: ACTOR.sars(), note: 'Outcome' });
      // G12 is an AI gate: once re-opened, the AI may pass it again straight away (Rule 12), so read the re-open from the audit.
      const reopened = S.audit.slice(n).filter((a) => a.result === 'Re-opened').map((a) => a.gate).join('; ');
      o.rem08 = { pre, reopened, post: ['G13', 'G14'].map((g) => d.gates[g].status), g12: [d.gates.G12.status, d.gates.G12.byType],
                  cur: ENGINE.currentGate(d), blocksG13: H.blk(d, 'G13').includes('REM-08'), status: x.status };
      return o;
    """)
    assert r["flag"] is True and r["cur"] == "G10"
    assert r["g10"]["ok"] and "DA-01" not in r["g10"]["codes"], "BY_GATE codes do not block their own gate"
    assert not r["manualResolve"]
    assert r["afterRelease"] != "closed", "G10 is done only after its SARS transaction succeeds"
    assert r["afterTx"][0] == "closed" and r["afterTx"][1] == "TC1", r["afterTx"]
    assert r["rem08"]["pre"] == ["released"] * 3
    assert all(g in r["rem08"]["reopened"] for g in ("G12", "G13", "G14")), ("REM-08 re-opens G12 to G14", r["rem08"])
    assert r["rem08"]["post"] == ["invalidated"] * 2 and r["rem08"]["cur"] in ("G12", "G13"), r["rem08"]
    assert r["rem08"]["g12"] in (["invalidated", "ai"], ["released", "ai"]), r["rem08"]
    assert not r["rem08"]["blocksG13"] and r["rem08"]["status"] != "closed"


# ---------------------------------------------------------------------------------------------------------------------------
# Rule 4: overrides
# ---------------------------------------------------------------------------------------------------------------------------

NEVER = ["VER-03", "SUB-02", "CLT-04", "CLT-06", "PRE-03", "SUB-05", "SEC-05", "SEC-07", "SEC-01", "DOC-04", "DOC-10",
         "INT-04", "INT-08", "INT-09", "RET-01", "RET-04"]


def test_rule04_policy_list_starts_empty(page):
    r = ev(page, "return { p0: POLICY0.overridable, s: S.policy.overridable, pending: PENDING_JOHAN.some((q) => q.id === 'q-policy' || q.id === 'q-override') };")
    assert r["p0"] == [] and r["s"] == [] and r["pending"]


def test_rule04_overrides_refused_for_the_never_list(page):
    r = ev(page, r"""
      const out = {};
      for (const code of arg) {
        const c = H.mk();
        const x = ENGINE.raise(c, code, { by: tc, noSettle: true });
        const pol = ENGINE.setOverridable(code, true, rc).ok;
        S.policy.overridable.push(code);   // even a wrongly configured policy must not open these
        const req = ENGINE.requestOverride(x, tc, { reason: 'Need to proceed', evidence: 'Partner sign-off' });
        out[code] = { sev: x.sev, pol, req: req.ok, why: req.why, ov: x.override };
      }
      return out;
    """, NEVER)
    for code, o in r.items():
        assert not o["pol"] and not o["req"] and o["ov"] is None, (code, o)


def test_rule04_s2_not_on_the_list_is_refused_and_approval_rules(page):
    r = ev(page, r"""
      const c = H.at('G02'); ENGINE.markReq(c, 'G02', 'compare', tc);
      const x = ENGINE.raise(c, 'MD-05', { by: tc });
      const o = {}; let n = H.auditLen(); const step = () => { const d = H.auditLen() - n; n = H.auditLen(); return d; };
      o.notListed = ENGINE.requestOverride(x, tc, { reason: 'r', evidence: 'e' }).ok; o.a1 = step();
      o.polByTc = ENGINE.setOverridable('MD-05', true, tc).ok; o.a2 = step();
      o.pol = ENGINE.setOverridable('MD-05', true, rc).ok; o.a3 = step();
      o.noEvidence = ENGINE.requestOverride(x, tc, { reason: 'r' }).ok; o.a4 = step();
      o.req = ENGINE.requestOverride(x, tc, { reason: 'Bank changed; letter on file', evidence: 'Bank letter 2026-11-02' }).ok; o.a5 = step();
      o.rec = Object.assign({}, x.override);
      o.byTc2 = ENGINE.approveOverride(x, tc2).ok; o.a6 = step();
      o.stillBlocked = !ENGINE.canRelease(c, 'G02', tc).ok;
      o.byRc = ENGINE.approveOverride(x, rc).ok; o.a7 = step();
      o.after = [x.override.status, x.override.approvedBy, ENGINE.blocksNow(x), ENGINE.canRelease(c, 'G02', tc).ok];
      // The Records/Compliance Owner cannot approve their own request.
      const y = ENGINE.raise(c, 'MD-03', { by: tc }); ENGINE.setOverridable('MD-03', true, rc);
      ENGINE.requestOverride(y, rc, { reason: 'r', evidence: 'e' });
      o.self = ENGINE.approveOverride(y, rc).ok; o.a8 = step();
      return o;
    """)
    assert not r["notListed"] and r["a1"] >= 1, "S2 codes not on the (empty) policy list are refused, and the attempt is audited"
    assert not r["polByTc"] and r["a2"] >= 1 and r["pol"] and r["a3"] >= 1
    assert not r["noEvidence"] and r["a4"] >= 1
    assert r["req"] and r["a5"] >= 1
    rec = r["rec"]
    for k in ("requestedBy", "role", "reason", "evidence", "at", "version", "status"):
        assert k in rec and (rec[k] is not None or k == "version"), (k, rec)
    assert rec["requestedBy"] == "TC1" and rec["role"] == "Tax Consultant"
    assert not r["byTc2"] and r["a6"] >= 1 and r["stillBlocked"]
    assert r["byRc"] and r["a7"] >= 1 and r["after"] == ["approved", "RC1", False, True], r["after"]
    assert not r["self"] and r["a8"] >= 1


def test_rule04_override_lapses_on_a_new_version(page):
    r = ev(page, r"""
      const c = H.at('G05');
      ENGINE.change(c, tc, ENGINE.stubData(c), { reason: 'First calculation' });   // version 1
      const x = ENGINE.raise(c, 'TAX-02', { by: tc });   // S2 on G05
      ENGINE.setOverridable('TAX-02', true, rc);
      ENGINE.requestOverride(x, tc, { reason: 'Home office accepted', evidence: 'Floor plan' });
      ENGINE.approveOverride(x, rc);
      const o = { v: x.override.version, ok1: ENGINE.canRelease(c, 'G05', tc).ok };
      const d = ENGINE.stubData(c); d.calc.summary.normalTax = 99;
      ENGINE.change(c, tc, d, { reason: 'Revised' });
      o.after = [x.override.status, ENGINE.blocksNow(x), ENGINE.canRelease(c, 'G05', tc).ok, ENGINE.vN(c)];
      return o;
    """)
    assert r["ok1"] and r["v"] == 1
    assert r["after"][0] != "approved" and r["after"][1] and not r["after"][2] and r["after"][3] == 2, r


# ---------------------------------------------------------------------------------------------------------------------------
# Rule 5: versions and hashes
# ---------------------------------------------------------------------------------------------------------------------------

def test_rule05_sha256_matches_subtlecrypto(page):
    page.evaluate("() => { TICKERS.splice(0); seed(); }")
    r = page.evaluate(r"""async () => {
      const ins = ['', 'abc', 'The quick brown fox jumps over the lazy dog', 'é漢字🙂 ünïcödé', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63),
                   'a'.repeat(64), 'a'.repeat(65), 'a'.repeat(119), 'a'.repeat(120), 'é'.repeat(28), 'x'.repeat(1 << 20)];
      const out = [];
      for (const s of ins) {
        const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
        const hex = Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
        out.push([s.length, hex === sha256(s)]);
      }
      return { out, empty: sha256(''), abc: sha256('abc') };
    }""")
    assert all(ok for _, ok in r["out"]), r["out"]
    assert r["empty"] == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    assert r["abc"] == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_rule05_canonical_json_is_key_order_independent(page):
    r = ev(page, r"""
      const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: 'é' }, u: undefined };
      const b = { a: { c: 'é', d: [1, { x: 1, y: 2 }] }, b: 1 };
      return { ca: ENGINE.canon(a), cb: ENGINE.canon(b), da: ENGINE.digest(a), db: ENGINE.digest(b), sh: sha256(ENGINE.canon(b)),
               order: ENGINE.canon([2, 1]) !== ENGINE.canon([1, 2]), diff: ENGINE.digest({ a: 1 }) !== ENGINE.digest({ a: 2 }) };
    """)
    assert r["ca"] == r["cb"] and r["da"] == r["db"] == r["sh"] and r["order"] and r["diff"]
    assert r["cb"] == '{"a":{"c":"é","d":[1,{"x":1,"y":2}]},"b":1}'


def test_rule05_versions_hash_and_g06_binds_to_them(page):
    r = ev(page, r"""
      const c = H.at('G09');   // G07 (system) and G08 (AI) pass on their own as soon as G06 does
      const v = ENGINE.curVersion(c);
      return { v: { calc: v.calc, sch: v.schedules, itr: v.itr12, docs: v.docs },
               want: { calc: sha256(ENGINE.canon(c.calc)), sch: sha256(ENGINE.canon(c.schedules)), itr: sha256(ENGINE.canon(c.itr12)), docs: ENGINE.digest(c.docs.map((d) => d.hash)) },
               ap: { version: c.approval.version, calc: c.approval.calc, itr: c.approval.itr12, decl: c.approval.declaration === DECLARATION }, n: v.n };
    """)
    assert r["v"] == r["want"]
    assert r["ap"]["version"] == r["n"] and r["ap"]["calc"] == r["v"]["calc"] and r["ap"]["itr"] == r["v"]["itr"] and r["ap"]["decl"]


def test_rule05_change_after_approval_raises_ver01_and_reopens_g05_onward(page):
    r = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c);
      const pre = ['G05', 'G06', 'G07', 'G08', 'G09'].map((g) => c.gates[g].status);
      const d = ENGINE.stubData(c); d.calc.summary.normalTax = 4321;
      const ch = ENGINE.change(c, tc, d, { reason: 'Late IRP5 received' });
      return { pre, ch: ch.ok, v: ENGINE.vN(c), ver01: H.openCodes(c).includes('VER-01'), sup: c.approval.superseded,
               post: ['G05', 'G06', 'G07', 'G08', 'G09'].map((g) => c.gates[g].status), frozen: c.frozen, tx: t.status,
               cur: ENGINE.currentGate(c), problem: ENGINE.approvalProblem(c) };
    """)
    assert r["pre"] == ["released"] * 5 and r["ch"] and r["v"] == 2
    assert r["ver01"] and r["sup"], "Rule 5: VER-01 and a superseded approval"
    assert r["post"] == ["invalidated"] * 5, ("Rule 5: G05-G09 approvals invalidated", r["post"])
    assert r["frozen"] is None and r["tx"] == "cancelled" and r["cur"] == "G05" and r["problem"]


def test_rule05_change_before_approval_is_not_ver01_and_refused_after_submission(page):
    r = ev(page, r"""
      const c = H.at('G06');
      const d = ENGINE.stubData(c); d.calc.summary.paye = 10;
      const o = { ch: ENGINE.change(c, tc, d, { reason: 'Fix' }).ok, ver01: H.codes(c).includes('VER-01') };
      o.noReason = ENGINE.change(c, tc, d, {}).ok;
      o.byAd = ENGINE.change(c, ad, d, { reason: 'x' }).ok;
      const s = H.at('G16');
      o.afterSubmit = ENGINE.change(s, tc, ENGINE.stubData(s), { reason: 'x' }).ok;
      return o;
    """)
    assert r["ch"] and not r["ver01"] and not r["noReason"] and not r["byAd"] and not r["afterSubmit"]


def test_rule05_outside_edit_raises_ver02(page):
    r = ev(page, r"""
      const c = H.at('G06');
      const before = H.auditLen();
      ENGINE.outsideEdit(c, { calc: { summary: { normalTax: 1 } } });
      const o = { drift: ENGINE.drift(c) };
      ENGINE.watch();
      const x = H.ex(c, 'VER-02');
      o.x = x && [x.sev, x.status]; o.blocksG06 = H.blk(c, 'G06').includes('VER-02'); o.blocksG01 = H.blk(c, 'G01').includes('VER-02');
      o.restoreTc = ENGINE.restoreVersion(c, tc).ok;
      o.restore = ENGINE.restoreVersion(c, ACTOR.platform('Platform Administrator')).ok; o.drift2 = ENGINE.drift(c);
      // settle() also catches it
      const c2 = H.at('G06'); ENGINE.outsideEdit(c2, { itr12: { taxRef: 'x' } }); ENGINE.settle(c2);
      o.settle = H.openCodes(c2).includes('VER-02');
      return o;
    """)
    assert r["drift"] == ["calc"]
    assert r["x"] == ["S1", "assigned"] and r["blocksG06"] and r["blocksG01"], r
    assert not r["restoreTc"] and r["restore"] and r["drift2"] == []
    assert r["settle"]


# ---------------------------------------------------------------------------------------------------------------------------
# Rule 6: G18 and the simulated SARS link
# ---------------------------------------------------------------------------------------------------------------------------

def test_rule06_request_before_substantive_gate_raises_int11(page):
    r = ev(page, r"""
      const c = H.at('G09');
      const rq = ENGINE.requestTx(c, 'itr12', tc);
      const x = H.ex(c, 'INT-11');
      const o = { rq: rq.ok, x: x && [x.sev, x.gates], txs: S.txs.filter((t) => t.caseId === c.id).length, g09: ENGINE.canRelease(c, 'G09', tc) };
      // transmit with G09 passed but no G18 sign-off
      const d = H.at('G18'); const t = H.itx(d);
      const tr = ENGINE.transmit(t, ia, 'success');
      o.tr = tr.ok; o.trX = H.openCodes(d).includes('INT-11'); o.status = t.status; o.sub = d.submission;
      o.audited = S.audit.some((a) => a.caseId === d.id && a.code === 'INT-11' && a.result === 'Refused');
      return o;
    """)
    assert not r["rq"] and r["x"][0] == "S1" and "G09" in r["x"][1] and "G18" in r["x"][1]
    assert r["txs"] == 0, "No transaction may be queued before its substantive gate"
    assert not r["g09"]["ok"] and "INT-11" in r["g09"]["codes"]
    assert not r["tr"] and r["trX"] and r["status"] == "awaiting G18" and r["sub"] is None and r["audited"]


def test_rule06_the_eight_g18_checks(page):
    r = ev(page, r"""
      const st = WORKFLOW.phases.flatMap((p) => p.steps).find((s) => s.n === 17);
      const c = H.at('G18'); const t = H.itx(c);
      const ok = ENGINE.g18Checks(t);
      ENGINE.setLink({ auth: false }, ia);
      const bad = ENGINE.signG18(t, ia);
      ENGINE.setLink({ auth: true }, ia);
      return { doc: st.items, labels: G18_CHECKS, got: ok.map((k) => k.label), allOk: ok.every((k) => k.ok), n: ok.length,
               bad: bad.ok, failing: (bad.checks || []).filter((k) => !k.ok).map((k) => k.n), int01: H.codes(c).includes('INT-01') };
    """)
    assert r["n"] == 8 and r["labels"] == r["doc"] and r["got"] == r["doc"]
    assert r["allOk"]
    assert not r["bad"] and 3 in r["failing"] and r["int01"]


def test_rule06_success_captures_reference(page):
    r = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c); H.sign2(t);
      const res = ENGINE.transmit(t, ia, 'success');
      return { ok: res.ok, status: t.status, ref: t.ref, want: 'SARS-' + sha256(t.id + t.hash).slice(0, 10), sub: c.submission && [c.submission.ok, c.submission.ref, c.submission.hash === ENGINE.curVersion(c).itr12],
               g18: c.gates.G18.status, done: ENGINE.stepDone(c, 'G18'), audit: S.audit.some((a) => a.sarsRef === t.ref), cur: ENGINE.currentGate(c) };
    """)
    assert r["ok"] and r["status"] == "success"
    assert r["ref"].lower() == r["want"].lower(), "Reference is 'SARS-' + the first 10 hex characters of sha256(id + hash)"
    assert r["sub"] == [True, r["ref"], True] and r["g18"] == "released" and r["done"] and r["audit"] and r["cur"] == "G12"


def test_rule06_reject_raises_int09_and_sub01(page):
    r = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c); H.sign2(t);
      ENGINE.transmit(t, ia, 'reject');
      const i = H.ex(c, 'INT-09'); const s = H.ex(c, 'SUB-01');
      return { status: t.status, i: i && [i.raisedBy, ENGINE.isOpen(i)], s: !!s && ENGINE.isOpen(s), rel: !!(i && s && i.related.includes(s.id)),
               g09: c.gates.G09.status, g18: c.gates.G18.status, sub: c.submission };
    """)
    assert r["status"] == "rejected" and r["i"] == ["SARS", True] and r["s"] and r["rel"]
    assert r["g09"] == "invalidated" and r["g18"] == "invalidated" and r["sub"] is None


def test_rule06_unknown_outcome_no_blind_retry(page):
    r = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c); H.sign2(t);
      ENGINE.transmit(t, ia, 'unknown');
      const x = H.ex(c, 'INT-04');
      const o = { status: t.status, x: x && [x.sev, ENGINE.isOpen(x)] };
      o.resend = ENGINE.transmit(t, ia, 'success').ok; o.retry = ENGINE.retry(t, ia).ok;
      o.newReq = ENGINE.requestTx(c, 'itr12', tc).ok;
      o.resolve = ENGINE.resolve(x, ia, { action: 'Assume fine' }).ok;
      o.checkByTc = ENGINE.checkStatus(t, tc, 'not processed').ok;
      o.check = ENGINE.checkStatus(t, ia, 'not processed').ok;
      o.after = [t.status, x.status];
      const rt = ENGINE.retry(t, ia);
      o.retry2 = rt.ok; o.newTx = rt.tx && [rt.tx.status, rt.tx.parentTx === t.id]; o.old = t.status; o.g18 = c.gates.G18.status; o.subTx = c.subTx === (rt.tx && rt.tx.id);
      // processed: the reference is captured and the submission recorded
      const d = H.at('G18'); const u = H.itx(d); H.sign2(u); ENGINE.transmit(u, ia, 'unknown');
      ENGINE.checkStatus(u, ia, 'processed');
      o.processed = [u.status, !!u.ref, d.submission && d.submission.ok, H.ex(d, 'INT-04').status];
      return o;
    """)
    assert r["status"] == "unknown" and r["x"] == ["S2", True]
    assert not r["resend"] and not r["retry"] and not r["newReq"], "Unknown calls are never retried blindly"
    assert not r["resolve"] and not r["checkByTc"] and r["check"]
    assert r["after"][0] == "not processed" and r["after"][1] in ("resolved", "closed")
    assert r["retry2"] and r["newTx"] == ["awaiting G18", True] and r["old"] == "superseded" and r["g18"] != "released" and r["subTx"]
    assert r["processed"][:3] == ["success", True, True] and r["processed"][3] in ("resolved", "closed")


def test_rule06_no_response_raises_int10_and_sub03(page):
    r = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c); H.sign2(t);
      ENGINE.transmit(t, ia, 'no-response');
      const i = H.ex(c, 'INT-10'); const s = H.ex(c, 'SUB-03');
      const o = { status: t.status, both: !!i && !!s, rel: !!(i && s && i.related.includes(s.id)), resend: ENGINE.transmit(t, ia, 'success').ok };
      ENGINE.checkStatus(t, ia, 'processed');
      o.after = [t.status, i.status, s.status, !!t.ref];
      return o;
    """)
    assert r["status"] == "no-response" and r["both"] and r["rel"] and not r["resend"]
    assert r["after"][0] == "success" and r["after"][1] in ("resolved", "closed") and r["after"][2] in ("resolved", "closed") and r["after"][3]


def test_rule06_int05_duplicate_guard(page):
    r = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c); H.sign2(t); ENGINE.transmit(t, ia, 'success');
      const rq = ENGINE.requestTx(c, 'itr12', tc);
      const o = { rq: rq.ok };
      if (rq.ok) { H.sign2(rq.tx); const tr = ENGINE.transmit(rq.tx, ia, 'success'); o.tr = tr.ok; o.status = rq.tx.status; }
      const x = H.ex(c, 'INT-05'); o.x = x && x.sev;
      o.successes = S.txs.filter((u) => u.caseId === c.id && u.fn === 'itr12' && u.status === 'success').length;
      return o;
    """)
    assert r["successes"] == 1, "An ITR12 must never be submitted twice"
    assert r.get("tr") is not True
    assert r["rq"] and r["x"] == "S1", ("Rule 6: a second ITR12 send raises INT-05 (S1)", r)


def test_rule06_inbound_hashed_matched_and_misroutes(page):
    r = ev(page, r"""
      const c = H.at('G12'); const ref = ENGINE.clientOf(c).taxRef;
      const ok = ENGINE.receive({ fn: 'notice', taxRef: ref, year: c.year, ref: 'N-1', date: '2026-11-09', data: { text: 'hello' } });
      const want = ENGINE.digest({ fn: 'notice', taxRef: ref, year: c.year, ref: 'N-1', date: '2026-11-09', data: { text: 'hello' } });
      const wrongYear = ENGINE.receive({ fn: 'notice', taxRef: ref, year: 2025, ref: 'N-2', date: '2026-11-09' });
      const nobody = ENGINE.receive({ fn: 'notice', taxRef: '0000000000', year: c.year, ref: 'N-3', date: '2026-11-09' });
      const int14 = S.exceptions.filter((x) => x.code === 'INT-14');
      const o = { ok: [ok.status, ok.caseId === c.id, ok.hash === want, /^[0-9a-f]{64}$/.test(ok.hash)], notices: c.notices.length,
                  wy: [wrongYear.status, wrongYear.caseId], nb: [nobody.status, nobody.caseId], int14: int14.length, sev: int14.map((x) => x.sev) };
      // An item that arrives before its case is opened is routed by the Integration Administrator once the case exists.
      const cl2 = ENGINE.newClient({ name: 'Later Case', taxRef: '9300000003' });
      const early = ENGINE.receive({ fn: 'notice', taxRef: '9300000003', year: 2026, ref: 'N-4', date: '2026-11-09' });
      const c2 = ENGINE.newCase(cl2);
      o.routeByTc = ENGINE.routeInbound(early, c2.id, tc).ok;
      o.misroute = ENGINE.routeInbound(nobody, c.id, ia).ok;  // another taxpayer's item can never be routed to this case
      o.route = ENGINE.routeInbound(early, c2.id, ia).ok;
      o.int14Open = S.exceptions.filter((x) => x.code === 'INT-14' && ENGINE.isOpen(x)).length;
      return o;
    """)
    assert r["ok"] == ["routed", True, True, True] and r["notices"] == 1
    assert r["wy"] == ["unrouted", None] and r["nb"] == ["unrouted", None], "Taxpayer and year must both match"
    assert r["int14"] == 2 and r["sev"] == ["S2", "S2"]
    assert not r["routeByTc"] and not r["misroute"] and r["route"] and r["int14Open"] == 2


# ---------------------------------------------------------------------------------------------------------------------------
# Rule 7: client gates, reminders and withdrawals
# ---------------------------------------------------------------------------------------------------------------------------

def test_rule07_expired_reminder_never_counts_as_approval(page):
    r = ev(page, r"""
      const c = H.at('G06');
      const rm = ENGINE.remind(c, 'approval', ad);
      const o = { sent: rm.ok, early: ENGINE.watch() && H.codes(c).includes('CLT-05') };
      H.withClock(8, () => ENGINE.watch());
      const x = H.ex(c, 'CLT-05');
      o.x = x && [x.sev, x.status]; o.g06 = c.gates.G06.status; o.approval = c.approval; o.cur = ENGINE.currentGate(c);
      o.resolveByTc = ENGINE.resolve(x, tc, { action: 'Client said yes on the phone' }).ok;
      o.portal = ENGINE.portal(c, 'approve', { version: ENGINE.vN(c), declaration: true }).ok; o.xAfter = x.status;
      const k = H.mk({ kyc: { address: false } });
      ENGINE.remind(k, 'onboarding', ad);
      H.withClock(15, () => ENGINE.watch());
      o.clt01 = H.openCodes(k).includes('CLT-01'); o.g01 = k.gates.G01.status;
      return o;
    """)
    assert r["sent"] and not r["early"]
    assert r["x"] is not None and r["x"][0] == "S3", "Rule 7: an expired approval reminder raises CLT-05"
    assert r["g06"] != "released" and r["approval"] is None and r["cur"] == "G06", "An expired reminder never counts as approval"
    assert not r["resolveByTc"], "CLT-05 resolves only through the client's portal action"
    assert r["portal"] and r["xAfter"] in ("resolved", "closed")
    assert r["clt01"] and r["g01"] != "released"


def test_rule07_withdrawal_before_submission_raises_clt06(page):
    r = ev(page, r"""
      const c = H.at('G09');
      const w = ENGINE.portal(c, 'withdraw', { reason: 'I want to check the medical credits' });
      const x = H.ex(c, 'CLT-06');
      const o = { w: w.ok, x: x && [x.sev, ENGINE.isOpen(x)], g06: c.gates.G06.status, g09: ENGINE.canRelease(c, 'G09', tc), cur: ENGINE.currentGate(c),
                  problem: ENGINE.approvalProblem(c), resolveByTc: ENGINE.resolve(x, tc, { action: 'x' }).ok };
      o.reapprove = ENGINE.portal(c, 'approve', { version: ENGINE.vN(c), declaration: true }).ok; o.after = x.status;
      return o;
    """)
    assert r["w"] and r["x"] == ["S2", True] and r["g06"] == "invalidated" and r["cur"] == "G06"
    assert not r["g09"]["ok"] and r["problem"]
    assert not r["resolveByTc"] and r["reapprove"] and r["after"] in ("resolved", "closed")


def test_rule07_submission_after_withdrawal_raises_sub05_and_g17(page):
    r = ev(page, r"""
      // The client emailed a withdrawal a minute before the filing; the consultant records it with the time it was received.
      // Approved on day 0; the return is filed the next day, a minute after the email arrived.
      const c = H.at('G18');
      const o = H.withClock(1, () => {
        const t = H.itx(c); H.sign2(t); ENGINE.transmit(t, H.ia, 'success');
        const at = new Date(c.submission.at.getTime() - 60000).toISOString();
        const rec = ENGINE.recordWithdrawal(c, ACTOR.as('Tax Consultant'), { receivedAt: at, reason: 'Sent by email before the filing', channel: 'email' });
        const x = H.ex(c, 'SUB-05');
        const inc = S.incidents.filter((i) => i.caseId === c.id);
        return { rec: rec.ok, x: x && [x.sev, ENGINE.isOpen(x), !!x.incidentId], inc: inc.map((i) => [i.status, i.codes]), g17: H.st(c, 'G17') };
      });
      // A portal withdrawal takes effect when it is made: after the filing it raises no SUB-05...
      const d = H.at('G16');
      ENGINE.portal(d, 'withdraw', { reason: 'Later' });
      o.late = H.codes(d).includes('SUB-05');
      // ...and the client cannot back-date it through the portal.
      const e = H.at('G16');
      ENGINE.portal(e, 'withdraw', { reason: 'Back-dated by the client', at: new Date(e.submission.at.getTime() - 60000).toISOString() });
      o.backdated = H.codes(e).includes('SUB-05');
      return o;
    """)
    assert r["rec"] and r["x"] == ["S1", True, True] and r["inc"] == [["open", ["SUB-05"]]] and r["g17"] == "in progress"
    assert not r["late"], "A withdrawal after the submission does not raise SUB-05"
    assert not r["backdated"], "The portal ignores a client-supplied withdrawal time"


# ---------------------------------------------------------------------------------------------------------------------------
# Rule 8: due dates
# ---------------------------------------------------------------------------------------------------------------------------

def test_rule08_pre04_raised_as_the_filing_deadline_approaches(page):
    left = biz_between(TODAY, date(2027, 1, 22))
    r = ev(page, r"""
      const p = H.mk({ provisional: true });
      const np = H.mk({ provisional: false });
      S.policy.warnDays = arg - 1; ENGINE.watch();
      const o = { before: H.codes(p).includes('PRE-04'), np: H.ex(np, 'PRE-04') && H.ex(np, 'PRE-04').sarsDeadline };
      S.policy.warnDays = arg; ENGINE.watch(); ENGINE.watch();
      o.after = ENGINE.exOf(p).filter((x) => x.code === 'PRE-04').map((x) => x.sarsDeadline);
      return o;
    """, left)
    assert r["np"] == "2026-10-23", "Non-provisional deadline (23 Oct 2026) has passed: PRE-04 at once"
    assert not r["before"], "PRE-04 waits until business days left <= warnDays"
    assert r["after"] == ["2027-01-22"], "Raised once, with the provisional deadline"


def test_rule08_da05_and_vrf03_from_the_notice(page):
    due = add_biz(TODAY, 5)
    r = ev(page, r"""
      const c = H.at('G12'); const ref = ENGINE.clientOf(c).taxRef;
      ENGINE.receive({ fn: 'daIn', taxRef: ref, year: c.year, ref: 'DA-5', due: arg, date: '2026-11-09' });
      const v = H.at('G12'); const vref = ENGINE.clientOf(v).taxRef;
      ENGINE.receive({ fn: 'vrfIn', taxRef: vref, year: v.year, ref: 'VR-5', due: arg, date: '2026-11-09' });
      const far = H.at('G12');
      ENGINE.receive({ fn: 'daIn', taxRef: ENGINE.clientOf(far).taxRef, year: far.year, ref: 'DA-6', due: '2027-06-30', date: '2026-11-09' });
      S.policy.warnDays = 4; ENGINE.watch();
      const o = { da: c.da.due, vrf: v.vrf.due, early: [H.codes(c).includes('DA-05'), H.codes(v).includes('VRF-03')] };
      S.policy.warnDays = 5; ENGINE.watch();
      o.da05 = H.ex(c, 'DA-05') && H.ex(c, 'DA-05').sarsDeadline; o.vrf03 = H.ex(v, 'VRF-03') && H.ex(v, 'VRF-03').sarsDeadline;
      o.da01 = H.ex(c, 'DA-01').sarsDeadline; o.far = H.codes(far).includes('DA-05');
      return o;
    """, iso(due))
    assert r["da"] == iso(due) and r["vrf"] == iso(due) and r["da01"] == iso(due), "DA and verification deadlines come from the notice"
    assert r["early"] == [False, False]
    assert r["da05"] == iso(due) and r["vrf03"] == iso(due) and not r["far"]


def test_rule08_remedy_deadlines_use_periods_and_chapter9(page):
    ita34 = date(2026, 11, 2)
    want = {k: iso(add_biz(ita34, n, ch9=True)) for k, n in (("objection", 80), ("reasons", 30))}
    plain = iso(add_biz(ita34, 80, ch9=False))
    left = biz_between(TODAY, date.fromisoformat(want["objection"]), ch9=True)
    r = ev(page, r"""
      const c = H.at('G12');
      ENGINE.receive({ fn: 'ita34', taxRef: ENGINE.clientOf(c).taxRef, year: c.year, ref: 'ITA34-X', date: arg.ita34, data: c.calc.summary, submissionRef: c.submission.ref });
      const dr = ENGINE.drive(c, 'G15', { decision: 'instruct', decisionNote: 'Disagree' });
      const o = { dr: dr.ok, cur: ENGINE.currentGate(c), p: [PERIODS.objection.days, PERIODS.objection.ch9, PERIODS.reasons.days, PERIODS.reasons.ch9] };
      o.reasons = ENGINE.chooseRemedy(c, tc, 'reasons', { evidence: 'e' }).deadline;
      o.objection = ENGINE.chooseRemedy(c, tc, 'objection', { evidence: 'Grounds' }).deadline;
      o.rem05 = H.ex(c, 'REM-05') && H.ex(c, 'REM-05').sarsDeadline;
      S.policy.warnDays = arg.left - 1; ENGINE.watch(); o.early = H.codes(c).includes('REM-09');
      S.policy.warnDays = arg.left; ENGINE.watch(); o.rem09 = H.ex(c, 'REM-09') && H.ex(c, 'REM-09').sarsDeadline;
      return o;
    """, {"ita34": iso(ita34), "left": left})
    assert r["dr"] and r["cur"] == "G15" and r["p"] == [80, True, 30, True]
    assert r["objection"] == want["objection"] and r["objection"] != plain, ("80 business days excluding 16 Dec - 15 Jan", r, want)
    assert r["reasons"] == want["reasons"]
    assert r["rem05"] == want["objection"]
    assert not r["early"] and r["rem09"] == want["objection"]


# ---------------------------------------------------------------------------------------------------------------------------
# Rule 9: retention (G16)
# ---------------------------------------------------------------------------------------------------------------------------

def test_rule09_retention_holds_ret03_and_release(page):
    r = ev(page, r"""
      const c = H.at('G12');
      ENGINE.receive({ fn: 'vrfIn', taxRef: ENGINE.clientOf(c).taxRef, year: c.year, ref: 'VR-9', due: '2027-06-30', date: '2026-11-09' });
      const dr = ENGINE.drive(c);
      const o = { dr: dr.ok, cur: ENGINE.currentGate(c), ret: Object.assign({}, c.retention, { holds: c.retention.holds.map((h) => [h.kind, !!h.released]) }),
                  sub: ENGINE.isoDay(c.submission.at), years: [PERIODS.retention.years, S.policy.retentionYears] };
      o.g16Now = ENGINE.canRelease(c, 'G16', rc);
      const counts = () => [c.docs.length, ENGINE.exOf(c).length, c.versions.length, c.items.length];
      const days = H.daysTo(c.retention.review) + 1;
      H.withClock(days, () => {
        ENGINE.watch();
        o.codes = ENGINE.exOf(c).filter(ENGINE.isOpen).map((x) => x.code).filter((k) => k.startsWith('RET'));
        o.missing = ENGINE.criteria(c, 'G16');
        o.blocked = ENGINE.canRelease(c, 'G16', rc).ok;
        const h = c.retention.holds[0];
        o.relByTc = ENGINE.releaseHold(c, h.id, tc).ok;
        o.relByRc = ENGINE.releaseHold(c, h.id, rc).ok;
        o.ret01 = H.ex(c, 'RET-01').status;
        o.ret03 = ENGINE.resolve(H.ex(c, 'RET-03'), rc, { action: 'Retention reviewed; no further hold' }).ok;
        const before = counts();
        o.g16Tc = ENGINE.release(c, 'G16', tc).ok;
        o.g16Rc = ENGINE.release(c, 'G16', rc);
        o.after = [c.archived, ENGINE.columnOf(c), JSON.stringify(before) === JSON.stringify(counts())];
      });
      return o;
    """)
    assert r["dr"] and r["cur"] == "G16"
    assert r["years"] == [5, 5]
    ret = r["ret"]
    y, m, d = r["sub"].split("-")
    assert ret["from"] == r["sub"] and ret["review"] == f"{int(y) + 5}-{m}-{d}", ("5 years from submission (TAA s29(3)(a))", ret)
    assert ret["holds"] == [["verification", False]]
    assert not r["g16Now"]["ok"]
    assert "RET-03" in r["codes"] and "RET-01" in r["codes"], r["codes"]
    assert any("Verification" in m for m in r["missing"]) and not r["blocked"], "An active hold blocks G16"
    assert not r["relByTc"] and r["relByRc"] and r["ret01"] in ("resolved", "closed")
    assert r["ret03"] and not r["g16Tc"] and r["g16Rc"]["ok"], r["g16Rc"]
    assert r["after"] == [True, "closed", True], "G16 archives; nothing is deleted"


def test_rule09_audit_and_dispute_holds(page):
    r = ev(page, r"""
      const c = H.at('G12');
      ENGINE.receive({ fn: 'audIn', taxRef: ENGINE.clientOf(c).taxRef, year: c.year, ref: 'AU-1', due: '2027-06-30', date: '2026-11-09' });
      const o = { aud: c.retention.holds.map((h) => h.kind), aud01: H.ex(c, 'AUD-01') && H.ex(c, 'AUD-01').sev };
      const d = H.at('G16', {}, {}, { decision: 'instruct', route: 'objection' });
      o.dispute = d.retention.holds.map((h) => h.kind);
      const l = H.at('G16');
      o.legalByTc = ENGINE.legalHold(l, tc, 'Court order').ok; o.legal = ENGINE.legalHold(l, rc, 'Court order').ok;
      o.legalKinds = l.retention.holds.map((h) => h.kind);
      return o;
    """)
    assert r["aud"] == ["audit"] and r["aud01"] == "S1"
    assert "dispute" in r["dispute"], "A successful objection places a dispute hold (TAA s32)"
    assert not r["legalByTc"] and r["legal"] and r["legalKinds"] == ["legal"]


# ---------------------------------------------------------------------------------------------------------------------------
# Rule 10: incidents (G17)
# ---------------------------------------------------------------------------------------------------------------------------

def test_rule10_sec_codes_stop_sars_transactions_and_incident_closure(page):
    r = ev(page, r"""
      const c = H.at('G18'); const t = H.itx(c);
      const x = ENGINE.raiseManual(c, 'SEC-05', io).exception;   // S2, mapped to G17 only
      const inc = S.incidents.find((i) => i.caseId === c.id);
      const o = { sign: ENGINE.signG18(t, ia), inc: !!inc && inc.codes };
      o.stepByTc = ENGINE.incidentStep(inc, 'containment', tc).ok;
      o.closeEarly = ENGINE.closeIncident(inc, io).ok;
      ['containment', 'investigation', 'remediation'].forEach((s) => ENGINE.incidentStep(inc, s, io, { note: s + ' done' }));
      o.closeThree = ENGINE.closeIncident(inc, io).ok;
      ENGINE.incidentStep(inc, 'notification', io, { note: 'Not notifiable under POPIA s22' });
      o.closeByTc = ENGINE.closeIncident(inc, tc).ok;
      o.close = ENGINE.closeIncident(inc, io).ok;
      o.after = [inc.status, x.status, H.st(c, 'G17')];
      o.sign2 = H.sign2(t).map((s) => s.ok); o.status = t.status;
      // An S1 security code stops the transaction too.
      const d = H.at('G18'); const u = H.itx(d); H.sign2(u);
      ENGINE.raiseManual(d, 'SEC-03', io);
      o.s1 = ENGINE.transmit(u, ia, 'success').ok; o.s1Status = u.status;
      return o;
    """)
    assert not r["sign"]["ok"] and 6 in [k["n"] for k in r["sign"].get("checks", []) if not k["ok"]], r["sign"]
    assert r["inc"] == ["SEC-05"]
    assert not r["stepByTc"] and not r["closeEarly"] and not r["closeThree"] and not r["closeByTc"]
    assert r["close"] and r["after"][0] == "closed" and r["after"][1] in ("resolved", "closed") and r["after"][2] == "released"
    assert r["sign2"] == [True, True] and r["status"] == "ready"
    assert not r["s1"] and r["s1Status"] == "ready"


# ---------------------------------------------------------------------------------------------------------------------------
# Rule 11: the audit trail
# ---------------------------------------------------------------------------------------------------------------------------

def test_rule11_audit_chain_fields_and_actor_types(page):
    r = ev(page, r"""
      const c = H.at('G16');
      const d = ENGINE.stubData(c);
      const v = ENGINE.verifyChain();
      const missing = S.audit.filter((a) => !AUDIT_FIELDS.every((k) => Object.prototype.hasOwnProperty.call(a, k))).length;
      const frozen = S.audit.every((a) => Object.isFrozen(a));
      const e0 = S.audit[0]; const text0 = e0.text;
      try { e0.text = 'edited'; } catch (err) { /* strict mode throws */ }
      try { delete e0.hash; } catch (err) { /* ignore */ }
      const o = { v, missing, frozen, unchanged: e0.text === text0 && !!e0.hash, fields: AUDIT_FIELDS, actors: Array.from(new Set(S.audit.map((a) => a.actor))).sort(),
                  sarsRef: S.audit.some((a) => a.sarsRef === c.submission.ref), version: S.audit.some((a) => a.version != null),
                  beforeAfter: S.audit.some((a) => a.before != null && a.after != null), firstPrev: S.audit[0].prev,
                  hasDelete: Object.keys(ENGINE).filter((k) => /delete|remove|purge|erase/i.test(k)) };
      const keep = S.audit.slice();
      S.audit.splice(3, 1); o.spliced = ENGINE.verifyChain();
      S.audit.length = 0; keep.forEach((a) => S.audit.push(a));
      S.audit[5] = Object.freeze(Object.assign({}, S.audit[5], { text: 'tampered' })); o.tampered = ENGINE.verifyChain();
      S.audit[5] = keep[5]; o.restored = ENGINE.verifyChain().ok;
      return o;
    """)
    assert r["v"]["ok"] and r["v"]["n"] > 30
    assert r["missing"] == 0 and r["frozen"] and r["unchanged"]
    for f in ("at", "actor", "who", "role", "caseId", "client", "gate", "code", "exceptionId", "before", "after", "version", "sarsRef",
              "evidence", "reason", "doc", "sarsTx", "owner", "severity", "resolution", "prev", "hash"):
        assert f in r["fields"], f
    assert r["actors"] == ["ai", "human", "system"], r["actors"]
    assert r["sarsRef"] and r["version"] and r["beforeAfter"] and r["firstPrev"] == "0" * 64
    assert r["hasDelete"] == [], "No API may delete audit entries"
    assert not r["spliced"]["ok"] and not r["tampered"]["ok"] and r["restored"]


def test_rule11_csv_guards_formula_injection_and_json_round_trips(page):
    r = ev(page, r"""
      const c = H.mk();
      const acts = ['=SUM(A1:A9)', '+cmd|calc', '-2+3', '@HYPERLINK("x")'];
      acts.forEach((a, i) => { const x = ENGINE.raise(c, ['KYC-01', 'KYC-02', 'MD-01', 'MD-03'][i], { by: tc }); ENGINE.resolve(x, x.owner === 'Administrator' ? ad : tc, { action: a, evidence: a }); });
      const parsed = JSON.parse(ENGINE.auditJson());
      return { csv: ENGINE.auditCsv(), fields: AUDIT_FIELDS, n: S.audit.length,
               json: parsed.length === S.audit.length && parsed.every((p, i) => p.hash === S.audit[i].hash && p.id === S.audit[i].id && auditHash(p) === p.hash),
               same: JSON.stringify(parsed) === JSON.stringify(S.audit) };
    """)
    rows = list(csv.reader(io.StringIO(r["csv"])))
    assert rows[0] == r["fields"] and len(rows) == r["n"] + 1
    bad = [cell for row in rows[1:] for cell in row if cell[:1] in ("=", "+", "-", "@")]
    assert bad == [], bad
    res = rows[0].index("resolution")
    assert {row[res] for row in rows[1:] if row[res]} >= {"'=SUM(A1:A9)", "'+cmd|calc", "'-2+3", "'@HYPERLINK(\"x\")"}
    assert r["json"] and r["same"]


# ---------------------------------------------------------------------------------------------------------------------------
# Rule 12: simulated AI work
# ---------------------------------------------------------------------------------------------------------------------------

def test_rule12_ai_gates_pass_automatically_only_when_clear(page):
    r = ev(page, r"""
      const c = H.at('G16');
      const o = { auto: ['G04', 'G08', 'G12'].map((g) => c.gates[g].byType) };
      o.aiAudit = S.audit.some((a) => a.caseId === c.id && a.actor === 'ai' && a.gate === 'G08' && a.result === 'Released');
      // The reviewer disagrees: G08 routes to the Tax Consultant.
      const d = H.at('G06');
      ENGINE.setReviewer(d, 'G08', 'disagree');
      ENGINE.portal(d, 'approve', { version: ENGINE.vN(d), declaration: true });
      o.dis = [d.gates.G07.status, d.gates.G08.status, d.gates.G08.routed, ENGINE.release(d, 'G08', ai).ok];
      o.routedAudit = S.audit.some((a) => a.caseId === d.id && a.gate === 'G08' && a.result === 'Routed');
      o.byTc = ENGINE.release(d, 'G08', tc).ok;
      // A blocker routes it too, and even the consultant must clear it first.
      const e = H.at('G06');
      const x = ENGINE.raise(e, 'AI-04', { by: ai });
      ENGINE.portal(e, 'approve', { version: ENGINE.vN(e), declaration: true });
      o.blk = [e.gates.G08.status, e.gates.G08.routed, ENGINE.release(e, 'G08', tc).ok];
      return o;
    """)
    assert r["auto"] == ["ai", "ai", "ai"] and r["aiAudit"]
    assert r["dis"] == ["released", "pending", True, False] and r["routedAudit"], r["dis"]
    assert r["byTc"]
    assert r["blk"] == ["pending", True, False], r["blk"]


def test_rule12_ai_work_stops_while_paused(page):
    r = ev(page, r"""
      const c = H.at('G04');
      S.paused = { by: 'TC1', at: now() };
      c.items.forEach((it) => ENGINE.upload(c, it.id, { name: ENGINE.FILE_FOR[it.kind], size: 245760 }, ACTOR.client(c.clientId)));
      const o = { paused: c.gates.G04.status, aiRel: ENGINE.release(c, 'G04', ai) };
      S.paused = null; ENGINE.settle(c);
      o.resumed = [c.gates.G04.status, c.gates.G04.byType];
      return o;
    """)
    assert r["paused"] == "pending" and not r["aiRel"]["ok"] and "paused" in r["aiRel"]["why"].lower()
    assert r["resumed"] == ["released", "ai"]


UPLOADS = [
    # (file name, size, expected code, expected document status or None)
    ("IRP5_2026.exe", 300_000, "DOC-10", "quarantined"),
    ("IRP5_2026.txt", 300_000, "DOC-11", "rejected"),
    ("IRP5_2026.pdf", 25 * 1024 * 1024, "DOC-11", "rejected"),
    ("IRP5_2026_password_protected.pdf", 300_000, "DOC-11", "rejected"),
    ("IRP5_2026_Sarah.pdf", 300_000, "DOC-04", "quarantined"),
    ("IRP5_2026_8505055123087.pdf", 300_000, "DOC-04", "quarantined"),
    ("IRP5_2024.pdf", 300_000, "DOC-03", "held"),
    ("Holiday_photo_album_2026.pdf", 300_000, "AI-02", "held"),
    ("IRP5_2026_scan.pdf", 300_000, "AI-01", "held"),
    ("IRP5_2026.pdf", 5_000, "AI-01", "held"),
]


def test_rule12_upload_checks_use_name_and_size_only(page):
    r = ev(page, r"""
      const out = [];
      for (const [name, size] of arg) {
        const c = H.at('G04', { others: ['Sarah Smith'], idNo: '8001015009088' });
        const u = ENGINE.upload(c, c.items[0].id, { name, size }, ACTOR.client(c.clientId));
        out.push({ name, status: u.doc.status, codes: ENGINE.exOf(c).filter((x) => x.docId === u.doc.id).map((x) => x.code) });
      }
      const c = H.at('G04', { idNo: '8001015009088' });
      const own = ENGINE.upload(c, c.items[0].id, { name: 'IRP5_2026_8001015009088.pdf', size: 300000 }, ACTOR.client(c.clientId));
      const dup = ENGINE.upload(c, c.items[0].id, { name: 'IRP5_2026_8001015009088.pdf', size: 300000 }, ACTOR.client(c.clientId));
      return { out, own: own.doc.status, dup: [dup.doc.status, ENGINE.exOf(c).filter((x) => x.docId === dup.doc.id).map((x) => x.code)] };
    """, [[n, s] for n, s, _, _ in UPLOADS])
    for (name, size, code, status), got in zip(UPLOADS, r["out"]):
        assert code in got["codes"], (name, size, "expected " + code, got)
        assert got["status"] == status, (name, size, got)
    assert r["own"] == "validated", "The taxpayer's own ID number is not DOC-04"
    assert r["dup"] == ["duplicate", ["DOC-05"]]


# ---------------------------------------------------------------------------------------------------------------------------
# The Cases board (plan: drag-and-drop)
# ---------------------------------------------------------------------------------------------------------------------------

def test_board_drag_forward_one_column_at_a_time(page):
    r = ev(page, r"""
      const c = H.mk();
      const o = { col0: ENGINE.columnOf(c) };
      o.skip = ENGINE.dragForward(c, ad, 'questionnaire').ok;
      o.one = ENGINE.dragForward(c, ad, 'sars-details'); o.col1 = ENGINE.columnOf(c);
      o.notReady = ENGINE.dragForward(c, tc); o.col2 = ENGINE.columnOf(c);
      ENGINE.markReq(c, 'G02', 'compare', tc);
      o.two = ENGINE.dragForward(c, tc).ok; o.col3 = ENGINE.columnOf(c);
      o.client = ENGINE.dragForward(c, tc); o.col4 = ENGINE.columnOf(c);
      const b = H.mk(); const k = ENGINE.raise(b, 'KYC-01', { by: ad });
      const n = H.auditLen();
      o.blocked = ENGINE.dragForward(b, ad); o.blockedAudit = S.audit.slice(n).filter((a) => a.result === 'Refused').map((a) => a.code);
      o.colB = ENGINE.columnOf(b);
      const s = H.at('G18'); o.g18 = ENGINE.dragForward(s, tc).ok; o.g18col = ENGINE.columnOf(s);
      const g6 = H.at('G06'); o.g06 = ENGINE.dragForward(g6, tc).ok;
      return o;
    """)
    assert r["col0"] == "onboarding" and not r["skip"]
    assert r["one"]["ok"] and r["col1"] == "sars-details"
    assert not r["notReady"]["ok"] and r["col2"] == "sars-details"
    assert r["two"] and r["col3"] == "questionnaire"
    assert not r["client"]["ok"] and r["col4"] == "questionnaire", "Client gates cannot be passed by a staff drag"
    assert not r["blocked"]["ok"] and r["blocked"]["codes"] == ["KYC-01"] and r["colB"] == "onboarding"
    assert "KYC-01" in r["blockedAudit"], "A refused drag is audited with the open codes"
    assert not r["g18"] and r["g18col"] == "submission" and not r["g06"]


def test_board_return_for_rework(page):
    r = ev(page, r"""
      const c = H.at('G09');
      const o = { col: ENGINE.columnOf(c), frozen: !!c.frozen };
      o.forward = ENGINE.returnForRework(c, tc, 'submission', 'x').ok;
      o.noReason = ENGINE.returnForRework(c, tc, 'calculation', '  ').ok;
      o.byAd = ENGINE.returnForRework(c, ad, 'calculation', 'x').ok;
      const rw = ENGINE.returnForRework(c, tc, 'calculation', 'New IRP5 from the employer');
      o.rw = rw.ok; o.colAfter = ENGINE.columnOf(c);
      o.ver01 = H.openCodes(c).includes('VER-01'); o.sup = c.approval.superseded;
      o.gates = ['G05', 'G06', 'G07', 'G08'].map((g) => c.gates[g].status); o.rework = !!c.gates.G05.rework; o.frozen2 = c.frozen;
      o.audited = S.audit.some((a) => a.caseId === c.id && a.result === 'Rework');
      const d = H.at('G16'); o.afterSubmit = ENGINE.returnForRework(d, tc, 'calculation', 'x').ok;
      // Before any freeze: no VER-01.
      const e = H.at('G05'); const r2 = ENGINE.returnForRework(e, tc, 'questionnaire', 'Client forgot rental');
      o.early = [r2.ok, H.codes(e).includes('VER-01'), e.gates.G03.status];
      return o;
    """)
    assert r["col"] == "final-checks" and r["frozen"]
    assert not r["forward"] and not r["noReason"] and not r["byAd"]
    assert r["rw"] and r["colAfter"] == "calculation"
    assert r["ver01"] and r["sup"], "Returning a frozen case raises VER-01"
    assert r["gates"] == ["invalidated"] * 4 and r["rework"] and r["frozen2"] is None
    assert r["audited"] and not r["afterSubmit"]
    assert r["early"] == [True, False, "invalidated"]


def test_zz_no_page_errors(page):
    assert page.errors == [], page.errors
