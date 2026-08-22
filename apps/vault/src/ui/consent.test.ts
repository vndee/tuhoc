import { beforeEach, describe, expect, it } from 'vitest';
import { renderVaultPanel } from './Consent';
import type { PanelDeps } from './Consent';
import type { Activity } from '../guard';

/**
 * Bảng xác nhận, **ở lần hỏi thứ hai**.
 *
 * Task 9b thêm ngân sách ký tự: khi phiên đã gửi hết ngân sách, người gác **rút
 * xác nhận** và người dùng bị hỏi lại. Cho tới bản này, bảng phản ứng bằng cách
 * **ẩn nhật ký đi** và chỉ chừa lại cái nút — tức là nó lấy mất căn cứ đúng vào
 * lúc căn cứ đáng giá nhất.
 *
 * Điều đó phá đúng một nửa lập luận mà Task 9 dựng bảng này lên:
 * *"một nút 'cho phép' không kèm tầm nhìn vào những gì đã được gửi đi là một
 * con dấu cao su."* Và nó không phải chuyện thẩm mỹ. Người làm Task 9b đo và
 * nói thẳng: ngân sách **không chặn** được việc tuồn ghi chú, nó chỉ **định giá
 * bằng số cú bấm của con người** — nếu người dùng bấm "cho phép" mọi lần thì
 * cả 773.720 ký tự vẫn đi, chỉ tốn 7 cú bấm thay vì 1. ⇒ Toàn bộ cơ chế đứng
 * trên giả định người dùng **dừng lại ở cú bấm thứ hai hoặc thứ ba**, và thứ
 * quyết định giả định ấy đúng hay sai là **những gì họ nhìn thấy lúc bấm**.
 *
 * Ràng buộc của tệp này, phát biểu thành một câu đo được: **cú bấm thứ hai phải
 * có NHIỀU thông tin hơn cú bấm thứ nhất, không ít hơn.**
 */

const NOW = 1_700_000_000_000;

function activity(calls: Activity['calls'], denied?: Partial<Activity['denied']>): Activity {
  return {
    calls,
    denied: { needs_consent: 0, rate_limited: 0, lastAt: null, ...denied },
  };
}

function deps(over: Partial<PanelDeps> = {}): PanelDeps {
  return {
    hasConsent: () => false,
    grantConsent: () => {
      throw new Error('không được gọi trong bài kiểm này');
    },
    readActivity: () => activity([]),
    clearActivity: () => undefined,
    ...over,
  };
}

function draw(over: Partial<PanelDeps> = {}): HTMLElement {
  const root = document.createElement('div');
  renderVaultPanel(root, deps(over));
  return root;
}

let granted: number;

beforeEach(() => {
  granted = 0;
});

describe('lần hỏi THỨ HAI — nút xin xác nhận lại KHÔNG được nuốt mất nhật ký', () => {
  const spent = activity([
    { at: NOW - 60_000, chars: 19_300, providerId: 'deepseek' },
    { at: NOW - 30_000, chars: 61_200, providerId: 'deepseek' },
    { at: NOW - 5_000, chars: 39_500, providerId: 'anthropic' },
  ]);

  it('nút xác nhận VÀ nhật ký cùng có mặt', () => {
    const root = draw({ hasConsent: () => false, readActivity: () => spent });
    expect(root.querySelector('button[data-role="consent"]')).not.toBeNull();
    const text = root.textContent ?? '';
    for (const n of ['19.300', '61.200', '39.500']) {
      expect(text, `thiếu mục nhật ký ${n}`).toContain(n);
    }
    expect(text).toContain('deepseek');
    expect(text).toContain('anthropic');
  });

  it('hiện TỔNG số ký tự đã rời máy — con số dùng để quyết định, không phải ba con số rời', () => {
    const root = draw({ hasConsent: () => false, readActivity: () => spent });
    // 19.300 + 61.200 + 39.500 = 120.000 — đúng bằng ngân sách một phiên, tức
    // là đúng lý do người dùng đang bị hỏi lại.
    expect(root.textContent ?? '').toContain('120.000');
    expect(root.querySelector('[data-role="spent"]')).not.toBeNull();
  });

  it('CÚ BẤM THỨ HAI CÓ NHIỀU THÔNG TIN HƠN CÚ BẤM THỨ NHẤT — đo trực tiếp', () => {
    const first = draw({ hasConsent: () => false, readActivity: () => activity([]) });
    const second = draw({ hasConsent: () => false, readActivity: () => spent });

    const a = (first.textContent ?? '').length;
    const b = (second.textContent ?? '').length;
    expect(b).toBeGreaterThan(a);
    // …và cụ thể là nhiều hơn ở ĐÚNG chỗ: lần đầu không có tổng để mà hiện.
    expect(first.querySelector('[data-role="spent"]')).toBeNull();
    expect(second.querySelector('[data-role="spent"]')).not.toBeNull();
  });

  it('nói ra rằng đây là lần hỏi LẠI, chứ không lặp lại y nguyên lời mời lần đầu', () => {
    const first = draw({ hasConsent: () => false, readActivity: () => activity([]) });
    const second = draw({ hasConsent: () => false, readActivity: () => spent });
    expect(second.textContent ?? '').toMatch(/lần này/i);
    expect(first.textContent ?? '').not.toMatch(/lần này/i);
  });

  it('vẽ ra vẫn KHÔNG tự cấp quyền — mutant M13 của Task 9 phải vẫn chết', () => {
    draw({
      hasConsent: () => false,
      readActivity: () => spent,
      grantConsent: () => {
        granted += 1;
      },
    });
    expect(granted).toBe(0);
  });

  /**
   * Bề mặt MỚI mà thay đổi này tạo ra: dữ liệu nhật ký giờ được vẽ ở nhánh
   * CHƯA-xác-nhận, nơi trước đây không có gì được vẽ. Bẫy `innerHTML` của Task 9
   * chỉ chạy ở nhánh đã-xác-nhận, nên nó không phủ chỗ này.
   */
  it('BẪY: nhánh chưa-xác-nhận cũng dựng chữ bằng `textContent`', () => {
    const hostile = activity([
      { at: NOW, chars: 1, providerId: '<img src=x onerror="alert(1)">' },
    ]);
    const root = draw({ hasConsent: () => false, readActivity: () => hostile });
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent ?? '').toContain('<img');
  });

  it('nhật ký rỗng ⇒ vẫn đúng lời mời lần đầu, không dựng một khoảng trống khó hiểu', () => {
    const root = draw({ hasConsent: () => false, readActivity: () => activity([]) });
    expect(root.querySelector('button[data-role="consent"]')).not.toBeNull();
    expect(root.textContent ?? '').toMatch(/chưa có lời gọi nào/i);
  });

  it('sau khi đã xác nhận thì không còn nút, và nhật ký vẫn ở đó', () => {
    const root = draw({ hasConsent: () => true, readActivity: () => spent });
    expect(root.querySelector('button[data-role="consent"]')).toBeNull();
    expect(root.querySelector('[data-role="clear-log"]')).not.toBeNull();
    expect(root.textContent ?? '').toContain('120.000');
  });

  it('bộ đếm bị-từ-chối vẫn hiện ở cả hai nhánh', () => {
    const withDenials = activity(spent.calls, { rate_limited: 4, needs_consent: 2, lastAt: NOW });
    for (const consent of [false, true]) {
      const root = draw({ hasConsent: () => consent, readActivity: () => withDenials });
      expect(root.textContent ?? '', `hasConsent=${String(consent)}`).toMatch(/TỪ CHỐI 4/);
    }
  });
});
