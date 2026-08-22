/**
 * The archives the registry publishes.
 *
 * The load-bearing test here is the ROUND TRIP: an archive this writes must be
 * one `packages/course-format` accepts, because the whole reason the file
 * exists is that `apps/web` pulls a course through its existing `.zip`-at-a-URL
 * door and there was previously no `.zip` anywhere on the site. A test that
 * only checked "a file appeared at the right path" would stay green for an
 * archive nothing can open — which is exactly the failure that matters, since
 * the reader meets it as a validation error on a package its own maintainers
 * had already validated.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { unpackZip, validatePackage } from '../../../packages/course-format/src/index.ts';
import { InvalidPackageTreeError, NothingToPackError, packSite, sitePackagePath } from './pack-site.ts';
import { EmptyRegistryError } from './tree.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FIXTURE_COURSES = join(REPO_ROOT, 'fixtures', 'courses');

const cleanup: string[] = [];
afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function tmproot(prefix = 'tuhoc-registry-pack-'): string {
  const dir = mkdtempSync(join(osTmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

function writeCourse(
  dir: string,
  id: string,
  version: string,
  chapterHtml = '<p>nội dung</p>',
  tier: 'content' | 'interactive' = 'content',
): void {
  mkdirSync(join(dir, 'chapters'), { recursive: true });
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify(
      {
        id,
        title: 'Gói thử',
        description: 'Gói dùng cho test pack-site',
        lang: 'vi',
        version,
        runtime: '^1',
        tier,
        license: 'CC-BY-4.0',
        authors: [{ name: 'test' }],
        generatedBy: 'human',
        parts: [
          { title: 'Phần I', chapters: [{ id: 'c1', num: '1.1', title: 'C', short: 'C', file: 'chapters/c1.html' }] },
        ],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, 'chapters', 'c1.html'), chapterHtml);
}

/* ------------------------------------------------------------------ *
 * Đường dẫn — nửa hợp đồng sống ở đây
 * ------------------------------------------------------------------ */

describe('sitePackagePath', () => {
  /**
   * Nửa kia của hợp đồng nằm ở `apps/web/src/registry/pull.ts`, và bài giữ hai
   * nửa khớp nhau nằm ở `apps/web/src/registry/pull.test.ts` — nó chạy trong
   * Node, nơi các import `node:*` của tệp này là vô hại, và so GIÁ TRỊ THẬT
   * của hai bên. Cùng bố trí như `INDEX_SCHEMA` / `SUPPORTED_INDEX_SCHEMA`.
   */
  it('đánh địa chỉ theo PHIÊN BẢN, dưới `courses/`', () => {
    expect(sitePackagePath('khoa-hoc', '1.2.0')).toBe('courses/khoa-hoc/1.2.0.zip');
  });
});

/* ------------------------------------------------------------------ *
 * Vòng tròn khép kín: thứ ghi ra phải mở được bằng đúng bộ luật
 * ------------------------------------------------------------------ */

describe('packSite trên hai gói mẫu THẬT trong fixtures/courses', () => {
  it('ghi một .zip cho mỗi phiên bản, và mỗi .zip ĐI QUA ĐƯỢC validatePackage', async () => {
    const out = tmproot('tuhoc-site-');
    const packed = await packSite(FIXTURE_COURSES, out);

    // So bằng ĐÚNG cả danh sách đường dẫn. `toContain` một cái cũng đúng với
    // một cài đặt bỏ sót gói thứ hai — tức với một catalog liệt kê hai course
    // mà chỉ một cái kéo về được.
    expect(packed.map((p) => p.path)).toEqual([
      'courses/bat-bien-vong-lap/1.0.0.zip',
      'courses/so-dau-phay-dong/1.0.0.zip',
    ]);

    for (const p of packed) {
      const bytes = new Uint8Array(readFileSync(join(out, p.path)));
      // Vòng tròn: mở lại bằng đúng bộ đọc của nền tảng, rồi chạy đúng bộ luật.
      const files = unpackZip(bytes);
      expect([...files.keys()]).toContain('manifest.json');
      const result = validatePackage(files);
      expect(result.findings).toEqual([]);
      expect(result.ok).toBe(true);
      expect(p.bytes).toBe(bytes.byteLength);
    }
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * `registryId` — REGISTRY KHÔNG GÁN NÓ, VÀ ĐÓ LÀ MỘT QUYẾT ĐỊNH ĐƯỢC GHI
   * ═══════════════════════════════════════════════════════════════════════
   *
   * **Phép đo, ngày 2026-08-23.** Không một đường nào trong repo này từng đặt
   * `manifest.registryId`. Không `tools/registry` (tệp này zip byte lấy thẳng
   * từ đĩa, không viết lại `manifest.json` bao giờ), không
   * `apps/web/src/registry/pull.ts`, không `apps/web/src/course/import.ts`.
   * Trường ấy chỉ tồn tại như một ô kiểu tuỳ chọn
   * (`packages/course-format/src/types.ts`) và trong fixture viết tay của test.
   *
   * **Hệ quả người dùng thấy được:** `apps/web/src/pages/Library.tsx` chọn
   * nhãn nguồn theo `held?.registryId`, nên một course KÉO VỀ TỪ REGISTRY hiện
   * nhãn `tự nhập`. Nhánh `registry` của trang ấy hôm nay **không đường nào
   * tới được**.
   *
   * **Vì sao KHÔNG sửa bằng cách gán nó ở đây, và cũng không ở `pull.ts`:**
   *
   *   1. `docs/course-format.md:94` và `:314` nói registry gán trường này *sau
   *      khi PR được merge* — **"Đừng tự điền."** Một `pull.ts` tự đóng dấu là
   *      đúng thứ câu ấy cấm, chỉ đổi người tự điền.
   *   2. **Gán ở `pull.ts` còn làm lệch hai bản của cùng một manifest.**
   *      `import.ts` ghi `row.manifest` (đã parse) VÀ `row.files['manifest.json']`
   *      (byte gốc) trong cùng một hàng Dexie. Đóng dấu vào bản đã parse làm
   *      hai bản bất đồng, và không cổng nào hôm nay canh chuyện đó.
   *   3. **Gán ở ĐÂY thì phải bịa ra một giá trị.** `Library.test.tsx:212`
   *      dùng `'vndee/khoa'` — hình dạng `<chủ>/<repo>`, tức là *danh tính của
   *      registry*, không phải id course. Tệp này không biết registry của nó
   *      tên gì (không đối số nào chở vào), và `RegistryEntry.id` thì đã bằng
   *      `manifest.id` rồi nên đóng dấu bằng nó là thêm một bản sao thừa. Bịa
   *      một ngữ nghĩa để làm một nhãn hết sai là đổi sai chiều.
   *   4. **Không quyết định an ninh nào dựa vào trường này.** Đo được: rào
   *      riêng tư của hệ thống con 4 là rào CẤU TRÚC —
   *      `apps/web/src/registry/ratingFence.test.tsx` khoá danh sách ba tệp
   *      được chạm tới bề mặt chấm sao và buộc `Catalog.tsx` chỉ dựng hàng từ
   *      `index.json`. `<Rating>`/`<Discussion>` nhận `registryId={course.id}`
   *      — tức `RegistryEntry.id`, **không phải** `manifest.registryId`. Nhãn
   *      nguồn của thư viện không gác gì cả.
   *
   * ⇒ Đây là **một bước chưa cài ở phía registry**, không phải một lỗi của
   * đường kéo về. Bài kiểm này là chỗ quyết định ấy được canh thay vì được
   * nhớ: nó ĐỎ ngay khi ai đó bắt đầu đóng dấu — và người ấy phải quay lại
   * đọc bốn điểm trên, xoá bài này, rồi đi nối nốt nửa còn lại (nhãn `registry`
   * của thư viện, và `docs/carried-forward.md`).
   */
  it('KHÔNG đóng dấu `registryId` vào gói xuất bản — quyết định, không phải bỏ sót', async () => {
    const out = tmproot('tuhoc-site-regid-');
    const packed = await packSite(FIXTURE_COURSES, out);

    // ĐỐI CHỨNG: có gói thật để đọc. Không có dòng này, một `packSite` sinh 0
    // gói cũng "không đóng dấu gì".
    expect(packed.length).toBeGreaterThan(0);

    for (const p of packed) {
      const files = unpackZip(new Uint8Array(readFileSync(join(out, p.path))));
      const raw = files.get('manifest.json');
      expect(raw, `${p.path} không có manifest.json`).toBeDefined();
      const manifest = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;

      // Đối chứng cho chính phép đọc: nếu `JSON.parse` cho ra một object rỗng
      // thì chốt dưới đây xanh mà chẳng đo gì.
      expect(manifest.id, `${p.path}: manifest đọc ra không có id`).toBe(p.id);

      expect(
        'registryId' in manifest,
        `${p.path} mang \`registryId\`. Nếu đây là CHỦ Ý thì đọc khối chú thích ` +
          'ngay trên bài này: nó liệt kê bốn lý do đã cân, và nói rõ nửa còn lại ' +
          'phải nối cùng lúc (nhãn `registry` của `pages/Library.tsx`, và mục ' +
          'tương ứng trong `docs/carried-forward.md`).',
      ).toBe(false);
    }
  });

  /**
   * `packZip` ghim một mtime DOS cố định, và `zip.test.ts` giữ điều đó dưới
   * nhan đề *"đầu ra phải TÁI LẬP ĐƯỢC, vì sổ đăng ký sẽ băm nó"*. Đây là chỗ
   * lời hứa ấy được tiêu dùng: một bản dựng lại của cùng một commit không
   * được làm hỏng bản cache trên CDN của bất kỳ ai.
   */
  it('đóng gói hai lần cho ra byte y hệt — bản dựng lại không phá cache của ai', async () => {
    const a = tmproot('tuhoc-site-a-');
    const b = tmproot('tuhoc-site-b-');
    await packSite(FIXTURE_COURSES, a);
    await packSite(FIXTURE_COURSES, b);

    const rel = 'courses/so-dau-phay-dong/1.0.0.zip';
    expect(readFileSync(join(a, rel)).equals(readFileSync(join(b, rel)))).toBe(true);
  });
});

describe('bố cục nhiều phiên bản', () => {
  it('mỗi phiên bản một .zip riêng, đánh theo số của chính nó', async () => {
    const root = tmproot();
    for (const v of ['1.9.0', '1.10.0']) {
      const dir = join(root, 'nhieu-ban', v);
      mkdirSync(dirname(dir), { recursive: true });
      writeCourse(dir, 'nhieu-ban', v);
    }
    const out = tmproot('tuhoc-site-');
    const packed = await packSite(root, out);

    expect(packed.map((p) => p.path)).toEqual([
      'courses/nhieu-ban/1.10.0.zip',
      'courses/nhieu-ban/1.9.0.zip',
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * Hai lời từ chối — và cả hai đều là chống cổng mù
 * ------------------------------------------------------------------ */

describe('packSite từ chối thay vì publish thứ hỏng', () => {
  /**
   * Cùng lời từ chối `buildIndex` đưa ra, và vì cùng lý do: cổng PR và byte
   * được publish KHÔNG ĐƯỢC phép bất đồng. Nếu tệp này ghi archive cho một gói
   * mà bộ luật từ chối, thì một `<script>` trong gói hạng `content` sẽ có địa
   * chỉ tải về dù CI đã chặn nó.
   */
  it('gói hạng `content` mang <script> KHÔNG được có địa chỉ tải về', async () => {
    const root = tmproot();
    writeCourse(join(root, 'gian-lan'), 'gian-lan', '1.0.0', '<h1>Chương</h1><script>alert(1)</script>');
    const out = tmproot('tuhoc-site-');

    await expect(packSite(root, out)).rejects.toThrow(InvalidPackageTreeError);
  });

  /**
   * ĐỐI CHỨNG bắt buộc. Không có nó, một cài đặt từ chối MỌI thứ cũng xanh ở
   * bài trên — và hạng `interactive` được phép chạy mã, đó là toàn bộ ý nghĩa
   * của hạng ấy.
   */
  it('ĐỐI CHỨNG: cùng gói ấy khai `interactive` thì ĐƯỢC đóng gói', async () => {
    const root = tmproot();
    writeCourse(
      join(root, 'tuong-tac'),
      'tuong-tac',
      '1.0.0',
      '<h1>Chương</h1><script>alert(1)</script>',
      'interactive',
    );
    const out = tmproot('tuhoc-site-');

    const packed = await packSite(root, out);
    expect(packed.map((p) => p.path)).toEqual(['courses/tuong-tac/1.0.0.zip']);
  });

  /**
   * CHỐT CHỐNG CỔNG MÙ. Một site mà `index.json` liệt kê course trong khi mọi
   * nút "kéo về" trả 404 là một cổng mù có CDN đứng trước — nó trông như đang
   * chạy. `courseDirsUnder` đã ném khi root không có thư mục nào; bài này ghim
   * ca còn lại, nơi vòng quét chạy hết mà không đóng gói được gì.
   */
  it('quét ra 0 gói thì NÉM, không publish một site rỗng', async () => {
    const root = tmproot();
    // Một thư mục con không có manifest ở đâu cả: `courseDirsUnder` thấy nó,
    // `inspectCourse` báo REGISTRY_NO_PACKAGE.
    mkdirSync(join(root, 'khong-phai-course', 'chapters'), { recursive: true });

    await expect(packSite(root, tmproot('tuhoc-site-'))).rejects.toThrow(InvalidPackageTreeError);
  });

  it('root không có thư mục nào → EmptyRegistryError, câu nói rõ là cổng mù', async () => {
    const root = tmproot();
    writeFileSync(join(root, 'doc.txt'), 'chỉ có tệp, không có course');

    await expect(packSite(root, tmproot('tuhoc-site-'))).rejects.toThrow(EmptyRegistryError);
  });

  /**
   * `NothingToPackError` là lớp còn lại của cùng một chốt. Nó không tới được
   * qua `packSite` hôm nay — `inspectCourse` biến mọi thư mục rỗng thành một
   * finding, nên `InvalidPackageTreeError` ném trước — và nó vẫn ở lại: cái
   * ném trước tuỳ vào `inspectCourse`, còn khẳng định *"không bao giờ publish
   * một site không kéo về được"* là của tệp này.
   */
  it('NothingToPackError nói ra vì sao một site rỗng là cổng mù', () => {
    expect(new NothingToPackError('/x').message).toMatch(/cổng mù/);
  });
});
