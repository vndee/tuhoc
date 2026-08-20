#!/usr/bin/env python3
import argparse, json, pathlib, re, subprocess

SRC_DEFAULT = "~/Documents/claude/Research/***REMOVED***.html"
TPL_RE = re.compile(r'<script type="text/html" id="tpl-([\w-]+)">(.*?)</script>', re.S)
CH_ROW = re.compile(r"\{id:'([\w-]+)',\s*part:'([^']*)',\s*num:'([^']*)',\s*title:'([^']*)',\s*short:'([^']*)'\}")

def extract_chapters(src: str) -> dict:
    return {cid: body.strip() + "\n" for cid, body in TPL_RE.findall(src) if cid != "home"}

def registry(src: str):
    block = src[src.find("const CH = ["): src.find("];", src.find("const CH = ["))]
    return [dict(zip(("id","part","num","title","short"), m)) for m in CH_ROW.findall(block)]

def build_manifest(src: str) -> dict:
    parts, order = {}, []
    for row in registry(src):
        if row["id"] == "home": continue
        key = row["part"] or "Phụ lục"
        if key not in parts: parts[key] = []; order.append(key)
        parts[key].append({"id": row["id"], "num": row["num"], "title": row["title"],
                           "short": row["short"], "file": f"chapters/{row['id']}.html"})
    return {"id": "***REMOVED***", "title": "***REMOVED***",
            "description": "Từ tiên đề Shannon đến định lượng bất định trong LLM",
            "lang": "vi", "version": "1.0.0", "runtime": "^1",
            "parts": [{"title": k, "chapters": parts[k]} for k in order]}

def _extract_function(src: str, name: str) -> str:
    """Pull a full `function name(...){...}` block out of src via brace-depth
    scanning (skips over string/template literal contents so braces inside
    quoted text don't throw off the depth count)."""
    start = src.find(f"function {name}(")
    if start == -1:
        raise ValueError(f"anchor not found: function {name}(")
    brace = src.find("{", start)
    i, depth, n = brace, 0, len(src)
    while i < n:
        c = src[i]
        if c in "'\"`":
            q = c; i += 1
            while i < n and src[i] != q:
                i += 2 if src[i] == "\\" else 1
            i += 1
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return src[start:i + 1]
        i += 1
    raise ValueError(f"unterminated function {name}")

def extract_runtime(src: str) -> dict:
    """Split the v1 monolith into the course-kit runtime, viz definitions,
    and vendor/reader assets (Task 3). Cuts are anchor-based (str.find), not
    line-based, per the v1 file map."""
    # <style> #1 — KaTeX CSS
    s1 = src.find("<style")
    s1c = src.find(">", s1) + 1
    s1e = src.find("</style>", s1c)
    katex_css = src[s1c:s1e]

    # <script> #1/#2 — KaTeX bundle, auto-render extension
    sc1 = src.find("<script>", s1e)
    c1s = sc1 + len("<script>")
    c1e = src.find("</script>", c1s)
    katex_js = src[c1s:c1e]

    sc2 = src.find("<script>", c1e)
    c2s = sc2 + len("<script>")
    c2e = src.find("</script>", c2s)
    auto_render_js = src[c2s:c2e]

    # <style> #2 — reader stylesheet
    s2 = src.find("<style", c2e)
    s2c = src.find(">", s2) + 1
    s2e = src.find("</style>", s2c)
    reader_css = src[s2c:s2e]

    # CORE UTILITIES ... legendRow
    core_marker = src.find("CORE UTILITIES")
    core_open = src.rfind("<script", 0, core_marker)
    core_cs = src.find(">", core_open) + 1
    core_ce = src.find("</script>", core_cs)
    core = src[core_cs:core_ce]

    # viz registry: const VIZ = {}; function defineViz(...)
    reg_open = src.find("<script", core_ce)
    reg_cs = src.find(">", reg_open) + 1
    reg_ce = src.find("</script>", reg_cs)
    registry_js = src[reg_cs:reg_ce]

    # renderKatex / initViz — lifted out of the app (CHAPTER REGISTRY) script
    render_katex = _extract_function(src, "renderKatex")
    init_viz = _extract_function(src, "initViz")

    runtime = "\n\n".join([core.strip(), registry_js.strip(), render_katex, init_viz])
    runtime += "\n\nwindow.CourseKit = { initViz, renderKatex, REDRAWS, VIZ };\n"

    # viz.js: HOME HERO ... up to (not including) the CHAPTER REGISTRY <script>.
    # The 59 defineViz(...) calls actually span several sibling <script> tags
    # (one per chapter section) with nothing but whitespace between them, so
    # they're stitched back into one block by dropping those tag boundaries.
    home_hero = src.find("HOME HERO")
    viz_open = src.rfind("<script", 0, home_hero)
    viz_cs = src.find(">", viz_open) + 1
    chreg_marker = src.find("CHAPTER REGISTRY")
    chreg_open = src.rfind("<script", 0, chreg_marker)
    viz_ce = src.rfind("</script>", 0, chreg_open)
    viz_raw = src[viz_cs:viz_ce]
    viz = re.sub(r"</script>\s*<script>", "\n", viz_raw)

    return {
        "katex_css": katex_css,
        "katex_js": katex_js,
        "auto_render_js": auto_render_js,
        "reader_css": reader_css,
        "runtime": runtime,
        "viz": viz,
    }

def _node_check(path: pathlib.Path):
    r = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"node --check failed for {path}:\n{r.stderr}")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--source", default=SRC_DEFAULT); ap.add_argument("--out", default=".")
    a = ap.parse_args()
    src = pathlib.Path(a.source).expanduser().read_text(encoding="utf-8")
    out = pathlib.Path(a.out)
    root = out / "courses" / "***REMOVED***"
    (root / "chapters").mkdir(parents=True, exist_ok=True)
    for cid, frag in extract_chapters(src).items():
        (root / "chapters" / f"{cid}.html").write_text(frag, encoding="utf-8")
    (root / "manifest.json").write_text(json.dumps(build_manifest(src), ensure_ascii=False, indent=2), encoding="utf-8")
    print("extracted:", len(extract_chapters(src)), "chapters")

    kit = out / "packages" / "course-kit"
    (kit / "vendor").mkdir(parents=True, exist_ok=True)
    rt = extract_runtime(src)
    (kit / "vendor" / "katex.css").write_text(rt["katex_css"], encoding="utf-8")
    (kit / "vendor" / "katex.js").write_text(rt["katex_js"], encoding="utf-8")
    (kit / "vendor" / "auto-render.js").write_text(rt["auto_render_js"], encoding="utf-8")
    (kit / "reader.css").write_text(rt["reader_css"], encoding="utf-8")
    (kit / "runtime.js").write_text(rt["runtime"], encoding="utf-8")
    viz_path = root / "viz.js"
    viz_path.write_text(rt["viz"], encoding="utf-8")
    print("extracted: course-kit runtime + vendor + viz.js")

    runtime_path = kit / "runtime.js"
    _node_check(runtime_path)
    _node_check(viz_path)
    print("node --check: OK for", runtime_path, "and", viz_path)

if __name__ == "__main__": main()
