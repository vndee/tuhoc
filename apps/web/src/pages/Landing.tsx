import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { catalogQueryKey, fetchCatalog } from '../api/catalog';
import { useLanguage } from '../i18n/LanguageProvider';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { useThemeContext } from '../theme/ThemeContext';

/**
 * `/` cho khách chưa đăng nhập — **landing**, chế độ Persuade.
 *
 * Hợp đồng hướng: `.impeccable/surfaces/apps-web-src-pages-landing-tsx.md`
 * (seed 7f29cad4). Thế giới RIÊNG, không dùng lại khung `.doc` của vỏ app:
 * **một mặt viết tay** — giấy kem ban ngày, bảng đá ban đêm, cùng một bàn tay.
 *
 * Vì sao đổi hẳn thế giới (03/09/2026): bản trước tái dụng nguyên `.doc`,
 * `.toc-*`, `.cont-*`, `.courses-*`, `.mnote-*` của trang Học tiếp cộng thanh
 * trên của vỏ app, và chủ dự án đọc ra đúng cái đó — "nhìn giống trang đã
 * đăng nhập hơn là landing page".
 *
 * KHÔNG CÒN MỘT KHOÁ CỤ THỂ NÀO trên trang (yêu cầu chủ dự án, 03/09/2026:
 * *"không nên để một khoá học cụ thể như vậy, khoá này không phải ai cũng
 * quan tâm và không phải ai cũng hiểu nó là gì"*). Bản trước dựng cả màn đầu
 * trên chương 1.1 của `bat-bien-vong-lap`: trích đoạn, câu bôi đen, ghi chú,
 * biên bản, mục lục, và cả câu hỏi ở nhan đề. Một người không làm phần mềm
 * mở trang ra chỉ thấy một hàm Python có lỗi.
 *
 * Nay trang chứng minh CƠ CHẾ, không chứng minh một môn học:
 *  1. câu hỏi ai đọc một mình cũng từng hỏi, và một lối vào đã thử mà hỏng;
 *  2. ba bước viết tay: câu được gạch → ghi chú của bạn → gia sư cầm chính
 *     ghi chú ấy trả lời. Toàn bộ là chữ trung tính, gắn nhãn "ví dụ";
 *  3. danh mục THẬT từ `GET /courses` — nó mới là chỗ nói "có gì để đọc",
 *     và nó tự đổi theo máy chủ chứ không viết cứng môn nào.
 *
 * Hành động chính đi theo dữ liệu, không theo một slug viết cứng: có khoá
 * trong danh mục thì trỏ tới khoá ĐẦU TIÊN cùng tên thật của nó; danh mục
 * rỗng hoặc hỏng thì trỏ về `/courses` và không hứa một trang nào.
 *
 * Mọi dấu trên mặt viết là nét vẽ tay qua bộ lọc nhiễu, không phải `border`
 * CSS và không phải khối màu CSS giả làm vật.
 *
 * Sự thật trang này được phép nói (PRODUCT.md): đọc miễn phí không cần tài
 * khoản; tài khoản giữ ghi chú, tiến độ, gia sư AI. Không giá, không lời
 * chứng thực, không logo đối tác, không hình stock.
 */
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
            <LanguageSwitcher />
            <Link to="/login" className="bd-chrome-link">
              {t('landing.login.cta')}
            </Link>
          </div>
        </div>

        <div className="bd-stage">
          <section className="bd-say" aria-labelledby="bd-q">
            <h1 id="bd-q" className="bd-q">
              {t('landing.question')}
            </h1>
            <p className="bd-lede">{t('landing.lede')}</p>

            {/* CÁI GẠCH XOÁ: một lối đã thử và không đi tới đâu. Đây là kinh
                nghiệm của bất kỳ ai tự học, không phải của một môn nào — đó
                là lý do câu hỏi ở nhan đề là câu hỏi thật. Nét gạch được VẼ,
                không phải `line-through` của trình duyệt. */}
            <p className="bd-working">
              <span className="bd-strike">
                <s>{t('landing.working.tried')}</s>
                <ChalkStrike />
              </span>
              <span className="bd-verdict">{t('landing.working.verdict')}</span>
            </p>

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

          {/* ── HƯỚNG ĐI, VẼ RA VÀ NÓI RA ────────────────────────────────
              Chủ dự án chốt 03/09/2026: tầm nhìn là "AI hỗ trợ đào sâu,
              personalize khoá học", và landing được nói thẳng nó MIỄN LÀ ghi
              rõ đây là hướng chứ không phải thứ đang chạy. Nhãn `Hướng đi`
              đứng ngay trên, tách hẳn khỏi mục "Bạn làm được gì ở đây" — chỗ
              duy nhất trang được phép kể tính năng.

              Hình không phải trang trí nên nó là `role="img"` có tên trợ
              năng, không phải `aria-hidden`: nó CHÍNH LÀ câu tầm nhìn, vẽ ra. */}
          <section className="bd-vision" aria-labelledby="bd-vision-h">
            <h2 id="bd-vision-h" className="bd-vision-label">
              {t('landing.vision.label')}
            </h2>
            <StudyScene label={t('landing.vision.figure')} />
            <p className="bd-vision-body">{t('landing.vision.body')}</p>
          </section>
        </div>

        {/* ── BẠN LÀM ĐƯỢC GÌ Ở ĐÂY ───────────────────────────────────────
            Chủ dự án nhìn bản trước và nói: "không hiểu đây là platform gì,
            không hiểu nó làm được gì". Đúng — trang DIỄN cơ chế mà không bao
            giờ NÓI mình là cái gì. Bốn dòng này trả lời câu ấy bằng chữ, và
            chúng là bốn dòng CHỮ chứ không phải bốn ô tính năng có biểu tượng:
            hộp tính năng đúng là thứ luận đề của trang từ chối.

            Mỗi dòng chỉ nói điều mã đã làm được. Không giá, không "ai cũng
            xuất bản được" (PRODUCT.md ghi đó còn là khoảng trống), và gia sư
            đọc GHI CHÚ chứ không đọc tiến độ. */}
        <section className="bd-scene bd-can" aria-labelledby="bd-can-h">
          <h2 id="bd-can-h" className="bd-h">
            {t('landing.can.h')}
          </h2>
          <ChalkRule variant={1} />
          <ul className="bd-can-list">
            {(['landing.can.read', 'landing.can.note', 'landing.can.ask', 'landing.can.return'] as const).map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </section>

      {/* ── CƠ CHẾ, VIẾT TAY BA BƯỚC ────────────────────────────────
            Không còn tờ giấy ghim và không còn trích đoạn của một khoá:
            chính mặt viết diễn ba bước, bằng chữ trung tính ai đọc cũng
            hiểu. Mối nối giữa ghi chú và câu trả lời được VẼ — mũi tên
            xuống ghi chú, dấu ngoặc ôm câu gia sư trích lại. */}
        <section className="bd-scene bd-demo" aria-labelledby="bd-demo-h">
          <h2 id="bd-demo-h" className="bd-demo-h">
            {t('landing.demo.h')}
          </h2>

          <div className="bd-demo-steps">
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
            <p className="bd-demo-tutor">{t('landing.demo.tutor')}</p>
            <div className="bd-held">
              <ChalkBracket />
              <blockquote className="bd-quote">{t('landing.demo.note')}</blockquote>
            </div>
          </div>

          </div>

          <p className="bd-note-how">
            {t('landing.note.how')} <span className="bd-hover-only">{t('landing.note.hover')}</span>
          </p>
        </section>

        {/* ── DANH MỤC THẬT ───────────────────────────────────────────────
            Đây mới là chỗ trang nói "có gì để đọc", và nó đọc từ máy chủ nên
            không viết cứng môn nào. Rỗng thì nói rỗng; hỏng thì nói hỏng và
            cho một đường thử lại — `retry: false` nghĩa là không có lần thử
            nào tự đến. */}
        <section className="bd-scene bd-scene-last" aria-labelledby="bd-cat-h">
          <h2 id="bd-cat-h" className="bd-h">
            {t('landing.catalog.h')}
          </h2>
          <ChalkRule variant={0} />
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

        {/* Máng phấn: cái kết thật của một mặt viết, và chỗ đặt ba lối ra.
            Cả gờ máng lẫn mẩu phấn đều được VẼ. */}
        <div className="bd-tray">
          <ChalkLedge />
          <p className="bd-tray-links">
            <Link to="/courses" className="bd-link">
              {t('landing.catalog.all')}
            </Link>
            <Link to="/login" state={{ intent: 'register' }} className="bd-link">
              {t('landing.account.cta')}
            </Link>
            <Link to="/login" className="bd-link">
              {t('landing.login.cta')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * CUỐN SÁCH MỞ, VÀ NHỮNG THỨ BAY LÊN TỪ NÓ.
 *
 * Ba bản trước lần lượt là: một gáy sách có vạch chia (đọc thành cái trục đo),
 * ba khung lồng nhau (đọc thành cửa sổ phần mềm), và một người ngồi học. Chủ
 * dự án bỏ nốt hình người: cuốn sách mở ra công thức và mô hình là đủ, và một
 * dáng người vẽ bằng vài nét thì luôn là chỗ yếu nhất của hình.
 *
 * Còn lại là một cảnh gọn: cuốn sách mở ở dưới, và từ nó bay lên đúng những
 * thứ nó dạy — mạng nơ-ron, ký hiệu toán, hành tinh có vành, mấy ngôi sao. Ba
 * nét ngắn bốc lên từ gáy sách là thứ nối hai nửa lại; không có chúng thì cụm
 * trên chỉ là mấy hình trôi nổi cạnh một cuốn sách.
 *
 * Ký hiệu toán vẽ bằng `<text>`: `∫`, `Σ`, `π` là notation chứ không phải chữ
 * giao diện, nên chúng không vào catalog i18n và không đổi theo ngôn ngữ.
 */
function StudyScene({ label }: { label: string }) {
  const stars = [
    { x: 236, y: 34, r: 8 },
    { x: 340, y: 130, r: 6 },
    { x: 150, y: 40, r: 5 },
  ];
  const nodes = ['40,88', '40,130', '88,66', '88,108', '132,86'];
  return (
    <svg className="bd-figure" viewBox="0 0 380 300" role="img" aria-label={label} focusable="false">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* ── CUỐN SÁCH MỞ ──────────────────────────────────────────────
            Hai TỨ GIÁC khép kín, không phải hai đường cong. Bản trước vẽ hai
            nét cong vồng lên ở mép ngoài và mắt đọc ra ngay là ĐÔI CÁNH: một
            cuốn sách mở thì mép ngoài THẤP hơn gáy, và nó có bề dày. */}
        <path
          className="bd-fig-book"
          d="M92 254 C 128 244, 164 242, 188 250 L188 278 C 162 270, 126 272, 96 282 Z"
          strokeWidth="3"
          filter="url(#bd-chalk)"
        />
        <path
          className="bd-fig-book"
          d="M288 254 C 252 244, 216 242, 192 250 L192 278 C 218 270, 254 272, 284 282 Z"
          strokeWidth="3"
          filter="url(#bd-chalk-1)"
        />
        {/* Bề dày của tập giấy dưới mỗi trang. */}
        <path
          className="bd-fig-lines"
          d="M96 282 C 126 272, 162 270, 188 278 M284 282 C 254 272, 218 270, 192 278"
          strokeWidth="1.6"
          filter="url(#bd-chalk-2)"
        />
        {/* Vài dòng chữ trên trang, gợi ý thôi. */}
        <path
          className="bd-fig-lines"
          d="M114 258 C 134 252, 156 251, 174 255 M114 266 C 134 260, 156 259, 174 263 M206 255 C 224 251, 246 252, 266 258 M206 263 C 224 259, 246 260, 266 266"
          strokeWidth="1.4"
          filter="url(#bd-chalk-2)"
        />
        {/* Ba nét bốc lên từ gáy, xoè ra — thứ nối cuốn sách với những gì nó
            dạy. Bản trước chụm quá sát nên chúng đọc thành một dấu ngoặc. */}
        <path
          className="bd-fig-rise"
          d="M172 236 C 160 222, 154 208, 152 194 M190 234 C 190 218, 190 206, 190 192 M208 236 C 220 222, 226 208, 228 194"
          strokeWidth="1.8"
          filter="url(#bd-chalk-1)"
        />

        {/* ── MẠNG NƠ-RON ───────────────────────────────────────────────── */}
        <path
          className="bd-fig-net"
          d="M40 88 L88 66 M40 88 L88 108 M40 130 L88 66 M40 130 L88 108 M88 66 L132 86 M88 108 L132 86"
          strokeWidth="1.8"
          filter="url(#bd-chalk-2)"
        />
        {nodes.map((pt) => {
          const [cx, cy] = pt.split(',');
          return <circle key={pt} className="bd-fig-node" cx={cx} cy={cy} r="6" strokeWidth="2.2" filter="url(#bd-chalk)" />;
        })}

        {/* ── HÀNH TINH: vành là HAI cung, một khuất sau và một vắt trước ── */}
        <circle className="bd-fig-sky" cx="302" cy="76" r="27" strokeWidth="2.6" filter="url(#bd-chalk-1)" />
        <path className="bd-fig-sky" d="M268 66 C 284 56, 322 56, 338 68" strokeWidth="1.8" filter="url(#bd-chalk-2)" />
        <path className="bd-fig-sky" d="M266 68 C 276 88, 328 88, 340 66" strokeWidth="2.4" filter="url(#bd-chalk)" />

        {/* ── SAO TÁM TIA ───────────────────────────────────────────────── */}
        {stars.map((st) => (
          <path
            key={`${st.x}-${st.y}`}
            className="bd-fig-sky"
            d={
              `M${st.x} ${st.y - st.r} L${st.x} ${st.y + st.r} M${st.x - st.r} ${st.y} L${st.x + st.r} ${st.y}` +
              ` M${st.x - st.r * 0.5} ${st.y - st.r * 0.5} L${st.x + st.r * 0.5} ${st.y + st.r * 0.5}` +
              ` M${st.x + st.r * 0.5} ${st.y - st.r * 0.5} L${st.x - st.r * 0.5} ${st.y + st.r * 0.5}`
            }
            strokeWidth="1.8"
            filter="url(#bd-chalk)"
          />
        ))}
      </g>

      {/* ── KÝ HIỆU TOÁN, giữa sách và bầu trời ─────────────────────────── */}
      <g className="bd-fig-math">
        <text x="176" y="80" fontSize="30">∫</text>
        <text x="210" y="118" fontSize="24">Σ</text>
        <text x="256" y="164" fontSize="22">π</text>
        <text x="140" y="170" fontSize="21">x²</text>
      </g>
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

/** Nét gạch xoá, vẽ tay ngang qua dòng đã thử và bỏ. */
function ChalkStrike() {
  return (
    <svg className="bd-strike-mark" viewBox="0 0 300 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path
        d="M2 7 C 78 3, 156 8, 298 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        filter="url(#bd-chalk-1)"
      />
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
