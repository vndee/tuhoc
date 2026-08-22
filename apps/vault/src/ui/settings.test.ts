import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettingsDeps, renderSettings } from './Settings';
import type { SettingsDeps } from './Settings';
import { grantConsent, readActivity } from '../guard';
import { readConfig, writeConfig } from '../keystore';
import type { Provider } from '../providers/types';
import { ProviderError } from '../providers/types';

/**
 * Form cấu hình chạy TRONG khung kho khoá.
 *
 * Tệp này canh đúng một ràng buộc quyết định toàn bộ thiết kế: **ô nhập bí mật
 * nằm ở origin kho khoá, và giá trị người dùng gõ vào không bao giờ rời khỏi
 * origin ấy.** Phía đối xứng — "trang cấu hình của TRANG CHÍNH không có một
 * `<input>` nào" — nằm ở `apps/web/src/pages/Settings.test.tsx`. Cả hai phải
 * cùng đúng thì lời hứa mới có nghĩa; một mình bài nào cũng không đủ.
 */

const SECRET = 'sk-BI-MAT-cua-nguoi-dung-9f2c';
const SECRET_SLOT = 'tuhoc.vault.key';
const PUBLIC_SLOT = 'tuhoc.vault.config';

// ───────────────────────── bẫy chung, cắm cho MỌI bài kiểm ─────────────────

/**
 * Bẫy console sáu phương thức, cắm trong `beforeEach` cho TOÀN TỆP — không chỉ
 * cho những bài kiểm nghĩ tới chuyện rò rỉ.
 *
 * Task 3 §3.2 tự đo được rằng bẫy chỉ cắm ở đường LỖI bỏ lọt một
 * `console.error` ở đường THÀNH CÔNG, và đó là mutant M3 của Task 2 mọc lại ở
 * một bề mặt khác. Task này là bề mặt thứ ba (DOM), nên bẫy đi cùng mọi bài.
 */
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
let consoleLeak: string[] = [];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.body.textContent = '';
  consoleLeak = [];
  for (const m of CONSOLE_METHODS) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      if (JSON.stringify(args).includes(SECRET)) consoleLeak.push(m);
    });
  }
});

afterEach(() => {
  // Ô nhớ: bí mật chỉ được phép nằm ở ĐÚNG MỘT chỗ. Bẫy này chạy sau mọi bài
  // kiểm, kể cả những bài không nhắc gì tới chuyện lưu trữ — đó là điểm.
  const holders: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const name = localStorage.key(i);
    if (name !== null && (localStorage.getItem(name) ?? '').includes(SECRET)) holders.push(name);
  }
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const name = sessionStorage.key(i);
    if (name !== null && (sessionStorage.getItem(name) ?? '').includes(SECRET)) {
      holders.push(`session:${name}`);
    }
  }
  expect(holders.filter((h) => h !== SECRET_SLOT), 'bí mật rò sang một ô nhớ khác').toEqual([]);
  expect(consoleLeak, 'bí mật đi vào console').toEqual([]);
  vi.restoreAllMocks();
});

// ───────────────────────── đồ nghề ─────────────────────────

function mount(over: Partial<SettingsDeps> = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const handle = renderSettings(root, { ...defaultSettingsDeps(), ...over });
  return { root, handle };
}

function q<T extends HTMLElement>(root: Element, role: string): T {
  const el = root.querySelector<T>(`[data-role="${role}"]`);
  if (el === null) throw new Error(`không tìm thấy [data-role="${role}"]`);
  return el;
}

function type(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function pick(el: HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Một hồi đáp SSE hình dạng OpenAI, đủ để `parseSSE` nhả ra `text`. */
function sseResponse(text: string, status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  });
  return new Response(body, { status }) as Response;
}

function fakeProvider(record: { key?: string; model?: string; prompt?: string }): Provider {
  return {
    id: 'gia',
    label: 'Giả',
    defaultModel: 'gia-1',
    // eslint-disable-next-line require-yield
    async *chat(req, key) {
      record.key = key;
      record.model = req.model;
      record.prompt = req.messages.map((m) => m.content).join('\n');
      yield 'XONG';
    },
  };
}

// ───────────────────────── hình dạng form ─────────────────────────

describe('form cấu hình nằm TRONG khung kho khoá', () => {
  it('có ô nhập bí mật, và nó là ô của khung này chứ không phải của trang chính', () => {
    const { root } = mount();
    const input = q<HTMLInputElement>(root, 'secret');
    expect(input.tagName).toBe('INPUT');
    // `password` chứ không `text`: người dùng cấu hình ở nơi công cộng vẫn phải
    // an toàn với người đứng sau lưng, và trình duyệt không tự lưu vào lịch sử.
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('off');
  });

  it('liệt kê nhà cung cấp từ REGISTRY, và DeepSeek đứng đầu', () => {
    const { root } = mount();
    const sel = q<HTMLSelectElement>(root, 'provider');
    const ids = Array.from(sel.options).map((o) => o.value);
    expect(ids[0]).toBe('deepseek');
    expect(ids).toEqual(['deepseek', 'openai', 'openrouter', 'groq', 'anthropic']);
  });

  it('ô model điền sẵn model mặc định, và đổi theo khi đổi nhà cung cấp', () => {
    const { root } = mount();
    const model = q<HTMLInputElement>(root, 'model');
    expect(model.value).toBe('deepseek-chat');
    pick(q<HTMLSelectElement>(root, 'provider'), 'anthropic');
    expect(model.value).toBe('claude-sonnet-5');
  });

  it('KHÔNG đè model mà người dùng đã tự gõ', () => {
    const { root } = mount();
    const model = q<HTMLInputElement>(root, 'model');
    type(model, 'model-rieng-cua-toi');
    pick(q<HTMLSelectElement>(root, 'provider'), 'groq');
    expect(model.value).toBe('model-rieng-cua-toi');
  });

  /**
   * Task 3 đo được (2026-08-22, từ một trang thật): `POST` sinh chữ của OpenAI
   * trả 401 KHÔNG kèm `Access-Control-Allow-Origin`, nên trình duyệt chặn hồi
   * đáp và `fetch` từ chối bằng `TypeError`. Đường 200 chưa đo được. Chủ dự án
   * quyết giữ OpenAI kèm cảnh báo.
   *
   * Cảnh báo phải hiện TRƯỚC khi người dùng dán bí mật vào: gặp sau mới hiểu là
   * đúng cái "đi tìm lỗi ở chỗ không có lỗi" mà báo cáo Task 3 đã lo.
   */
  it('chọn OpenAI ⇒ cảnh báo hiện ra NGAY, trước khi dán bí mật', () => {
    const { root } = mount();
    const warn = q(root, 'provider-warning');
    expect(warn.textContent).toBe('');

    pick(q<HTMLSelectElement>(root, 'provider'), 'openai');
    expect(warn.textContent).toMatch(/CORS/);
    expect(warn.textContent).toMatch(/2026-08-22/);
  });

  it('KHÔNG nhà cung cấp nào khác mang cảnh báo ấy', () => {
    const { root } = mount();
    const sel = q<HTMLSelectElement>(root, 'provider');
    const warn = q(root, 'provider-warning');
    for (const id of ['deepseek', 'openrouter', 'groq', 'anthropic']) {
      pick(sel, id);
      expect(warn.textContent, id).toBe('');
    }
  });
});

// ───────────────────────── lưu và xoá ─────────────────────────

describe('lưu bí mật, xoá bí mật', () => {
  it('lưu ⇒ bí mật nằm đúng một ô nhớ, phần công khai nằm ô khác', () => {
    const { root } = mount();
    type(q<HTMLInputElement>(root, 'secret'), SECRET);
    q<HTMLButtonElement>(root, 'save').click();

    expect(localStorage.getItem(SECRET_SLOT)).toBe(SECRET);
    expect(localStorage.getItem(PUBLIC_SLOT)).toBe(
      JSON.stringify({ providerId: 'deepseek', model: 'deepseek-chat' }),
    );
    expect(q(root, 'status').textContent).toMatch(/đã lưu/i);
  });

  it('ô trống ⇒ từ chối lưu, và KHÔNG ghi gì cả', () => {
    const { root } = mount();
    q<HTMLButtonElement>(root, 'save').click();
    expect(localStorage.getItem(SECRET_SLOT)).toBeNull();
    expect(localStorage.getItem(PUBLIC_SLOT)).toBeNull();
    expect(q(root, 'status').textContent).toMatch(/chưa dán/i);
  });

  it('sau khi lưu, ô nhập được XOÁ TRỐNG — bí mật không nằm lại trong DOM', () => {
    const { root } = mount();
    const input = q<HTMLInputElement>(root, 'secret');
    type(input, SECRET);
    q<HTMLButtonElement>(root, 'save').click();
    expect(input.value).toBe('');
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('xoá là HAI BƯỚC: bấm lần đầu chỉ hỏi lại', () => {
    writeConfig({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: SECRET });
    const { root } = mount();
    const btn = q<HTMLButtonElement>(root, 'clear');

    btn.click();
    expect(localStorage.getItem(SECRET_SLOT)).toBe(SECRET);
    expect(q(root, 'status').textContent).toMatch(/bấm lần nữa/i);

    btn.click();
    expect(localStorage.getItem(SECRET_SLOT)).toBeNull();
    expect(localStorage.getItem(PUBLIC_SLOT)).toBeNull();
    expect(readConfig()).toBeNull();
  });

  it('bí mật đã lưu KHÔNG được đổ ngược vào ô nhập khi vẽ lại khung', () => {
    writeConfig({ providerId: 'groq', model: 'llama-3.3-70b-versatile', apiKey: SECRET });
    const { root } = mount();
    expect(q<HTMLInputElement>(root, 'secret').value).toBe('');
    // …nhưng phần công khai thì có, để người dùng biết máy này đang cấu hình gì.
    expect(q<HTMLSelectElement>(root, 'provider').value).toBe('groq');
    expect(q<HTMLInputElement>(root, 'model').value).toBe('llama-3.3-70b-versatile');
    expect(q(root, 'current').textContent).toMatch(/đã có key/i);
  });
});

// ───────────────────────── "Kiểm tra kết nối" ─────────────────────────

describe('"Kiểm tra kết nối" — gọi THẬT, nhưng đi qua NGƯỜI GÁC', () => {
  /**
   * BẪY TRUNG TÂM của task này.
   *
   * Nút "Kiểm tra kết nối" là một đường ra mạng MỚI, ở một tệp mới, mà người
   * gác của Task 9 chưa từng thấy. `guard.ts` tự mô tả mình là "cửa DUY NHẤT
   * dẫn ra mạng"; một nút bỏ qua nó biến câu đó thành sai mà không cổng nào
   * hỏi — và nhật ký hoạt động ngay bên dưới sẽ nói "Chưa có lời gọi nào" ngay
   * sau khi một lời gọi thật vừa rời máy.
   */
  it('BẪY: chưa xác nhận phiên ⇒ `fetch` KHÔNG bị gọi lấy một lần', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse('OK'));
    const { root, handle } = mount();

    type(q<HTMLInputElement>(root, 'secret'), SECRET);
    q<HTMLButtonElement>(root, 'test').click();
    await handle.whenIdle();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(q(root, 'status').textContent).toMatch(/cho phép trong phiên này/i);
  });

  it('đã xác nhận ⇒ gọi ĐÚNG MỘT lần, tới host của nhà cung cấp, bí mật ở ĐÚNG MỘT header', async () => {
    grantConsent();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse('chào'));
    const { root, handle } = mount();

    type(q<HTMLInputElement>(root, 'secret'), SECRET);
    q<HTMLButtonElement>(root, 'test').click();
    await handle.whenIdle();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).host).toBe('api.deepseek.com');
    expect(new URL(url).search).toBe('');

    const headers = init.headers as Record<string, string>;
    const carriers = Object.keys(headers).filter((h) => headers[h].includes(SECRET));
    expect(carriers).toEqual(['authorization']);
    // Và không vào thân yêu cầu.
    expect(String(init.body)).not.toContain(SECRET);
  });

  it('hiện lại CHỮ mà mô hình trả về — bằng chứng đường về cũng chạy', async () => {
    grantConsent();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse('Xin chào'));
    const { root, handle } = mount();
    type(q<HTMLInputElement>(root, 'secret'), SECRET);
    q<HTMLButtonElement>(root, 'test').click();
    await handle.whenIdle();

    const status = q(root, 'status').textContent ?? '';
    expect(status).toMatch(/Xin chào/);
    expect(status).toMatch(/gọi được/i);
  });

  it('dùng bí mật ĐANG GÕ, không bắt phải lưu trước', async () => {
    grantConsent();
    const seen: { key?: string; model?: string; prompt?: string } = {};
    const { root, handle } = mount({ getProvider: () => fakeProvider(seen) });

    type(q<HTMLInputElement>(root, 'secret'), SECRET);
    q<HTMLButtonElement>(root, 'test').click();
    await handle.whenIdle();

    expect(seen.key).toBe(SECRET);
    // Không lưu: kiểm một bí mật sai không được đè lên một bí mật đang chạy tốt.
    expect(localStorage.getItem(SECRET_SLOT)).toBeNull();
  });

  it('ô trống mà máy đã có bí mật ⇒ kiểm bằng bí mật đã lưu', async () => {
    grantConsent();
    writeConfig({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: SECRET });
    const seen: { key?: string } = {};
    const { root, handle } = mount({ getProvider: () => fakeProvider(seen) });

    q<HTMLButtonElement>(root, 'test').click();
    await handle.whenIdle();
    expect(seen.key).toBe(SECRET);
  });

  it('ô trống và máy chưa có bí mật ⇒ nói ra, KHÔNG gọi mạng', async () => {
    grantConsent();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse('OK'));
    const { root, handle } = mount();

    q<HTMLButtonElement>(root, 'test').click();
    await handle.whenIdle();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(q(root, 'status').textContent).toMatch(/chưa dán/i);
  });

  it('lời nhắc kiểm tra là NGẮN — nút này không được tốn tiền đáng kể', async () => {
    grantConsent();
    const seen: { prompt?: string } = {};
    const { root, handle } = mount({ getProvider: () => fakeProvider(seen) });
    type(q<HTMLInputElement>(root, 'secret'), SECRET);
    q<HTMLButtonElement>(root, 'test').click();
    await handle.whenIdle();

    expect(seen.prompt).toBeDefined();
    expect((seen.prompt ?? '').length).toBeLessThan(120);
  });

  it('401 ⇒ nói "key bị từ chối", không phải một lỗi chung chung', async () => {
    grantConsent();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":{"message":"Incorrect API key provided: ' + SECRET + '"}}', {
        status: 401,
      }),
    );
    const { root, handle } = mount();
    type(q<HTMLInputElement>(root, 'secret'), SECRET);
    q<HTMLButtonElement>(root, 'test').click();
    await handle.whenIdle();

    const status = q(root, 'status').textContent ?? '';
    expect(status).toMatch(/từ chối/i);
    // Nhà cung cấp ECHO bí mật lại trong thân lỗi 401 — đúng như OpenAI làm
    // thật. Thân ấy không được đi vào DOM.
    expect(document.body.textContent ?? '').not.toContain(SECRET);
  });

  it('lỗi lạ ⇒ thông điệp dựng từ HẰNG SỐ, không mang theo lỗi gốc', async () => {
    grantConsent();
    const nasty: Provider = {
      id: 'gia',
      label: 'Giả',
      defaultModel: 'gia-1',
      // eslint-disable-next-line require-yield
      async *chat() {
        throw new TypeError(`Failed to fetch https://api.deepseek.com?key=${SECRET}`);
      },
    };
    const { root, handle } = mount({ getProvider: () => nasty });
    type(q<HTMLInputElement>(root, 'secret'), SECRET);
    q<HTMLButtonElement>(root, 'test').click();
    await handle.whenIdle();

    expect(document.body.textContent ?? '').not.toContain(SECRET);
    expect(q(root, 'status').textContent).toMatch(/không hoàn tất/i);
  });

  it('`ProviderError` thì được nói nguyên văn — nó đã được chứng minh dựng từ hằng số', async () => {
    grantConsent();
    const p: Provider = {
      id: 'gia',
      label: 'Giả',
      defaultModel: 'gia-1',
      // eslint-disable-next-line require-yield
      async *chat() {
        throw new ProviderError('rate_limited', 'Nhà cung cấp giới hạn tần suất.');
      },
    };
    const { root, handle } = mount({ getProvider: () => p });
    type(q<HTMLInputElement>(root, 'secret'), SECRET);
    q<HTMLButtonElement>(root, 'test').click();
    await handle.whenIdle();
    expect(q(root, 'status').textContent).toMatch(/giới hạn tần suất/);
  });

  it('lời gọi kiểm tra ĐI VÀO NHẬT KÝ — nhật ký không được nói dối về những gì đã rời máy', async () => {
    grantConsent();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse('OK'));
    const { root, handle } = mount();
    expect(readActivity().calls).toHaveLength(0);

    type(q<HTMLInputElement>(root, 'secret'), SECRET);
    q<HTMLButtonElement>(root, 'test').click();
    await handle.whenIdle();

    const calls = readActivity().calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].providerId).toBe('deepseek');
    expect(calls[0].chars).toBeGreaterThan(0);
  });
});

// ───────────────────────── bảng xác nhận nhúng vào cùng màn ─────────────

describe('bảng xác nhận của Task 9 sống chung màn hình với form', () => {
  it('bảng xác nhận có mặt, và bấm được ngay tại đây', () => {
    const { root } = mount();
    const btn = root.querySelector<HTMLButtonElement>('[data-role="consent"]');
    expect(btn).not.toBeNull();

    // Cú bấm thật (`isTrusted`) không dựng được trong jsdom; đường từ-chối thì
    // dựng được, và nó phải TỪ CHỐI — vẽ khung ra không tự cấp quyền.
    btn?.click();
    expect(sessionStorage.getItem('tuhoc.vault.guard.consent')).toBeNull();
  });

  it('sau khi có xác nhận, nhật ký hiện ra trong cùng màn hình', () => {
    grantConsent();
    const { root } = mount();
    expect(root.textContent).toMatch(/đã gửi đi những gì/i);
    expect(root.querySelector('[data-role="clear-log"]')).not.toBeNull();
  });

  /**
   * BẪY: `onActivity` của Task 9 được gọi sau MỌI quyết định của người gác, tức
   * là mỗi lần trang chính nhắn `chat` vào. Nếu nó vẽ lại cả màn hình thì một
   * course độc gọi liên tục sẽ **xoá sạch bí mật người dùng đang gõ dở** ở mỗi
   * lời gọi — một cách phá tính năng mà không cổng nào hỏi tới.
   */
  it('BẪY: vẽ lại nhật ký KHÔNG xoá chữ đang gõ trong ô bí mật', () => {
    grantConsent();
    const { root, handle } = mount();
    const input = q<HTMLInputElement>(root, 'secret');
    type(input, SECRET);
    pick(q<HTMLSelectElement>(root, 'provider'), 'groq');

    handle.repaintPanel();
    handle.repaintPanel();

    expect(input.value).toBe(SECRET);
    expect(q<HTMLSelectElement>(root, 'provider').value).toBe('groq');
    // …và ô nhập vẫn là ĐÚNG phần tử cũ, không phải một bản sao mang giá trị cũ.
    expect(q<HTMLInputElement>(root, 'secret')).toBe(input);
  });
});

// ───────────────────────── không rò ra ngoài origin ─────────────────────

describe('bí mật không rời origin kho khoá', () => {
  it('khung cấu hình KHÔNG gửi `postMessage` nào — nó không nói chuyện với trang chính', async () => {
    grantConsent();
    const post = vi.spyOn(window, 'postMessage');
    const parentPost = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse('OK'));
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: parentPost } as unknown as Window,
    });

    const { root, handle } = mount();
    type(q<HTMLInputElement>(root, 'secret'), SECRET);
    q<HTMLButtonElement>(root, 'save').click();
    q<HTMLButtonElement>(root, 'test').click();
    await handle.whenIdle();

    expect(post).not.toHaveBeenCalled();
    expect(parentPost).not.toHaveBeenCalled();
  });

  /**
   * `innerHTML` là đúng một dòng mã đủ để biến origin giữ bí mật thành nơi chạy
   * mã của người khác (S1-F43). Nhãn nhà cung cấp là hằng số của kho khoá hôm
   * nay, nhưng thông điệp lỗi thì không luôn luôn — nên phép kiểm đi qua cả hai.
   */
  it('mọi chữ đi vào `textContent`: một nhãn chứa mã bị dựng thành CHỮ', () => {
    const { root } = mount({
      listProviders: () => [{ id: 'x', label: '<img src=x onerror=alert(1)>' }],
      getProvider: () => fakeProvider({}),
    });
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
