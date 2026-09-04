import { t } from '@tuhoc/i18n';
import { LabFrame } from '../LabFrame';
import type { LabRuntimeProps } from '../runtime';
import { executeRuleCards, type ExecutableRuleCard } from './model';

export default function ExecutableRulesLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'executable-rules') {
    throw new Error(`ExecutableRulesLab expected definition kind "executable-rules", received "${definition.kind}".`);
  }

  const cards = orderedCards(definition.config.cards, value);
  const result = executeRuleCards(definition.config.input, cards);
  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= cards.length) return;
    const next = [...cards];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onChange({ cardIds: next.map((card) => card.id) });
  };
  const matchesTarget = result.output === definition.config.target;

  return <LabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    result={`${result.output}${matchesTarget ? ` — ${t(lang, 'stories.lab.rulesCorrect')}` : ` — ${t(lang, 'stories.lab.rulesIncorrect')} ${definition.config.target}.`}`}
    onReset={onReset}
    onBack={onBack}
  >
    <div className="story-rules-lab">
      <ol className="story-rule-cards" aria-label={definition.title[lang]}>
        {cards.map((card, index) => {
          const cardLabel = t(lang, 'stories.lab.rulesCardLabel', index + 1);
          const operationLabel = t(lang, card.operation === 'add' ? 'stories.lab.rulesOperationAdd' : 'stories.lab.rulesOperationMultiply');
          return <li key={card.id}>
          <svg viewBox="0 0 180 50" role="img">
            <title>{cardLabel}: {operationLabel} {card.operand}</title>
            <desc>{t(lang, 'stories.lab.rulesCardDescription')}</desc>
            <rect x="1" y="1" width="178" height="48" rx="4" />
            <text x="12" y="30">{operationLabel} {card.operand}</text>
          </svg>
          <div className="story-lab-action-row">
            <button type="button" onClick={() => reorder(index, index - 1)} disabled={index === 0}>{t(lang, 'stories.lab.rulesMoveUp', cardLabel)}</button>
            <button type="button" onClick={() => reorder(index, index + 1)} disabled={index === cards.length - 1}>{t(lang, 'stories.lab.rulesMoveDown', cardLabel)}</button>
          </div>
        </li>;
        })}
      </ol>
      <ol className="story-rule-trace" aria-label={t(lang, 'stories.lab.rulesTrace')}>
        {result.trace.map((item, index) => <li key={`${index}-${item}`}>{item}{index < result.trace.length - 1 ? ', ' : ''}</li>)}
      </ol>
    </div>
  </LabFrame>;
}

function orderedCards(cards: ExecutableRuleCard[], value: unknown): ExecutableRuleCard[] {
  const ids = typeof value === 'object' && value !== null && Array.isArray((value as Record<string, unknown>).cardIds)
    ? (value as { cardIds: unknown[] }).cardIds.filter((id): id is string => typeof id === 'string')
    : cards.map((card) => card.id);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const ordered = ids.map((id) => byId.get(id)).filter((card): card is ExecutableRuleCard => card !== undefined);
  return [...ordered, ...cards.filter((card) => !ordered.some((item) => item.id === card.id))];
}
