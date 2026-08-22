import { describe, it, expect, vi } from 'vitest';
import { handleMessage, resolveAllowedOrigin } from './main';

describe('kiểm origin', () => {
  it('bỏ qua thông điệp từ origin lạ, KHÔNG trả lời', () => {
    const reply = vi.fn();
    handleMessage(
      { origin: 'https://evil.example', data: { v: 1, id: 'a', kind: 'listProviders' },
        source: { postMessage: reply } } as unknown as MessageEvent,
      { allowedOrigin: 'http://localhost:5173' },
    );
    expect(reply).not.toHaveBeenCalled();
  });

  it('trả lời origin đúng', () => {
    const reply = vi.fn();
    handleMessage(
      { origin: 'http://localhost:5173', data: { v: 1, id: 'a', kind: 'listProviders' },
        source: { postMessage: reply } } as unknown as MessageEvent,
      { allowedOrigin: 'http://localhost:5173' },
    );
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][1]).toBe('http://localhost:5173'); // targetOrigin, KHÔNG phải '*'
  });

  it('không bao giờ gửi với targetOrigin "*"', () => {
    const reply = vi.fn();
    handleMessage(
      { origin: 'http://localhost:5173', data: { v: 1, id: 'a', kind: 'listProviders' },
        source: { postMessage: reply } } as unknown as MessageEvent,
      { allowedOrigin: 'http://localhost:5173' },
    );
    // Không có dòng này, bài kiểm sẽ XANH VACUOUS: một `handleMessage` không
    // gửi gì cả cũng đi qua vòng lặp rỗng. Cùng hình dạng với năm cổng mù đã
    // ghi trong docs/carried-forward.md — cổng đo thứ nó với tới được và im
    // lặng đúng chỗ nó không với tới.
    expect(reply.mock.calls.length).toBeGreaterThan(0);
    for (const call of reply.mock.calls) expect(call[1]).not.toBe('*');
  });

  // Ràng buộc thật không phải "không trả lời origin lạ" mà là "origin lạ không
  // gây ra BẤT KỲ ảnh hưởng nào". `expect(reply).not.toHaveBeenCalled()` chỉ
  // chứng minh vế đầu: một cài đặt đọc `event.data`, ghi nhật ký, đếm số lần
  // thử, rồi mới quyết định im lặng vẫn đi qua nó — và cái đếm đó là một kênh
  // thông tin. Bẫy dưới đây đo ĐÚNG thứ tự: origin được kiểm trước khi có ai
  // chạm vào payload.
  it('KHÔNG ĐỌC event.data (và cả event.source) khi origin lạ', () => {
    let dataRead = false;
    let sourceRead = false;
    const reply = vi.fn();
    const event = {
      origin: 'https://evil.example',
      get data() { dataRead = true; return { v: 1, id: 'a', kind: 'listProviders' }; },
      get source() { sourceRead = true; return { postMessage: reply }; },
    } as unknown as MessageEvent;

    handleMessage(event, { allowedOrigin: 'http://localhost:5173' });

    expect(dataRead).toBe(false);
    expect(sourceRead).toBe(false);
    expect(reply).not.toHaveBeenCalled();
  });
});

// `main.ts` của kế hoạch đọc `VITE_APP_ORIGIN` bên trong khối khởi động, và khối
// đó bị `!import.meta.env.VITEST` che đi khi chạy test — nghĩa là điều tuyệt đối
// thứ ba ("kho khoá từ chối chạy khi không biết tin ai") KHÔNG có bài kiểm nào.
// Tách phép giải nghĩa ra thành hàm để nó kiểm được.
describe('resolveAllowedOrigin', () => {
  it('trả về origin khi cấu hình hợp lệ', () => {
    expect(resolveAllowedOrigin({ VITE_APP_ORIGIN: 'http://localhost:5173' }))
      .toBe('http://localhost:5173');
    expect(resolveAllowedOrigin({ VITE_APP_ORIGIN: 'https://tuhoc.example' }))
      .toBe('https://tuhoc.example');
  });

  it('NÉM khi thiếu — kho khoá từ chối chạy khi không biết tin ai', () => {
    expect(() => resolveAllowedOrigin({})).toThrow(/VITE_APP_ORIGIN/);
    expect(() => resolveAllowedOrigin({ VITE_APP_ORIGIN: '' })).toThrow(/VITE_APP_ORIGIN/);
    expect(() => resolveAllowedOrigin({ VITE_APP_ORIGIN: '   ' })).toThrow(/VITE_APP_ORIGIN/);
  });

  it('NÉM với "*" — giá trị này cũng là targetOrigin của mọi hồi đáp', () => {
    // `handleMessage` dùng chính `allowedOrigin` làm `targetOrigin` khi gửi.
    // Một cấu hình `*` lọt qua đây sẽ biến mọi hồi đáp thành phát-thanh-công-cộng,
    // đúng thứ Global Constraints cấm tuyệt đối.
    expect(() => resolveAllowedOrigin({ VITE_APP_ORIGIN: '*' })).toThrow(/VITE_APP_ORIGIN/);
  });

  it('NÉM khi có dấu / cuối hoặc có đường dẫn — `event.origin` không bao giờ có', () => {
    // Đây là chế độ hỏng nguy hiểm nhất của cấu hình này vì nó HỎNG ÂM THẦM:
    // `event.origin` của trình duyệt luôn là `scheme://host[:port]`, nên
    // `'http://localhost:5173/'` không bao giờ bằng nó. Mọi thông điệp bị bỏ
    // đúng theo thiết kế, và triệu chứng duy nhất người dùng thấy là "AI không
    // trả lời". Hỏng ồn ào lúc khởi động rẻ hơn nhiều.
    expect(() => resolveAllowedOrigin({ VITE_APP_ORIGIN: 'http://localhost:5173/' })).toThrow(/VITE_APP_ORIGIN/);
    expect(() => resolveAllowedOrigin({ VITE_APP_ORIGIN: 'https://tuhoc.example/app' })).toThrow(/VITE_APP_ORIGIN/);
    expect(() => resolveAllowedOrigin({ VITE_APP_ORIGIN: 'tuhoc.example' })).toThrow(/VITE_APP_ORIGIN/);
  });
});
