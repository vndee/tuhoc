import { t } from '@tuhoc/i18n';
import { LabFrame } from '../LabFrame';
import type { LabRuntimeProps } from '../runtime';
import { weightsForToken } from './model';

type AttentionLabExample = Extract<LabRuntimeProps['definition'], { kind: 'attention' }>['config']['examples'][number];

export default function AttentionLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'attention') {
    throw new Error(`AttentionLab expected definition kind "attention", received "${definition.kind}".`);
  }

  const example = readExample(value, definition.config.examples);
  if (!example) {
    return <LabFrame lang={lang} title={definition.title[lang]} instruction={definition.instruction[lang]} result="—" onReset={onReset} onBack={onBack}>
      <p>{t(lang, 'stories.lab.attentionCaveat')}</p>
    </LabFrame>;
  }

  const tokenIndex = readTokenIndex(value, example.tokens[lang].length);
  const tokens = example.tokens[lang];
  const weights = weightsForToken(example, lang, tokenIndex);
  const change = (next: { exampleId: string; tokenIndex: number }) => onChange(next);

  return <LabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    result={t(lang, 'stories.lab.attentionSelectedWeights', weights.join(', '))}
    onReset={onReset}
    onBack={onBack}
  >
    <div className="story-attention-lab">
      <label>{t(lang, 'stories.lab.attentionContext')}
        <select value={example.id} onChange={(event) => change({ exampleId: event.currentTarget.value, tokenIndex: 0 })}>
          {definition.config.examples.map((item) => <option key={item.id} value={item.id}>{item.gloss[lang]}</option>)}
        </select>
      </label>
      <p>{example.gloss[lang]}</p>
      <div className="story-attention-tokens" aria-label={t(lang, 'stories.lab.attentionMap')}>
        {tokens.map((token, index) => <button key={`${index}-${token}`} type="button" aria-pressed={index === tokenIndex}
          onClick={() => change({ exampleId: example.id, tokenIndex: index })}>{t(lang, 'stories.lab.attentionToken', index + 1, token)}</button>)}
      </div>
      <svg className="story-attention-map" viewBox={`0 0 ${Math.max(240, tokens.length * 62)} 120`} role="img">
        <title>{t(lang, 'stories.lab.attentionMap')}</title>
        <desc>{t(lang, 'stories.lab.attentionMapDescription')}</desc>
        {weights.map((weight, index) => {
          const height = Math.max(2, Math.min(84, weight * 84));
          const x = 20 + index * 62;
          return <g key={tokens[index]}>
            <rect x={x} y={96 - height} width="38" height={height} />
            <text x={x + 19} y="112" textAnchor="middle">{tokens[index]}</text>
          </g>;
        })}
      </svg>
      <table aria-label={t(lang, 'stories.lab.attentionTable')}>
        <thead><tr><th scope="col">{t(lang, 'stories.lab.attentionTokenColumn')}</th><th scope="col">{t(lang, 'stories.lab.attentionWeightColumn')}</th></tr></thead>
        <tbody>{tokens.map((token, index) => <tr key={`${index}-${token}`}><th scope="row">{token}</th><td>{weights[index]}</td></tr>)}</tbody>
      </table>
      <p>{t(lang, 'stories.lab.attentionCaveat')}</p>
    </div>
  </LabFrame>;
}

function readExample(value: unknown, examples: AttentionLabExample[]): AttentionLabExample | undefined {
  const id = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).exampleId : undefined;
  return examples.find((example) => example.id === id) ?? examples[0];
}

function readTokenIndex(value: unknown, length: number): number {
  const candidate = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).tokenIndex : undefined;
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0 && candidate < length ? candidate : 0;
}
