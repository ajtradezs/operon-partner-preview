"""Shared fixtures for the partner-preview review-layer tests (pytest + Playwright sync API).

Serves partner-preview/ from a local http.server on 127.0.0.1 (a random port; the sync endpoint allows that origin).
Live-sync tests read TEST_CODE from the codes file outside the repo and never print it.
"""
import functools
import http.server
import json
import os
import re
import socketserver
import tempfile
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CODES = Path(os.environ.get("OPERON_PREVIEW_CODES", r"C:\Users\aidan\obsidian cleanup and link\.tmp\verify3\post\Projects\Operon\.tmp\preview-review-codes.txt"))
SHOTS = Path(os.environ.get("OPERON_PREVIEW_SHOTS", str(Path(tempfile.gettempdir()) / "operon-preview-shots")))
ENDPOINT = "https://xofceephwnlxqrtuqpdl.supabase.co/functions/v1/operon-preview-sync"
RUN = uuid.uuid4().hex[:6]


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


@pytest.fixture(scope="session")
def site():
    live = os.environ.get("OPERON_PREVIEW_URL")  # e.g. the GitHub Pages URL, to run the same checks against the published site
    if live:
        yield live if live.endswith("/") else live + "/"
        return
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(_Quiet, directory=str(ROOT)))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}/"
    srv.shutdown()


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture(scope="session")
def test_code():
    if CODES.exists():
        for line in CODES.read_text(encoding="utf-8").splitlines():
            if line.startswith("TEST_CODE="):
                code = line.split("=", 1)[1].strip()
                if code:
                    return code
    pytest.skip("TEST_CODE not available; live sync tests skipped")


@pytest.fixture(scope="session")
def shots():
    SHOTS.mkdir(parents=True, exist_ok=True)
    return SHOTS


def identity_script(name, code=None, rid=None):
    """Init script: give this browser a named reviewer (so the name prompt is skipped) and optionally the review code."""
    me = {"id": rid or str(uuid.uuid4()),"secret": uuid.uuid4().hex + uuid.uuid4().hex, "name": name, "hint": "", "asked": True}
    parts = [f"if (!localStorage.getItem('operon-preview-review-v1-me')) localStorage.setItem('operon-preview-review-v1-me', {json.dumps(json.dumps(me))});"]
    if code:
        parts.append(f"if (!localStorage.getItem('operon-preview-review-v1-code')) localStorage.setItem('operon-preview-review-v1-code', {json.dumps(code)});")
    return "try {" + "".join(parts) + "} catch (e) {}"


def store_script(items, reviewers=None):
    """Init script: put items (and reviewers) into this browser's review store before the page loads, as if synced earlier."""
    db = {"items": {it["id"]: dict({"route": "today", "data": {}, "deleted": False, "created_at": "2026-10-26T08:00:00.000000+00:00",
                                    "updated_at": "2026-10-26T08:00:00.000000+00:00"}, **it) for it in items},
          "reviewers": {r["id"]: r for r in (reviewers or [])}, "prefs": {}, "since": None, "migrated": True}
    return f"try {{ if (!localStorage.getItem('operon-preview-review-v1')) localStorage.setItem('operon-preview-review-v1', {json.dumps(json.dumps(db))}); }} catch (e) {{}}"


class MockSync:
    """A local stand-in for the sync Edge Function that follows its contract: codes map to spaces, reviewers are bound to
    one space and secret, ids that name a reviewer are reserved for that reviewer, owners alone may change a row, deleted
    rows are stored with data {}, and pulls return rows changed after `since`. Set `fail` to (status, error) or "abort"."""
    ID_RE = re.compile(r"^[A-Za-z0-9_:.\-]{1,120}$")
    KINDS = ("note", "status", "layout", "page", "feedback")
    BAD = ('"__proto__"', '"constructor"', '"prototype"')

    def __init__(self, codes=None):
        self.codes = codes or {"MOCK-CODE-AAAA-0001": "a"}
        self.rows, self.reviewers, self.requests = {}, {}, []
        self.fail, self.reject, self._last = None, {}, None

    def now(self):
        t = datetime.now(timezone.utc)
        if self._last and t <= self._last:
            t = self._last + timedelta(microseconds=1)
        self._last = t
        return t.isoformat()

    @staticmethod
    def _ts(s):
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))

    def seed(self, space, row):
        n = self.now()
        self.rows[(space, row["id"])] = dict({"route": "today", "data": {}, "deleted": False, "created_at": n, "updated_at": n}, **row)

    def space_rows(self, space):
        return {i: r for (sp, i), r in self.rows.items() if sp == space}

    def handle(self, body):
        self.requests.append(body)
        if self.fail:
            return self.fail if isinstance(self.fail, str) else (self.fail[0], {"error": self.fail[1]})
        space = self.codes.get(body.get("code"))
        if not space:
            return 403, {"error": "invalid_code"}
        rv = body.get("reviewer") or {}
        rid, secret = str(rv.get("id", "")), str(rv.get("secret", ""))
        if not re.match(r"^[0-9a-f-]{36}$", rid) or not re.match(r"^[0-9a-f]{64}$", secret):
            return 400, {"error": "invalid_reviewer"}
        ex = self.reviewers.get(rid)
        if ex and (ex["secret"] != secret or ex["space"] != space):
            return 403, {"error": "reviewer_mismatch"}
        n = self.now()
        self.reviewers[rid] = {"secret": secret, "space": space, "name": str(rv.get("name", ""))[:60], "last_seen": n}
        accepted, rejected = [], []
        for it in body.get("items") or []:
            iid, kind, route = str(it.get("id", "")), it.get("kind"), it.get("route")
            blob = json.dumps(it.get("data") or {})
            if not self.ID_RE.match(iid) or kind not in self.KINDS or route in ("__proto__", "constructor", "prototype") or any(b in blob for b in self.BAD):
                rejected.append({"id": iid, "reason": "invalid"})
                continue
            named = iid.split(":")[1] if iid.startswith("layout:") else (iid.rsplit(":", 1)[-1] if iid.startswith("st:") else None)
            row = self.rows.get((space, iid))
            if (named is not None and named != rid) or (row and row["reviewer"] != rid):
                rejected.append({"id": iid, "reason": "not_owner"})
                continue
            if self.reject.get(iid) or self.reject.get("*"):
                rejected.append({"id": iid, "reason": self.reject.get(iid) or self.reject.get("*")})
                continue
            deleted = bool(it.get("deleted"))
            self.rows[(space, iid)] = {"id": iid, "kind": kind, "route": route, "data": {} if deleted else (it.get("data") or {}), "deleted": deleted,
                                       "reviewer": rid, "created_at": row["created_at"] if row else n, "updated_at": n}
            accepted.append(iid)
        since = body.get("since")
        items = [r for r in self.space_rows(space).values() if not since or self._ts(r["updated_at"]) > self._ts(since)]
        return 200, {"now": self.now(), "me": rid, "items": items, "more": False, "next_since": None, "accepted": accepted, "rejected": rejected,
                     "reviewers": [{"id": k, "name": v["name"], "last_seen": v["last_seen"]} for k, v in self.reviewers.items() if v["space"] == space]}

    def route(self, route):
        hdr = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS"}
        if route.request.method == "OPTIONS":
            return route.fulfill(status=204, headers=hdr)
        res = self.handle(json.loads(route.request.post_data or "{}"))
        if res == "abort":
            return route.abort()
        return route.fulfill(status=res[0], headers=hdr, content_type="application/json", body=json.dumps(res[1]))


class Session:
    """One browser context + page with error capture."""

    def __init__(self, browser, site, width=1280, scheme="light", init=None, block_sortable=False, hash_="#today", query="", height=900,
                 mock=None, touch=False, hold_sortable=False, wait_until="load"):
        opts = {"is_mobile": True, "has_touch": True} if touch else {}
        self.ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme=scheme, accept_downloads=True, **opts)
        for s in (init if isinstance(init, list) else [init] if init else []):
            self.ctx.add_init_script(s)
        if block_sortable:
            self.ctx.route("**/Sortable.min.js", lambda r: r.abort())
        self.held = []
        if hold_sortable:  # the request hangs (a firewall that drops packets) until the test releases it
            self.ctx.route("**/Sortable.min.js", lambda r: self.held.append(r))
        if mock:
            self.ctx.route(ENDPOINT, mock.route)
        self.page = self.ctx.new_page()
        self.errors, self.dialogs = [], []
        self.page.on("pageerror", lambda e: self.errors.append("pageerror: %s" % e))
        self.page.on("console", self._console)
        self.page.on("dialog", self._dialog)
        self.page.goto(site + query + hash_, wait_until=wait_until)

    def _console(self, m):
        text = m.text
        if m.type == "error" and "Failed to load resource" not in text and "net::ERR_FAILED" not in text:
            self.errors.append("console error: " + text)
        if m.type == "warning" and "Review" in text:
            self.errors.append("console warning: " + text)

    def _dialog(self, d):
        self.dialogs.append(d.message)
        d.dismiss()

    def sign_in(self, email="johan.demo@example.test"):
        p = self.page
        p.fill("#si-email", email)
        p.click("form[data-form=email] button[type=submit]")
        p.fill("#si-code", "123456")
        p.click("form[data-form=code] button[type=submit]")
        p.wait_for_selector(".rv-bar:not([hidden])")
        return self

    def go(self, hash_):
        """Navigate by hash and wait until the app's hashchange render (and the review layer) has run."""
        self.page.evaluate("""h => new Promise((resolve) => {
            if ((location.hash || '#today') === h) { render(); return resolve(); }
            addEventListener('hashchange', () => setTimeout(resolve, 0), { once: true });
            location.hash = h;
        })""", hash_)

    def block(self, key):
        return self.page.locator(f'#app [data-rv-b="{key}"]')

    def close(self):
        self.ctx.close()


@pytest.fixture
def session(browser, site):
    made = []

    def make(**kw):
        s = Session(browser, site, **kw)
        made.append(s)
        return s

    yield make
    for s in made:
        try:
            s.close()
        except Exception:
            pass
