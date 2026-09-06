import type { StoryMeta } from '../../types';
import { historyOfAiCover } from './cover';

export const historyOfAiMeta: StoryMeta = {
  slug: 'a-history-of-ai',
  issueNumber: 1,
  published: true,
  featured: false,
  title: { vi: 'Một lịch sử của trí tuệ nhân tạo', en: 'A History of Artificial Intelligence' },
  deck: {
    vi: 'Từ khi ý nghĩ rời khỏi cơ thể, đến những cỗ máy học từ dữ liệu — và một chân trời chưa có tên chung.',
    en: 'From the moment thought found a life outside the body to machines that learn from data — and a horizon we still cannot name together.',
  },
  cover: historyOfAiCover,
  sceneCount: 12,
  labCount: 12,
};
