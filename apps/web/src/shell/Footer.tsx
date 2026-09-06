import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageProvider';

/**
 * Chân trang chung — hai liên kết pháp lý và một câu khai.
 *
 * ## Vì sao nó tồn tại
 *
 * `/privacy` và `/terms` được thêm vào trước đó với đúng MỘT lối vào: dòng chữ
 * dưới thẻ đăng nhập. Người đã đăng nhập không bao giờ thấy màn hình ấy nữa,
 * nên với họ hai trang kia coi như không tồn tại. Đó là chỗ hở component này
 * lấp: một lối vào có mặt trên mọi màn hình.
 *
 * ## Câu khai không phải chữ đệm cho đủ chỗ
 *
 * "Dự án cộng đồng. Phần lớn nội dung do AI tạo ra" là thứ người đọc cần biết
 * TRONG LÚC đọc, không phải sau khi đã tin — nên nó ở đây, dưới mỗi chương,
 * chứ không chỉ nằm trong Điều khoản mà ai cũng bỏ qua.
 *
 * ## Nó KHÔNG hiện trên hai màn hình trước-tài-khoản
 *
 * `Shell` chỉ dựng component này khi `authScreen` là false. Landing và Login tự
 * mang thế giới hình riêng và đã có lối vào hai trang ấy trong bố cục của
 * chúng; thêm một dải nữa ở dưới là hai chân trang chồng nhau. Xem `Shell.tsx`.
 */
export function Footer() {
  const { t } = useLanguage();

  return (
    <footer id="site-footer">
      <p className="site-footer-note">{t('footer.blurb')}</p>
      <nav className="site-footer-links" aria-label={t('footer.nav')}>
        <Link to="/terms">{t('login.legal.terms')}</Link>
        <Link to="/privacy">{t('login.legal.privacy')}</Link>
      </nav>
    </footer>
  );
}
