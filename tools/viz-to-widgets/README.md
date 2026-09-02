# viz-to-widgets

Chuyển một course **format v1** (một `viz.js` chạy toàn khoá, chương đặt chỗ bằng
`<div data-viz="tên"></div>`) sang **format v2** (mỗi hình là một widget tự chứa
`widgets/<tên>/index.html`, chương đặt chỗ bằng `<div data-widget="tên"></div>`).
Luật widget: `docs/course-format.md` §4.

```bash
bun tools/viz-to-widgets/convert.ts courses/<khoá>
bun tools/tuhoc-cli/src/index.ts pack courses/<khoá> -o /tmp/<khoá>.zip
TUHOC_ADMIN_TOKEN=… bun tools/tuhoc-cli/src/index.ts publish /tmp/<khoá>.zip --server <url>
```

## Nó làm gì

- Tách `viz.js` bằng parser của TypeScript: mỗi `defineViz('tên', …)` cấp cao nhất
  là một hình; mọi câu lệnh cấp cao nhất khác là phần dùng chung, nhúng vào mọi
  widget. Chỉ sinh widget cho tên mà một chương tham chiếu (`WIDGET_ORPHAN`).
- Nhúng `packages/course-kit/runtime.js` nguyên văn (Plot, cssv, PAL, initViz…),
  cùng `widget.css`: bảng biến của reader.css sáng/tối và các luật CSS cho điều
  khiển (slider, nút, readout, legend…).
- Đổi chỗ đặt trong chương, xoá `tier` khỏi manifest, chuyển `viz.js` vào
  `.v1/viz.js` (thư mục ẩn, `pack` bỏ qua). Chạy lại được: nếu không còn `viz.js`
  thì đọc từ `.v1/viz.js`.
- Kiểm trước khi ghi đúng bốn luật máy chủ sẽ đo: ≤ 128 KiB, không dòng > 500 byte,
  không `http(s)://`, không `document.cookie`/`localStorage`/`sessionStorage`/`indexedDB`.

Đo trên khoá đầu tiên được chuyển (44 chương, 58 hình): mỗi widget 45–49 KB.

## Giới hạn đã biết

- **Theme.** Widget chạy trong `<iframe sandbox="allow-scripts" srcdoc>` — origin mờ,
  không đọc được `html[data-theme]` của trang chứa và không nhận thông điệp nào từ
  reader (`WidgetFrame.tsx` không gửi). Nên widget tối theo `prefers-color-scheme`
  của hệ điều hành. Khi người đọc chọn tối trong app nhưng hệ đang sáng (hoặc
  ngược lại), widget là một ô sáng trên trang tối. Muốn khớp thật thì reader phải
  đóng dấu theme vào `srcdoc` hoặc `postMessage` sau khi nạp — một quyết định của
  reader, chưa làm.
- **Chiều cao.** Widget báo `scrollHeight` của nó cho trang bằng
  `parent.postMessage({ type: 'tuhoc:widget-height', height }, '*')` lúc mount và
  mỗi khi `body` đổi cỡ; `WidgetFrame.tsx` chỉ nhận từ đúng khung của nó và kẹp
  160–1400px. Widget không gửi gì thì giữ 420px mặc định của `reader-layout.css`.
- **KaTeX.** `runtime.js` gọi `renderMathInElement` nếu có; trong widget không có
  KaTeX nên nhãn viết bằng `$…$` hiển thị nguyên văn. Các hình của khoá trên không
  dùng đường này.
