import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import * as ts from 'typescript';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { clearLocalData, db } from '../db/local';

/* ====================================================================== *
 *
 *  HÀNG RÀO RIÊNG TƯ: KHÔNG Ô CHẤM SAO NÀO CHO COURSE KHÔNG Ở TRÊN REGISTRY
 *
 * Đây là **hàng rào riêng tư**, không phải một chi tiết giao diện, và tệp này
 * tồn tại vì hai nửa của nó không thay thế được cho nhau:
 *
 *   - nửa **HÀNH VI** mở hai màn hình thật có course riêng tư và course
 *     import từ tệp, rồi đòi không ô chấm nào, không request `/ratings` nào;
 *   - nửa **CẤU TRÚC** hỏi câu mà không màn hình nào trả lời được: *"còn màn
 *     hình nào KHÁC vẽ ô chấm sao không?"*
 *
 * Nửa thứ hai là thứ bắt được mutant ở một tệp mà tệp này chưa từng nhắc tên
 * — và đó đúng là hình dạng của cả năm **cổng mù** mà `docs/carried-forward.md`
 * ghi lại: một cổng chỉ canh những chỗ người viết nó nghĩ ra. Cùng lập luận
 * `api/stats.ts` viết ra cho `assertStats` (*"canh từng chỗ gọi thì sửa được
 * đúng những chỗ gọi ta nghĩ ra"*), dựng một tầng cao hơn.
 *
 * Vì sao hàng rào nằm ở PHÍA WEB dù tầng Go đã có ba lớp: tầng Go **không thể**
 * phân biệt id registry với id course riêng tư — nó không bao giờ đọc
 * `index.json` và không được phép đọc (`TestAPIProductCodeMakesNoOutboundCall`).
 * Báo cáo Task 2+3 §2.5 nói thẳng: hàng rào ở đó là **KHÔNG-LIỆT-KÊ-ĐƯỢC**,
 * và tính chất ấy chỉ đúng chừng nào **không client nào gửi id riêng tư đi**.
 * Chỗ duy nhất trong hệ thống biết id nào thuộc registry là `index.json`, và
 * chỗ duy nhất đọc `index.json` là `apps/web`. Nên chốt phải ở đây.
 *
 * ====================================================================== */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');

/* ---------------------------------------------------------------- *
 * Bộ dò
 * ---------------------------------------------------------------- */

/**
 * Ba cách một tệp chạm tới BỀ MẶT CHẤM SAO, đọc từ cây cú pháp chứ không
 * bằng grep — chú thích và chuỗi không tính, đúng khuôn `db/local.test.ts`
 * dùng cho các sink HTML.
 *
 *   1. **JSX `<Rating …/>`** — thứ đặt ô chấm lên màn hình.
 *   2. **import GIÁ TRỊ** từ một module tên `Rating` hoặc `ratings` — cách
 *      duy nhất gọi được `putRating`/`fetchRatings`.
 *   3. **chuỗi bắt đầu bằng `/ratings`** — một chỗ gọi tự dựng đường dẫn,
 *      không qua `api/ratings.ts`.
 *
 * `import type` KHÔNG tính, có chủ ý và kiểm được: nó bị xoá sạch lúc dịch
 * (`erasableSyntaxOnly` của repo này), nên nó không vẽ được gì và không gọi
 * được gì. `registry/order.ts` chỉ nhập KIỂU `RatingSummary`, và nó không
 * phải một màn hình.
 */
function ratingSurfacesIn(fileName: string, source: string): string[] {
  const found: string[] = [];
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const jsxName = (node: ts.Node): string | null => {
    if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText(parsed);
    if (ts.isJsxOpeningElement(node)) return node.tagName.getText(parsed);
    return null;
  };

  const walk = (node: ts.Node): void => {
    const tag = jsxName(node);
    if (tag !== null && /(^|\.)Rating$/.test(tag)) found.push(`<${tag}>`);

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const base = spec.split('/').pop() ?? '';
      const typeOnly = node.importClause?.isTypeOnly === true;
      const namedAreAllTypeOnly =
        node.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(node.importClause.namedBindings) &&
        node.importClause.namedBindings.elements.every((e) => e.isTypeOnly);
      if (/^(Rating|ratings)(\.tsx?)?$/.test(base) && !typeOnly && !namedAreAllTypeOnly) {
        found.push(`import ${spec}`);
      }
    }

    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.startsWith('/ratings')) {
      found.push(`"${node.text}"`);
    }
    if (ts.isTemplateHead(node) && node.text.startsWith('/ratings')) found.push(`\`${node.text}…\``);

    ts.forEachChild(node, walk);
  };
  walk(parsed);
  return found;
}

/** Mọi tệp nguồn KHÔNG-PHẢI-TEST dưới `apps/web/src`. */
function webSourceFiles(dir = WEB_SRC): string[] {
  const out: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) out.push(...webSourceFiles(full));
    else if (/\.tsx?$/.test(item.name) && !/\.test\.tsx?$/.test(item.name)) out.push(full);
  }
  return out.sort();
}

const repoRelative = (file: string) => relative(REPO_ROOT, file).split(sep).join('/');

function filesTouchingTheRatingSurface(): string[] {
  return webSourceFiles()
    .filter((file) => ratingSurfacesIn(file, readFileSync(file, 'utf-8')).length > 0)
    .map(repoRelative);
}

/**
 * SỔ — mọi tệp được phép chạm tới bề mặt chấm sao, kèm lý do.
 *
 * Là một DANH SÁCH TÊN, không phải một con số, cùng lập luận `db/local.test.ts`
 * dùng để liệt kê năm bảng Dexie theo tên: *"`toHaveLength(5)` would also pass
 * if somebody added a sixth table and deleted a different one."*
 */
const RATING_SURFACE_ALLOWED: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'apps/web/src/api/ratings.ts',
    why: 'nửa client của hợp đồng dây — chỗ DUY NHẤT trong ứng dụng biết đường dẫn /ratings',
  },
  {
    file: 'apps/web/src/registry/Rating.tsx',
    why: 'chính ô chấm sao',
  },
  {
    file: 'apps/web/src/registry/Catalog.tsx',
    why: 'màn hình DUY NHẤT gắn nó, và là màn hình duy nhất trong ứng dụng mà mọi hàng đều đến từ index.json của registry',
  },
];

/* ====================================================================== *
 * NỬA CẤU TRÚC
 * ====================================================================== */

describe('hàng rào riêng tư — nửa CẤU TRÚC', () => {
  /**
   * Bài đọc-đồng-hồ. Không có nó, mọi khẳng định dưới đây có thể đang đo sai
   * thứ: một bộ dò hỏng báo KHÔNG tệp nào và cổng xanh vĩnh viễn.
   */
  it('đọc đúng đồng hồ của chính nó', () => {
    // KHÔNG tính — và bốn ca này là bốn cách một cổng grep sẽ báo nhầm.
    expect(ratingSurfacesIn('a.tsx', '// <Rating registryId={x} />')).toEqual([]);
    expect(ratingSurfacesIn('a.tsx', '/** gọi /ratings ở đây */ export const x = 1;')).toEqual([]);
    expect(ratingSurfacesIn('a.ts', "import type { RatingSummary } from '../api/ratings';")).toEqual([]);
    expect(ratingSurfacesIn('a.ts', "import { type RatingSummary } from '../api/ratings';")).toEqual([]);
    expect(ratingSurfacesIn('a.tsx', "export const s = 'không có gì ở đây';")).toEqual([]);
    // Một tên GẦN GIỐNG không được kéo theo cả họ hàng.
    expect(ratingSurfacesIn('a.tsx', '<RatingsTable />')).toEqual([]);

    // CÓ tính — cả ba đường.
    expect(ratingSurfacesIn('a.tsx', '<Rating registryId={x} summary={y} />')).toEqual(['<Rating>']);
    expect(ratingSurfacesIn('a.tsx', '<Rating registryId={x}>con</Rating>')).toEqual(['<Rating>']);
    expect(ratingSurfacesIn('a.ts', "import { putRating } from '../api/ratings';")).toEqual([
      'import ../api/ratings',
    ]);
    expect(ratingSurfacesIn('a.ts', "import { Rating } from './Rating.tsx';")).toEqual(['import ./Rating.tsx']);
    expect(ratingSurfacesIn('a.ts', "const p = '/ratings?ids=' + ids;")).toEqual(['"/ratings?ids="']);
    expect(ratingSurfacesIn('a.ts', 'const p = `/ratings/${id}`;')).toEqual(['`/ratings/…`']);
  });

  /** CHỐT CHỐNG CỔNG MÙ: một đường dẫn sai làm cổng xanh mãi mãi. */
  it('thật sự nhìn thấy toàn bộ apps/web/src, và gọi tên được những màn hình nó phải canh', () => {
    const seen = webSourceFiles().map(repoRelative);
    expect(seen.length).toBeGreaterThan(60);
    // Ba màn hình vẽ course KHÔNG thuộc registry. Nếu phép quét không đọc
    // chúng thì nó không canh gì cả.
    expect(seen).toContain('apps/web/src/pages/Library.tsx');
    expect(seen).toContain('apps/web/src/pages/CourseHome.tsx');
    expect(seen).toContain('apps/web/src/pages/Dashboard.tsx');
    expect(seen).toContain('apps/web/src/registry/Catalog.tsx');
    expect(seen).not.toContain('apps/web/src/registry/ratingFence.test.tsx');
  });

  /**
   * BÀI CHỊU LỰC, hai chiều trong một khẳng định — cùng khuôn "sổ khớp đúng
   * thực tế" của cổng i18n:
   *
   *   `undeclared` — một tệp chạm tới ô chấm sao mà sổ chưa biết. Đây là
   *     mutant "thêm ô chấm vào course riêng tư", ở BẤT KỲ tệp nào.
   *   `stale`      — một mục trong sổ mà tệp ấy không còn chạm tới nữa. Không
   *     có chiều này, sổ mục ruỗng trong im lặng và cổng mất răng.
   */
  it('CHỈ ba tệp được chạm tới bề mặt chấm sao, và cả ba đều còn chạm thật', () => {
    const measured = filesTouchingTheRatingSurface();
    const declared = RATING_SURFACE_ALLOWED.map((e) => e.file).sort();

    expect({
      undeclared: measured.filter((f) => !declared.includes(f)),
      stale: declared.filter((f) => !measured.includes(f)),
    }).toEqual({ undeclared: [], stale: [] });
  });

  /**
   * `Catalog.tsx` là màn hình duy nhất trong sổ, và tính chất làm nó AN TOÀN
   * **không phải tên của nó** mà là: mọi hàng của nó đến từ `index.json`.
   * Bài này ghim đúng tiền đề ấy — nếu một ngày Catalog học cách vẽ thêm
   * hàng từ nguồn khác (thư viện cục bộ, `GET /courses`, `GET /stats`), sổ ở
   * trên vẫn xanh trong khi lý do làm nó đúng đã biến mất.
   *
   * Danh sách cấm là **TÊN ĐƯỢC NHẬP**, không phải tên module, và khác biệt
   * ấy đến từ phép đo: `Catalog.tsx` nhập `coursesQueryKey` từ
   * `../api/courses` để **vô hiệu hoá cache sau khi kéo về** — nó không liệt
   * kê gì cả. Một bài cấm cả module sẽ đỏ vì một lý do sai, và một cổng đỏ
   * vì lý do sai là một cổng bị người ta nới ra.
   */
  it('Catalog dựng hàng CHỈ từ chỉ mục registry — không nguồn course nào khác', () => {
    const file = join(WEB_SRC, 'registry', 'Catalog.tsx');
    const source = readFileSync(file, 'utf-8');
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);

    /** Mọi thứ có thể LIỆT KÊ course của chính người đọc. */
    const ENUMERATORS = ['useCourses', 'fetchCourses', 'useOwnedCourses', 'fetchStats', 'useStats', 'db'];

    const imported: string[] = [];
    parsed.forEachChild((node) => {
      if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly === true) return;
      const bindings = node.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) if (!el.isTypeOnly) imported.push(el.name.text);
      }
      if (node.importClause?.name !== undefined) imported.push(node.importClause.name.text);
    });

    expect(imported.filter((name) => ENUMERATORS.includes(name))).toEqual([]);
    expect(imported).toContain('useRegistryIndex');
  });
});

/* ====================================================================== *
 * NỬA HÀNH VI — hai màn hình THẬT, đi qua `<App/>` thật
 * ====================================================================== */

let ratingsRequests: string[] = [];

const server = setupServer(
  http.get('/me', () => HttpResponse.json({ id: 'u1', email: 'a@vi.vn', name: 'Người học' })),
  http.get('/stats', () => HttpResponse.json({ totalMinutes: 0, streakDays: 0, days: [], courses: [] })),
  http.get('/courses', () =>
    HttpResponse.json([
      // Course RIÊNG TƯ: có trên máy chủ của người học, không có trên registry
      // nào. `pages/Library.tsx` gọi nguồn này là `private`.
      { id: 'ghi-chep-rieng', title: 'Ghi chép riêng', lang: 'vi', tier: 'content', versions: ['1.0.0'], pinned: '1.0.0' },
    ]),
  ),
  // Nếu MỘT màn hình nào đó lỡ hỏi điểm, ta muốn ĐẾM được chứ không muốn MSW
  // ném một lỗi mạng mà màn hình có thể nuốt mất.
  http.get('/ratings', ({ request }) => {
    ratingsRequests.push(new URL(request.url).search);
    return HttpResponse.json([]);
  }),
  http.put('/ratings/:id', ({ params }) => {
    ratingsRequests.push(`PUT ${String(params.id)}`);
    return new HttpResponse(null, { status: 204 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(async () => {
  ratingsRequests = [];
  await clearLocalData();
  // Course IMPORT TỪ TỆP: chỉ nằm trên thiết bị này, không `registryId`.
  const manifest = {
    id: 'keo-tu-tep',
    title: 'Kéo từ tệp',
    description: 'mô tả',
    lang: 'vi',
    version: '1.0.0',
    runtime: '^1',
    tier: 'content',
    license: 'CC-BY-4.0',
    authors: [{ name: 'Người viết' }],
    generatedBy: 'human',
    parts: [{ title: 'Phần 1', chapters: [{ id: 'c1', num: '1', title: 'Chương một', short: 'Một', file: 'chapters/c1.html' }] }],
  };
  await db.packages.put({
    key: 'keo-tu-tep@1.0.0',
    courseId: 'keo-tu-tep',
    version: '1.0.0',
    manifest,
    files: { 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)) },
    pinnedAt: new Date().toISOString(),
  });
});
afterEach(clearLocalData);

function goTo(path: string) {
  window.history.pushState({}, '', path);
}

/** Mọi cách một ô chấm sao có thể xuất hiện trên màn hình. */
function starControls(): HTMLElement[] {
  return [
    ...screen.queryAllByRole('radio'),
    ...screen.queryAllByRole('group', { name: /đánh giá của bạn/i }),
    ...screen.queryAllByRole('button', { name: /\bsao\b/i }),
  ];
}

describe('hàng rào riêng tư — nửa HÀNH VI', () => {
  it('/library có course RIÊNG TƯ và course IMPORT TỪ TỆP → KHÔNG một ô chấm sao nào', async () => {
    goTo('/library');
    render(<App />);

    // Đối chứng NGƯỢC trước: nếu màn hình không dựng lên, "không có ô chấm"
    // là một khẳng định rỗng.
    expect(await screen.findByText('Ghi chép riêng')).toBeInTheDocument();
    expect(await screen.findByText('Kéo từ tệp')).toBeInTheDocument();

    expect(starControls()).toEqual([]);
    expect(ratingsRequests).toEqual([]);
  });

  it('/c/:courseId của course import từ tệp → KHÔNG ô chấm sao, KHÔNG hỏi điểm', async () => {
    goTo('/c/keo-tu-tep');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Kéo từ tệp' })).toBeInTheDocument();

    expect(starControls()).toEqual([]);
    expect(ratingsRequests).toEqual([]);
  });

  it('bảng điều khiển (/) không hỏi điểm cho bất kỳ course nào của người học', async () => {
    goTo('/');
    render(<App />);

    await waitFor(() => expect(screen.queryByText(/đang tải/i)).not.toBeInTheDocument());
    expect(starControls()).toEqual([]);
    expect(ratingsRequests).toEqual([]);
  });
});
