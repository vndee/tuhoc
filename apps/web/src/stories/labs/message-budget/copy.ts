import type { Lang } from '../../../i18n';

interface MessageBudgetCopy {
  budget: string;
  budgetOption: (budget: number) => string;
  shortenedDraft: string;
  originalText: string;
  shortenedText: string;
  metrics: (graphemes: number, bytes: number) => string;
  fits: string;
  over: (count: number) => string;
  invalidDraft: string;
  explanation: string;
}

export const messageBudgetCopy = {
  vi: {
    budget: 'Giới hạn cụm ký tự',
    budgetOption: (budget) => `${budget} cụm ký tự`,
    shortenedDraft: 'Bản rút lời',
    originalText: 'Văn bản gốc',
    shortenedText: 'Văn bản rút lời',
    metrics: (graphemes, bytes) => `${graphemes} cụm ký tự · ${bytes} byte UTF-8`,
    fits: 'Câu đã vừa giới hạn. Bạn có bỏ mất điều gì không?',
    over: (count) => `Bản rút lời vượt giới hạn ${count} cụm ký tự.`,
    invalidDraft: 'Bản rút lời chứa Unicode không hợp lệ.',
    explanation: 'Bộ đếm chỉ kiểm tra độ dài. Biên tập bằng cách bớt chữ có thể đổi nghĩa; mô hình này không chấm điểm điều người nhận sẽ hiểu.',
  },
  en: {
    budget: 'Grapheme budget',
    budgetOption: (budget) => `${budget} grapheme clusters`,
    shortenedDraft: 'Shortened draft',
    originalText: 'Original text',
    shortenedText: 'Shortened text',
    metrics: (graphemes, bytes) => `${graphemes} grapheme cluster${graphemes === 1 ? '' : 's'} · ${bytes} UTF-8 byte${bytes === 1 ? '' : 's'}`,
    fits: 'It fits the budget. Did anything important disappear?',
    over: (count) => `The shortened draft exceeds the budget by ${count} grapheme cluster${count === 1 ? '' : 's'}.`,
    invalidDraft: 'The shortened draft contains invalid Unicode.',
    explanation: 'The counters check length only. Editing by removing words can change meaning; this model does not score what a receiver would understand.',
  },
} satisfies Record<Lang, MessageBudgetCopy>;
