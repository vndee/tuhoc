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
