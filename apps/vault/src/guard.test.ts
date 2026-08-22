import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUCKET_CAPACITY,
  BUCKET_REFILL_MS,
  MAX_LOG_ENTRIES,
  checkAndConsume,
  clearActivity,
  grantConsent,
  hasConsent,
  readActivity,
  revokeConsent,
  type Activity,
} from './guard';
import { handleConsentClick, renderVaultPanel } from './ui/Consent';
import { handleMessage } from './main';
import { writeConfig } from './keystore';
import type { VaultResponse } from './protocol';

/**
 * Task 9 — giảm thiểu *confused deputy* (HC-3).
 *
 * **Đọc dòng này trước mọi dòng khác trong tệp: đây là GIẢM THIỂU, KHÔNG phải
 * khắc phục.** Iframe khác origin chặn được course độc **đọc** key. Nó không
 * chặn được course độc **sai khiến** kho khoá gọi hộ — course chạy trong trang
 * chính, và trang chính được phép nhắn cho kho khoá. Ba thứ dựng ở đây chỉ làm
 * lỗ ấy **đắt hơn và nhìn thấy được**:
 *
 *   1. token bucket **phía kho khoá** (kho khoá không tin trang chính);
 *   2. một cú bấm xác nhận **trong khung kho khoá** cho lời gọi đầu mỗi phiên;
 *   3. nhật ký hoạt động người dùng xem được.
 *
 * Đường ra thật — cho course chạy trong iframe sandbox origin riêng — đã bị
 * spec §1.2 **bác bỏ có ý thức** vì nó phá P2 (chú thích cần chạm DOM chương).
 * Xem `docs/carried-forward.md`.
 *
 * **Bề mặt rò MỚI mà chính task này tạo ra: nhật ký.** Một nhật ký ghi nội dung
 * là bản sao thứ hai của ghi chú riêng tư, nằm ngay cạnh key. Vì vậy bẫy nội
 * dung và bẫy key ở tệp này cắm bằng `beforeEach`/`afterEach` cho **MỌI** bài
 * kiểm, kể cả những bài không nhắc gì tới nhật ký — bài học M3 của Task 2 và
 * §3.2 của Task 3, nơi một bẫy chỉ cắm ở đường lỗi để mutant ở đường thành công
 * sống sót.
 */

// ───────────────────────── hằng số của bẫy ─────────────────────────

const APP = 'http://localhost:5173';

/** Key giả, hình dạng như key thật để mọi phép so chuỗi đo đúng thứ nó tưởng. */
const KEY = 'sk-BI-MAT-TASK9-KHONG-DUOC-RO-4d1f8a';

/** Đóng vai **ghi chú riêng tư** của người dùng đi vào lời nhắc. Chuỗi này được
 *  phép đi tới nhà cung cấp (đó là việc người dùng yêu cầu) và **không được**
 *  xuất hiện ở bất kỳ chỗ nào khác: không nhật ký, không ô nhớ, không console. */
const NOTE = 'GHI-CHU-RIENG-TU-a3f9-khong-duoc-vao-nhat-ky';

const SECRET_STORAGE_KEY = 'tuhoc.vault.key';

const enc = new TextEncoder();

// ───────────────────── đồng hồ đo được ─────────────────────

/** `Date.now` bị thay bằng một biến để bài kiểm điều khiển được thời gian mà
 *  không cần fake timer (fake timer sẽ đóng băng cả `setTimeout` mà phần
 *  streaming bất đồng bộ dưới kia đang dựa vào). */
let clock = 1_700_000_000_000;

// ───────────────── bẫy: đi bộ qua đồ thị giá trị ─────────────────

/**
 * Cùng hình dạng với `allStrings` của Task 2/3, mang sang vì lý do y hệt:
 * `JSON.stringify` bỏ sót đúng những chỗ một kẻ rò nấp được — khoá của object,
 * `Map`, `Set`, và giá trị nằm sau getter.
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

  for (let o: object | null = value; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const k of Object.getOwnPropertyNames(o)) {
      out.push(k);
      let v: unknown;
      try {
        v = (value as Record<string, unknown>)[k];
      } catch {
        continue;
      }
      if (typeof v !== 'function') allStrings(v, seen, out);
    }
  }
  return out;
}

/** Mọi cặp tên→giá trị đang nằm trong hai kho lưu trữ của origin kho khoá. */
function storageDump(): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const store of [localStorage, sessionStorage]) {
    for (let i = 0; i < store.length; i += 1) {
      const name = store.key(i);
      if (name === null) continue;
      out.push({ name, value: store.getItem(name) ?? '' });
    }
  }
  return out;
}

const nativeGetItem = Storage.prototype.getItem;

function trapStorageReads(): { reads: string[]; restore: () => void } {
  const reads: string[] = [];
  const spy = vi
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation(function (this: Storage, k: string): string | null {
      reads.push(k);
      return nativeGetItem.call(this, k);
    });
  return { reads, restore: () => spy.mockRestore() };
}

// ───────────── bẫy console + bẫy ô nhớ, cắm cho MỌI bài kiểm ─────────────

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
const consoleSeen: unknown[] = [];
let consoleSpies: Array<{ mockRestore: () => void }> = [];
/** Bài kiểm tự-kiểm-bẫy cố tình rò; nó bật cờ này để `afterEach` không đỏ oan. */
let allowLeak = false;

function consoleHas(needle: string): boolean {
  return allStrings(consoleSeen).some((s) => s.includes(needle));
}

/** Ô nhớ nào đang chứa `needle`. Ô `tuhoc.vault.key` được loại trừ khỏi phép
 *  tìm KEY vì đó là **chỗ duy nhất** key được phép nằm — nhưng nó KHÔNG được
 *  loại trừ khỏi phép tìm NOTE. */
function storageHas(needle: string, exceptName?: string): string[] {
  return storageDump()
    .filter((e) => e.name !== exceptName)
    .filter((e) => e.name.includes(needle) || e.value.includes(needle))
    .map((e) => e.name);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clock = 1_700_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  consoleSeen.length = 0;
  allowLeak = false;
  consoleSpies = CONSOLE_METHODS.map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      consoleSeen.push(args);
    }),
  );
});

afterEach(() => {
  // Đọc bẫy TRƯỚC khi gỡ. Bốn khẳng định này chạy cho MỌI bài kiểm trong tệp —
  // đó là toàn bộ điểm của chúng.
  const keyInConsole = consoleHas(KEY);
  const noteInConsole = consoleHas(NOTE);
  const keyInStorage = storageHas(KEY, SECRET_STORAGE_KEY);
  const noteInStorage = storageHas(NOTE);

  consoleSpies.forEach((s) => s.mockRestore());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();

  if (!allowLeak) {
    expect(keyInConsole, 'key đã vào console — "key không bao giờ vào log"').toBe(false);
    expect(noteInConsole, 'nội dung lời nhắc đã vào console').toBe(false);
    expect(keyInStorage, 'key đã ra khỏi ô nhớ bí mật của nó').toEqual([]);
    expect(
      noteInStorage,
      'nội dung lời nhắc đã được ghi vào ô nhớ — nhật ký vừa thành bản sao thứ hai của ghi chú riêng tư',
    ).toEqual([]);
  }
});

describe('bộ dò còn sống', () => {
  it('BẪY-CỦA-BẪY: `storageHas` thật sự thấy chuỗi bị gài, ở tên lẫn ở giá trị', () => {
    allowLeak = true;
    expect(storageHas(NOTE)).toEqual([]);
    localStorage.setItem('mot-o-nho-nao-do', `nhat ky: ${NOTE}`);
    sessionStorage.setItem(`ten-co-${NOTE}`, 'x');
    expect(storageHas(NOTE).sort()).toEqual([`ten-co-${NOTE}`, 'mot-o-nho-nao-do'].sort());
    // Và phép loại trừ chỉ tha ĐÚNG ô nhớ bí mật, không tha ô nào khác.
    localStorage.setItem(SECRET_STORAGE_KEY, KEY);
    localStorage.setItem('o-nho-khac', KEY);
    expect(storageHas(KEY, SECRET_STORAGE_KEY)).toEqual(['o-nho-khac']);
  });

  it('BẪY-CỦA-BẪY: `consoleHas` thấy chuỗi đi qua cả sáu kênh console', () => {
    allowLeak = true;
    expect(consoleHas(KEY)).toBe(false);
    console.trace({ headers: { authorization: `Bearer ${KEY}` } });
    expect(consoleHas(KEY)).toBe(true);
  });
});

// ═══════════════════ 1. Token bucket ═══════════════════

describe('token bucket — giới hạn nằm PHÍA KHO KHOÁ', () => {
  it('hằng số ở khoảng người ta chọn có ý thức, không phải một con số trôi', () => {
    // Nếu ai đó nâng sức chứa lên 100 thì bài kiểm này đỏ và người sửa phải
    // nghĩ. Một bài kiểm chỉ so với hằng số đã xuất sẽ xanh với MỌI giá trị.
    expect(BUCKET_CAPACITY).toBeGreaterThanOrEqual(3);
    expect(BUCKET_CAPACITY).toBeLessThanOrEqual(12);
    expect(BUCKET_REFILL_MS).toBeGreaterThanOrEqual(1_000);
  });

  it('100 lời gọi liên tiếp: đúng BUCKET_CAPACITY được cho qua, phần còn lại `rate_limited`', () => {
    grantConsent();
    let allowed = 0;
    let limited = 0;
    for (let i = 0; i < 100; i += 1) {
      const d = checkAndConsume({ chars: 10, providerId: 'deepseek' });
      if (d.allow) allowed += 1;
      else if (d.code === 'rate_limited') limited += 1;
    }
    expect(allowed).toBe(BUCKET_CAPACITY);
    expect(allowed).toBeLessThan(100);
    expect(limited).toBe(100 - BUCKET_CAPACITY);
  });

  it('nạp lại theo thời gian, và KHÔNG vượt sức chứa dù nghỉ rất lâu', () => {
    grantConsent();
    for (let i = 0; i < BUCKET_CAPACITY; i += 1) checkAndConsume({ chars: 1, providerId: 'deepseek' });
    expect(checkAndConsume({ chars: 1, providerId: 'deepseek' }).allow).toBe(false);

    clock += BUCKET_REFILL_MS;
    expect(checkAndConsume({ chars: 1, providerId: 'deepseek' }).allow).toBe(true);
    expect(checkAndConsume({ chars: 1, providerId: 'deepseek' }).allow).toBe(false);

    // Nghỉ một ngày: bucket đầy lại, nhưng KHÔNG tràn.
    clock += 24 * 60 * 60 * 1000;
    let burst = 0;
    while (checkAndConsume({ chars: 1, providerId: 'deepseek' }).allow) {
      burst += 1;
      if (burst > 500) break; // chống vòng lặp vô hạn nếu cài đặt hỏng
    }
    expect(burst).toBe(BUCKET_CAPACITY);
  });

  it('BẪY: bucket sống trong ô nhớ, nên NẠP LẠI KHUNG không cấp bucket mới', async () => {
    // Trang chính điều khiển được `iframe.src` — nó nạp lại kho khoá bất cứ lúc
    // nào. Nếu bucket là một biến trong module thì lần nạp lại nào cũng cho một
    // bucket đầy, còn xác nhận thì vẫn còn (nó ở `sessionStorage`) — tức là
    // người gác này không giới hạn gì cả. `vi.resetModules()` + `import()` dựng
    // lại đúng tình huống ấy.
    grantConsent();
    for (let i = 0; i < BUCKET_CAPACITY; i += 1) checkAndConsume({ chars: 1, providerId: 'deepseek' });
    expect(checkAndConsume({ chars: 1, providerId: 'deepseek' }).allow).toBe(false);

    vi.resetModules();
    const fresh = (await import('./guard')) as typeof import('./guard');
    expect(fresh.hasConsent()).toBe(true); // phiên vẫn là phiên đó
    expect(fresh.checkAndConsume({ chars: 1, providerId: 'deepseek' }).allow).toBe(false);
  });

  it('lời gọi BỊ TỪ CHỐI không tiêu token — nếu không, spam trước khi xin phép sẽ đốt sạch hạn mức', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(checkAndConsume({ chars: 1, providerId: 'deepseek' }).code).toBe('needs_consent');
    }
    grantConsent();
    let allowed = 0;
    for (let i = 0; i < 100; i += 1) {
      if (checkAndConsume({ chars: 1, providerId: 'deepseek' }).allow) allowed += 1;
    }
    expect(allowed).toBe(BUCKET_CAPACITY);
  });

  it('FAIL CLOSED: không ghi được trạng thái bucket ⇒ từ chối, không phải cho qua', () => {
    grantConsent();
    const orig = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      k: string,
      v: string,
    ) {
      if (k.includes('bucket')) throw new DOMException('QuotaExceededError');
      return orig.call(this, k, v);
    });
    const d = checkAndConsume({ chars: 1, providerId: 'deepseek' });
    expect(d.allow).toBe(false);
    expect(d.code).toBe('rate_limited');
  });
});

// ═══════════════════ 2. Xác nhận đầu phiên ═══════════════════

describe('xác nhận đầu phiên', () => {
  it('mặc định CHƯA xác nhận, và lời gọi đầu tiên trả `needs_consent`', () => {
    expect(hasConsent()).toBe(false);
    const d = checkAndConsume({ chars: 10, providerId: 'deepseek' });
    expect(d.allow).toBe(false);
    expect(d.code).toBe('needs_consent');
  });

  it('sau khi bấm xác nhận thì cho qua, và `revokeConsent` đóng lại', () => {
    grantConsent();
    expect(hasConsent()).toBe(true);
    expect(checkAndConsume({ chars: 10, providerId: 'deepseek' }).allow).toBe(true);
    revokeConsent();
    expect(hasConsent()).toBe(false);
    expect(checkAndConsume({ chars: 10, providerId: 'deepseek' }).code).toBe('needs_consent');
  });

  it('xác nhận nằm ở sessionStorage, KHÔNG ở localStorage — hết phiên là hết', () => {
    grantConsent();
    // `sessionStorage` chết khi tab đóng; `localStorage` thì không. "Một lần mỗi
    // PHIÊN" chỉ đúng nếu chỗ cất đúng.
    expect(storageHas('consent').length).toBeGreaterThan(0);
    let inLocal = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      if ((localStorage.key(i) ?? '').includes('consent')) inLocal += 1;
    }
    expect(inLocal).toBe(0);
  });
});

// ═══════════════════ 3. Nhật ký hoạt động ═══════════════════

describe('nhật ký hoạt động', () => {
  it('ghi thời điểm và SỐ KÝ TỰ, không ghi nội dung', () => {
    grantConsent();
    clock = 1_700_000_123_456;
    checkAndConsume({ chars: 4242, providerId: 'deepseek' });
    const log = readActivity();
    expect(log.calls).toHaveLength(1);
    expect(log.calls[0].at).toBe(1_700_000_123_456);
    expect(log.calls[0].chars).toBe(4242);
    expect(log.calls[0].providerId).toBe('deepseek');
  });

  it('BẪY: `providerId` do trang chính gửi KHÔNG đi thẳng vào nhật ký', () => {
    // `providerId` là chuỗi tuỳ ý từ trang chính — nơi HC-3 nói course độc đang
    // chạy. Ghi thẳng nó là mở một đường thứ hai để nhét văn xuôi vào nhật ký,
    // đúng thứ nhật ký này bị cấm chứa.
    grantConsent();
    checkAndConsume({ chars: 1, providerId: `deepseek ${NOTE}` });
    const log = readActivity();
    expect(log.calls).toHaveLength(1);
    expect(log.calls[0].providerId).toBeNull();
    expect(allStrings(log).some((s) => s.includes(NOTE))).toBe(false);
  });

  it('nhật ký có TRẦN, không phình vô hạn', () => {
    grantConsent();
    for (let i = 0; i < MAX_LOG_ENTRIES + 50; i += 1) {
      clock += BUCKET_REFILL_MS; // luôn có token
      checkAndConsume({ chars: i, providerId: 'deepseek' });
    }
    const log = readActivity();
    expect(log.calls).toHaveLength(MAX_LOG_ENTRIES);
    // Giữ lại các mục MỚI NHẤT, không phải các mục cũ nhất.
    expect(log.calls[log.calls.length - 1].chars).toBe(MAX_LOG_ENTRIES + 49);
  });

  it('BẪY: một trận lũ lời gọi bị từ chối KHÔNG đẩy được lời gọi thật ra khỏi nhật ký', () => {
    // Nếu mục bị từ chối cũng nằm chung vòng đệm, một course độc chỉ cần gọi
    // 200 lần để xoá dấu vết những gì nó vừa gửi đi thật. Vì vậy mục bị từ chối
    // là BỘ ĐẾM, không phải mục nhật ký.
    grantConsent();
    checkAndConsume({ chars: 777, providerId: 'deepseek' });
    for (let i = 0; i < MAX_LOG_ENTRIES * 3; i += 1) {
      checkAndConsume({ chars: 1, providerId: 'deepseek' });
    }
    const log = readActivity();
    expect(log.calls.some((c) => c.chars === 777)).toBe(true);
    expect(log.denied.rate_limited).toBeGreaterThan(MAX_LOG_ENTRIES);
  });

  it('đếm riêng hai loại từ chối, kèm thời điểm gần nhất', () => {
    checkAndConsume({ chars: 1, providerId: 'deepseek' });
    grantConsent();
    for (let i = 0; i < BUCKET_CAPACITY + 3; i += 1) checkAndConsume({ chars: 1, providerId: 'deepseek' });
    const log = readActivity();
    expect(log.denied.needs_consent).toBe(1);
    expect(log.denied.rate_limited).toBe(3);
    expect(log.denied.lastAt).toBe(clock);
  });

  it('`clearActivity` xoá nhật ký nhưng KHÔNG mở lại hạn mức', () => {
    grantConsent();
    for (let i = 0; i < BUCKET_CAPACITY; i += 1) checkAndConsume({ chars: 1, providerId: 'deepseek' });
    clearActivity();
    expect(readActivity().calls).toEqual([]);
    expect(checkAndConsume({ chars: 1, providerId: 'deepseek' }).code).toBe('rate_limited');
  });

  it('ô nhớ hỏng không làm kho khoá chết, và cũng không mở toang hạn mức', () => {
    grantConsent();
    localStorage.setItem('tuhoc.vault.guard.log', '{khong-phai-json');
    expect(() => readActivity()).not.toThrow();
    expect(readActivity().calls).toEqual([]);
    for (let i = 0; i < 100; i += 1) checkAndConsume({ chars: 1, providerId: 'deepseek' });
    expect(readActivity().calls.length).toBe(BUCKET_CAPACITY);
  });
});

// ═══════════════════ 4. Giao diện xác nhận ═══════════════════

function panelDeps(over: Partial<Parameters<typeof renderVaultPanel>[1]> = {}) {
  return {
    hasConsent,
    grantConsent,
    readActivity,
    clearActivity,
    ...over,
  };
}

describe('khung xác nhận trong kho khoá', () => {
  it('vẽ một nút bấm khi chưa xác nhận, và nói rõ nó cho phép điều gì', () => {
    const root = document.createElement('div');
    renderVaultPanel(root, panelDeps());
    const btn = root.querySelector('button[data-role="consent"]');
    expect(btn).not.toBeNull();
    expect(btn?.textContent ?? '').not.toBe('');
    // Vẽ ra thôi KHÔNG được cấp quyền — quyền chỉ tới từ cú bấm.
    expect(hasConsent()).toBe(false);
  });

  it('BẪY: cú bấm KHÔNG do người dùng (`isTrusted:false`) không cấp quyền', () => {
    const root = document.createElement('div');
    renderVaultPanel(root, panelDeps());
    const btn = root.querySelector('button[data-role="consent"]') as HTMLButtonElement;
    // `element.click()` trong jsdom (và `dispatchEvent`) sinh sự kiện KHÔNG
    // đáng tin. Ở origin kho khoá không có JS lạ nào chạy được, nên đây là lớp
    // phòng thủ chiều sâu — nhưng Task 6 sắp vẽ form nhập key vào chính origin
    // này, và lúc đó nó không còn là lý thuyết.
    btn.click();
    expect(hasConsent()).toBe(false);
  });

  it('cú bấm thật (`isTrusted:true`) cấp quyền đúng một lần', () => {
    expect(handleConsentClick({ isTrusted: true }, { grantConsent })).toBe(true);
    expect(hasConsent()).toBe(true);
    expect(handleConsentClick({ isTrusted: false }, { grantConsent })).toBe(false);
  });

  it('sau khi xác nhận, khung hiện nhật ký thay cho nút', () => {
    grantConsent();
    clock = 1_700_000_500_000;
    checkAndConsume({ chars: 321, providerId: 'deepseek' });
    const root = document.createElement('div');
    renderVaultPanel(root, panelDeps());
    expect(root.querySelector('button[data-role="consent"]')).toBeNull();
    const text = root.textContent ?? '';
    expect(text).toContain('321');
    expect(text).toContain('deepseek');
  });

  it('BẪY: khung dựng chữ bằng textContent, không nhét HTML từ dữ liệu', () => {
    // S1-F43: một gói hạng `content` "an toàn theo định nghĩa" chạy được mã tuỳ
    // ý qua đúng một `innerHTML`, và bốn cổng đều cho qua. Đây là origin giữ
    // key; một `innerHTML` ở đây đắt hơn nhiều.
    const hostile: Activity = {
      calls: [{ at: clock, chars: 1, providerId: '<img src=x onerror="alert(1)">' }],
      denied: { needs_consent: 0, rate_limited: 0, lastAt: null },
    };
    const root = document.createElement('div');
    renderVaultPanel(root, panelDeps({ hasConsent: () => true, readActivity: () => hostile }));
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent ?? '').toContain('<img');
  });

  it('BẪY: khung không bao giờ vẽ key ra màn hình', () => {
    writeConfig({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: KEY });
    grantConsent();
    checkAndConsume({ chars: 5, providerId: 'deepseek' });
    const root = document.createElement('div');
    renderVaultPanel(root, panelDeps());
    expect((root.textContent ?? '').includes(KEY)).toBe(false);
    expect(root.innerHTML.includes(KEY)).toBe(false);
  });
});

// ═══════════════════ 5. `chat` đi qua người gác ═══════════════════

function okStream(body: string): Response {
  return new Response(enc.encode(body), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function sseBody(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
}

function chatRequest(over: Record<string, unknown> = {}): unknown {
  return {
    v: 1,
    id: 'c1',
    kind: 'chat',
    providerId: 'deepseek',
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: `Giải thích giúp: ${NOTE}` }],
    ...over,
  };
}

function send(data: unknown, reply: (res: unknown, origin: string) => void): void {
  handleMessage(
    { origin: APP, data, source: { postMessage: reply } } as unknown as MessageEvent,
    { allowedOrigin: APP },
  );
}

/** Đợi tới khi đủ `expected` hồi đáp KẾT THÚC (`done` hoặc `error`). */
async function settle(
  reply: { mock: { calls: unknown[][] } },
  expected: number,
): Promise<VaultResponse[]> {
  for (let i = 0; i < 200; i += 1) {
    const rs = reply.mock.calls.map((c) => c[0] as VaultResponse);
    if (rs.filter((r) => r.kind === 'done' || r.kind === 'error').length >= expected) return rs;
    await new Promise((r) => setTimeout(r, 0));
  }
  return reply.mock.calls.map((c) => c[0] as VaultResponse);
}

describe('`chat` chỉ đi ra mạng sau khi qua người gác', () => {
  beforeEach(() => {
    writeConfig({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: KEY });
  });

  it('BẪY TRUNG TÂM: lời gọi ĐẦU PHIÊN trả `needs_consent` và KHÔNG chạm `fetch`', async () => {
    // Đây là bài kiểm mà cả Task 9 xoay quanh. Khác bẫy của Task 3 ở một điểm
    // quyết định: ở ĐÂY key đã được cắm và nhà cung cấp hợp lệ, nên thứ duy
    // nhất còn chặn lời gọi mạng là người gác.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const reply = vi.fn();
    send(chatRequest(), reply);
    const rs = await settle(reply, 1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ kind: 'error', code: 'needs_consent' });
  });

  it('BẪY: lời gọi bị từ chối KHÔNG đọc ô nhớ chứa key', () => {
    // Người gác đứng TRƯỚC kho khoá, không sau. Một course độc spam `chat`
    // không được làm key đi vào bộ nhớ lấy một lần.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const trap = trapStorageReads();
    const reply = vi.fn();
    try {
      send(chatRequest(), reply);
    } finally {
      trap.restore();
    }
    expect(trap.reads.length).toBeGreaterThan(0); // chống bẫy-không-cắm
    expect(trap.reads).not.toContain(SECRET_STORAGE_KEY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sau khi xác nhận: gọi mạng ĐÚNG một lần, chữ chảy về rồi `done`', async () => {
    grantConsent();
    const fetchSpy = vi.fn(async () => okStream(sseBody('Xin chào')));
    vi.stubGlobal('fetch', fetchSpy);
    const reply = vi.fn();
    send(chatRequest(), reply);
    const rs = await settle(reply, 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rs.filter((r) => r.kind === 'chunk').map((r) => (r as { text: string }).text).join('')).toBe(
      'Xin chào',
    );
    expect(rs[rs.length - 1].kind).toBe('done');
  });

  it('BẪY CỦA BRIEF: 100 yêu cầu `chat` ⇒ `fetch` được gọi ĐÚNG BUCKET_CAPACITY lần, không 100', async () => {
    grantConsent();
    const fetchSpy = vi.fn(async () => okStream(sseBody('x')));
    vi.stubGlobal('fetch', fetchSpy);
    const reply = vi.fn();
    for (let i = 0; i < 100; i += 1) send(chatRequest({ id: `c${i}` }), reply);
    const rs = await settle(reply, 100);
    // Đếm LỜI GỌI MẠNG THẬT, không đếm số hồi đáp `rate_limited` — một cài đặt
    // trả `rate_limited` sau khi đã gọi mạng vẫn đốt tiền người dùng đủ 100 lần.
    expect(fetchSpy).toHaveBeenCalledTimes(BUCKET_CAPACITY);
    expect(fetchSpy.mock.calls.length).toBeLessThan(100);
    expect(rs.filter((r) => r.kind === 'error' && r.code === 'rate_limited')).toHaveLength(
      100 - BUCKET_CAPACITY,
    );
    expect(readActivity().calls).toHaveLength(BUCKET_CAPACITY);
  });

  it('nhật ký ghi SỐ KÝ TỰ đã gửi, và số ấy đúng bằng tổng độ dài nội dung', async () => {
    grantConsent();
    vi.stubGlobal('fetch', vi.fn(async () => okStream(sseBody('x'))));
    const reply = vi.fn();
    const messages = [
      { role: 'system', content: 'bối cảnh chương' },
      { role: 'user', content: `hỏi về ${NOTE}` },
    ];
    send(chatRequest({ messages }), reply);
    await settle(reply, 1);
    const expected = messages.reduce((n, m) => n + m.content.length, 0);
    expect(readActivity().calls[0].chars).toBe(expected);
  });

  it('chưa cắm key ⇒ `not_configured`, không gọi mạng, dù đã xác nhận', async () => {
    localStorage.clear();
    grantConsent();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const reply = vi.fn();
    send(chatRequest(), reply);
    const rs = await settle(reply, 1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rs[0]).toMatchObject({ kind: 'error', code: 'not_configured' });
  });

  it('nhà cung cấp lạ ⇒ `unsupported_provider`, không gọi mạng, không tiêu token', async () => {
    grantConsent();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const reply = vi.fn();
    send(chatRequest({ providerId: 'khong-co-that' }), reply);
    const rs = await settle(reply, 1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rs[0]).toMatchObject({ kind: 'error', code: 'unsupported_provider' });
    expect(readActivity().calls).toEqual([]);
    expect(readActivity().denied.rate_limited).toBe(0);
  });

  it('yêu cầu `chat` méo mó không NÉM, không gọi mạng', async () => {
    grantConsent();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const reply = vi.fn();
    for (const bad of [
      chatRequest({ messages: 'khong-phai-mang' }),
      chatRequest({ messages: [{ role: 'user' }] }),
      chatRequest({ messages: [{ role: 'user', content: 42 }] }),
      chatRequest({ model: null }),
      chatRequest({ providerId: 123 }),
    ]) {
      expect(() => send(bad, reply)).not.toThrow();
    }
    await settle(reply, 5);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('BẪY: hồi đáp lỗi của nhà cung cấp KHÔNG mang key về trang chính', async () => {
    grantConsent();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: `Incorrect API key provided: ${KEY}` }), {
            status: 401,
            headers: { 'x-echo': `Bearer ${KEY}` },
          }),
      ),
    );
    const reply = vi.fn();
    send(chatRequest(), reply);
    const rs = await settle(reply, 1);
    expect(rs[0]).toMatchObject({ kind: 'error', code: 'bad_key' });
    expect(allStrings(reply.mock.calls).some((s) => s.includes(KEY))).toBe(false);
  });

  it('báo cho khung vẽ lại sau MỌI quyết định của người gác — cả cho qua lẫn từ chối', async () => {
    // Một nhật ký chỉ vẽ lúc nạp trang là nhật ký đứng yên đúng lúc đáng nhìn
    // nhất: lúc có thứ gì đó đang gọi liên tục.
    const onActivity = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => okStream(sseBody('a'))));
    const reply = vi.fn();
    handleMessage(
      { origin: APP, data: chatRequest(), source: { postMessage: reply } } as unknown as MessageEvent,
      { allowedOrigin: APP, onActivity },
    );
    await settle(reply, 1);
    expect(onActivity).toHaveBeenCalledTimes(1); // lời gọi này bị từ chối: chưa xác nhận
    grantConsent();
    handleMessage(
      { origin: APP, data: chatRequest({ id: 'c2' }), source: { postMessage: reply } } as unknown as MessageEvent,
      { allowedOrigin: APP, onActivity },
    );
    await settle(reply, 2);
    expect(onActivity).toHaveBeenCalledTimes(2);
  });

  it('mọi hồi đáp đi kèm targetOrigin tường minh, không bao giờ "*"', async () => {
    grantConsent();
    vi.stubGlobal('fetch', vi.fn(async () => okStream(sseBody('a'))));
    const reply = vi.fn();
    send(chatRequest(), reply);
    await settle(reply, 1);
    expect(reply.mock.calls.length).toBeGreaterThan(0);
    for (const call of reply.mock.calls) expect(call[1]).toBe(APP);
  });
});

// ═══════════════════ 6. Không thông điệp nào cấp được quyền ═══════════════════

describe('BẪY: KHÔNG thông điệp nào từ trang chính cấp được xác nhận', () => {
  it('không `kind` nào — thật hay bịa — làm `hasConsent()` thành true', () => {
    // Đây là toàn bộ giá trị của "cú bấm xảy ra ở origin kho khoá". Nếu một
    // thông điệp `postMessage` cấp được quyền thì JS trang chính giả được nó,
    // và người gác này thành trang trí.
    const hostile: unknown[] = [
      { v: 1, id: 'a', kind: 'consent' },
      { v: 1, id: 'a', kind: 'grantConsent' },
      { v: 1, id: 'a', kind: 'status', consent: true },
      { v: 1, id: 'a', kind: 'listProviders', grantConsent: true },
      { v: 1, id: 'a', kind: 'chat', providerId: 'deepseek', model: 'm', messages: [], consent: true },
      { v: 1, id: 'a', kind: '__proto__' },
      { v: 1, id: 'a', kind: 'chat', providerId: 'deepseek', model: 'm', messages: [] },
    ];
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const reply = vi.fn();
    for (const h of hostile) send(h, reply);
    expect(hasConsent()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
