import os, pathlib, re, json, pytest
from extract import extract_chapters, build_manifest, V1_SOURCE_ENV

# Đầu vào DUY NHẤT của bộ test này là bản v1 một-tệp, và nó là một hiện vật
# RIÊNG TƯ nằm ngoài repo (như `TUHOC_COURSE_STORE` với các gói course). Trước
# đây đường dẫn tới nó được viết cứng trong `extract.py`; trên một bản clone
# mới, tệp này vì thế đỏ ngay ở dòng import với một `FileNotFoundError` không
# nói cho ai biết phải làm gì.
#
# Bỏ qua CẢ TỆP, có nêu lý do, chứ không phải cho xanh giả: `make test-extract`
# không nằm trong năm cổng, và nó vốn đã là mục chỉ chạy trên máy tác giả (nó
# cần cả `make setup-extract` cài pytest). Trên máy CÓ bản v1, đặt biến môi
# trường là chạy đủ — không phép đo nào bị nới lỏng, không ca nào bị bỏ.
_src = os.environ.get(V1_SOURCE_ENV, "")
if not _src or not pathlib.Path(_src).expanduser().is_file():
    pytest.skip(
        f"${V1_SOURCE_ENV} chưa trỏ tới bản v1 một-tệp nào — bỏ qua cả tệp.\n"
        f"  Trên máy có nó:  {V1_SOURCE_ENV}=~/duong/dan/ban-v1.html make test-extract",
        allow_module_level=True,
    )

SRC = pathlib.Path(_src).expanduser().read_text(encoding="utf-8")

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
    # Danh tính course đến từ người gọi, nên phép kiểm đúng là "cái truyền vào
    # đi ra nguyên vẹn" — chặt hơn phép kiểm cũ trên một hằng số viết cứng, vì
    # nó cũng bắt được cả trường hợp `build_manifest` bỏ qua tham số.
    m = build_manifest(SRC, course_id="giao-trinh-v1", title="Giáo trình v1", description="Một câu mô tả.")
    assert m["id"] == "giao-trinh-v1" and m["title"] == "Giáo trình v1"
    assert m["description"] == "Một câu mô tả." and m["runtime"] == "^1"
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
    # courses/<id>/chapters/*.html fragments. data-viz="home-hero"
    # lives only in tpl-home, which extract_chapters() deliberately drops (home
    # isn't a course chapter) -- a chapters-only comparison would falsely fail
    # with 58 names instead of 59. viz.js intentionally keeps home-hero because
    # the platform's course-home page reuses it (see task-3-brief.md).
    used_in_source = set(re.findall(r'data-viz="([\w-]+)"', SRC))
    assert used_in_source == set(defined)
