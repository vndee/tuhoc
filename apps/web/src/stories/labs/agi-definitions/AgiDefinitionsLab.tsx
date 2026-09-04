import { t } from '@tuhoc/i18n';
import { LabFrame } from '../LabFrame';
import type { LabRuntimeProps } from '../runtime';
import { compareDefinitions, positionDefinition, type AgiDefinition, type AgiPosition } from './model';

export default function AgiDefinitionsLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'agi-definitions') {
    throw new Error(`AgiDefinitionsLab expected definition kind "agi-definitions", received "${definition.kind}".`);
  }

  const definitions: AgiDefinition[] = definition.config.definitions.map(({ id, label, generality, capability, autonomy }) => ({ id, label, generality, capability, autonomy }));
  const [left, right] = readSelected(value, definitions);
  if (!left || !right) {
    return <LabFrame lang={lang} title={definition.title[lang]} instruction={definition.instruction[lang]} result="—" onReset={onReset} onBack={onBack}>
      <p>{t(lang, 'stories.lab.agiConclusion')}</p>
    </LabFrame>;
  }
  const difference = compareDefinitions(left, right);
  const update = (side: 0 | 1, id: string) => onChange({ selectedIds: side === 0 ? [id, right.id] : [left.id, id] });
  const axes = axisLabels(lang);
  const axisMaximum = Math.max(1, ...Object.values(positionDefinition(left)), ...Object.values(positionDefinition(right)));

  return <LabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    result={`${left.label} / ${right.label}`}
    onReset={onReset}
    onBack={onBack}
  >
    <div className="story-agi-definitions-lab">
      <div className="story-agi-controls">
        <label>{t(lang, 'stories.lab.agiFirstDefinition')}
          <select value={left.id} onChange={(event) => update(0, event.currentTarget.value)}>{definitions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </label>
        <label>{t(lang, 'stories.lab.agiSecondDefinition')}
          <select value={right.id} onChange={(event) => update(1, event.currentTarget.value)}>{definitions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </label>
      </div>
      <div className="story-agi-plots">
        <AxisPlot definition={left} axes={axes} maximum={axisMaximum} />
        <AxisPlot definition={right} axes={axes} maximum={axisMaximum} />
      </div>
      <table aria-label={t(lang, 'stories.lab.agiDifferenceTable')}>
        <thead><tr><th scope="col">{t(lang, 'stories.lab.agiAxis')}</th><th scope="col">{left.label}</th><th scope="col">{right.label}</th><th scope="col">{t(lang, 'stories.lab.agiDifference')}</th></tr></thead>
        <tbody>{(Object.keys(axes) as Array<keyof AgiPosition>).map((axis) => <tr key={axis}><th scope="row">{axes[axis]}</th><td>{left[axis]}</td><td>{right[axis]}</td><td>{difference[axis]}</td></tr>)}</tbody>
      </table>
      <p>{t(lang, 'stories.lab.agiConclusion')}</p>
    </div>
  </LabFrame>;
}

function AxisPlot({ definition, axes, maximum }: { definition: AgiDefinition; axes: Record<keyof AgiPosition, string>; maximum: number }) {
  const position = positionDefinition(definition);
  const entries = Object.entries(axes) as Array<[keyof AgiPosition, string]>;
  return <figure className="story-agi-axis-plot">
    <svg viewBox="0 0 300 150" role="img">
      <title>{`${definition.label}: ${entries.map(([, label]) => label).join(', ')}`}</title>
      {entries.map(([axis, label], index) => {
        const y = 28 + index * 42;
        const width = (position[axis] / maximum) * 150;
        return <g key={axis}><text x="0" y={y}>{label}</text><line x1="112" y1={y - 5} x2="272" y2={y - 5} /><circle cx={112 + width} cy={y - 5} r="6" /><text x="282" y={y}>{position[axis]}</text></g>;
      })}
    </svg>
    <figcaption>{definition.label}</figcaption>
  </figure>;
}

function readSelected(value: unknown, definitions: AgiDefinition[]): [AgiDefinition | undefined, AgiDefinition | undefined] {
  const ids = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).selectedIds : undefined;
  const selected = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  const left = definitions.find((item) => item.id === selected[0]) ?? definitions[0];
  const right = definitions.find((item) => item.id === selected[1] && item.id !== left?.id) ?? definitions.find((item) => item.id !== left?.id);
  return [left, right];
}

function axisLabels(lang: 'en' | 'vi'): Record<keyof AgiPosition, string> {
  return {
    generality: t(lang, 'stories.lab.agiGenerality'),
    capability: t(lang, 'stories.lab.agiCapability'),
    autonomy: t(lang, 'stories.lab.agiAutonomy'),
  };
}
