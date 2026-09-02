import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { catalogQueryKey, fetchCatalog } from '../api/catalog';
import { useLanguage } from '../i18n/LanguageProvider';
import {
  DEMO_COURSE,
  EXAMPLE_NOTE,
  EXAMPLE_QA,
  EXCERPT_AFTER,
  EXCERPT_CODE,
  EXCERPT_LEDE,
  EXCERPT_SETUP,
  type Segment,
} from './landingExcerpt';

/**
 * `/` cho khách chưa đăng nhập — **landing**, chế độ Persuade.
 *
 * Hợp đồng hướng: `.impeccable/surfaces/apps-web-src-pages-landing-tsx.md`
 * (seed 57dcb485, cùng thế giới "giáo trình LaTeX, lề rộng" của DESIGN.md).
 * Cấu trúc do người dùng chọn trên trang quyết định: **hành trình của một câu
 * hỏi** — bốn cảnh xếp dọc trong cùng khung `.doc`, mỗi cảnh là một cảnh
 * thật của sản phẩm, không cảnh nào là hộp tính năng:
 *
 *  1. Đọc: trích đoạn chương 1.1 của khoá mẫu công khai, câu được bôi đen,
 *     ghi chú ví dụ ở lề neo đúng câu ấy. Hành động chính ngay dưới đoạn.
 *  2. Hỏi: biên bản một lượt hỏi gia sư, câu trả lời trích nguyên văn ghi
 *     chú — điều chỉ sản phẩm này làm được (PRODUCT.md, lời hứa số 1).
 *  3. Quay lại đúng chỗ: hàng mục lục có tiến độ, như trang Học tiếp thật.
 *  4. Danh mục thật từ `GET /courses`.
 *
 * Sự thật trang này được phép nói (quyết định 02/09/2026, PRODUCT.md): đọc
 * miễn phí không cần tài khoản; tài khoản giữ ghi chú, tiến độ, gia sư AI.
 * Không giá, không lời chứng thực, không logo đối tác, không hình stock.
 *
 * Hành động chính trỏ tới CHƯƠNG chỉ khi danh mục công khai có khoá mẫu;
 * không có thì trỏ về `/courses`. Một liên kết tới một khoá chưa xuất bản là
 * một lời hứa sai, và máy chủ nào cũng có thể chưa publish khoá ấy.
 *
 * Ghi chú và biên bản là VÍ DỤ (xem `landingExcerpt.ts`), gắn nhãn tại chỗ.
 */
export function Landing() {
  const { t } = useLanguage();
  const catalog = useQuery({ queryKey: catalogQueryKey(), queryFn: fetchCatalog, retry: false });
  const courses = catalog.data ?? [];
  const demoPublished = courses.some((course) => course.slug === DEMO_COURSE.slug);
  const [first, second, third] = DEMO_COURSE.chapters;
  const readHref = demoPublished ? `/c/${DEMO_COURSE.slug}/${first.id}` : '/courses';

  return (
    <div className="landing doc">
      <header className="doc-head">
        <h1 className="doc-title">{t('landing.question')}</h1>
        <p className="doc-lede">{t('landing.lede')}</p>
      </header>

      {/* Cảnh 1 — ĐỌC. Trích đoạn thật ở cột chính, ghi chú ví dụ ở lề. Rê
          chuột lên ghi chú thì câu gốc gạch chân (CSS `:has`, 150ms — chuyển
          động duy nhất của trang, cùng ngữ pháp với mọi liên kết). */}
      <div className="doc-body ld-scene">
        <section className="doc-main" aria-labelledby="ld-read-h">
          <h2 id="ld-read-h" className="doc-h">
            {t('landing.read.h')}
          </h2>
          <p className="lbl ld-source">
            {DEMO_COURSE.title} · {first.num} {first.title}
          </p>
          <div className="ld-excerpt" lang="vi">
            <p>{renderSegments(EXCERPT_LEDE)}</p>
            <p>{EXCERPT_SETUP}</p>
            <pre>
              <code>{EXCERPT_CODE}</code>
            </pre>
            <p>{renderSegments(EXCERPT_AFTER)}</p>
          </div>

          {/* HÀNH ĐỘNG CHÍNH LÀ TÊN CHƯƠNG, cùng dạng với khối Tiếp tục của
              trang Học tiếp: động từ run-in, số chương, tên chương serif lớn.
              Không nút màu. */}
          <Link to={readHref} className="cont-link ld-cta" data-testid="landing-read">
            <span className="cont-chapter">
              <span className="cont-verb">{t('landing.read.verb')}</span>
              {demoPublished && <span className="cont-num">{first.num}</span>}
              <span className="cont-title">{demoPublished ? first.title : t('landing.read.catalog')}</span>
            </span>
          </Link>
          <p className="cont-meta">
            {t('landing.read.meta')}
            <span className="cont-sep" aria-hidden="true">
              {' · '}
            </span>
            <Link to="/login" state={{ intent: 'register' }} className="cont-course">
              {t('landing.account.cta')}
            </Link>
          </p>
        </section>

        <aside className="doc-margin" aria-labelledby="ld-note-h">
          <h2 id="ld-note-h" className="doc-h">
            {t('landing.note.h')}
          </h2>
          <ul className="margin-notes">
            <li className={`mnote mnote-c-${EXAMPLE_NOTE.color}`}>
              <p className="mnote-quote">
                <span className="mnote-swatch" aria-hidden="true" />
                {EXAMPLE_NOTE.quote}
              </p>
              <p className="mnote-text">{EXAMPLE_NOTE.text}</p>
              <p className="mnote-meta">
                <span className="ld-example">{t('landing.example')}</span>
                <span>{DEMO_COURSE.title}</span>
              </p>
            </li>
          </ul>
          <p className="ld-margin-note">{t('landing.note.how')}</p>
        </aside>
      </div>

      {/* Cảnh 2 — HỎI. Biên bản một lượt: bạn hỏi, gia sư trả lời và trích
          nguyên văn ghi chú ở 1.1. Là ví dụ, và nói vậy ngay trong đầu mục. */}
      <div className="doc-body ld-scene">
        <section className="doc-main" aria-labelledby="ld-ask-h">
          <h2 id="ld-ask-h" className="doc-h">
            {t('landing.ask.h')}
          </h2>
          <dl className="ld-qa" lang="vi">
            <div className="ld-qa-turn">
              <dt className="lbl">{t('landing.ask.you')}</dt>
              <dd>{EXAMPLE_QA.question}</dd>
            </div>
            <div className="ld-qa-turn ld-qa-tutor">
              <dt className="lbl">{t('landing.ask.tutor')}</dt>
              <dd>
                <p>{EXAMPLE_QA.answerBefore}</p>
                <blockquote className="ld-qa-quote">
                  <span className="mnote-swatch" aria-hidden="true" />
                  {EXAMPLE_QA.answerQuote}
                </blockquote>
                <p>{EXAMPLE_QA.answerAfter}</p>
              </dd>
            </div>
          </dl>
        </section>
        <aside className="doc-margin" aria-labelledby="ld-ask-margin-h">
          <h2 id="ld-ask-margin-h" className="doc-h">
            {t('landing.ask.margin.h')}
          </h2>
          <p className="ld-margin-note">{t('landing.ask.margin.p')}</p>
        </aside>
      </div>

      {/* Cảnh 3 — QUAY LẠI ĐÚNG CHỖ. Hàng mục lục có tiến độ, đúng thành phần
          của trang Học tiếp (`.toc-*`), nhưng là ví dụ nên tiêu đề là chữ,
          không phải liên kết. */}
      <div className="doc-body ld-scene">
        <section className="doc-main" aria-labelledby="ld-progress-h">
          <h2 id="ld-progress-h" className="doc-h">
            {t('landing.progress.h')}
          </h2>
          <nav className="toc ld-toc" aria-label={t('landing.progress.h')}>
            <p className="toc-part lbl">{DEMO_COURSE.part}</p>
            <ul className="toc-rows">
              <li className="toc-row is-done">
                <span className="toc-num">{first.num}</span>
                <span className="toc-title">{first.title}</span>
                <span className="toc-mark">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 12.5l5 5L20 6.5" />
                  </svg>
                  {t('toc.done')}
                </span>
              </li>
              <li className="toc-row is-next">
                <span className="toc-num">{second.num}</span>
                <span className="toc-title">{second.title}</span>
                <span className="toc-mark">{t('toc.next')}</span>
              </li>
              <li className="toc-row">
                <span className="toc-num">{third.num}</span>
                <span className="toc-title">{third.title}</span>
              </li>
            </ul>
          </nav>
        </section>
        <aside className="doc-margin" aria-labelledby="ld-progress-margin-h">
          <h2 id="ld-progress-margin-h" className="doc-h">
            {t('landing.progress.margin.h')}
          </h2>
          <p className="ld-margin-note">{t('landing.progress.margin.p')}</p>
        </aside>
      </div>

      {/* Cảnh 4 — DANH MỤC THẬT. Cùng danh sách với `/courses`; rỗng thì nói
          rỗng, không vẽ ô giữ chỗ. Kết bằng hai đường vào tài khoản. */}
      <div className="doc-body ld-scene">
        <section className="doc-main" aria-labelledby="ld-catalog-h">
          <h2 id="ld-catalog-h" className="doc-h">
            {t('landing.catalog.h')}
          </h2>
          {catalog.isPending && <p className="ld-margin-note">{t('courses.loading')}</p>}
          {catalog.isSuccess && courses.length === 0 && <p className="ld-margin-note">{t('landing.catalog.empty')}</p>}
          {catalog.isError && <p className="ld-margin-note">{t('landing.catalog.error')}</p>}
          {courses.length > 0 && (
            <ul className="courses-list">
              {courses.map((course) => (
                <li key={course.slug} className="courses-item">
                  <Link to={`/c/${course.slug}`} className="courses-item-link">
                    <h3 className="courses-item-title">{course.title}</h3>
                    {course.description !== '' && <p className="courses-item-desc">{course.description}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="ld-actions">
            <Link to="/courses" className="doc-link">
              {t('landing.catalog.all')}
            </Link>
            <Link to="/login" state={{ intent: 'register' }} className="doc-link">
              {t('landing.account.cta')}
            </Link>
            <Link to="/login" className="doc-link">
              {t('landing.login.cta')}
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}

function renderSegments(segments: readonly Segment[]) {
  return segments.map((segment, index) => {
    switch (segment.kind) {
      case 'i':
        return <i key={index}>{segment.text}</i>;
      case 'b':
        return <b key={index}>{segment.text}</b>;
      case 'mark':
        return (
          <mark key={index} className="ld-hl">
            {segment.text}
          </mark>
        );
      default:
        return <span key={index}>{segment.text}</span>;
    }
  });
}

export default Landing;
