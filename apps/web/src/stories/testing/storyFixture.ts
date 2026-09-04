import type { StoryDefinition, StoryScene } from '../types';

const localized = <T>(vi: T, en: T) => ({ vi, en });

const scene = (number: number): StoryScene => ({
  id: `scene-${number}`,
  actId: 'act-1',
  period: localized(`Giai đoạn ${number}`, `Period ${number}`),
  title: localized(`Cảnh ${number}`, `Scene ${number}`),
  humanStory: localized([{ kind: 'paragraph', text: `Câu chuyện Việt ${number}` }], [{ kind: 'paragraph', text: `English story ${number}` }]),
  technicalHinge: localized([{ kind: 'emphasis', text: `Điểm kỹ thuật ${number}` }], [{ kind: 'emphasis', text: `Technical hinge ${number}` }]),
  illustration: {
    src: `/stories/scene-${number}.webp`,
    srcSet: `/stories/scene-${number}.webp 1200w`,
    sizes: '(min-width: 768px) 800px, 100vw',
    width: 1200,
    height: 800,
    bytes: 120_000,
    alt: localized(`Minh họa cảnh ${number}`, `Scene ${number} illustration`),
    caption: localized(`Chú thích cảnh ${number}`, `Scene ${number} caption`),
    provenanceId: `scene-${number}-art`,
    dominantColor: '#204060',
  },
  lab: {
    kind: 'external-memory',
    title: localized('Trí nhớ bên ngoài', 'External memory'),
    instruction: localized('So sánh các thế hệ.', 'Compare the generations.'),
    config: { generations: 3, oralRetention: 40, symbolicRetention: 80, originalMarks: 12 },
  },
  labFallback: {
    diagramLabel: localized('Sơ đồ lưu giữ', 'Retention diagram'),
    explanation: localized('Ký hiệu giữ được nhiều thông tin hơn.', 'Symbols preserve more information.'),
  },
  sourceIds: number % 2 === 0 ? ['source-b', 'source-a'] : ['source-a', 'source-b'],
  openQuestion: localized('Ta nhớ điều gì?', 'What do we remember?'),
});

const provenance = (sceneId: StoryScene['id']) => ({
  id: `${sceneId}-art`,
  filename: `${sceneId}.webp`,
  sourceOutput: `${sceneId}.png`,
  createdAt: '2026-09-04T00:00:00.000Z',
  tool: 'image-generator',
  model: 'editorial-v1',
  prompt: `Illustration for ${sceneId}`,
  edits: ['crop'],
  width: 1200,
  height: 800,
  bytes: 120_000,
  license: 'CC-BY-4.0',
  sceneId,
});

export function makeStoryFixture({ sceneCount = 1 }: { sceneCount?: number } = {}): StoryDefinition {
  const scenes = Array.from({ length: sceneCount }, (_, index) => scene(index + 1));

  return {
    meta: {
      slug: 'fixture-story',
      issueNumber: 1,
      published: true,
      featured: true,
      title: localized('Câu chuyện mẫu', 'Fixture story'),
      deck: localized('Bản tóm tắt mẫu', 'A fixture deck'),
      cover: {
        src: '/stories/cover.webp',
        srcSet: '/stories/cover.webp 1200w',
        sizes: '(min-width: 768px) 800px, 100vw',
        width: 1200,
        height: 800,
        bytes: 120_000,
        alt: localized('Bìa câu chuyện mẫu', 'Fixture story cover'),
        caption: localized('Chú thích bìa', 'Cover caption'),
        provenanceId: 'cover-art',
      },
      sceneCount,
      labCount: sceneCount,
    },
    theme: {
      className: 'fixture-theme',
      paper: '#f8f5ed',
      ink: '#172033',
      mutedInk: '#4a5568',
      accent: '#c05621',
      stage: '#d8e5ef',
    },
    acts: [{
      id: 'act-1',
      number: 1,
      title: localized('Hồi một', 'Act one'),
      question: localized('Điều gì còn lại?', 'What remains?'),
      consequence: localized([{ kind: 'paragraph', text: 'Hệ quả bằng tiếng Việt.' }], [{ kind: 'paragraph', text: 'Consequence in English.' }]),
      sceneIds: scenes.map((item) => item.id),
    }],
    scenes,
    sources: [
      {
        id: 'source-a', kind: 'paper', title: 'Source A', authorsOrInstitution: 'Fixture Institute', year: '2026',
        url: 'https://example.com/source-a', accessedAt: '2026-09-04', note: localized('Nguồn A', 'Source A'),
      },
      {
        id: 'source-b', kind: 'archive', title: 'Source B', authorsOrInstitution: 'Fixture Archive', year: '2025',
        url: 'https://example.com/source-b', accessedAt: '2026-09-04', note: localized('Nguồn B', 'Source B'),
      },
    ],
    provenance: [
      {
        id: 'cover-art', filename: 'cover.webp', sourceOutput: 'cover.png', createdAt: '2026-09-04T00:00:00.000Z',
        tool: 'image-generator', model: 'editorial-v1', prompt: 'Fixture cover', edits: ['crop'],
        width: 1200, height: 800, bytes: 120_000, license: 'CC-BY-4.0', sceneId: 'cover',
      },
      ...scenes.map((item) => provenance(item.id)),
    ],
    coda: localized([{ kind: 'paragraph', text: 'Kết thúc bằng tiếng Việt.' }], [{ kind: 'paragraph', text: 'Ending in English.' }]),
  };
}
