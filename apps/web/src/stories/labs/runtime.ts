import type { ComponentType } from 'react';
import type { Lang } from '../../i18n';
import type { LabDefinition } from '../types';

export interface LabRuntimeProps {
  definition: LabDefinition;
  lang: Lang;
  value: unknown;
  onChange: (next: unknown) => void;
  onReset: () => void;
  onBack: () => void;
}

export interface LabModule {
  default: ComponentType<LabRuntimeProps>;
}

/** Creates a fresh, JSON-serializable state value for a lab's first render or reset. */
export function makeInitialLabState(definition: LabDefinition): unknown {
  switch (definition.kind) {
    case 'external-memory': return { generation: 0 };
    case 'embodied-calculation': return { step: 0, representation: 'abacus' };
    case 'executable-rules': return { cardIds: definition.config.cards.map((card) => card.id) };
    case 'computation-limits': return { caseId: definition.config.cases?.[0]?.id, steps: 0, snapshot: null };
    case 'judgment-criteria': return { enabledIds: [] };
    case 'linear-separator': return { angle: definition.config.angle, offset: definition.config.offset, xor: false };
    case 'knowledge-bottleneck': return { changedRuleId: definition.config.changedRuleId };
    case 'gradient-descent': return { x: definition.config.startX, rate: definition.config.learningRates[0] ?? 0, steps: 0 };
    case 'convolution': return { row: definition.config.row, column: definition.config.column, parallel: false };
    case 'attention': return { exampleId: definition.config.examples[0]?.id ?? '', tokenIndex: 0 };
    case 'agent-trace': return { granted: [] };
    case 'agi-definitions': return { selectedIds: definition.config.definitions.slice(0, 2).map((item) => item.id) };
  }
}
