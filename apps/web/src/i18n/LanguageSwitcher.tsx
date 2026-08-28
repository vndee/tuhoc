import { LANGS, normalizeLang } from './index';
import { useLanguage } from './LanguageProvider';

/**
 * Bộ chọn ngôn ngữ giao diện, sống trong `#topbar` cạnh nút chủ đề sáng/tối.
 *
 * VÌ SAO NÓ CÓ MẶT Ở TASK 4 CHỨ KHÔNG ĐỢI TASK 5. Task 5 là việc *bóc chuỗi* —
 * cơ học, không thêm giao diện mới. Nếu điều khiển này không ra đời ở đây thì
 * `setLang` không có chỗ gọi nào, và cả `<LanguageProvider>` trở thành thứ đạt
 * mọi khẳng định trong bộ test của chính nó **trong khi không ai bấm tới được**
 * — đúng hình dạng cổng mù #4 / ruling S1-F29, thứ repo này đã dính ở quy mô
 * 775 dòng một lần rồi. `LanguageProvider.test.tsx`'s "CỬA" lái `<App/>` thật
 * để hỏi đúng câu đó.
 *
 * Cạnh nút chủ đề, không phải trong trang Cài đặt: hai thứ này cùng một hạng —
 * tuỳ chọn của THIẾT BỊ, không đồng bộ, không thuộc về tài khoản (xem
 * `DEVICE_PREFERENCE_KEYS` ở `db/local.ts`) — nên chúng thuộc về cùng một chỗ.
 *
 * `<select>` chứ không phải hai nút: danh sách ngôn ngữ đọc từ `LANGS`, nên
 * thêm ngôn ngữ thứ ba là sửa một mảng, không phải sửa bố cục. Nó VẪN là
 * `<select>` sau vòng thiết kế lại — bỏ nó đi để lấy một menu tự vẽ là đổi một
 * điều khiển gốc có sẵn bàn phím, trình đọc màn hình và cử chỉ của từng hệ
 * điều hành lấy một bản mô phỏng thiếu cả ba. Thứ đổi là DA: `appearance:none`
 * cộng một mũi chevron tự vẽ trong `app-screens.css`, nên nó thôi mang bo góc
 * và phông chữ của macOS giữa một giao diện không phải của macOS. Nhãn đi qua
 * `aria-label` vì thanh công cụ không có chỗ cho nhãn nhìn thấy được — và đó
 * cũng là tên mà `getByLabelText` trong bài kiểm đọc, nên nhãn không thể mục
 * ruỗng mà không ai biết.
 *
 * Tệp này KHÔNG có một chuỗi tiếng Việt viết cứng nào, kể cả tên hai ngôn ngữ:
 * chúng là khoá `lang.name.*` trong catalog. `i18n.test.ts` khẳng định điều đó
 * — hạ tầng phải tuân thủ cổng mà chính nó dựng lên.
 */
export function LanguageSwitcher() {
  const { lang, setLang, t } = useLanguage();

  return (
    <select
      id="lang-select"
      className="tb-btn"
      aria-label={t('lang.switcher.label')}
      value={lang}
      onChange={(event) => {
        // `normalizeLang` chứ không phải một phép ép kiểu: giá trị của một
        // `<select>` là `string` với TypeScript, và một `as Lang` ở đây sẽ là
        // lời hứa suông đúng chỗ mà `MESSAGES[lang]` sẽ thành `undefined`.
        const next = normalizeLang(event.target.value);
        if (next !== null) setLang(next);
      }}
    >
      {/*
        MÃ NGÔN NGỮ ("VI" / "EN"), không phải tên đầy đủ — bản dựng đã duyệt.

        Đánh đổi, nói ra chứ không giấu: "Tiếng Việt" tự nó đã là một nhãn đọc
        được, còn "VI" thì không. Bù lại bằng tên có thể truy cập của chính điều
        khiển: `aria-label` mang "Ngôn ngữ giao diện", nên trình đọc màn hình
        đọc ra "Ngôn ngữ giao diện, VI" — cụm ấy đủ nghĩa, còn một ô rộng bằng
        chữ "Tiếng Việt" thì chiếm gần gấp ba chỗ của mọi nút khác trên thanh và
        kéo lệch cả nhóm bên phải.

        `title` giữ tên đầy đủ cho con trỏ chuột. Danh sách MỞ RA vẫn là tên đầy
        đủ ở trang Cài đặt, nơi có chỗ cho nó (`pages/Settings.tsx` dựng một bộ
        chọn riêng, cố ý KHÔNG mang `id="lang-select"` — xem Settings.test.tsx).

        `selectOptions(select, 'en')` trong `LanguageProvider.test.tsx` chọn
        theo VALUE nên nó không đọc chữ này; đổi chữ ở đây không làm nó mù.
      */}
      {LANGS.map((option) => (
        <option key={option} value={option} title={t(option === 'vi' ? 'lang.name.vi' : 'lang.name.en')}>
          {option.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
