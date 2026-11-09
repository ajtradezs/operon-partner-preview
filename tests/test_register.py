"""The generated exception register matches the workbook, and the workbook's own maps are internally consistent.

The workbook and the workflow document live outside this public repo. Checks that need them skip when they are absent.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import build  # noqa: E402

REGISTER_JS = ROOT / "src" / "itr12" / "register.gen.js"
SEVERITIES = {"S1 Critical", "S2 High", "S3 Medium", "S4 Low"}
BLOCKING = {"Yes", "No", "Conditional"}
GATES = ["G%02d" % i for i in range(1, 19)]
FAMILIES = ["KYC", "CLT", "MD", "QUE", "DOC", "AI", "TAX", "VER", "PRE", "INT", "SUB", "DA", "VRF", "AUD", "ASM", "REM", "RET", "SEC"]
DISPLAY_OWNERS = {"Tax Consultant", "Administrator", "Client", "Information Officer", "AI Agent", "Platform Administrator",
                  "Platform Product Owner", "Operon (system)", "Integration Administrator", "Records/Compliance Owner"}
GENERIC_GATES = {"Relevant gate", "Relevant substantive gate", "Any substantive gate"}


def load_register():
    """Parse register.gen.js: one JSON value per line under a handful of top-level keys."""
    lines = REGISTER_JS.read_text(encoding="utf-8").splitlines()
    out, key = {}, None
    for ln in lines[2:]:
        if ln == "};":
            break
        m = re.match(r"^  (\w+): (.*?),?$", ln)
        if m and m.group(2) == "[":
            key = m.group(1); out[key] = []
        elif m:
            out[m.group(1)] = json.loads(m.group(2))
        elif ln.startswith("    "):
            out[key].append(json.loads(ln.strip().rstrip(",")))
        elif ln == "  ],":
            key = None
        else:
            raise AssertionError("Unexpected line in register.gen.js: " + ln[:80])
    return out


@pytest.fixture(scope="module")
def reg():
    return load_register()


def row_gates(row):
    return re.findall(r"G\d\d", row["gates"])


def test_counts_and_codes(reg):
    codes = [c["code"] for c in reg["codes"]]
    assert len(codes) == 116 and len(set(codes)) == 116
    assert [c.split("-")[0] for c in codes] == sorted([c.split("-")[0] for c in codes], key=FAMILIES.index)
    assert sorted({c.split("-")[0] for c in codes}, key=FAMILIES.index) == FAMILIES
    assert len({c["family"] for c in reg["codes"]}) == 18
    assert [g["gate"] for g in reg["gates"]] == GATES


def test_values_are_valid(reg):
    for c in reg["codes"]:
        assert c["severity"] in SEVERITIES, c["code"]
        assert c["blocking"] in BLOCKING, c["code"]
        assert c["owner"] in DISPLAY_OWNERS, (c["code"], c["owner"])
        assert c["secondary"] is None or c["secondary"] in DISPLAY_OWNERS, (c["code"], c["secondary"])
        parts = [p.strip() for p in c["gates"].split(";")]
        assert all(p in GATES or p in GENERIC_GATES for p in parts), (c["code"], c["gates"])
        assert c["title"] and c["trigger"] and c["resolution"]
    cond = sorted(c["code"] for c in reg["codes"] if c["blocking"] == "Conditional")
    assert cond == ["AI-06", "INT-03", "INT-13", "INT-15"]
    assert [c["code"] for c in reg["codes"] if c["blocking"] == "No"] == [c["code"] for c in reg["codes"] if c["severity"] == "S4 Low"]


def test_gate_map_matches_rows_both_ways(reg):
    gm = {g["gate"]: g["codes"] for g in reg["gates"]}
    rows = {c["code"]: row_gates(c) for c in reg["codes"]}
    for code, gates in rows.items():
        for g in gates:
            assert code in gm[g], f"{code} names {g} but the Gate Map row lacks it"
    for g, codes in gm.items():
        for code in codes:
            assert code in rows, f"Gate Map {g} lists unknown code {code}"
            assert g in rows[code], f"Gate Map {g} lists {code} but its row does not name {g}"
    unmapped = [c for c in rows if not any(c in v for v in gm.values())]
    assert unmapped == ["AI-06"]  # mapped to "Relevant gate" only; put to Johan on the Controls page


def test_stage_map_matches_rows(reg):
    stage = {c["code"]: c["stage"] for c in reg["codes"]}
    seen = []
    for s in reg["stages"]:
        for code in s["codes"]:
            assert stage[code] == s["stage"], (code, s["stage"])
            seen.append(code)
    assert sorted(seen) == sorted(stage)


def test_label_map_applied_and_firm_neutral(reg):
    text = REGISTER_JS.read_text(encoding="utf-8")
    owners = {g["owner"] for g in reg["gates"]}
    assert "Operon (system)" in owners and "Records/Compliance Owner" in owners
    assert "[firm]" not in json.dumps(reg["codes"] + reg["gates"] + reg["stages"] + reg["audit"] + reg["instructions"], ensure_ascii=False)
    shown = {m["from"]: m["to"] for m in reg["labelMap"]}
    assert shown["[firm] Tax Consultant"] == "Tax Consultant" and shown["[firm] Administrator"] == "Administrator"
    assert shown["PaperSync, as a system owner"] == "Operon (system)"
    gate = {g["gate"]: g for g in reg["gates"]}
    assert gate["G07"]["owner"] == "Operon (system)" and gate["G09"]["control"] == "Final firm submission approval"
    assert next(c for c in reg["codes"] if c["code"] == "PRE-02")["owner"] == "Operon (system)"
    tok = build.firm_token()
    if tok:
        assert tok.lower() not in text.lower()


def test_regeneration_is_identical():
    if not build.register_path():
        pytest.skip("register workbook not available")
    assert build.register_js(build.read_register(build.register_path(), build.firm_token())) == REGISTER_JS.read_text(encoding="utf-8")


def test_source_hash_matches_workbook(reg):
    if not build.register_path():
        pytest.skip("register workbook not available")
    assert reg["source"]["sha256"] == build.sha256(build.register_path())
    assert reg["source"]["file"] == "ITR12_Exception_Register-Nov26.xlsx"


def test_repo_never_holds_the_inputs_or_the_firm_prefix():
    files = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    assert not [f for f in files if f.lower().endswith((".xlsx", ".docx"))], "Johan's workbook or document was copied into the repo"
    tok = build.firm_token()
    if not tok:
        pytest.skip("inputs not available, so the firm prefix is unknown")
    leaks = [f for f in files if (ROOT / f).is_file() and tok.lower() in (ROOT / f).read_bytes().decode("utf-8", "ignore").lower()]
    assert not leaks, "The firm prefix appears in: %s" % leaks
