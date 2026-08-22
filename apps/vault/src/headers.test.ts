/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_ORIGIN_TOKEN, applyAppOrigin, cspDirective } from './headers';
import { getProvider, listProviders } from './providers';

/**
 * Cổng cho `frame-ancestors` — hạng mục an ninh có tên của Task 6.
 *
 * Task 1 phát hiện kho khoá **thiếu `frame-ancestors`**, nên bất kỳ site nào
 * cũng nhúng nó vào `<iframe>` được. Hôm qua điều đó vô hại: trang rỗng,
 * `handleMessage` bỏ thông điệp lạ, `localStorage` khác origin nên không đọc
 * được. **Task này làm nó nguy hiểm** — từ lúc form nhập bí mật được vẽ vào
 * origin ấy, một site thù địch nhúng kho khoá thật vào trang của họ và trình ra
 * một ô nhập trông y hệt, ở đúng origin thật, với đúng chứng chỉ thật.
 *
 * Và đây là lý do tệp test này tồn tại thay vì một dòng trong tài liệu deploy:
 * **một header chỉ tồn tại trong đầu người deploy thì không cổng nào hỏi được.**
 * Repo này đã có năm cổng mù cùng hình dạng ấy (`docs/carried-forward.md`).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const VAULT = resolve(HERE, '..');
const HEADERS_FILE = resolve(VAULT, '_headers');
const VITE_CONFIG = resolve(VAULT, 'vite.config.ts');

function headersText(): string {
  return readFileSync(HEADERS_FILE, 'utf8');
}

/** Host mà MỖI nhà cung cấp trong registry thật sự gọi tới — đo bằng cách chạy
 *  `chat` với một `fetch` giả, không bằng một danh sách chép tay.
 *
 *  Một danh sách chép tay là một bản sao thứ hai sẽ trôi dạt: thêm nhà cung cấp
 *  thứ sáu mà quên sửa CSP thì `connect-src` chặn lời gọi và triệu chứng duy
 *  nhất là "AI không trả lời". Phép đo này làm cổng đỏ ngay lúc đó. */
async function hostsProvidersActuallyCall(): Promise<string[]> {
  const seen: string[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    seen.push(new URL(String(input)).origin);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        c.close();
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  });

  for (const { id } of listProviders()) {
    const p = getProvider(id);
    expect(p, id).not.toBeNull();
    for await (const _chunk of p!.chat(
      { model: 'm', messages: [{ role: 'user', content: 'x' }] },
      'k',
    )) {
      // Chỉ cần lời gọi mạng xảy ra; nội dung không quan trọng ở đây.
    }
  }
  spy.mockRestore();
  return [...new Set(seen)].sort();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bộ phân tích chỉ thị CSP — chứng minh nó còn sống trước khi tin nó', () => {
  it('tìm được chỉ thị có mặt, và trả `null` cho chỉ thị vắng mặt', () => {
    const sample = "default-src 'none'; frame-ancestors 'self' https://a.example; connect-src https://b.example";
    expect(cspDirective(sample, 'frame-ancestors')).toBe("'self' https://a.example");
    expect(cspDirective(sample, 'connect-src')).toBe('https://b.example');
    expect(cspDirective(sample, 'script-src')).toBeNull();
  });

  it('KHÔNG khớp nhầm một chỉ thị là hậu tố của chỉ thị khác', () => {
    expect(cspDirective("child-src 'self'", 'src')).toBeNull();
    expect(cspDirective("frame-src 'self'", 'frame-ancestors')).toBeNull();
  });
});

describe('tệp `_headers` của kho khoá nằm TRONG repo', () => {
  it('tồn tại, và áp cho MỌI đường dẫn của origin kho khoá', () => {
    const text = headersText();
    // Cloudflare Pages: một khối bắt đầu bằng một mẫu đường dẫn, các dòng sau
    // thụt lề là header. `/*` phủ toàn bộ site — kho khoá chỉ có một trang, và
    // một khối hẹp hơn sẽ bỏ sót đúng trang ấy nếu nó đổi tên.
    expect(text).toMatch(/^\/\*\s*$/m);
    expect(text).toMatch(/^\s+Content-Security-Policy:/m);
  });

  it('CÓ `frame-ancestors`, và nó KHÔNG mở cho tất cả', () => {
    const csp = cspDirective(headersText(), 'frame-ancestors');
    expect(csp, 'thiếu frame-ancestors — bất kỳ site nào cũng nhúng được kho khoá').not.toBeNull();
    expect(csp).not.toContain('*');
    expect(csp).toContain("'self'");
    // Trang chính ở một origin KHÁC (`vault.<domain>` vs `app.<domain>`), nên
    // `'self'` một mình không đủ — nó phải được nêu tên.
    expect(csp).toContain(APP_ORIGIN_TOKEN);
  });

  it('`default-src` đóng, và không chỉ thị nào dùng `*`', () => {
    const text = headersText();
    expect(cspDirective(text, 'default-src')).toBe("'none'");
    const csp = /Content-Security-Policy:\s*(.+)/.exec(text)?.[1] ?? '';
    expect(csp).not.toContain('*');
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('`connect-src` phủ ĐÚNG những host mà registry thật sự gọi tới', async () => {
    const csp = cspDirective(headersText(), 'connect-src');
    expect(csp).not.toBeNull();
    const allowed = (csp ?? '').split(/\s+/).filter((s) => s.startsWith('https://'));
    const called = await hostsProvidersActuallyCall();

    // Chốt chống bẫy-không-cắm: nếu phép đo không gọi được nhà cung cấp nào thì
    // khẳng định dưới đây xanh trên một danh sách rỗng và không đo gì cả.
    expect(called.length).toBe(listProviders().length);
    expect(called.filter((h) => !allowed.includes(h)), 'host bị CSP chặn').toEqual([]);
  });

  it('mang theo những header rẻ mà kho khoá nào cũng nên có', () => {
    const text = headersText();
    expect(text).toMatch(/X-Content-Type-Options:\s*nosniff/);
    // Không gửi Referer sang nhà cung cấp: đó là một trong ba chỗ mỏng mà
    // `task-3-report.md` §9 tự nêu, và nó đóng được bằng một dòng ở đây.
    expect(text).toMatch(/Referrer-Policy:\s*no-referrer/);
  });
});

describe('`applyAppOrigin` — chỗ giá trị thật được điền vào lúc dựng', () => {
  it('thay thẻ giữ chỗ bằng origin thật, và không để lại thẻ nào', () => {
    const out = applyAppOrigin(headersText(), 'https://tuhoc.example');
    expect(out).not.toContain(APP_ORIGIN_TOKEN);
    expect(cspDirective(out, 'frame-ancestors')).toBe("'self' https://tuhoc.example");
  });

  it('NÉM khi thiếu origin — kho khoá không tự đoán ai được nhúng nó', () => {
    expect(() => applyAppOrigin(headersText(), '')).toThrow(/VITE_APP_ORIGIN/);
    expect(() => applyAppOrigin(headersText(), '   ')).toThrow(/VITE_APP_ORIGIN/);
  });

  it('NÉM với đúng bốn giá trị sai hình dạng mà Task 1 và Task 5 đã chặn', () => {
    for (const bad of ['*', 'https://x.example/', 'https://x.example/app', 'tuhoc.example']) {
      expect(() => applyAppOrigin(headersText(), bad), bad).toThrow(/VITE_APP_ORIGIN/);
    }
  });

  it('NÉM khi tệp `_headers` mất `frame-ancestors` — cổng phải đỏ ở BUILD, không ở deploy', () => {
    // Toàn cục: `_headers` nhắc `frame-ancestors` cả trong khối chú thích giải
    // thích vì sao nó phải có mặt, và xoá đúng một lần sẽ xoá nhầm lời giải
    // thích trong khi dòng thật ở lại.
    const gutted = headersText().replace(/frame-ancestors[^;\n]*;?\s*/g, '');
    expect(() => applyAppOrigin(gutted, 'https://tuhoc.example')).toThrow(/frame-ancestors/);
  });

  it('NÉM khi không còn thẻ giữ chỗ nào để thay', () => {
    const noToken = headersText().replaceAll(APP_ORIGIN_TOKEN, "'self'");
    expect(() => applyAppOrigin(noToken, 'https://tuhoc.example')).toThrow(/thẻ giữ chỗ/);
  });
});

describe('`_headers` thật sự tới được bản dựng', () => {
  /**
   * Một tệp nằm trong repo mà không ai chép vào `dist/` thì cũng chỉ là một
   * header trong đầu người deploy, chỉ khác là nó được đánh máy ra. Bài kiểm
   * này hỏi câu "bản dựng có mang nó theo không" ở tầng duy nhất một bài kiểm
   * đơn vị hỏi được: cấu hình dựng có nối nó vào hay không.
   */
  it('vite.config.ts nối `_headers` vào bản dựng qua `applyAppOrigin`', () => {
    const cfg = readFileSync(VITE_CONFIG, 'utf8');
    expect(cfg).toContain('_headers');
    expect(cfg).toContain('applyAppOrigin');
    expect(cfg).toMatch(/closeBundle|writeBundle|generateBundle/);
  });
});
