import { useEffect, useId, useState } from 'react';
import { useMe } from '../api/useMe';
import { useLogout } from '../auth/useLogout';
import { LANGS, normalizeLang } from '../i18n';
import { useLanguage } from '../i18n/LanguageProvider';
import { useVaultFrame } from '../shell/VaultFrame';
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
 * RÀNG BUỘC AN NINH CỦA TRANG NÀY, và nó KHÔNG phải chuyện thẩm mỹ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Trang này không có một `<input>` nào, và đó là ràng buộc chứ không phải sự
 * tình cờ. Ô dán key sống trong khung của kho khoá, ở một origin riêng; một ô
 * trên trang này sẽ đi qua DOM của trang này, và một khoá học hạng `interactive`
 * bị duyệt sót đọc được nó bằng đúng một listener `input` — tức là toàn bộ kiến
 * trúc hai origin trở thành trang trí.
 *
 * `Settings.test.tsx` khẳng định **"không có `<input>` nào"** — ở MỌI mục, chứ
 * không chỉ ở mục mặc định — và `e2e/s2.spec.ts` khẳng định lại điều đó trên
 * trình duyệt thật (`.page-settings input, .page-settings textarea` ⇒ 0). Đó là
 * lý do mục "Ngôn ngữ & giao diện" dùng `<select>` và `<button>`: một ô radio
 * hay một ô text ở đây sẽ làm cả hai cổng đỏ, và đúng ra là như thế.
 *
 * `.page-settings` là lớp mà cả hai cổng ấy bám vào; đừng đổi tên nó mà không
 * đổi cả hai.
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

type SectionId = 'account' | 'ai' | 'appearance' | 'localData';

/**
 * Thứ tự ở đây là thứ tự người dùng thấy, và nó theo canvas: Tài khoản trước
 * (ai đang đăng nhập), rồi Trợ lý AI, rồi hai mục thuộc về thiết bị.
 *
 * `DEFAULT_SECTION` là **Trợ lý AI**, không phải mục đầu danh sách. Lý do đo
 * được, không phải sở thích: mọi lối vào `/settings` hôm nay đều tới từ AI —
 * lời mời "Mở trang cấu hình" trong panel hỏi-đáp (`ai/AskPanel.tsx`), và
 * `e2e/s2.spec.ts` bấm đúng lối ấy rồi đòi ô dán key phải thấy được ngay. Mở
 * vào "Tài khoản" sẽ bắt người vừa bấm "tôi cần cắm key" phải bấm thêm một lần
 * nữa để tới chỗ họ đã nói là mình muốn tới.
 */
const SECTIONS: readonly SectionId[] = ['account', 'ai', 'appearance', 'localData'];
const DEFAULT_SECTION: SectionId = 'ai';

const SECTION_TITLE_KEY = {
  account: 'settings.section.account',
  ai: 'settings.ai.title',
  appearance: 'settings.section.appearance',
  localData: 'settings.section.localData',
} as const;

export function Settings() {
  const { t } = useLanguage();
  const [section, setSection] = useState<SectionId>(DEFAULT_SECTION);

  return (
    <section className="page-settings">
      <h1 className="set-title">{t('account.settings')}</h1>

      <div className="set-grid">
        {/*
          Mục lục là `<nav>` với `<button>`, không phải `<a href>`: mục đang xem
          không đổi URL, nên một liên kết ở đây sẽ hứa một thứ (một địa chỉ chia
          sẻ được) mà nó không giữ. `aria-current` là cách nói "bạn đang ở đây"
          cho một điều khiển không phải liên kết.
        */}
        <nav className="set-toc" aria-label={t('settings.nav.aria')}>
          {SECTIONS.map((id) => (
            <button
              key={id}
              type="button"
              className={id === section ? 'set-toc-item on' : 'set-toc-item'}
              aria-current={id === section ? 'true' : undefined}
              onClick={() => {
                setSection(id);
              }}
            >
              {t(SECTION_TITLE_KEY[id])}
            </button>
          ))}
        </nav>

        <div className="set-main">
          {section === 'account' && <AccountSection />}
          {section === 'ai' && <AiSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'localData' && <LocalDataSection />}
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * TRỢ LÝ AI
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Mục Trợ lý AI có hai việc, và chỉ hai: **giải thích** vì sao ô nhập nằm ở chỗ
 * khác, và **mở khung kho khoá ra** để người dùng nhìn thấy nó.
 *
 * Việc thứ hai vá một ngõ cụt có thật (cổng mù #4 / S1-F29): bảng xác nhận đầu
 * phiên và form cấu hình đều được vẽ sẵn trong khung, nhưng khung ẩn — nên
 * trước trang này chưa ai từng nhìn thấy chúng, và một `needs_consent` là ngõ
 * cụt.
 *
 * **Cái mới ở đây là cái KHUNG.** Kiến trúc origin riêng chỉ có giá trị nếu
 * người dùng nhìn thấy nó, và trước đây trang này chỉ *kể* rằng có một địa chỉ
 * riêng. Nay chỗ ấy là một hộp có viền, có thanh tiêu đề riêng, và trên thanh
 * ấy là **origin thật** — `origin` từ context, tức chính chuỗi mà `src` của
 * khung trỏ tới. Một bản dựng lỡ trỏ kho khoá về origin trang chính sẽ tự nói
 * ra điều đó ở đây, thay vì âm thầm chạy tiếp với một cơ chế đã chết.
 */
function AiSection() {
  const { origin, expanded, setExpanded } = useVaultFrame();
  const { t, tNode } = useLanguage();

  /**
   * Mở khung khi vào mục này, đóng khi rời mục HOẶC rời trang.
   *
   * Đóng lại là phần bắt buộc, ở cả hai chiều: khung mở là một lớp phủ toàn màn
   * hình, nên để nó mở sau khi người học đã bấm sang một chương là che mất giáo
   * trình bằng một trang cấu hình — và để nó mở khi họ vừa bấm sang mục "Tài
   * khoản" là che mất chính mục họ vừa chọn.
   */
  useEffect(() => {
    setExpanded(true);
    return () => {
      setExpanded(false);
    };
  }, [setExpanded]);

  return (
    <>
      <h2 className="set-h">{t('settings.ai.title')}</h2>

      {/*
        `tNode`, không `t`: `<strong>kho khoá</strong>` nằm GIỮA câu. Đây là ca
        đã chốt QĐ-2 — nếu `t()` trả `ReactNode` thì mọi `aria-label`/`title`/
        `throw` trong 37 tệp còn lại phải thu hẹp kiểu bằng tay.
      */}
      <p className="set-lede" data-testid="vault-explainer">
        {tNode('settings.ai.blurb', <strong>{t('settings.ai.blurbVault')}</strong>)}
      </p>

      {origin === null ? (
        <p className="set-note" data-testid="vault-unavailable">
          {t('settings.ai.unavailable')}
        </p>
      ) : (
        <div className="set-vault" data-testid="vault-plane">
          <div className="set-vault-bar">
            <svg
              className="set-vault-lock"
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <rect x="3" y="7" width="10" height="6.5" rx="1.5" />
              <path d="M5.5 7V4.8a2.5 2.5 0 0 1 5 0V7" />
            </svg>
            <p className="set-vault-label" data-testid="vault-frame-label">
              {tNode('settings.ai.frameLabel', <strong data-testid="vault-origin-inline">{origin}</strong>)}
            </p>
          </div>
          <div className="set-vault-body">
            {expanded ? (
              <p className="set-vault-live">{t('settings.ai.frameOpen')}</p>
            ) : (
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setExpanded(true);
                }}
              >
                {t('settings.ai.open')}
              </button>
            )}
          </div>
        </div>
      )}

      <p className="set-note">{t('settings.ai.keyStays')}</p>

      <section className="set-sub">
        <h3 className="set-eyebrow">{t('settings.ai.budgetTitle')}</h3>
        <p className="set-lede">{t('settings.ai.budgetBody')}</p>
      </section>
    </>
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
function AccountSection() {
  const { t } = useLanguage();
  const meQuery = useMe();
  const logout = useLogout();

  return (
    <>
      <h2 className="set-h">{t('settings.section.account')}</h2>
      <p className="set-lede">{t('settings.account.blurb')}</p>

      {meQuery.isPending && <p className="set-note">{t('settings.account.loading')}</p>}
      {/*
        `data == null` phủ cả hai ca mà `isError` bỏ sót: máy chủ trả 500, và
        máy chủ trả 401 (`useMe` biến 401 thành `null`, xem `api/useMe.ts`). Ở
        một trang cấu hình sau `<RequireAuth>`, cả hai đều là "chưa biết ai đang
        đăng nhập", và cả hai đều phải nói ra thay vì để một khoảng trống.
      */}
      {!meQuery.isPending && meQuery.data == null && <p className="set-note">{t('settings.account.unknown')}</p>}
      {meQuery.data != null && (
        <p className="set-identity" data-testid="account-identity">
          {t('settings.account.signedInAs', meQuery.data.name, meQuery.data.email)}
        </p>
      )}

      <p className="set-note">{t('settings.account.signOutWarning')}</p>
      <p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void logout();
          }}
        >
          {t('dashboard.logout')}
        </button>
      </p>
    </>
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

  return (
    <>
      <h2 className="set-h">{t('settings.section.appearance')}</h2>
      <p className="set-lede">{t('settings.appearance.blurb')}</p>

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

      <div className="set-field">
        <p className="set-label">{t('settings.appearance.theme')}</p>
        <p className="set-note" data-testid="theme-now">
          {t(theme === 'dark' ? 'settings.appearance.themeNowDark' : 'settings.appearance.themeNowLight')}
        </p>
        <button type="button" className="btn" onClick={toggle}>
          {t(theme === 'dark' ? 'topbar.themeToLight' : 'topbar.themeToDark')}
        </button>
      </div>
    </>
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
function LocalDataSection() {
  const { t } = useLanguage();

  return (
    <>
      <h2 className="set-h">{t('settings.section.localData')}</h2>
      <p className="set-lede">{t('settings.localData.blurb')}</p>
      <p className="set-note">{t('settings.localData.clearedOnSignOut')}</p>
      <p className="set-note">{t('settings.localData.kept')}</p>
    </>
  );
}
