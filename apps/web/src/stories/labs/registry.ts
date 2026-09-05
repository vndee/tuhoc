import type { LabKind } from '../types';
import type { LabModule } from './runtime';

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
};

export const REGISTERED_LAB_KINDS: ReadonlySet<LabKind> = new Set(Object.keys(labRegistry) as LabKind[]);

/** Calls exactly one loader, and only when a reader opens that scene's lab. */
export const loadLab = (kind: LabKind): Promise<LabModule> => labRegistry[kind]();
