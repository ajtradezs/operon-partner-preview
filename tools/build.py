"""Build the Operon partner preview (index.html) from src/ in a fixed order. No fragment patching.

Usage:  python -I tools/build.py            regenerate src/itr12/register.gen.js (when the workbook is present) and build index.html
        python -I tools/build.py --check    regenerate the register in memory and fail if the committed file differs
        python -I tools/build.py --out DIR/index.html [--only views-cases,views-case]
                                            a private build: no regeneration and nothing written in the repo; --only keeps just
                                            the named screen modules (views-kit.js and views.css always stay), so unfinished work
                                            on other screens cannot break it

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
CSS_ORDER = ["shell/shell.css", "review.css", "itr12/views.css", "itr12/views-cases.css", "itr12/views-ops.css", "itr12/views-admin.css", "papersync.css"]
JS_ORDER = [
    "shell/shell.js",        # utilities, dialogs, header, sign-in, render/events (no boot)
    "sync.js",               # declares EXT_FIELD and SYNC
    "itr12/register.gen.js", # generated from the workbook
    "itr12/workflow.gen.js", # generated from the master workflow document
    "itr12/workflow.js", "itr12/roles.js", "itr12/dates.js", "itr12/ruleset-2026.js", "itr12/calc.js",
    "itr12/engine.js", "itr12/seed.js",
    "itr12/views-kit.js",    # shared helpers for the screens
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
        # Prose (applied to every other cell or paragraph)
        ("text", rf"\b{t} / PaperSync ITR12 Exception Register\b", "ITR12 Exception Register", "[firm] / PaperSync ITR12 Exception Register"),
        ("text", rf"^{t} / PaperSync$", "PaperSync", "[firm] / PaperSync (document title)"),
        ("text", rf"\bFinal {t} submission approval\b", "Final firm submission approval", "Final [firm] submission approval"),
        ("text", rf"\b{t} tax calculator\b", "firm’s tax calculator", "[firm] tax calculator"),
        ("text", rf"\bdiffers from {t} calculation\b", "differs from the firm’s calculation", "differs from [firm] calculation"),
        ("text", rf"\binstructs {t}\b", "instructs the firm", "instructs [firm]"),
        ("text", rf"\b{t} is authorised\b", "the firm is authorised", "[firm] is authorised"),
        ("text", rf"\b{t} tax operations\b", "the firm’s tax operations", "[firm] tax operations"),
        ("text", rf"\bClient/{t}\b", "Client/firm", "Client/[firm]"),
        ("text", rf"\b{t} Tax Consultant\b", "Tax Consultant", "[firm] Tax Consultant"),
        ("text", rf"\b{t} Administrator\b", "Administrator", "[firm] Administrator"),
        ("text", rf"\b{t}\b", "firm", "[firm] (any other mention, e.g. “[firm] calculation”)"),
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


# ---------------------------------------------------------------- workflow generation (from the master workflow docx)
PHASE_RE = re.compile(r"^PHASE (\d+): (.+)$")
STEP_RE = re.compile(r"^(\d+)\. (.+)$")
GATE_RE = re.compile(r"^G\d\d$")


def docx_blocks(path: Path):
    import docx  # python-docx; the document is only read
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    d = docx.Document(str(path))
    out = []
    for child in d.element.body.iterchildren():
        if child.tag == qn("w:p"):
            p = Paragraph(child, d)
            t = p.text.strip()
            if t:
                out.append(("p", p.style.name, t))
        elif child.tag == qn("w:tbl"):
            rows = []
            for r in Table(child, d).rows:
                cells, prev = [], None
                for c in r.cells:
                    if c._tc is prev:  # merged cell repeated by python-docx
                        continue
                    prev = c._tc
                    cells.append(c.text.strip())
                rows.append(cells)
            out.append(("t", rows))
    return out


def read_workflow(path: Path, tok: str) -> dict:
    lab = Labeller(tok)
    T = lambda s: lab.apply(s, False)  # noqa: E731
    blocks = docx_blocks(path)
    title, meta, sections, phases = [], [], [], []
    sec = sub = phase = step = group = None

    def new_sec(name):
        return {"title": name, "text": [], "bullets": [], "numbered": [], "tables": [], "subs": []}

    for b in blocks:
        if b[0] == "t":
            rows = [[T(c) for c in r] for r in b[1]]
            if phase is not None and rows and GATE_RE.match(rows[0][0]):
                lines = [ln.strip() for ln in rows[0][1].split("\n") if ln.strip()]
                box = {"gate": rows[0][0], "control": lines[0], "owner": "", "pass": "", "notes": []}
                for ln in lines[1:]:
                    if ln.startswith("Owner:"):
                        box["owner"] = ln[len("Owner:"):].strip()
                    elif ln.startswith("PASS:"):
                        box["pass"] = ln[len("PASS:"):].strip()
                    else:
                        box["notes"].append(ln)
                phase["gates"].append(box)
            elif sec is None:
                meta.extend(rows)
            else:
                (sub or sec)["tables"].append(rows)
            continue
        _, style, text = b
        text = T(text)
        if style == "Heading 1":
            m = PHASE_RE.match(text)
            sub = step = group = None
            if m:
                phase = {"n": int(m.group(1)), "title": m.group(2), "steps": [], "gates": []}
                phases.append(phase); sec = None
            else:
                phase = None; sec = new_sec(text); sections.append(sec)
            continue
        if phase is not None:
            if style != "Heading 2" and step is None:
                raise SystemExit("Workflow document: text before the first step of phase %d: %s" % (phase["n"], text[:60]))
            if style == "Heading 2":
                m = STEP_RE.match(text)
                step = {"n": int(m.group(1)) if m else None, "title": m.group(2) if m else text, "responsible": "", "system": "",
                        "reviewer": "", "text": [], "items": [], "ordered": False, "groups": []}
                phase["steps"].append(step); group = None
            elif style == "Heading 3":
                group = {"title": text, "items": []}; step["groups"].append(group)
            elif style in ("List Bullet", "List Number"):
                (group or step)["items"].append(text)
                if style == "List Number" and group is None:
                    step["ordered"] = True
            elif text.startswith("Responsible:") and step is not None and not step["responsible"]:
                for part in text.split(" | "):
                    k, _, v = part.partition(":")
                    key = {"Responsible": "responsible", "System": "system", "Reviewer": "reviewer"}.get(k.strip())
                    if key:
                        step[key] = v.strip()
            else:
                step["text"].append(text)
            continue
        if sec is None:  # front matter: three title lines, then a titled note ("Working-document principle")
            if len(title) < 3:
                title.append(text)
            else:
                sec = new_sec(text); sections.append(sec)
            continue
        if style == "Heading 2" or style == "Heading 3":
            sub = new_sec(text); sec["subs"].append(sub)
        elif style == "List Bullet":
            (sub or sec)["bullets"].append(text)
        elif style == "List Number":
            (sub or sec)["numbered"].append(text)
        else:
            (sub or sec)["text"].append(text)
    return {
        "source": {"file": public_name(path), "sha256": sha256(path),
                   "note": "Generated read-only from the master workflow document. Text is verbatim apart from the firm prefix, shown firm-neutral."},
        "labelMap": lab.table(), "title": title, "meta": meta, "phases": phases, "sections": sections,
    }


def workflow_js(wf: dict) -> str:
    out = ["/* GENERATED by tools/build.py from the ITR12 master workflow document. Do not edit by hand. */",
           "const WORKFLOW = {"]
    for key in ("source", "labelMap", "title", "meta"):
        out.append(f"  {key}: " + js_value(wf[key]) + ",")
    for key in ("phases", "sections"):
        out.append(f"  {key}: [")
        out.extend("    " + js_value(x) + "," for x in wf[key])
        out.append("  ],")
    out.append("};")
    return "\n".join(out) + "\n"


WORKFLOW_JS = SRC / "itr12" / "workflow.gen.js"


def generate_workflow(check_only=False) -> str | None:
    path, tok = workflow_path(), firm_token()
    if not path or not tok:
        print("Workflow document not found in", INPUTS, "- using the committed", WORKFLOW_JS.relative_to(ROOT))
        return None
    before = sha256(path)
    text = workflow_js(read_workflow(path, tok))
    if sha256(path) != before:
        raise SystemExit("The workflow document changed while it was being read")
    if tok.lower() in text.lower():
        raise SystemExit("The firm prefix leaked into the generated workflow")
    if check_only:
        cur = WORKFLOW_JS.read_text(encoding="utf-8") if WORKFLOW_JS.exists() else ""
        if cur != text:
            raise SystemExit("workflow.gen.js is out of date with the document; run tools/build.py")
        print("workflow.gen.js matches the document (sha256 %s)" % before)
        return text
    WORKFLOW_JS.write_text(text, encoding="utf-8", newline="\n")
    return text


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


SCREEN = re.compile(r"^(itr12/views-[a-z]+|papersync)\.(js|css)$")
ALWAYS = {"itr12/views-kit.js", "itr12/views.css", "itr12/views-cases.css", "itr12/views-ops.css", "itr12/views-admin.css"}


def assemble(only: set[str] | None = None) -> tuple[str, str, list[str]]:
    missing = [p for p in REQUIRED if not (SRC / p).exists()]
    if missing:
        raise SystemExit("Missing required sources: %s" % missing)
    keep = lambda p: only is None or p in ALWAYS or not SCREEN.match(p) or Path(p).stem in only
    css = [p for p in CSS_ORDER if (SRC / p).exists() and keep(p)]
    js = [p for p in JS_ORDER if (SRC / p).exists() and keep(p)]
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
        generate_workflow(check_only=True)
        return
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else None
    only = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
    if out is None:
        generate_register()
        generate_workflow()
    html, build, js = assemble(only)
    check(html)
    target = out or ROOT / "index.html"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(html, encoding="utf-8", newline="\n")
    if out is None:
        (ROOT / ".nojekyll").touch(exist_ok=True)
    print("Built %s: %d characters; build %s; %d scripts (%s)" % (target.name if out is None else target, len(html), build, len(js), ", ".join(js)))


if __name__ == "__main__":
    main(sys.argv[1:])
