# Bộ nhận diện — nguồn gốc

Mọi tệp biểu tượng trong thư mục này được **sinh ra**, không vẽ tay, từ đúng
một hình học: `apps/web/src/shell/Logo.tsx`. Đừng sửa chúng bằng trình đồ hoạ —
sửa component rồi sinh lại, bằng không tab trình duyệt và khung app sẽ lại trôi
ra hai hướng, đúng cái lỗi vòng này dựng ra để đóng.

| Tệp | Cỡ | Dùng ở đâu |
|---|---|---|
| `favicon.svg` | vector, tuned cho 16 | tab trình duyệt |
| `apple-touch-icon.png` | 180 | iOS, thêm vào màn hình chính |
| `icon-192.png` | 192 | manifest, `purpose: any` |
| `icon-512.png` | 512 | manifest, `purpose: any` |
| `icon-maskable-512.png` | 512 | manifest, `purpose: maskable` — mark thu về 0.52 để nằm trong vùng an toàn khi Android cắt tròn |

Hướng thiết kế và lý do từng quyết định:
`.impeccable/surfaces/apps-web-src-shell-logo-tsx.md` (seed `d402f7c9`).

**Sinh lại:** `node scripts/gen-icons.mjs` từ `apps/web` (cần `rsvg-convert`,
`brew install librsvg`). Script đọc hằng số `MARK` thẳng từ `Logo.tsx` và không
giữ bản sao nào của hình học.

Hình học nằm ở `MARK` trong `apps/web/src/shell/Logo.tsx`, không ở tệp này —
mục này chỉ tóm lại: khung `x=3.4 y=3.4 w=9.4 h=9.2` ở độ mờ `0.50` trên lưới
16; thanh **chếch bên trong** khung, tâm `x=6.2`, chạy `y=0.9 → 15.1` nên vượt
ra ngoài cả mép trên lẫn mép dưới; bề rộng nét theo cỡ render (`weightFor`).

> Mục này từng ghi `x=4.2 y=3.6 w=8.6 h=8.8` với thanh ĐÈ LÊN mép trái khung.
> Đó là một lượt sửa đã bị chủ dự án bác — nó xoá mất cạnh trái và biến khung
> thành cái ngoặc ba cạnh — và tài liệu không được cập nhật cùng lúc với mã.
> `Logo.icons.test.ts` giờ buộc tệp đã ship khớp `MARK`; tài liệu thì không có
> gì buộc, nên nếu bạn sửa hình, sửa cả đây.

`favicon.svg` có NỀN chứ không trong suốt: mark là nét mảnh, và nét mảnh trong
suốt biến mất trên thanh tab tối.
