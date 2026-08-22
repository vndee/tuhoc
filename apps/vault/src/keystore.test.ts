import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readConfig, readPublicConfig, writeConfig, clearConfig } from './keystore';
import { handleMessage } from './main';

const KEY = 'sk-test-KHOA-BI-MAT-KHONG-DUOC-RO';
const APP = 'http://localhost:5173';

/** Tên hai ô nhớ, viết THẲNG ở đây chứ không nhập từ `keystore.ts`. Cố ý: nếu ai
 *  đó đổi tên ô nhớ chứa key, bẫy ở dưới phải ĐỎ để người sửa nhìn lại nó — một
 *  hằng số nhập vào sẽ lặng lẽ đi theo và bẫy mất tác dụng mà không ai biết. */
const PUBLIC_STORAGE_KEY = 'tuhoc.vault.config';
const SECRET_STORAGE_KEY = 'tuhoc.vault.key';

/** Bản gốc, chộp TRƯỚC mọi lần `vi.spyOn` để bẫy còn gọi lại được thứ thật. */
const nativeGetItem = Storage.prototype.getItem;

function statusEvent(origin: string, reply: (...a: unknown[]) => void): MessageEvent {
  return {
    origin,
    data: { v: 1, id: 'x', kind: 'status' },
    source: { postMessage: reply },
  } as unknown as MessageEvent;
}

/** Thu MỌI chuỗi trong đồ thị giá trị — kể cả khoá của object, phần tử Map/Set,
 *  và giá trị sau getter.
 *
 *  Vì sao không chỉ `JSON.stringify`: `postMessage` thật không dùng JSON, nó
 *  dùng *structured clone*. Hai phép này KHÁC nhau ở đúng những chỗ một kẻ rò
 *  key có thể nấp:
 *    · `JSON.stringify` gọi `toJSON()` của object — một `toJSON` che bớt trường
 *      sẽ làm phép kiểm xanh trong khi structured clone vẫn gửi đủ;
 *    · `JSON.stringify(new Map([['apiKey', KEY]]))` ra `"{}"`, còn structured
 *      clone giữ nguyên cả Map.
 *  Nên phép kiểm dựa vào JSON là một phép kiểm ĐỐI VỚI MỘT MÔ HÌNH SAI của kênh
 *  truyền. Đi bộ qua đồ thị thật thì không có chỗ nấp đó. */
function allStrings(x: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof x === 'string') {
    out.push(x);
    return out;
  }
  if (typeof x !== 'object' || x === null) return out;
  if (seen.has(x)) return out;
  seen.add(x);

  if (x instanceof Map) {
    for (const [k, v] of x) {
      allStrings(k, out, seen);
      allStrings(v, out, seen);
    }
    return out;
  }
  if (x instanceof Set) {
    for (const v of x) allStrings(v, out, seen);
    return out;
  }
  if (Array.isArray(x)) {
    for (const v of x) allStrings(v, out, seen);
    return out;
  }
  for (const k of Object.getOwnPropertyNames(x)) {
    out.push(k); // tên trường cũng là một kênh: `{ [KEY]: true }` rò key qua khoá
    allStrings((x as Record<string, unknown>)[k], out, seen);
  }
  return out;
}

/** Bẫy kênh nhật ký. Global Constraints: key "không vào log", kể cả log lỗi.
 *  Kế hoạch không có một bài kiểm nào cho điều này. */
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

function trapConsole(): { seen: unknown[]; restore: () => void } {
  const seen: unknown[] = [];
  const spies = CONSOLE_METHODS.map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      seen.push(...args);
    }),
  );
  return {
    seen,
    restore: () => {
      for (const s of spies) s.mockRestore();
    },
  };
}

/** Bẫy kênh đọc ô nhớ: ghi lại TÊN mọi ô nhớ được đọc, rồi trả lại giá trị thật.
 *  Đây là bẫy trung tâm của task này — xem chú thích ở bài kiểm dùng nó. */
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

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('môi trường test', () => {
  it('có localStorage THẬT của jsdom, không phải một bản giả', () => {
    // Chốt chống cổng mù, và nó KHÔNG thừa: trước khi có `src/test-setup.ts`,
    // `localStorage` ở đây là một `{}` rỗng (Node 25 chiếm chỗ global, vitest
    // không ghi đè — phép đo ở đầu tệp đó). Mọi bài kiểm dưới đây đổ vì
    // `localStorage.clear is not a function`.
    //
    // `instanceof Storage` là phần quan trọng nhất của chốt này: bẫy trung tâm
    // của task cắm vào `Storage.prototype.getItem`, nên nếu `localStorage`
    // không phải thể hiện của CHÍNH lớp `Storage` đang thấy ở đây thì bẫy im
    // lặng không chặn gì.
    expect(localStorage).toBeInstanceOf(Storage);
    expect(Object.getPrototypeOf(localStorage)).toBe(Storage.prototype);
    localStorage.setItem('chốt', 'giá trị');
    expect(localStorage.getItem('chốt')).toBe('giá trị');
    expect(localStorage.length).toBe(1);
    localStorage.clear();
    expect(localStorage.length).toBe(0);
  });
});

describe('kho khoá — đọc/ghi', () => {
  it('ghi rồi đọc lại được', () => {
    writeConfig({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: KEY });
    expect(readConfig()?.apiKey).toBe(KEY);
  });

  it('readPublicConfig trả về ĐÚNG hai trường và không có key', () => {
    writeConfig({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: KEY });
    const pub = readPublicConfig();
    // Liệt kê tên trường chứ không đếm — cùng lý do `local.test.ts:206` liệt kê
    // tên năm bảng thay vì `toHaveLength(5)`: thêm một trường phải là một hành
    // động CÓ Ý THỨC, không lọt được bằng cách sửa một con số.
    expect(Object.keys(pub ?? {}).sort()).toEqual(['model', 'providerId']);
    expect(allStrings(pub).some((s) => s.includes(KEY))).toBe(false);
  });

  it('clearConfig xoá hẳn, không để lại dấu vết trong localStorage', () => {
    writeConfig({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: KEY });
    clearConfig();
    expect(readConfig()).toBeNull();
    expect(readPublicConfig()).toBeNull();
    const all = Object.keys(localStorage)
      .map((k) => localStorage.getItem(k))
      .join('|');
    expect(all).not.toContain(KEY);
    expect(localStorage.length).toBe(0);
  });

  it('nửa cấu hình KHÔNG được tính là đã cấu hình', () => {
    // Hai ô nhớ thì có trạng thái lệch nhau — đó là cái giá của phép tách. Nếu
    // ô key mất mà ô công khai còn, kho khoá phải nói "chưa cấu hình" chứ không
    // được nói "đã cấu hình" rồi hỏng lúc gọi mạng.
    writeConfig({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: KEY });
    localStorage.removeItem(SECRET_STORAGE_KEY);
    expect(readConfig()).toBeNull();
    expect(readPublicConfig()).toBeNull();
  });

  it('writeConfig từ chối key rỗng thay vì ghi một cấu hình không dùng được', () => {
    expect(() => writeConfig({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: '' }))
      .toThrow();
    expect(localStorage.length).toBe(0);
  });

  it('JSON hỏng ⇒ coi như chưa cấu hình, và KHÔNG ghi nội dung thô ra log', () => {
    localStorage.setItem(SECRET_STORAGE_KEY, KEY);
    localStorage.setItem(PUBLIC_STORAGE_KEY, '{ hỏng');
    const log = trapConsole();
    try {
      expect(readConfig()).toBeNull();
      expect(readPublicConfig()).toBeNull();
    } finally {
      log.restore();
    }
    // Đường xử lý lỗi là chỗ dễ lỡ tay `console.warn('cấu hình hỏng', raw)` nhất,
    // và `raw` là chuỗi có chứa key khi hai ô nhớ chưa tách.
    expect(allStrings(log.seen).some((s) => s.includes(KEY))).toBe(false);
  });
});

describe('hồi đáp status', () => {
  it('KHÔNG chứa key ở bất kỳ đâu', () => {
    writeConfig({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: KEY });
    const reply = vi.fn();
    handleMessage(statusEvent(APP, reply), { allowedOrigin: APP });

    // Chống xanh-rỗng: một `handleMessage` không gửi gì cũng đi qua mọi khẳng
    // định phủ định bên dưới.
    expect(reply).toHaveBeenCalledOnce();

    // Serialize TOÀN BỘ hồi đáp rồi tìm key — mạnh hơn kiểm từng trường, vì nó
    // bắt được cả trường hợp key lọt vào một trường mà test chưa nghĩ tới.
    const dumped = JSON.stringify(reply.mock.calls);
    expect(dumped).not.toContain(KEY);
    expect(dumped).toContain('"configured":true');
    // ...và lần nữa qua đồ thị thật, vì `postMessage` không dùng JSON (xem
    // chú thích của `allStrings`).
    expect(allStrings(reply.mock.calls).some((s) => s.includes(KEY))).toBe(false);
    // `targetOrigin` tường minh, không `'*'` — bất biến của Task 1, kiểm lại ở
    // đường mới vì đây là lời gọi `send` mới mà Task 1 chưa với tới.
    expect(reply.mock.calls[0]?.[1]).toBe(APP);
  });

  it('nói configured:false khi CHƯA cấu hình', () => {
    // Kế hoạch chỉ kiểm ca "đã cấu hình". Một cài đặt viết cứng
    // `configured: true` đi qua cả ba bài kiểm của kế hoạch — `configured`
    // chưa từng được chứng minh là DẪN XUẤT từ trạng thái.
    const reply = vi.fn();
    handleMessage(statusEvent(APP, reply), { allowedOrigin: APP });
    expect(reply).toHaveBeenCalledOnce();
    const dumped = JSON.stringify(reply.mock.calls);
    expect(dumped).toContain('"configured":false');
    expect(dumped).not.toContain('deepseek');
  });

  it('BẪY: đường status KHÔNG ĐỌC ô nhớ chứa key', () => {
    // Đây là bài kiểm quan trọng nhất của task, và nó là một BẪY chứ không phải
    // một khẳng định về hồi đáp.
    //
    // Lý do: "hồi đáp không chứa key" là một tính chất của MỘT dòng mã. Nếu
    // đường `status` vẫn nạp key vào bộ nhớ rồi vứt đi, thì key chỉ TÌNH CỜ
    // không lọt ra, và một lần sửa vô ý sau này — đổi ba trường viết tay thành
    // một dấu `...cfg` — làm nó lọt ngay. Cùng bài học Task 1 rút ra ở phép
    // kiểm origin: "không trả lời" ≠ "không gây ảnh hưởng".
    //
    // Bẫy này khoá tính chất mạnh hơn: key không bao giờ ĐI VÀO đường `status`.
    // `status` là đường trang chính gọi được tự do, không giới hạn tần suất,
    // không cần xác nhận — nó không có việc gì với key.
    writeConfig({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: KEY });

    const trap = trapStorageReads();
    const reply = vi.fn();
    try {
      handleMessage(statusEvent(APP, reply), { allowedOrigin: APP });
    } finally {
      trap.restore();
    }

    expect(reply).toHaveBeenCalledOnce();
    // Chống bẫy-không-cắm: nếu `vi.spyOn` không chặn được đường đọc thật thì
    // `reads` rỗng và khẳng định phủ định bên dưới xanh mà chưa đo gì.
    expect(trap.reads).toContain(PUBLIC_STORAGE_KEY);
    expect(trap.reads).not.toContain(SECRET_STORAGE_KEY);
  });

  it('BẪY: status không ghi key ra BẤT KỲ kênh console nào', () => {
    // "Kho khoá không được ghi key ra log, kể cả log lỗi" là ràng buộc có tên
    // trong Global Constraints và kế hoạch không có bài kiểm nào cho nó.
    writeConfig({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: KEY });
    const log = trapConsole();
    const reply = vi.fn();
    try {
      handleMessage(statusEvent(APP, reply), { allowedOrigin: APP });
      // Cả đường không hợp lệ: hồi đáp lỗi là chỗ người ta hay kèm ngữ cảnh.
      handleMessage(
        { origin: APP, data: { v: 1, id: 'y', kind: 'khong-ton-tai' },
          source: { postMessage: reply } } as unknown as MessageEvent,
        { allowedOrigin: APP },
      );
      handleMessage(
        { origin: APP, data: { v: 99, id: 'z', kind: 'status' },
          source: { postMessage: reply } } as unknown as MessageEvent,
        { allowedOrigin: APP },
      );
    } finally {
      log.restore();
    }
    expect(reply).toHaveBeenCalledTimes(3);
    expect(allStrings(log.seen).some((s) => s.includes(KEY))).toBe(false);
    expect(allStrings(reply.mock.calls).some((s) => s.includes(KEY))).toBe(false);
  });

  it('BẪY: status từ origin LẠ không chạm vào kho khoá', () => {
    // Task 1 chứng minh origin lạ không làm `event.data`/`event.source` bị đọc.
    // Chiều còn lại, thuộc về task này: nó cũng không được làm kho khoá bị đọc.
    // Nếu một lần tái cấu trúc đưa `readPublicConfig()` lên trước phép kiểm
    // origin thì bẫy này đỏ.
    writeConfig({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: KEY });

    const trap = trapStorageReads();
    const reply = vi.fn();
    try {
      handleMessage(statusEvent('https://evil.example', reply), { allowedOrigin: APP });
    } finally {
      trap.restore();
    }

    expect(reply).not.toHaveBeenCalled();
    expect(trap.reads).toEqual([]);
  });
});
