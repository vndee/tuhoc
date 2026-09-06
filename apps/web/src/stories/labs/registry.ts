import type { LabKind } from '../types';
import type { LabModule } from './runtime';
import { buildId, mapPath } from 'virtual:story-lab-retry';
import { resolveLabRetryUrl } from './retry';

/**
 * Each lab remains a separate chunk. Keep these imports explicit so adding a
 * lab is reviewable and bundlers never speculate about every possible path.
 */
export const labRegistry: Readonly<Record<LabKind, () => Promise<LabModule>>> = {
  'external-memory': () => import('./external-memory/ExternalMemoryLab'),
  'embodied-calculation': () => import('./embodied-calculation/EmbodiedCalculationLab'),
  'executable-rules': () => import('./executable-rules/ExecutableRulesLab'),
  'computation-limits': () => import('./computation-limits/ComputationLimitsLab'),
  'judgment-criteria': () => import('./judgment-criteria/JudgmentCriteriaLab'),
  'linear-separator': () => import('./linear-separator/LinearSeparatorLab'),
  'knowledge-bottleneck': () => import('./knowledge-bottleneck/KnowledgeBottleneckLab'),
  'gradient-descent': () => import('./gradient-descent/GradientDescentLab'),
  convolution: () => import('./convolution/ConvolutionLab'),
  attention: () => import('./attention/AttentionLab'),
  'agent-trace': () => import('./agent-trace/AgentTraceLab'),
  'agi-definitions': () => import('./agi-definitions/AgiDefinitionsLab'),
  'message-budget': () => import('./message-budget/MessageBudgetLab'),
  'ambiguous-code': () => import('./ambiguous-code/AmbiguousCodeLab'),
  'morse-spacing': () => import('./morse-spacing/MorseSpacingLab'),
  'cable-route': () => import('./cable-route/CableRouteLab'),
  'pulse-channel': () => import('./pulse-channel/PulseChannelLab'),
  'binary-noise': () => import('./binary-noise/BinaryNoiseLab'),
  'source-entropy': () => import('./source-entropy/SourceEntropyLab'),
  'huffman-message': () => import('./huffman-message/HuffmanMessageLab'),
  'repetition-channel': () => import('./repetition-channel/RepetitionChannelLab'),
  'secded-inspector': () => import('./secded-inspector/SecdedInspectorLab'),
  'channel-budget': () => import('./channel-budget/ChannelBudgetLab'),
  'message-meaning': () => import('./message-meaning/MessageMeaningLab'),
};

export const REGISTERED_LAB_KINDS: ReadonlySet<LabKind> = new Set(Object.keys(labRegistry) as LabKind[]);

/** Calls exactly one loader, and only when a reader opens that scene's lab. */
const recoveredModules = new Map<LabKind, LabModule>();

export async function loadLab(kind: LabKind, attempt = 0): Promise<LabModule> {
  const recovered = recoveredModules.get(kind);
  if (recovered) return recovered;
  try { return await labRegistry[kind](); }
  catch {
    if (attempt === 0) throw new Error('lab-load-unavailable');
  }
  try {
    const mapUrl = new URL(mapPath, window.location.href);
    if (mapUrl.origin !== window.location.origin) throw new Error('lab-retry-unavailable');
    const response = await fetch(mapUrl, { credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error('lab-retry-unavailable');
    const url = resolveLabRetryUrl(await response.json(), kind, buildId, mapUrl.href, attempt);
    const module = await import(/* @vite-ignore */ url) as LabModule;
    recoveredModules.set(kind, module);
    return module;
  } catch { throw new Error('lab-retry-unavailable'); }
}
