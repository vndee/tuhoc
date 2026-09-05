import { t } from '@tuhoc/i18n';
import { LabFrame } from '../LabFrame';
import type { LabRuntimeProps } from '../runtime';
import { gradientStep, lossAt } from './model';

export default function GradientDescentLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'gradient-descent') {
    throw new Error(`GradientDescentLab expected definition kind "gradient-descent", received "${definition.kind}".`);
  }

  const x = readFinite(value, 'x', definition.config.startX);
  const rate = readRate(value, definition.config.learningRates);
  const steps = readWhole(value, 'steps');
  const timelineIndex = Math.min(definition.config.fundingTimeline.length - 1, readWhole(value, 'timelineIndex'));
  const selectedTimeline = definition.config.fundingTimeline[Math.max(0, timelineIndex)];
  const loss = roundSix(lossAt(x, definition.config.targetX));
  const takeStep = () => {
    const next = gradientStep(x, rate, definition.config.targetX);
    onChange({ x: next.nextX, rate, steps: steps + 1, timelineIndex: Math.max(0, timelineIndex) });
  };

  return <LabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    result={t(lang, 'stories.lab.gradientStatus', x, loss)}
    onReset={onReset}
    onBack={onBack}
  >
    <div className="story-gradient-lab">
      <div className="story-gradient-controls">
        <label>{t(lang, 'stories.lab.gradientRate')}
          <select value={rate} onChange={(event) => onChange({ x, rate: Number(event.currentTarget.value), steps, timelineIndex: Math.max(0, timelineIndex) })}>
            {definition.config.learningRates.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <button type="button" onClick={takeStep}>{t(lang, 'stories.lab.gradientStep')}</button>
      </div>
      <svg className="story-gradient-landscape" viewBox="0 0 360 160" role="img">
        <title>{t(lang, 'stories.lab.gradientLandscape')}</title>
        <desc>{t(lang, 'stories.lab.gradientLandscapeDescription')}</desc>
        <path d={landscapePath(definition.config.targetX)} />
        <circle cx={landscapeX(x, definition.config.targetX)} cy={landscapeY(x, definition.config.targetX)} r="6" />
      </svg>
      <div className="story-gradient-timeline" aria-label={t(lang, 'stories.lab.gradientTimeline')}>
        {definition.config.fundingTimeline.map((point, index) => <button key={point.year} type="button" aria-pressed={index === timelineIndex}
          onClick={() => onChange({ x, rate, steps, timelineIndex: index })}>{point.year}: {point.label[lang]}</button>)}
      </div>
      {selectedTimeline && <p>{selectedTimeline.year}: {selectedTimeline.label[lang]}</p>}
      <p>{t(lang, 'stories.lab.gradientTimelineCaveat')}</p>
    </div>
  </LabFrame>;
}

function readFinite(value: unknown, key: string, fallback: number): number {
  const candidate = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
}

function readRate(value: unknown, rates: number[]): number {
  const candidate = readFinite(value, 'rate', rates[0] ?? 0);
  return rates.includes(candidate) ? candidate : (rates[0] ?? 0);
}

function readWhole(value: unknown, key: string): number {
  const candidate = readFinite(value, key, 0);
  return Math.max(0, Math.trunc(candidate));
}

function landscapeX(x: number, targetX: number): number {
  return Math.max(16, Math.min(344, 180 + (x - targetX) * 30));
}

function landscapeY(x: number, targetX: number): number {
  return Math.min(140, 126 - Math.min(110, lossAt(x, targetX) * 9));
}

function landscapePath(targetX: number): string {
  const points = Array.from({ length: 25 }, (_, index) => {
    const x = targetX - 4 + index / 3;
    return `${index === 0 ? 'M' : 'L'} ${landscapeX(x, targetX).toFixed(2)} ${landscapeY(x, targetX).toFixed(2)}`;
  });
  return points.join(' ');
}

function roundSix(value: number): number {
  return Number(value.toFixed(6));
}
