"""Backend checks for the partner-preview review sync (Edge Function operon-preview-sync).

Run: python -I tests/check_sync_backend.py
Reads TEST_CODE from the codes file outside the repo (never printed). Uses the `test` space only.
Optional env OPERON_PFM_FORMS_ANON / OPERON_PFM_FORMS_PUBLISHABLE: confirms the project's public keys
cannot reach the sync function or the operon_preview schema directly.
"""
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

FN_URL = "https://xofceephwnlxqrtuqpdl.supabase.co/functions/v1/operon-preview-sync"
REST = "https://xofceephwnlxqrtuqpdl.supabase.co/rest/v1"
CODES = os.environ.get("OPERON_PREVIEW_CODES", r"C:\Users\aidan\obsidian cleanup and link\.tmp\verify3\post\Projects\Operon\.tmp\preview-review-codes.txt")


def read_code(name):
    with open(CODES, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("code not found: " + name)


def call(url, body=None, headers=None, method="POST"):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode()


results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  -> " + detail[:300]))


code = read_code("TEST_CODE")
A = {"id": str(uuid.uuid4()), "secret": uuid.uuid4().hex + uuid.uuid4().hex, "name": "Check A"}
B = {"id": str(uuid.uuid4()), "secret": uuid.uuid4().hex + uuid.uuid4().hex, "name": "Check B"}
item_id = "note_check_" + uuid.uuid4().hex[:12]

s, h, t = call(FN_URL, {"code": "WRONGWRONGWRONGWRONG", "reviewer": A})
check("bad code rejected (403 invalid_code)", s == 403 and "invalid_code" in t, f"{s} {t}")

s, h, t = call(FN_URL, {"code": code, "reviewer": A, "items": [{"id": item_id, "kind": "note", "route": "today", "data": {"change": "check note <img src=x onerror=alert(1)>"}}]})
ok = s == 200
body = json.loads(t) if ok else {}
check("reviewer A registers and saves a note", ok and item_id in body.get("accepted", []), f"{s} {t}")
check("response includes A's note and A as a reviewer", ok and any(i["id"] == item_id for i in body.get("items", [])) and any(r["id"] == A["id"] for r in body.get("reviewers", [])), t)
since = body.get("now")

s, h, t = call(FN_URL, {"code": code, "reviewer": B, "items": [{"id": item_id, "kind": "note", "route": "today", "data": {"change": "hijack"}}]})
b2 = json.loads(t) if s == 200 else {}
check("reviewer B cannot overwrite A's item", s == 200 and any(r.get("id") == item_id and r.get("reason") == "not_owner" for r in b2.get("rejected", [])), f"{s} {t}")
check("B sees A's note unchanged", s == 200 and any(i["id"] == item_id and i["data"].get("change", "").startswith("check note") for i in b2.get("items", [])), t)

s, h, t = call(FN_URL, {"code": code, "reviewer": {**A, "secret": "x" * 64}})
check("A with wrong secret rejected (403 reviewer_mismatch)", s == 403 and "reviewer_mismatch" in t, f"{s} {t}")

s, h, t = call(FN_URL, {"code": code, "reviewer": A, "items": [{"id": "note_check_big", "kind": "note", "data": {"change": "x" * 4001}}]})
b3 = json.loads(t) if s == 200 else {}
check("field over 4000 chars rejected", s == 200 and any(r.get("reason") == "invalid" for r in b3.get("rejected", [])), f"{s} {t}")

s, h, t = call(FN_URL, {"code": code, "reviewer": A, "items": [{"id": "bad id with spaces", "kind": "note", "data": {}}, {"id": "note_check_kind", "kind": "evil", "data": {}}]})
b4 = json.loads(t) if s == 200 else {}
check("bad id and bad kind rejected", s == 200 and len(b4.get("rejected", [])) == 2 and not b4.get("accepted"), f"{s} {t}")

s, h, t = call(FN_URL, {"code": code, "reviewer": A, "since": since})
b5 = json.loads(t) if s == 200 else {}
check("incremental pull since 'now' returns no stale rows", s == 200 and all(i["updated_at"] > since for i in b5.get("items", [])), t)

s, h, t = call(FN_URL, {"code": code, "reviewer": A, "items": [{"id": item_id, "kind": "note", "route": "today", "data": {"change": "edited"}, "deleted": True}]})
b6 = json.loads(t) if s == 200 else {}
check("owner can soft-delete own item", s == 200 and item_id in b6.get("accepted", []) and any(i["id"] == item_id and i["deleted"] for i in b6.get("items", [])), t)
check("a deleted item comes back with its content scrubbed", s == 200 and any(i["id"] == item_id and i["data"] == {} for i in b6.get("items", [])), t)
since = b6.get("now", since)

# Owner-named ids (layout:<reviewer>:<route>, st:<note>:<reviewer>) are reserved for the reviewer they name.
s, h, t = call(FN_URL, {"code": code, "reviewer": B, "items": [
    {"id": f"layout:{A['id']}:today", "kind": "layout", "route": "today", "data": {}},
    {"id": f"st:{item_id}:{A['id']}", "kind": "status", "route": "today", "data": {"status": "done"}},
    {"id": f"layout:{A['id']}:tasks", "kind": "note", "route": "tasks", "data": {"change": "posing as a layout"}}]})
b7 = json.loads(t) if s == 200 else {}
check("B cannot claim ids that name A (layout, status, or a note posing as a layout)",
      s == 200 and not b7.get("accepted") and sum(r.get("reason") == "not_owner" for r in b7.get("rejected", [])) == 3, f"{s} {t}")
s, h, t = call(FN_URL, {"code": code, "reviewer": A, "since": since, "items": [
    {"id": f"layout:{A['id']}:today", "kind": "layout", "route": "today", "data": {"zones": {}}},
    {"id": f"st:{item_id}:{A['id']}", "kind": "status", "route": "today", "data": {"status": "planned"}}]})
b8 = json.loads(t) if s == 200 else {}
check("A can write its own layout and status ids", s == 200 and len(b8.get("accepted", [])) == 2, f"{s} {t}")

s, h, t = call(FN_URL, {"code": code, "reviewer": A, "items": [
    {"id": "note_check_proto_" + uuid.uuid4().hex[:8], "kind": "note", "route": "today", "data": {"block": "constructor"}},
    {"id": "note_check_proto_" + uuid.uuid4().hex[:8], "kind": "note", "route": "__proto__", "data": {}}]})
b9 = json.loads(t) if s == 200 else {}
check("data or route naming constructor/__proto__ rejected", s == 200 and not b9.get("accepted") and sum(r.get("reason") == "invalid" for r in b9.get("rejected", [])) == 2, f"{s} {t}")

# 1 MB per reviewer: 16 rows of ~64 KB fit, the 17th is refused. Rows are soft-deleted (and so emptied) afterwards.
C = {"id": str(uuid.uuid4()), "secret": uuid.uuid4().hex + uuid.uuid4().hex, "name": "Check C"}
cap_ids = [f"layout:{C['id']}:cap{n}" for n in range(17)]
accepted, reasons, statuses = [], [], []
for n in range(0, len(cap_ids), 3):
    s, h, t = call(FN_URL, {"code": code, "reviewer": C, "items": [{"id": i, "kind": "layout", "route": "cap", "data": {"t": "x" * 64000}} for i in cap_ids[n:n + 3]]})
    statuses.append(s)
    if s == 200:
        body = json.loads(t)
        accepted += body.get("accepted", [])
        reasons += [r.get("reason") for r in body.get("rejected", [])]
check("per-reviewer byte cap refuses the row that passes 1 MB", all(x == 200 for x in statuses) and len(accepted) == 16 and reasons == ["quota"], f"{statuses} accepted={len(accepted)} reasons={reasons}")
if accepted:
    call(FN_URL, {"code": code, "reviewer": C, "items": [{"id": i, "kind": "layout", "route": "cap", "data": {}, "deleted": True} for i in accepted]})

s, h, t = call(FN_URL, None, {"Origin": "https://ajtradezs.github.io", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}, method="OPTIONS")
check("CORS preflight allowed for GitHub Pages origin", s in (200, 204) and h.get("Access-Control-Allow-Origin") == "https://ajtradezs.github.io", f"{s} {h}")
s, h, t = call(FN_URL, None, {"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}, method="OPTIONS")
check("CORS preflight gives no allow-origin to other sites", "Access-Control-Allow-Origin" not in h, f"{s} {h}")

s, h, t = call(FN_URL, None, method="GET")
check("GET rejected (405)", s == 405, f"{s} {t}")

for env, hdrs in (("OPERON_PFM_FORMS_ANON", lambda k: {"apikey": k, "Authorization": "Bearer " + k}),
                  ("OPERON_PFM_FORMS_PUBLISHABLE", lambda k: {"apikey": k})):
    k = os.environ.get(env)
    if not k:
        continue
    s, h, t = call(REST + "/rpc/operon_preview_sync", {"p_code": code, "p_reviewer": A}, hdrs(k))
    check(f"{env}: public key cannot execute the sync function", s in (401, 403, 404), f"{s} {t}")
    s, h, t = call(REST + "/items?select=*", None, {**hdrs(k), "Accept-Profile": "operon_preview"}, method="GET")
    check(f"{env}: public key cannot read operon_preview tables", s in (401, 403, 404, 406), f"{s} {t}")

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
