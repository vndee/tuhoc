import pathlib, re, json, pytest
from extract import extract_chapters, build_manifest, SRC_DEFAULT

SRC = pathlib.Path(SRC_DEFAULT).expanduser().read_text(encoding="utf-8")

def test_chapter_count_and_ids():
    ch = extract_chapters(SRC)
    assert len(ch) == 44                      # 43 chương đánh số + appx; home bị loại
    assert "home" not in ch and "p0-1" in ch and "p2-10" in ch and "p3-9" in ch and "appx" in ch

def test_dollar_parity_and_no_script_close():
    ch = extract_chapters(SRC)
    for cid, frag in ch.items():
        tpl = re.search(r'<script type="text/html" id="tpl-%s">(.*?)</script>' % re.escape(cid), SRC, re.S).group(1)
        assert frag.count("$") == tpl.count("$"), cid
        assert "</script" not in frag, cid

def test_manifest_shape():
    m = build_manifest(SRC)
    assert m["id"] == "***REMOVED***" and m["runtime"] == "^1"
    chapters = [c for p in m["parts"] for c in p["chapters"]]
    assert len(chapters) == 44
    assert chapters[0]["id"] == "p0-1" and chapters[-1]["id"] == "appx"
    for c in chapters:
        assert c["file"] == f"chapters/{c['id']}.html"

def test_runtime_and_viz_split(tmp_path):
    from extract import extract_runtime
    out = extract_runtime(SRC)
    assert out["viz"].count("defineViz('") == 59
    assert "class Plot" in out["runtime"] and "function initViz" in out["runtime"]
    assert "window.CourseKit" in out["runtime"]
    assert "defineViz('" not in out["runtime"].replace("function defineViz", "")
    assert out["reader_css"].lstrip().startswith("/*") and "--s1:" in out["reader_css"]
    assert "@font-face" in out["katex_css"]
    for js in (out["runtime"], out["viz"]):
        assert "</script" not in js

def test_viz_names_match_source_exactly():
    # A count of 59 (checked above) can't tell "one dropped + one duplicated" apart
    # from a clean extraction. Compare the actual NAME SETS instead, per spec
    # §3's gate: "59 tên data-viz khớp 59 defineViz".
    from extract import extract_runtime
    out = extract_runtime(SRC)
    defined = re.findall(r"defineViz\('([\w-]+)'", out["viz"])
    assert len(defined) == 59                # raw occurrence count...
    assert len(set(defined)) == 59           # ...and no duplicate defineViz names hiding behind it

    # Set B MUST come from the full source (SRC), not from the extracted
    # courses/***REMOVED***/chapters/*.html fragments. data-viz="home-hero"
    # lives only in tpl-home, which extract_chapters() deliberately drops (home
    # isn't a course chapter) -- a chapters-only comparison would falsely fail
    # with 58 names instead of 59. viz.js intentionally keeps home-hero because
    # the platform's course-home page reuses it (see task-3-brief.md).
    used_in_source = set(re.findall(r'data-viz="([\w-]+)"', SRC))
    assert used_in_source == set(defined)
