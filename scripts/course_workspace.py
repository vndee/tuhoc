#!/usr/bin/env python3
"""Bung các gói course vào `courses/` để chạy dev và test.

## Tại sao có tệp này

`courses/***REMOVED***/` từng là 47 tệp được commit trong chính repo sắp
publish (spec §2B.1). Nó đã đi ra ngoài. Nhưng ba thứ trong repo vẫn cần **nội
dung thật** của một course:

  * `vite dev` / `vite build` phục vụ `/courses/...` (apps/web/vite-plugins/
    courseAssets.ts);
  * các tệp test đơn vị đọc một chương thật (painter, anchor, SelectionToolbar,
    version, cộng `packages/course-format/src/zip.test.ts` và
    `tools/tuhoc-cli/src/pack.test.ts`);
  * bốn tệp e2e mở một course thật qua HTTP.

Cách rẻ nhất là đổi chúng sang fixture bịa **viết tay trong tệp test**. Cách đó
bị cấm, và có lý do đo được: trong hệ thống con này việc chạy trên gói thật đã
**bác bỏ bảy phép đo sai** mà fixture thủ công cho xanh hết. Nên dữ liệu vẫn
phải là một **gói thật do `tuhoc pack` ghi ra**, mang đúng những hình dạng đã
từng bắt lỗi; chỉ có chỗ cất là đổi.

## Hai nguồn, và vì sao phải là hai

**Nguồn 1 — `fixtures/courses/*.zip`, nằm TRONG repo.** Đây là các gói mẫu công
khai, do chính repo này soạn và commit (xem `fixtures/README.md`). Chúng là dữ
liệu test mặc định: một bản clone mới có chúng, nên `make test-web`,
`make test-format`, `make test-cli` và `make test-e2e` xanh trọn vẹn ngay lần
chạy đầu tiên, không cần ai đưa cho thứ gì.

**Nguồn 2 — kho NGOÀI cây git**, mặc định `~/Documents/claude/tuhoc-courses`,
đổi được bằng `TUHOC_COURSE_STORE`. Đây là chỗ giáo trình riêng tư sống sau
task 11. Không có kho thì **không phải lỗi**: người vừa clone repo không có gói
riêng của ai cả, và đó là trạng thái đúng.

Mỗi gói, dù từ nguồn nào, được bung vào `courses/<manifest id>/`.

## Cố ý KHÔNG làm

Script này **không** tự tái định gốc gói bị lồng dưới một thư mục, không đoán
`manifest.json` nằm ở đâu, không kiểm gói theo bộ luật. Đó là việc của
`packages/course-format` và của đường import thật trong trình duyệt; viết lại ở
đây là tạo **bản sao trôi dạt** của bộ luật — đúng thứ mà cả hệ thống con này
tồn tại để tránh. Ở đây chỉ nhận đúng hình dạng mà `tuhoc pack` ghi ra:
`manifest.json` ở gốc kho. Gói khác hình dạng thì bị từ chối kèm câu "pack lại
bằng tuhoc pack", chứ không được đoán hộ.
"""

from __future__ import annotations

import json
import os
import pathlib
import shutil
import sys
import zipfile

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
COURSES_DIR = REPO_ROOT / "courses"
FIXTURES_DIR = REPO_ROOT / "fixtures" / "courses"
DEFAULT_STORE = "~/Documents/claude/tuhoc-courses"
MANIFEST = "manifest.json"


def store_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("TUHOC_COURSE_STORE", DEFAULT_STORE)).expanduser()


def unsafe(name: str) -> str | None:
    """Lý do một tên mục trong zip không được ghi ra đĩa, hoặc None nếu nó ổn.

    `zipfile.extractall` đã chặn zip-slip từ Python 3.6, nhưng ở đây mỗi mục
    được ghi bằng tay (để biết chính xác cái gì đã ghi), nên hàng rào phải viết
    lại. Ba dạng, không phải một: đường tuyệt đối, `..`, và tên ổ đĩa Windows.
    """
    if name.startswith("/") or name.startswith("\\"):
        return "đường dẫn tuyệt đối"
    if len(name) > 1 and name[1] == ":":
        return "tên ổ đĩa"
    parts = pathlib.PurePosixPath(name).parts
    if ".." in parts:
        return 'có thành phần ".."'
    return None


def read_course_id(zip_path: pathlib.Path) -> str:
    """Đọc `manifest.id` của một gói, kèm đúng phép kiểm mà `unpack` dùng.

    Tách riêng để hàng rào va chạm ở `main` hỏi được "gói này là course nào" mà
    KHÔNG phải chép luật sang chỗ thứ hai — hai bản luật rồi sẽ trôi khác nhau.
    """
    with zipfile.ZipFile(zip_path) as zf:
        if MANIFEST not in [n for n in zf.namelist() if not n.endswith("/")]:
            raise SystemExit(
                f"course_workspace: {zip_path} không có {MANIFEST} ở gốc kho.\n"
                f"  Gói do `tuhoc pack` ghi ra luôn có. Nếu đây là kho nén bằng Finder hay\n"
                f"  công cụ khác (mọi thứ bị lồng dưới một thư mục), hãy pack lại:\n"
                f"    bun tools/tuhoc-cli/src/index.ts pack <thư-mục> -o {zip_path}\n"
                f"  Màn hình Import trong app xử lý được gói lồng; script này thì cố ý không."
            )
        manifest = json.loads(zf.read(MANIFEST))
        course_id = manifest.get("id")
        if not isinstance(course_id, str) or not course_id or unsafe(course_id) or "/" in course_id:
            raise SystemExit(f'course_workspace: {zip_path} có manifest.id không dùng làm tên thư mục được: {course_id!r}')
        return course_id


def unpack(zip_path: pathlib.Path) -> tuple[str, int]:
    """Bung một gói vào `courses/<id>/`. Trả về (id, số tệp đã ghi)."""
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if not n.endswith("/")]
        if MANIFEST not in names:
            raise SystemExit(
                f"course_workspace: {zip_path} không có {MANIFEST} ở gốc kho.\n"
                f"  Gói do `tuhoc pack` ghi ra luôn có. Nếu đây là kho nén bằng Finder hay\n"
                f"  công cụ khác (mọi thứ bị lồng dưới một thư mục), hãy pack lại:\n"
                f"    bun tools/tuhoc-cli/src/index.ts pack <thư-mục> -o {zip_path}\n"
                f"  Màn hình Import trong app xử lý được gói lồng; script này thì cố ý không."
            )
        for name in names:
            reason = unsafe(name)
            if reason is not None:
                raise SystemExit(f"course_workspace: {zip_path} có mục không ghi được — {name}: {reason}")

        course_id = read_course_id(zip_path)

        dest = COURSES_DIR / course_id
        # Xoá trước khi ghi: bung đè lên bản cũ sẽ để lại chương của phiên bản
        # trước nếu gói mới bỏ chương đó đi — và một tệp thừa trong thư mục làm
        # việc là đúng loại sai lệch không ai đi tìm.
        shutil.rmtree(dest, ignore_errors=True)
        for name in names:
            target = dest / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(name))
        return course_id, len(names)


def zips_in(directory: pathlib.Path) -> list[pathlib.Path]:
    if not directory.is_dir():
        return []
    return sorted(p for p in directory.iterdir() if p.suffix.lower() == ".zip")


def main() -> int:
    # Gói mẫu công khai đi TRƯỚC trong danh sách, nhưng thứ tự ở đây không phải
    # thứ tự ưu tiên — va chạm bị từ chối chứ không được giải quyết ngầm (xem
    # dưới). Nó chỉ quyết định thứ tự dòng in ra.
    fixtures = zips_in(FIXTURES_DIR)
    store = store_dir()
    private = zips_in(store)

    if not fixtures:
        # Không phải lỗi cứng, nhưng đáng nói: `fixtures/courses/*.zip` được
        # commit, nên vắng chúng nghĩa là cây làm việc đang thiếu thứ gì đó.
        print(f"course_workspace: không thấy gói mẫu nào trong {FIXTURES_DIR.relative_to(REPO_ROOT)}/.")
        print("  Đóng gói lại bằng lệnh ghi trong fixtures/README.md nếu bạn vừa sửa nguồn.")
    if not store.is_dir():
        print(f"course_workspace: chưa có kho gói riêng ở {store} — bỏ qua.")
        print("  Đây là trạng thái đúng của một bản clone mới: giáo trình riêng là gói rời, không nằm trong repo.")
        print("  Có gói rồi thì đặt tệp .zip vào đó (hoặc trỏ TUHOC_COURSE_STORE sang nơi khác) rồi chạy lại.")
    elif not private:
        print(f"course_workspace: {store} chưa có tệp .zip nào — bỏ qua.")

    zips = fixtures + private
    if not zips:
        return 0

    # Hai gói cùng course_id sẽ bung vào CÙNG một thư mục, và `unpack` xoá trước
    # khi ghi — nên cái chạy sau thắng, âm thầm, theo thứ tự tên tệp. Kho riêng
    # lại được thiết kế để giữ nhiều phiên bản của cùng một course (tính năng
    # ghim phiên bản), nên va chạm là chuyện thường chứ không phải ngoại lệ. Sắp
    # theo tên còn dính bẫy semver-từ điển: "1.10.0" đứng TRƯỚC "1.9.0".
    # ⇒ Từ chối ồn ào thay vì chọn hộ. Thà không chạy còn hơn chạy trên một
    #   phiên bản mà không ai biết là đã được chọn.
    #
    # Phép kiểm chạy trên CẢ HAI nguồn gộp lại, không phải riêng từng nguồn: một
    # gói riêng trùng `id` với gói mẫu sẽ lặng lẽ đè lên dữ liệu test mặc định
    # và làm cả bộ test đo trên nội dung mà không ai chọn — đúng cái loại sai
    # lệch mà quy tắc này tồn tại để chặn.
    seen: dict[str, pathlib.Path] = {}
    collisions: list[tuple[str, pathlib.Path, pathlib.Path]] = []
    for zip_path in zips:
        cid = read_course_id(zip_path)
        if cid in seen:
            collisions.append((cid, seen[cid], zip_path))
        else:
            seen[cid] = zip_path
    if collisions:
        print("course_workspace: có nhiều gói cho cùng một course — không đoán hộ.", file=sys.stderr)
        for cid, first, second in collisions:
            print(f"  {cid}: {first} và {second}", file=sys.stderr)
        print("  Giữ lại đúng một gói cho mỗi course, rồi chạy lại.", file=sys.stderr)
        return 1

    COURSES_DIR.mkdir(parents=True, exist_ok=True)
    for zip_path in zips:
        course_id, count = unpack(zip_path)
        where = "mẫu" if zip_path in fixtures else "riêng"
        print(f"course_workspace: [{where}] {zip_path.name} → courses/{course_id}/ ({count} tệp)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
