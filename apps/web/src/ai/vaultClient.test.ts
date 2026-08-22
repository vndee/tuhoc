import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@vault-protocol';
import { VaultClient, VaultError, resolveVaultOrigin } from './vaultClient';

/**
 * CHIỀU ĐỐI XỨNG của phép kiểm origin.
 *
 * Task 1 dựng phía kho khoá: một thông điệp từ origin lạ không được gây ra bất
 * kỳ ảnh hưởng nào, KỂ CẢ một hồi đáp lỗi — vì hồi đáp lỗi cũng là một kênh.
 * Tệp này canh chiều còn lại, và nó quan trọng ngang chiều kia: một trang bất
 * kỳ mở bằng `window.open` `postMessage` được về trang chính. Nếu trang chính
 * tin, một course độc **bơm được chữ giả vào câu trả lời AI** — người học đọc
 * một lời khuyên sai mà tưởng là của mô hình họ tự chọn và tự trả tiền.
 *
 * Task 1 đo được rằng ba bài kiểm của kế hoạch BỎ LỌT chính bất biến chúng
 * canh: một cài đặt đọc `event.data` TRƯỚC phép kiểm origin — đếm số lần thử,
 * ghi nhật ký, rồi mới im lặng — vẫn làm cả ba xanh. Cùng câu hỏi ấy áp cho
 * phía này, và câu trả lời cũng vậy: chỉ một BẪY GETTER mới giết được nó.
 * Xem `describe('bẫy getter')` bên dưới.
 */

const VAULT = 'http://localhost:5174';

type PostSpy = ReturnType<typeof vi.fn>;

interface Harness {
  client: VaultClient;
  post: PostSpy;
  /** Thông điệp thứ `n` mà trang chính đã gửi vào khung kho khoá. */
  sent(n: number): { v: number; id: string; kind: string; [k: string]: unknown };
  /** `targetOrigin` của lời gọi `postMessage` thứ `n`. */
  targetOrigin(n: number): unknown;
  /** Giả một hồi đáp từ kho khoá (origin đúng), qua đúng `window` thật. */
  reply(data: unknown, origin?: string): void;
}

const live: VaultClient[] = [];

function harness(opts: { timeoutMs?: number } = {}): Harness {
  const post = vi.fn();
  const client = new VaultClient({
    lang: 'vi',
    vaultOrigin: VAULT,
    target: { postMessage: post } as unknown as Window,
    timeoutMs: opts.timeoutMs ?? 10_000,
  });
  live.push(client);
  return {
    client,
    post,
    sent: (n) => post.mock.calls[n]?.[0],
    targetOrigin: (n) => post.mock.calls[n]?.[1],
    reply: (data, origin = VAULT) => {
      window.dispatchEvent(new MessageEvent('message', { origin, data }));
    },
  };
}

afterEach(() => {
  while (live.length) live.pop()!.dispose();
  vi.useRealTimers();
});

/** Một sự kiện `message` thật, với bẫy getter cắm lên những trường mà một cài
 *  đặt sai sẽ chạm vào trước khi kiểm origin. `origin` KHÔNG bị bẫy — đọc nó
 *  chính là việc phải làm. */
function trappedEvent(origin: string): { event: MessageEvent; reads: string[] } {
  const reads: string[] = [];
  const event = new MessageEvent('message', { origin });
  for (const prop of ['data', 'source', 'ports', 'lastEventId'] as const) {
    Object.defineProperty(event, prop, {
      configurable: true,
      get() {
        reads.push(prop);
        return undefined;
      },
    });
  }
  return { event, reads };
}

describe('VaultClient — phép kiểm origin', () => {
  it('bỏ qua thông điệp từ origin không phải kho khoá', async () => {
    const h = harness();
    const p = h.client.status();
    // Promise này CỐ Ý không bao giờ giải quyết trong bài kiểm này; bắt lỗi để
    // một unhandled rejection ở cuối tiến trình không nhuộm đỏ tệp khác.
    void p.catch(() => {});

    h.reply(
      { v: 1, id: h.sent(0).id, kind: 'status', configured: true },
      'https://evil.example',
    );

    // Hồi đáp giả bị bỏ ⇒ promise vẫn treo. Đua với một timer chứng minh điều đó.
    const raced = await Promise.race([
      p,
      new Promise((r) => setTimeout(() => r('TREO'), 50)),
    ]);
    expect(raced).toBe('TREO');
  });

  it('CHẤP NHẬN hồi đáp từ đúng origin kho khoá — chiều xanh, để bài trên không xanh vì hỏng', async () => {
    const h = harness();
    const p = h.client.status();
    h.reply({ v: 1, id: h.sent(0).id, kind: 'status', configured: true, providerId: 'x', model: 'y' });
    await expect(p).resolves.toMatchObject({ kind: 'status', configured: true });
  });

  it('bỏ qua hồi đáp đúng origin nhưng SAI id — không cho một lời gọi trả lời hộ lời gọi khác', async () => {
    const h = harness();
    const p = h.client.status();
    void p.catch(() => {});
    h.reply({ v: 1, id: 'id-cua-nguoi-khac', kind: 'status', configured: true });
    const raced = await Promise.race([p, new Promise((r) => setTimeout(() => r('TREO'), 50))]);
    expect(raced).toBe('TREO');
  });

  it('bỏ qua hồi đáp sai phiên bản giao thức', async () => {
    const h = harness();
    const p = h.client.status();
    void p.catch(() => {});
    h.reply({ v: 2, id: h.sent(0).id, kind: 'status', configured: true });
    const raced = await Promise.race([p, new Promise((r) => setTimeout(() => r('TREO'), 50))]);
    expect(raced).toBe('TREO');
  });
});

describe('VaultClient — bẫy getter (chiều mà ba bài kiểm của kế hoạch bỏ lọt)', () => {
  /**
   * Bài kiểm quan trọng nhất của tệp này.
   *
   * "Promise vẫn treo" là tính chất của KẾT QUẢ. Một cài đặt đọc `event.data`,
   * so id, ghi một dòng log, rồi mới bỏ qua vì origin sai — vẫn để promise
   * treo, và vẫn đi qua cả bốn bài `describe` bên trên. Nhưng nó đã ĐỌC dữ
   * liệu của kẻ lạ, và mọi thứ nó làm với dữ liệu đó (đếm, log, đo thời gian)
   * là một kênh thông tin y như một hồi đáp lỗi.
   *
   * Bẫy đo THỨ TỰ THỰC THI, không đo kết quả.
   */
  it('KHÔNG ĐỌC event.data (và cả source/ports/lastEventId) khi origin lạ', () => {
    harness();
    const { event, reads } = trappedEvent('https://evil.example');
    window.dispatchEvent(event);
    expect(reads).toEqual([]);
  });

  it('CHỐT CHỐNG BẪY-KHÔNG-CẮM: cùng bẫy đó PHẢI ghi nhận khi origin đúng', () => {
    harness();
    const { event, reads } = trappedEvent(VAULT);
    window.dispatchEvent(event);
    // Nếu listener không được gắn, hoặc bẫy cắm nhầm chỗ, `reads` cũng rỗng —
    // và bài trên sẽ xanh mà không đo gì. Đây là chốt của Task 2, dùng lại.
    expect(reads).toContain('data');
  });

  it('sau dispose() thì không còn listener nào — bẫy không ghi nhận gì nữa', () => {
    const h = harness();
    h.client.dispose();
    const { event, reads } = trappedEvent(VAULT);
    window.dispatchEvent(event);
    expect(reads).toEqual([]);
  });
});

describe('VaultClient — targetOrigin luôn tường minh', () => {
  it('gửi với targetOrigin tường minh, không bao giờ "*"', () => {
    const h = harness();
    void h.client.status().catch(() => {});
    expect(h.targetOrigin(0)).toBe(VAULT);
  });

  it('MỌI đường gửi — status, chat, cancel — đều dùng đúng origin kho khoá', async () => {
    const h = harness();
    void h.client.status().catch(() => {});

    const ac = new AbortController();
    const chat = h.client.chat(
      { providerId: 'p', model: 'm', messages: [{ role: 'user', content: 'chào' }] },
      () => {},
      ac.signal,
    );
    void chat.catch(() => {});
    ac.abort();
    await Promise.allSettled([chat]);

    // Không vacuous: Task 1 §4.2 đo được rằng một vòng lặp trên mảng rỗng làm
    // bài kiểm "không bao giờ '*'" xanh trên một cài đặt KHÔNG GỬI GÌ CẢ.
    expect(h.post.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const call of h.post.mock.calls) {
      expect(call[1]).not.toBe('*');
      expect(call[1]).toBe(VAULT);
    }
  });
});

describe('VaultClient — hết giờ thay vì treo mãi', () => {
  it('status() hỏng ồn ào khi kho khoá không bao giờ trả lời', async () => {
    vi.useFakeTimers();
    const h = harness({ timeoutMs: 5_000 });
    const p = h.client.status();
    const seen = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_001);
    const err = await seen;
    expect(err).toBeInstanceOf(VaultError);
    expect((err as VaultError).code).toBe('timeout');
  });

  it('chat() hết giờ khi kho khoá im lặng — một tính năng AI im lặng vĩnh viễn là lỗi khó chẩn đoán nhất', async () => {
    vi.useFakeTimers();
    const h = harness({ timeoutMs: 5_000 });
    const p = h.client.chat({ providerId: 'p', model: 'm', messages: [] }, () => {});
    const seen = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(((await seen) as VaultError).code).toBe('timeout');
  });

  it('hạn chờ của chat() là hạn NHÀN RỖI: một câu trả lời dài, chảy chậm, không bị giết', async () => {
    vi.useFakeTimers();
    const h = harness({ timeoutMs: 5_000 });
    const chunks: string[] = [];
    const p = h.client.chat({ providerId: 'p', model: 'm', messages: [] }, (t) => chunks.push(t));
    const id = h.sent(0).id;

    // Tổng thời gian 12 s > 5 s, nhưng không khoảng lặng nào quá 4 s.
    for (const t of ['a', 'b', 'c']) {
      await vi.advanceTimersByTimeAsync(4_000);
      h.reply({ v: 1, id, kind: 'chunk', text: t });
    }
    await vi.advanceTimersByTimeAsync(4_000);
    h.reply({ v: 1, id, kind: 'done' });

    await expect(p).resolves.toBeUndefined();
    expect(chunks.join('')).toBe('abc');
  });
});

describe('VaultClient — chat', () => {
  it('gửi đúng hình dạng yêu cầu của giao thức', () => {
    const h = harness();
    void h.client
      .chat({ providerId: 'deepseek', model: 'deepseek-chat', messages: [{ role: 'user', content: 'chào' }] }, () => {})
      .catch(() => {});
    expect(h.sent(0)).toMatchObject({
      v: PROTOCOL_VERSION,
      kind: 'chat',
      providerId: 'deepseek',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'chào' }],
    });
    expect(typeof h.sent(0).id).toBe('string');
  });

  it('cộng dồn chunk theo thứ tự rồi kết thúc ở done', async () => {
    const h = harness();
    const chunks: string[] = [];
    const p = h.client.chat({ providerId: 'p', model: 'm', messages: [] }, (t) => chunks.push(t));
    const id = h.sent(0).id;
    h.reply({ v: 1, id, kind: 'chunk', text: 'Xin ' });
    h.reply({ v: 1, id, kind: 'chunk', text: 'chào' });
    h.reply({ v: 1, id, kind: 'done' });
    await expect(p).resolves.toBeUndefined();
    expect(chunks).toEqual(['Xin ', 'chào']);
  });

  it('chunk tới SAU done bị bỏ — một lời gọi đã đóng không nhận thêm chữ', async () => {
    const h = harness();
    const chunks: string[] = [];
    const p = h.client.chat({ providerId: 'p', model: 'm', messages: [] }, (t) => chunks.push(t));
    const id = h.sent(0).id;
    h.reply({ v: 1, id, kind: 'done' });
    await p;
    h.reply({ v: 1, id, kind: 'chunk', text: 'KHONG-DUOC-CO' });
    expect(chunks).toEqual([]);
  });

  it('lỗi của kho khoá về tới nơi KÈM MÃ, để giao diện phân biệt được "chưa cắm key"', async () => {
    const h = harness();
    const p = h.client.chat({ providerId: 'p', model: 'm', messages: [] }, () => {});
    const seen = p.catch((e: unknown) => e);
    h.reply({ v: 1, id: h.sent(0).id, kind: 'error', code: 'not_configured', message: 'Chưa cắm key.' });
    const err = (await seen) as VaultError;
    expect(err).toBeInstanceOf(VaultError);
    expect(err.code).toBe('not_configured');
  });
});

describe('VaultClient — cancel huỷ THẬT, không chỉ ngừng cập nhật giao diện', () => {
  /**
   * `AbortSignal` KHÔNG đi qua được `postMessage`: nó không phải kiểu
   * serializable của HTML, và đo được ngày 2026-08-22 dưới Bun
   * (`structuredClone(new AbortController().signal)` → `DataCloneError: The
   * object can not be cloned.`). Nên "chuyển `AbortSignal` tới kho khoá" chỉ
   * có một cách hiện thực được: một THÔNG ĐIỆP huỷ mà kho khoá dịch lại thành
   * `controller.abort()` ở phía nó.
   *
   * Xem `task-5-report.md` §"kế hoạch sai": thông điệp ấy CHƯA CÓ trong
   * `apps/vault/src/protocol.ts`. Phía trang chính gửi nó đúng hình dạng ngay
   * từ bây giờ, nên ngày kho khoá mọc ra nhánh xử lý, huỷ chạy đầu-cuối mà
   * không phải sửa một dòng nào ở đây.
   */
  it('abort() GỬI một thông điệp huỷ vào kho khoá, kèm id của lời gọi đang chạy', async () => {
    const h = harness();
    const ac = new AbortController();
    const p = h.client.chat({ providerId: 'p', model: 'm', messages: [] }, () => {}, ac.signal);
    const seen = p.catch((e: unknown) => e);
    const chatId = h.sent(0).id;

    ac.abort();
    await seen;

    expect(h.post.mock.calls.length).toBe(2);
    expect(h.sent(1)).toMatchObject({ v: PROTOCOL_VERSION, kind: 'cancel', cancelId: chatId });
    expect(h.targetOrigin(1)).toBe(VAULT);
  });

  it('sau khi huỷ, chunk tới muộn KHÔNG còn được giao cho giao diện', async () => {
    const h = harness();
    const ac = new AbortController();
    const chunks: string[] = [];
    const p = h.client.chat({ providerId: 'p', model: 'm', messages: [] }, (t) => chunks.push(t), ac.signal);
    const seen = p.catch((e: unknown) => e);
    const id = h.sent(0).id;
    h.reply({ v: 1, id, kind: 'chunk', text: 'som' });
    ac.abort();
    await seen;
    h.reply({ v: 1, id, kind: 'chunk', text: 'MUON' });
    expect(chunks).toEqual(['som']);
  });

  it('promise của chat() hỏng với mã "aborted", phân biệt được với lỗi thật', async () => {
    const h = harness();
    const ac = new AbortController();
    const p = h.client.chat({ providerId: 'p', model: 'm', messages: [] }, () => {}, ac.signal);
    const seen = p.catch((e: unknown) => e);
    ac.abort();
    expect(((await seen) as VaultError).code).toBe('aborted');
  });

  it('một signal ĐÃ abort trước khi gọi thì không gửi lời gọi nào cả', async () => {
    const h = harness();
    const ac = new AbortController();
    ac.abort();
    const seen = h.client
      .chat({ providerId: 'p', model: 'm', messages: [] }, () => {}, ac.signal)
      .catch((e: unknown) => e);
    expect(((await seen) as VaultError).code).toBe('aborted');
    expect(h.post).not.toHaveBeenCalled();
  });

  it('thông điệp huỷ mang ĐÚNG số phiên bản giao thức của kho khoá — chốt chống trôi dạt', async () => {
    const h = harness();
    const ac = new AbortController();
    const seen = h.client
      .chat({ providerId: 'p', model: 'm', messages: [] }, () => {}, ac.signal)
      .catch((e: unknown) => e);
    ac.abort();
    await seen;
    expect(h.sent(1).v).toBe(PROTOCOL_VERSION);
  });
});

/**
 * `setLang` — MỘT CHIỀU, VÀ SỰ MỘT CHIỀU ẤY LÀ THỨ PHẢI ĐO.
 *
 * Ngôn ngữ hiển thị của kho khoá đi bằng thông điệp thay vì bằng `?lang=` trên
 * `src` của khung, vì `src` đổi thì trình duyệt nạp lại tài liệu ở origin kia
 * và **xoá sạch ô dán key đang gõ dở** (Task 7 đo được cả đường bàn phím lẫn
 * đường chuột). Cái giá của lựa chọn ấy là một thành viên mới trong một union
 * đóng, và S2-F8 buộc thành viên ấy phải trả lời được *"nó có mang được key ra
 * khỏi origin kho khoá không"*.
 *
 * Phía này canh nửa của nó: **không có gì để chờ.** Một `setLang` không tạo
 * lời gọi treo, không lên đồng hồ, không có `id` nào đang đợi hồi đáp — nên
 * không có chỗ nào cho một hồi đáp mang dữ liệu về mà lọt.
 */
describe('VaultClient — setLang là một chiều', () => {
  it('gửi đúng hình dạng giao thức, với `targetOrigin` tường minh', () => {
    const h = harness();
    h.client.setLang('en');

    expect(h.sent(0)).toEqual({
      v: PROTOCOL_VERSION,
      id: expect.any(String),
      kind: 'setLang',
      lang: 'en',
    });
    expect(h.targetOrigin(0)).toBe(VAULT);
    expect(h.targetOrigin(0)).not.toBe('*');
  });

  it('KHÔNG để lại lời gọi nào đang chờ — hết giờ cũng không có gì để hỏng', () => {
    vi.useFakeTimers();
    const h = harness({ timeoutMs: 50 });
    h.client.setLang('en');

    // Nếu `setLang` lỡ đi qua `#track`, cây đồng hồ sẽ nổ ở đây và ném một
    // `VaultError` không ai bắt — một lời hứa bị từ chối trong im lặng, đúng
    // hạng lỗi mà `dispose()` phải dọn.
    expect(() => {
      vi.advanceTimersByTime(500);
    }).not.toThrow();

    // Và một hồi đáp mang ĐÚNG `id` của thông điệp ấy cũng không đánh thức gì:
    // không có ai đăng ký, nên không có ai nghe.
    const id = h.sent(0).id;
    expect(() => {
      h.reply({ v: PROTOCOL_VERSION, id, kind: 'done' });
    }).not.toThrow();
  });
});

describe('resolveVaultOrigin — cấu hình sai phải hỏng ỒN ÀO', () => {
  /**
   * Cùng lập luận Task 1 đã đo cho `resolveAllowedOrigin` ở phía kho khoá, áp
   * cho phía này: mọi giá trị sai hình dạng đều dẫn tới ĐÚNG MỘT triệu chứng —
   * "AI không trả lời" — không lỗi, không cảnh báo, không manh mối.
   *
   * Nhận `env` làm THAM SỐ chứ không đọc thẳng `import.meta.env`: Vite thay
   * `import.meta.env.X` bằng hằng số lúc dịch, nên test không đặt lại được giá
   * trị đó lúc chạy. Và đo được ngày 2026-08-22: ở `apps/web`,
   * `import.meta.env.VITEST` là `undefined` (khác `apps/vault`, nơi Task 1 đo
   * được `"true"`), nên một khối bảo vệ dựa vào cờ đó sẽ im lặng không chạy.
   */
  it('trả về origin khi cấu hình hợp lệ', () => {
    expect(resolveVaultOrigin({ VITE_VAULT_ORIGIN: VAULT }, 'vi')).toBe(VAULT);
  });

  it('trả về null khi KHÔNG cấu hình — tính năng AI vắng mặt, ứng dụng vẫn chạy', () => {
    expect(resolveVaultOrigin({}, 'vi')).toBeNull();
    expect(resolveVaultOrigin({ VITE_VAULT_ORIGIN: '   ' }, 'vi')).toBeNull();
  });

  it('NÉM với "*" — giá trị này vừa là bộ lọc nhận vừa là targetOrigin khi gửi', () => {
    expect(() => resolveVaultOrigin({ VITE_VAULT_ORIGIN: '*' }, 'vi')).toThrow(/VITE_VAULT_ORIGIN/);
  });

  it('NÉM với dấu "/" cuối — event.origin không bao giờ có nó, nên sẽ không khớp gì hết', () => {
    expect(() => resolveVaultOrigin({ VITE_VAULT_ORIGIN: 'http://localhost:5174/' }, 'vi')).toThrow(
      /VITE_VAULT_ORIGIN/,
    );
  });

  it('NÉM với đường dẫn, và NÉM khi thiếu scheme', () => {
    expect(() => resolveVaultOrigin({ VITE_VAULT_ORIGIN: 'https://x.example/app' }, 'vi')).toThrow(
      /VITE_VAULT_ORIGIN/,
    );
    expect(() => resolveVaultOrigin({ VITE_VAULT_ORIGIN: 'vault.example' }, 'vi')).toThrow(
      /VITE_VAULT_ORIGIN/,
    );
  });
});
