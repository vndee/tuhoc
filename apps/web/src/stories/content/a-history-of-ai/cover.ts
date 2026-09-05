import type { ResponsiveStoryImage } from '../../types';

import cover768 from './assets/cover-768.webp';
import cover1536 from './assets/cover.webp';

const coverCopy = {
  alt: {
    vi: 'Một bàn tay nhìn lại hành trình từ bảng đất sét, bàn tính, thẻ đục lỗ và transistor đến một chân trời bỏ ngỏ.',
    en: 'A hand considers a material history from clay tablet, abacus, punched card, and transistor to an open horizon.',
  },
  caption: {
    vi: 'Minh hoạ: những vật liệu khác nhau giữ và truyền câu hỏi của con người, không dẫn tới một đích tất yếu.',
    en: 'Illustration: different materials carry human questions without leading to an inevitable destination.',
  },
} as const;

export const historyOfAiCover: ResponsiveStoryImage = {
  src: cover1536,
  srcSet: `${cover768} 768w, ${cover1536} 1536w`,
  sizes: '(max-width: 900px) 100vw, 58vw',
  width: 1536,
  height: 1024,
  bytes: 135330,
  alt: coverCopy.alt,
  caption: coverCopy.caption,
  provenanceId: 'history-ai-cover',
};
