import type { ResponsiveStoryImage } from '../../types';
import cover from './assets/cover.webp';
import coverSmall from './assets/cover-768.webp';

// Kept local so collection metadata loads only the two cover assets.
const coverText = {
  "alt": {
    "vi": "Một bàn viết cạnh cửa sổ nhìn ra cảng, với con tàu nhỏ trong sương và tờ giấy chưa có chữ.",
    "en": "A writing desk beside a window overlooking a harbor, with a small ship in the mist and an unmarked sheet of paper."
  },
  "caption": {
    "vi": "Minh hoạ: trước khi có đường truyền, có một người muốn nói và một người đang chờ.",
    "en": "Illustration: before there is a channel, there is someone who wants to speak and someone waiting."
  }
};

export const noiseCover: ResponsiveStoryImage = {
  src: cover,
  srcSet: `${coverSmall} 768w, ${cover} 1536w`,
  sizes: '(max-width: 900px) 100vw, 58vw',
  width: 1536,
  height: 1024,
  bytes: 223680,
  ...coverText,
  provenanceId: 'noise-cover',
};
