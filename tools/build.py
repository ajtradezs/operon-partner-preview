"""Build the Operon partner preview (index.html) from src/ in a fixed order. No fragment patching.

Usage:  python -I tools/build.py            regenerate src/itr12/register.gen.js (when the workbook is present) and build index.html
        python -I tools/build.py --check    regenerate the register in memory and fail if the committed file differs

The exception register workbook and the master workflow document are read-only inputs. They live outside this repository,
in the Operon working folder (the parent of this repo, or OPERON_ITR12_DIR). Their contents are never copied here except
through the generated register module. The firm prefix in their file names is derived at run time and never written out.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
INPUTS = Path(os.environ.get("OPERON_ITR12_DIR", str(ROOT.parent)))
CODES_FILE = INPUTS / ".tmp" / "preview-review-codes.txt"
DENYLIST_FILE = INPUTS / ".tmp" / "preview-denylist.txt"  # optional, outside the repo: one forbidden string per line
REGISTER_JS = SRC / "itr12" / "register.gen.js"

SHEETS = ("Exception Register", "Gate Map", "Stage Map", "Code Audit", "Instructions")
SORTABLE = ('<script async src="https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.6/Sortable.min.js" '
            'integrity="sha512-csIng5zcB+XpulRUa+ev1zKo7zRNGpEaVfNB9On1no9KYTEY/rLGAEEpvgdw6nim1WdTuihZY1eqZ31K7/fZjw==" '
            'crossorigin="anonymous" referrerpolicy="no-referrer"></script>')

# Assembly order. Each file is inlined whole; later modules may use globals from earlier ones.
CSS_ORDER = ["shell/shell.css", "review.css", "itr12/views.css", "papersync.css"]
JS_ORDER = [
    "shell/shell.js",        # utilities, dialogs, header, sign-in, render/events (no boot)
    "sync.js",               # declares EXT_FIELD and SYNC
    "itr12/register.gen.js", # generated from the workbook
    "itr12/workflow.js", "itr12/roles.js", "itr12/dates.js", "itr12/ruleset-2026.js", "itr12/calc.js",
    "itr12/engine.js", "itr12/seed.js",
    "itr12/views-today.js", "itr12/views-cases.js", "itr12/views-case.js", "itr12/views-clients.js",
    "itr12/views-approvals.js", "itr12/views-exceptions.js", "itr12/views-sars.js", "itr12/views-deadlines.js",
    "itr12/views-controls.js", "itr12/views-records.js", "itr12/views-try.js", "itr12/views-import.js",
    "papersync.js",
    "review.js",
    "shell/boot.js",         # seed(); applyTheme(); render(); timers; lightUp()
]
REQUIRED = {"shell/shell.css", "review.css", "shell/shell.js", "sync.js", "itr12/register.gen.js", "review.js", "shell/boot.js"}


# ---------------------------------------------------------------- inputs
def find_input(pattern: str) -> Path | None:
    hits = sorted(INPUTS.glob(pattern))
    return hits[0] if hits else None


def register_path() -> Path | None:
    return find_input("*_PaperSync_ITR12_Exception_Register-*.xlsx")


def workflow_path() -> Path | None:
    return find_input("*_PaperSync_ITR12_Master_Workflow-*.docx")


def firm_token() -> str | None:
    """The firm prefix of Johan's file names (the text before the first underscore). Never written to the repo."""
    p = register_path() or workflow_path()
    return p.name.split("_", 1)[0] if p else None


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def public_name(p: Path) -> str:
    """The file name with the firm prefix removed, e.g. ITR12_Exception_Register-Nov26.xlsx."""
    return re.sub(r"^[^_]+_PaperSync_", "", p.name)


# ---------------------------------------------------------------- the role-label map
def label_rules(tok: str):
    """Ordered (pattern, replacement, shown-as-source) rules. The firm prefix is shown as [firm]."""
    t = re.escape(tok)
    return [
        # Owners and reviewers (exact field values, applied to owner columns only)
        ("owner", rf"^{t} Tax Consultant$", "Tax Consultant", "[firm] Tax Consultant"),
        ("owner", rf"^{t} Administrator$", "Administrator", "[firm] Administrator"),
        ("owner", r"^PaperSync Administrator$", "Platform Administrator", "PaperSync Administrator"),
        ("owner", r"^PaperSync Product Owner$", "Platform Product Owner", "PaperSync Product Owner"),
        ("owner", r"^PaperSync$", "Operon (system)", "PaperSync, as a system owner"),
        ("owner", r"^AI Agent / PaperSync$", "AI Agent / Operon (system)", "AI Agent / PaperSync"),
        ("owner", r"^Records Owner$", "Records/Compliance Owner", "Records Owner"),
        ("owner", r"^Compliance Owner$", "Records/Compliance Owner", "Compliance Owner"),
        # Prose (applied to every other cell)
        ("text", rf"\b{t} / PaperSync ITR12 Exception Register\b", "ITR12 Exception Register", "[firm] / PaperSync ITR12 Exception Register"),
        ("text", rf"\bFinal {t} submission approval\b", "Final firm submission approval", "Final [firm] submission approval"),
        ("text", rf"\b{t} tax calculator\b", "firm’s tax calculator", "[firm] tax calculator"),
        ("text", rf"\bdiffers from {t} calculation\b", "differs from the firm’s calculation", "differs from [firm] calculation"),
        ("text", rf"\binstructs {t}\b", "instructs the firm", "instructs [firm]"),
        ("text", rf"\bClient/{t}\b", "Client/firm", "Client/[firm]"),
        ("text", rf"\b{t} Tax Consultant\b", "Tax Consultant", "[firm] Tax Consultant"),
        ("text", rf"\b{t} Administrator\b", "Administrator", "[firm] Administrator"),
        ("text", rf"\b{t}\b", "the firm", "[firm] (any other mention)"),
    ]


class Labeller:
    def __init__(self, tok: str):
        self.rules = [(kind, re.compile(p), r, shown) for kind, p, r, shown in label_rules(tok)]
        self.counts: dict[tuple[str, str], int] = {}

    def apply(self, value, owner_col: bool):
        if value is None:
            return None
        s = str(value).strip()
        if owner_col:
            for kind, rx, rep, shown in self.rules:
                if kind == "owner" and rx.search(s):
                    self.counts[(shown, rep)] = self.counts.get((shown, rep), 0) + 1
                    return rep
        for kind, rx, rep, shown in self.rules:
            if kind != "text":
                continue
            s, n = rx.subn(rep, s)
            if n:
                self.counts[(shown, rep)] = self.counts.get((shown, rep), 0) + n
        return s

    def table(self):
        order = {shown: i for i, (_, _, _, shown) in enumerate(self.rules)}
        return [{"from": f, "to": t, "count": n} for (f, t), n in sorted(self.counts.items(), key=lambda kv: order[kv[0][0]])]


# ---------------------------------------------------------------- register generation
def read_register(xlsx: Path, tok: str) -> dict:
    import openpyxl  # read-only; the workbook is never saved

    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    try:
        missing = [s for s in SHEETS if s not in wb.sheetnames]
        if missing:
            raise SystemExit("Register workbook is missing sheets: %s" % missing)
        lab = Labeller(tok)

        def rows(name):
            return [r for r in wb[name].iter_rows(values_only=True) if any(c not in (None, "") for c in r)]

        er = rows("Exception Register")
        hdr = [str(c).strip() for c in er[0]]
        want = ["Code", "Family", "Exception", "Workflow Stage", "Approval Gate(s)", "Severity", "Blocking", "Trigger",
                "Primary Owner", "Secondary Reviewer", "Resolution Criteria", "Notes"]
        if hdr[:12] != want:
            raise SystemExit("Exception Register header changed: %s" % hdr)
        keys = ["code", "family", "title", "stage", "gates", "severity", "blocking", "trigger", "owner", "secondary", "resolution", "notes"]
        codes = []
        for r in er[1:]:
            d = {k: lab.apply(v, k in ("owner", "secondary")) for k, v in zip(keys, r[:12])}
            codes.append(d)

        gm = rows("Gate Map")
        if [str(c).strip() for c in gm[0]][:5] != ["Gate", "Control", "Owner", "Release Criterion", "Mapped Exception Codes"]:
            raise SystemExit("Gate Map header changed")
        gates = []
        for r in gm[1:]:
            gates.append({"gate": str(r[0]).strip(), "control": lab.apply(r[1], False), "owner": lab.apply(r[2], True),
                          "criterion": lab.apply(r[3], False), "codes": [c.strip() for c in str(r[4]).split(",") if c.strip()]})

        sm = rows("Stage Map")
        stages = [{"stage": lab.apply(r[0], False), "gates": lab.apply(r[1], False),
                   "codes": [c.strip() for c in str(r[2]).split(",") if c.strip()], "families": lab.apply(r[3], False)} for r in sm[1:]]

        ca = rows("Code Audit")
        audit = [{"status": lab.apply(r[0], False), "issue": lab.apply(r[1], False), "treatment": lab.apply(r[2], False)} for r in ca[1:]]

        ins = [[lab.apply(c, False) for c in r[:2]] for r in rows("Instructions")]
        return {
            "source": {"file": public_name(xlsx), "sha256": sha256(xlsx), "sheets": list(SHEETS),
                       "note": "Generated read-only from the workbook. Text is verbatim apart from the role-label map. The firm prefix in the file name is omitted."},
            "labelMap": lab.table(),
            "codes": codes, "gates": gates, "stages": stages, "audit": audit, "instructions": ins,
        }
    finally:
        wb.close()


def js_value(v) -> str:
    return json.dumps(v, ensure_ascii=False).replace("</", "<\\/")


def register_js(reg: dict) -> str:
    out = ["/* GENERATED by tools/build.py from the ITR12 exception register workbook. Do not edit by hand. */",
           "const REGISTER = {",
           "  source: " + js_value(reg["source"]) + ",",
           "  labelMap: " + js_value(reg["labelMap"]) + ","]
    for key in ("codes", "gates", "stages", "audit", "instructions"):
        out.append(f"  {key}: [")
        out.extend("    " + js_value(x) + "," for x in reg[key])
        out.append("  ],")
    out.append("};")
    return "\n".join(out) + "\n"


def generate_register(check_only=False) -> str | None:
    xlsx, tok = register_path(), firm_token()
    if not xlsx or not tok:
        print("Register workbook not found in", INPUTS, "- using the committed", REGISTER_JS.relative_to(ROOT))
        return None
    before = sha256(xlsx)
    text = register_js(read_register(xlsx, tok))
    if sha256(xlsx) != before:
        raise SystemExit("The register workbook changed while it was being read")
    if tok.lower() in text.lower():
        raise SystemExit("The firm prefix leaked into the generated register")
    if check_only:
        cur = REGISTER_JS.read_text(encoding="utf-8") if REGISTER_JS.exists() else ""
        if cur != text:
            raise SystemExit("register.gen.js is out of date with the workbook; run tools/build.py")
        print("register.gen.js matches the workbook (sha256 %s)" % before)
        return text
    REGISTER_JS.parent.mkdir(parents=True, exist_ok=True)
    REGISTER_JS.write_text(text, encoding="utf-8", newline="\n")
    return text


# ---------------------------------------------------------------- assembly
def read(rel: str) -> str:
    return (SRC / rel).read_text(encoding="utf-8")


def assemble() -> tuple[str, str, list[str]]:
    missing = [p for p in REQUIRED if not (SRC / p).exists()]
    if missing:
        raise SystemExit("Missing required sources: %s" % missing)
    css = [p for p in CSS_ORDER if (SRC / p).exists()]
    js = [p for p in JS_ORDER if (SRC / p).exists()]
    build = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    style = "\n".join("/* ===== %s ===== */\n%s" % (p, read(p)) for p in css)
    script = "\n".join("/* ===================== %s ===================== */\n%s" % (p, read(p)) for p in js)
    html = ("<!doctype html>\n"
            f'<html lang="en" data-build="{build}"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">'
            '<meta name="description" content="Operon partner preview: the ITR12 workflow with made-up data and simulated logins.">\n'
            + read("shell/head.html")
            + "<style>\n" + style + "\n</style>\n</head><body>\n"
            + read("shell/shell.html")
            + SORTABLE + "\n<script>\n'use strict';\n" + script + "\n</script>\n</body></html>\n")
    return html, build, js


def check(html: str):
    low = html.lower()
    assert "window.claude" not in html, "window.claude in the build"
    assert "app.operon.example" not in html
    for bad in ("service_role", "sb_secret_", "sb_publishable_", "eyJhbGci"):
        assert bad not in html, "Key-like string in the build: " + bad
    tok = firm_token()
    if tok:
        assert tok.lower() not in low, "The firm prefix appears in the build"
    else:
        print("WARNING: inputs not found, so the firm-prefix check was skipped")
    assert "papersync-app" not in low, "A PaperSync app host appears in the build"
    assert not re.search(r"https?://[^\s\"'<>]*papersync", low), "A PaperSync URL appears in the build"
    assert not re.search(r"\bpapersync\.(?:co|com|app|io|net|org)\b", low), "A PaperSync domain appears in the build"
    if CODES_FILE.exists():
        for line in CODES_FILE.read_text(encoding="utf-8").splitlines():
            if line.startswith(("PARTNER_CODE=", "TEST_CODE=")):
                code = line.split("=", 1)[1].strip()
                assert not code or code not in html, "A review access code leaked into the build"
    if DENYLIST_FILE.exists():
        for word in DENYLIST_FILE.read_text(encoding="utf-8").splitlines():
            word = word.strip()
            assert not word or word.lower() not in low, "A deny-listed string appears in the build"


def main(argv):
    if "--check" in argv:
        generate_register(check_only=True)
        return
    generate_register()
    html, build, js = assemble()
    check(html)
    (ROOT / "index.html").write_text(html, encoding="utf-8", newline="\n")
    (ROOT / ".nojekyll").touch(exist_ok=True)
    print("Built index.html: %d characters; build %s; %d scripts (%s)" % (len(html), build, len(js), ", ".join(js)))


if __name__ == "__main__":
    main(sys.argv[1:])
