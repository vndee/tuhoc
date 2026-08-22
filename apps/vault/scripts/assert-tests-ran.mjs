// Nửa thứ hai của cổng `make test-vault`. Mã thoát của vitest MỘT MÌNH không đủ
// để kết luận cổng này đã đo cái gì.
//
// Đo được ngày 2026-08-22 trên vitest 4.1.11, trong chính apps/vault:
//
//   A) include trỏ vào một glob không khớp tệp nào  → vitest thoát 1  ✅ đỏ sẵn
//   B) mọi `describe` bị đổi thành `describe.skip`  → vitest thoát 0  ❌ MÙ
//      ("Test Files 1 skipped (1) · Tests 8 skipped (8)", numPassedTests = 0)
//
// (B) là đúng hình dạng của năm cổng mù đã ghi trong docs/carried-forward.md:
// cổng vẫn chạy, vẫn báo xanh, chỉ là không nhìn vào thứ nó tưởng đang nhìn. Ở
// một kho khoá — nơi bài kiểm quan trọng nhất là "origin lạ không gây ra bất kỳ
// ảnh hưởng nào" — một `.skip` lọt qua im lặng là điều không chấp nhận được.
//
// Vì vậy cổng đỏ khi: 0 test ĐẠT, hoặc có bất kỳ test nào bị bỏ qua/`todo`.
// `numTotalTests` KHÔNG dùng được làm phép đo: ở trường hợp (B) nó vẫn bằng 8.
//
// Tệp tóm tắt bị `rm -f` ngay trước khi vitest chạy (xem Makefile), nên nếu ai
// đó gỡ cờ `--reporter=json` thì tệp không tồn tại và cổng đỏ ở đây thay vì đọc
// nhầm kết quả của lần chạy trước.

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('assert-tests-ran: thiếu đường dẫn tệp tóm tắt.');
  process.exit(1);
}

let summary;
try {
  summary = JSON.parse(readFileSync(path, 'utf8'));
} catch (err) {
  console.error(
    `assert-tests-ran: KHÔNG đọc được ${path} (${err.message}).\n` +
    'Cổng đỏ chứ không bỏ qua: không có tệp này thì không ai biết bộ test đã chạy hay chưa.',
  );
  process.exit(1);
}

const passed = summary.numPassedTests ?? 0;
const failed = summary.numFailedTests ?? 0;
const pending = summary.numPendingTests ?? 0;
const todo = summary.numTodoTests ?? 0;
// `numTotalTestSuites`, không phải số TỆP: vitest đếm cả `describe` lồng nhau ở
// đây. Gọi đúng tên nó để dòng census này không tự nói dối.
const suites = summary.numTotalTestSuites ?? 0;

console.log(
  `test-vault: ${suites} bộ · ${passed} đạt · ${failed} hỏng · ${pending} bỏ qua · ${todo} todo`,
);

const problems = [];
if (passed === 0) problems.push('KHÔNG có test nào ĐẠT — cổng này vừa đo số không.');
if (failed > 0) problems.push(`${failed} test hỏng.`);
if (pending > 0) problems.push(`${pending} test bị bỏ qua (.skip) — kho khoá không cho phép.`);
if (todo > 0) problems.push(`${todo} test ở trạng thái .todo — kho khoá không cho phép.`);

if (problems.length > 0) {
  console.error('assert-tests-ran: ' + problems.join(' '));
  process.exit(1);
}
