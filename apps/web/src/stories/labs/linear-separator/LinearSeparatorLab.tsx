import { t } from '@tuhoc/i18n';
import { LabFrame } from '../LabFrame';
import type { LabRuntimeProps } from '../runtime';
import { classifyPoint, countMisclassified, type LabeledPoint } from './model';

const XOR_POINTS: LabeledPoint[] = [
  { id: 'xor-00', x: 0, y: 0, label: -1 },
  { id: 'xor-01', x: 0, y: 1, label: 1 },
  { id: 'xor-10', x: 1, y: 0, label: 1 },
  { id: 'xor-11', x: 1, y: 1, label: -1 },
];

export default function LinearSeparatorLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'linear-separator') {
    throw new Error(`LinearSeparatorLab expected definition kind "linear-separator", received "${definition.kind}".`);
  }

  const angle = readFinite(value, 'angle', definition.config.angle);
  const offset = readFinite(value, 'offset', definition.config.offset);
  const xor = readBoolean(value, 'xor');
  const points: LabeledPoint[] = xor ? XOR_POINTS : definition.config.points;
  const misclassified = countMisclassified(points, angle, offset);
  const boundary = linePath(angle, offset);
  const change = (next: Partial<{ angle: number; offset: number; xor: boolean }>) => onChange({ angle, offset, xor, ...next });

  return <LabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    result={t(lang, 'stories.lab.separatorMisclassified', misclassified)}
    onReset={onReset}
    onBack={onBack}
  >
    <div className="story-separator-lab">
      <div className="story-separator-controls">
        <label>{t(lang, 'stories.lab.separatorAngle')}: {angle.toFixed(1)}
          <input type="range" min={-3.1} max={3.1} step={0.1} value={angle} onChange={(event) => change({ angle: Number(event.currentTarget.value) })} />
        </label>
        <label>{t(lang, 'stories.lab.separatorOffset')}: {offset.toFixed(1)}
          <input type="range" min={-2} max={2} step={0.1} value={offset} onChange={(event) => change({ offset: Number(event.currentTarget.value) })} />
        </label>
        <label><input type="checkbox" checked={xor} onChange={(event) => change({ xor: event.currentTarget.checked })} /> {t(lang, 'stories.lab.separatorUseXor')}</label>
      </div>
      <svg className="story-separator-diagram" viewBox="0 0 200 200" role="img">
        <title>{t(lang, 'stories.lab.separatorBoundary')}</title>
        <desc>{t(lang, 'stories.lab.separatorBoundaryDescription')}</desc>
        <path data-testid="separator-boundary" d={boundary} />
        {points.map((point) => <circle key={point.id} className={classifyPoint(point, angle, offset) === point.label ? 'is-correct' : 'is-wrong'} cx={100 + point.x * 38} cy={100 - point.y * 38} r="7" />)}
      </svg>
      <ul className="story-separator-text" aria-label={t(lang, 'stories.lab.separatorTextEquivalent')}>
        {points.map((point, index) => <li key={point.id}>{t(lang, 'stories.lab.separatorPoint', index + 1)}: {classifyPoint(point, angle, offset) === point.label ? t(lang, 'stories.lab.separatorCorrect') : t(lang, 'stories.lab.separatorWrong')}</li>)}
      </ul>
      {xor && <p>{t(lang, 'stories.lab.separatorXorLimit')}</p>}
    </div>
  </LabFrame>;
}

function readFinite(value: unknown, key: 'angle' | 'offset', fallback: number): number {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : fallback;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : (Number.isFinite(fallback) ? fallback : 0);
}

function readBoolean(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>)[key] === true;
}

function boundaryPoints(angle: number, offset: number) {
  const normalX = Math.cos(angle);
  const normalY = Math.sin(angle);
  const pointX = -offset * normalX;
  const pointY = -offset * normalY;
  const directionX = -normalY;
  const directionY = normalX;
  return {
    x1: 100 + (pointX - directionX * 3) * 38,
    y1: 100 - (pointY - directionY * 3) * 38,
    x2: 100 + (pointX + directionX * 3) * 38,
    y2: 100 - (pointY + directionY * 3) * 38,
  };
}

function linePath(angle: number, offset: number): string {
  const line = boundaryPoints(angle, offset);
  return `M ${line.x1.toFixed(2)} ${line.y1.toFixed(2)} L ${line.x2.toFixed(2)} ${line.y2.toFixed(2)}`;
}
