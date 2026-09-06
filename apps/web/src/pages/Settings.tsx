import { useEffect, useId } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AgentConfigPanel } from '../ai/AgentConfigPanel';
import { CreditPanel } from '../ai/CreditPanel';
import { useMe, accountInitials } from '../api/useMe';
import { useLogout } from '../auth/useLogout';
import { LANGS, normalizeLang } from '../i18n';
import { useLanguage } from '../i18n/LanguageProvider';
import { useThemeContext } from '../theme/ThemeContext';

/**
 * `/settings` — **CÀI ĐẶT**, và Trợ lý AI là MỘT MỤC bên trong nó.
 *
 * Trước thay đổi này, `/settings` *là* trang Trợ lý AI: một mục thanh bên ngang
 * hàng với "Thư viện" và "Bảng điều khiển", tức là một **thiết lập** được trình
 * bày như một **nơi chốn**. Đặc tả IA
 * (`docs/superpowers/specs/2026-08-23-ia-redesign.md`) xếp lại: `/settings` vào
 * từ menu tài khoản ở đáy thanh bên, và bên trong nó là một mục lục — Tài
 * khoản, Trợ lý AI, Ngôn ngữ & giao diện, Dữ liệu trên máy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RÀNG BUỘC AN NINH CỦA TRANG NÀY — ĐÃ ĐỔI Ở PHA 2, VÀ VÌ SAO ĐỔI ĐÚNG
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Tới Task 13, trang này KHÔNG có một `<input>`/`<textarea>` nào, và đó từng là
 * ràng buộc chứ không phải sự tình cờ: ô dán KEY của nhà cung cấp (DeepSeek/
 * OpenAI/…) sống trong khung của kho khoá, ở một origin riêng. Một ô trên trang
 * chính sẽ đi qua DOM của trang chính, và một khoá học hạng `interactive` bị
 * duyệt sót — hay bất kỳ mã nào chạy được trong origin này — đọc được nó bằng
 * đúng một listener `input`.
 *
 * PHA 2 GỠ ĐÚNG THỨ CẦN GỠ ĐI: `apps/api/internal/ai/handler.go` chạy DeepSeek
 * bằng key CỦA NỀN TẢNG, trả bằng credit — không còn key nào của người học để
 * bảo vệ. Lời nhắc riêng (`system_prompt`, `AgentConfigPanel.tsx`) không phải
 * một bí mật: nó là một tuỳ chỉnh cá nhân, lưu qua `PUT /ai/config` trên PHIÊN
 * ĐĂNG NHẬP đã có — và một mã độc chạy được trong origin này đã có thể gọi
 * chính route đó bằng cookie phiên (`credentials: 'include'`), KHÔNG CẦN đọc
 * bất kỳ ô nào trên màn hình để làm vậy. Cách ly hai origin chỉ có giá trị cho
 * một bí mật mà chính JavaScript của trang cũng không được phép biết; không gì
 * trên trang này còn ở hạng đó.
 *
 * Ràng buộc còn lại — hẹp hơn — là: KHÔNG `<input>` và KHÔNG `[contenteditable]`
 * nào (không đổi: những hạng phần tử đó chưa từng cần ở đây), và ĐÚNG MỘT
 * `<textarea>` — ô sửa `system_prompt` của `AgentConfigPanel`, không hơn.
 * `Settings.test.tsx` khẳng định đúng con số đó ở MỌI mục, không chỉ mục mặc
 * định. `.page-settings` là lớp mà cổng ấy bám vào; đừng đổi tên nó mà không
 * sửa cổng theo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO MỖI MỤC LÀ MỘT COMPONENT RIÊNG, CHỈ GẮN KHI ĐƯỢC CHỌN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Không phải để "chia nhỏ cho gọn". Mỗi mục đọc một Context khác nhau —
 * `useMe()`/`useLogout()` cần `<QueryClientProvider>`, `useThemeContext()` NÉM
 * ngoài `<ThemeProvider>` — và gắn cả bốn cùng lúc sẽ bắt mọi chỗ dựng
 * `<Settings/>` phải có đủ mọi provider để xem được mục mặc định. Gắn theo lựa
 * chọn giữ cho mỗi mục chỉ đòi đúng thứ nó dùng, và giữ cho trang không gửi một
 * `GET /me` chỉ vì ai đó vào xem cấu hình AI.
 */

/**
 * MỘT TRANG, KHÔNG CÒN TAB.
 *
 * Trang này có bốn khối và tổng cộng khoảng một màn rưỡi nội dung. Chia một
 * lượng như thế thành ba tab bắt người dùng trả một cái giá mà không nhận lại
 * gì: mỗi lần muốn biết "mình còn bao nhiêu credit" hay "máy đang giữ bao
 * nhiêu" đều là một cú bấm và một lần đoán xem nó nằm ở tab nào. Cuộn thì rẻ
 * hơn.
 *
 * `SectionId` VẪN CÒN, và nó không phải tàn dư: `ai/AskPanel.tsx` điều hướng
 * sang đây với `state={{ section: 'ai' }}` (lời mời nạp credit khi hết —
 * `ai/AskPanel.tsx`'s `needsSetup`), và ý định ấy có nghĩa "CUỘN tới khối ấy".
 */
type SectionId = 'general' | 'ai' | 'localData';

const SECTIONS: readonly SectionId[] = ['general', 'ai', 'localData'];

/** Ý định do lối vào truyền sang, qua `<Link state={…}>`. Không có thì `null`. */
export type SettingsNavIntent = {
  readonly section?: SectionId;
};

function readIntent(state: unknown): SettingsNavIntent {
  // `history.state` là dữ liệu NGƯỜI DÙNG kiểm soát được (họ có thể tự dựng nó
  // bằng history API, và nó sống sót qua back/forward), nên đọc phòng thủ và
  // chỉ nhận đúng những giá trị đã biết.
  if (typeof state !== 'object' || state === null) return {};
  const record = state as { section?: unknown };
  const section = SECTIONS.find((id) => id === record.section);
  return { section };
}

/** Neo để cuộn tới. Cũng là `id` thật trên DOM, nên `#ai` trên URL cũng chạy. */
const SECTION_ANCHOR: Record<SectionId, string> = {
  general: 'settings-general',
  ai: 'settings-ai',
  localData: 'settings-local-data',
};

export function Settings() {
  const { t } = useLanguage();
  const intent = readIntent(useLocation().state);

  /**
   * Cuộn tới khối mà lối vào chỉ định — MỘT LẦN, sau khi cây đã dựng.
   *
   * `intent` đọc từ `history.state`, thứ sống dai hơn lần điều hướng sinh ra nó
   * (nó còn nguyên khi người dùng bấm back rồi forward). Nên hiệu ứng này có
   * deps rỗng: cuộn lại mỗi lần render sẽ kéo người dùng ngược lên mỗi khi họ
   * vừa tự cuộn xuống chỗ khác.
   */
  useEffect(() => {
    if (intent.section === undefined) return;
    const target = document.getElementById(SECTION_ANCHOR[intent.section]);
    // `scrollIntoView` được BỌC, không gọi thẳng: jsdom không cài nó, và quan
    // trọng hơn — cuộn ở đây là một phần thưởng thêm, không phải điều kiện.
    // Mọi khối đều đã ở trên trang; không cuộn được thì người dùng vẫn thấy
    // đúng thứ họ tới xem, chỉ là phải tự kéo. Một ngoại lệ ở đây sẽ làm hỏng
    // cả trang vì một thứ trang trí.
    if (typeof target?.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="page-settings">
      <h1 className="set-title">{t('account.settings')}</h1>
      {/* Câu dẫn của trang — bản dựng có, bản đang chạy thì nhảy thẳng từ nhan
          đề xuống nội dung. Nó nói ra trang này gồm những gì. */}
      <p className="set-page-lede">{t('settings.lede')}</p>

      <div className="set-main">
        <AccountSection anchor={SECTION_ANCHOR.general} />
        <AppearanceSection />
        <AiSection anchor={SECTION_ANCHOR.ai} />
        <LocalDataSection anchor={SECTION_ANCHOR.localData} />
        <LegalSection />
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * VỀ DỰ ÁN — lối vào hai trang pháp lý cho người ĐÃ đăng nhập
 *
 * Chân trang chung (`shell/Footer.tsx`) đã có hai liên kết này trên mọi màn
 * hình, nên mục ở đây KHÔNG phải để lấp một chỗ hở điều hướng. Nó có mặt vì
 * Settings là nơi người ta tới khi đi TÌM những thứ này — "tài khoản của tôi,
 * dữ liệu của tôi, điều khoản" là một cụm câu hỏi, và mục `LocalDataSection`
 * ngay trên đã trả lời một nửa cụm ấy.
 * ══════════════════════════════════════════════════════════════════════════ */
function LegalSection() {
  const { t } = useLanguage();

  return (
    <section className="set-block">
      <div className="set-side">
        <h2 className="set-h">{t('settings.legal.title')}</h2>
        <p className="set-lede">{t('settings.legal.blurb')}</p>
      </div>

      <div className="set-block-main">
        <p className="set-legal-links">
          <Link to="/terms">{t('login.legal.terms')}</Link>
          <Link to="/privacy">{t('login.legal.privacy')}</Link>
        </p>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * TRỢ LÝ AI — Pha 2: credit + cấu hình agent thay khung kho khoá
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Mục Trợ lý AI, viết lại hoàn toàn cho task-14 (task-14-brief.md).
 *
 * KHÔNG CÒN GÌ ĐỂ MỞ RA. Bản Task 9 có một việc trung tâm: mở khung kho khoá
 * ẩn ra để người dùng nhìn thấy nó (vá ngõ cụt "bảng xác nhận vẽ trong một
 * khung không ai từng thấy"). Pha 2 không có khung nào cả — `useAI.ts`'s doc
 * comment nói rõ: máy chủ luôn cấu hình sẵn AI, không có "chưa cắm key" hay
 * "bản dựng thiếu kho khoá" để giải thích hay mở ra nữa.
 *
 * Mục này giờ chỉ LÀM hai việc, và cả hai đều đọc/ghi máy chủ thật (không còn
 * `postMessage` tới một origin khác):
 *
 *   1. `CreditPanel` (`ai/CreditPanel.tsx`) — số dư và sổ dùng gần đây,
 *      `GET /ai/credits`.
 *   2. `AgentConfigPanel` (`ai/AgentConfigPanel.tsx`) — lời nhắc riêng và
 *      tool bật/tắt, `GET`/`PUT /ai/config`.
 *
 * Cả hai là component ĐỘC LẬP (tự `useQuery`/`useMutation` riêng), không phải
 * hai nhánh JSX rẽ theo cùng một `useAI`-kiểu state ở đây — mỗi cái đứng vững
 * một mình và có bộ kiểm riêng (`CreditPanel.test.tsx`,
 * `AgentConfigPanel.test.tsx`); tệp này (và `Settings.test.tsx`) chỉ còn phải
 * canh rằng CẢ HAI có mặt đúng chỗ, không lặp lại việc kiểm chi tiết bên trong
 * chúng.
 */
function AiSection({ anchor }: { anchor: string }) {
  const { t } = useLanguage();

  return (
    <section className="set-block" id={anchor}>
      <div className="set-side">
        <h2 className="set-h">{t('settings.ai.title')}</h2>
        <p className="set-lede">{t('settings.ai.blurb')}</p>
      </div>

      <div className="set-block-main">
        <CreditPanel />

        <section className="set-sub">
          <h3 className="set-eyebrow">{t('settings.ai.configTitle')}</h3>
          <AgentConfigPanel />
        </section>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * TÀI KHOẢN
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Ai đang đăng nhập, và lối ra.
 *
 * Câu cảnh báo cạnh nút "Đăng xuất" nói ra một hệ quả CÓ THẬT chứ không phải
 * một lời lịch sự: `useLogout` gọi `clearSession()`, thứ xoá mọi bảng cục bộ.
 * Người bấm mà không biết điều đó sẽ mất ghi chú chưa kịp đồng bộ — và câu ấy
 * là chỗ duy nhất trong giao diện nói ra.
 */
function AccountSection({ anchor }: { anchor: string }) {
  const { t } = useLanguage();
  const meQuery = useMe();
  const logout = useLogout();

  return (
    <section className="set-block" id={anchor}>
      <div className="set-side">
        <h2 className="set-h">{t('settings.section.account')}</h2>
        {/* Câu NGẮN, không phải cả đoạn giải thích. Mục này nay đứng chung một
            trang với hai mục khác (xem `SectionId`), nên ba cột trái phải quét
            được bằng mắt — một đoạn bốn dòng ở đây sẽ đẩy hai mục kia xuống
            dưới nếp gấp. Đoạn dài chuyển thành câu cảnh báo cạnh nút Đăng xuất,
            nơi nó thật sự cần đọc. */}
        <p className="set-lede">{t('settings.account.syncBlurb')}</p>
      </div>

      <div className="set-block-main">

      {meQuery.isPending && <p className="set-note">{t('settings.account.loading')}</p>}
      {/*
        `data == null` phủ cả hai ca mà `isError` bỏ sót: máy chủ trả 500, và
        máy chủ trả 401 (`useMe` biến 401 thành `null`, xem `api/useMe.ts`). Ở
        một trang cấu hình sau `<RequireAuth>`, cả hai đều là "chưa biết ai đang
        đăng nhập", và cả hai đều phải nói ra thay vì để một khoảng trống.
      */}
      {!meQuery.isPending && meQuery.data == null && <p className="set-note">{t('settings.account.unknown')}</p>}
      {meQuery.data != null && (
        <div className="set-identity">
          {/* Hai chữ cái GIỐNG HỆT đĩa tròn trên thanh trên — cùng
              `accountInitials`, vì hai chỗ hiện hai chữ khác nhau thì với người
              dùng đó là hai tài khoản khác nhau. `aria-hidden` vì dòng chữ ngay
              bên phải đã nói đầy đủ. */}
          <span className="set-identity-avatar" aria-hidden="true">
            {accountInitials(meQuery.data.name, meQuery.data.email)}
          </span>
          <p className="set-identity-text" data-testid="account-identity">
            {/* Tên và email trên HAI dòng, đúng bản dựng: gộp vào một dòng ngăn
                bằng dấu chấm giữa thì cái quan trọng hơn (email — thứ định danh
                thật) tụt xuống hàng thứ hai của một câu. Chuỗi gộp vẫn còn
                trong `aria-label` để trình đọc màn hình nghe trọn một câu. */}
            <span className="sr-only">
              {t('settings.account.signedInAs', meQuery.data.name, meQuery.data.email)}
            </span>
            <span aria-hidden="true">
              {meQuery.data.name !== '' && <span className="set-identity-name">{meQuery.data.name}</span>}
              <span className="set-identity-email">{meQuery.data.email}</span>
            </span>
          </p>
          {/*
            NÚT NẰM TRONG THẺ, dồn phải — bản dựng đặt nó đúng đây, và chỗ ấy
            đúng: nó là hành động thuộc về CHÍNH tài khoản đang hiện, nên đặt
            nó cạnh danh tính thì không ai phải hỏi "đăng xuất khỏi cái gì".

            `danger`, không phải một nút thứ cấp xám: nó xoá sạch dữ liệu học
            trên máy — gói đã tải, ghi chú, và hàng đợi tiến độ chưa gửi được
            (câu cảnh báo ngay dưới nói đúng thế). Một hành động không hoàn tác
            được mà trông y hệt "Huỷ" là một cái bẫy.
          */}
          <button
            type="button"
            className="btn danger set-identity-action"
            onClick={() => {
              void logout();
            }}
          >
            {t('account.logout')}
          </button>
        </div>
      )}

      <p className="set-note">{t('settings.account.signOutWarning')}</p>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * NGÔN NGỮ & GIAO DIỆN
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Hai tuỳ chọn của THIẾT BỊ, gom lại một chỗ vì chúng cùng một hạng: không đồng
 * bộ, không thuộc tài khoản, và `clearLocalData()` cố ý không đụng tới chúng
 * (xem `DEVICE_PREFERENCE_KEYS` ở `db/local.ts`).
 *
 * Cả hai điều khiển này VẪN Ở TRÊN THANH CÔNG CỤ. Đây là bản thứ hai, không
 * phải bản thay thế, và đó là lựa chọn có ý: thanh công cụ là chỗ đổi nhanh,
 * còn ở đây là chỗ người dùng đi tìm khi họ *không biết* nút ấy nằm đâu — cùng
 * lý do mọi ứng dụng có cả phím tắt lẫn mục menu. Cái giá phải trả là hai chỗ
 * ghi cùng một trạng thái, và cái giá ấy được trả bằng cách KHÔNG có state thứ
 * hai: bộ chọn dưới đây đọc và ghi thẳng `useLanguage()`/`useThemeContext()`,
 * đúng nguồn mà thanh công cụ dùng.
 *
 * `<select>` và `<button>`, KHÔNG `<input type=radio>`: xem ràng buộc "không có
 * `<input>` nào" ở đầu tệp. Một bộ radio ở đây là cách tự nhiên nhất để hỏng
 * đúng chỗ đắt nhất.
 *
 * Bộ chọn ngôn ngữ ở đây KHÔNG mang `id="lang-select"` — id ấy thuộc về
 * `i18n/LanguageSwitcher.tsx` trên thanh công cụ, và `e2e/s3.spec.ts` định vị
 * bằng `document.getElementById('lang-select')`. Hai phần tử cùng id sẽ làm phép
 * đo ấy chọn nhầm phần tử và im lặng. Nhãn cũng khác chữ với nhãn của thanh
 * công cụ, nên `getByLabelText('Ngôn ngữ giao diện')` vẫn chỉ tìm thấy đúng một.
 */
function AppearanceSection() {
  const { lang, setLang, t } = useLanguage();
  const { theme, toggle } = useThemeContext();
  const languageId = useId();
  const themeLabelId = useId();

  return (
    <section className="set-block">
      <div className="set-side">
        <h2 className="set-h">{t('settings.section.appearance')}</h2>
        <p className="set-lede">{t('settings.appearance.blurb')}</p>
      </div>

      <div className="set-block-main">

      <div className="set-field">
        <label className="set-label" htmlFor={languageId}>
          {t('settings.appearance.language')}
        </label>
        <select
          id={languageId}
          className="set-select"
          value={lang}
          onChange={(event) => {
            // `normalizeLang` chứ không phải một phép ép kiểu: giá trị của một
            // `<select>` là `string` với TypeScript, và một `as Lang` ở đây sẽ
            // là lời hứa suông đúng chỗ mà `MESSAGES[lang]` sẽ thành
            // `undefined`.
            const next = normalizeLang(event.target.value);
            if (next !== null) setLang(next);
          }}
        >
          {LANGS.map((option) => (
            <option key={option} value={option}>
              {t(option === 'vi' ? 'lang.name.vi' : 'lang.name.en')}
            </option>
          ))}
        </select>
      </div>

      {/*
        HAI NÚT ĐỨNG CẠNH NHAU, không phải một nút "đổi sang giao diện tối".

        Một nút chuyển đổi nói ra thứ SẮP xảy ra; một hàng chọn nói ra thứ ĐANG
        đúng. Bản dựng vẽ hàng chọn, và nó đúng hơn cho một trang cấu hình —
        nơi người ta vào để biết mình đang ở đâu chứ không chỉ để lật.

        Bản dựng có BA lựa chọn (Sáng / Tối / Theo máy). Ở đây chỉ có hai, và
        chỗ thiếu là một tính năng chứ không phải một nút bị quên: `useTheme`
        chỉ biết `'light' | 'dark'`, còn "Theo máy" cần theo dõi
        `prefers-color-scheme` và phải đi qua cả đoạn khởi động nội tuyến trong
        `index.html` (thứ chặn một khung nhấp nháy sai màu, và có bài kiểm
        riêng). Dựng một nút thứ ba không làm gì là tệ hơn hai nút thật.

        `role="radiogroup"` chứ không phải hai `<button>` rời: chúng loại trừ
        nhau, và `aria-checked` là thứ nói ra điều đó cho trình đọc màn hình.
      */}
      <div className="set-field">
        <p className="set-label" id={themeLabelId}>
          {t('settings.appearance.theme')}
        </p>
        <div className="set-seg" role="radiogroup" aria-labelledby={themeLabelId}>
          {(['light', 'dark'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={theme === option}
              className={theme === option ? 'set-seg-btn on' : 'set-seg-btn'}
              onClick={() => {
                if (theme !== option) toggle();
              }}
            >
              {option === 'light' ? (
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <circle cx="10" cy="10" r="3.4" stroke="currentColor" strokeWidth="1.6" />
                  <path
                    d="M10 2.6v1.8M10 15.6v1.8M17.4 10h-1.8M4.4 10H2.6M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3M15.2 15.2l-1.3-1.3M6.1 6.1L4.8 4.8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M16.4 12.3A6.7 6.7 0 017.7 3.6a6.8 6.8 0 108.7 8.7z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              {t(option === 'light' ? 'settings.appearance.themeLight' : 'settings.appearance.themeDark')}
            </button>
          ))}
        </div>
        {/* Câu này ở lại: `Settings.test.tsx` đo nó, và nó là bản CHỮ của cùng
            sự thật mà hàng nút vừa nói bằng hình. */}
        <p className="set-note" data-testid="theme-now">
          {t(theme === 'dark' ? 'settings.appearance.themeNowDark' : 'settings.appearance.themeNowLight')}
        </p>
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * DỮ LIỆU TRÊN MÁY
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Mục này chỉ có chữ, và đó là chủ ý.
 *
 * Thứ hiển nhiên để thêm vào đây là một nút "Xoá dữ liệu trên máy này". Nó
 * không có mặt vì hai lý do: đường xoá duy nhất đã được kiểm kỹ là
 * `clearSession()` trong `useLogout`/`Login` — nơi việc xoá đi kèm một lần đổi
 * phiên và một lần điều hướng — còn một nút xoá đứng một mình sẽ là đường thứ
 * hai vào cùng một trạng thái, với ngữ cảnh khác và không cổng nào canh; và một
 * hành động không hoàn tác được thì đáng một task riêng có bảng xác nhận của
 * chính nó, không phải một dòng thêm vào cuối một trang cấu hình.
 *
 * Cái mục này thật sự nợ người dùng là một câu trả lời cho *"máy này đang giữ
 * những gì của tôi, và khi nào thì mất?"* — và đó là chữ.
 */
/**
 * SAU PHA 3, MỤC NÀY NÓI MỘT ĐIỀU KHÁC HẲN — và bản trước của nó nói SAI.
 *
 * Bản trước (Pha 2) mang hai con số và hai câu: "Ghi chú nằm ở hai nơi: một
 * bản trong trình duyệt này…" và "Cơ sở dữ liệu mang tên TRÌNH DUYỆT… bị xoá
 * sạch mỗi lần đổi người đăng nhập". Cả hai mô tả một mô hình đã chết ở Task
 * 7–10 (spec `2026-08-25-server-side-pivot.md`): ghi chú, tiến độ, nhịp học
 * đều là dữ liệu MÁY CHỦ, Dexie đã gỡ, và con số "ghi chú" trên trang thực ra
 * đếm `GET /annotations` — tức máy chủ — dưới một tiêu đề nói "trên máy". Con
 * số "đang chiếm" là `navigator.storage.estimate()` của cả origin, không nói
 * gì về dữ liệu của người dùng. Người dùng đọc trang này đã hỏi đúng câu:
 * "đã pivot lên database rồi, sao còn lưu trên trình duyệt?"
 *
 * Nay mục này chỉ có CHỮ, và chữ ấy là sự thật đo được từ `db/localStorage.ts`:
 * trên máy chỉ còn ba khoá — `itbook-theme`, `itbook-lang` (tuỳ chọn thiết bị,
 * ở lại khi đăng xuất) và `itbook-note-draft` (bản nháp ghi chú đang gõ,
 * `clearUserContent()` xoá khi đổi phiên). Không con số nào: không có gì ở
 * đây đáng đếm, và một con số đứng dưới tiêu đề "trên máy" là cách nhanh nhất
 * để lời hứa sai quay lại. `Settings.copy.test.tsx` canh nguyên văn hai câu cũ.
 */
function LocalDataSection({ anchor }: { anchor: string }) {
  const { t } = useLanguage();

  return (
    <section className="set-block" id={anchor}>
      <div className="set-side">
        <h2 className="set-h">{t('settings.section.localData')}</h2>
        <p className="set-lede">{t('settings.localData.blurb')}</p>
      </div>

      <div className="set-block-main">
        <p className="set-note">{t('settings.localData.draft')}</p>
        <p className="set-note">{t('settings.localData.kept')}</p>
      </div>
    </section>
  );
}
