import type { Activity } from '../guard';
import { currentLocale, t } from '../lang';

/**
 * Khung xác nhận + nhật ký của kho khoá.
 *
 * **Vì sao hai thứ này nằm chung một tệp, chung một khung:** một nút "cho phép"
 * không kèm tầm nhìn vào những gì đã được gửi đi là một con dấu cao su. Cái làm
 * cho cú bấm ấy là *xác nhận có hiểu biết* chính là danh sách bên dưới nó —
 * người dùng thấy "12 lời gọi, 48.000 ký tự đã rời máy trong mười phút qua" thì
 * mới có cơ hội nhận ra một course đang gọi hộ. Tách nhật ký sang một màn khác
 * là tách đúng hai nửa của một quyết định.
 *
 * **Vì sao cú bấm này có giá trị:** nó xảy ra ở **origin của kho khoá**. JS của
 * trang chính không chạy được ở đây, nên nó không dựng được cú bấm này, không
 * đọc được DOM này, và **không có thông điệp `postMessage` nào cấp được quyền**
 * (`main.ts` không gọi `grantConsent` ở bất kỳ nhánh nào). Đó là toàn bộ giá
 * trị của cơ chế; nếu ai thêm một `kind: 'consent'` vào giao thức thì nó thành
 * trang trí.
 *
 * **Ràng buộc dựng DOM:** mọi chữ đi vào `textContent`, **không** `innerHTML`.
 * Bài học S1-F43 — một gói hạng `content` "an toàn theo định nghĩa" chạy được
 * mã tuỳ ý qua đúng một `innerHTML`, và bốn cổng đều cho qua. Đây là origin
 * giữ key: một `innerHTML` ở đây đắt hơn nhiều lần.
 */

export interface PanelDeps {
  hasConsent: () => boolean;
  grantConsent: () => void;
  readActivity: () => Activity;
  clearActivity: () => void;
}

/**
 * Trình xử lý cú bấm, tách khỏi DOM để kiểm được.
 *
 * `ev.isTrusted` phân biệt cú bấm của con người với cú bấm do mã dựng
 * (`element.click()`, `dispatchEvent`). Hôm nay đây là **phòng thủ chiều sâu**:
 * không mã lạ nào chạy được ở origin kho khoá, nên không ai gọi được
 * `.click()`. Ngày mai thì khác — Task 6 vẽ **form nhập key** vào chính origin
 * này, và từ lúc đó một lỗ tiêm ở đây là thứ có thật để phòng.
 *
 * Ghi chú thật thà cho người kiểm: jsdom **không dựng được sự kiện đáng tin**,
 * nên đường "cú bấm thật" chỉ kiểm được bằng cách gọi thẳng hàm này với một đối
 * tượng `{ isTrusted: true }`. Đường "cú bấm giả" thì kiểm được qua DOM thật.
 */
export function handleConsentClick(
  ev: { isTrusted: boolean },
  deps: Pick<PanelDeps, 'grantConsent'>,
): boolean {
  if (!ev.isTrusted) return false;
  deps.grantConsent();
  return true;
}

function el(tag: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatWhen(at: number): string {
  // `toLocaleString` có thể ném với một mốc thời gian rác; nhật ký không được
  // làm chết khung chỉ vì một dòng hỏng.
  try {
    return new Date(at).toLocaleString(currentLocale());
  } catch {
    return String(at);
  }
}

/** Số ký tự, có dấu phân nhóm. `120.000` đọc được trong một cái liếc; `120000`
 *  thì không — và con số này là thứ người dùng phải cân trong hai giây trước
 *  khi bấm, không phải thứ họ ngồi đếm chữ số. */
function formatChars(n: number): string {
  try {
    return n.toLocaleString(currentLocale());
  } catch {
    return String(n);
  }
}

function renderActivity(root: Element, deps: PanelDeps, activity: Activity): void {
  root.appendChild(el('h3', t('vault.log.title')));
  root.appendChild(el('p', t('vault.log.blurb')));

  if (activity.calls.length === 0) {
    root.appendChild(el('p', t('vault.log.empty')));
  } else {
    // TỔNG trước, chi tiết sau. Ba con số rời nhau là ba con số phải cộng
    // nhẩm; câu hỏi người dùng thật sự đang trả lời — "đã có bao nhiêu chữ của
    // tôi rời khỏi máy này?" — chỉ có một con số.
    const total = activity.calls.reduce((n, c) => n + c.chars, 0);
    const spent = el('p', t('vault.log.total', formatChars(total), formatChars(activity.calls.length)));
    spent.dataset.role = 'spent';
    spent.className = 'vault-spent';
    root.appendChild(spent);

    const list = el('ul');
    // Mới nhất lên đầu: phần đáng nhìn của một nhật ký giám sát là phần vừa xảy ra.
    for (const c of [...activity.calls].reverse()) {
      list.appendChild(
        el(
          'li',
          t('vault.log.entry', formatWhen(c.at), formatChars(c.chars), c.providerId ?? t('vault.log.unknownProvider')),
        ),
      );
    }
    root.appendChild(list);
  }

  const d = activity.denied;
  if (d.needs_consent > 0 || d.rate_limited > 0) {
    root.appendChild(
      el('p', t('vault.log.denied', formatChars(d.rate_limited), formatChars(d.needs_consent))),
    );
  }

  const clear = el('button', t('vault.log.clear')) as HTMLButtonElement;
  clear.type = 'button';
  clear.dataset.role = 'clear-log';
  clear.addEventListener('click', () => {
    deps.clearActivity();
    renderVaultPanel(root, deps);
  });
  root.appendChild(clear);
}

/**
 * Lời xin xác nhận. Hai cách nói, và sự khác nhau giữa chúng là điểm.
 *
 * **Lần đầu** người dùng chưa có gì để cân: chưa có chữ nào rời máy, nên bảng
 * chỉ nói cơ chế làm gì.
 *
 * **Lần sau** thì họ đang bị hỏi lại *vì* đã có nhiều chữ rời máy — Task 9b rút
 * xác nhận khi phiên tiêu hết ngân sách ký tự. Đó đúng là lúc con số đáng nhìn
 * nhất, nên đây là chỗ nó phải xuất hiện, không phải chỗ nó bị giấu đi.
 *
 * Kho khoá **không tự nhận là biết vì sao** người dùng đang bị hỏi: bản ghi xác
 * nhận nằm ở `sessionStorage` còn nhật ký nằm ở `localStorage`, nên một nhật ký
 * không rỗng cũng có thể chỉ là dấu vết của phiên hôm qua. Câu chữ dưới đây nói
 * đúng thứ đo được ("phiên này đã có chừng này chữ đi ra") và để người dùng tự
 * kết luận — chứ không khẳng định một nguyên nhân mà nó không đọc được.
 */
function renderConsentAsk(root: Element, deps: PanelDeps, activity: Activity): void {
  const repeat = activity.calls.length > 0;

  root.appendChild(el('h3', t(repeat ? 'vault.consent.askAgainTitle' : 'vault.consent.askTitle')));
  root.appendChild(el('p', t(repeat ? 'vault.consent.askAgainBody' : 'vault.consent.askBody')));

  const btn = el('button', t('vault.consent.allow')) as HTMLButtonElement;
  btn.type = 'button';
  btn.dataset.role = 'consent';
  btn.addEventListener('click', (ev) => {
    if (handleConsentClick(ev, deps)) renderVaultPanel(root, deps);
  });
  root.appendChild(btn);
}

/**
 * Vẽ lại toàn bộ khung. Gọi được nhiều lần; mỗi lần dựng lại từ đầu.
 *
 * Vẽ ra **không** cấp quyền — quyền chỉ tới từ `handleConsentClick` với một sự
 * kiện đáng tin. Đó là một bài kiểm riêng, vì "mount rồi tự bật cờ" là kiểu
 * hỏng im lặng đúng bằng việc không có nút.
 *
 * **Nút xin phép KHÔNG thay thế nhật ký — nó đứng TRÊN nhật ký.** Bản đầu tiên
 * của tệp này `return` ngay sau khi vẽ nút, tức là ẩn nhật ký đi đúng lúc người
 * dùng phải quyết định. Với ngân sách ký tự của Task 9b, lần hỏi thứ hai trở đi
 * xảy ra **vì** đã có nhiều chữ rời máy, nên đó chính là lúc con số đáng nhìn
 * nhất — và một cái nút không kèm con số ấy là đúng "con dấu cao su" mà cả cơ
 * chế này sinh ra để tránh.
 *
 * Điều đó không phải chi tiết trang trí. Phép đo của Task 9b nói thẳng: ngân
 * sách **không chặn** được việc tuồn ghi chú, nó chỉ **định giá bằng số cú bấm
 * của con người** — bấm đủ 7 lần thì cả 773.720 ký tự vẫn đi. Cơ chế chỉ sống
 * nếu người dùng dừng lại ở cú bấm thứ hai hoặc thứ ba, và thứ quyết định điều
 * đó là những gì họ nhìn thấy ngay lúc bấm.
 */
export function renderVaultPanel(root: Element, deps: PanelDeps): void {
  root.textContent = '';

  // Đọc MỘT lần, dùng cho cả hai nửa: hai lời gọi `readActivity()` có thể trả
  // hai giá trị khác nhau, và một bảng nói "3 lời gọi" ở trên rồi liệt kê 4 mục
  // ở dưới là một bảng không ai tin nữa.
  const activity = deps.readActivity();

  if (!deps.hasConsent()) renderConsentAsk(root, deps, activity);
  renderActivity(root, deps, activity);
}
