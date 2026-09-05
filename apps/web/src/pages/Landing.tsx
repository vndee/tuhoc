import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { catalogQueryKey, fetchCatalog } from '../api/catalog';
import lessonDepthUrl from '../assets/landing/lesson-depth.webp';
import { useLanguage } from '../i18n/LanguageProvider';
import { PaperLanguageSwitcher } from '../i18n/PaperLanguageSwitcher';
import { LandingStoryFeature } from '../stories/components/LandingStoryFeature';
import { useThemeContext } from '../theme/ThemeContext';

/** `/` cho khách chưa đăng nhập — một câu chuyện ba nhịp: đọc, chạm, hỏi. */
export function Landing() {
  const { t } = useLanguage();
  const { theme, toggle: toggleTheme } = useThemeContext();
  const catalog = useQuery({ queryKey: catalogQueryKey(), queryFn: fetchCatalog, retry: false });
  const courses = catalog.data ?? [];
  const lead = courses[0];
  const readHref = lead ? `/c/${lead.slug}` : '/courses';

  return (
    <div className="board-room">
      <ChalkDefs />

      <div className="board">
        <StoryThread />
        {/* Nhãn hiệu viết tay, không phải ô màu của vỏ app. "Tự học" là tên
            giữ chỗ (PRODUCT.md) — trang này không được bịa một tên khác. Hai
            điều khiển thiết bị và lối đăng nhập ở đây vì route này KHÔNG có
            thanh trên (`App.tsx`). */}
        <div className="bd-chrome">
          <span className="bd-wordmark">{t('app.name')}</span>
          <div className="bd-chrome-right">
            <button
              type="button"
              className="bd-chrome-btn"
              aria-label={t(theme === 'dark' ? 'topbar.themeToLight' : 'topbar.themeToDark')}
              aria-pressed={theme === 'dark'}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? <SunMark /> : <MoonMark />}
            </button>
            <PaperLanguageSwitcher className="bd-language" />
            <Link to="/login" className="bd-chrome-link">
              {t('landing.login.cta')}
            </Link>
          </div>
        </div>

        <header className="bd-stage">
          <section className="bd-say" aria-labelledby="bd-q">
            <h1 id="bd-q" className="bd-q" aria-label={t('landing.question')}>
              <span aria-hidden="true">{t('landing.question.read')}</span>
              <span aria-hidden="true">{t('landing.question.touch')}</span>
              <span aria-hidden="true">{t('landing.question.ask')}</span>
            </h1>
            <p className="bd-lede">{t('landing.lede')}</p>
            <p className="bd-act">
              <Link to={readHref} className="bd-cta" data-testid="landing-read">
                <ChalkBox />
                <span className="bd-cta-verb">{t('landing.read.verb')}</span>
                <span className="bd-cta-title">{lead ? lead.title : t('landing.read.catalog')}</span>
              </Link>
            </p>
            <p className="bd-act-meta">
              {t('landing.read.meta')}
              <span aria-hidden="true"> · </span>
              <Link to="/login" state={{ intent: 'register' }} className="bd-link">
                {t('landing.account.cta')}
              </Link>
            </p>
          </section>
          <LearningLab />
        </header>

        <section className="bd-scene bd-depth" aria-labelledby="bd-depth-h">
          <div className="bd-story-copy">
            <h2 id="bd-depth-h" className="bd-story-h">
              {t('landing.depth.h')}
            </h2>
            <p>{t('landing.depth.p1')}</p>
            <p>{t('landing.depth.p2')}</p>
          </div>
          <figure className="bd-plate">
            <img
              className="bd-figure"
              src={lessonDepthUrl}
              width="1672"
              height="941"
              loading="lazy"
              decoding="async"
              role="img"
              alt={t('landing.vision.figure')}
            />
            <figcaption>{t('landing.depth.caption')}</figcaption>
          </figure>
        </section>

        <section className="bd-scene bd-demo" aria-labelledby="bd-demo-h">
          <div className="bd-story-copy bd-demo-copy">
            <h2 id="bd-demo-h" className="bd-story-h">
              {t('landing.demo.h')}
            </h2>
            <p>{t('landing.demo.intro')}</p>
          </div>

          <div className="bd-demo-proof">
            <BookmarkMark />
            <p className="bd-demo-example">{t('landing.demo.example')}</p>
            <p className="bd-demo-sentence">
              <span className="bd-hl">{t('landing.demo.sentence')}</span>
            </p>

            <ChalkArrow />

            <div className="bd-demo-note">
              <p className="bd-demo-label">{t('landing.demo.noteLabel')}</p>
              <p className="bd-note-quote">{t('landing.demo.note')}</p>
            </div>

            <div className="bd-demo-turn">
              <p className="bd-demo-label">{t('landing.demo.tutorLabel')}</p>
              <div className="bd-held">
                <ChalkBracket />
                <blockquote className="bd-quote">{t('landing.demo.note')}</blockquote>
              </div>
              <p className="bd-demo-tutor">{t('landing.demo.tutor')}</p>
            </div>

            <p className="bd-note-how">
              {t('landing.note.how')} <span className="bd-hover-only">{t('landing.note.hover')}</span>
            </p>
          </div>
        </section>

        {/* ── DANH MỤC THẬT ───────────────────────────────────────────────
            Đây mới là chỗ trang nói "có gì để đọc", và nó đọc từ máy chủ nên
            không viết cứng môn nào. Rỗng thì nói rỗng; hỏng thì nói hỏng và
            cho một đường thử lại — `retry: false` nghĩa là không có lần thử
            nào tự đến. */}
        <section className="bd-scene" aria-labelledby="bd-cat-h">
          <span className="bd-h-line">
            <h2 id="bd-cat-h" className="bd-h">
              {t('landing.catalog.h')}
            </h2>
            <ChalkRule variant={0} />
          </span>
          <div className="bd-cat">
            {/* Vùng sống bọc ĐÚNG ba câu trạng thái, không bọc cả danh sách:
                một `aria-live` quanh danh mục sẽ đọc to toàn bộ tên khoá mỗi
                lần nó tới. */}
            <div role="status" aria-live="polite">
              {catalog.isPending && <p className="bd-state">{t('courses.loading')}</p>}
              {catalog.isSuccess && courses.length === 0 && <p className="bd-state">{t('courses.empty')}</p>}
              {catalog.isError && (
                <p className="bd-state">
                  {t('landing.catalog.error')}{' '}
                  <button type="button" className="bd-link bd-retry" onClick={() => void catalog.refetch()}>
                    {t('landing.catalog.retry')}
                  </button>
                </p>
              )}
            </div>
            {courses.length > 0 && (
              <ul className="bd-courses">
                {courses.map((course) => (
                  <li key={course.slug}>
                    <Link to={`/c/${course.slug}`} className="bd-course">
                      <span className="bd-course-title">{course.title}</span>
                      {course.description !== '' && <span className="bd-course-desc">{course.description}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <LandingStoryFeature />

        {/* Máng phấn trở thành đoạn kết của câu chuyện: một lời mời bắt đầu,
            một hành động chính, rồi mới tới hai lối tài khoản. */}
        <footer className="bd-tray">
          <ChalkLedge />
          <div className="bd-footer">
            <div className="bd-footer-copy">
              <h2>{t('landing.footer.h')}</h2>
              <p>{t('landing.footer.start')}</p>
            </div>
            <div className="bd-footer-actions">
              <Link to="/courses" className="bd-footer-primary">
                <ChalkBox />
                <span>{t('landing.catalog.all')}</span>
              </Link>
              <p className="bd-tray-links">
                <Link to="/login" state={{ intent: 'register' }} className="bd-link">
                  {t('landing.account.cta')}
                </Link>
                <Link to="/login" className="bd-link">
                  {t('landing.login.cta')}
                </Link>
              </p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Một minh hoạ chỉ được gọi là tương tác khi thao tác làm thay đổi điều người
 * học đang quan sát. Phân bố năm khả năng là ví dụ đủ phổ quát để hiểu bằng
 * mắt, nhưng vẫn là một ý niệm thật của giáo trình chứ không phải sóng trang
 * trí. Nét vàng đi từ các cột sang đường cong và tiếp tục ở ghi chú phía dưới.
 */
function LearningLab() {
  const { t } = useLanguage();
  const [spread, setSpread] = useState(18);
  const mix = spread / 100;
  const focused = [0.68, 0.14, 0.09, 0.06, 0.03];
  const probabilities = focused.map((value) => value * (1 - mix) + 0.2 * mix);
  const bars = probabilities.map((value, index) => {
    const height = 18 + value * 220;
    return { x: 42 + index * 68, y: 194 - height, height };
  });
  const line = bars.map((bar) => `${bar.x + 13},${bar.y}`).join(' ');
  const observation =
    spread < 34 ? t('landing.lab.focused') : spread < 72 ? t('landing.lab.mixed') : t('landing.lab.even');

  return (
    <section className="bd-lab" aria-labelledby="bd-lab-h">
      <div className="bd-lab-head">
        <h2 id="bd-lab-h">{t('landing.lab.h')}</h2>
        <p>{t('landing.lab.copy')}</p>
      </div>

      <svg
        className="bd-lab-chart"
        viewBox="0 0 360 220"
        role="img"
        aria-label={t('landing.lab.figure')}
        focusable="false"
      >
        <path className="bd-lab-ground" d="M24 195 C 116 192, 238 198, 338 194" filter="url(#bd-chalk-2)" />
        {bars.map((bar, index) => (
          <rect
            key={bar.x}
            className={`bd-lab-bar bd-lab-bar-${index + 1}`}
            x={bar.x}
            y={bar.y}
            width="26"
            height={bar.height}
            filter={`url(#bd-chalk${index % 3 === 0 ? '' : `-${(index % 2) + 1}`})`}
          />
        ))}
        <polyline className="bd-lab-thread" points={line} filter="url(#bd-chalk)" />
        {bars.map((bar) => (
          <circle key={`point-${bar.x}`} className="bd-lab-point" cx={bar.x + 13} cy={bar.y} r="4.5" />
        ))}
      </svg>

      <label className="bd-lab-control">
        <span className="bd-lab-control-name">{t('landing.lab.slider')}</span>
        <span className="bd-lab-value" aria-hidden="true">
          {spread}%
        </span>
        <input
          type="range"
          min="0"
          max="100"
          value={spread}
          aria-valuetext={observation}
          onChange={(event) => setSpread(Number(event.currentTarget.value))}
        />
        <span className="bd-lab-axis" aria-hidden="true">
          <span>{t('landing.lab.axisFocused')}</span>
          <span>{t('landing.lab.axisSpread')}</span>
        </span>
      </label>

      <p className="bd-lab-observation" role="status" aria-live="polite" aria-label={t('landing.lab.observation')}>
        {observation}
      </p>
      <PencilMark />
    </section>
  );
}

/** Một dòng suy nghĩ đi qua cả trang; mờ, nằm sau nội dung và không bắt sự kiện. */
function StoryThread() {
  return (
    <svg
      className="bd-story-thread"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M790 84 C900 120 974 186 974 270 L974 494 C974 520 950 535 914 535 C680 535 286 535 68 535 C36 535 22 550 22 578 L22 786 C22 812 40 825 72 825 C310 825 720 825 950 825 C976 825 982 842 982 868 L982 926 C982 950 930 972 850 982"
        pathLength="1"
        vectorEffect="non-scaling-stroke"
        filter="url(#bd-chalk-2)"
      />
    </svg>
  );
}

/** Một cây bút chì nhỏ đang chỉ vào vùng điều khiển, không phải icon trang trí. */
function PencilMark() {
  return (
    <svg className="bd-pencil" viewBox="0 0 92 24" aria-hidden="true" focusable="false">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" filter="url(#bd-chalk-1)">
        <path className="bd-pencil-body" d="M8 15 L72 5 L84 10 L20 20 Z" />
        <path className="bd-pencil-tip" d="M8 15 L2 21 L20 20" />
        <path className="bd-pencil-lead" d="M2 21 L8 19" />
        <path className="bd-pencil-band" d="M70 6 L76 14" />
      </g>
    </svg>
  );
}

/** Mẩu bookmark đánh dấu nơi câu hỏi của người học được giữ lại. */
function BookmarkMark() {
  return (
    <svg className="bd-bookmark" viewBox="0 0 42 74" aria-hidden="true" focusable="false">
      <path d="M5 3 C14 1, 29 2, 37 4 L36 69 L21 58 L6 70 Z" filter="url(#bd-chalk-2)" />
      <path d="M8 7 C17 5, 27 5, 34 7" fill="none" filter="url(#bd-chalk)" />
    </svg>
  );
}

/**
 * Bộ lọc nét tay, khai báo MỘT lần cho cả trang.
 *
 * `feTurbulence` + `feDisplacementMap` đẩy lệch từng điểm của nét vẽ theo một
 * trường nhiễu, nên đường thẳng SVG ra mép gãy và hạt — đó là phấn, và cũng là
 * bút chì. Không có nó thì mọi nét là một `stroke` sạch bong, tức là một cái
 * khung phần mềm vẽ bằng CSS.
 *
 * BA hạt giống, không phải một: cùng một bàn tay không vẽ ra cùng một đường
 * cong ba lần. `#bd-smudge` là vết lau — nhoè, không phải nét.
 */
function ChalkDefs() {
  return (
    <svg className="bd-defs" aria-hidden="true" focusable="false">
      <defs>
        {[0, 1, 2].map((index) => (
          <filter
            key={index}
            id={`bd-chalk${index === 0 ? '' : `-${index}`}`}
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed={7 + index * 13} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        ))}
        <filter id="bd-smudge" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="4" seed="21" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feGaussianBlur in="rough" stdDeviation="1.6" />
        </filter>
      </defs>
    </svg>
  );
}

/** Khung quanh hành động chính — vẽ tay bốn nét, không phải `border`. */
function ChalkBox() {
  return (
    <svg className="bd-box" viewBox="0 0 400 76" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path
        d="M6 9 C 120 4, 268 6, 394 8 M395 7 C 397 28, 396 50, 393 69 M394 68 C 260 73, 130 71, 7 69 M6 70 C 3 48, 4 28, 6 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        filter="url(#bd-chalk)"
      />
    </svg>
  );
}

/**
 * Mũi tên từ câu được gạch xuống ghi chú.
 *
 * Hai nét chồng nhau: nét mờ luôn hiện (nội dung không bao giờ ẩn sau một
 * hiệu ứng), và nét vàng vẽ ra bằng `stroke-dashoffset` khi người ta chạm vào
 * ghi chú hoặc câu gốc. Đó là chuyển động DUY NHẤT của trang; ai bật
 * `prefers-reduced-motion` thì nét vàng hiện ngay, không vẽ.
 */
function ChalkArrow() {
  return (
    <svg
      className="bd-arrow"
      viewBox="0 0 220 96"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" filter="url(#bd-chalk)">
        <path className="bd-arrow-base" d="M24 4 C 24 40, 40 56, 62 70 L 96 88" />
        <path className="bd-arrow-base" d="M96 88 L 74 86 M96 88 L 84 70" />
        <path className="bd-arrow-live" d="M24 4 C 24 40, 40 56, 62 70 L 96 88" pathLength={1} />
        <path className="bd-arrow-live bd-arrow-head" d="M96 88 L 74 86 M96 88 L 84 70" pathLength={1} />
      </g>
    </svg>
  );
}

/**
 * Dấu ngoặc — bàn tay ôm lấy một đoạn. Dùng ở đúng một chỗ: ôm câu gia sư
 * trích lại từ ghi chú, để mối nối được VẼ chứ không chỉ cùng màu.
 */
function ChalkBracket() {
  return (
    <svg className="bd-bracket" viewBox="0 0 14 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path
        d="M11 2 C 5 3, 3 7, 3 16 L 3 42 C 3 47, 2 49, 1 50 C 2 51, 3 53, 3 58 L 3 84 C 3 93, 5 97, 11 98"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#bd-chalk-2)"
      />
    </svg>
  );
}

/**
 * Gạch ngang dưới một đầu mục. Ba biến thể vì cùng một bàn tay không kẻ ra
 * cùng một đường cong nhiều lần.
 */
function ChalkRule({ variant }: { variant: 0 | 1 | 2 }) {
  const paths = [
    'M2 5 C 150 2, 320 7, 598 3',
    'M3 4 C 190 8, 366 2, 597 6',
    'M2 6 C 120 3, 300 8, 598 4',
  ] as const;
  return (
    <svg className="bd-rule" viewBox="0 0 600 8" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path
        d={paths[variant]}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        filter={`url(#bd-chalk${variant === 0 ? '' : `-${variant}`})`}
      />
    </svg>
  );
}

/** Máng và mẩu phấn nằm trên nó — cả hai được VẼ, không phải khối CSS. */
function ChalkLedge() {
  return (
    <svg className="bd-ledge" viewBox="0 0 600 26" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path
        d="M2 6 C 160 3, 420 9, 598 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        filter="url(#bd-chalk-1)"
      />
      <path
        className="bd-ledge-stub"
        d="M22 14 C 30 12, 46 12, 54 14 C 56 16, 56 19, 54 21 C 46 23, 30 23, 22 21 C 20 19, 20 16, 22 14 Z"
        filter="url(#bd-chalk-2)"
      />
    </svg>
  );
}

function SunMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="3.6" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 2.4v1.9M10 15.7v1.9M17.6 10h-1.9M4.3 10H2.4M15.4 4.6l-1.3 1.3M6 14l-1.4 1.4M15.4 15.4l-1.3-1.3M6 6L4.6 4.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M16.5 12.4A6.8 6.8 0 017.6 3.5a6.9 6.9 0 108.9 8.9z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default Landing;
