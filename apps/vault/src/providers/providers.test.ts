import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSSE, openAICompatible } from './openaiCompatible';
import { anthropic, parseAnthropicSSE } from './anthropic';
import { getProvider, listProviders } from './index';
import { ProviderError, type ChatMessage, type ChatRequest, type Provider } from './types';
import type { VaultRequest, VaultResponse } from '../protocol';
import { handleMessage } from '../main';

/**
 * Lớp nhà cung cấp là mã DUY NHẤT trong repo cầm key thật và gọi ra ngoài. Hai
 * họ lỗi đáng sợ ở đây, và chúng không cùng chỗ:
 *
 *   1. **Ghép mảnh SSE.** `ReadableStream` cắt theo biên giới GÓI MẠNG, không
 *      theo biên giới dòng — và cũng không theo biên giới KÝ TỰ. Fixture kiểu
 *      "một dòng một sự kiện" xanh với một bộ phân tích hỏng.
 *   2. **Key rò ra ngoài header.** Nhà cung cấp ECHO key vào thân lỗi (OpenAI
 *      trả `Incorrect API key provided: sk-…`). Một `ProviderError` mang theo
 *      thân hồi đáp, hay một `console.error` in cả header, là đúng cùng lớp lỗi
 *      M3 của Task 2 — nơi ràng buộc "key không bao giờ vào log" có tên trong
 *      Global Constraints mà kế hoạch cho 0 bài kiểm.
 *
 * Cả hai đều được kiểm bằng BẪY, không bằng khẳng định: một khẳng định "hồi đáp
 * không chứa key" xanh y hệt khi phép quét đọc số không.
 */

// ───────────────────────── công cụ chung ─────────────────────────

const enc = new TextEncoder();

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return streamOfBytes(chunks.map((s) => enc.encode(s)));
}

/** Gói mạng ở mức BYTE. Cần riêng vì `TextEncoder` mã hoá từng mảnh một cách
 *  độc lập, nên `streamOf(['Xin ch', 'ào'])` KHÔNG hề cắt đôi một ký tự — mọi
 *  mảnh đều là UTF-8 hợp lệ. Muốn đo cờ `{ stream: true }` thì phải cắt ở byte. */
function streamOfBytes(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(p);
      c.close();
    },
  });
}

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const t of it) out += t;
  return out;
}

function sseData(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

// ───────────────────── Phần 1: ghép mảnh SSE ─────────────────────

describe('parseSSE', () => {
  it('ghép đúng khi một sự kiện bị CẮT ĐÔI giữa các gói', async () => {
    const s = streamOf([
      'data: {"choices":[{"delta":{"content":"Xin ch', // đứt giữa chuỗi JSON
      'ào"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" bạn"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    expect(await collect(parseSSE(s))).toBe('Xin chào bạn');
  });

  it('ghép đúng khi DẤU XUỐNG DÒNG KÉP bị cắt đôi', async () => {
    const s = streamOf([
      'data: {"choices":[{"delta":{"content":"a"}}]}\n', // \n đầu ở gói này
      '\ndata: {"choices":[{"delta":{"content":"b"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    expect(await collect(parseSSE(s))).toBe('ab');
  });

  it('bỏ qua dòng comment của SSE (":" mở đầu) mà nhiều nhà cung cấp gửi để giữ kết nối', async () => {
    const s = streamOf([': keep-alive\n\n', sseData('x'), 'data: [DONE]\n\n']);
    expect(await collect(parseSSE(s))).toBe('x');
  });

  it('dừng ở [DONE], không đọc tiếp phần thừa', async () => {
    const s = streamOf([sseData('x'), 'data: [DONE]\n\n', sseData('KHONG-DUOC-CO')]);
    expect(await collect(parseSSE(s))).toBe('x');
  });

  /**
   * BẪY cho cờ `{ stream: true }` của `TextDecoder`.
   *
   * Bốn bài kiểm trên KHÔNG đo được cờ này, kể cả bài có chữ "Xin chào": mỗi
   * mảnh được `TextEncoder` mã hoá riêng nên mảnh nào cũng là UTF-8 hợp lệ. Chỗ
   * duy nhất cờ ấy đổi kết quả là khi gói mạng đứt GIỮA các byte của MỘT ký tự
   * — và tiếng Việt có dấu là ký tự nhiều byte, nên đây là ca thường ngày của
   * ứng dụng này chứ không phải ca hiếm.
   */
  it('BẪY: giữ nguyên tiếng Việt khi gói mạng cắt GIỮA một ký tự nhiều byte', async () => {
    const payload = 'Kiến thức được mã hoá';
    const bytes = enc.encode(sseData(payload) + 'data: [DONE]\n\n');

    // Byte tiếp nối UTF-8 có dạng 0b10xxxxxx. Cắt ngay tại đó là cắt GIỮA một ký
    // tự. Khẳng định nó tồn tại: nếu payload lỡ thành thuần ASCII thì bài kiểm
    // này không đo gì, và nó phải nói ra thay vì xanh trong im lặng.
    const cut = bytes.findIndex((b) => (b & 0xc0) === 0x80);
    expect(cut).toBeGreaterThan(0);

    const s = streamOfBytes([bytes.slice(0, cut), bytes.slice(cut)]);
    const got = await collect(parseSSE(s));
    expect(got).toBe(payload);
    expect(got).not.toContain('�'); // ký tự thay thế = cờ stream bị bỏ
  });

  /**
   * Một byte tiếp nối MỘT MÌNH trong cả một gói — trường hợp cực đoan hơn: bộ
   * giải mã phải giữ trạng thái qua BA lần đọc, không chỉ hai.
   */
  it('BẪY: ký tự nhiều byte bị cắt làm ba gói', async () => {
    const payload = 'ế'; // U+1EBF — ba byte
    const bytes = enc.encode(sseData(payload) + 'data: [DONE]\n\n');
    const cut = bytes.findIndex((b) => (b & 0xc0) === 0x80);
    expect(cut).toBeGreaterThan(0);
    const s = streamOfBytes([bytes.slice(0, cut), bytes.slice(cut, cut + 1), bytes.slice(cut + 1)]);
    expect(await collect(parseSSE(s))).toBe(payload);
  });

  /**
   * CRLF. Chuẩn SSE cho phép `\r\n`, và một proxy đứng giữa có thể đổi dòng.
   * Bộ phân tích chỉ tìm `'\n\n'` sẽ KHÔNG BAO GIỜ thấy biên giới sự kiện trong
   * một luồng `\r\n\r\n` — nó im lặng trả về chuỗi rỗng, tức là "AI không trả
   * lời" mà không một lỗi nào được ném.
   */
  it('hiểu luồng dùng CRLF, kể cả khi \\r và \\n rơi vào hai gói khác nhau', async () => {
    const s = streamOf([
      'data: {"choices":[{"delta":{"content":"a"}}]}\r',
      '\n\r\ndata: {"choices":[{"delta":{"content":"b"}}]}\r\n\r\n',
      'data: [DONE]\r\n\r\n',
    ]);
    expect(await collect(parseSSE(s))).toBe('ab');
  });

  /**
   * Sự kiện cuối KHÔNG có dòng trống đóng. Xảy ra khi kết nối đóng ngay sau
   * mảnh cuối. Một bộ phân tích chỉ xử lý phần trước `'\n\n'` sẽ vứt lặng lẽ
   * mảnh cuối cùng của câu trả lời — lỗi tệ nhất trong họ này vì nó chỉ mất
   * MỘT phần và trông như nhà cung cấp trả lời cụt.
   */
  it('không đánh rơi sự kiện cuối khi luồng đóng mà thiếu dòng trống', async () => {
    const s = streamOf([sseData('a').trimEnd()]);
    expect(await collect(parseSSE(s))).toBe('a');
  });

  /**
   * BẪY cho tính CHẢY của streaming — và bài học đắt nhất của task này.
   *
   * Bài kiểm CRLF ngay trên khẳng định chữ CUỐI CÙNG, và một phép đo mutant cho
   * thấy nó **không giết** được mutant "bỏ chuẩn hoá CRLF": phép xả nốt bộ đệm
   * lúc luồng đóng vô tình cứu nó, vì `.trim()` cắt mất dấu `\r` thừa. Câu trả
   * lời vẫn ĐÚNG — nó chỉ tới **một cục vào lúc kết thúc** thay vì chảy dần.
   *
   * Đó chính là triệu chứng mà nghiệm thu đầu-cuối của Task 10 (kịch bản 2:
   * "chữ chảy về từng mảnh, không phải hiện một lần") sẽ bắt được — nhưng ở
   * tầng e2e, sau khi đã đi qua bốn lớp. Bất biến thật phải được khoá ở đây:
   * mảnh phải ra NGAY khi sự kiện tới, trong khi luồng còn MỞ.
   *
   * Mọi bài kiểm khác trong tệp này dùng luồng đã đóng sẵn, nên chúng đều xanh
   * với một cài đặt "gom hết rồi mới trả". Bài này là bài duy nhất không.
   */
  it('BẪY: phát mảnh NGAY khi sự kiện tới, không đợi luồng đóng', async () => {
    for (const nl of ['\n', '\r\n']) {
      let ctl!: ReadableStreamDefaultController<Uint8Array>;
      const s = new ReadableStream<Uint8Array>({
        start(c) {
          ctl = c;
        },
      });
      const iter = parseSSE(s)[Symbol.asyncIterator]();
      ctl.enqueue(enc.encode(`data: {"choices":[{"delta":{"content":"a"}}]}${nl}${nl}`));

      // Luồng CÒN MỞ. Một cài đặt chỉ xả lúc đóng sẽ treo ở đây mãi mãi, nên
      // phải đua với đồng hồ thay vì `await` thẳng.
      const first = await Promise.race([
        iter.next(),
        new Promise((r) => setTimeout(() => r('TREO'), 200)),
      ]);

      // Gỡ kẹt cho cả hai chiều trước khi khẳng định, để một lần đỏ không bỏ
      // lại một promise treo làm hỏng những bài kiểm sau.
      ctl.enqueue(enc.encode(`data: [DONE]${nl}${nl}`));
      ctl.close();

      expect(first, `luồng dùng ${JSON.stringify(nl)}`).toEqual({ value: 'a', done: false });
    }
  });

  it('một sự kiện JSON hỏng không giết cả câu trả lời đang chảy', async () => {
    const s = streamOf([sseData('a'), 'data: {khong-phai-json\n\n', sseData('b'), 'data: [DONE]\n\n']);
    expect(await collect(parseSSE(s))).toBe('ab');
  });

  it('bỏ qua dòng "event:" và "id:" mà một số nhà cung cấp chèn kèm', async () => {
    const s = streamOf([
      'event: message\nid: 42\n' + sseData('x').replace(/\n\n$/, '') + '\n\n',
      'data: [DONE]\n\n',
    ]);
    expect(await collect(parseSSE(s))).toBe('x');
  });

  it('chịu được "data:" không có dấu cách sau dấu hai chấm', async () => {
    const s = streamOf(['data:{"choices":[{"delta":{"content":"x"}}]}\n\n', 'data: [DONE]\n\n']);
    expect(await collect(parseSSE(s))).toBe('x');
  });

  /**
   * BẪY tài nguyên. `[DONE]` là lối ra SỚM: luồng chưa đóng, và nếu không ai
   * huỷ nó thì kết nối HTTP ở dưới còn treo. Một kho khoá bị trang chính gọi
   * liên tục sẽ tích dần socket chết. `releaseLock()` một mình KHÔNG huỷ luồng.
   */
  it('BẪY: huỷ luồng khi thoát sớm ở [DONE] — không bỏ lại kết nối treo', async () => {
    const cancelled = vi.fn();
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(sseData('x')));
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        // CỐ Ý không `c.close()`: luồng còn mở, nên `cancel` chỉ chạy nếu bộ
        // phân tích thật sự gọi nó.
      },
      cancel: cancelled,
    });
    expect(await collect(parseSSE(s))).toBe('x');
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('BẪY: huỷ luồng khi bên tiêu thụ dừng giữa chừng (huỷ của người dùng)', async () => {
    const cancelled = vi.fn();
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(sseData('a')));
        c.enqueue(enc.encode(sseData('b')));
      },
      cancel: cancelled,
    });
    for await (const t of parseSSE(s)) {
      expect(t).toBe('a');
      break; // đúng thứ `cancel()` của Task 5 sẽ làm
    }
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});

describe('parseAnthropicSSE', () => {
  it('ghép đúng khi một sự kiện bị cắt đôi giữa các gói', async () => {
    const s = streamOf([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Xin ch',
      'ào"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);
    expect(await collect(parseAnthropicSSE(s))).toBe('Xin chào');
  });

  it('BẪY: giữ nguyên tiếng Việt khi gói mạng cắt giữa một ký tự nhiều byte', async () => {
    const payload = 'Định lý mã hoá';
    const bytes = enc.encode(
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: payload } })}\n\n` +
        'data: {"type":"message_stop"}\n\n',
    );
    const cut = bytes.findIndex((b) => (b & 0xc0) === 0x80);
    expect(cut).toBeGreaterThan(0);
    const s = streamOfBytes([bytes.slice(0, cut), bytes.slice(cut)]);
    expect(await collect(parseAnthropicSSE(s))).toBe(payload);
  });

  it('dừng ở message_stop, và bỏ qua các loại sự kiện khác', async () => {
    const s = streamOf([
      'data: {"type":"message_start","message":{"id":"x"}}\n\n',
      'data: {"type":"content_block_start"}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"x"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"KHONG-DUOC-CO"}}\n\n',
    ]);
    expect(await collect(parseAnthropicSSE(s))).toBe('x');
  });

  it('BẪY: huỷ luồng khi thoát sớm ở message_stop', async () => {
    const cancelled = vi.fn();
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {"type":"content_block_delta","delta":{"text":"x"}}\n\n'));
        c.enqueue(enc.encode('data: {"type":"message_stop"}\n\n'));
      },
      cancel: cancelled,
    });
    expect(await collect(parseAnthropicSSE(s))).toBe('x');
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});

// ──────────────── Phần 2: key không rời header ────────────────

/** Key giả, cố tình mang hình dạng của key thật để mọi phép so chuỗi dưới đây
 *  đo đúng thứ nó tưởng đang đo. */
const FAKE_KEY = 'sk-BI-MAT-KHONG-DUOC-RO-9f3a1c7e';

const REQ: ChatRequest = {
  model: 'm-1',
  messages: [{ role: 'user', content: 'chào' }],
};

/**
 * Đi bộ qua ĐỒ THỊ GIÁ TRỊ, không `JSON.stringify`.
 *
 * `JSON.stringify` bỏ sót đúng những chỗ một kẻ rò key nấp được: khoá của
 * object, `Map`, `Set`, và giá trị nằm sau getter. Cùng lập luận Task 2 đã ghi
 * cho `allStrings` ở `keystore.test.ts`, mang sang đây vì đường này còn nhiều
 * bề mặt hơn: `Error.stack`, `cause`, và mọi thuộc tính người ta gắn thêm.
 */
function allStrings(value: unknown, seen = new Set<unknown>(), out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (typeof value !== 'object' || value === null) return out;
  if (seen.has(value)) return out;
  seen.add(value);

  if (value instanceof Map) {
    for (const [k, v] of value) {
      allStrings(k, seen, out);
      allStrings(v, seen, out);
    }
  }
  if (value instanceof Set) for (const v of value) allStrings(v, seen, out);
  if (Array.isArray(value)) for (const v of value) allStrings(v, seen, out);
  if (value instanceof Headers) for (const [k, v] of value) out.push(k, v);

  // Đi cả chuỗi prototype: `message`/`stack`/`name` của `Error` là thuộc tính
  // của thể hiện, nhưng một mutant có thể gắn key vào một getter trên lớp.
  for (let o: object | null = value; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const k of Object.getOwnPropertyNames(o)) {
      out.push(k);
      let v: unknown;
      try {
        v = (value as Record<string, unknown>)[k];
      } catch {
        continue; // getter ném: không có gì đọc được ở đây
      }
      if (typeof v !== 'function') allStrings(v, seen, out);
    }
  }
  return out;
}

function leaks(value: unknown): boolean {
  return allStrings(value).some((s) => s.includes(FAKE_KEY));
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

/**
 * Bẫy console, cắm cho **MỌI** bài kiểm trong tệp này qua `beforeEach`.
 *
 * Ban đầu bẫy này chỉ được cắm trong vài bài kiểm đường lỗi, và một phép đo
 * mutant cho thấy đó là sai: mutant "`console.error` in cả header" đặt ở đường
 * THÀNH CÔNG **sống sót**, vì đúng những bài kiểm chạy qua đó lại không có bẫy.
 * Ràng buộc là "key không bao giờ vào log" — không phải "không vào log khi có
 * lỗi". Một bẫy chỉ cắm ở vài đường là một bẫy đo được vài đường, đúng khuôn
 * năm cổng mù ở `docs/carried-forward.md`.
 */
const consoleSeen: unknown[] = [];
let consoleSpies: Array<{ mockRestore: () => void }> = [];
/** Bài kiểm tự-kiểm-bẫy cố tình rò; nó bật cờ này để `afterEach` không đỏ. */
let allowConsoleLeak = false;

function consoleLeaked(): boolean {
  return consoleSeen.some((a) => leaks(a));
}

beforeEach(() => {
  consoleSeen.length = 0;
  allowConsoleLeak = false;
  consoleSpies = CONSOLE_METHODS.map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      consoleSeen.push(args);
    }),
  );
});

/** Hồi đáp lỗi ECHO KEY LẠI — đúng như OpenAI làm thật
 *  (`Incorrect API key provided: sk-…`). Không có phần echo này thì bài kiểm
 *  "lỗi không chứa key" xanh dù cài đặt có dán cả thân hồi đáp vào lỗi. */
function echoingErrorResponse(status: number): Response {
  return new Response(
    JSON.stringify({ error: { message: `Incorrect API key provided: ${FAKE_KEY}` } }),
    { status, headers: { 'content-type': 'application/json', 'x-echo-auth': `Bearer ${FAKE_KEY}` } },
  );
}

function okStream(body: string): Response {
  return new Response(enc.encode(body), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => {
  // Đọc bẫy TRƯỚC khi gỡ nó. Cổng này chạy cho mọi bài kiểm trong tệp, kể cả
  // những bài không nhắc gì tới key — đó là điểm của nó.
  const leaked = consoleLeaked();
  consoleSpies.forEach((s) => s.mockRestore());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (!allowConsoleLeak) {
    expect(leaked, 'key đã đi vào console — ràng buộc "key không bao giờ vào log"').toBe(false);
  }
});

describe('bộ dò rò key còn sống', () => {
  /**
   * Dây bẫy cho chính dây bẫy — bài học Task 2: một bẫy chưa cắm đo số không và
   * xanh y hệt một bẫy đã cắm. Ba câu hỏi mà một bẫy chết không trả lời được.
   */
  it('BẪY-CỦA-BẪY: `leaks` thấy key ở khoá object, Map, Set, getter và cause', () => {
    expect(leaks({ a: [{ b: FAKE_KEY }] })).toBe(true);
    expect(leaks(new Map([['k', FAKE_KEY]]))).toBe(true);
    expect(leaks(new Set([FAKE_KEY]))).toBe(true);
    expect(leaks({ [FAKE_KEY]: 1 })).toBe(true); // key nằm ở TÊN thuộc tính
    expect(leaks({ get x() { return FAKE_KEY; } })).toBe(true);
    expect(leaks(new Error(`boom ${FAKE_KEY}`))).toBe(true);
    expect(leaks(new Error('boom', { cause: new Error(FAKE_KEY) }))).toBe(true);
    expect(leaks(new Headers({ authorization: `Bearer ${FAKE_KEY}` }))).toBe(true);
    // chiều XANH: một bộ dò bắt tất cả cũng vô dụng như một bộ dò không bắt gì
    expect(leaks({ a: 'sk-mot-key-khac', b: 1, c: null })).toBe(false);
  });

  it('BẪY-CỦA-BẪY: bẫy console thật sự bắt được một lời gọi có key', () => {
    allowConsoleLeak = true; // cố tình rò, để `afterEach` không đỏ vì bài kiểm này
    expect(consoleLeaked()).toBe(false); // chưa ai log gì
    console.warn('gọi nhà cung cấp', { headers: { authorization: `Bearer ${FAKE_KEY}` } });
    expect(consoleLeaked()).toBe(true);
  });
});

describe('key chỉ đi vào header của lời gọi, không đi đâu khác', () => {
  const p = openAICompatible('x', 'X', 'https://api.deepseek.com/v1', 'm-1');

  it('key nằm ở header `authorization`, KHÔNG ở URL và KHÔNG ở thân yêu cầu', async () => {
    const fetchSpy = vi.fn(async () => okStream(sseData('ok') + 'data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchSpy);

    expect(await collect(p.chat(REQ, FAKE_KEY))).toBe('ok');

    // Không vô nghĩa: nếu không có lời gọi nào thì mọi khẳng định dưới đây xanh
    // trên tập rỗng — đúng hình dạng năm cổng mù của docs/carried-forward.md.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(url).not.toContain(FAKE_KEY);
    expect(String(init.body)).not.toContain(FAKE_KEY);

    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    // Đúng MỘT header mang key. Một mutant "chuyển tiếp cho chắc" sẽ nhân đôi.
    const carrying = Object.entries(headers).filter(([, v]) => String(v).includes(FAKE_KEY));
    expect(carrying.map(([k]) => k)).toEqual(['authorization']);
  });

  it('BẪY: lỗi nhà cung cấp KHÔNG mang theo thân hồi đáp có echo key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => echoingErrorResponse(401)));

    let thrown: unknown;
    try {
      await collect(p.chat(REQ, FAKE_KEY));
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ProviderError);
    expect((thrown as ProviderError).code).toBe('bad_key');
    expect(leaks(thrown)).toBe(false); // message, stack, cause, mọi thuộc tính
    expect(consoleLeaked()).toBe(false); // "key không bao giờ vào log"
  });

  it('BẪY: lỗi HTTP 500 cũng không mang theo thân hồi đáp có echo key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => echoingErrorResponse(500)));

    let thrown: unknown;
    try {
      await collect(p.chat(REQ, FAKE_KEY));
    } catch (e) {
      thrown = e;
    }

    expect((thrown as ProviderError).code).toBe('provider_error');
    expect(leaks(thrown)).toBe(false);
    expect(consoleLeaked()).toBe(false);
  });

  it('BẪY: key không bị gắn ngược vào đối tượng yêu cầu mà bên gọi giữ', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okStream(sseData('ok') + 'data: [DONE]\n\n')));
    const req: ChatRequest = { model: 'm-1', messages: [{ role: 'user', content: 'chào' }] };
    await collect(p.chat(req, FAKE_KEY));
    // `req` thuộc về bên gọi (Task 5 gửi nó qua postMessage). Một cài đặt tiện
    // tay nhét key vào đây là đưa key thẳng ra khỏi origin kho khoá.
    expect(leaks(req)).toBe(false);
  });

  it('BẪY: không mảnh nào chảy về trang chính khi hồi đáp là lỗi', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => echoingErrorResponse(429)));
    const got: string[] = [];
    try {
      for await (const t of p.chat(REQ, FAKE_KEY)) got.push(t);
    } catch {
      /* lỗi là đúng; điều đang đo là những gì đã kịp chảy ra trước đó */
    }
    expect(got).toEqual([]);
  });

  it('Anthropic: key ở `x-api-key` và KHÔNG có header `authorization` thứ hai', async () => {
    const fetchSpy = vi.fn(async () =>
      okStream('data: {"type":"content_block_delta","delta":{"text":"ok"}}\n\ndata: {"type":"message_stop"}\n\n'),
    );
    vi.stubGlobal('fetch', fetchSpy);

    expect(await collect(anthropic.chat(REQ, FAKE_KEY))).toBe('ok');
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(url).not.toContain(FAKE_KEY);
    expect(String(init.body)).not.toContain(FAKE_KEY);
    expect(headers['x-api-key']).toBe(FAKE_KEY);
    expect(headers.authorization).toBeUndefined();
    const carrying = Object.entries(headers).filter(([, v]) => String(v).includes(FAKE_KEY));
    expect(carrying.map(([k]) => k)).toEqual(['x-api-key']);
  });

  it('BẪY: lỗi của Anthropic cũng không mang theo thân hồi đáp có echo key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => echoingErrorResponse(401)));
    let thrown: unknown;
    try {
      await collect(anthropic.chat(REQ, FAKE_KEY));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as ProviderError).code).toBe('bad_key');
    expect(leaks(thrown)).toBe(false);
    expect(consoleLeaked()).toBe(false);
  });
});

// ──────────────── Phần 3: hình dạng lời gọi ────────────────

describe('openAICompatible — hình dạng lời gọi', () => {
  const p = openAICompatible('ds', 'DS', 'https://api.deepseek.com/v1', 'm-1');

  it('POST, JSON, stream:true, đúng model và messages', async () => {
    const fetchSpy = vi.fn(async () => okStream('data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchSpy);
    await collect(p.chat({ model: 'm-9', messages: [{ role: 'user', content: 'hỏi' }] }, FAKE_KEY));

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.model).toBe('m-9');
    expect(body.messages).toEqual([{ role: 'user', content: 'hỏi' }]);
  });

  /**
   * Thân yêu cầu do KHO KHOÁ quyết định hình dạng, không phải trang chính.
   * `req` tới qua `postMessage`, và HC-3 nói course độc chạy ngay ở đầu bên kia
   * — chuyển thẳng `req.messages` vào thân là cho nó viết trường tuỳ ý vào lời
   * gọi mà kho khoá ký tên.
   */
  it('BẪY: chỉ `role` và `content` đi vào thân — trường lạ của trang chính bị bỏ', async () => {
    const fetchSpy = vi.fn(async () => okStream('data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchSpy);
    const smuggled = [
      { role: 'user', content: 'hỏi', name: 'lau', tool_calls: [{ id: 'x' }] },
    ] as unknown as ChatMessage[];
    await collect(p.chat({ model: 'm-1', messages: smuggled }, FAKE_KEY));
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { messages: object[] };
    expect(body.messages).toEqual([{ role: 'user', content: 'hỏi' }]);
    expect(String(init.body)).not.toContain('tool_calls');
  });

  /**
   * `signal` phải tới được `fetch`. Không có bài kiểm này thì `cancel()` của
   * Task 5 là một lời hứa suông: giao diện dừng hiện chữ, còn lời gọi vẫn chạy
   * và người dùng vẫn bị tính tiền.
   */
  it('BẪY: chuyển `signal` xuống `fetch`, không đánh rơi', async () => {
    const fetchSpy = vi.fn(async () => okStream('data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchSpy);
    const ac = new AbortController();
    await collect(p.chat(REQ, FAKE_KEY, ac.signal));
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(ac.signal);
  });

  it('401 và 403 → bad_key; 429 → rate_limited; còn lại → provider_error', async () => {
    for (const [status, code] of [
      [401, 'bad_key'],
      [403, 'bad_key'],
      [429, 'rate_limited'],
      [500, 'provider_error'],
      [404, 'provider_error'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
      await expect(collect(p.chat(REQ, FAKE_KEY))).rejects.toMatchObject({
        name: 'ProviderError',
        code,
      });
    }
  });

  /**
   * BẪY cho đường lỗi mà PHÉP ĐO THẬT ngày 2026-08-22 phát hiện.
   *
   * Khi trình duyệt chặn hồi đáp vì CORS, `fetch` **từ chối bằng `TypeError`** —
   * không có `Response`, không có mã trạng thái. Đo được với chính
   * `POST https://api.openai.com/v1/chat/completions` từ một origin trình duyệt
   * (xem task-3-report §6). Nếu cái `TypeError` ấy đi thẳng ra ngoài thì trang
   * chính nhận một lỗi không có `code`, trong khi `VaultErrorCode` là union ĐÓNG
   * mà nó dựa vào để phân nhánh.
   *
   * Lỗi giả dưới đây mang key trong thông điệp: một cài đặt "chuyển tiếp lỗi gốc
   * cho có ngữ cảnh" sẽ rò ngay tại đây.
   */
  it('BẪY: `fetch` từ chối (CORS/mạng) → ProviderError, và lỗi gốc KHÔNG được chuyển tiếp', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError(`Failed to fetch https://api.deepseek.com/v1?key=${FAKE_KEY}`);
      }),
    );
    let thrown: unknown;
    try {
      await collect(p.chat(REQ, FAKE_KEY));
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ProviderError);
    expect((thrown as ProviderError).code).toBe('provider_error');
    expect(leaks(thrown)).toBe(false);
    expect(consoleLeaked()).toBe(false);
  });

  /**
   * Chiều ngược lại, và nó quan trọng không kém: huỷ của NGƯỜI DÙNG phải đi tiếp
   * nguyên trạng. Nuốt `AbortError` vào `provider_error` làm "tôi vừa bấm dừng"
   * và "nhà cung cấp hỏng" trông giống hệt nhau ở phía Task 5.
   */
  it('BẪY: `AbortError` của người dùng KHÔNG bị bọc thành provider_error', async () => {
    const ac = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        ac.abort();
        throw new DOMException('The operation was aborted.', 'AbortError');
      }),
    );
    let thrown: unknown;
    try {
      await collect(p.chat(REQ, FAKE_KEY, ac.signal));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).not.toBeInstanceOf(ProviderError);
    expect((thrown as DOMException).name).toBe('AbortError');
  });

  it('hồi đáp 200 nhưng KHÔNG có thân → provider_error, không ném TypeError khó hiểu', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(collect(p.chat(REQ, FAKE_KEY))).rejects.toMatchObject({ code: 'provider_error' });
  });
});

describe('anthropic — ba chỗ khác hình dạng', () => {
  it('gộp MỌI thông điệp system thành tham số riêng, và bỏ chúng khỏi messages', async () => {
    const fetchSpy = vi.fn(async () => okStream('data: {"type":"message_stop"}\n\n'));
    vi.stubGlobal('fetch', fetchSpy);
    await collect(
      anthropic.chat(
        {
          model: 'm-1',
          messages: [
            { role: 'system', content: 'A' },
            { role: 'user', content: 'hỏi' },
            { role: 'system', content: 'B' }, // mảnh system THỨ HAI, không được rơi
          ],
        },
        FAKE_KEY,
      ),
    );
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.system).toBe('A\n\nB');
    expect(body.messages).toEqual([{ role: 'user', content: 'hỏi' }]);
    expect(body.max_tokens).toBeTypeOf('number');
    expect(body.stream).toBe(true);
  });

  it('không có system thì KHÔNG gửi trường `system` rỗng', async () => {
    const fetchSpy = vi.fn(async () => okStream('data: {"type":"message_stop"}\n\n'));
    vi.stubGlobal('fetch', fetchSpy);
    await collect(anthropic.chat(REQ, FAKE_KEY));
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(Object.keys(JSON.parse(String(init.body)) as object)).not.toContain('system');
  });

  /**
   * Không có header này Anthropic trả 403 cho MỌI lời gọi từ trình duyệt. Mất
   * nó, nhà cung cấp này lặng lẽ rời danh sách hỗ trợ — và triệu chứng duy nhất
   * là "key bị từ chối", tức là người dùng đi tìm lỗi ở đúng chỗ không có lỗi.
   */
  it('BẮT BUỘC gửi `anthropic-dangerous-direct-browser-access`', async () => {
    const fetchSpy = vi.fn(async () => okStream('data: {"type":"message_stop"}\n\n'));
    vi.stubGlobal('fetch', fetchSpy);
    await collect(anthropic.chat(REQ, FAKE_KEY));
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });
});

// ──────────────── Phần 4: registry ────────────────

/** Năm nhà cung cấp đã DÒ THỰC NGHIỆM là cho gọi từ trình duyệt (spec §1.4).
 *  Ghi bằng TÊN chứ không bằng số đếm — cùng lập luận `db/local.test.ts` viết
 *  cho năm bảng Dexie: một con số vẫn xanh khi người ta thêm một cái và bỏ một
 *  cái khác. Thêm một nhà cung cấp thì phải GÕ TÊN nó vào đây, và lúc gõ thì
 *  phải trả lời câu "đã dò CORS chưa". */
const KNOWN = ['deepseek', 'openai', 'openrouter', 'groq', 'anthropic'];

/** Host được phép. Danh sách này là hình dạng cưỡng chế của ràng buộc "không
 *  đường dự phòng qua server": một baseUrl trỏ về máy chủ của ta, hay một
 *  đường dẫn tương đối, KHÔNG khớp và bài kiểm đỏ. */
const ALLOWED_HOSTS = [
  'api.deepseek.com',
  'api.openai.com',
  'openrouter.ai',
  'api.groq.com',
  'api.anthropic.com',
];

describe('registry', () => {
  it('DeepSeek đứng đầu — spec §3.3 gợi ý mặc định vì rẻ', () => {
    expect(listProviders()[0]?.id).toBe('deepseek');
  });

  it('đúng năm nhà cung cấp, ghi bằng tên', () => {
    expect(listProviders().map((p) => p.id)).toEqual(KNOWN);
  });

  it('listProviders chỉ phơi {id,label} — không hàm, không model, không gì khác', () => {
    for (const entry of listProviders()) {
      // Đi qua `postMessage` là đi qua *structured clone*, và clone NÉM khi gặp
      // một hàm. Phơi thừa ở đây không chỉ là rác giao diện, nó làm hỏng kênh.
      expect(Object.keys(entry).sort()).toEqual(['id', 'label']);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(structuredClone(entry)).toEqual(entry);
    }
  });

  it('getProvider trả về đúng nhà cung cấp, và `null` cho id lạ', () => {
    for (const id of KNOWN) expect(getProvider(id)?.id).toBe(id);
    expect(getProvider('khong-ton-tai')).toBeNull();
    expect(getProvider('')).toBeNull();
  });

  it('mọi nhà cung cấp có model mặc định không rỗng', () => {
    for (const id of KNOWN) {
      const p = getProvider(id) as Provider;
      expect(p.defaultModel.length).toBeGreaterThan(0);
    }
  });

  /**
   * Ràng buộc cứng "KHÔNG đường dự phòng qua server", đo ở tầng gọi thật chứ
   * không ở tầng đọc mã: mỗi nhà cung cấp phải gọi THẲNG tới host của chính nó,
   * qua HTTPS. Một `baseUrl` đổi thành `/api/ai` (proxy của ta) hay
   * `https://tuhoc.example/ai` làm bài kiểm này đỏ ngay.
   */
  it('BẪY: mọi nhà cung cấp gọi THẲNG tới host của mình qua https — không qua máy chủ của ta', async () => {
    for (const id of KNOWN) {
      const p = getProvider(id) as Provider;
      const fetchSpy = vi.fn(async () => okStream('data: [DONE]\n\ndata: {"type":"message_stop"}\n\n'));
      vi.stubGlobal('fetch', fetchSpy);
      await collect(p.chat({ model: p.defaultModel, messages: REQ.messages }, FAKE_KEY));

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0] as unknown as [string];
      const u = new URL(url); // ném nếu là đường dẫn tương đối ⇒ proxy cùng origin
      expect(u.protocol).toBe('https:');
      expect(ALLOWED_HOSTS).toContain(u.hostname);
      expect(u.search).toBe(''); // key trong query string là đường rò kinh điển
    }
  });
});

// ──────────────── Phần 5: giao thức không trôi dạt ────────────────

/**
 * Kiểu thông điệp của `protocol.ts` và kiểu `ChatMessage` của lớp nhà cung cấp
 * phải là MỘT. Chúng được viết ở hai tệp vì hai lý do khác nhau (giao thức là
 * hợp đồng giữa hai origin; `types.ts` là hợp đồng giữa kho khoá và nhà cung
 * cấp), nên không có gì tự động giữ chúng khớp — trừ dòng này, mà `tsc -b`
 * trong `make test-vault` kiểm.
 */
type ProtocolChatMessage = Extract<VaultRequest, { kind: 'chat' }>['messages'][number];
type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type _ChatMessageMatchesProtocol = Eq<ChatMessage, ProtocolChatMessage> extends true
  ? true
  : never;

// ──────────────── Phần 6: registry đi qua giao thức ────────────────

const APP_ORIGIN = 'http://localhost:5173';

function ask(req: unknown): { res: VaultResponse; targetOrigin: string } | null {
  const reply = vi.fn();
  handleMessage(
    { origin: APP_ORIGIN, data: req, source: { postMessage: reply } } as unknown as MessageEvent,
    { allowedOrigin: APP_ORIGIN },
  );
  if (reply.mock.calls.length === 0) return null;
  const [res, targetOrigin] = reply.mock.calls[0] as [VaultResponse, string];
  return { res, targetOrigin };
}

describe('kho khoá trả registry ra giao thức', () => {
  it('`listProviders` trả về đúng danh sách của registry, không còn mảng rỗng', () => {
    const out = ask({ v: 1, id: 'x', kind: 'listProviders' });
    expect(out?.res).toEqual({ v: 1, id: 'x', kind: 'providers', providers: listProviders() });
    expect((out?.res as { providers: unknown[] }).providers.length).toBe(5);
    expect(out?.targetOrigin).toBe(APP_ORIGIN); // targetOrigin tường minh, không '*'
  });

  it('hồi đáp `providers` đi qua được *structured clone* — không mang theo hàm nào', () => {
    const out = ask({ v: 1, id: 'x', kind: 'listProviders' });
    // `postMessage` thật dùng structured clone, không `JSON.stringify`. Một
    // `Provider` lọt vào đây sẽ NÉM ở dòng này chứ không im lặng gửi thiếu.
    expect(structuredClone(out?.res)).toEqual(out?.res);
  });

  /**
   * BẪY: đường `chat` chưa được nối, và điều đó phải là ĐO ĐƯỢC.
   *
   * Không phải một bài kiểm "chưa làm xong". Nó canh một tính chất phải đúng cả
   * SAU Task 9: một yêu cầu `chat` từ trang chính KHÔNG được biến thành một lời
   * gọi mạng mà không qua người gác (token bucket + xác nhận phiên của HC-3).
   * Hôm nay nó xanh vì `chat` chưa nối; sau Task 9 nó vẫn xanh vì lời gọi đầu
   * phiên trả `needs_consent` trước khi chạm `fetch`.
   */
  it('BẪY: một yêu cầu `chat` KHÔNG gây ra lời gọi mạng nào (người gác của HC-3 chưa có)', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    ask({
      v: 1,
      id: 'x',
      kind: 'chat',
      providerId: 'deepseek',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hỏi' }],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('BẪY: hồi đáp cho `listProviders` không chứa key dù kho khoá đã cắm key', () => {
    localStorage.setItem('tuhoc.vault.key', FAKE_KEY);
    localStorage.setItem(
      'tuhoc.vault.config',
      JSON.stringify({ providerId: 'deepseek', model: 'deepseek-chat' }),
    );
    const out = ask({ v: 1, id: 'x', kind: 'listProviders' });
    localStorage.clear();
    expect(leaks(out)).toBe(false);
    expect(consoleLeaked()).toBe(false);
  });
});

describe('kiểu thông điệp không trôi dạt khỏi giao thức', () => {
  it('nhận đúng thông điệp dựng theo kiểu của giao thức', async () => {
    const fetchSpy = vi.fn(async () => okStream(sseData('ok') + 'data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchSpy);
    const fromProtocol: ProtocolChatMessage[] = [
      { role: 'system', content: 'bối cảnh' },
      { role: 'user', content: 'hỏi' },
    ];
    const p = getProvider('deepseek') as Provider;
    expect(await collect(p.chat({ model: p.defaultModel, messages: fromProtocol }, FAKE_KEY))).toBe('ok');
  });
});
