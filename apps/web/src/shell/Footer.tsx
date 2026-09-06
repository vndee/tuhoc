import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageProvider';

/**
 * Chân trang chung — hai liên kết pháp lý.
 *
 * ## Vì sao nó tồn tại
 *
 * `/privacy` và `/terms` được thêm vào trước đó với đúng MỘT lối vào: dòng chữ
 * dưới thẻ đăng nhập. Người đã đăng nhập không bao giờ thấy màn hình ấy nữa,
 * nên với họ hai trang kia coi như không tồn tại. Đó là chỗ hở component này
 * lấp: một lối vào có mặt trên mọi màn hình.
 *
 * ## Chỉ liên kết, không câu khai
 *
 * Bản đầu có thêm một câu "dự án cộng đồng, nội dung do AI tạo ra". Chủ dự án
 * gỡ nó khỏi cả khay phấn trang chủ lẫn đây. Lời khai ấy nay sống ở hai chỗ
 * người đọc TỚI để tìm nó — hai mục đầu của Điều khoản sử dụng, và lede mục
 * "Về dự án" trong Settings — chứ không lặp trên mỗi màn hình.
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
      <nav className="site-footer-links" aria-label={t('footer.nav')}>
        <Link to="/terms">{t('login.legal.terms')}</Link>
        <Link to="/privacy">{t('login.legal.privacy')}</Link>
      </nav>
    </footer>
  );
}
