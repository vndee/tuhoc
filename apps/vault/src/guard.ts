import { getProvider } from './providers';
import type { VaultErrorCode } from './protocol';

/**
 * Người gác của HC-3 — token bucket, xác nhận đầu phiên, nhật ký hoạt động.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * **ĐÂY LÀ GIẢM THIỂU, KHÔNG PHẢI KHẮC PHỤC. Đọc hết đoạn này trước khi sửa.**
 *
 * Kiến trúc origin riêng chặn được course độc **ĐỌC** key: trình duyệt cấm JS
 * của một origin đọc `localStorage` của origin khác. Nó **KHÔNG** chặn được
 * course độc **DÙNG** key. Course chạy trong trang chính; trang chính được phép
 * `postMessage` cho kho khoá; nên course vẫn bảo được kho khoá **gọi hộ**. Đó
 * là lỗi *confused deputy* kinh điển. Nó không lấy được key, nhưng nó:
 *
 *   - đốt tiền người dùng bằng vô số lời gọi;
 *   - **gửi ghi chú riêng tư của người dùng đi** dưới danh nghĩa lời nhắc.
 *
 * Cái thứ hai nghiêm trọng hơn, và **kiến trúc origin riêng không đóng nó**.
 * Tệp này chỉ làm lỗ ấy đắt hơn và nhìn thấy được. **Đừng đọc tệp này rồi
 * tưởng lỗ đã đóng.**
 *
 * Đường ra thật — cho course hạng `interactive` chạy trong một iframe sandbox ở
 * origin riêng — đã được spec §1.2 cân nhắc và **bác bỏ có ý thức**, vì nó phá
 * P2 (chú thích cần chạm DOM của chương). Đó là đánh đổi có ý thức, đã ghi vào
 * `docs/carried-forward.md` để nó không nằm im.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **Nguyên tắc chi phối mọi dòng dưới đây: kho khoá KHÔNG TIN trang chính.**
 * Giới hạn nằm ở phía kho khoá, không phải phía gọi — một giới hạn cài ở
 * `apps/web` là một giới hạn mà course độc chỉ cần không gọi tới.
 */

/** Sức chứa: số lời gọi liên tiếp được phép trước khi phải chờ nạp lại. */
export const BUCKET_CAPACITY = 8;

/** Nhịp nạp: một token mỗi 6 giây ⇒ 10 lời gọi/phút ở trạng thái bền vững.
 *
 *  **Hai con số này là PHÁN ĐOÁN, không phải phép đo** — không có dữ liệu sử
 *  dụng thật để đo, vì tính năng chưa tới tay ai. Căn cứ: một người đọc sách
 *  hỏi vài câu mỗi phút là nhiều, nên 8 liên tiếp + 10/phút không cản người
 *  dùng thật; còn một vòng lặp độc thì bị kéo từ "hàng nghìn lời gọi mỗi phút"
 *  xuống 10. Khi có số liệu thật thì sửa ở đây, một chỗ. */
export const BUCKET_REFILL_MS = 6_000;

/** Trần nhật ký. Vòng đệm, giữ mục MỚI NHẤT. */
export const MAX_LOG_ENTRIES = 200;

/** Ô nhớ của người gác. Cùng tiền tố `tuhoc.vault.` với keystore, thêm một tầng
 *  `guard` để không ai nhầm chúng với hai ô nhớ cấu hình. **Không ô nào trong
 *  số này được chứa key hay nội dung lời nhắc** — xem `recordCall`. */
const BUCKET_KEY = 'tuhoc.vault.guard.bucket';
const LOG_KEY = 'tuhoc.vault.guard.log';
const DENIED_KEY = 'tuhoc.vault.guard.denied';

/** Xác nhận sống ở `sessionStorage`, KHÔNG `localStorage`: yêu cầu là "một lần
 *  mỗi PHIÊN", và `localStorage` không có khái niệm phiên — cắm ở đó thì một
 *  cú bấm hồi tháng trước vẫn còn hiệu lực hôm nay. */
const CONSENT_KEY = 'tuhoc.vault.guard.consent';

export type GuardDenial = Extract<VaultErrorCode, 'needs_consent' | 'rate_limited'>;

export interface GuardDecision {
  allow: boolean;
  /** `null` khi được cho qua. Là **tập con của `VaultErrorCode`** lấy bằng
   *  `Extract`, không chép tay: đổi tên một mã ở `protocol.ts` làm `tsc -b` đỏ
   *  ngay tại đây thay vì để một chuỗi lạ trôi ra trang chính. */
  code: GuardDenial | null;
  message: string | null;
}

/** Một dòng nhật ký. **Ba trường, và cố ý không có trường thứ tư.**
 *
 *  Không `content`, không đoạn trích, không băm nội dung: nhật ký nằm cùng
 *  origin với key và người dùng mở DevTools là thấy. Một nhật ký ghi nội dung
 *  là **bản sao thứ hai của ghi chú riêng tư** — đúng thứ HC-3 nói là thiệt hại
 *  nghiêm trọng hơn cả việc đốt tiền. `chars` trả lời được câu người dùng thật
 *  sự cần ("nó vừa gửi đi bao nhiêu?") mà không chở theo chữ nào.
 *
 *  `model` cũng không có mặt: nó tới từ trang chính, tức là văn xuôi tuỳ ý.
 *  `providerId` chỉ được ghi khi registry nhận ra nó — xem `recordCall`. */
export interface ActivityEntry {
  /** Epoch ms. */
  at: number;
  /** Tổng số ký tự nội dung đã gửi đi. KHÔNG phải nội dung. */
  chars: number;
  /** Id đã được registry xác nhận, hoặc `null` nếu trang chính gửi thứ lạ. */
  providerId: string | null;
}

export interface DeniedCounters {
  needs_consent: number;
  rate_limited: number;
  lastAt: number | null;
}

export interface Activity {
  calls: ActivityEntry[];
  denied: DeniedCounters;
}

// ───────────────────────── đọc/ghi ô nhớ ─────────────────────────

/** Đọc JSON, và **không bao giờ ném**. Một ô nhớ hỏng (người dùng nghịch
 *  DevTools, một bản cũ ghi hình dạng khác) không được làm chết kho khoá.
 *  KHÔNG log nội dung thô ở đây, kể cả để gỡ lỗi — cùng lý do đã ghi ở
 *  `keystore.ts`: thói quen in nội dung ô nhớ ra console sẽ theo người sửa sang
 *  ô nhớ có key. */
function readJson<T>(store: Storage, name: string, fallback: T): T {
  let raw: string | null;
  try {
    raw = store.getItem(name);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

/** Ghi JSON. Trả về **có ghi được hay không** — người gọi quyết định hỏng thế
 *  nào, vì hai chỗ dùng hàm này có hai chính sách ngược nhau (xem
 *  `checkAndConsume`). */
function writeJson(store: Storage, name: string, value: unknown): boolean {
  try {
    store.setItem(name, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────── xác nhận đầu phiên ─────────────────────────

/**
 * Đã có cú bấm xác nhận trong khung kho khoá ở phiên này chưa.
 *
 * **Giá trị của cơ chế này nằm trọn ở chỗ CÚ BẤM XẢY RA Ở ORIGIN KHO KHOÁ.**
 * JS của trang chính không chạy được ở origin này, nên nó không giả được cú
 * bấm — và `handleMessage` **không có** đường nào gọi `grantConsent`. Bài kiểm
 * "KHÔNG thông điệp nào từ trang chính cấp được xác nhận" canh đúng điều đó;
 * nếu một ngày nào đó ai thêm một `kind: 'consent'` vào giao thức thì toàn bộ
 * cơ chế này thành trang trí.
 */
export function hasConsent(): boolean {
  try {
    return sessionStorage.getItem(CONSENT_KEY) !== null;
  } catch {
    return false;
  }
}

/** Chỉ được gọi từ trình xử lý cú bấm trong khung kho khoá (`ui/Consent.ts`). */
export function grantConsent(): void {
  writeJson(sessionStorage, CONSENT_KEY, { at: Date.now() });
}

export function revokeConsent(): void {
  try {
    sessionStorage.removeItem(CONSENT_KEY);
  } catch {
    // Không xoá được thì cũng không có gì để làm thêm.
  }
}

// ───────────────────────── token bucket ─────────────────────────

interface BucketState {
  tokens: number;
  at: number;
}

function readBucket(now: number): BucketState {
  const raw = readJson<Partial<BucketState>>(localStorage, BUCKET_KEY, {});
  // Ô nhớ trống hoặc hỏng ⇒ bucket ĐẦY. Đây là "fail open", và nó đúng ở đây
  // một cách hẹp: trang chính KHÔNG ghi được vào `localStorage` của origin này
  // (khác origin), nên không ai ngoài chính người dùng làm hỏng được ô nhớ —
  // và lần dùng đầu tiên trong đời cũng đi qua đúng nhánh này.
  if (typeof raw.tokens !== 'number' || typeof raw.at !== 'number'
      || !Number.isFinite(raw.tokens) || !Number.isFinite(raw.at)) {
    return { tokens: BUCKET_CAPACITY, at: now };
  }
  // Đồng hồ chạy lùi (người dùng chỉnh giờ, đồng bộ NTP) cho `elapsed` âm. Kẹp
  // ở 0: nạp lại theo thời gian âm là **cấp thêm** token, đúng chiều sai.
  const elapsed = Math.max(0, now - raw.at);
  const refilled = Math.min(BUCKET_CAPACITY, raw.tokens + elapsed / BUCKET_REFILL_MS);
  return { tokens: Math.max(0, refilled), at: now };
}

// ───────────────────────── nhật ký ─────────────────────────

function readLog(): ActivityEntry[] {
  const raw = readJson<unknown>(localStorage, LOG_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is ActivityEntry =>
      typeof e === 'object' && e !== null
      && typeof (e as ActivityEntry).at === 'number'
      && typeof (e as ActivityEntry).chars === 'number',
  );
}

function readDenied(): DeniedCounters {
  const raw = readJson<Partial<DeniedCounters>>(localStorage, DENIED_KEY, {});
  return {
    needs_consent: typeof raw.needs_consent === 'number' ? raw.needs_consent : 0,
    rate_limited: typeof raw.rate_limited === 'number' ? raw.rate_limited : 0,
    lastAt: typeof raw.lastAt === 'number' ? raw.lastAt : null,
  };
}

/**
 * Ghi một lời gọi ĐÃ ĐI RA MẠNG.
 *
 * `providerId` đi qua registry chứ không đi thẳng vào nhật ký: chuỗi ấy tới từ
 * trang chính, và HC-3 nói course độc chạy chính ở đó. Ghi thẳng nó là mở
 * đường thứ hai để nhét văn xuôi vào nhật ký — nhật ký thành bản sao thứ hai
 * của ghi chú riêng tư qua cửa sau, sau khi cửa trước (`content`) đã khoá.
 * `getProvider()` chỉ trả về phần tử của registry, nên thứ được ghi luôn là
 * **hằng số của kho khoá**, không phải dữ liệu người ngoài.
 */
function recordCall(now: number, chars: number, providerId: string): void {
  const known = getProvider(providerId);
  const log = readLog();
  log.push({
    at: now,
    // `chars` do người gọi tính từ nội dung; kẹp lại để một số vô lý (NaN, âm,
    // Infinity) không đi vào nhật ký và làm giao diện vẽ rác.
    chars: Number.isFinite(chars) ? Math.max(0, Math.trunc(chars)) : 0,
    providerId: known ? known.id : null,
  });
  // Vòng đệm: giữ mục MỚI NHẤT. Nhật ký là thứ người dùng nhìn để phát hiện
  // bất thường, nên phần đáng giữ là phần gần đây.
  writeJson(localStorage, LOG_KEY, log.slice(-MAX_LOG_ENTRIES));
}

/**
 * Ghi một lời gọi BỊ TỪ CHỐI — dưới dạng **bộ đếm**, không phải mục nhật ký.
 *
 * Nếu mục bị từ chối nằm chung vòng đệm với lời gọi thật thì một course độc chỉ
 * cần gọi `MAX_LOG_ENTRIES` lần để **đẩy sạch dấu vết** những gì nó vừa gửi đi
 * — biến chính cơ chế giám sát thành công cụ xoá dấu vết. Bộ đếm không bị đẩy.
 */
function recordDenied(kind: GuardDenial, now: number): void {
  const d = readDenied();
  d[kind] += 1;
  d.lastAt = now;
  writeJson(localStorage, DENIED_KEY, d);
}

export function readActivity(): Activity {
  return { calls: readLog(), denied: readDenied() };
}

/** Người dùng xoá nhật ký của mình. **Không** đụng tới bucket: nhật ký là thứ
 *  người dùng sở hữu, hạn mức là hàng rào — cho phép xoá nhật ký để mở lại hạn
 *  mức sẽ biến nút "Xoá nhật ký" thành nút "Bỏ giới hạn". */
export function clearActivity(): void {
  try {
    localStorage.removeItem(LOG_KEY);
    localStorage.removeItem(DENIED_KEY);
  } catch {
    // Không xoá được thì nhật ký vẫn còn — không có gì nguy hiểm.
  }
}

// ───────────────────────── cửa duy nhất ─────────────────────────

function deny(code: GuardDenial, message: string, now: number): GuardDecision {
  recordDenied(code, now);
  return { allow: false, code, message };
}

/**
 * **Cửa DUY NHẤT dẫn ra mạng.** Ba phép kiểm gộp vào một hàm có chủ ý: tách
 * chúng ra là để người gọi sau này gọi thiếu một cái, và thứ tự giữa chúng
 * không phải chuyện ngẫu nhiên.
 *
 * Thứ tự, và vì sao:
 *
 *   1. **Xác nhận trước.** Một lời gọi bị từ chối vì chưa xin phép **không được
 *      tiêu token** — nếu không, course độc chỉ cần spam trước khi người dùng
 *      bấm là hạn mức của họ đã cạn trước lời gọi thật đầu tiên.
 *   2. **Bucket sau.** Trạng thái nằm trong `localStorage` của origin kho khoá,
 *      **không** trong một biến của module: trang chính đổi được `iframe.src`
 *      bất cứ lúc nào, và một bucket trong bộ nhớ sẽ đầy lại sau mỗi lần nạp
 *      khung trong khi xác nhận thì vẫn còn (`sessionStorage` sống qua reload).
 *      Bucket trong bộ nhớ = không giới hạn gì cả.
 *   3. **Nhật ký cuối**, chỉ cho lời gọi thật sự đi ra.
 *
 * Ghi trạng thái bucket **hỏng thì TỪ CHỐI** ("fail closed"): không ghi được
 * nghĩa là không trừ được token, và cho qua trong tình huống đó là bỏ hẳn hạn
 * mức. Nhật ký thì ngược lại — ghi hỏng chỉ mất tầm nhìn, không mất hàng rào,
 * nên nó không chặn lời gọi. Hai chính sách ngược nhau, và sự khác nhau ấy là
 * có chủ ý.
 */
export function checkAndConsume(input: { chars: number; providerId: string }): GuardDecision {
  const now = Date.now();

  if (!hasConsent()) {
    return deny(
      'needs_consent',
      'Cần một cú bấm xác nhận trong khung kho khoá trước lời gọi đầu tiên của phiên này.',
      now,
    );
  }

  const bucket = readBucket(now);
  if (bucket.tokens < 1) {
    return deny(
      'rate_limited',
      'Kho khoá đang giới hạn tần suất để không ai gọi hộ bằng key của bạn.',
      now,
    );
  }

  if (!writeJson(localStorage, BUCKET_KEY, { tokens: bucket.tokens - 1, at: now })) {
    return deny(
      'rate_limited',
      'Kho khoá không ghi được trạng thái hạn mức nên từ chối lời gọi này.',
      now,
    );
  }

  recordCall(now, input.chars, input.providerId);
  return { allow: true, code: null, message: null };
}
