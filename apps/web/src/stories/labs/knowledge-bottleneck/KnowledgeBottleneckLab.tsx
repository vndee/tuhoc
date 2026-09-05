import { t } from '@tuhoc/i18n';
import { LabFrame } from '../LabFrame';
import type { LabRuntimeProps } from '../runtime';
import { countAffectedRules, descendantIds, type RuleNode } from './model';

export default function KnowledgeBottleneckLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'knowledge-bottleneck') {
    throw new Error(`KnowledgeBottleneckLab expected definition kind "knowledge-bottleneck", received "${definition.kind}".`);
  }

  const nodes: RuleNode[] = definition.config.nodes.map(({ id, parentId }) => ({ id, parentId }));
  const changedRuleId = readRuleId(value, nodes, definition.config.changedRuleId);
  const descendants = descendantIds(nodes, changedRuleId);
  const affected = countAffectedRules(nodes, changedRuleId);
  const labels = new Map(definition.config.nodes.map((node) => [node.id, node.label[lang]]));

  return <LabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    result={t(lang, 'stories.lab.knowledgeAffectedRules', affected)}
    onReset={onReset}
    onBack={onBack}
  >
    <div className="story-knowledge-lab">
      <label>{t(lang, 'stories.lab.knowledgeChangedRule')}
        <select value={changedRuleId} onChange={(event) => onChange({ changedRuleId: event.currentTarget.value })}>
          {definition.config.nodes.map((node) => <option key={node.id} value={node.id}>{node.label[lang]}</option>)}
        </select>
      </label>
      <svg className="story-knowledge-tree" viewBox="0 0 360 180" role="img">
        <title>{t(lang, 'stories.lab.knowledgeTree')}</title>
        <desc>{t(lang, 'stories.lab.knowledgeTreeDescription')}</desc>
        {definition.config.nodes.map((node, index) => {
          const parentIndex = definition.config.nodes.findIndex((candidate) => candidate.id === node.parentId);
          if (parentIndex < 0) return null;
          const parent = pointFor(parentIndex, definition.config.nodes.length);
          const child = pointFor(index, definition.config.nodes.length);
          return <line key={`${node.parentId}-${node.id}`} x1={parent.x} y1={parent.y} x2={child.x} y2={child.y} />;
        })}
        {definition.config.nodes.map((node, index) => {
          const point = pointFor(index, definition.config.nodes.length);
          const affectedNode = descendants.includes(node.id);
          return <g key={node.id} className={node.id === changedRuleId ? 'is-changed' : affectedNode ? 'is-affected' : undefined}>
            <circle cx={point.x} cy={point.y} r="19" />
            <text x={point.x} y={point.y + 4} textAnchor="middle">{node.label[lang]}</text>
          </g>;
        })}
      </svg>
      <p>{t(lang, 'stories.lab.knowledgeSafety')}</p>
      <p>{t(lang, 'stories.lab.knowledgeAffectedRules', affected)}: {descendants.map((id) => labels.get(id)).join(', ') || '—'}</p>
    </div>
  </LabFrame>;
}

function readRuleId(value: unknown, nodes: RuleNode[], fallback: string): string {
  const candidate = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).changedRuleId : undefined;
  if (typeof candidate === 'string' && nodes.some((node) => node.id === candidate)) return candidate;
  return nodes.some((node) => node.id === fallback) ? fallback : nodes[0]?.id ?? '';
}

function pointFor(index: number, length: number) {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return { x: 70 + column * 115, y: 46 + row * (100 / Math.max(1, Math.ceil(length / 3) - 1)) };
}
