import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageProvider';
import { Catalog } from '../registry/Catalog';
import { ImportCourse } from './ImportCourse';
import { Library } from './Library';

/**
 * `/courses` — MỘT nơi chốn cho mọi khoá học, thay cho ba mục thanh bên.
 *
 * Đặc tả: `docs/superpowers/specs/2026-08-23-ia-redesign.md`. Chẩn đoán của nó
 * là thanh bên có năm mục ngang hàng nhưng chúng thuộc **ba loại**: nơi chốn,
 * hành động, và một mục trùng nghĩa với mục khác. Màn này hấp thụ đúng ba trong
 * số ấy:
 *
 *   - "Thư viện" → tab **"Của bạn"** (`pages/Library.tsx`, không đổi ruột);
 *   - "Danh mục registry" → tab **"Kho cộng đồng"** (`registry/Catalog.tsx`);
 *   - "Nhập khóa học" → **nút** "Nhập gói", mở hộp thoại ở ngay trang này.
 *
 * ## Vì sao hai tab là hai LIÊN KẾT, không phải hai nút `role="tab"`
 *
 * Vì chúng là hai ĐỊA CHỈ. Đặc tả đòi `?tab=registry` sống được như một liên
 * kết sâu ("mọi liên kết đã lưu đều dùng đường cũ; xoá thẳng là làm hỏng thứ
 * đang chạy"), và một điều khiển làm đổi thanh địa chỉ là một liên kết. Đổi lấy
 * `role="tab"` sẽ phải tự dựng lại bằng tay đúng những thứ `<a href>` cho sẵn:
 * bàn phím, mở tab mới, nút Lùi của trình duyệt. `aria-current="page"` nói ra
 * cái nào đang mở — cùng cơ chế `GlobalNav` dùng, nên hai thanh trong cùng một
 * ứng dụng không đánh dấu "chỗ bạn đang đứng" theo hai cách khác nhau.
 *
 * ## Chỉ tab ĐANG MỞ được dựng, và đó là một ràng buộc chứ không phải tối ưu
 *
 * `registry/ratingFence.test.tsx` đòi màn hình vẽ course riêng tư **không có ô
 * chấm sao nào và không một request `/ratings` nào**. `Catalog` vẽ ô chấm sao —
 * hợp lệ, vì mọi hàng của nó đến từ `index.json`. Dựng cả hai tab rồi ẩn một
 * cái bằng CSS sẽ gắn `Catalog` vào cây ngay khi người đọc mở tab "Của bạn", và
 * hàng rào ấy đỏ — đúng như nó phải thế. Nên tab không mở thì **không tồn tại**,
 * không phải "tồn tại nhưng `display:none`".
 */
export function Courses() {
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();

  const onRegistry = params.get('tab') === 'registry';
  const importing = params.get('import') === '1';

  /**
   * Mở hộp thoại bằng cách ĐẶT THAM SỐ, không phải bằng `useState`.
   *
   * Ba thứ cùng đòi điều đó: `/import` cũ chuyển hướng vào đây và phải mở ra
   * chính cái nó từng mở (xem `routes.tsx`); lời nhắn "thư viện của bạn đang
   * trống" ở Bảng điều khiển trỏ thẳng vào đây bằng một `<Link>`; và nút Lùi
   * của trình duyệt khi ấy đóng hộp thoại thay vì rời hẳn trang.
   */
  const openImport = useCallback(() => {
    const next = new URLSearchParams(params);
    next.set('import', '1');
    setParams(next);
  }, [params, setParams]);

  /**
   * `replace: true`: mở là một bước lịch sử, đóng thì KHÔNG. Nếu đóng cũng đẩy
   * một bước, nút Lùi ngay sau đó sẽ mở lại hộp thoại người đọc vừa đóng.
   */
  const closeImport = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete('import');
    setParams(next, { replace: true });
  }, [params, setParams]);

  return (
    <div className="courses-page">
      <div className="courses-header">
        <div>
          <h1 className="ch-title">{t('courses.title')}</h1>
          <p className="ch-lede">{t('courses.lede')}</p>
        </div>
        {/*
          Một NÚT, không phải một liên kết, dù nó có đụng tới thanh địa chỉ:
          thứ nó làm là mở một hộp thoại ngay tại chỗ, và `aria-haspopup` nói ra
          điều đó trước khi người dùng bấm. Tham số `?import=1` là để liên kết
          sâu còn dùng được, không phải để biến nó thành một nơi chốn thứ tư.
        */}
        <button type="button" className="btn primary courses-import-btn" aria-haspopup="dialog" onClick={openImport}>
          {t('courses.import.action')}
        </button>
      </div>

      <nav className="courses-tabs" aria-label={t('courses.tabs.aria')}>
        <Link to="/courses" className="courses-tab" aria-current={onRegistry ? undefined : 'page'}>
          {t('courses.tab.yours')}
        </Link>
        <Link to="/courses?tab=registry" className="courses-tab" aria-current={onRegistry ? 'page' : undefined}>
          {t('courses.tab.registry')}
        </Link>
      </nav>

      {onRegistry ? <Catalog /> : <Library />}

      {importing && <ImportDialog onClose={closeImport} />}
    </div>
  );
}

/**
 * `pages/ImportCourse.tsx` nguyên vẹn, đặt trong một hộp thoại có tiêu điểm.
 *
 * ## Vì sao HỘP THOẠI chứ không phải một trang con `/courses/import`
 *
 * Vì đặc tả xếp "Nhập khóa học" vào loại **hành động**, và cả bản thiết kế lại
 * này tồn tại vì ba hành động/thiết lập đang giả dạng nơi chốn. Cho nó một
 * route riêng là dựng lại đúng cái vừa gỡ, chỉ sâu hơn một bậc — sáu tháng nữa
 * sẽ có người hỏi vì sao "nhập gói" là một trang mà "cập nhật gói"
 * (`course/UpdateDialog.tsx`, cùng hạng việc) lại là một hộp thoại.
 *
 * Và nó trả về một thứ mà trang con không trả được: `importCourse` kết thúc
 * bằng `invalidateQueries(coursesQueryKey())`, nên **danh sách ngay phía sau
 * hộp thoại tự cập nhật** — người đọc thấy khoá học mới hiện ra trong chính cái
 * danh sách họ đang đứng, không phải sau một cú điều hướng ngược.
 *
 * ## Cái giá, nói ra chứ không giấu
 *
 * Nhập từ repo có thể mất hàng chục giây (đo được: 313 tệp / 20,04 s). Trong
 * suốt quãng ấy hộp thoại che mất thư viện. Đổi lại, nút "Huỷ" của
 * `ImportCourse` vẫn ở đúng chỗ cũ và Escape bị KHOÁ khi đang chạy (xem
 * `busy` bên dưới) — đóng nhầm giữa chừng một việc dài là cách hỏng tệ hơn.
 */
function ImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const boxRef = useRef<HTMLDivElement | null>(null);
  /**
   * Trạng thái bận đến từ `ImportCourse` qua `onBusyChange`, KHÔNG phải từ một
   * phép dò DOM ở đây. Một bản trước của tệp này hỏi `querySelector('.import-busy')`
   * và như thế là buộc một quy tắc đóng-mở vào một tên class trang trí: đổi tên
   * class là mở khoá được Escape giữa lúc đang nhập, mà không cổng nào đỏ.
   */
  const [busy, setBusy] = useState(false);

  // Cùng lý do `UpdateDialog` làm thế: Escape phải chạy được mà người đọc
  // không cần bấm vào trong hộp thoại trước.
  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  // Đang nhập dở thì Escape, cú bấm ra ngoài và nút Đóng đều KHÔNG đóng: đóng
  // hộp thoại sẽ tháo `ImportCourse` khỏi cây giữa chừng, và người đọc mất cả
  // gói lẫn lời giải thích. Lối thoát đúng lúc ấy là nút "Huỷ" của chính
  // `ImportCourse` — nó huỷ được đúng giai đoạn huỷ được.
  const tryClose = () => {
    if (!busy) onClose();
  };

  return createPortal(
    <>
      {/* Chỉ trang trí: vai trò hộp thoại nằm ở khối bên dưới. */}
      <div className="ci-scrim" aria-hidden="true" onClick={tryClose} />
      <div
        className="ci-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        tabIndex={-1}
        ref={boxRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape') tryClose();
        }}
      >
        <button type="button" className="ci-close" disabled={busy} onClick={onClose}>
          {t('courses.import.close')}
        </button>
        <ImportCourse onBusyChange={setBusy} />
      </div>
    </>,
    document.body,
  );
}

export default Courses;
