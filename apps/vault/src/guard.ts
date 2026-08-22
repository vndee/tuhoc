import { getProvider } from './providers';
import type { VaultErrorCode } from './protocol';

/**
 * Người gác của HC-3 — token bucket, **ngân sách ký tự**, xác nhận đầu phiên,
 * nhật ký hoạt động.
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

/**
 * **Ngân sách KÝ TỰ cho mỗi cú bấm xác nhận.** Vượt ngưỡng ⇒ đòi bấm lại.
 *
 * ── Vì sao hằng số này tồn tại ────────────────────────────────────────────
 * Hai hằng số ngay trên đếm **SỐ LẦN GỌI**. Chúng không đếm **SỐ KÝ TỰ**, và
 * người dựng Task 9 tự đo được rằng đó là lỗ hổng còn lại của HC-3: trong đúng
 * hạn ngạch 10 lời gọi/phút, một course độc vẫn gửi được 10 lời nhắc **dài tuỳ
 * ý** mỗi phút, nên toàn bộ ghi chú riêng tư của người học đi hết trong vài
 * phút mà không lời gọi nào bị từ chối. Phép đo trong `guard.test.ts` cho con
 * số cụ thể: dưới người gác của Task 9, **40/40** lời nhắc dài bằng chương dài
 * nhất đi lọt — 773.720 ký tự — trong khi bucket **không từ chối lấy một lời
 * gọi nào**.
 *
 * ── Con số này đến từ đâu ─────────────────────────────────────────────────
 * **Phần ĐO ĐƯỢC** — `fixtures/courses/`, ngày 2026-08-22, lấy phần văn bản
 * (parse5, bỏ `<script>`/`<style>`, gộp khoảng trắng), tức đúng thứ Task 7 sẽ
 * nhét vào lời nhắc:
 *
 *     so-dau-phay-dong    8 chương    dài nhất 19.343    cả gói 117.872
 *     bat-bien-vong-lap   3 chương    dài nhất 12.814    cả gói  37.684
 *
 * ⇒ Một lời nhắc **hợp lệ** dài nhất mà hệ này sinh ra hôm nay ≈ **19.500 ký
 * tự** (chương dài nhất + câu hỏi + khung system). Đó là phép đo, không phải
 * ước lượng — và nó là **sàn cứng**: ngưỡng thấp hơn con số ấy thì lời gọi hợp
 * lệ đầu tiên đã bị chặn và tính năng chết ngay khi bật.
 *
 * **Phần PHÁN ĐOÁN — nói thẳng ra, vì Task 9 đã im lặng đúng chỗ này và tự ghi
 * lại rằng đó là sai lầm.** Phép đo cho biết *một lời nhắc dài bao nhiêu*. Nó
 * **không** cho biết *bao nhiêu ký tự bị rò mỗi cú bấm là chấp nhận được*, cũng
 * không cho biết *một người học hỏi bao nhiêu câu mỗi phiên* — chưa ai dùng
 * tính năng này, nên không có dữ liệu nào để đo hai điều đó. `120_000` là một
 * **tỉ giá do tôi chọn**, phát biểu được thành một câu:
 *
 *     MỘT cú bấm xác nhận mua nhiều nhất ≈ MỘT giáo trình mẫu đọc ra ngoài một
 *     lần (117.872 ký tự), tức khoảng 6 lời nhắc cỡ chương dài nhất.
 *
 * Chọn thế vì hai phía đều hỏng theo cách nhìn thấy được: quá chặt ⇒ người dùng
 * bấm lại sau mỗi hai câu hỏi, và một cú bấm bấm liên tục là **con dấu cao su**
 * — tệ hơn không có, vì nó dạy người dùng bấm mà không đọc; quá lỏng ⇒ ngân
 * sách chỉ là trang trí. Khi có dữ liệu dùng thật thì sửa **ở đây, một chỗ**.
 *
 * Bài kiểm `ngưỡng đến từ PHÉP ĐO trên gói mẫu thật` neo hằng số này vào hai
 * con số đo được ở trên, nên nó không trôi trong im lặng — nhưng **không** bài
 * kiểm nào nói được con số nào đúng. Đó là giới hạn thật, không phải cách nói
 * khiêm tốn.
 */
export const SESSION_CHAR_BUDGET = 120_000;

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

/**
 * Trạng thái của một cú bấm xác nhận.
 *
 * **`chars` sống TRONG bản ghi xác nhận, không ở một ô nhớ thứ tư.** Đó là
 * quyết định thiết kế chính của Task 9b, và lý do là cấu trúc chứ không phải
 * gọn gàng: ngân sách phải được làm mới **đúng khi và chỉ khi** có một cú bấm
 * mới. Để hai thứ ở hai ô nhớ là để lại khả năng "làm mới ngân sách mà không
 * cần bấm" cho một người sửa sau này — cùng hình dạng với cái bẫy `clearActivity`
 * mà Task 9 đã phải dựng ("Xoá nhật ký" không được là "Bỏ giới hạn"). Ở đây
 * `grantConsent()` ghi đè cả bản ghi, nên hai việc ấy là **một việc**.
 */
interface ConsentState {
  at: number;
  /** Tổng ký tự **đã thật sự gửi đi** kể từ cú bấm này. Không phải số đã thử. */
  chars: number;
}

/** Bản ghi xác nhận hiện tại.
 *
 *  - `null` ⇒ **chưa bấm**.
 *  - `chars: Infinity` ⇒ **có bấm nhưng không đọc được số đã tiêu**. Đây là
 *    FAIL CLOSED, và nó **ngược chiều** với `readBucket` bên dưới một cách có
 *    chủ ý: bucket rỗng/hỏng ⇒ đầy (fail open), vì lần dùng đầu tiên trong đời
 *    cũng đi qua đúng nhánh ấy. Ngân sách thì không: `grantConsent()` **luôn**
 *    ghi `chars: 0`, nên "có bản ghi mà không có số" không phải trạng thái khởi
 *    đầu hợp lệ — nó là một bản ghi cũ còn sót qua một lần deploy, hoặc một bản
 *    ghi bị nghịch. Coi nó là "đã tiêu 0" là cấp một ngân sách mới miễn phí. */
function readConsent(): ConsentState | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  const spent = (at: number): ConsentState => ({ at, chars: Number.POSITIVE_INFINITY });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return spent(0);
  }
  if (parsed === null || typeof parsed !== 'object') return spent(0);
  const { at, chars } = parsed as Partial<ConsentState>;
  const atOk = typeof at === 'number' && Number.isFinite(at) ? at : 0;
  if (typeof chars !== 'number' || !Number.isFinite(chars) || chars < 0) return spent(atOk);
  return { at: atOk, chars };
}

/** Chỉ được gọi từ trình xử lý cú bấm trong khung kho khoá (`ui/Consent.ts`).
 *
 *  Ghi đè **cả** bản ghi, nên `chars` về 0: một cú bấm mới là một ngân sách
 *  mới. Nó **không** đụng tới bucket — cú bấm cấp lại ngân sách KÝ TỰ, không
 *  cấp lại hạn mức TẦN SUẤT. Bài kiểm `bấm xác nhận LẠI … KHÔNG mở lại token
 *  bucket` canh đúng điều đó. */
export function grantConsent(): void {
  writeJson(sessionStorage, CONSENT_KEY, { at: Date.now(), chars: 0 } satisfies ConsentState);
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
    // `chars` đã đi qua `normaliseChars` ở `checkAndConsume`, nên nó chắc chắn
    // là số nguyên hữu hạn ≥ 0. **Cố ý dùng LẠI đúng con số đã trừ vào ngân
    // sách**, không tính lại: nếu nhật ký và ngân sách đếm bằng hai phép tính
    // khác nhau thì con số người dùng nhìn thấy không còn là con số hàng rào
    // dùng — và người dùng không có cách nào biết cái nào đúng.
    at: now,
    chars,
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

/** Số ký tự của một lời gọi, đã chuẩn hoá. `null` = **không đo được**, và một
 *  lời gọi không đo được thì không được đi ra (xem `checkAndConsume`). */
function normaliseChars(raw: number): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  return Math.trunc(raw);
}

/**
 * **Cửa DUY NHẤT dẫn ra mạng.** Bốn phép kiểm gộp vào một hàm có chủ ý: tách
 * chúng ra là để người gọi sau này gọi thiếu một cái, và thứ tự giữa chúng
 * không phải chuyện ngẫu nhiên.
 *
 * Thứ tự, và vì sao:
 *
 *   1. **Xác nhận trước.** Một lời gọi bị từ chối vì chưa xin phép **không được
 *      tiêu token** — nếu không, course độc chỉ cần spam trước khi người dùng
 *      bấm là hạn mức của họ đã cạn trước lời gọi thật đầu tiên.
 *   2. **Ngân sách KÝ TỰ**, cũng trước bucket, và cũng vì lý do ấy: một lời gọi
 *      bị từ chối vì hết ngân sách không được tiêu token. Đây là phép kiểm duy
 *      nhất trong tệp này chạm được **nửa nghiêm trọng hơn của HC-3** — rò ghi
 *      chú, không phải đốt tiền. Ba phép kiểm kia đếm **lần**; chỉ phép kiểm
 *      này đếm **chữ**, và chữ mới là thứ rời khỏi máy người dùng.
 *   3. **Bucket sau.** Trạng thái nằm trong `localStorage` của origin kho khoá,
 *      **không** trong một biến của module: trang chính đổi được `iframe.src`
 *      bất cứ lúc nào, và một bucket trong bộ nhớ sẽ đầy lại sau mỗi lần nạp
 *      khung trong khi xác nhận thì vẫn còn (`sessionStorage` sống qua reload).
 *      Bucket trong bộ nhớ = không giới hạn gì cả. **Ngân sách ký tự nằm trong
 *      `sessionStorage` vì đúng lý do đó**, không phải vì nó tiện.
 *   4. **Nhật ký cuối**, chỉ cho lời gọi thật sự đi ra.
 *
 * **Hai hàng rào đo hai thứ khác nhau, và không cái nào thay được cái kia.**
 * Bucket chặn *tần suất*; ngân sách chặn *khối lượng*. Với lời nhắc ngắn, thứ
 * chạm trước là bucket; với lời nhắc dài, thứ chạm trước là ngân sách. Bài kiểm
 * `ngưỡng MỚI không che mất giới hạn tần suất cũ` canh đúng chỗ ấy — bài học
 * Task 9: *một dây bẫy còn xanh không có nghĩa nó còn đo đúng thứ nó từng đo.*
 *
 * Ghi trạng thái bucket **hỏng thì TỪ CHỐI** ("fail closed"): không ghi được
 * nghĩa là không trừ được token, và cho qua trong tình huống đó là bỏ hẳn hạn
 * mức. Nhật ký thì ngược lại — ghi hỏng chỉ mất tầm nhìn, không mất hàng rào,
 * nên nó không chặn lời gọi. Hai chính sách ngược nhau, và sự khác nhau ấy là
 * có chủ ý.
 */
export function checkAndConsume(input: { chars: number; providerId: string }): GuardDecision {
  const now = Date.now();

  const consent = readConsent();
  if (consent === null) {
    return deny(
      'needs_consent',
      'Cần một cú bấm xác nhận trong khung kho khoá trước lời gọi đầu tiên của phiên này.',
      now,
    );
  }

  // Một lời gọi mà kho khoá **không đo được** thì không được đi ra. Kẹp một số
  // vô lý về 0 (cách cũ, khi `chars` chỉ dùng để vẽ nhật ký) giờ là một lỗ:
  // `NaN + x > NGƯỠNG` là `false`, nên `chars: NaN` sẽ đi vòng qua ngân sách và
  // gửi đi bao nhiêu tuỳ thích. Hôm nay `main.ts` chỉ truyền vào tổng độ dài
  // chuỗi — nhưng người gác là ranh giới tin cậy, và ranh giới không suy đoán
  // về phía bên kia.
  const chars = normaliseChars(input.chars);
  if (chars === null) {
    return deny(
      'rate_limited',
      'Kho khoá không đo được độ dài lời nhắc này nên từ chối gửi nó đi.',
      now,
    );
  }

  // MỘT lời nhắc lớn hơn cả ngân sách phiên: từ chối, nhưng **giữ nguyên xác
  // nhận**. Rút xác nhận ở đây sẽ tạo một vòng kẹt chết — người dùng bấm lại,
  // gửi lại, bị chặn lại, bấm mãi không thoát — và triệu chứng là "AI hỏng".
  // Ngưỡng cách chương dài nhất thật hơn sáu lần, nên một lời nhắc rơi vào
  // nhánh này không phải một câu hỏi về chương.
  if (chars > SESSION_CHAR_BUDGET) {
    return deny(
      'rate_limited',
      'Lời nhắc này dài hơn toàn bộ ngân sách của một phiên nên kho khoá không gửi.',
      now,
    );
  }

  // ĐÂY LÀ PHÉP KIỂM CỦA TASK 9b. Kiểm **TRƯỚC** khi gọi, trên tổng dự kiến —
  // kiểm sau khi gửi là để lời nhắc đầu tiên đi ra không giới hạn, tức là đúng
  // thứ cần chặn đã xảy ra rồi mới đếm.
  if (consent.chars + chars > SESSION_CHAR_BUDGET) {
    // Rút xác nhận, KHÔNG chặn vĩnh viễn: người dùng thật bấm một cái là dùng
    // tiếp được, còn một course độc thì mỗi ngân sách phải trả bằng một cú bấm
    // của con người mà nó không giả được (cú bấm xảy ra ở origin kho khoá).
    revokeConsent();
    return deny(
      'needs_consent',
      'Phiên này đã gửi đi hết ngân sách ký tự. Hãy xác nhận lại trong khung kho khoá.',
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

  // Cộng ngân sách **TRƯỚC KHI** trả `allow`, và ghi hỏng thì TỪ CHỐI — cùng
  // chính sách với bucket, vì lý do y hệt: không cộng được nghĩa là không đếm
  // được nữa, và cho qua khi không đếm được là bỏ hẳn ngân sách. (Nhật ký vẫn
  // là ngoại lệ ngược chiều: ghi hỏng chỉ mất tầm nhìn, không mất hàng rào.)
  //
  // Cặn của nhánh này: token đã bị trừ cho một lời gọi không đi ra. Chấp nhận
  // — nó lệch về phía CHẶT, và chiều ngược lại (cho qua) bỏ mất hàng rào.
  if (!writeJson(sessionStorage, CONSENT_KEY, {
    at: consent.at,
    chars: consent.chars + chars,
  } satisfies ConsentState)) {
    return deny(
      'rate_limited',
      'Kho khoá không ghi được ngân sách ký tự nên từ chối lời gọi này.',
      now,
    );
  }

  recordCall(now, chars, input.providerId);
  return { allow: true, code: null, message: null };
}
