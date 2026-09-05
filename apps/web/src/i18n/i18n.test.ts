import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { en } from '../../../../packages/i18n/src/messages/en';
import { vi } from '../../../../packages/i18n/src/messages/vi';
import { DEVICE_PREFERENCE_KEYS, USER_CONTENT_KEYS } from '../db/localStorage';
import { DEFAULT_LANG, LANGS, LANG_STORAGE_KEY, MESSAGES, normalizeLang, t } from './index';

/**
 * Một giá trị catalog → chuỗi để soi. Khoá có tham số là HÀM, và các hàm ấy
 * không cùng chữ ký (`(count: number)`, `(quote: string)`, …), nên không có
 * một đối số nào hợp kiểu với tất cả. Ở đây cần đúng *chữ mà bản dịch tạo ra*,
 * không cần kiểu — nên ép một lần, tại một chỗ, kèm lý do, thay vì rắc `as never`
 * vào từng chỗ gọi.
 */
function sample(value: unknown): string {
  return typeof value === 'function' ? (value as (...args: readonly unknown[]) => string)(1) : String(value);
}

/* ====================================================================== *
 * 1. HAI BẢN DỊCH PHẢI KHỚP — và cổng thật là `tsc -b`, không phải tệp này
 * ====================================================================== */

/**
 * `messages/en.ts` khai `export const en: Messages`, với
 * `Messages = typeof vi`. Thiếu một khoá là **lỗi biên dịch**, không phải một
 * chuỗi rơi ra lúc chạy — đó là điểm mạnh DUY NHẤT của cách tự viết so với một
 * thư viện i18n, vì thư viện trả về chính khoá ấy lúc chạy và không cổng nào
 * biết.
 *
 * Các bài dưới đây là bản sao LÚC CHẠY của cùng luật ấy, và chúng không thừa:
 * `make test-web` trước task này **không chạy `tsc -b`** (đã đo: `test-web` chỉ
 * gọi `bun run test`, tức vitest, thứ không kiểm kiểu — đúng cái bẫy mà báo cáo
 * Task 3 §0.2 đã ghi lại một lần rồi). Task này nối `bun run typecheck` vào
 * `test-web`, nên cổng kiểu đã có thật; hai bài này vẫn ở lại làm lớp thứ hai,
 * và vì chúng nói được điều `tsc` không nói: bản dịch nào còn nguyên văn tiếng
 * Việt.
 */
describe('hai catalog', () => {
  it('en phủ ĐÚNG tập khoá của vi — không thiếu, không thừa', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(vi).sort());
  });

  it('mọi giá trị là chuỗi hoặc hàm trả chuỗi — không có object lồng nào lọt qua kiểu', () => {
    const odd: string[] = [];
    for (const [lang, catalog] of Object.entries(MESSAGES)) {
      for (const [key, value] of Object.entries(catalog)) {
        if (typeof value !== 'string' && typeof value !== 'function') odd.push(`${lang}.${key}`);
      }
    }
    expect(odd).toEqual([]);
  });

  /**
   * Bài này bắt thứ `tsc` KHÔNG bắt được: một `en.ts` chép nguyên xi từ `vi.ts`
   * biên dịch hoàn hảo. Danh sách miễn trừ được viết ra TỪNG KHOÁ MỘT, không
   * theo tiền tố, vì mỗi mục là một quyết định phải đọc được:
   *
   *   `lang.name.vi` — tên của một ngôn ngữ, viết bằng chính ngôn ngữ ấy. Mọi
   *     bộ chọn ngôn ngữ làm vậy, nếu không thì nó chỉ dùng được bởi người
   *     không cần tới nó.
   *   `app.name`     — TÊN RIÊNG của nền tảng ("Tự học"), thêm ở Task 5 cùng
   *     lúc với `shell/Sidebar.tsx`. Tên riêng không dịch: một bản tiếng Anh
   *     gọi sản phẩm là "Self-study" đặt tên cho một thứ không tồn tại, và
   *     `<title>` của `index.html` — được ghim nguyên văn ở bài cuối tệp này —
   *     vẫn là "Tự học" ở mọi ngôn ngữ.
   *
   * Danh sách này chỉ được dài ra kèm một lý do viết ra ở đây. Nó là chỗ duy
   * nhất trong repo phát hiện được một bản dịch chưa dịch.
   */
  it('không khoá nào của en còn là tiếng Việt, trừ tên ngôn ngữ và tên riêng', () => {
    const stillVietnamese = Object.entries(en)
      .filter(([, value]) => VIETNAMESE.test(sample(value)))
      .map(([key]) => key)
      .sort();
    expect(stillVietnamese).toEqual(['app.name', 'lang.name.vi']);
  });

  it('LANGS và MESSAGES nói cùng một danh sách ngôn ngữ', () => {
    expect([...LANGS]).toEqual(['vi', 'en']);
    expect(Object.keys(MESSAGES).sort()).toEqual([...LANGS].sort());
    expect(DEFAULT_LANG).toBe('vi');
  });
});

describe('t()', () => {
  it('trả về chuỗi của ĐÚNG ngôn ngữ được hỏi', () => {
    expect(t('vi', 'lang.switcher.label')).toBe('Ngôn ngữ giao diện');
    expect(t('en', 'lang.switcher.label')).toBe('Interface language');
  });

  /**
   * Khoá có tham số là HÀM, không phải chuỗi có chỗ trống. Số nhiều tiếng Anh
   * và tiếng Việt không cùng luật, và một `{n} courses` thì không có chỗ nào
   * để nói điều đó.
   */
  it('khoá có tham số chạy được luật số nhiều RIÊNG của từng ngôn ngữ', () => {
    expect(t('vi', 'library.courseCount', 1)).toBe('1 khóa học');
    expect(t('vi', 'library.courseCount', 5)).toBe('5 khóa học');
    expect(t('en', 'library.courseCount', 1)).toBe('1 course');
    expect(t('en', 'library.courseCount', 5)).toBe('5 courses');
  });
});

describe('normalizeLang()', () => {
  it('nhận đúng hai giá trị hợp lệ, và trả null cho mọi thứ khác', () => {
    expect(normalizeLang('vi')).toBe('vi');
    expect(normalizeLang('en')).toBe('en');
    expect(normalizeLang('fr')).toBeNull();
    expect(normalizeLang('')).toBeNull();
    expect(normalizeLang(null)).toBeNull();
    expect(normalizeLang('VI')).toBeNull();
  });
});

/* ====================================================================== *
 * 2. LỰA CHỌN NGÔN NGỮ LÀ TUỲ CHỌN CỦA THIẾT BỊ
 * ====================================================================== */

/**
 * `db/local.test.ts` cấm mọi tệp sản phẩm dưới `apps/web/src` chạm
 * `localStorage` ngoài `db/local.ts`, và bắt mọi khoá phải được phân loại là
 * NỘI DUNG NGƯỜI DÙNG hay TUỲ CHỌN THIẾT BỊ trước khi ghi được. Lựa chọn ngôn
 * ngữ thuộc vế thứ hai, cùng lập luận với `itbook-theme`: đăng nhập bằng tài
 * khoản khác không phải một yêu cầu đổi ngôn ngữ, và không có gì riêng tư
 * trong "tiếng Anh".
 *
 * Hệ quả cụ thể: `clearLocalData()` KHÔNG xoá nó (bài kiểm ở
 * `LanguageProvider.test.tsx`), và không có gì đẩy nó lên máy chủ.
 */
describe('ngôn ngữ được ghi nhớ THEO THIẾT BỊ', () => {
  it('khoá được phân loại là tuỳ chọn thiết bị, KHÔNG phải nội dung người dùng', () => {
    expect(LANG_STORAGE_KEY).toBe('itbook-lang');
    expect((DEVICE_PREFERENCE_KEYS as readonly string[]).includes(LANG_STORAGE_KEY)).toBe(true);
    expect((USER_CONTENT_KEYS as readonly string[]).includes(LANG_STORAGE_KEY)).toBe(false);
  });

  /**
   * "Không đồng bộ" viết thành một phép đo chứ không phải một lời hứa, và phép
   * đo là **danh sách phụ thuộc**, không phải một `grep` tìm chữ "outbox".
   *
   * Bản đầu tiên của bài này ĐÚNG LÀ một `grep`, và nó đỏ ngay lần chạy đầu —
   * vì `i18n/index.ts` có chữ `api/client.ts` trong một CHÚ THÍCH. Đúng cái lỗi
   * mà cả cổng chuỗi cứng dưới đây tồn tại để tránh, xảy ra trong chính tệp
   * dựng nên nó. Danh sách đóng dưới đây không đọc văn xuôi: một `import`
   * `../sync/engine` hay `../api/client` làm nó đỏ, và một câu nhắc tới chúng
   * thì không.
   */
  it('phụ thuộc của hạ tầng i18n là một danh sách ĐÓNG — không có đường nào ra máy chủ', () => {
    const specifiers = new Set<string>();
    for (const file of i18nSourceFiles()) {
      for (const spec of importSpecifiers(file, readFileSync(file, 'utf-8'))) specifiers.add(spec);
    }
    expect([...specifiers].sort()).toEqual([
      '../db/localStorage',
      './LanguageProvider',
      './index',
      './tNode',
      '@tuhoc/i18n',
      'react',
    ]);
  });
});

/* ====================================================================== *
 * 3. CỔNG CHẶN CHUỖI CỨNG
 * ====================================================================== */

/**
 * VÌ SAO CỔNG NÀY QUÉT BA CÂY CHỨ KHÔNG PHẢI MỘT.
 *
 * Kế hoạch (HC-1) nói thẳng ra hình dạng của lỗi cần tránh: *"một cổng i18n chỉ
 * quét `apps/web/src` sẽ IM LẶNG về 14 tệp trong ứng dụng kho khoá — nơi có
 * form nhập key"* (nguyên văn HC-1 gọi thư mục ấy bằng đường dẫn; đường dẫn đó
 * không còn nên câu trích thay bằng tên gọi). Dự án này đã có năm cổng mù, tất
 * cả cùng một hình dạng: **cổng đo đúng thứ nó với tới được, rồi báo đạt**.
 *
 * BỐN CÂY, NAY BA: Task 16 gỡ ứng dụng kho khoá (AI chuyển lên máy chủ, không
 * còn form nhập key nào để bóc), nên cây ấy rời danh sách vì THỨ ĐƯỢC QUÉT
 * không còn — không phải vì phạm vi bị thu hẹp. Lời cảnh báo HC-1 ở trên được
 * giữ chứ không xoá: nó là LÝ DO cổng này có hình dạng "một danh sách cây" thay
 * vì một đường dẫn cứng, và lý do ấy vẫn đúng cho ba cây còn lại.
 *
 * Cây thứ BA — `packages/course-kit/*.js` — không nằm trong kế hoạch, và được
 * thêm vào sau một phép đo, không phải vì cẩn thận chung chung:
 *
 *     $ grep -nE "['\"][^'\"]*[À-ỹ]" packages/course-kit/runtime.js
 *     377:  '[mô phỏng "'+name+'" chưa sẵn sàng]'
 *     382:  'Không dựng được mô phỏng này trong trình duyệt hiện tại.'
 *
 * Hai câu ấy hiện ra TRONG TRANG ĐỌC, cho người học, từ mã của chính ta — chỉ
 * là được nạp bằng `<script src>` thay vì `import` (xem `reader/useCourseKit.ts`).
 * Đó đúng là loại tệp mà `db/local.test.ts` đã phải mở rộng phạm vi một lần để
 * với tới, và chú thích của nó ghi lại lý do bằng một câu đáng chép lại: *"A rule
 * that names one file instead of the class it belongs to holds only until the
 * second member of the class appears."* Lớp ở đây là **mã của chúng ta chạy
 * trong trình duyệt người dùng**, chứ không phải "thư mục `src` của một app
 * React".
 *
 * CÓ CHỦ Ý NẰM NGOÀI thẩm quyền, và đây là phân biệt thật chứ không phải tai
 * nạn đường dẫn:
 *
 *   - `courses/<id>/viz.js` — đó là **tải trọng**, không phải mã ta ship. Một
 *     course có ngôn ngữ của chính nó theo đúng thiết kế (spec §4.2: course
 *     ngôn ngữ nào cũng được, nhưng CÓ NHÃN). Báo lỗi ở đó là loại lỗi mà
 *     ruling S1-F8 đã từ chối: phát hiện không có cách sửa đúng nào.
 *   - `*.test.ts(x)` — khẳng định của một bài kiểm viết bằng tiếng Việt là việc
 *     của bài kiểm ấy. Cùng lằn ranh mà `db/local.test.ts` vạch.
 *
 * KHOẢNG MÙ ĐÃ BIẾT, ghi ra chứ không giấu đi:
 *
 *   1. **Chuỗi tiếng Việt KHÔNG DẤU** (`"Danh muc"`) không bị bắt. Bộ dò dựa
 *      trên các ký tự chỉ có trong tiếng Việt; không có cách nào phân biệt
 *      `"Danh muc"` với một mã định danh mà không đoán.
 *   2. **Bóc bằng cách thay tiếng Việt bằng tiếng Anh viết cứng** cũng làm tệp
 *      rời khỏi allowlist. Không có phép đo nào phân biệt được `"Library"` viết
 *      cứng với một khoá kỹ thuật. Cái chặn nó là chiều thứ hai của cổng: một
 *      mục rời allowlist là một dòng trong diff, và người thẩm định nhìn thấy.
 *   3. `<title>` của hai vỏ HTML — được ghim riêng ở bài cuối cùng dưới đây, vì
 *      HTML tĩnh không đọc được catalog và việc bóc nó là một cơ chế khác.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Ký tự chỉ xuất hiện trong CHỮ Việt (và các ngôn ngữ Latin có dấu khác) —
 * không bao giờ trong mã định danh của repo này.
 *
 * HAI KHOẢNG TRỐNG TRONG DÃY, và chúng là phép SỬA ĐỒNG HỒ chứ không phải phép
 * nới lỏng. Latin-1 Supplement xếp hai ký tự TOÁN HỌC vào giữa các chữ cái:
 * `×` (U+00D7) và `÷` (U+00F7). Bộ dò cũ (`[À-ɏ…]`) gộp cả hai, nên nó báo
 * `<button>×</button>` — nút đóng của ba panel — là "chuỗi tiếng Việt".
 *
 * `×` không phải chữ, không thuộc ngôn ngữ nào, và không có bản dịch: nó là
 * cùng hạng với `←`, `→`, `☰`, `✓`, `○` mà bộ dò này chưa bao giờ gắn cờ (chúng
 * nằm ngoài dãy). Đưa nó vào catalog sẽ tạo một khoá `'×'` giống hệt ở hai bản
 * dịch — tức là thêm một ngoại lệ vào bài "en không còn tiếng Việt" cho một ký
 * tự không phải chữ.
 *
 * Bài "đọc đúng đồng hồ của chính nó" bên dưới ghim cả hai chiều của phép sửa
 * này, nên nó không thể lặng lẽ rộng thêm.
 */
const VIETNAMESE = /[À-ÖØ-öø-ɏḀ-ỿ]/;

function repoRelative(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join('/');
}

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    if (!existsSync(at)) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'vendor') continue;
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.some((ext) => entry.name.endsWith(ext)) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/** Mọi cây mã CỦA CHÚNG TA chạy trong trình duyệt của người dùng. Tên đọc được, vì thông báo hỏng phải nói ra cây nào rỗng. */
const SCAN_ROOTS: readonly { readonly name: string; readonly files: () => string[]; readonly why: string }[] = [
  {
    name: 'apps/web/src',
    files: () => filesUnder(join(REPO_ROOT, 'apps', 'web', 'src'), ['.ts', '.tsx'])
      .filter((file) => !isStoryContentDataModule(file)),
    why: 'ứng dụng React — phần lớn giao diện; module dữ liệu story .ts có contract song ngữ riêng, component .tsx vẫn được quét',
  },
  {
    name: 'packages/course-kit (*.js, trừ vendor/)',
    files: () => filesUnder(join(REPO_ROOT, 'packages', 'course-kit'), ['.js']),
    why: 'runtime của trang đọc, nạp bằng <script src> — cùng trang, cùng origin, và có chữ hiện ra cho người học',
  },
  {
    // Cây thứ TƯ, thêm ở Task 5 cùng lúc với `packages/i18n` (QĐ-1). Không quét
    // nó thì việc dời hai catalog ra khỏi `apps/web/src` sẽ mở một chỗ trú:
    // `packages/i18n/src/index.ts` có thể nhận chuỗi cứng mà cổng im lặng, và
    // đó đúng là hình dạng "cổng đo đúng thứ nó với tới được".
    name: 'packages/i18n/src',
    files: () => filesUnder(join(REPO_ROOT, 'packages', 'i18n', 'src'), ['.ts']),
    why: 'catalog dùng chung (ra đời cho hai origin; Task 16 gỡ origin thứ hai, gói vẫn đứng riêng — xem doc của packages/i18n/src/index.ts) — hai tệp `messages/` được miễn, phần còn lại thì không',
  },
];

function scannedFiles(): string[] {
  return SCAN_ROOTS.flatMap((root) => root.files()).sort();
}

const STORY_CONTENT_ROOT = join(REPO_ROOT, 'apps', 'web', 'src', 'stories', 'content') + sep;

function isStoryContentDataModule(file: string): boolean {
  return file.startsWith(STORY_CONTENT_ROOT) && file.endsWith('.ts') && !file.endsWith('.tsx');
}

function i18nSourceFiles(): string[] {
  return filesUnder(join(REPO_ROOT, 'apps', 'web', 'src', 'i18n'), ['.ts', '.tsx']);
}

/**
 * Mọi chuỗi tiếng Việt do MÃ viết ra trong `source`: chuỗi thường, chuỗi mẫu,
 * và chữ nằm thẳng trong JSX. Chú thích KHÔNG tính, và đó là toàn bộ lý do hàm
 * này đọc cây cú pháp thay vì `grep` — văn xuôi của repo này viết bằng tiếng
 * Việt ở gần như mọi tệp, nên một `grep` sẽ báo *mọi* tệp là vi phạm và cổng
 * lập tức thành tiếng ồn.
 */
function vietnameseLiterals(fileName: string, source: string): string[] {
  const found: string[] = [];
  const kind = fileName.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : fileName.endsWith('.js')
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, kind);
  const walk = (node: ts.Node): void => {
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
    else if (ts.isJsxText(node)) text = node.text;
    if (text !== null && VIETNAMESE.test(text)) found.push(text.trim());
    ts.forEachChild(node, walk);
  };
  walk(parsed);
  return found;
}

/** Mọi module mà `source` nhập vào (kể cả `export … from`), đọc từ cây cú pháp chứ không từ văn xuôi. */
function importSpecifiers(fileName: string, source: string): string[] {
  const out: string[] = [];
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  for (const statement of parsed.statements) {
    const specifier =
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier;
    if (specifier && ts.isStringLiteral(specifier)) out.push(specifier.text);
  }
  return out;
}

function filesWithVietnameseLiterals(): string[] {
  return scannedFiles()
    .filter((file) => vietnameseLiterals(file, readFileSync(file, 'utf-8')).length > 0)
    .map(repoRelative);
}

/**
 * Nơi chữ tiếng Việt ĐƯỢC PHÉP sống mãi mãi: hai quyển từ điển nền tảng và
 * hằng số song ngữ mà contract của đặc san giao tiếp cố ý đặt cạnh lab dùng nó.
 */
const MESSAGE_HOMES: readonly string[] = [
  'packages/i18n/src/messages/en.ts',
  'packages/i18n/src/messages/vi.ts',
  'apps/web/src/stories/labs/communication/copy.ts',
  'apps/web/src/stories/labs/message-budget/copy.ts',
  'apps/web/src/stories/labs/ambiguous-code/copy.ts',
  'apps/web/src/stories/labs/morse-spacing/copy.ts',
];

/**
 * Chữ tiếng Việt KHÔNG BAO GIỜ tới mắt người học — nó nói với lập trình viên
 * đang chạy test. Liệt kê từng tệp một, KHÔNG miễn cả thư mục: một tệp giao
 * diện thật đặt nhầm vào `src/test/` vẫn phải bị quét.
 */
const DEVELOPER_FACING: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'apps/web/src/test/sampleCourse.ts',
    why: 'ngữ liệu của một course mẫu + hướng dẫn `make courses` cho người chạy test; nội dung course, không phải giao diện',
  },
  {
    file: 'apps/web/src/stories/testing/storyFixture.ts',
    why: 'fixture song ngữ chỉ cho bài kiểm story contract; dữ liệu này dựng nội dung mẫu để kiểm kiểu và không bao giờ là chữ giao diện người học thấy',
  },
];

/**
 * ALLOWLIST THU HẸP DẦN — **RỖNG từ Task 5**, và nó phải ở lại rỗng.
 *
 * Task 4 mở sổ này với 37 mục; Task 5 xoá mục cuối cùng. Danh sách rỗng KHÔNG
 * có nghĩa là bỏ được: từ lúc này nó là ràng buộc *"không tệp nào dưới các cây
 * quét được phép có một chuỗi cứng"*, và mỗi lần ai đó muốn thêm một dòng vào
 * đây là một lần người thẩm định phải đọc lý do.
 *
 * Đây là một DANH SÁCH TỆP, không phải một ngưỡng đếm, và lý do là lập luận mà
 * `db/local.test.ts` dùng để liệt kê năm bảng Dexie **theo tên** thay vì đếm
 * chúng: *"`toHaveLength(5)` would also pass if somebody added a sixth table and
 * deleted a different one."* Một ngưỡng "còn ≤ 36 tệp" vẫn xanh khi ai đó bóc
 * `Login.tsx` và rắc chuỗi cứng vào một tệp mới trong cùng commit.
 *
 * Danh sách được kiểm HAI CHIỀU (xem bài "sổ khớp đúng thực tế"):
 *
 *   - một tệp có chuỗi cứng mà KHÔNG có trong sổ ⇒ đỏ (chuỗi cứng mới);
 *   - một mục trong sổ mà tệp ấy KHÔNG còn chuỗi cứng ⇒ **cũng đỏ** (đã bóc
 *     xong thì phải xoá khỏi sổ).
 *
 * Chiều thứ hai là thứ biến sổ này thành một bánh cóc thay vì một tờ giấy dán
 * tường: nó không thể mục ruỗng trong im lặng, và mỗi lần bóc xong một tệp là
 * một dòng trong diff mà người thẩm định nhìn thấy. Ở trạng thái rỗng, chiều
 * thứ nhất là thứ còn làm việc, mỗi ngày, cho mọi task sau.
 */
const NOT_YET_EXTRACTED: readonly string[] = [
  // Nạp bằng `<script src>`, không phải `import` — nên nó KHÔNG import được
  // catalog. Bóc nó cần một cơ chế khác (ví dụ trang chính đặt sẵn một object
  // lên `window` trước khi nạp runtime). Ghi ra ở đây để Task 5 gặp nó như một
  // quyết định, không phải như một bất ngờ.
];

describe('cổng chặn chuỗi cứng', () => {
  it('chỉ tách module dữ liệu .ts của story, không miễn component .tsx hay mã ngoài content', () => {
    expect(isStoryContentDataModule(join(STORY_CONTENT_ROOT, 'a-history-of-ai', 'cover.ts'))).toBe(true);
    expect(isStoryContentDataModule(join(STORY_CONTENT_ROOT, 'a-history-of-ai', 'StoryChrome.tsx'))).toBe(false);
    expect(isStoryContentDataModule(join(REPO_ROOT, 'apps', 'web', 'src', 'pages', 'Landing.ts'))).toBe(false);
  });

  /**
   * Bài đọc-đồng-hồ. Không có nó, mọi con số dưới đây có thể đang đo sai thứ:
   * một bộ dò tính cả chú thích sẽ báo gần như MỌI tệp trong repo là vi phạm
   * (văn xuôi của repo viết bằng tiếng Việt), còn một bộ dò hỏng sẽ báo KHÔNG
   * tệp nào — và cả hai đều "chạy".
   */
  it('đọc đúng đồng hồ của chính nó: mã tính, chú thích và định danh không tính', () => {
    const decoy = [
      '// Mở kho khoá — một chú thích, không phải một chuỗi',
      '/** Đoạn văn xuôi tiếng Việt trong JSDoc, cũng không tính. */',
      'export const soDoHinh = 1;',
      "export const ascii = 'Danh muc';",
      // KÝ HIỆU TOÁN HỌC, không phải chữ. `×` (U+00D7) và `÷` (U+00F7) nằm
      // GIỮA các chữ cái Latin-1 có dấu, nên một dãy `[À-ɏ]` viết ngây thơ gộp
      // cả hai — và bộ dò khi ấy báo nút đóng `<button>×</button>` của ba panel
      // là "chuỗi tiếng Việt". Chúng cùng hạng với `←`, `☰`, `✓`, `○` (vốn nằm
      // ngoài dãy và chưa bao giờ bị gắn cờ): không thuộc ngôn ngữ nào, không
      // có bản dịch.
      "export const glyphs = '×÷←→☰✓○';",
    ].join('\n');
    expect(vietnameseLiterals('decoy.ts', decoy)).toEqual([]);

    // ĐỐI CHỨNG cho khoảng trống vừa mở: hai chữ cái ĐỨNG SÁT `×` và `÷` trong
    // bảng mã vẫn phải bị bắt. Không có nó, một dãy quá rộng ở đúng chỗ ấy sẽ
    // im lặng bỏ lọt `Ö`, `Ø`, `ö`, `ø`.
    expect(vietnameseLiterals('edge.ts', "export const e = 'Ö Ø ö ø';")).toEqual(['Ö Ø ö ø']);

    const real = [
      "export const a = 'Thư viện';",
      'export const b = `Đã đọc ${n} chương`;',
      "export const c = 'plain ascii';",
    ].join('\n');
    // Ba mảnh, không hai: một chuỗi mẫu có `${…}` ở giữa được cây cú pháp cắt
    // thành TemplateHead + TemplateTail, và cả hai đều phải bị soi. Kỳ vọng đầu
    // tiên của tệp này chỉ ghi hai mảnh và đã ĐỎ — bộ dò đúng, kỳ vọng sai.
    expect(vietnameseLiterals('real.ts', real)).toEqual(['Thư viện', 'Đã đọc', 'chương']);

    expect(vietnameseLiterals('jsx.tsx', 'export const V = () => <p>Ngôn ngữ giao diện</p>;')).toEqual([
      'Ngôn ngữ giao diện',
    ]);
  });

  /**
   * CHỐT CHỐNG CỔNG MÙ. Một đường dẫn sai làm cổng xanh vĩnh viễn, và đó là
   * hình dạng của cả năm cổng mù mà `docs/carried-forward.md` ghi lại. Mỗi cây
   * phải tự nói ra rằng nó thấy tệp, và MỖI CÂY có một mỏ neo gọi ĐÍCH DANH —
   * `empty` một mình không đủ: nó chỉ hỏi "cây này có ra tệp nào không", nên
   * một đường dẫn trỏ nhầm sang một thư mục KHÁC vẫn qua được nó.
   *
   * Mỏ neo của `apps/web/src` là `pages/Settings.tsx` — màn hình có nhiều chữ
   * giao diện nhất và là tệp mà Pha 2 vừa viết lại; nó thế chỗ mỏ neo cũ
   * (màn hình nhập key của kho khoá) mà Task 16 đã gỡ cùng ứng dụng ấy. Một
   * cây quét mà KHÔNG có mỏ neo là nửa cổng: đó chính là chỗ hở ở đây trước
   * Task 16 — `apps/web/src` được quét nhưng chưa từng được gọi tên.
   */
  it('quét CẢ BA cây, và ĐỎ nếu cây nào quét ra 0 tệp', () => {
    const empty = SCAN_ROOTS.filter((root) => root.files().length === 0).map((root) => root.name);
    expect(empty).toEqual([]);
    // Danh sách cây KHÔNG được rỗng: `empty` trên là `[].filter(...)` khi
    // `SCAN_ROOTS` rỗng, tức `[]`, tức XANH — một cổng không quét gì.
    expect(SCAN_ROOTS.map((root) => root.name)).toEqual([
      'apps/web/src',
      'packages/course-kit (*.js, trừ vendor/)',
      'packages/i18n/src',
    ]);

    const seen = scannedFiles().map(repoRelative);
    expect(seen.length).toBeGreaterThan(60);
    expect(seen).toContain('apps/web/src/pages/Settings.tsx');
    expect(seen).toContain('packages/i18n/src/messages/vi.ts');
    expect(seen).toContain('packages/course-kit/runtime.js');
    expect(seen).not.toContain('apps/web/src/db/localStorage.test.ts');
    expect(seen).not.toContain('packages/course-kit/vendor/katex.min.js');
  });

  it('ba danh sách rời nhau, không mục nào trùng, mọi mục đều là tệp có thật', () => {
    const declared = [...MESSAGE_HOMES, ...DEVELOPER_FACING.map((e) => e.file), ...NOT_YET_EXTRACTED];
    expect(new Set(declared).size).toBe(declared.length);
    expect(declared.filter((file) => !existsSync(join(REPO_ROOT, file)))).toEqual([]);
  });

  /**
   * BÀI CHỊU LỰC. Hai chiều trong một khẳng định:
   *
   *   `undeclared` — tệp có chuỗi cứng mà sổ chưa biết ⇒ chuỗi cứng MỚI.
   *   `stale`      — mục trong sổ mà tệp đã sạch ⇒ bóc xong nhưng chưa xoá sổ.
   *
   * Chiều `stale` là thứ một ngưỡng đếm không bao giờ có, và là thứ buộc sổ
   * phải thu hẹp thật.
   */
  it('sổ khớp ĐÚNG thực tế, cả hai chiều', () => {
    const measured = filesWithVietnameseLiterals();
    const declared = [...MESSAGE_HOMES, ...DEVELOPER_FACING.map((e) => e.file), ...NOT_YET_EXTRACTED].sort();

    const undeclared = measured.filter((file) => !declared.includes(file));
    const stale = declared.filter((file) => !measured.includes(file));

    expect({ undeclared, stale }).toEqual({ undeclared: [], stale: [] });
  });

  /**
   * Mã của Task 4 phải TỰ tuân thủ cổng của Task 4 — nếu không thì cổng vừa
   * dựng đã có một ngoại lệ ngay ở tệp đầu tiên.
   */
  it('mã hạ tầng i18n không có một chuỗi cứng nào ngoài hai catalog', () => {
    const offenders = [...i18nSourceFiles(), ...filesUnder(join(REPO_ROOT, 'packages', 'i18n', 'src'), ['.ts'])]
      .map(repoRelative)
      .filter((file) => !MESSAGE_HOMES.includes(file))
      .filter((file) => vietnameseLiterals(file, readFileSync(join(REPO_ROOT, file), 'utf-8')).length > 0);
    expect(offenders).toEqual([]);
  });

  /**
   * `<title>` của vỏ HTML là chữ người dùng THẤY (trên tab trình duyệt), và nằm
   * ngoài tầm của một bộ quét cây cú pháp TypeScript. Ghim nguyên văn thay vì
   * bỏ qua: đổi tiêu đề hay bóc nó đều làm bài này đỏ, nên nó không thể trôi đi
   * trong im lặng.
   *
   * MỘT vỏ, không hai: vỏ HTML của kho khoá (`<title>Kho khoá tuhoc</title>`)
   * đi cùng ứng dụng ấy ở Task 16.
   */
  it('<title> tiếng Việt còn lại được ghim đích danh, không rơi ra ngoài sổ', () => {
    const shells = ['apps/web/index.html'];
    const titles = shells.map((file) => {
      const html = readFileSync(join(REPO_ROOT, file), 'utf-8');
      return { file, title: /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null };
    });
    expect(titles.filter((entry) => entry.title !== null && VIETNAMESE.test(entry.title))).toEqual([
      { file: 'apps/web/index.html', title: 'Tự học' },
    ]);
  });
});

/* ====================================================================== *
 * 4. `packages/i18n` — GÓI KHÔNG PHỤ THUỘC GÌ (QĐ-1)
 * ====================================================================== */

/**
 * VÌ SAO CỔNG NÀY TỒN TẠI, và vì sao nó nằm ở đây chứ không ở gói kia.
 *
 * Catalog dịch RA ĐỜI cho HAI origin: trang bài học, và kho khoá — nơi người
 * học dán key, và là origin mà mọi thứ nạp vào đều đọc được key, nên danh sách
 * phụ thuộc ở đó là bề mặt tấn công chứ không phải tiện nghi. QĐ-1 chọn một gói
 * dùng chung thay vì hai catalog trôi dạt, và ràng buộc làm cho lựa chọn ấy an
 * toàn là *"chỉ hằng chuỗi và một hàm tra cứu thuần"*.
 *
 * Task 16 gỡ origin thứ hai, và CỔNG NÀY Ở LẠI. Ràng buộc đổi người thụ hưởng
 * chứ không biến mất: `packages/course-format` và `tools/registry` cũng đọc
 * được một gói không phụ thuộc gì, còn một catalog kéo theo React thì không.
 * **Một ràng buộc không có cổng là một câu văn** — đây là cổng.
 *
 * Cổng sống ở `apps/web` chứ không ở `packages/i18n` vì một lý do trực tiếp:
 * một bộ test trong gói ấy cần `vitest` trong `devDependencies`, tức là gói
 * "không phụ thuộc gì" sẽ có một `node_modules` và một danh sách phụ thuộc để
 * canh. Đặt cổng ở đây giữ được thư mục kia RỖNG THẬT, và nó vẫn có người
 * chạy: `make test-web`.
 */
describe('packages/i18n — gói KHÔNG phụ thuộc gì', () => {
  const PACKAGE_DIR = join(REPO_ROOT, 'packages', 'i18n');

  /**
   * Ba trường, không một. Chỉ khẳng định `dependencies` rỗng thì một
   * `devDependencies: { react: '*' }` vẫn kéo được `node_modules` vào thư mục
   * này, và `peerDependencies` là đường thứ ba cho đúng việc ấy.
   *
   * `toHaveProperty` đi kèm có chủ ý: một `dependencies` BỊ XOÁ khiến
   * `pkg.dependencies ?? {}` rỗng và bài kiểm xanh — đó đúng là hình dạng cổng
   * mù mà cả task này tồn tại để không dựng thêm.
   */
  it('package.json khai BA danh sách phụ thuộc và cả ba đều RỖNG', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8')) as Record<string, unknown>;
    expect(pkg).toHaveProperty('dependencies');
    expect(pkg.dependencies).toEqual({});
    expect(pkg.devDependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });

  /**
   * Danh sách ĐÓNG, đọc từ cây cú pháp — cùng cơ chế và cùng lý do như danh
   * sách của `apps/web/src/i18n` bên trên. Một `import 'react'`, `import
   * 'node:fs'`, hay `import '../../apps/web/src/db/local'` đều làm bài này đỏ;
   * một chú thích nhắc tới React thì không.
   *
   * Ba mục là toàn bộ: `index.ts` nhập hai catalog, và `en.ts` nhập KIỂU của
   * chính nó từ `vi.ts`. Không có mục thứ tư nào là đúng nghĩa của "không phụ
   * thuộc runtime nào".
   */
  it('không tệp nguồn nào nhập thứ gì ngoài kiểu của chính gói', () => {
    const specifiers = new Set<string>();
    for (const file of filesUnder(join(PACKAGE_DIR, 'src'), ['.ts', '.tsx'])) {
      for (const spec of importSpecifiers(file, readFileSync(file, 'utf-8'))) specifiers.add(spec);
    }
    expect([...specifiers].sort()).toEqual(['./messages/en', './messages/vi', './vi']);
  });

  /**
   * Hệ quả VẬT LÝ của hai bài trên, và nó bắt được thứ chúng không bắt: một
   * `bun add` chạy trong thư mục này để lại `node_modules` NGAY CẢ KHI ai đó
   * hoàn tác `package.json` sau đó. Ở một origin giữ key, "có mã lạ nằm trên
   * đĩa cạnh mã thật" là câu đáng hỏi riêng.
   */
  it('thư mục gói KHÔNG có node_modules', () => {
    expect(existsSync(join(PACKAGE_DIR, 'node_modules'))).toBe(false);
  });

  /**
   * Alias `@tuhoc/i18n` có HAI NỬA — `vite.config.ts` (lúc gói) và
   * `tsconfig.app.json` (lúc kiểm kiểu) — và không nửa nào ngụ ý nửa kia, đúng
   * lằn ranh mà `tsconfig.app.json` đã ghi cho `@tuhoc/course-format`. Thiếu
   * nửa `paths` thì `tsc -b` đỏ; thiếu nửa `alias` thì bundle hỏng lúc dựng.
   * Cả hai được ghim ở đây để không nửa nào biến mất trong im lặng khi ai đó
   * dọn cấu hình.
   *
   * BỐN mục, nay HAI: kho khoá có hai nửa của riêng nó, và chúng đi cùng ứng
   * dụng ấy ở Task 16.
   */
  it('apps/web khai đủ HAI nửa của alias @tuhoc/i18n', () => {
    const halves = ['apps/web/vite.config.ts', 'apps/web/tsconfig.app.json'];
    const missing = halves.filter((file) => !readFileSync(join(REPO_ROOT, file), 'utf-8').includes('@tuhoc/i18n'));
    expect(missing).toEqual([]);
  });
});
