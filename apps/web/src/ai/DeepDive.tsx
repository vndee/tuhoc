import { useMemo } from 'react';
import { AskPanel } from './AskPanel';
import { useLanguage } from '../i18n/LanguageProvider';
import { deepDiveQuestion, deepDiveSystemPrompt } from './prompts';
import type { SelectionExcerpt } from './prompts';

/**
 * "ĐÀO SÂU" — trả lời về đúng đoạn người học vừa bôi đen.
 *
 * Component này cố ý **mỏng**: nó không đọc DOM, không chạm `window.getSelection`,
 * và không biết KaTeX là gì. Đoạn trích tới đây đã đi qua phép chiếu của
 * `./prompts` (đúng phép phân đoạn P2 + hoàn nguyên LaTeX), do
 * `SelectionToolbar` gọi tại chỗ nó đã có sẵn `NormMap`.
 *
 * Chia như vậy vì một lý do cụ thể, không phải vì gọn: nếu component này tự
 * đọc vùng chọn thì nó phải tự dựng một `NormMap` thứ hai, và hai bản đồ của
 * cùng một chương là đúng thứ trôi dạt mà `useAnnotations` đã trả giá để
 * tránh — bản thứ hai có thể được chụp SAU khi một chú thích được tô, tức là
 * đã cũ ngay lúc sinh ra.
 */

export interface DeepDiveProps {
  readonly courseTitle: string;
  readonly chapterTitle: string;
  readonly excerpt: SelectionExcerpt;
  readonly onClose: () => void;
}

export function DeepDive({ courseTitle, chapterTitle, excerpt, onClose }: DeepDiveProps) {
  const { lang, t } = useLanguage();
  const built = useMemo(
    () => deepDiveSystemPrompt(excerpt, { lang, courseTitle, chapterTitle }),
    [lang, excerpt, courseTitle, chapterTitle],
  );

  return (
    <AskPanel
      heading={t('ai.deepDive.heading')}
      system={built.system}
      // `built.excerpt`, không phải `excerpt.quote`: nếu người học bôi đen quá
      // dài và lời nhắc phải cắt bớt, thứ hiện lên phải là thứ ĐÃ GỬI ĐI. Hiện
      // bản đầy đủ trong khi gửi bản cắt là nói với người dùng một điều không
      // đúng về việc mô hình đã đọc gì.
      quote={built.excerpt}
      initialQuestion={deepDiveQuestion(lang)}
      autoAsk
      onClose={onClose}
    />
  );
}

export default DeepDive;
