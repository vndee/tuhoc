import { REGISTERED_LAB_KINDS } from '../../labs/registry';
import type { IllustrationProvenance, SceneId, StoryAct, StoryDefinition, StoryScene } from '../../types';
import { assertValidStory } from '../../validateStory';
import { noiseIllustrations } from './assets';
import { issueCopy } from './copy';
import { noiseFallbacks } from './fallbacks';
import { noiseLabs } from './labs';
import { noiseMeta } from './meta';
import noiseProvenanceRecords from './provenance.json';
import { noiseSources } from './sources';

const scene = (id: SceneId, actId: StoryAct['id']): StoryScene => ({
  id,
  actId,
  ...issueCopy.scenes[id],
  illustration: noiseIllustrations[id],
  lab: noiseLabs[id],
  labFallback: noiseFallbacks[id],
});

const provenance: IllustrationProvenance[] = noiseProvenanceRecords.map((record) => ({
  ...record,
  sceneId: record.sceneId as IllustrationProvenance['sceneId'],
}));

export const noiseStory: StoryDefinition = {
  meta: noiseMeta,
  theme: {
    className: 'story-theme-across-noise',
    paper: '#F3EEE2',
    ink: '#24383D',
    mutedInk: '#56666A',
    accent: '#95603B',
    stage: '#E1E5DE',
  },
  interaction: {
    kind: 'message-journey',
    examples: {
      vi: 'Mình đã đến nơi. Mọi chuyện vẫn ổn.',
      en: 'I have arrived. Everything is all right.',
    },
  },
  intro: issueCopy.intro,
  acts: issueCopy.acts,
  scenes: [
    scene('scene-01', 'act-1'),
    scene('scene-02', 'act-1'),
    scene('scene-03', 'act-1'),
    scene('scene-04', 'act-2'),
    scene('scene-05', 'act-2'),
    scene('scene-06', 'act-2'),
    scene('scene-07', 'act-3'),
    scene('scene-08', 'act-3'),
    scene('scene-09', 'act-3'),
    scene('scene-10', 'act-4'),
    scene('scene-11', 'act-4'),
    scene('scene-12', 'act-4'),
  ],
  sources: noiseSources,
  provenance,
  coda: issueCopy.coda,
  courseAction: issueCopy.courseAction,
};

assertValidStory(noiseStory, REGISTERED_LAB_KINDS);

export default noiseStory;
