import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUCKET_CAPACITY,
  BUCKET_REFILL_MS,
  MAX_LOG_ENTRIES,
  SESSION_CHAR_BUDGET,
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

// ═══════════════ 7. Ngân sách KÝ TỰ mỗi phiên (Task 9b) ═══════════════

/**
 * **Vì sao có mục này.** Người dựng Task 9 tự đo và tự kết luận rằng người gác
 * của họ **không chạm được nửa nghiêm trọng hơn của HC-3**. Nguyên văn báo cáo
 * của họ: *"đốt tiền thì đã đắt; tuồn ghi chú thì chưa"*.
 *
 * Lý do rất cụ thể và không tranh cãi được: token bucket đếm **SỐ LẦN GỌI**
 * (8 liên tiếp, 1 token/6 s), **không đếm SỐ KÝ TỰ**. Trong đúng hạn ngạch ấy,
 * một course độc vẫn gửi được **~10 lời nhắc DÀI TUỲ Ý mỗi phút** — tức là toàn
 * bộ ghi chú riêng tư của người học có thể đi hết trong vài phút mà **không lời
 * gọi nào bị từ chối**. Cú bấm xác nhận không cứu được: nó là **một cú bấm cho
 * cả phiên**, và người dùng sẽ bấm, vì họ muốn dùng AI.
 *
 * Vì vậy: kho khoá đếm **tổng số ký tự đã gửi** trong phiên, và vượt ngưỡng thì
 * **đòi bấm xác nhận lại** — không chặn vĩnh viễn, vì người dùng thật vẫn phải
 * dùng được.
 *
 * ─────────────────────── ĐO CÁI GÌ, VÀ ĐO THẾ NÀO ───────────────────────
 *
 * **Đếm lời gọi `fetch` THẬT, và đếm số ký tự TRÊN DÂY — không đếm hồi đáp.**
 * Task 9 đã chứng minh vì sao bằng một phép đo: mutant *"gọi mạng rồi mới trả
 * `rate_limited`"* cho **hồi đáp y hệt** (92 × `rate_limited`) trong khi số lời
 * gọi `fetch` nhảy từ 8 lên **100**. Một bài kiểm đếm hồi đáp sẽ xanh trọn vẹn
 * trong khi người dùng bị đốt tiền đủ 100 lần. Cùng lập luận áp cho ký tự: thứ
 * duy nhất đáng đếm là **số ký tự đã rời khỏi máy**, nên `charsOnTheWire()` đọc
 * thẳng **thân yêu cầu `fetch`**, không đọc nhật ký và không đọc hồi đáp.
 */

// ───────── phép đo trên GÓI MẪU THẬT, không phải phán đoán ─────────

/**
 * Đo ngày **2026-08-22** trên `fixtures/courses/`, bằng parse5, lấy phần **văn
 * bản** (bỏ `<script>`/`<style>`, gộp khoảng trắng) — tức đúng thứ người đọc
 * nhìn thấy và đúng thứ Task 7 sẽ nhét vào lời nhắc:
 *
 * ```
 * so-dau-phay-dong   8 chương   dài nhất 19.343   trung bình 14.734   cả gói 117.872
 * bat-bien-vong-lap  3 chương   dài nhất 12.814   trung bình 12.561   cả gói  37.684
 * ```
 *
 * **Hai con số dưới đây là ẢNH CHỤP, không phải phép đo chạy lại mỗi lần test.**
 * `apps/vault/tsconfig.json` cố ý không có `types: ["node"]`, nên tệp này không
 * đọc được `fixtures/` lúc chạy mà không kéo theo một thay đổi cấu hình build.
 * Lệnh đã sinh ra chúng nằm trong `task-9b-report.md §2`; nếu gói mẫu đổi, phải
 * chạy lại lệnh ấy và sửa ở đây.
 */
const LONGEST_REAL_CHAPTER = 19_343;
const WHOLE_SAMPLE_COURSE = 117_872;

/**
 * Lời nhắc DÀI NHẤT mà ứng dụng thật sự gửi, sau khi Task 7 cắt bớt ngữ cảnh
 * chương (`CHAPTER_CONTEXT_LIMIT = 8_000`). Đo bằng KaTeX thật trên chương thật,
 * qua chính bộ dựng lời nhắc: **7.996** — và **11/11 chương đều bị cắt**.
 *
 * Vì sao con số này phải có mặt: trước khi Task 7 tồn tại, các khẳng định dưới
 * đây neo vào `LONGEST_REAL_CHAPTER`, tức vào một lời nhắc **không bao giờ xảy
 * ra nữa**. Chúng vẫn xanh — nhưng xanh vì lý do sai, đúng bài học đã ghi ở
 * S2 Task 9: *một dây bẫy còn xanh không có nghĩa nó còn đo đúng thứ nó từng đo.*
 *
 * Ảnh chụp, không phải phép đo lúc chạy (cùng lý do với hai hằng trên). Lệnh
 * sinh ra nó ở `task-7-8-report.md`.
 */
const LONGEST_REAL_PROMPT = 7_996;

/** Số lời gọi mà ngân sách cho phép khi mỗi lời nhắc dài bằng **chương dài nhất
 *  thật**. Tính từ hằng số chứ không viết tay, để đổi ngưỡng thì bài kiểm đi
 *  theo thay vì đỏ oan. */
const CALLS_PER_BUDGET = Math.floor(SESSION_CHAR_BUDGET / LONGEST_REAL_PROMPT);

/** Một lời nhắc dài đúng bằng lời nhắc DÀI NHẤT ứng dụng thật sự gửi, **mang
 *  ghi chú riêng tư ở đầu** — để bẫy `NOTE` trong `afterEach` vẫn đo đúng thứ
 *  nó đo.
 *
 *  Trước đây hằng này dài bằng **chương thô** (19.343). Đó là cỡ lời nhắc
 *  không còn tồn tại sau khi Task 7 cắt ngữ cảnh, nên bẫy vẫn xanh nhưng đang
 *  đo một tình huống không xảy ra. */
const CHAPTER_PROMPT = NOTE + 'x'.repeat(LONGEST_REAL_PROMPT - NOTE.length);

/**
 * Tổng số ký tự nội dung **đã thật sự rời khỏi máy**, đọc từ thân yêu cầu
 * `fetch`. Đây là con số duy nhất trả lời được câu hỏi của HC-3 (*"bao nhiêu
 * ghi chú của tôi đã đi ra ngoài?"*) — nhật ký và hồi đáp đều không trả lời được.
 */
function charsOnTheWire(spy: { mock: { calls: unknown[][] } }): number {
  let n = 0;
  for (const call of spy.mock.calls) {
    const init = call[1] as { body?: unknown } | undefined;
    if (typeof init?.body !== 'string') continue;
    const parsed = JSON.parse(init.body) as { messages?: Array<{ content?: unknown }> };
    for (const m of parsed.messages ?? []) {
      if (typeof m.content === 'string') n += m.content.length;
    }
  }
  return n;
}

describe('ngân sách KÝ TỰ mỗi phiên — nửa NGHIÊM TRỌNG của HC-3', () => {
  it('ngưỡng đến từ PHÉP ĐO trên gói mẫu thật, không phải một con số nghĩ ra', () => {
    // Sàn: một lời nhắc dài bằng CHƯƠNG DÀI NHẤT THẬT phải đi lọt nhiều lần
    // trước khi phải bấm lại. Ngân sách chỉ đủ một hai chương là một con dấu
    // cao su — người dùng bấm liên tục và thôi đọc thứ mình đang bấm.
    // Neo vào lời nhắc THẬT, không vào chương thô: chương là nguyên liệu, lời
    // nhắc mới là thứ rời khỏi máy. Sàn cũ (4 × chương = 77.372) mô tả một cỡ
    // lời nhắc không còn tồn tại.
    expect(SESSION_CHAR_BUDGET).toBeGreaterThanOrEqual(4 * LONGEST_REAL_PROMPT);
    // Trần: MỘT cú bấm không được mua quá nhiều. Mốc là **cả gói mẫu**: một lần
    // xác nhận không được đáng giá hơn "đọc trọn giáo trình ra ngoài" mấy lần.
    expect(SESSION_CHAR_BUDGET).toBeLessThanOrEqual(2 * WHOLE_SAMPLE_COURSE);
    // Và ngưỡng phải LỚN HƠN một lời nhắc thật dài nhất — nếu không thì lời gọi
    // hợp lệ đầu tiên đã bị chặn và tính năng chết ngay khi bật.
    expect(SESSION_CHAR_BUDGET).toBeGreaterThan(LONGEST_REAL_PROMPT);
    // Và lời nhắc thật PHẢI nhỏ hơn chương thô — nếu không, nhánh cắt bớt của
    // Task 7 không bao giờ chạy và con số trên là ảo.
    expect(LONGEST_REAL_PROMPT).toBeLessThan(LONGEST_REAL_CHAPTER);
    expect(CALLS_PER_BUDGET).toBeGreaterThanOrEqual(4);
  });

  it('một lời nhắc dài bằng CHƯƠNG DÀI NHẤT THẬT vẫn đi được — người thật không bị chặn', () => {
    grantConsent();
    const d = checkAndConsume({ chars: LONGEST_REAL_PROMPT, providerId: 'deepseek' });
    expect(d.allow).toBe(true);
    expect(readActivity().calls[0].chars).toBe(LONGEST_REAL_PROMPT);
  });

  it('BẪY TRUNG TÂM CỦA TASK NÀY: trong hạn ngạch LỜI GỌI, tổng KÝ TỰ vẫn bị chặn', () => {
    // Đồng hồ được đẩy đủ xa giữa mỗi lời gọi để token bucket **luôn đầy** —
    // nghĩa là bucket KHÔNG từ chối lấy một lời gọi nào. Thứ duy nhất còn chặn
    // được là ngân sách ký tự. Gỡ ngân sách ra thì cả 40 lời gọi đều đi lọt.
    grantConsent();
    let allowed = 0;
    let sent = 0;
    for (let i = 0; i < 40; i += 1) {
      clock += BUCKET_REFILL_MS * BUCKET_CAPACITY; // bucket đầy lại hoàn toàn
      const d = checkAndConsume({ chars: LONGEST_REAL_PROMPT, providerId: 'deepseek' });
      if (d.allow) {
        allowed += 1;
        sent += LONGEST_REAL_PROMPT;
      }
    }
    expect(allowed).toBe(CALLS_PER_BUDGET);
    expect(allowed).toBeLessThan(40);
    expect(sent).toBeLessThanOrEqual(SESSION_CHAR_BUDGET);
  });

  it('vượt ngân sách ⇒ ĐÒI XÁC NHẬN LẠI (`needs_consent`), không phải chặn vĩnh viễn', () => {
    grantConsent();
    for (let i = 0; i < CALLS_PER_BUDGET; i += 1) {
      clock += BUCKET_REFILL_MS * BUCKET_CAPACITY;
      expect(checkAndConsume({ chars: LONGEST_REAL_PROMPT, providerId: 'deepseek' }).allow).toBe(true);
    }
    clock += BUCKET_REFILL_MS * BUCKET_CAPACITY;
    const d = checkAndConsume({ chars: LONGEST_REAL_PROMPT, providerId: 'deepseek' });
    expect(d.allow).toBe(false);
    expect(d.code).toBe('needs_consent');
    // Xác nhận đã bị RÚT: khung sẽ vẽ lại cái nút, nên người dùng có chỗ bấm.
    // Không có phần này thì `needs_consent` là một ngõ cụt.
    expect(hasConsent()).toBe(false);

    // Và người dùng THẬT phải dùng tiếp được sau khi bấm.
    grantConsent();
    clock += BUCKET_REFILL_MS * BUCKET_CAPACITY;
    expect(checkAndConsume({ chars: LONGEST_REAL_PROMPT, providerId: 'deepseek' }).allow).toBe(true);
  });

  it('BẪY: bấm xác nhận LẠI làm mới ngân sách ký tự nhưng KHÔNG mở lại token bucket', () => {
    // Nếu cú bấm cũng nạp đầy bucket thì nút "Cho phép" thành nút "Bỏ giới hạn
    // tần suất" — cùng hình dạng với cái bẫy `clearActivity` của Task 9.
    grantConsent();
    for (let i = 0; i < BUCKET_CAPACITY; i += 1) checkAndConsume({ chars: 1, providerId: 'deepseek' });
    expect(checkAndConsume({ chars: 1, providerId: 'deepseek' }).code).toBe('rate_limited');
    grantConsent();
    expect(checkAndConsume({ chars: 1, providerId: 'deepseek' }).code).toBe('rate_limited');
  });

  it('BẪY: ngân sách sống trong Ô NHỚ, nên NẠP LẠI KHUNG không cấp ngân sách mới', async () => {
    // Cùng lỗ hổng mà Task 9 đã tìm ra cho bucket, theo đúng đường đó: trang
    // chính điều khiển `iframe.src`, nên một biến trong module đầy lại sau mỗi
    // lần nạp khung — trong khi xác nhận thì vẫn còn. Một ngân sách trong bộ
    // nhớ là **không có ngân sách gì cả**.
    grantConsent();
    for (let i = 0; i < CALLS_PER_BUDGET; i += 1) {
      clock += BUCKET_REFILL_MS * BUCKET_CAPACITY;
      checkAndConsume({ chars: LONGEST_REAL_PROMPT, providerId: 'deepseek' });
    }
    vi.resetModules();
    const fresh = (await import('./guard')) as typeof import('./guard');
    clock += BUCKET_REFILL_MS * BUCKET_CAPACITY;
    const d = fresh.checkAndConsume({ chars: LONGEST_REAL_PROMPT, providerId: 'deepseek' });
    expect(d.allow).toBe(false);
    expect(d.code).toBe('needs_consent');
  });

  it('FAIL CLOSED: không ghi được ngân sách ⇒ TỪ CHỐI, không phải cho qua', () => {
    grantConsent();
    const orig = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      k: string,
      v: string,
    ) {
      if (k.includes('consent')) throw new DOMException('QuotaExceededError');
      return orig.call(this, k, v);
    });
    // Không cộng được số ký tự vừa gửi nghĩa là không đếm được nữa; cho qua
    // trong tình huống đó là bỏ hẳn ngân sách. Cùng chính sách với bucket.
    expect(checkAndConsume({ chars: 10, providerId: 'deepseek' }).allow).toBe(false);
  });

  it('lời gọi BỊ TỪ CHỐI không tiêu ngân sách ký tự', () => {
    // Chưa xác nhận: 50 lời gọi khổng lồ bị chặn. Nếu chúng vẫn bị tính vào
    // ngân sách thì một course độc chỉ cần spam TRƯỚC cú bấm là ngân sách của
    // người dùng đã cạn trước lời gọi thật đầu tiên.
    for (let i = 0; i < 50; i += 1) {
      checkAndConsume({ chars: LONGEST_REAL_PROMPT, providerId: 'deepseek' });
    }
    grantConsent();
    let allowed = 0;
    for (let i = 0; i < 40; i += 1) {
      clock += BUCKET_REFILL_MS * BUCKET_CAPACITY;
      if (checkAndConsume({ chars: LONGEST_REAL_PROMPT, providerId: 'deepseek' }).allow) allowed += 1;
    }
    expect(allowed).toBe(CALLS_PER_BUDGET);
  });

  it('một lời nhắc MỘT MÌNH vượt cả ngân sách bị chặn — và KHÔNG làm mất xác nhận', () => {
    // Chống KẸT CHẾT: nếu lời nhắc khổng lồ cũng rút xác nhận thì người dùng
    // bấm lại, gửi lại, bị chặn lại — bấm mãi không thoát. Ở đây phiên vẫn sống
    // và các lời gọi bình thường vẫn đi được.
    grantConsent();
    const d = checkAndConsume({ chars: SESSION_CHAR_BUDGET + 1, providerId: 'deepseek' });
    expect(d.allow).toBe(false);
    expect(hasConsent()).toBe(true);
    expect(checkAndConsume({ chars: 10, providerId: 'deepseek' }).allow).toBe(true);
  });

  it('số ký tự KHÔNG ĐO ĐƯỢC (NaN, âm, Infinity) ⇒ TỪ CHỐI, không phải coi như 0', () => {
    // `NaN + x > NGƯỠNG` là `false`, nên coi một số vô lý là 0 sẽ mở một đường
    // đi vòng qua ngân sách. Kho khoá không cho đi ra thứ nó không đo được.
    grantConsent();
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(checkAndConsume({ chars: bad, providerId: 'deepseek' }).allow).toBe(false);
    }
    expect(readActivity().calls).toEqual([]);
  });

  it('ngân sách nằm ở sessionStorage cùng bản ghi xác nhận — hết phiên là hết', () => {
    grantConsent();
    checkAndConsume({ chars: 4242, providerId: 'deepseek' });
    let inLocal = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      if ((localStorage.key(i) ?? '').includes('consent')) inLocal += 1;
    }
    expect(inLocal).toBe(0);
    // Số đã tiêu phải thật sự nằm trong ô nhớ, không nằm trong một biến.
    expect(sessionStorage.getItem('tuhoc.vault.guard.consent') ?? '').toContain('4242');
  });

  it('FAIL CLOSED: bản ghi xác nhận KHÔNG đọc được số đã tiêu ⇒ đòi bấm lại', () => {
    // Hình dạng thật của tình huống này: một tab đang mở qua một lần deploy,
    // giữ lại bản ghi `{at}` của bản cũ (chưa có trường `chars`). Coi nó là
    // "đã tiêu 0" là cấp một ngân sách mới miễn phí. Đọc không ra ⇒ bấm lại.
    sessionStorage.setItem('tuhoc.vault.guard.consent', JSON.stringify({ at: clock }));
    const d = checkAndConsume({ chars: 10, providerId: 'deepseek' });
    expect(d.allow).toBe(false);
    expect(d.code).toBe('needs_consent');
    expect(hasConsent()).toBe(false);
  });

  it('ô nhớ xác nhận HỎNG HẲN (không phải JSON) cũng đòi bấm lại, và không ném', () => {
    sessionStorage.setItem('tuhoc.vault.guard.consent', '{khong-phai-json');
    expect(() => checkAndConsume({ chars: 10, providerId: 'deepseek' })).not.toThrow();
    expect(checkAndConsume({ chars: 10, providerId: 'deepseek' }).allow).toBe(false);
  });
});

describe('ngân sách ký tự, đo TRÊN DÂY qua đường `chat` thật', () => {
  beforeEach(() => {
    writeConfig({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: KEY });
  });

  it('BẪY CỦA BRIEF: 40 lời nhắc dài, bucket LUÔN ĐẦY ⇒ `fetch` chỉ chạy đúng số lần ngân sách cho', async () => {
    // Đây là bài kiểm mà cả task này xoay quanh, và nó cố ý dựng đúng tình
    // huống mà Task 9 **không** chặn được: token bucket không từ chối lấy một
    // lời gọi nào (đồng hồ được đẩy đủ xa), key đã cắm, nhà cung cấp hợp lệ,
    // xác nhận đã bấm. Task 9 nguyên bản cho cả 40 lời nhắc đi ra.
    grantConsent();
    const fetchSpy = vi.fn(async () => okStream(sseBody('x')));
    vi.stubGlobal('fetch', fetchSpy);
    const reply = vi.fn();
    for (let i = 0; i < 40; i += 1) {
      clock += BUCKET_REFILL_MS * BUCKET_CAPACITY;
      send(chatRequest({ id: `b${i}`, messages: [{ role: 'user', content: CHAPTER_PROMPT }] }), reply);
    }
    await settle(reply, 40);

    // ĐẾM LỜI GỌI MẠNG THẬT — không đếm hồi đáp. Task 9 đã đo được rằng một
    // cài đặt gọi mạng rồi mới từ chối cho hồi đáp y hệt.
    expect(fetchSpy).toHaveBeenCalledTimes(CALLS_PER_BUDGET);
    expect(fetchSpy.mock.calls.length).toBeLessThan(40);
    // Và đếm SỐ KÝ TỰ ĐÃ RỜI KHỎI MÁY, đọc từ thân yêu cầu.
    expect(charsOnTheWire(fetchSpy)).toBeLessThanOrEqual(SESSION_CHAR_BUDGET);
  });

  it('ngưỡng MỚI không che mất giới hạn tần suất cũ: lời nhắc NGẮN vẫn dừng ở BUCKET_CAPACITY', async () => {
    // Bài học Task 9: *một dây bẫy còn xanh không có nghĩa nó còn đo đúng thứ
    // nó từng đo.* Chiều ngược lại cũng phải giữ — ngân sách ký tự không được
    // trở thành thứ DUY NHẤT còn chặn. Với lời nhắc ngắn, ngân sách còn xa mới
    // chạm, nên thứ chặn phải vẫn là token bucket.
    grantConsent();
    const fetchSpy = vi.fn(async () => okStream(sseBody('x')));
    vi.stubGlobal('fetch', fetchSpy);
    const reply = vi.fn();
    for (let i = 0; i < 100; i += 1) send(chatRequest({ id: `s${i}` }), reply);
    await settle(reply, 100);
    expect(fetchSpy).toHaveBeenCalledTimes(BUCKET_CAPACITY);
    expect(charsOnTheWire(fetchSpy)).toBeLessThan(SESSION_CHAR_BUDGET);
    expect(hasConsent()).toBe(true); // ngân sách chưa hề bị chạm tới
  });
});
