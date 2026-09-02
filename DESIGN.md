---
name: Tự học — khung app
description: Giáo trình LaTeX lề rộng — trang typeset trắng/mực với một xanh định lý; áp dụng cho running head, /, /courses, /progress (KHÔNG áp dụng cho reader).
colors:
  paper: "#ffffff"
  ink: "#101828"
  ink-2: "#475467"
  ink-3: "#667085"
  rule: "#eaecf0"
  rule-strong: "#d0d5dd"
  theorem-blue: "#0b5fa5"
  theorem-blue-soft: "#d9e8f5"
  paper-night: "#171717"
  ink-night: "#ececec"
  ink-2-night: "#b4b4b4"
  ink-3-night: "#8c8c8c"
  rule-night: "#333333"
  rule-strong-night: "#474747"
  theorem-blue-night: "#4d92cc"
typography:
  display:
    fontFamily: "Charis SIL, Charter, Iowan Old Style, Georgia, Times New Roman, serif"
    fontSize: "clamp(30px, 3.4vw, 40px)"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Charis SIL, Charter, Iowan Old Style, Georgia, Times New Roman, serif"
    fontSize: "clamp(26px, 3vw, 34px)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  sentence:
    fontFamily: "Charis SIL, Charter, Iowan Old Style, Georgia, Times New Roman, serif"
    fontSize: "clamp(22px, 2.6vw, 30px)"
    fontWeight: 400
    lineHeight: 1.35
  title:
    fontFamily: "Charis SIL, Charter, Iowan Old Style, Georgia, Times New Roman, serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.25
  lede:
    fontFamily: "Charis SIL, Charter, Iowan Old Style, Georgia, Times New Roman, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.5
    fontStyle: "italic"
  body:
    fontFamily: "Charis SIL, Charter, Iowan Old Style, Georgia, Times New Roman, serif"
    fontSize: "15.5px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo Narrow, Arial Narrow, Roboto Condensed, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.08em"
    textTransform: "uppercase"
  label-nav:
    fontFamily: "Archivo Narrow, Arial Narrow, Roboto Condensed, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    letterSpacing: "0.08em"
    textTransform: "uppercase"
  numeral:
    fontFamily: "Archivo Narrow, Arial Narrow, Roboto Condensed, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    fontVariation: "tabular-nums"
rounded:
  none: "0"
spacing:
  row: "7px"
  sm: "8px"
  md: "12px"
  lg: "14px"
  head: "30px"
  section: "36px"
  block: "40px"
components:
  action-chapter:
    textColor: "{colors.ink}"
    typography: "{typography.headline}"
    rounded: "{rounded.none}"
    padding: "0"
  action-chapter-verb:
    textColor: "{colors.theorem-blue}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  link-doc:
    textColor: "{colors.theorem-blue}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  heading-label:
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    padding: "0 0 8px"
    rounded: "{rounded.none}"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label-nav}"
    height: "36px"
    padding: "0 2px"
    rounded: "{rounded.none}"
  nav-link-active:
    backgroundColor: "transparent"
    textColor: "{colors.theorem-blue}"
    typography: "{typography.label-nav}"
    height: "36px"
    rounded: "{rounded.none}"
  running-head:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    height: "64px"
    padding: "0 16px"
    rounded: "{rounded.none}"
  toc-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "7px 0"
    rounded: "{rounded.none}"
  margin-note:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "12px 0 14px"
    rounded: "{rounded.none}"
  rule-bar:
    backgroundColor: "{colors.rule}"
    height: "2px"
    rounded: "{rounded.none}"
  rule-bar-fill:
    backgroundColor: "{colors.theorem-blue}"
    height: "2px"
    rounded: "{rounded.none}"
---

# Design System: Tự học — khung app

> Ghi lại **sau khi dựng xong**, từ mã đã ship (2026-09-02, hướng "Giáo trình LaTeX, lề rộng", seed 57dcb485, chế độ Operate). Mọi giá trị dưới đây đọc ra từ `apps/web/src/styles/tokens.css`, `index.css`, `home.css`, `courses.css`, `shell-modes.css` và ảnh chụp ở `.impeccable/review/`. Frontmatter là chuẩn; văn xuôi chỉ giải thích chỗ dùng.
>
> **Phạm vi.** Hệ này bao phủ running head (`#topbar`), `/` (Học tiếp), `/courses`, `/progress`. **Reader** (`packages/course-kit/reader.css`, trang `/c/:courseId/:chapterId`) là một bề mặt riêng, chưa đụng tới, có `--serif`/`--sans` và bảng màu giấy ấm của riêng nó; không mô tả ở đây và không được "sửa cho khớp". Cài đặt, Admin, Đăng nhập vẫn đứng trên `app-screens.css` cũ (xem cuối tệp).

## Overview

**Creative North Star: "Giáo trình LaTeX, lề rộng"**

Khung app là một **trang giáo trình đã typeset**, không phải một dashboard. Giấy trắng thuần, mực gần đen, một cột chính và một cột lề thật; chữ thân là serif có chân (Charis SIL — hậu duệ Charter, có đủ dấu tiếng Việt), chữ nhãn là sans hẹp (Archivo Narrow) và chỉ đứng ở lề, đầu mục và running head. Phân cấp bằng **cỡ chữ, hairline và khoảng trắng** — không thẻ, không bóng, không viền màu, không bo góc. Một màu nhấn duy nhất, xanh "hộp định lý", dành cho hành động và mục đang chọn.

Đây là thế giới của chế độ *Operate*: người quay lại một chương khó lần thứ n, cần thấy ngay mình dừng đâu và nghĩ gì. Hành động chính của trang chủ vì thế **không phải một nút màu** mà là tên chương dở, một liên kết serif cỡ lớn với động từ run-in đứng trước — như `\paragraph{Đọc tiếp}`. Trang tiến độ mở bằng một **câu tiếng Việt hoàn chỉnh**, không phải ba ô số liệu. Chuyển động chỉ có một: đường gạch chân hairline hiện lên trong 150ms.

Chế độ tối là **"đêm của trình đọc PDF"**: đảo giấy/mực sang xám trung tính (không phải slate ngả xanh của kit dashboard), giữ nguyên một xanh nhấn nâng một bậc để đọc được. Công tắc là `html[data-theme]`, không bao giờ là `prefers-color-scheme`.

Những gì hệ này **từ chối có chủ ý** (đã xác nhận qua hợp đồng hướng và vòng kết thúc): dashboard thẻ–KPI–tím; eyebrow/kicker trên tiêu đề; số thứ tự trang trí (`01`, `02`); nút màu cho hành động chính; Inter/IBM Plex trong khung app.

**Key Characteristics:**
- Trung tính + đúng MỘT màu nhấn (#0b5fa5 sáng / #4d92cc tối).
- Serif là thân, sans hẹp là nhãn — hai địa phận không chồng lên nhau.
- Phẳng tuyệt đối: hairline `1px` thay cho mọi thẻ, bóng và viền màu.
- Hairline **mực** kết đầu mục (`\hrule`), hairline **xám** ngăn hàng.
- Lưới 2fr/1fr với lề thật; dưới 900px lề xếp xuống (riêng `/progress` lề lên trước).
- Một ngữ pháp chuyển động: `text-decoration-color`/`color` 150ms ease-out.
- Tối = đêm PDF, xám trung tính, công tắc tường minh.

## Colors

Bảng màu là **Restrained**: giấy, ba bậc mực, hai bậc kẻ, và một xanh định lý — trong cả hai chế độ.

### Primary
- **Xanh định lý** (`theorem-blue`, brand-600): màu nhấn duy nhất của khung. Dùng cho: động từ run-in "Đọc tiếp", chương *kế tiếp* trong mục lục, mục điều hướng đang chọn, đường gạch chân khi hover/focus, viền focus 1px, phần tô của thanh tiến độ 2px, bậc đậm nhất của lịch năm, dấu ✓ "Đã đọc". Không bao giờ tô nền một vùng lớn, không tô nút.
- **Xanh định lý mềm** (`theorem-blue-soft`, brand-100): `--accent-soft`, chỉ còn dùng ở các màn kế thừa (hover của Cài đặt/Admin); khung `.doc` không dùng.
- **Xanh định lý đêm** (`theorem-blue-night`, brand-400): cùng vai, trong `html[data-theme='dark']`. Nâng một bậc vì brand-600 tụt dưới ngưỡng tương phản trên #171717.

Thang đầy đủ brand-25…900 nằm ở `tokens.css`; khung app chỉ chạm hai bậc 600 và 400. Các bậc xen giữa của lịch nhiệt không lấy từ thang mà pha bằng `color-mix(in srgb, var(--accent) 28% | 50% | 74%, var(--page))` — nên tự đúng ở cả hai chế độ.

### Neutral
- **Giấy** (`paper`, `--page`): nền của trang **và** của running head — một tờ giấy, không phải hai. Sáng #ffffff; tối #171717 (nghịch đảo của mực, hạ một bậc để không đen tuyền).
- **Mực** (`ink`, `--ink`): tiêu đề, tên chương, thân ghi chú, câu tiến độ, hairline `\hrule` dưới đầu trang và đầu mục, wordmark. Sáng gray-900; tối #ececec (không trắng tinh — giấy đêm không loé).
- **Mực 2** (`ink-2`, `--ink-2`): câu dẫn nghiêng, dòng meta, mô tả khoá, trích đoạn ghi chú, chương đã đọc, mục điều hướng ở trạng thái nghỉ.
- **Mực 3** (`ink-3`, `--ink-3`): nhãn sans (`.lbl`, `.doc-h`), số mục, chú giải, dấu phân cách "·", câu trạng thái nghiêng.
- **Kẻ** (`rule`, `--rule`): hairline ngăn hàng (mục lục, ghi chú, danh mục khoá, hàng tiến độ), nền thanh 2px, viền 1px của nhãn công thức, viền inset của ô lịch không rõ.
- **Kẻ đậm** (`rule-strong`, `--rule-strong`): gạch chân nghỉ của liên kết tên khoá trong dòng meta; màu dự phòng cho ô vuông ghi chú không có màu bút.

Bộ `*-night` là cùng vai trong chế độ tối. Không có gray-950 (#0c111d) ở bất kỳ đâu trong khung: nó ngả xanh.

### Named Rules
**Quy tắc Một mực nhấn.** Khung app có đúng một màu ngoài thang xám. Nó chỉ xuất hiện trên thứ *bấm được* hoặc *đang được chọn*; mọi thứ khác là mực. Nếu một màn cần màu thứ hai, đó là dấu hiệu màn ấy đang muốn thành dashboard.

**Quy tắc Đêm PDF.** Tối là đảo giấy/mực sang xám **trung tính** (#171717 / #ececec / #333333), nhấn nâng đúng một bậc (brand-600 → brand-400). Không slate, không xanh tím, không `prefers-color-scheme`. Mọi màu của khung là token của `index.css`, nên `home.css`/`courses.css`/`shell-modes.css` không được chứa một luật `[data-theme]` nào.

**Quy tắc Giấy một tờ.** `--page` và nền running head là cùng một giá trị. Không có "surface" thứ hai trong khung `.doc`; `--panel` (gray-50) chỉ là nền của điều khiển ở Cài đặt/Admin, không phải giấy.

## Typography

**Display/Body Font:** Charis SIL (dự phòng Charter, Iowan Old Style, Georgia) — `--font-serif`, nạp qua `@fontsource`, subset `vietnamese`.
**Label Font:** Archivo Narrow (dự phòng Arial Narrow, Roboto Condensed, system-ui) — `--font-sans`.
**Mono:** `--font-mono` (ui-monospace stack) — khai báo, chưa dùng trong khung.

**Character:** Serif thường, không đậm, nhấn bằng **cỡ** — trang typeset không có bold heading. Sans hẹp viết hoa có tracking đứng cạnh serif lớn như chú thích ở lề: nhỏ, đều, không tranh giọng. Hai họ chữ không bao giờ đổi vai.

### Hierarchy
- **Display** (400, `clamp(30px, 3.4vw, 40px)`, 1.1, -0.01em): tiêu đề trang (`.doc-title`) — "Học tiếp", "Khoá học", "Tiến độ". `text-wrap: balance`.
- **Headline** (400, `clamp(26px, 3vw, 34px)`, 1.15, -0.01em): tên chương trong khối Tiếp tục (`.cont-chapter`) — hành động chính của `/`. Cũng dùng cho tiêu đề trạng thái rỗng ở 26px.
- **Sentence** (400, `clamp(22px, 2.6vw, 30px)`, 1.35): câu mở đầu `/progress` ("Bạn đã học 11 phút, với chuỗi 3 ngày liên tục."), `max-width: 34em`, `text-wrap: pretty`.
- **Title** (400, 22px, 1.25): tên khoá trong danh mục `/courses`. Biến thể nhỏ: 17px cho tên khoá ở hàng tiến độ, 16.5px cho tiêu đề chương trong mục lục.
- **Lede** (400 *italic*, 17px, 1.5, `--ink-2`): câu dẫn dưới tiêu đề trang, `max-width: 60ch`. Cùng giọng nghiêng cho trích đoạn ghi chú (14.5px) và câu trạng thái/đang tải (16px, `--ink-3`) — nghiêng = `\emph`, "đây là lời nói, không phải giao diện".
- **Body** (400, 15.5px, 1.5): dòng meta, thân ghi chú, mô tả khoá (`max-width: 62ch`), hàng trọng số. Đo 56–62ch.
- **Label** (600, 12px, 0.08em, UPPERCASE, `--ink-3`): `.lbl` và `.doc-h` — tên phần trong mục lục, đầu cột lề, đầu mục trong cột chính. Động từ run-in dùng cùng kiểu ở 12.5px và màu nhấn.
- **Label-nav** (600, 13px, 0.08em, UPPERCASE): ba mục running head, nút tìm/đổi giao diện, bộ chọn ngôn ngữ, hai chữ cái tài khoản.
- **Numeral** (500, 12.5px, `tabular-nums`, `--ink-3`): số mục "1.2" trong mục lục, phần trăm, số chương, phút. Số mục trong headline là `0.5em` của tên chương.

### Named Rules
**Quy tắc Sans ở lề.** Sans hẹp chỉ cho nhãn, số mục, đầu cột, running head và điều khiển. Không một đoạn văn, tên chương, mô tả hay câu meta nào được đặt bằng sans. Kiểm: nếu câu có động từ và kết bằng dấu chấm, nó là serif.

**Quy tắc Run-in, không eyebrow.** Không có dòng nhãn nào đứng *trên* một tiêu đề. Khi tiêu đề cần một động từ hay một số, chúng đứng **trong** cùng thẻ heading, cùng dòng, cỡ nhỏ hơn (`.cont-verb` 12.5px sans nhấn, `.cont-num` 0.5em) — như `\paragraph{}`. Tên trợ năng của liên kết vẫn đọc liền "Đọc tiếp 1.2 Tên chương".

**Quy tắc Không đậm.** Heading serif là weight 400. Phân cấp làm bằng cỡ (40 → 34 → 22 → 17 → 16.5) và hairline, không bằng độ đậm. Sans 600 ở 12–13px là ngoại lệ duy nhất, vì chữ hẹp viết hoa cỡ nhỏ cần nét để đọc.

## Layout

**Khung `.doc`**: `max-width: 72rem`, căn giữa, không nền riêng — đứng thẳng trên giấy. Đầu trang `.doc-head` (`padding: 10px 0 18px`, `border-bottom: 1px solid var(--ink)`, `margin-bottom: 30px`): tiêu đề, câu dẫn nghiêng, rồi một hairline **mực** — chính là `\hrule` dưới đầu trang.

**Thân hai cột** `.doc-body`: `grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)`, `column-gap: clamp(28px, 5vw, 64px)`, `align-items: start`. Cột chính (2fr) mang nội dung; **cột lề (1fr) là lề thật** — nơi của ghi chú gần đây (`/`), chọn năm (`/progress`). Lề không phải sidebar: không nền, không viền, chỉ một đầu mục có hairline mực.

**Dưới 900px**: một cột, `row-gap: 40px`. Ở `/` lề xếp *sau* cột chính (ghi chú đứng sau khối Tiếp tục). Ở `/progress` lề xếp *trước* (`order: -1`) vì "Chọn năm" điều khiển mọi thứ phía dưới; danh sách năm chuyển sang hàng ngang. Lịch 53 tuần giữ ô 11px thật và **cuộn ngang** trong `.prog-cal` (một tờ lịch năm không co, nó lật); chỉ hiện nhãn tháng lẻ; chú giải `position: sticky; left: 0`. Hàng trọng số: tên khoá chiếm trọn hàng và xuống dòng, thanh + % xuống hàng dưới — dữ liệu không nhường chỗ cho minh hoạ.

**Running head** (`#topbar`): cao 64px, `padding: 0 16px` (biến `--topbar-pad-x`, dùng chung với máng trái của reader), `gap: 10px`. Dưới 980px: `height: auto; min-height: 56px`, xuống dòng, hàng dưới là ba mục điều hướng chiếm trọn bề ngang (cuộn ngang, ẩn thanh cuộn); wordmark chữ ẩn, chỉ còn mark.

**Nhịp dọc** (đo trong `home.css`): hàng danh sách `7px 0`; ghi chú và hàng tiến độ `12px 0 14px`; mục khoá `16px 0 18px`; đầu mục `margin-bottom: 12px`, `padding-bottom: 8px`; khoảng giữa phần trong mục lục 20px; dưới đầu trang 30px; giữa các khối `/progress` 36px; dưới khối Tiếp tục 40px. Khoảng trên một heading luôn lớn hơn khoảng dưới.

**Lưới nội bộ**: hàng mục lục `3.4em minmax(0,1fr) auto` (số / tiêu đề / dấu), gap 10px, canh baseline; hàng trọng số `minmax(0,1fr) minmax(80px,160px) 3.2em`; lịch năm `repeat(53, minmax(0,1fr))` × 7 hàng, gap 3px, ô `aspect-ratio: 1`.

## Elevation & Depth

**Không có bóng, không có lớp.** Khung app là một tờ giấy phẳng; mọi thứ đứng trực tiếp trên `--page`. Chiều sâu duy nhất được diễn tả là *thứ tự đọc*, làm bằng ba công cụ: cỡ chữ, hairline `1px`, khoảng trắng. Running head không phải một tấm chrome đặt lên trang — nó là dòng đầu của trang, cùng màu giấy, chỉ ngăn bằng một hairline mực (`\headrule`).

Hai dạng "viền" duy nhất tồn tại: `1px solid var(--ink)` (kết đầu trang, đầu mục — mang nghĩa cấu trúc) và `1px solid var(--rule)` (ngăn hàng, viền nhãn công thức, `box-shadow: inset 0 0 0 1px var(--rule)` cho ô lịch chưa rõ — đây là cách vẽ hairline không chiếm chỗ, không phải bóng).

`tokens.css` còn khai báo `--shadow-xs…xl` và `--shadow-ring-*` từ thời Untitled UI; khung `.doc` và running head **không dùng** bất kỳ cái nào (`box-shadow: none` được đặt tường minh trên các điều khiển của running head). Chúng thuộc về màn kế thừa, không phải hệ này.

### Named Rules
**Quy tắc Không thẻ.** Không `box-shadow`, không `border-radius`, không nền khác màu giấy, không `border-left` màu quanh một nhóm nội dung trong khung `.doc` và running head. Muốn nhóm thì kẻ một hairline hoặc thêm khoảng trắng. Ô vuông 9px màu bút tô ở ghi chú lề là *dữ liệu* (màu bút của chính ghi chú), không phải trang trí — và nó cũng vuông góc.

**Quy tắc `\hrule`.** Kẻ mực (`--ink`) cho ranh giới cấu trúc: dưới đầu trang, dưới đầu mục có nhãn. Kẻ xám (`--rule`) cho ranh giới lặp: giữa các hàng của một danh sách. Không có kẻ trên đầu danh sách ngay dưới `.doc-head` (hai đường song song đọc như lỗi — đã đo).

## Shapes

**Góc vuông tuyệt đối** (`border-radius: 0`) — trên ô lịch, thanh 2px, ô vuông màu ghi chú, nhãn công thức, điều khiển running head (bộ chọn ngôn ngữ, nút tìm, tài khoản). Không viên, không đĩa, không pill.

**Đường là hình dạng chính**: hairline 1px cho ranh giới; **đường kẻ 2px** (`\rule`) cho tiến độ — nền `--rule`, phần tô `--accent`, không bo, không viên, con số tabular đứng cạnh. Gạch chân liên kết là `text-decoration` 1px với `text-underline-offset` 0.12–0.14em (bám baseline serif), 6px cho nút năm, 9px cho mục điều hướng đang chọn.

**Focus** là một viền `outline: 1px solid var(--accent)` với `outline-offset` 3–6px — cùng hairline, chỉ đứng cách ra. Không vòng 4px, không glow.

Ô lịch là hình vuông (`aspect-ratio: 1`), 11px ở màn hẹp; tô bằng bốn bậc nhấn pha với giấy, ô không học là `color-mix(var(--ink) 8%, var(--page))`, ô ngoài năm là trong suốt.

## Components

### Hành động chính — tên chương (`.cont-*`)
Không có nút. Hành động chính của `/` là một liên kết khối (`.cont-link`) bọc một `<h2 class="cont-chapter">` gồm ba span cùng dòng, canh baseline, `gap: 6px 14px`:
- **Động từ run-in** (`.cont-verb`): sans 12.5px 600, 0.08em, UPPERCASE, màu nhấn, nâng `top: -0.15em` để baseline chữ hoa nhỏ ngồi đúng baseline serif lớn.
- **Số chương** (`.cont-num`): sans `0.5em`, 600, `--ink-3`, tabular.
- **Tên chương** (`.cont-title`): serif headline, gạch chân 1px `transparent`.
- **Hover/Focus:** gạch chân của `.cont-title` chuyển sang `--accent` trong 150ms ease-out; `focus-visible` thêm `outline: 1px solid var(--accent); outline-offset: 6px`.
- **Dòng meta** (`.cont-meta`): một CÂU serif 15.5px `--ink-2`, `margin-top: 14px`, tabular: tên khoá (liên kết `.cont-course`, gạch chân `--rule-strong` → nhấn khi hover) · số chương đã đọc · phút đã học. Serif vì đây là văn, không phải nhãn.

### Liên kết trong văn bản (`.doc-link`)
Màu nhấn, gạch chân 1px, offset 0.14em, màu gạch = nhấn ở 55% (`color-mix`), hover/focus lên 100% trong 150ms. `.doc a { border-bottom: none }` gỡ gạch mờ của reader.css để đường gạch bám baseline serif.

### Nhãn và đầu mục (`.lbl`, `.doc-h`)
Sans 12px 600, 0.08em, UPPERCASE, `--ink-3`. `.doc-h` thêm `padding-bottom: 8px; border-bottom: 1px solid var(--ink); margin-bottom: 12px` — đầu mục có `\hrule` mực. `.lbl` trần cho tên phần trong mục lục (không kẻ). Cả hai cần tiền tố `#app:not(.reading) #content` khi là thẻ heading (xem Quy tắc Hai id).

### Mục lục (`.toc-*`)
Danh sách không dấu, mỗi chương một hàng lưới `3.4em / 1fr / auto`, `padding: 7px 0`, hairline `--rule` dưới. Số mục sans 12.5px 500 tabular `--ink-3`; tiêu đề serif 16.5px 1.4 với gạch chân ẩn → nhấn khi hover (150ms cả `text-decoration-color` và `color`). Trạng thái: `.is-done` tiêu đề `--ink-2` + dấu ✓ sans 12px màu nhấn "Đã đọc"; `.is-next` tiêu đề màu nhấn + chữ "Tiếp theo". Không phần trăm (tiến độ theo chương là nhị phân — ghi ở brief).

### Ghi chú lề (`.mnote-*`)
Không thẻ, không viền trái. Mỗi ghi chú `padding: 12px 0 14px`, hairline `--rule` dưới. Thứ tự: ô vuông 9px màu bút tô (`--mnote-color` lấy từ `--s1/--s3/--s4/--s5` của reader, dự phòng `--rule-strong`) + trích đoạn serif *nghiêng* 14.5px `--ink-2` (là liên kết mở CHƯƠNG, gạch chân ẩn → nhấn khi hover cả hàng); thân ghi chú serif thẳng 15.5px `--ink` (`pre-wrap`); hàng meta sans 12px `--ink-3` với nhãn "Mở chương" là `.doc-link`. Nhãn công thức `.mnote-formula`: sans 10.5px UPPERCASE 0.06em, viền `1px solid var(--rule)`, `padding: 0 4px`, vuông.

### Danh mục khoá (`.courses-*`)
Danh sách không đánh số. Mỗi mục là một liên kết khối `padding: 16px 0 18px`, hairline `--rule` dưới; tên khoá serif 22px 400 (gạch chân ẩn → nhấn khi hover), mô tả serif 15.5px `--ink-2` `max-width: 62ch`, `margin-top: 6px`. Không bìa, không monogram, không kẻ đầu danh sách.

### Tiến độ (`.prog-*`)
- **Câu mở đầu** `.prog-sentence`: serif `clamp(22px, 2.6vw, 30px)`, 1.35, `--ink`, `margin-bottom: 36px`. Đứng trước mọi số liệu.
- **Thanh 2px** `.prog-bar`/`.prog-weight-bar`: `height: 2px; background: var(--rule)`, phần tô `var(--accent)`, không bo. Số đứng cạnh bằng sans 12.5–13px tabular.
- **Lịch năm** `.prog-cal-*`: 53 cột × 7 hàng, ô vuông góc, năm bậc nhấn (`l0` mực 8% trên giấy; `l1–l3` nhấn 28/50/74% pha giấy; `l4` nhấn thuần), chưa rõ = inset hairline, ngoài năm = trong suốt. Nhãn tháng sans 11px UPPERCASE 0.04em `--ink-3`. Chú giải sans 11.5px với ô 11px. Hình dạng thuộc `.prog-cal-cell`, màu thuộc `.prog-heat-l*` — không trộn.
- **Chọn năm** `.prog-year-btn`: nút không nền không viền, sans 15px 500 tabular `--ink-2`, gạch chân offset 6px ẩn; hover `--ink`; `.on` màu nhấn + gạch nhấn; focus outline 1px offset 4px. Đứng ở cột lề.
- **Hàng khoá** `.prog-row`: `padding: 12px 0 14px`, hairline dưới; tên serif 17px liên kết, số chương sans 13px `--ink-2` tabular canh phải, thanh 2px, dòng phút sans 12.5px `--ink-3`.

### Running head (`#topbar`, `.tn-*`)
- **Nền** `var(--page)`, `border-bottom: 1px solid var(--ink)` — không bóng, không màu khác giấy.
- **Wordmark** `.tn-wordmark`: serif 18px 400, `--ink`, tracking 0. (Mark bên trái là placeholder, xem cuối tệp.)
- **Mục điều hướng** `#topbar .tn-link`: inline-flex 36px cao, `padding: 0 2px; margin: 0 10px`, sans 13px 600 0.08em UPPERCASE, `--ink-2`, `color 150ms ease-out`; hover `--ink`; `.is-active` màu nhấn + `text-decoration: underline 1px; text-underline-offset: 9px`; focus outline 1px offset 4px. Không nền, không viên.
- **Cụm phải** (`.tb-btn`, `#lang-select`, `.tn-account`): cùng ngữ pháp — cao 32px, `border: 0; border-radius: 0; background: transparent; box-shadow: none`, sans 13px 600 UPPERCASE `--ink-2`, hover `--ink`, focus outline 1px offset 3px. Biểu tượng là nét (SVG stroke), tài khoản là hai chữ cái đầu bằng chữ, không đĩa tô màu. Chỉ trong `#app:not(.reading)` — thanh của reader giữ nguyên.

### Trạng thái rỗng / đang tải / lỗi
Một đoạn văn, không phải thẻ: `.home-note`/`.prog-note`/`.courses-note` serif nghiêng 16px `--ink-3`; `.home-empty` tiêu đề serif 26px + lede 16.5px, `max-width: 56ch`; lỗi là `<p role="alert">` serif 16px `--ink-2` tại chỗ, không toast.

### Named Rules
**Quy tắc Tên chương là nút.** Hành động chính của một trang trong khung là một liên kết serif cỡ lớn mang tên thứ sẽ mở, không phải một nút màu. Nút màu không tồn tại trong khung `.doc`.

**Quy tắc Gạch chân 150ms.** Toàn bộ ngữ pháp chuyển động của khung là `transition: text-decoration-color 150ms ease-out` (kèm `color` ở nơi màu chữ cũng đổi). Gạch chân 1px từ `transparent` (hoặc màu nghỉ) lên `--accent`. Không `transform`, không `opacity`, không đổi nền, không chuyển động nào khác được thêm vào.

**Quy tắc Hai id.** `app-screens.css` đặt `#app:not(.reading) #content h1/h2/h3` bằng sans đậm (độ đặc hiệu 2,1,1). Mọi heading serif của khung `.doc` (`.doc-title`, `.doc-h`, `.cont-chapter`, `.home-empty-h`, `.courses-item-title`) phải được khai báo với tiền tố `#app:not(.reading) #content` để thắng đúng ở địa phận này; đây là chỗ *duy nhất* trong `home.css`/`courses.css` dùng id. Thêm một heading mới vào khung mà quên tiền tố thì nó ra sans đậm 18–30px — đã đo.

**Quy tắc Media query cuối tệp.** Khối `@media (max-width: 900px)` của `/progress` phải đứng **sau** mọi luật gốc cùng độ đặc hiệu mà nó ghi đè (đo: đặt giữa tệp thì hàng nhãn tháng phình 2680px ở 375px). Luật mới cho khung `.doc` thêm vào *trước* khối media ở cuối `home.css`.

## Do's and Don'ts

### Do:
- **Do** đặt mọi thân chữ, tiêu đề, câu meta, mô tả bằng `--font-serif` weight 400; phân cấp bằng cỡ (`clamp(30px,3.4vw,40px)` → `clamp(26px,3vw,34px)` → 22px → 17px → 16.5px → 15.5px).
- **Do** dùng `.lbl`/`.doc-h` (sans 12px 600 0.08em UPPERCASE `--ink-3`) cho mọi nhãn đứng cạnh chữ lớn — một lớp, không tự chọn cỡ mới.
- **Do** kết đầu trang và đầu mục bằng `1px solid var(--ink)`; ngăn hàng danh sách bằng `1px solid var(--rule)`.
- **Do** để hành động chính là một liên kết serif mang tên đích; động từ (nếu cần) là run-in *trong* thẻ heading, sans 12.5px màu nhấn.
- **Do** làm hover/focus bằng gạch chân 1px `text-decoration-color` → `--accent`, 150ms ease-out; focus-visible là `outline: 1px solid var(--accent)` với offset 3–6px.
- **Do** vẽ tiến độ bằng đường kẻ 2px (`--rule` nền, `--accent` tô) với số tabular đứng cạnh; kể số liệu thành một câu serif trước khi vẽ bất kỳ biểu đồ nào.
- **Do** lấy màu từ token của `index.css` (`--page`, `--ink*`, `--rule*`, `--accent`) và pha bậc trung gian bằng `color-mix(... , var(--page))` để chế độ tối tự đúng.
- **Do** đặt cột lề (1fr) cho thứ *đứng cạnh* nội dung — ghi chú, chọn năm, chú giải — và cho nó xếp xuống (hoặc lên, nếu nó là điều khiển) dưới 900px.
- **Do** đưa mọi chuỗi giao diện vào cả hai catalog `packages/i18n` (vi và en) trước khi hiển thị.

### Don't:
- **Don't** thêm eyebrow/kicker — một dòng nhãn đứng *trên* tiêu đề. Tiêu đề tự đứng; nhãn đi run-in.
- **Don't** dùng thẻ, `box-shadow`, `border-radius`, nền khác `--page`, hay `border-left` màu (bất kỳ độ dày nào >1px) trong khung `.doc` và running head.
- **Don't** đặt heading, đoạn văn hay câu meta bằng `--font-sans`; sans chỉ cho nhãn, số mục, đầu cột, running head và điều khiển.
- **Don't** đưa màu thứ hai ngoài `--accent` vào khung (kể cả success/warning/error của `tokens.css`) trừ khi nó là ngữ nghĩa bắt buộc đã có sẵn (nhãn hạng `interactive`).
- **Don't** đánh số một danh sách không có thứ tự thật (`01`, `02` bằng counter). Số chỉ xuất hiện khi thứ tự mang nghĩa, và khi đó là `1.`, `1.2` kiểu LaTeX.
- **Don't** dùng nút màu (`.btn` tô nền nhấn) cho hành động chính của một trang trong khung.
- **Don't** đổi bảng tối sang xám ngả xanh (gray-950 #0c111d, slate) hay nghe `prefers-color-scheme`; tối chỉ qua `html[data-theme='dark']` và chỉ ở `index.css`.
- **Don't** thêm `[data-theme]` vào `home.css`, `courses.css`, `shell-modes.css`.
- **Don't** đặt luật `@media` cho khung `.doc` trước luật gốc của nó trong `home.css`.
- **Don't** chỉnh `packages/course-kit/reader.css` hay ghi đè `--serif` của reader để "khớp" với khung; reader là bề mặt riêng, chủ dự án nói phần đọc đã ổn.
- **Don't** kẻ hairline ở đầu một danh sách đứng ngay dưới `.doc-head` (hai đường song song).

---

### Ghi chú kế thừa — cùng tồn tại, không thuộc hệ này

- `apps/web/src/styles/app-screens.css` (1.896 dòng) vẫn tạo kiểu Cài đặt, Admin, Đăng nhập theo thời Untitled UI: thẻ, `--radius-md/lg/xl` (8/10/12px), `--shadow-xs…lg`, heading sans đậm qua `#app:not(.reading) #content h1/h2/h3`. Khung `.doc` chỉ *thắng* các luật ấy trong địa phận của mình bằng tiền tố hai id; không xoá chúng. Ảnh `login-desktop-light.png` và `settings-desktop-light.png` ở `.impeccable/review/` chỉ để chứng minh CSS dùng chung vẫn chạy.
- `tokens.css` còn giữ `--radius-*`, `--shadow-*`, `--shadow-ring-brand: 0 0 0 4px #f4ebff` (tím kit cũ) và thang success/warning/error. Chúng là token của màn kế thừa; khung `.doc` không dùng cái nào và không được coi chúng là lựa chọn "có sẵn" của hệ này.
- Trang đăng nhập/landing (bề mặt Persuade) chưa được thiết kế lại và **không được** khẳng định "không cần tài khoản" (PRODUCT.md, mâu thuẫn chưa giải quyết).
- Tên sản phẩm "Tự học" và mark xanh vuông bo góc ở góc trái running head là **placeholder** (PRODUCT.md). Mark ấy là hộp tô màu nhấn duy nhất còn lại trên running head; nó chưa được quyết, nên không ghi thành luật hình dạng.
- `.sb-*` trong `shell-modes.css` (thanh bên khi *trong* một khoá: thanh tiến độ viên 999px, `--grid`) thuộc về vỏ của reader, ngoài phạm vi hệ này.
