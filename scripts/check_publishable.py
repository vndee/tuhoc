#!/usr/bin/env python3
"""Cổng tiền-publish: repo này đã sạch dấu vết course riêng tư chưa?

Chạy: `make check-publish` (hoặc `python3 scripts/check_publishable.py`).
Thoát **0** khi không còn gì; thoát **1** kèm danh sách khi còn.

## Vì sao tệp này tồn tại

`docs/publishing.md` §2 soạn sẵn một công thức viết lại lịch sử:

    git filter-repo --invert-paths --path courses/

Thẩm định tổng của hệ thống con 1 đo được rằng công thức ấy **không đủ**: bốn
đường rò, và **ba trong bốn sống sót trọn vẹn qua nó**, vì chúng không nằm dưới
`courses/`. Một danh sách gạch đầu dòng trong tài liệu không bắt được điều đó —
người đọc gật đầu rồi bỏ qua. Nên nó ở đây, dưới dạng một lệnh có **mã thoát**.

## Năm phép đo, và mỗi phép trả lời một câu khác nhau

1. **Cây làm việc, trên MỌI ref** — không chỉ nhánh đang checkout. Đây là chỗ
   `docs/publishing.md` §3 từng mù: `git ls-files | grep '^courses/'` chạy trên
   nhánh hiện tại, nên nó XANH trên nhánh làm việc trong khi `main` — nhánh mặc
   định, nhánh sẽ được publish — theo dõi 47 tệp giáo trình như tệp sống.
2. **Lịch sử** — object dưới `courses/` trong mọi commit của mọi ref. Đây là
   phép đo mà `git-filter-repo` phải làm về 0.
3. **Bundle `apps/web/dist/`** — thư mục `wrangler pages deploy dist` đẩy lên
   một host CÔNG KHAI, KHÔNG auth. Nó không được git theo dõi, nên hai phép đo
   trên không nhìn thấy nó, và lúc phép đo này được viết thì nó đang chứa sẵn
   46 tệp / 1,20 MB giáo trình riêng.
4. **Tên riêng trong tệp được theo dõi** — id và tiêu đề course riêng, ở bất kỳ
   đâu ngoài danh sách cho phép. Bắt được `apps/api/migrations/0001` (seed
   database) và `.claude/skills/…/SKILL.md` (tệp ngoài `courses/`).
5. **Xuất xứ văn xuôi** — đoạn văn chép nguyên văn từ một gói riêng, **không**
   kèm tên course nên bốn phép trên đều mù. Phép này dùng chính gói riêng làm
   máy đối chiếu: nó đọc gói từ kho ngoài cây git, băm văn bản chương thành
   chuỗi 12 từ, rồi tìm trong các tệp được theo dõi. Không có gói riêng trong
   tay thì nó nói ra là đã bỏ qua, chứ không im lặng cho xanh.

Phép 5 là phép duy nhất bắt được thứ đã lọt qua tất cả các phép còn lại một
lần rồi (714 ký tự văn xuôi + số chương trong `SKILL.md`). Nó chỉ chạy được
trên máy CÓ gói riêng — nghĩa là trên máy của tác giả, đúng chỗ và đúng người
cần nó chạy trước khi bấm publish.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import pathlib
import re
import subprocess
import sys
import zipfile

DEFAULT_STORE = "~/Documents/claude/tuhoc-courses"
SHINGLE_WORDS = 12
MAX_LINES_SHOWN = 40


# ---------------------------------------------------------------- tiện ích

def run(repo: pathlib.Path, *args: str) -> tuple[int, str]:
    """Chạy git trong `repo`, trả về (mã thoát thô, stdout)."""
    proc = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.returncode, proc.stdout


def strip_html(raw: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", raw))


def words(text: str) -> list[str]:
    return re.findall(r"\w+", text.lower(), flags=re.UNICODE)


def shingles(text: str, n: int = SHINGLE_WORDS) -> set[str]:
    w = words(text)
    return {" ".join(w[i : i + n]) for i in range(len(w) - n + 1)}


class Report:
    """Gom phát hiện theo từng phép đo, để bản in ra đọc được như một việc cần
    làm chứ không như một bãi grep."""

    def __init__(self) -> None:
        self.sections: list[tuple[str, list[str], str, str]] = []

    def add(self, title: str, findings: list[str], hint: str = "", note: str = "") -> None:
        """`hint` chỉ in khi có phát hiện; `note` in luôn — dùng cho phép đo
        KHÔNG chạy được, thứ tuyệt đối không được im lặng cho xanh."""
        self.sections.append((title, findings, hint, note))

    @property
    def total(self) -> int:
        return sum(len(f) for _, f, _, _ in self.sections)

    def emit(self) -> int:
        print("=" * 72)
        print("CỔNG TIỀN-PUBLISH — dấu vết course riêng tư trong repo")
        print("=" * 72)
        for title, findings, hint, note in self.sections:
            mark = "ĐỎ " if findings else ("--  " if note else "xanh")
            print(f"\n[{mark}] {title} — {len(findings)} phát hiện")
            for line in findings[:MAX_LINES_SHOWN]:
                print(f"       {line}")
            if len(findings) > MAX_LINES_SHOWN:
                print(f"       … và {len(findings) - MAX_LINES_SHOWN} dòng nữa")
            for extra in (note, hint if findings else ""):
                for extra_line in extra.splitlines():
                    print(f"       → {extra_line}")
        print()
        if self.total == 0:
            print("KẾT LUẬN: không phát hiện dấu vết nào. exit=0")
            return 0
        print(f"KẾT LUẬN: {self.total} phát hiện. CHƯA publish được. exit=1")
        return 1


# ------------------------------------------------------------ danh sách id

def public_course_ids(repo: pathlib.Path) -> set[str]:
    """Id của các gói mẫu CÔNG KHAI mà chính repo này phát hành.

    Nguồn duy nhất: `fixtures/courses/<dir>/manifest.json`. Cùng một nguồn mà
    `apps/web/vite-plugins/courseAssets.ts` dùng cho chốt lúc build — hai bản
    danh sách rồi sẽ trôi khác nhau, nên chỉ có một.
    """
    ids: set[str] = set()
    fixtures = repo / "fixtures" / "courses"
    if not fixtures.is_dir():
        return ids
    for entry in sorted(fixtures.iterdir()):
        manifest = entry / "manifest.json"
        if not manifest.is_file():
            continue
        try:
            cid = json.loads(manifest.read_text(encoding="utf-8")).get("id")
        except (ValueError, OSError):
            continue
        if isinstance(cid, str) and cid:
            ids.add(cid)
    return ids


def read_list_file(path: pathlib.Path) -> list[str]:
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.append(line)
    return out


# ------------------------------------------------------------- năm phép đo

def check_refs(repo: pathlib.Path, report: Report) -> None:
    """Phép 1 — tệp course được theo dõi, trên MỌI ref."""
    findings: list[str] = []
    code, refs_out = run(repo, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags")
    if code != 0:
        findings.append(f"git for-each-ref thoát {code} — không đo được")
    for ref in refs_out.split():
        code, tree = run(repo, "ls-tree", "-r", "--name-only", ref, "--", "courses/")
        if code != 0:
            continue
        tracked = [p for p in tree.splitlines() if p and not p.endswith("/.gitkeep")]
        if tracked:
            findings.append(f"{ref}: {len(tracked)} tệp được theo dõi dưới courses/ (vd {tracked[0]})")
    report.add(
        "1. Tệp course được theo dõi, trên mọi ref",
        findings,
        "Gộp nhánh đã xoá chúng, hoặc `git rm -r --cached courses/<id>` trên ref đó.\n"
        "Lưu ý: `git ls-files` CHỈ nhìn nhánh đang checkout — nó xanh trong khi main đỏ.",
    )


def check_history(repo: pathlib.Path, report: Report) -> None:
    """Phép 2 — dấu vết course riêng còn lấy lại được từ lịch sử.

    HAI vế, và vế thứ hai là vế dễ quên:

    (a) object dưới `courses/` — thứ `filter-repo --path courses/` bóc được;
    (b) commit chạm TÊN course ở **mọi tệp khác** — thứ nó KHÔNG bóc được.

    Vế (b) tồn tại vì một phép đo cụ thể: sau khi dọn xong 79 chỗ nêu tên trong
    cây làm việc, phép 4 về 0 — nhưng **44 commit** vẫn chứa bản trước-khi-dọn
    của chính những dòng ấy, và không dòng nào nằm dưới `courses/`. Một cổng chỉ
    đo vế (a) sẽ báo XANH sau khi viết lại lịch sử, trong khi tên course vẫn lấy
    ra được bằng `git log -S`. Đóng gói vế (b) vào đây thay vì để trong tài liệu,
    vì tài liệu không có mã thoát.
    """
    findings: list[str] = []
    code, out = run(repo, "rev-list", "--objects", "--all", "--", "courses/")
    if code != 0:
        findings.append(f"git rev-list thoát {code} — không đo được")
    else:
        objs = [line for line in out.splitlines() if line.strip()]
        keep = [o for o in objs if not o.endswith("/.gitkeep") and not o.endswith(" courses")]
        if keep:
            findings.append(f"(a) {len(keep)} object dưới courses/ vẫn lấy lại được bằng một lệnh")

    markers = read_list_file(repo / "scripts" / "private-markers.txt")
    if not markers:
        findings.append("(b) scripts/private-markers.txt trống — KHÔNG đo được lịch sử ngoài courses/")
    else:
        for m in markers:
            code, out = run(repo, "log", "-S", m, "--oneline", "--all",
                            "--", ".", ":(exclude)courses/")
            if code != 0:
                findings.append(f"(b) git log -S {m!r} thoát {code} — không đo được")
                continue
            hits = [ln for ln in out.splitlines() if ln.strip()]
            if hits:
                findings.append(
                    f"(b) {len(hits)} commit chạm {m!r} NGOÀI courses/ — "
                    f"`filter-repo --path courses/` KHÔNG bóc nhóm này (vd {hits[0].split()[0]})"
                )
    report.add(
        "2. Lịch sử git",
        findings,
        "(a) docs/publishing.md §2 — git filter-repo. Đọc §2.2b trước: ba cái bẫy.\n"
        "(b) docs/publishing.md §2.8 — cần `--replace-text`, không chỉ `--path`.",
    )


def check_bundle(repo: pathlib.Path, public: set[str], report: Report) -> None:
    """Phép 3 — bundle production."""
    findings: list[str] = []
    dist_courses = repo / "apps" / "web" / "dist" / "courses"
    if dist_courses.is_dir():
        for entry in sorted(dist_courses.iterdir()):
            if entry.name in public:
                continue
            count = sum(1 for _ in entry.rglob("*") if _.is_file()) if entry.is_dir() else 1
            findings.append(f"apps/web/dist/courses/{entry.name} — {count} tệp, KHÔNG phải gói mẫu")
    report.add(
        "3. Bundle apps/web/dist/ (thứ `wrangler pages deploy dist` đẩy lên)",
        findings,
        "Xoá apps/web/dist rồi `bun run build` lại — bộ lọc trong\n"
        "apps/web/vite-plugins/courseAssets.ts chỉ chép gói mẫu công khai vào dist.",
    )


def check_names(repo: pathlib.Path, report: Report) -> None:
    """Phép 4 — tên riêng trong tệp được theo dõi, ngoài danh sách cho phép."""
    markers = read_list_file(repo / "scripts" / "private-markers.txt")
    allow = set(read_list_file(repo / "scripts" / "publish-allowlist.txt"))
    findings: list[str] = []
    if not markers:
        report.add(
            "4. Tên course riêng trong tệp được theo dõi",
            ["scripts/private-markers.txt trống hoặc không có — KHÔNG đo được gì"],
            "Fail-closed có chủ ý: một cổng không có gì để tìm phải nói ra, không được cho xanh.",
        )
        return
    args = ["grep", "-n", "-I", "--"]
    for m in markers:
        args[3:3] = ["-e", m]
    code, out = run(repo, *args)
    # git grep: 0 = có khớp, 1 = không khớp, >1 = lỗi thật.
    if code > 1:
        findings.append(f"git grep thoát {code} — không đo được")
    for line in out.splitlines():
        path = line.split(":", 1)[0]
        if path in allow:
            continue
        findings.append(line[:160])
    report.add(
        "4. Tên course riêng trong tệp được theo dõi",
        findings,
        "Mỗi dòng ở đây đi cùng repo ra công khai. Sửa tệp, hoặc — nếu chỗ ấy\n"
        "thật sự phải nêu tên — thêm đường dẫn vào scripts/publish-allowlist.txt\n"
        "KÈM lý do. `git filter-repo --path courses/` KHÔNG chạm tới nhóm này.",
    )


def private_packages(repo: pathlib.Path, public: set[str], store: pathlib.Path) -> list[tuple[str, str]]:
    """Mọi (nhãn, văn bản chương) của các gói KHÔNG công khai tìm được tại chỗ.

    Hai nguồn, cùng cách phân loại như `courseAssets.ts`: thư mục dưới
    `courses/` có id ngoài danh sách công khai, và tệp `.zip` trong kho ngoài
    cây git.
    """
    found: list[tuple[str, str]] = []
    courses = repo / "courses"
    if courses.is_dir():
        for entry in sorted(courses.iterdir()):
            if not entry.is_dir() or entry.name in public:
                continue
            text = "\n".join(
                strip_html(p.read_text(encoding="utf-8", errors="replace"))
                for p in sorted(entry.rglob("*.html"))
            )
            if text.strip():
                found.append((f"courses/{entry.name}", text))
    if store.is_dir():
        for zip_path in sorted(store.glob("*.zip")):
            try:
                with zipfile.ZipFile(zip_path) as zf:
                    manifest = json.loads(zf.read("manifest.json"))
                    if manifest.get("id") in public:
                        continue
                    text = "\n".join(
                        strip_html(zf.read(n).decode("utf-8", errors="replace"))
                        for n in zf.namelist()
                        if n.endswith(".html")
                    )
            except (OSError, KeyError, ValueError, zipfile.BadZipFile):
                continue
            if text.strip():
                found.append((str(zip_path), text))
    return found


def check_prose(repo: pathlib.Path, public: set[str], store: pathlib.Path, report: Report) -> None:
    """Phép 5 — văn xuôi chép nguyên văn, KHÔNG kèm tên course."""
    packages = private_packages(repo, public, store)
    if not packages:
        report.add(
            "5. Văn xuôi riêng tư trong tệp được theo dõi  [KHÔNG chạy được]",
            [],
            note=(
                "Không tìm thấy gói riêng nào để làm máy đối chiếu: không có thư mục lạ\n"
                f"trong courses/ và không có .zip lạ trong {store}.\n"
                "Trên một bản clone mới đó là trạng thái đúng và không có gì để rò.\n"
                "Trên máy tác giả thì KHÔNG: chạy `make courses` rồi chạy lại lệnh này\n"
                "TRƯỚC khi publish — đây là phép đo duy nhất bắt được văn xuôi chép tay."
            ),
        )
        return

    corpus: set[str] = set()
    labels = []
    for label, text in packages:
        corpus |= shingles(text)
        labels.append(label)

    allow = set(read_list_file(repo / "scripts" / "publish-allowlist.txt"))
    code, listing = run(repo, "ls-files", "-z")
    findings: list[str] = []
    if code != 0:
        findings.append(f"git ls-files thoát {code} — không đo được")
    for rel in listing.split("\0"):
        if not rel or rel in allow:
            continue
        path = repo / rel
        if not path.is_file() or path.stat().st_size > 2_000_000:
            continue
        try:
            raw = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        hit = shingles(strip_html(raw)) & corpus
        if hit:
            sample = sorted(hit)[0]
            findings.append(f"{rel}: {len(hit)} đoạn ≥{SHINGLE_WORDS} từ trùng — vd “{sample[:90]}…”")
    report.add(
        f"5. Văn xuôi riêng tư trong tệp được theo dõi (đối chiếu với {', '.join(labels)})",
        findings,
        "Đây là nhóm mà cả bốn phép trên đều mù: văn xuôi không kèm tên course.\n"
        "Thay ví dụ bằng nội dung từ fixtures/courses/ — giữ chuẩn, đổi ngữ liệu.",
    )


# ------------------------------------------------------------------- main

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo",
        default=str(pathlib.Path(__file__).resolve().parent.parent),
        help="Gốc repo cần kiểm (mặc định: repo chứa chính script này).",
    )
    parser.add_argument(
        "--store",
        default=DEFAULT_STORE,
        help="Kho gói riêng ngoài cây git (mặc định: $TUHOC_COURSE_STORE hoặc ~/Documents/claude/tuhoc-courses).",
    )
    args = parser.parse_args()

    repo = pathlib.Path(args.repo).resolve()
    store = pathlib.Path(os.environ.get("TUHOC_COURSE_STORE", args.store)).expanduser()

    public = public_course_ids(repo)
    report = Report()
    print(f"repo   = {repo}")
    print(f"kho    = {store}")
    print(f"gói mẫu công khai = {', '.join(sorted(public)) or '(không có)'}")
    print()

    check_refs(repo, report)
    check_history(repo, report)
    check_bundle(repo, public, report)
    check_names(repo, report)
    check_prose(repo, public, store, report)

    return report.emit()


if __name__ == "__main__":
    sys.exit(main())
