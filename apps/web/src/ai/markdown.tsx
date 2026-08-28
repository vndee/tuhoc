import { Fragment, useEffect, useRef, type ReactNode } from 'react';

/**
 * MARKDOWN CỦA CÂU TRẢ LỜI AI → PHẦN TỬ REACT. Không `innerHTML`, không thư viện.
 *
 * ── VÌ SAO KHÔNG DÙNG MỘT THƯ VIỆN MARKDOWN ─────────────────────────────────
 * Chuỗi đi vào đây là chữ do một MÔ HÌNH NGÔN NGỮ sinh ra, tức dữ liệu không
 * tin được, và nó có thể mang bất cứ thứ gì — kể cả `<script>` hay một thẻ
 * `<img onerror=…>` mà người dùng đã vô tình nhắc tới trong câu hỏi. Đường đi
 * thông thường (`marked` → `innerHTML`) đòi thêm một bộ khử trùng, và bộ khử
 * trùng ấy trở thành thứ duy nhất đứng giữa chữ của mô hình và DOM của trang.
 *
 * Repo này đã có một luật thành văn về đúng chuyện đó — `db/local.test.ts` quét
 * cả cây mã để không một trường nào do gói khoá học kiểm soát chạm tới
 * `innerHTML`. Chữ của mô hình cùng hạng ấy.
 *
 * Dựng thẳng phần tử React thì câu hỏi biến mất: React thoát mọi chuỗi khi đặt
 * chúng làm con của một phần tử, nên `<script>alert(1)</script>` trong câu trả
 * lời hiện ra đúng như chữ ấy. Không có đường nào từ chuỗi sang thẻ.
 *
 * ── CÁI GIÁ, NÓI RA CHỨ KHÔNG GIẤU ──────────────────────────────────────────
 * Đây là một TẬP CON của markdown, không phải CommonMark: đúng những thứ câu
 * trả lời của một trợ lý học tập thật sự dùng — đoạn văn, đậm/nghiêng, mã nội
 * dòng, khối mã, danh sách, tiêu đề, trích dẫn, và công thức. Bảng biểu,
 * markdown lồng nhiều tầng, tham chiếu chú thích thì KHÔNG. Chúng hiện ra
 * nguyên văn thay vì hiện ra sai — một bảng markdown thô vẫn đọc được, còn một
 * bảng dựng hỏng thì không.
 *
 * ── LIÊN KẾT: CÓ VẼ, KHÔNG BẤM ĐƯỢC ─────────────────────────────────────────
 * `[chữ](https://…)` hiện ra thành chữ kèm địa chỉ đầy đủ, KHÔNG thành `<a>`.
 * Một mô hình có thể bị chính nội dung chương lái đi (chương là tệp do người
 * khác đóng gói), và một liên kết bấm được là bước cuối cùng của đường ấy. Cho
 * người đọc nhìn thấy trọn địa chỉ rồi tự quyết định là đủ, và nó không mất gì
 * — không ai mất khả năng sao chép một dòng chữ.
 */

/* ────────────────────────────────────────────────────────────────────────── *
 * CÔNG THỨC
 * ────────────────────────────────────────────────────────────────────────── */

declare global {
  interface Window {
    katex?: {
      /** Dựng THẲNG vào một phần tử. Không đi qua một chuỗi HTML nào — xem `TeX`. */
      render: (tex: string, element: HTMLElement, options?: Record<string, unknown>) => void;
    };
  }
}

/**
 * `$…$` và `$$…$$` qua KaTeX. Tên là `TeX` chứ không phải `Math`: một component
 * tên `Math` che mất `Math` toàn cục của JS trong cả tệp này.
 *
 * `katex.render(tex, host)` chứ KHÔNG phải `host.innerHTML = katex.renderToString(tex)`.
 *
 * Hai đường cho ra cùng một kết quả nhìn thấy được, và tôi đã viết đường thứ
 * hai trước — rồi cổng "no HTML sink anywhere else" của `db/local.test.ts` bắt
 * đúng nó. Cổng ấy đúng, và lý lẽ "chuỗi này do KaTeX sinh ra nên an toàn"
 * chính là hình dạng của lời bào chữa mà nó tồn tại để chặn: nó phải được đọc
 * lại và tin lại ở mỗi lần sửa sau này.
 *
 * `render` không có câu hỏi ấy. Nó tự dựng các nút DOM, nên trong tệp này không
 * còn một chuỗi nào đi vào DOM dưới dạng markup — kể cả một chuỗi "chắc là an
 * toàn". Kèm `trust: false` (mặc định): `\\href`, `\\url`, `\\includegraphics`
 * đều bị KaTeX từ chối, nên chữ TeX của mô hình cũng không mở được đường nào.
 *
 * `throwOnError: false` vì một công thức hỏng trong câu trả lời của mô hình là
 * chuyện thường: KaTeX vẽ nó bằng màu lỗi thay vì ném, và người đọc vẫn thấy
 * phần còn lại của câu trả lời.
 *
 * Không có `window.katex` (ngoài trang đọc, bộ chạy chưa nạp) thì rơi về chữ
 * thô trong một `<code>`. Một công thức TeX đọc được vẫn hơn một chỗ trống.
 */
function TeX({ tex, display }: { tex: string; display: boolean }) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const katex = window.katex;
    if (!katex) {
      host.textContent = tex;
      return;
    }
    try {
      host.textContent = '';
      katex.render(tex, host, { displayMode: display, throwOnError: false, trust: false });
    } catch {
      host.textContent = tex;
    }
  }, [tex, display]);

  return (
    <span
      ref={ref}
      className={display ? 'md-math md-math-display' : 'md-math'}
      // Chữ thô là nội dung ban đầu, nên khi chưa có KaTeX (hoặc trong bài kiểm
      // chạy trên jsdom) nó vẫn đọc được thay vì rỗng.
      suppressHydrationWarning
    >
      {tex}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────────── *
 * NỘI DÒNG
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Một lượt quét, nhiều mẫu — KHÔNG phải nhiều lần `replace` chồng lên nhau.
 *
 * Chồng `replace` là cách để `**a `code` b**` biến thành rác: lần chạy thứ hai
 * không biết lần thứ nhất đã cắt tới đâu. Quét một lượt từ trái sang phải thì
 * mỗi ký tự chỉ thuộc về đúng một mẩu.
 *
 * Thứ tự trong `PATTERNS` là thứ tự ưu tiên, và nó có nghĩa: mã nội dòng đứng
 * TRƯỚC mọi thứ khác, vì `` `**a**` `` phải hiện ra nguyên dấu sao.
 */
const PATTERNS: Array<{ re: RegExp; build: (m: RegExpExecArray, key: number) => ReactNode }> = [
  // Mã nội dòng: `…`
  { re: /`([^`\n]+)`/y, build: (m, key) => <code key={key}>{m[1]}</code> },
  // Công thức khối trong một dòng: $$…$$
  { re: /\$\$([^$]+)\$\$/y, build: (m, key) => <TeX key={key} tex={m[1].trim()} display /> },
  // Công thức nội dòng: $…$ — đòi ký tự đầu KHÔNG phải khoảng trắng, để "5 $ và
  // 10 $" không bị đọc thành một công thức.
  { re: /\$(\S[^$\n]*?)\$/y, build: (m, key) => <TeX key={key} tex={m[1].trim()} display={false} /> },
  // Đậm: **…**
  { re: /\*\*([^*]+)\*\*/y, build: (m, key) => <strong key={key}>{m[1]}</strong> },
  // Nghiêng: *…*
  { re: /\*([^*\n]+)\*/y, build: (m, key) => <em key={key}>{m[1]}</em> },
  // Liên kết: [chữ](địa chỉ) — VẼ RA, KHÔNG BẤM ĐƯỢC. Xem đầu tệp.
  {
    re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/y,
    build: (m, key) => (
      <Fragment key={key}>
        {m[1]} <span className="md-link">{m[2]}</span>
      </Fragment>
    ),
  },
];

export function renderInline(source: string): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = '';
  let i = 0;
  let key = 0;

  const flush = () => {
    if (plain !== '') {
      out.push(plain);
      plain = '';
    }
  };

  while (i < source.length) {
    let matched = false;
    for (const { re, build } of PATTERNS) {
      re.lastIndex = i;
      const m = re.exec(source);
      if (m) {
        flush();
        out.push(build(m, (key += 1)));
        i = re.lastIndex;
        matched = true;
        break;
      }
    }
    if (!matched) {
      plain += source[i];
      i += 1;
    }
  }

  flush();
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * KHỐI
 * ────────────────────────────────────────────────────────────────────────── */

const FENCE = /^```(\w*)\s*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const DISPLAY_MATH_OPEN = /^\$\$\s*$/;

/**
 * Chữ → phần tử. Nhận cả chuỗi ĐANG CHẢY DỞ: câu trả lời được vẽ lại sau mỗi
 * mẩu stream, nên hàm này gặp một khối mã chưa đóng ``` ở gần như mọi lần gọi.
 * Nó đóng khối ấy giúp thay vì nuốt phần chữ còn lại — nếu không, người đọc
 * nhìn một khoảng trống lớn dần trong lúc mô hình đang viết mã.
 */
export function renderMarkdown(source: string): ReactNode {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let key = 0;
  let i = 0;

  const paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(<p key={(key += 1)}>{renderInline(paragraph.join(' '))}</p>);
    paragraph.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // bỏ qua dấu đóng (hoặc hết chuỗi — xem doc)
      blocks.push(
        <pre key={(key += 1)} className="md-pre" data-lang={fence[1] || undefined}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    if (DISPLAY_MATH_OPEN.test(line)) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !DISPLAY_MATH_OPEN.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(<TeX key={(key += 1)} tex={body.join('\n').trim()} display />);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      // `h3`–`h6`: câu trả lời sống BÊN TRONG một trang đã có `h1` (tên chương)
      // và `h2` (mục). Một `#` của mô hình không được trở thành một `h1` thứ
      // hai — cây tiêu đề của trang là thứ người dùng trình đọc màn hình dùng
      // để đi lại, và một câu trả lời không được xen ngang nó ở cấp cao nhất.
      const level = Math.min(6, heading[1].length + 2);
      const Tag = `h${String(level)}` as 'h3';
      blocks.push(
        <Tag key={(key += 1)} className="md-h">
          {renderInline(heading[2])}
        </Tag>,
      );
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      flushParagraph();
      const body: string[] = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i]);
        if (!q) break;
        body.push(q[1]);
        i += 1;
      }
      blocks.push(
        <blockquote key={(key += 1)} className="md-quote">
          {renderInline(body.join(' '))}
        </blockquote>,
      );
      continue;
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      flushParagraph();
      const ordered = NUMBERED.test(line) && !BULLET.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const b = BULLET.exec(lines[i]);
        const n = NUMBERED.exec(lines[i]);
        if (b) items.push(b[1]);
        else if (n) items.push(n[2]);
        else break;
        i += 1;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={(key += 1)} className="md-list">
          {items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </List>,
      );
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      i += 1;
      continue;
    }

    paragraph.push(line);
    i += 1;
  }

  flushParagraph();
  return <>{blocks}</>;
}
