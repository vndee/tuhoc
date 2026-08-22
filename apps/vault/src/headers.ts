/**
 * Nửa thuần-chuỗi của cấu hình header cho kho khoá.
 *
 * Tệp `_headers` (Cloudflare Pages) nằm ở `apps/vault/_headers` và là **nguồn
 * sự thật duy nhất**. Tệp này chỉ làm hai việc: điền origin thật vào thẻ giữ
 * chỗ lúc dựng, và đọc ra một chỉ thị CSP để bài kiểm hỏi được. Không `node:fs`
 * ở đây — mã dưới `src/` chạy ở origin giữ key, và việc đọc tệp là việc của
 * `vite.config.ts`.
 *
 * ─── Vì sao `frame-ancestors` là hạng mục của TASK 6, không phải "thêm lúc
 * deploy" ────────────────────────────────────────────────────────────────────
 *
 * Task 1 đo được: kho khoá thiếu `frame-ancestors`, nên **bất kỳ site nào cũng
 * nhúng nó vào `<iframe>` được**. Hôm qua điều đó vô hại — trang rỗng,
 * `handleMessage` bỏ thông điệp từ origin lạ, và `localStorage` khác origin nên
 * không đọc được.
 *
 * Task 6 làm nó nguy hiểm. Từ lúc form nhập bí mật được vẽ vào origin này, một
 * site thù địch nhúng **kho khoá thật** vào trang của họ, phủ lên nó một lớp
 * của riêng họ, và trình ra một ô nhập trông y hệt — ở đúng origin thật, dưới
 * đúng chứng chỉ thật. Đó là *confused deputy* theo chiều mà HC-3 không nói
 * tới: HC-3 lo course độc trong trang chính sai khiến kho khoá; chiều này lo
 * một trang lạ mượn **vẻ ngoài** của kho khoá.
 *
 * `frame-ancestors` là thứ duy nhất chặn được, vì nó là phép kiểm duy nhất chạy
 * **trước khi** tài liệu được vẽ.
 */

/** Thẻ giữ chỗ trong `_headers`, thay bằng `VITE_APP_ORIGIN` lúc dựng.
 *
 *  Giữ chỗ chứ không viết cứng, vì origin trang chính khác nhau ở mỗi lần
 *  deploy — và một tệp `_headers` viết cứng `https://REPLACE-ME` là đúng cái
 *  "header chỉ tồn tại trong đầu người deploy" mà cổng này sinh ra để chặn.
 *  Nguồn duy nhất là biến môi trường mà kho khoá **đã** bắt buộc phải có
 *  (`src/main.ts` ném khi thiếu), nên không có chỗ thứ hai để quên. */
export const APP_ORIGIN_TOKEN = '__VITE_APP_ORIGIN__';

/** `scheme://host[:port]` — đúng hình dạng `event.origin` của trình duyệt.
 *  Cùng biểu thức mà `src/main.ts` và `apps/web`'s `vaultClient.ts` dùng, và vì
 *  cùng lý do: một giá trị sai một ký tự làm tính năng chết trong im lặng. */
const ORIGIN_SHAPE = /^https?:\/\/[^/?#\s]+$/;

/** Lấy phần GIÁ TRỊ của header `Content-Security-Policy`, nếu đầu vào là cả một
 *  tệp `_headers`; ngược lại coi đầu vào chính là giá trị ấy.
 *
 *  Bước này không phải trang trí: `_headers` có một khối chú thích dài giải
 *  thích vì sao `frame-ancestors` quan trọng, và một bộ dò quét cả tệp có thể
 *  tìm thấy tên chỉ thị **trong lời giải thích rằng nó phải có mặt** — tức là
 *  xanh nhất đúng vào lúc dòng thật vừa bị xoá. */
function cspValue(text: string): string {
  const m = /^[ \t]*Content-Security-Policy:[ \t]*(.+)$/m.exec(text);
  return m ? m[1] : text;
}

/**
 * Đọc một chỉ thị CSP ra khỏi văn bản.
 *
 * Biên trái là đầu chuỗi hoặc một dấu `;` — nếu không, `cspDirective(text,
 * 'src')` sẽ khớp vào giữa `child-src` và trả lời sai cho một câu hỏi an ninh.
 * `headers.test.ts` có bài kiểm cho đúng chỗ đó.
 */
export function cspDirective(text: string, name: string): string | null {
  const re = new RegExp(String.raw`(?:^|;)\s*${name}\s+([^;\n]+)`);
  const m = re.exec(cspValue(text));
  return m ? m[1].trim() : null;
}

/**
 * Điền origin trang chính vào `_headers`.
 *
 * **Ném thay vì lùi về một giá trị an toàn**, ở cả ba đường hỏng, và đó là lựa
 * chọn có ý thức:
 *
 *   - thiếu `VITE_APP_ORIGIN` ⇒ ném. Bản dựng production của kho khoá **đã**
 *     ném ngay lúc nạp khi thiếu biến này (Task 1), nên một bản dựng từ chối
 *     hoàn thành là nhất quán chứ không phải một gánh nặng mới — chỉ là nó hỏng
 *     sớm hơn vài phút.
 *   - `_headers` mất `frame-ancestors` ⇒ ném. Một bản dựng vẫn chạy sau khi ai
 *     đó xoá dòng ấy là đúng hình dạng cổng mù: mọi test đơn vị vẫn xanh, và
 *     thứ biến mất chỉ lộ ra khi có người dựng màn lừa.
 *   - không còn thẻ giữ chỗ ⇒ ném. Đây là ca "ai đó đã viết cứng một origin
 *     vào tệp": im lặng cho qua nghĩa là bản dựng của mọi môi trường khác đều
 *     trỏ vào origin của một môi trường.
 */
export function applyAppOrigin(headersText: string, appOrigin: string): string {
  const origin = appOrigin.trim();
  if (!origin || !ORIGIN_SHAPE.test(origin)) {
    throw new Error(
      `VITE_APP_ORIGIN phải là một origin đúng nghĩa (scheme://host[:port]), không dấu "/" ` +
        `cuối, không đường dẫn, không "*" — nhận được ${JSON.stringify(appOrigin)}. ` +
        `Kho khoá không đoán ai được phép nhúng nó.`,
    );
  }
  if (cspDirective(headersText, 'frame-ancestors') === null) {
    throw new Error(
      '`_headers` không còn chỉ thị frame-ancestors. Không có nó, bất kỳ site nào cũng ' +
        'nhúng được kho khoá và dựng một ô nhập key giả ở đúng origin thật.',
    );
  }
  if (!headersText.includes(APP_ORIGIN_TOKEN)) {
    throw new Error(
      `\`_headers\` không còn thẻ giữ chỗ ${APP_ORIGIN_TOKEN} — có ai đó đã viết cứng một ` +
        'origin vào tệp, và bản dựng của mọi môi trường khác sẽ trỏ nhầm vào đó.',
    );
  }
  return headersText.replaceAll(APP_ORIGIN_TOKEN, origin);
}
