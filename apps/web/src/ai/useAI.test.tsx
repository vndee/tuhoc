import { act, renderHook } from '@testing-library/react';
import { t as translate, type MessageKey } from '@tuhoc/i18n';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { chapterSystemPrompt } from './prompts';
import { MAX_WIRE_QUESTION_CHARS, buildWireQuestion, useAI } from './useAI';

/**
 * CỔNG CẤU TRÚC, không phải hành vi — Task 13 Step 1, MỞ RỘNG ở Task 16 Step 7.
 *
 * Một import còn sót giữ cả ứng dụng kho khoá sống trong bundle của trang
 * chính, và đó là điều một cổng HÀNH VI không bắt được: `useAI`/`AskPanel`/
 * `DeepDive` có thể hoạt động đúng ở mọi bài kiểm khác trong khi vẫn kéo theo
 * lớp client `postMessage` và khung ẩn vào cây phụ thuộc.
 *
 * BỐN TỆP CỨNG → CẢ THƯ MỤC, và mốc chuyển là một sự kiện chứ không phải một
 * lần dọn dẹp. Tại Task 13, MƯỜI tệp dưới `src/ai/` còn nhắc chữ ấy, và Task
 * 13 chỉ SỞ HỮU bốn (`useAI.ts`, `serverClient.ts`, `AskPanel.tsx`,
 * `DeepDive.tsx`); một cổng quét cả thư mục khi ấy sẽ đỏ vì mã Task 13 không
 * được phép sửa. Task 16 gỡ sáu tệp kia cùng `apps/vault`, nên danh sách cứng
 * nay đổi được thành phép quét thư mục mà không mốc nào phải khẳng định điều
 * chưa đúng.
 *
 * ─── VÌ SAO CỔNG NÀY MIỄN TRỪ ĐÚNG MỘT TỆP, VÀ VÌ SAO ĐÓ KHÔNG PHẢI LỖ ───
 *
 * Tệp bị miễn là CHÍNH TỆP NÀY, và nó buộc phải được miễn: một cổng cấm một
 * chữ thì phải VIẾT chữ ấy ra để cấm (`FORBIDDEN` ngay dưới). Quét cả thư mục
 * mà không miễn nó thì cổng đỏ vì chính nó, vĩnh viễn — đó là lý do đoạn mã
 * gợi ý trong brief (`for (const f of await readdir(dir))`, không lọc gì)
 * KHÔNG chạy được.
 *
 * Miễn trừ ấy có ba chốt, và cả ba đều ở bài "cổng có răng" dưới đây:
 *
 *   1. tên tệp được miễn LẤY TỪ `import.meta.url`, không gõ tay — nó không
 *      trôi được sang một tệp khác;
 *   2. tệp được miễn PHẢI khớp `FORBIDDEN` (`expect(...).toBe(true)`). Nếu
 *      một ngày nó không còn chứa chữ ấy thì miễn trừ đã thành thừa, và bài
 *      kiểm ĐỎ để buộc gỡ miễn trừ thay vì để nó thành cái ô cửa mở sẵn;
 *   3. đúng MỘT tệp bị loại khỏi danh sách quét, đo bằng hiệu số.
 *
 * HỆ QUẢ CHO PHÉP ĐẾM, ghi ra để không ai tưởng còn sót việc. Phép đếm của
 * Task 16 là:
 *
 *     $ git grep -lie vault -- apps/web/src | wc -l
 *
 * Nó trả **1**, không phải 0, và tệp duy nhất ấy là CHÍNH TỆP NÀY. Loại nó ra
 * thì bằng 0:
 *
 *     $ git grep -lie vault -- apps/web/src ':(exclude)apps/web/src/ai/useAI.test.tsx'
 *
 * Ba đường đã cân để phép đếm ra 0 tuyệt đối, và cả ba đều làm cổng YẾU hơn:
 *
 *   a. dựng `FORBIDDEN` từ mảnh (`new RegExp('v' + 'ault', 'i')`) — phép đếm
 *      ra 0, nhưng chính cái grep mà người thẩm định sau này dùng để tìm tàn
 *      dư cũng không thấy cổng. Một cổng mà công cụ kiểm tra không nhìn thấy
 *      là một cổng không ai kiểm được;
 *   b. dời cổng ra ngoài `src/` (ví dụ `apps/web/gates/`) — hết cần miễn trừ,
 *      nhưng `tsconfig.app.json` chỉ `include: ["src"]`, `tsconfig.node.json`
 *      chỉ `vite.config.ts`+`vite-plugins`, `tsconfig.e2e.json` chỉ `e2e` —
 *      nên tệp ấy KHÔNG có cổng kiểu nào cả, đúng hình dạng cổng mù §2 của
 *      `docs/carried-forward.md`. Thêm một project tsconfig thứ tư cho một tệp
 *      là cái giá lớn hơn thứ mua được;
 *   c. bỏ cổng đi — không.
 *
 * ⇒ Con số đúng của Task 16 là **1, và nó là cổng**. Ai đọc phép đếm sau này
 * nên chạy bản có `:(exclude)` ở trên.
 */
const FORBIDDEN = /vault/i;

/**
 * `dirname(fileURLToPath(import.meta.url))` rồi ghép ĐƯỜNG DẪN CHUỖI, không
 * `new URL('./x', import.meta.url)` truyền thẳng cho `readFile` như brief gợi
 * ý — đo được: dưới cấu hình vitest/jsdom của repo này, việc import
 * `node:fs/promises` LÀM `import.meta.url` của CHÍNH tệp này đổi từ
 * `file:///...` thành `http://localhost:3000/...` (một hiệu ứng phụ của
 * pipeline transform, tái lập được ở mọi lần chạy), và `readFile` từ chối một
 * URL không mang scheme `file:` với `ERR_INVALID_URL_SCHEME`. `readFileSync`
 * + `fileURLToPath` mà `DeepDive.test.tsx` đã dùng để nạp KaTeX vendor không
 * dính lỗi này, nên cổng ở đây theo đúng khuôn đã đo là chạy được.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Tệp duy nhất được miễn — xem khối chú thích trên. Lấy từ `import.meta.url`. */
const SELF = basename(fileURLToPath(import.meta.url));

/**
 * MỌI mô-đun SẢN PHẨM dưới `src/ai/`, gọi đích danh.
 *
 * Sàn đếm (`MIN_SCANNED`) một mình KHÔNG đủ, cùng lập luận `db/local.test.ts`
 * đã viết cho năm bảng Dexie: *"`toHaveLength(5)` would also pass if somebody
 * added a sixth table and deleted a different one."* Một mô-đun sản phẩm rơi
 * khỏi phép quét là chuyện đáng đỏ; một tệp test bị xoá thì không — nên danh
 * sách này chỉ ghim mã sản phẩm.
 */
const PRODUCT_MODULES = [
  'AgentConfigPanel.tsx',
  'AskPanel.tsx',
  'CreditPanel.tsx',
  'DeepDive.tsx',
  'markdown.tsx',
  'prompts.ts',
  'serverClient.ts',
  'useAI.ts',
];

/**
 * Sàn, không phải con số đo được: 16 tệp lúc Task 16 gỡ xong, sàn 12 để một
 * lần dọn dẹp hợp lệ không làm đỏ cổng. Chốt THẬT là `PRODUCT_MODULES`.
 */
const MIN_SCANNED = 12;

/** Hình dạng tối thiểu của một `Dirent` mà `selectFiles` cần — để bài kiểm
 *  bơm được danh sách tổng hợp vào và đo chiều FAIL-CLOSED. */
interface EntryLike {
  readonly name: string;
  isFile: () => boolean;
}

/**
 * Danh sách tệp sẽ bị quét — VÀ NÓ NÉM thay vì trả về danh sách rỗng.
 *
 * Đây là khác biệt giữa cổng này và khuôn `for (const f of await readdir(…))`:
 * một `readdir` trỏ nhầm chỗ, một `filter` viết hỏng, hay một lần đổi phần mở
 * rộng tệp đều cho ra MỘT MẢNG RỖNG, và một vòng lặp trên mảng rỗng chạy đúng
 * không lần nào rồi báo XANH. Đó là hình dạng của cả năm cổng mù trong
 * `docs/carried-forward.md`. Ở đây nó ném, nên cổng ĐỎ chứ không xanh câm.
 *
 * Thư mục con cũng ném: `src/ai/` phẳng hôm nay, và một `src/ai/providers/`
 * thêm vào ngày mai sẽ đi qua phép quét này mà không ai biết — ném là cách bắt
 * người thêm nó phải quyết định, thay vì để nó lọt.
 */
function selectFiles(entries: readonly EntryLike[]): string[] {
  const notFiles = entries.filter((e) => !e.isFile()).map((e) => e.name);
  if (notFiles.length > 0) {
    throw new Error(`cổng src/ai/ chỉ quét tệp phẳng, gặp: ${notFiles.sort().join(', ')}`);
  }
  const files = entries
    .map((e) => e.name)
    .filter((n) => /\.tsx?$/.test(n))
    .filter((n) => n !== SELF)
    .sort();
  if (files.length < MIN_SCANNED) {
    throw new Error(`cổng src/ai/ chỉ chọn được ${String(files.length)} tệp (sàn ${String(MIN_SCANNED)})`);
  }
  return files;
}

const asEntries = (names: readonly string[], dirs: readonly string[] = []): EntryLike[] => [
  ...names.map((name) => ({ name, isFile: () => true })),
  ...dirs.map((name) => ({ name, isFile: () => false })),
];

describe('cổng cấu trúc — CẢ `src/ai/` không còn nhắc vault', () => {
  /**
   * BÀI ĐỌC-ĐỒNG-HỒ. Bài dưới nó khẳng định "không tìm thấy gì", và một phép
   * quét đọc 0 tệp cho ra ĐÚNG cùng một màu xanh. Bài này hỏi bốn câu mà một
   * cổng chết không trả lời được.
   */
  it('cổng có răng: quét thật, fail-closed, và miễn trừ đúng một tệp cần miễn', async () => {
    const entries = await readdir(HERE, { withFileTypes: true });
    const scanned = selectFiles(entries);

    // 1. Phép quét ĐỌC ĐƯỢC tệp, và đọc đúng những tệp phải đọc.
    expect(scanned.length).toBeGreaterThanOrEqual(MIN_SCANNED);
    expect(PRODUCT_MODULES.filter((m) => !scanned.includes(m))).toEqual([]);

    // 2. Miễn trừ đúng MỘT tệp, và đó là chính tệp này — đo bằng hiệu số, nên
    //    một `filter` nới rộng ra hai tệp sẽ đỏ.
    const allTs = entries.map((e) => e.name).filter((n) => /\.tsx?$/.test(n));
    expect(allTs.length - scanned.length).toBe(1);
    expect(allTs).toContain(SELF);
    expect(scanned).not.toContain(SELF);

    // 3. Miễn trừ CÒN CẦN THIẾT: tệp được miễn thật sự chứa chữ bị cấm. Ngày
    //    nó không còn chứa, bài này đỏ và người sửa phải gỡ miễn trừ thay vì
    //    để lại một ô cửa mở sẵn.
    expect(FORBIDDEN.test(await readFile(join(HERE, SELF), 'utf8'))).toBe(true);

    // 4. FAIL-CLOSED, cả hai hướng — đo trên nguồn tổng hợp, qua đúng hàm mà
    //    bài thật dùng.
    expect(() => selectFiles([])).toThrow(/sàn/);
    expect(() => selectFiles(asEntries(['a.ts', 'b.ts']))).toThrow(/sàn/);
    expect(() => selectFiles(asEntries([], ['providers']))).toThrow(/tệp phẳng/);
    // …và bộ dò còn sống: nó khớp một dòng import thật, và KHÔNG khớp mã sạch.
    expect(FORBIDDEN.test("import { VaultClient } from './vaultClient';")).toBe(true);
    expect(FORBIDDEN.test("import { postChat } from './serverClient';")).toBe(false);
  });

  it('không mô-đun nào dưới `src/ai/` còn nhắc vault', async () => {
    const scanned = selectFiles(await readdir(HERE, { withFileTypes: true }));
    const offenders: string[] = [];
    for (const f of scanned) {
      if (FORBIDDEN.test(await readFile(join(HERE, f), 'utf8'))) offenders.push(f);
    }
    // Một danh sách, không một `expect` mỗi vòng lặp: khi đỏ, người đọc thấy
    // MỌI tệp vi phạm cùng lúc thay vì tệp đầu tiên theo thứ tự bảng chữ cái.
    expect(offenders).toEqual([]);
  });
});

/**
 * PHA 2: `useAI` nói với MÁY CHỦ THẬT (`POST /ai/chat`) qua `fetch`, không
 * còn `postMessage` tới một `<iframe>` kho khoá. Bài kiểm này theo đúng quy
 * ước đã có của `apps/web/src` — msw chặn `fetch` thật, xem `api/client.
 * test.ts`, `api/useMe.test.tsx`, `sync/engine.test.ts` — thay vì mock riêng
 * `./serverClient`: không tệp nào khác trong repo mock sát-mô-đun kiểu đó
 * cho tầng lấy dữ liệu, và giữ nguyên quy ước nghĩa là stream ở đây đi qua
 * ĐÚNG mã phân tích SSE thật của `serverClient.ts`, không phải một giả định
 * về nó.
 *
 * VÌ SAO VẪN KHÔNG DÙNG `waitFor`. Lý do gốc (`useAI.test.tsx` Pha 1) không
 * đổi: `setState` từ một callback ngoài hệ thống sự kiện React rơi vào một
 * commit sau thao tác mệnh lệnh, và Scheduler chỉ nhả khi hết ngân sách.
 * Mỗi bước bơm dữ liệu vào stream nằm trong `act(async () => {…})`, cộng một
 * `await` nhường vòng lặp sự kiện thật (không phải timer giả) — cần thiết ở
 * đây vì `ReadableStreamDefaultController.enqueue()` chỉ giải quyết một
 * `reader.read()` đang treo qua một VI TÁC VỤ của CHÍNH pipeline `fetch`, và
 * `act()` một mình không hứa nhường đủ số vòng cho một chuỗi microtask
 * không phải do chính callback của nó tạo ra — `serverClient.test.ts` đo
 * được y hệt bẫy này ở tầng dây (bài "kết nối MẠNG LỖI").
 */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function controllableSSE() {
  const encoder = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  return {
    stream,
    event: (kind: string, payload: { text?: string; code?: string }) => {
      ctrl.enqueue(encoder.encode(`event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`));
    },
    close: () => {
      ctrl.close();
    },
  };
}

interface Captured {
  readonly question: string;
  readonly course_slug: string;
  readonly signal: AbortSignal;
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Đăng ký MỘT lần trả lời cho `/ai/chat`, và giao lại cả thân request LẪN
 *  stream điều khiển được để bài kiểm tự tay bơm chunk. */
function nextChat(): { requests: Captured[]; sse: ReturnType<typeof controllableSSE> } {
  const requests: Captured[] = [];
  const sse = controllableSSE();
  server.use(
    http.post(
      '/ai/chat',
      async ({ request }) => {
        const body = (await request.json()) as { question: string; course_slug: string };
        requests.push({ ...body, signal: request.signal });
        return new HttpResponse(sse.stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
      { once: true },
    ),
  );
  return { requests, sse };
}

function wrapper({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

function lastAnswer(r: { turns: readonly { answer: string }[] }): string {
  return r.turns.length === 0 ? '' : r.turns[r.turns.length - 1].answer;
}

/**
 * MỘT lượt hỏng TRƯỚC khi stream bắt đầu — hình dạng thật của `NoCredit`/
 * `RateLimited`/`Unauthenticated`/`FieldTooLong`/… ở đời thật
 * (`serverClient.ts`'s doc comment): một response JSON thường, không phải
 * một sự kiện SSE.
 */
async function askAndFailPreStream(
  code: string,
  status: number,
): Promise<{ code: string; message: string } | null> {
  server.use(http.post('/ai/chat', () => HttpResponse.json({ code, error: 'x' }, { status })));
  const { result } = renderHook(() => useAI(), { wrapper });
  await act(async () => {
    await result.current.ask('hỏi');
  });
  return result.current.error;
}

/** MỘT lượt hỏng GIỮA stream — hình dạng thật của `ProviderFailed`/
 *  `ToolBudgetExhausted` (hai mã DUY NHẤT Go từng phát ở đây). */
async function askAndFailMidStream(code: string): Promise<{ code: string; message: string } | null> {
  const { sse } = nextChat();
  const { result } = renderHook(() => useAI(), { wrapper });
  act(() => {
    void result.current.ask('hỏi');
  });
  await act(async () => {
    sse.event('error', { code, text: 'x' });
    sse.close();
    await flush();
  });
  return result.current.error;
}

/** `fixtures/courses/` — dữ liệu course CHECKED-IN (không cần `make courses`,
 *  khác `courses/` ở gốc repo — xem `.gitignore`). */
const FIXTURES = resolve(HERE, '../../../..', 'fixtures/courses');

/**
 * `system` THẬT một "Hỏi về chương" sẽ gửi — dựng bằng ĐÚNG hàm sản phẩm
 * dùng (`chapterSystemPrompt`, `./prompts.ts`) trên ĐÚNG HTML của một chương
 * đang tồn tại, không phải một chuỗi bịa cỡ tương đương. Review vòng 1 đo
 * được: một fixture bịa "cỡ giống thật" là lý do lỗ hổng Critical (kẹp trần
 * dây) lọt qua — nó không tự động khớp con số THẬT khi `courseTitle`/
 * `chapterTitle`/dàn ý chương đổi.
 */
function realChapterSystem(relPath: string): string {
  const html = readFileSync(resolve(FIXTURES, relPath), 'utf8');
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  const built = chapterSystemPrompt(el, {
    lang: 'vi',
    courseTitle: 'Số dấu phẩy động',
    chapterTitle: 'Phụ lục',
  });
  document.body.removeChild(el);
  return built.system;
}

describe('useAI — một đường, thẳng tới máy chủ', () => {
  it('gửi ĐÚNG thân {question, course_slug}; question HIỂN THỊ vẫn ngắn dù system dài', async () => {
    const { requests, sse } = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });

    act(() => {
      void result.current.ask('Số mũ lệch là gì?', { system: 'TRÍCH CHƯƠNG:\nSố mũ lệch 127.', courseSlug: 'so-dau-phay-dong' });
    });
    expect(result.current.state).toBe('streaming');
    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].question).toBe('TRÍCH CHƯƠNG:\nSố mũ lệch 127.\n\nSố mũ lệch là gì?');
    expect(requests[0].course_slug).toBe('so-dau-phay-dong');
    // Hiển thị cho người đọc vẫn là câu NGẮN họ gõ — không phải khối ngữ cảnh
    // đã ghép vào để gửi đi.
    expect(result.current.turns[0].question).toBe('Số mũ lệch là gì?');
  });

  it('courseSlug vắng ⇒ course_slug rỗng trên dây, không phải "undefined"', async () => {
    const { requests, sse } = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('hỏi');
    });
    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });
    expect(requests[0].course_slug).toBe('');
    expect(requests[0].question).toBe('hỏi');
  });

  it('cộng dồn chunk vào một chuỗi và kết ở state "done"', async () => {
    const { sse } = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('Giải thích entropy');
    });

    await act(async () => {
      sse.event('delta', { text: 'Entropy ' });
      await flush();
    });
    expect(lastAnswer(result.current)).toBe('Entropy ');
    expect(result.current.state).toBe('streaming');

    await act(async () => {
      sse.event('delta', { text: 'là số bit.' });
      await flush();
    });
    expect(lastAnswer(result.current)).toBe('Entropy là số bit.');

    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });
    expect(result.current.state).toBe('done');
    expect(result.current.error).toBeNull();
  });

  /**
   * Bài này TỪNG khẳng định điều ngược lại ở Pha 1 — "một câu hỏi mới xoá câu
   * trả lời cũ" — và nó xanh khi hook chỉ giữ một chuỗi. Nay hai lượt là hai
   * mục riêng trong `turns`, và cả hai đo được cùng lúc.
   */
  it('câu hỏi mới mở một LƯỢT mới; lượt cũ ở nguyên đó', async () => {
    const first = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('Giải thích entropy');
    });
    await act(async () => {
      first.sse.event('delta', { text: 'cũ' });
      first.sse.event('done', {});
      first.sse.close();
      await flush();
    });

    const second = nextChat();
    act(() => {
      void result.current.ask('câu khác');
    });
    await act(async () => {
      second.sse.event('delta', { text: 'mới' });
      await flush();
    });

    expect(result.current.turns.map((turn) => [turn.question, turn.answer])).toEqual([
      ['Giải thích entropy', 'cũ'],
      ['câu khác', 'mới'],
    ]);
  });

  /**
   * BÀI CHỊU LỰC của quyết định sản phẩm "không lịch sử hội thoại trên dây".
   * Pha 1 có một bài đối xứng khẳng định ĐIỀU NGƯỢC LẠI ("lượt sau mang theo
   * cả hội thoại trước") — dấu vết rõ nhất trong bộ kiểm này rằng Pha 2 đã
   * đổi hợp đồng, không chỉ đổi đường vận chuyển.
   *
   * Đột biến (task-13-report.md): nối `history` giả vào `wireQuestion` trong
   * `useAI.ts` ⇒ bài này phải ĐỎ.
   *
   * Câu hỏi thứ hai CỐ Ý là một câu ĐỨNG ĐỘC LẬP ("Sai số làm tròn tính thế
   * nào?"), không phải "Rõ hơn được không?" (bản trước của bài này) — một
   * câu như vậy CHỈ có nghĩa nếu mô hình nhớ câu trước, tức chính bộ kiểm
   * đang gõ ra đúng thứ `useAI.ts`'s doc comment cấm giao diện gợi ý. Review
   * vòng 1 bắt đúng chỗ này.
   */
  it('lượt sau KHÔNG mang theo lượt trước — mỗi lượt là một request độc lập', async () => {
    const first = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('Giải thích entropy');
    });
    await act(async () => {
      first.sse.event('delta', { text: 'Là số bit.' });
      first.sse.event('done', {});
      first.sse.close();
      await flush();
    });

    const second = nextChat();
    act(() => {
      void result.current.ask('Sai số làm tròn tính thế nào?');
    });
    await act(async () => {
      await flush();
    });

    expect(second.requests[0].question).toBe('Sai số làm tròn tính thế nào?');
    expect(second.requests[0].question).not.toContain('entropy');
    expect(second.requests[0].question).not.toContain('Là số bit.');
  });

  it('lượt hỏng cũng không mang sang lượt sau', async () => {
    const first = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('Giải thích entropy');
    });
    await act(async () => {
      first.sse.event('error', { code: 'ProviderFailed', text: 'the AI provider could not complete this turn' });
      first.sse.close();
      await flush();
    });
    expect(result.current.state).toBe('error');

    const second = nextChat();
    act(() => {
      void result.current.ask('Thử lại');
    });
    await act(async () => {
      await flush();
    });
    expect(second.requests[0].question).toBe('Thử lại');
  });
});

describe('useAI — SSE đứt giữa chừng giữ lại phần đã nhận', () => {
  /**
   * BÀI CHỊU LỰC của Step 3, ở TẦNG HOOK (bổ sung cho tầng dây đã đo ở
   * `serverClient.test.ts`). Đo bằng đột biến (task-13-report.md): trong
   * nhánh `catch` của `ask()`, đổi `({ ...t0, failure: … })` thành
   * `{ ...t0, answer: '', failure: … }` ⇒ bài này phải ĐỎ.
   */
  it('kết nối đứt giữa chừng: answer đã nhận CÒN NGUYÊN, failure được gắn thêm', async () => {
    const { sse } = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('hỏi');
    });
    await act(async () => {
      sse.event('delta', { text: 'người học đã đọc được nửa câu' });
      await flush();
    });
    expect(lastAnswer(result.current)).toBe('người học đã đọc được nửa câu');

    await act(async () => {
      sse.close(); // đóng mà KHÔNG có done/error — mất kết nối giữa chừng.
      await flush();
    });

    expect(lastAnswer(result.current)).toBe('người học đã đọc được nửa câu');
    expect(result.current.state).toBe('error');
    expect(result.current.error?.code).toBe('Network');
  });
});

/**
 * SÁU mã có một hành động RIÊNG người học có thể làm, mỗi mã một câu dịch
 * RIÊNG — bảng này là DANH SÁCH ĐẦY ĐỦ, không phải một cặp mẫu.
 *
 * Review vòng 1 đo được: bộ kiểm ban đầu chỉ ghim CẶP `NoCredit`/
 * `ProviderFailed`, và một đột biến gộp NĂM mã còn lại vào một câu (ví dụ
 * `ToolBudgetExhausted` mượn câu của `ProviderFailed`) vẫn 48/48 xanh — bài
 * `'ToolBudgetExhausted có câu RIÊNG'` cũ chỉ khẳng định `code`, không bao
 * giờ khẳng định `message`, nên tên bài nói một điều còn bài đo điều khác.
 *
 * Khoá dịch lấy từ CHÍNH `@tuhoc/i18n` (`translate('vi', key)`), không phải
 * chuỗi tiếng Việt chép tay hai lần — chép tay là một bản sao THỨ HAI có thể
 * trôi khỏi catalog thật mà không ai để ý.
 */
const DISTINCT_PRE_STREAM: readonly { code: string; status: number; key: MessageKey }[] = [
  { code: 'NoCredit', status: 402, key: 'ai.error.noCredit' },
  { code: 'RateLimited', status: 429, key: 'ai.error.rateLimited' },
  { code: 'Unauthenticated', status: 401, key: 'ai.error.unauthenticated' },
  { code: 'FieldTooLong', status: 400, key: 'ai.error.fieldTooLong' },
];
const DISTINCT_MID_STREAM: readonly { code: string; key: MessageKey }[] = [
  { code: 'ProviderFailed', key: 'ai.error.providerFailed' },
  { code: 'ToolBudgetExhausted', key: 'ai.error.toolBudgetExhausted' },
];

describe('useAI — mã lỗi có nghĩa RIÊNG, không hiện "thử lại sau" cho người chỉ cần nạp credit', () => {
  it.each(DISTINCT_PRE_STREAM)(
    'mã trước-stream $code (HTTP $status) hiện ĐÚNG câu của riêng nó ($key)',
    async ({ code, status, key }) => {
      const err = await askAndFailPreStream(code, status);
      expect(err?.code).toBe(code);
      expect(err?.message).toBe(translate('vi', key));
    },
  );

  it.each(DISTINCT_MID_STREAM)('mã giữa-stream $code hiện ĐÚNG câu của riêng nó ($key)', async ({ code, key }) => {
    const err = await askAndFailMidStream(code);
    expect(err?.code).toBe(code);
    expect(err?.message).toBe(translate('vi', key));
  });

  /**
   * BÀI CHỊU LỰC — thay cho cặp `NoCredit`/`ProviderFailed` cũ. Gộp BẤT KỲ
   * hai trong sáu mã này lại (đột biến `describeFailure`) phải làm đúng một
   * trong hai cặp trùng nhau xuất hiện, và `Set` bắt được bất kể là cặp nào —
   * không cần đoán trước đột biến sẽ gộp cặp nào.
   */
  it('sáu mã trên tạo SÁU câu khác nhau đôi một — không cặp nào trùng, dù đột biến gộp cặp nào', async () => {
    const messages: string[] = [];
    for (const { code, status } of DISTINCT_PRE_STREAM) {
      messages.push((await askAndFailPreStream(code, status))!.message);
    }
    for (const { code } of DISTINCT_MID_STREAM) {
      messages.push((await askAndFailMidStream(code))!.message);
    }
    expect(messages).toHaveLength(6);
    expect(new Set(messages).size).toBe(6);
  });

  /**
   * Bốn mã CÒN LẠI gộp chung một câu CÓ CHỦ Ý (xem `useAI.ts`'s
   * `describeFailure` doc comment) — ghim ít nhất một ca, đúng lời khuyên
   * review: "ghim message cho mọi mã có câu riêng, VÀ cho xô gộp ít nhất một
   * ca".
   */
  it('InvalidBody/FieldRequired/UnknownTool/Internal GỘP chung một câu — có chủ ý, không phải sót', async () => {
    const expected = translate('vi', 'ai.error.requestRejected');
    for (const [code, status] of [
      ['InvalidBody', 400],
      ['FieldRequired', 400],
      ['UnknownTool', 400],
      ['Internal', 500],
    ] as const) {
      const err = await askAndFailPreStream(code, status);
      expect(err?.message, code).toBe(expected);
    }
  });

  it('không có response nào tới (mất mạng) ⇒ mã Network, câu RIÊNG của nó', async () => {
    server.use(http.post('/ai/chat', () => HttpResponse.error()));
    const { result } = renderHook(() => useAI(), { wrapper });
    await act(async () => {
      await result.current.ask('hỏi');
    });
    expect(result.current.state).toBe('error');
    expect(result.current.error?.code).toBe('Network');
    expect(result.current.error?.message).toBe(translate('vi', 'ai.error.network'));
  });
});

describe('useAI — trần độ dài dây (MAX_WIRE_QUESTION_CHARS), Critical review vòng 1', () => {
  it('không có system: prompt ngắn đi qua nguyên vẹn', () => {
    expect(buildWireQuestion(undefined, 'Entropy là gì?')).toBe('Entropy là gì?');
  });

  it('system + prompt vừa vặn: ghép nguyên văn, có dấu phân cách', () => {
    expect(buildWireQuestion('ngữ cảnh', 'câu hỏi')).toBe('ngữ cảnh\n\ncâu hỏi');
  });

  it('system một mình GẦN LẤP ĐẦY trần (đúng hình dạng một chương thật) — ghép được, tổng KHÔNG vượt trần, câu người học giữ nguyên', () => {
    // 7995 rune — đúng cỡ `chapterSystemPrompt` đo được trên chương thật
    // (xem describe dưới). "Tại sao?" là 8 rune: 7995+2+8=8005>8000 nếu
    // KHÔNG kẹp — đúng con số review vòng 1 đo trên `appx.html`.
    const system = 'x'.repeat(7995);
    const prompt = 'Tại sao?';
    const out = buildWireQuestion(system, prompt);
    expect(Array.from(out).length).toBeLessThanOrEqual(MAX_WIRE_QUESTION_CHARS);
    expect(out.endsWith(prompt)).toBe(true);
  });

  it('system dài HƠN CẢ trần: bị cắt về đúng phần còn lại sau khi trừ prompt + dấu phân cách', () => {
    const system = 'a'.repeat(20_000);
    const prompt = 'hỏi';
    const out = buildWireQuestion(system, prompt);
    expect(Array.from(out).length).toBe(MAX_WIRE_QUESTION_CHARS);
    expect(out.endsWith('\n\nhỏi')).toBe(true);
  });

  it('prompt MỘT MÌNH đã vượt trần (câu cực dài, hiếm): bị cắt, không ném lỗi', () => {
    const prompt = 'b'.repeat(9000);
    const out = buildWireQuestion(undefined, prompt);
    expect(Array.from(out).length).toBe(MAX_WIRE_QUESTION_CHARS);
  });

  it('cả system lẫn prompt đều cực dài: system nhường HOÀN TOÀN, prompt vẫn được ưu tiên (cắt nếu cần)', () => {
    const system = 'a'.repeat(20_000);
    const prompt = 'b'.repeat(9000);
    const out = buildWireQuestion(system, prompt);
    expect(Array.from(out).length).toBeLessThanOrEqual(MAX_WIRE_QUESTION_CHARS);
    expect(out).toBe('b'.repeat(MAX_WIRE_QUESTION_CHARS));
  });

  /**
   * BÀI CHỊU LỰC CỦA CRITICAL — dùng MỘT CHƯƠNG THẬT, không phải một chuỗi
   * bịa cỡ tương đương. Review vòng 1: "Test dùng một chương THẬT... Fixture
   * bịa ngắn là lý do lỗi này lọt."
   *
   * Trước phép kẹp: "Hỏi về chương" hỏng (400 `FieldTooLong`) trên CẢ BA
   * chương này với BẤT KỲ câu hỏi nào dài hơn vài ký tự — đo được, xem
   * task-13-report.md.
   */
  it.each([
    'so-dau-phay-dong/chapters/appx.html',
    'so-dau-phay-dong/chapters/p1-3.html',
    'bat-bien-vong-lap/chapters/c1.html',
  ])('chương thật %s: "Hỏi về chương" với một câu hỏi ngắn ĐI ĐƯỢC, không FieldTooLong', async (rel) => {
    const system = realChapterSystem(rel);
    // Khẳng định tường minh rằng fixture THẬT sự gần lấp đầy trần — nếu
    // không, bài này xanh vì lý do sai (chương "vừa vặn" không đo được gì).
    expect(Array.from(system).length).toBeGreaterThan(7900);

    const { requests, sse } = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    await act(async () => {
      void result.current.ask('Tại sao?', { system });
      await flush();
    });

    expect(requests).toHaveLength(1);
    const runeLen = Array.from(requests[0].question).length;
    expect(runeLen).toBeLessThanOrEqual(MAX_WIRE_QUESTION_CHARS);
    expect(requests[0].question.endsWith('Tại sao?')).toBe(true);

    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });
    expect(result.current.state).toBe('done');
    expect(result.current.error).toBeNull();
  });
});

describe('useAI — cancel() huỷ THẬT bằng AbortSignal', () => {
  it('cancel() abort đúng tín hiệu đã gửi cho fetch của lượt đang chạy', async () => {
    const { requests, sse } = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('hỏi');
    });
    await act(async () => {
      sse.event('delta', { text: 'một nửa' });
      await flush();
    });

    await act(async () => {
      result.current.cancel();
      await flush();
    });

    expect(requests[0].signal.aborted).toBe(true);
    expect(result.current.state).toBe('idle');
    expect(lastAnswer(result.current)).toBe('một nửa');
  });

  it('huỷ KHÔNG bị coi là lỗi', async () => {
    const { sse } = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('hỏi');
    });
    await act(async () => {
      sse.event('delta', { text: 'x' });
      await flush();
    });
    await act(async () => {
      result.current.cancel();
      await flush();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.state).not.toBe('error');
  });

  it('tháo component cũng huỷ THẬT — signal của lời gọi đang chạy bị abort', async () => {
    const { requests, sse } = nextChat();
    const { result, unmount } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('hỏi');
    });
    await act(async () => {
      sse.event('delta', { text: 'x' });
      await flush();
    });

    unmount();
    await flush();
    expect(requests[0].signal.aborted).toBe(true);
  });
});
