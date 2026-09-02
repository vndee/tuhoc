import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { writeLocalStorage } from '../db/localStorage';
import {
  DEFAULT_LANG,
  LANG_STORAGE_KEY,
  readStoredLang,
  t,
  type Lang,
  type MessageArgs,
  type MessageKey,
  type Messages,
  type Translate,
} from './index';
import { tNode, type SlotArgs, type TranslateNode } from './tNode';

export interface LanguageContextValue {
  lang: Lang;
  setLang: (next: Lang) => void;
  /** `t()` đã gắn `lang` — chỗ gọi không phải cầm theo ngôn ngữ hiện tại. */
  t: Translate;
  /**
   * `tNode()` đã gắn `lang`. CHỈ cho câu có thẻ nằm giữa chừng; mọi thứ khác
   * dùng `t`, vốn trả `string` và đi được vào `aria-label`/`title`/`throw`.
   */
  tNode: TranslateNode;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * CHỦ SỞ HỮU DUY NHẤT của lựa chọn ngôn ngữ trong cả ứng dụng.
 *
 * Một Context chứ không phải một hook gọi ở nhiều nơi, theo đúng bài học đã ghi
 * ở `theme/ThemeContext.tsx`: hai lần gọi cùng một hook trạng thái tạo ra HAI
 * trạng thái, cả hai cùng ghi vào một khoá `localStorage`, và bản mà thanh công
 * cụ đang vẽ lặng lẽ lệch pha với bản vừa bị đổi. Với ngôn ngữ thì triệu chứng
 * còn khó chịu hơn chủ đề sáng/tối — nửa trang một thứ tiếng.
 *
 * KHÔNG có script khởi động trong `index.html` cho ngôn ngữ, khác với chủ đề,
 * và đó là một khác biệt có lý do chứ không phải một thiếu sót: chủ đề cần nó
 * vì CSS được áp TRƯỚC khi React chạy, nên một khung hình sai màu là thấy được.
 * Chữ thì do React vẽ, và `useState` đọc `localStorage` một cách đồng bộ ngay
 * trong lần render đầu tiên, nên không có khung hình nào mang ngôn ngữ sai.
 *
 * Hệ quả: `<html lang>` trong `index.html` là "vi" viết cứng, và giá trị đó
 * KHÔNG được dùng làm nguồn khởi tạo (nếu dùng, một thiết bị đã chọn tiếng Anh
 * sẽ bị kéo về tiếng Việt ở mỗi lần tải). Provider ghi đè nó, không đọc nó.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readStoredLang() ?? DEFAULT_LANG);

  // Giữ `<html lang>` khớp với trạng thái, kể cả ở lần gắn đầu tiên. Đây là
  // thuộc tính mà trình đọc màn hình và tính năng dịch của trình duyệt đọc; để
  // nó nói "vi" trong khi trang đang là tiếng Anh là một lỗi trợ năng thật.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    // Áp và ghi NGAY, không đợi effect: cùng khuôn `useTheme`'s `toggle`. Ghi
    // là best-effort (`writeLocalStorage` nuốt lỗi ở chế độ riêng tư), nên
    // ngôn ngữ vẫn đổi cho phiên này ngay cả khi trình duyệt từ chối lưu.
    document.documentElement.lang = next;
    writeLocalStorage(LANG_STORAGE_KEY, next);
    setLangState(next);
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang,
      t: <K extends MessageKey>(key: K, ...args: MessageArgs<Messages[K]>) => t(lang, key, ...args),
      tNode: <K extends MessageKey>(key: K, ...parts: SlotArgs<MessageArgs<Messages[K]>>) =>
        tNode(lang, key, ...parts),
    }),
    [lang, setLang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * Ném ngoài `<LanguageProvider>` thay vì lặng lẽ trả về mặc định — cùng lựa
 * chọn, cùng lý do như `useThemeContext()`.
 *
 * Một mặc định lặng lẽ ở đây cho ra một trang **hai thứ tiếng**: phần có
 * provider vẽ tiếng Anh, phần quên provider vẫn vẽ tiếng Việt, và không bài
 * kiểm nào đỏ. Ném thì hỏng ồn ào, ngay ở bài kiểm đầu tiên chạm tới component
 * ấy — đúng thứ Task 5 cần khi nó bóc 36 tệp và phải sửa bộ test của từng tệp.
 */
export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (ctx === null) {
    throw new Error('useLanguage() must be used within <LanguageProvider>');
  }
  return ctx;
}
