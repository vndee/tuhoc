import type { StoryMeta } from '../../types';
import { noiseCover } from './cover';

export const noiseMeta: StoryMeta = {
  slug: 'across-the-noise',
  issueNumber: 2,
  published: true,
  featured: true,
  title: { vi: 'Một lời nói đi qua đại dương', en: 'Across the Noise' },
  deck: {
    vi: 'Có một người ở bên kia đại dương đang chờ câu trả lời của bạn. Từ dấu hiệu và dây cáp đến nén dữ liệu và sửa lỗi, điều gì giúp lời nói đến nơi — và điều gì vẫn nằm ngoài đường truyền?',
    en: 'Someone across the ocean is waiting for your reply. From symbols and cables to compression and error correction, what helps a message arrive—and what remains beyond the reach of its channel?',
  },
  cover: noiseCover,
  sceneCount: 12,
  labCount: 12,
};
