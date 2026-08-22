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
 * thêm ngôn ngữ thứ ba là sửa một mảng, không phải sửa bố cục. Nhãn đi qua
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
      {LANGS.map((option) => (
        <option key={option} value={option}>
          {t(option === 'vi' ? 'lang.name.vi' : 'lang.name.en')}
        </option>
      ))}
    </select>
  );
}
