import { useEffect } from 'react';
import { useLanguage } from '../i18n/LanguageProvider';
import { useVaultFrame } from '../shell/VaultFrame';

/**
 * TRANG CẤU HÌNH TRỢ LÝ AI — và điều đáng nói nhất về nó là **thứ nó không có**.
 *
 * Trang này không có một `<input>` nào, và đó là một ràng buộc chứ không phải
 * một sự tình cờ. Ô dán key sống trong khung của kho khoá, ở một origin riêng;
 * một ô trên trang này sẽ đi qua DOM của trang này, và một course hạng
 * `interactive` bị duyệt sót đọc được nó bằng đúng một listener `input` — tức
 * là toàn bộ kiến trúc hai origin trở thành trang trí. `Settings.test.ts`
 * khẳng định "không có `<input>` nào", chứ không phải "không có ô nào tên là
 * bí mật": một ô tên `q` cũng đọc được y hệt.
 *
 * Việc của trang này chỉ có hai: **giải thích** vì sao ô nhập nằm ở chỗ khác,
 * và **mở khung kho khoá ra** để người dùng nhìn thấy nó.
 *
 * Điều thứ hai vá một ngõ cụt có thật. Bảng xác nhận đầu phiên (Task 9) và form
 * cấu hình (Task 6) đều được vẽ sẵn trong khung, nhưng khung ẩn — nên trước
 * trang này **chưa ai từng nhìn thấy chúng**, và một `needs_consent` là ngõ
 * cụt: người dùng bấm hỏi AI, không có gì xảy ra, không lời giải thích. Đó
 * đúng hình dạng "cổng mù #4" (S1-F29) trong `docs/carried-forward.md`.
 */
export function Settings() {
  const { origin, expanded, setExpanded } = useVaultFrame();
  const { t, tNode } = useLanguage();

  /**
   * Mở khung khi vào trang, đóng khi rời. Đóng lại là phần bắt buộc: khung mở
   * rộng là một lớp phủ toàn màn hình, và để nó mở sau khi người học đã bấm
   * sang một chương là che mất giáo trình bằng một trang cấu hình.
   */
  useEffect(() => {
    setExpanded(true);
    return () => {
      setExpanded(false);
    };
  }, [setExpanded]);

  return (
    <section className="page-settings">
      <h1>{t('settings.ai.title')}</h1>

      {/*
        `tNode`, không `t`: `<strong>kho khoá</strong>` nằm GIỮA câu. Đây là ca
        đã chốt QĐ-2 — nếu `t()` trả `ReactNode` thì mọi `aria-label`/`title`/
        `throw` trong 37 tệp còn lại phải thu hẹp kiểu bằng tay.
      */}
      <p data-testid="vault-explainer">
        {tNode('settings.ai.blurb', <strong>{t('settings.ai.blurbVault')}</strong>)}
      </p>

      <p>{t('settings.ai.keyStays')}</p>

      {origin === null ? (
        <p data-testid="vault-unavailable">{t('settings.ai.unavailable')}</p>
      ) : (
        !expanded && (
          <p>
            <button type="button" className="btn primary" onClick={() => { setExpanded(true); }}>
              {t('settings.ai.open')}
            </button>
          </p>
        )
      )}
    </section>
  );
}
