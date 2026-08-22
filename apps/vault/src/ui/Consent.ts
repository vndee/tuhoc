import type { Activity } from '../guard';

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
    return new Date(at).toLocaleString('vi-VN');
  } catch {
    return String(at);
  }
}

function renderActivity(root: Element, deps: PanelDeps): void {
  const activity = deps.readActivity();

  root.appendChild(el('h3', 'Trợ lý AI đã gửi đi những gì'));
  root.appendChild(
    el(
      'p',
      'Nhật ký ghi thời điểm và SỐ KÝ TỰ đã gửi. Nội dung lời nhắc không được ghi lại ở đây — '
        + 'một bản sao thứ hai của ghi chú riêng tư nằm cạnh key là điều kho khoá này từ chối tạo ra.',
    ),
  );

  if (activity.calls.length === 0) {
    root.appendChild(el('p', 'Chưa có lời gọi nào.'));
  } else {
    const list = el('ul');
    // Mới nhất lên đầu: phần đáng nhìn của một nhật ký giám sát là phần vừa xảy ra.
    for (const c of [...activity.calls].reverse()) {
      list.appendChild(
        el(
          'li',
          `${formatWhen(c.at)} · ${c.chars} ký tự đã gửi · ${c.providerId ?? 'nhà cung cấp không rõ'}`,
        ),
      );
    }
    root.appendChild(list);
  }

  const d = activity.denied;
  if (d.needs_consent > 0 || d.rate_limited > 0) {
    root.appendChild(
      el(
        'p',
        `Kho khoá đã TỪ CHỐI ${d.rate_limited} lời gọi vì quá tần suất và `
          + `${d.needs_consent} lời gọi vì chưa được xác nhận.`,
      ),
    );
  }

  const clear = el('button', 'Xoá nhật ký') as HTMLButtonElement;
  clear.type = 'button';
  clear.dataset.role = 'clear-log';
  clear.addEventListener('click', () => {
    deps.clearActivity();
    renderVaultPanel(root, deps);
  });
  root.appendChild(clear);
}

/**
 * Vẽ lại toàn bộ khung. Gọi được nhiều lần; mỗi lần dựng lại từ đầu.
 *
 * Vẽ ra **không** cấp quyền — quyền chỉ tới từ `handleConsentClick` với một sự
 * kiện đáng tin. Đó là một bài kiểm riêng, vì "mount rồi tự bật cờ" là kiểu
 * hỏng im lặng đúng bằng việc không có nút.
 */
export function renderVaultPanel(root: Element, deps: PanelDeps): void {
  root.textContent = '';

  if (!deps.hasConsent()) {
    root.appendChild(el('h3', 'Trợ lý AI muốn gọi ra ngoài bằng key của bạn'));
    root.appendChild(
      el(
        'p',
        'Trang bài học vừa yêu cầu kho khoá gọi nhà cung cấp AI. Kho khoá không cho lời gọi nào '
          + 'đi ra trước khi bạn bấm nút dưới đây, và cú bấm này chỉ có hiệu lực trong phiên hiện tại.',
      ),
    );
    const btn = el('button', 'Cho phép trong phiên này') as HTMLButtonElement;
    btn.type = 'button';
    btn.dataset.role = 'consent';
    btn.addEventListener('click', (ev) => {
      if (handleConsentClick(ev, deps)) renderVaultPanel(root, deps);
    });
    root.appendChild(btn);
    return;
  }

  renderActivity(root, deps);
}
