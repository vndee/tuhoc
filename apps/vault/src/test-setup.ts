/**
 * Sửa `localStorage` cho môi trường test của kho khoá.
 *
 * ĐO ĐƯỢC ngày 2026-08-22, Node v25.1.0 · vitest 4.1.11 · jsdom 30.0.1, trong
 * chính `apps/vault`:
 *
 *   typeof localStorage            → "object"
 *   localStorage.clear             → undefined   ⇒ TypeError khi gọi
 *   Object.getPrototypeOf(localStorage).constructor.name → "Object"
 *   window.sessionStorage instanceof Storage      → false
 *   (nhưng jsdom dựng riêng thì localStorage CHẠY: roundtrip "b",
 *    `instanceof w.Storage` → true)
 *
 * Nguyên nhân, đọc từ `node_modules/vitest/dist/chunks/index.DC7d2Pf8.js`
 * (`getWindowKeys`):
 *
 *     if (k in global) return keysArray.includes(k);
 *
 * `keysArray` (KEYS) có `"Storage"` và `"StorageEvent"` nhưng KHÔNG có
 * `"localStorage"`/`"sessionStorage"`. Node 25 định nghĩa sẵn hai global đó,
 * nên `k in global` đúng, nên vitest BỎ QUA chúng và global của Node ở lại.
 * `sessionStorage` của Node chạy trong bộ nhớ nên trông như bình thường;
 * `localStorage` của Node cần `--localstorage-file` nên suy biến thành `{}`
 * và chỉ ĐỌC nó thôi đã in cảnh báo `--localstorage-file` ra stderr.
 *
 * Kết quả: thư mục DUY NHẤT trong repo có nhiệm vụ cất một bí mật vào
 * `localStorage` lại là thư mục không có `localStorage` chạy được lúc test.
 *
 * `apps/web/src/test/setup.ts` đã gặp đúng lỗi này và vá bằng một lớp
 * `MemoryStorage` tự viết. Ở đây KHÔNG chép cách đó, vì một lý do cụ thể:
 * bài kiểm trung tâm của Task 2 cắm bẫy vào `Storage.prototype.getItem` để
 * chứng minh đường `status` không đọc ô nhớ chứa key. Một shim tự viết không
 * kế thừa `Storage`, nên bẫy sẽ KHÔNG chặn được gì và sẽ im lặng đo số không.
 *
 * Vitest phơi chính thể JSDOM ra ở `globalThis.jsdom` (`global.jsdom = dom`
 * trong `setup()` của môi trường jsdom), nên lấy được `Storage` THẬT của
 * jsdom — cùng thể hiện với `document`, cùng lớp với `globalThis.Storage`.
 */

interface JsdomHandle {
  window: { localStorage: Storage; sessionStorage: Storage };
}

const dom = (globalThis as unknown as { jsdom?: JsdomHandle }).jsdom;

if (typeof dom?.window?.localStorage?.getItem !== 'function') {
  // Hỏng ỒN ÀO, không lặng lẽ tụt xuống một bản giả. Nếu một bản vitest sau
  // này đổi tên `globalThis.jsdom`, cả bộ test kho khoá phải dừng lại để người
  // sửa nhìn vào — thay vì chạy tiếp trên một `Storage` giả mà bẫy không chặn
  // được, tức là xanh mà không đo gì. Đó đúng là hình dạng của năm cổng mù đã
  // ghi trong docs/carried-forward.md.
  throw new Error(
    'test-setup: không lấy được localStorage thật của jsdom qua globalThis.jsdom. ' +
      'Kho khoá từ chối chạy test trên một Storage giả — xem chú thích ở đầu tệp này.',
  );
}

for (const target of [globalThis, window] as const) {
  Object.defineProperty(target, 'localStorage', {
    value: dom.window.localStorage,
    writable: true,
    configurable: true,
  });
  // `sessionStorage` cũng bị Node chiếm chỗ. Kho khoá chưa dùng tới nó, nhưng
  // Task 9 ("xác nhận một lần mỗi PHIÊN") là ứng viên tự nhiên, và một
  // `sessionStorage` thuộc realm khác `Storage` là cái bẫy y hệt đang chờ sẵn.
  Object.defineProperty(target, 'sessionStorage', {
    value: dom.window.sessionStorage,
    writable: true,
    configurable: true,
  });
}
