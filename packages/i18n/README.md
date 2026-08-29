# `@tuhoc/i18n` — catalog dùng chung, KHÔNG phụ thuộc gì

Một ứng dụng đọc gói này hôm nay: `apps/web` (trang bài học). Nó ra đời cho **hai** —
Pha 1 có thêm một kho khoá ở origin riêng giữ bí mật của người học, và ràng buộc mà
gói này phải sống theo đến từ đó: mọi thứ nạp vào một origin giữ key đều là mã có
quyền đọc key, nên **danh sách phụ thuộc ở đó là bề mặt tấn công** chứ không phải
tiện nghi.

Task 16 gỡ kho khoá. Gói vẫn đứng riêng, và không phải vì quán tính: `packages/
course-format` và `tools/registry` đọc được một gói không phụ thuộc gì mà không kéo
theo React — một catalog nằm trong `apps/web/src` thì không.

⇒ Gói này chỉ chứa **hằng chuỗi và một hàm tra cứu thuần**. Không React, không DOM,
không I/O, **không một phụ thuộc runtime nào** — `package.json` khai `dependencies`
và `devDependencies` **rỗng**, nên thư mục này không có `node_modules` và
`make deps` không cài gì ở đây.

**Ràng buộc ấy có cổng, không phải chỉ có câu văn này.**
`apps/web/src/i18n/i18n.test.ts` → `describe('packages/i18n — gói KHÔNG phụ thuộc gì')`:

1. `dependencies` / `devDependencies` / `peerDependencies` phải **rỗng** (và
   `dependencies` phải **có mặt**, để xoá trường đi không làm cổng xanh);
2. tập `import`/`export … from` của **mọi** tệp nguồn ở đây phải bằng đúng
   `['./messages/en', './messages/vi', './vi']` — đọc từ **cây cú pháp**, nên một
   `import 'react'` làm cổng đỏ còn một chú thích nhắc tới React thì không;
3. thư mục này **không được có `node_modules`**.

Kiểu được kiểm miễn phí: `apps/web` alias `@tuhoc/i18n` vào `src/index.ts`, nên
`tsc -b` của app kéo gói này vào chương trình. Một khoá thiếu ở `messages/en.ts` là
**lỗi biên dịch**, không phải một chuỗi rơi ra lúc chạy.
