import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageProvider';
import { LEGAL, type LegalId, type Section } from './legal/content';

/**
 * `/privacy` và `/terms` — hai văn bản pháp lý, cùng một khung.
 *
 * ## Vì sao hai route dùng chung một component
 *
 * Hai văn bản có cùng hình dạng: một tiêu đề, một ngày, một đoạn dẫn, rồi n mục
 * mỗi mục là tiêu đề cộng vài đoạn. Tách thành hai component sẽ là hai bản sao
 * của cùng một khung, và bản sao thứ hai sẽ lệch khi ai đó sửa bản thứ nhất.
 * Nội dung nằm ở `legal/content.ts`; tệp này chỉ biết cách vẽ.
 *
 * ## Hai route này KHÔNG bọc `<RequireAuth>`
 *
 * Có chủ ý, và là điểm quan trọng nhất của tệp: một chính sách quyền riêng tư
 * chỉ đọc được sau khi đăng nhập thì không làm được việc của nó. Người ta đọc
 * nó ĐỂ QUYẾT ĐỊNH có tạo tài khoản hay không. Xem bảng route ở `routes.tsx`.
 */

/** Địa chỉ thư → `mailto:`. Hẹp có chủ ý: chỉ khớp dạng địa chỉ mà văn bản này
 *  thật sự chứa, chứ không cố phủ RFC 5322 — một biểu thức phủ hết RFC là một
 *  biểu thức không ai đọc lại được, cho một trang có đúng một địa chỉ. */
const EMAIL = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function linkifyEmail(text: string, keyBase: string): ReactNode[] {
  return text.split(EMAIL).map((part, i) =>
    // Chỉ số lẻ là nhóm bắt được, tức chính địa chỉ.
    i % 2 === 1 ? (
      <a key={`${keyBase}-${i}`} href={`mailto:${part}`}>
        {part}
      </a>
    ) : (
      <Fragment key={`${keyBase}-${i}`}>{part}</Fragment>
    ),
  );
}

/** `**đậm**` → `<strong>`, và địa chỉ thư → liên kết. Cố ý chỉ hai thứ ấy: nội
 *  dung là văn xuôi, không phải Markdown, và mỗi cú pháp thêm vào là một cú
 *  pháp phải kiểm. */
function withBold(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    // Các chỉ số lẻ là phần nằm GIỮA hai cặp dấu sao — đó là nhóm bắt được.
    i % 2 === 1 ? (
      <strong key={i}>{part}</strong>
    ) : (
      <Fragment key={i}>{linkifyEmail(part, String(i))}</Fragment>
    ),
  );
}

const BULLET = '· ';

/** Gom các đoạn liền nhau bắt đầu bằng `· ` thành một `<ul>`; phần còn lại là `<p>`. */
function renderBody(paragraphs: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  let bucket: string[] = [];

  const flush = () => {
    if (bucket.length === 0) return;
    out.push(
      <ul className="legal-list" key={`ul-${out.length}`}>
        {bucket.map((item, i) => (
          <li key={i}>{withBold(item.slice(BULLET.length))}</li>
        ))}
      </ul>,
    );
    bucket = [];
  };

  for (const para of paragraphs) {
    if (para.startsWith(BULLET)) {
      bucket.push(para);
      continue;
    }
    flush();
    out.push(
      <p className="legal-p" key={`p-${out.length}`}>
        {withBold(para)}
      </p>,
    );
  }
  flush();
  return out;
}

function SectionBlock({ section }: { section: Section }) {
  return (
    <section className="legal-sec">
      <h2 className="legal-h">{section.h}</h2>
      {renderBody(section.p)}
    </section>
  );
}

export function Legal({ doc }: { doc: LegalId }) {
  const { lang, t } = useLanguage();
  const d = LEGAL[doc][lang];
  const other: LegalId = doc === 'privacy' ? 'terms' : 'privacy';
  const otherTitle = LEGAL[other][lang].title;

  // `Intl` chứ không phải một chuỗi ngày đã định dạng sẵn trong `content.ts`:
  // ngày là MỘT dữ kiện, còn cách viết nó là chuyện của ngôn ngữ đang hiển thị.
  const updated = new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${d.updated}T00:00:00Z`));

  return (
    <article className="legal">
      <header className="legal-head">
        <h1 className="legal-title">{d.title}</h1>
        <p className="legal-updated">
          {t('legal.updated')} <time dateTime={d.updated}>{updated}</time>
        </p>
        <p className="legal-lede">{d.lede}</p>
      </header>

      {d.sections.map((section) => (
        <SectionBlock key={section.h} section={section} />
      ))}

      <nav className="legal-nav">
        <Link to={other === 'privacy' ? '/privacy' : '/terms'}>{otherTitle}</Link>
        <Link to="/courses">{t('legal.browseCourses')}</Link>
      </nav>
    </article>
  );
}
