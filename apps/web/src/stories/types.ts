import type { Lang } from '@tuhoc/i18n';
import type { Codebook } from './labs/communication/types';

export type Localized<T = string> = Record<Lang, T>;

export type RichTextBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'emphasis'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'termLink'; text: string; href: string };

export type SceneId = `scene-${string}`;

export interface ResponsiveStoryImage {
  src: string;
  srcSet: string;
  sizes: string;
  width: number;
  height: number;
  bytes: number;
  alt: Localized;
  caption: Localized;
  provenanceId: string;
}

export interface StoryTheme {
  className: string;
  paper: string;
  ink: string;
  mutedInk: string;
  accent: string;
  stage: string;
}

export interface StoryMeta {
  slug: string;
  issueNumber: number;
  published: boolean;
  featured: boolean;
  title: Localized;
  deck: Localized;
  cover: ResponsiveStoryImage;
  sceneCount: number;
  labCount: number;
}

export interface StoryRegistryEntry extends StoryMeta {
  load: () => Promise<{ default: StoryDefinition }>;
}

export interface StoryAct {
  id: `act-${number}`;
  number: number;
  title: Localized;
  question: Localized;
  consequence: Localized<RichTextBlock[]>;
  sceneIds: SceneId[];
}

export interface SourceEntry {
  id: string;
  kind: 'paper' | 'archive' | 'artifact' | 'report';
  title: string;
  authorsOrInstitution: string;
  year: string;
  url: string;
  accessedAt: string;
  note: Localized;
}

export interface IllustrationProvenance {
  id: string;
  filename: string;
  sourceOutput: string;
  createdAt: string;
  tool: string;
  model: string;
  prompt: string;
  edits: string[];
  width: number;
  height: number;
  bytes: number;
  license: string;
  sceneId: 'cover' | `scene-${string}`;
}

export const ALL_LAB_KINDS = [
  'external-memory', 'embodied-calculation', 'executable-rules',
  'computation-limits', 'judgment-criteria', 'linear-separator',
  'knowledge-bottleneck', 'gradient-descent', 'convolution',
  'attention', 'agent-trace', 'agi-definitions',
  'message-budget',
  'ambiguous-code',
  'morse-spacing',
  'cable-route',
  'pulse-channel',
  'binary-noise',
] as const;
export type LabKind = (typeof ALL_LAB_KINDS)[number];

interface LabBase<K extends LabKind, C> {
  kind: K;
  title: Localized;
  instruction: Localized;
  config: C;
}

export type LabDefinition =
  | LabBase<'external-memory', { generations: number; oralRetention: number; symbolicRetention: number; originalMarks: number }>
  | LabBase<'embodied-calculation', { left: number; right: number; rods: number }>
  | LabBase<'executable-rules', { input: number; target: number; cards: Array<{ id: string; operation: 'add' | 'multiply'; operand: number }> }>
  | LabBase<'computation-limits', { tape: string; startState: string; maxSteps: number; program: Record<string, { write: string; move: -1 | 1; next: string }>; cases?: Array<{ id: string; label: Localized; tape: string; startState: string; program: Record<string, { write: string; move: -1 | 1; next: string }> }> }>
  | LabBase<'judgment-criteria', { transcript: Localized<Array<{ speaker: 'judge' | 'respondent'; text: string }>>; criteria: Array<{ id: string; label: Localized; finding: Localized }> }>
  | LabBase<'linear-separator', { points: Array<{ id: string; x: number; y: number; label: -1 | 1 }>; angle: number; offset: number }>
  | LabBase<'knowledge-bottleneck', { nodes: Array<{ id: string; label: Localized; parentId: string | null }>; changedRuleId: string }>
  | LabBase<'gradient-descent', { startX: number; targetX: number; learningRates: number[]; fundingTimeline: Array<{ year: number; value: number; label: Localized }> }>
  | LabBase<'convolution', { pixels: number[][]; kernel: number[][]; row: number; column: number }>
  | LabBase<'attention', { examples: Array<{ id: string; tokens: Localized<string[]>; weights: Localized<number[][]>; gloss: Localized }> }>
  | LabBase<'agent-trace', { steps: Array<{ id: string; kind: 'model' | 'tool' | 'data' | 'proposal' | 'approval'; label: Localized; permission: string | null }> }>
  | LabBase<'agi-definitions', { definitions: Array<{ id: string; label: Localized; note: Localized; sourceId: string; sourceLabel: Localized; generality: number; capability: number; autonomy: number }> }>
  | LabBase<'message-budget', { defaultBudget: 15 | 30 | 60 }>
  | LabBase<'ambiguous-code', { initialBook: Codebook; initialSymbols: string }>
  | LabBase<'morse-spacing', { example: 'ET' | 'AET' | 'BEAM' | 'BEAM ET' }>
  | LabBase<'cable-route', { defaultBudget: number }>
  | LabBase<'pulse-channel', { defaultDuration: 1 | 2 | 4 }>
  | LabBase<'binary-noise', { defaultP: number; seed: number }>;

export interface LabFallback {
  diagramLabel: Localized;
  explanation: Localized;
  table?: Localized<{ headers: string[]; rows: string[][] }>;
}

export interface StoryIllustration extends ResponsiveStoryImage {
  dominantColor: string;
}

export interface StoryScene {
  id: SceneId;
  actId: StoryAct['id'];
  period: Localized;
  title: Localized;
  humanStory: Localized<RichTextBlock[]>;
  technicalHinge: Localized<RichTextBlock[]>;
  illustration: StoryIllustration;
  lab: LabDefinition;
  labFallback: LabFallback;
  sourceIds: string[];
  openQuestion: Localized;
}

export interface StoryDefinition {
  meta: StoryMeta;
  theme: StoryTheme;
  interaction?: { kind: 'message-journey'; examples: Localized };
  intro?: Localized<RichTextBlock[]>;
  acts: StoryAct[];
  scenes: StoryScene[];
  sources: SourceEntry[];
  provenance: IllustrationProvenance[];
  coda: Localized<RichTextBlock[]>;
  courseAction?: { slug: string; label: Localized; fallbackLabel: Localized };
}
