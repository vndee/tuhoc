import type { SceneId, StoryIllustration } from '../../types';
import { issueCopy } from './copy';

import scene01 from './assets/scene-01.webp';
import scene01Small from './assets/scene-01-768.webp';
import scene02 from './assets/scene-02.webp';
import scene02Small from './assets/scene-02-768.webp';
import scene03 from './assets/scene-03.webp';
import scene03Small from './assets/scene-03-768.webp';
import scene04 from './assets/scene-04.webp';
import scene04Small from './assets/scene-04-768.webp';
import scene05 from './assets/scene-05.webp';
import scene05Small from './assets/scene-05-768.webp';
import scene06 from './assets/scene-06.webp';
import scene06Small from './assets/scene-06-768.webp';
import scene07 from './assets/scene-07.webp';
import scene07Small from './assets/scene-07-768.webp';
import scene08 from './assets/scene-08.webp';
import scene08Small from './assets/scene-08-768.webp';
import scene09 from './assets/scene-09.webp';
import scene09Small from './assets/scene-09-768.webp';
import scene10 from './assets/scene-10.webp';
import scene10Small from './assets/scene-10-768.webp';
import scene11 from './assets/scene-11.webp';
import scene11Small from './assets/scene-11-768.webp';
import scene12 from './assets/scene-12.webp';
import scene12Small from './assets/scene-12-768.webp';

const illustration = (
  sceneId: SceneId,
  src: string,
  small: string,
  bytes: number,
  dominantColor: string,
): StoryIllustration => ({
  src,
  srcSet: `${small} 768w, ${src} 1536w`,
  sizes: '(max-width: 900px) 100vw, 58vw',
  width: 1536,
  height: 1024,
  bytes,
  ...issueCopy.imageText[sceneId],
  provenanceId: `noise-${sceneId}`,
  dominantColor,
});

export const noiseIllustrations: Record<SceneId, StoryIllustration> = {
  'scene-01': illustration('scene-01', scene01, scene01Small, 301448, '#928972'),
  'scene-02': illustration('scene-02', scene02, scene02Small, 263924, '#2f2f29'),
  'scene-03': illustration('scene-03', scene03, scene03Small, 258196, '#76684e'),
  'scene-04': illustration('scene-04', scene04, scene04Small, 231138, '#d5d0c8'),
  'scene-05': illustration('scene-05', scene05, scene05Small, 317970, '#746750'),
  'scene-06': illustration('scene-06', scene06, scene06Small, 249460, '#32322a'),
  'scene-07': illustration('scene-07', scene07, scene07Small, 244110, '#534732'),
  'scene-08': illustration('scene-08', scene08, scene08Small, 259870, '#d4c7ad'),
  'scene-09': illustration('scene-09', scene09, scene09Small, 204304, '#d1c4ad'),
  'scene-10': illustration('scene-10', scene10, scene10Small, 217032, '#30271b'),
  'scene-11': illustration('scene-11', scene11, scene11Small, 310642, '#b5a992'),
  'scene-12': illustration('scene-12', scene12, scene12Small, 249000, '#766a4f'),
};
