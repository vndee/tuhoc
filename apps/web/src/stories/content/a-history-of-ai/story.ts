import { REGISTERED_LAB_KINDS } from '../../labs/registry';
import type { IllustrationProvenance, StoryDefinition } from '../../types';
import { assertValidStory } from '../../validateStory';
import { actOne, actOneScenes, blocks } from './act-1';
import { actTwo, actTwoScenes } from './act-2';
import { actThree, actThreeScenes } from './act-3';
import { actFour, actFourScenes } from './act-4';
import { historyOfAiMeta } from './meta';
import historyOfAiProvenance from './provenance.json';
import { historyOfAiSources } from './sources';

export const historyOfAiStory: StoryDefinition = {
  meta: historyOfAiMeta,
  theme: { className: 'story-theme-history-ai', paper: '#f3eddf', ink: '#26312e', mutedInk: '#66726b', accent: '#b98a2e', stage: '#e9e0cc' },
  acts: [actOne, actTwo, actThree, actFour],
  scenes: [...actOneScenes, ...actTwoScenes, ...actThreeScenes, ...actFourScenes],
  sources: historyOfAiSources,
  provenance: historyOfAiProvenance as IllustrationProvenance[],
  coda: blocks(
    'Lịch sử này không khép lại ở một chiếc máy hay một thuật ngữ. Nó trở lại bàn tay đang đọc: ta muốn giao điều gì cho máy, giữ điều gì như trách nhiệm của con người, và ai được tham gia quyết định các điều kiện ấy?',
    'This history does not close with one machine or one term. It returns to the hand that is reading: what should we delegate to machines, what remains human responsibility, and who gets to participate in deciding those conditions?',
  ),
};

assertValidStory(historyOfAiStory, REGISTERED_LAB_KINDS);

export default historyOfAiStory;
