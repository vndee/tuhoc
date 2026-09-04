import { t } from '@tuhoc/i18n';
import { LabFrame } from '../LabFrame';
import type { LabRuntimeProps } from '../runtime';
import { projectMemory } from './model';

export default function ExternalMemoryLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'external-memory') {
    throw new Error(`ExternalMemoryLab expected definition kind "external-memory", received "${definition.kind}".`);
  }

  const generation = clampInteger(readNumber(value, 'generation'), 0, definition.config.generations);
  const oral = projectMemory(generation, definition.config.originalMarks, definition.config.oralRetention / 100);
  const symbolic = projectMemory(generation, definition.config.originalMarks, definition.config.symbolicRetention / 100);
  const maxMarks = Math.max(1, definition.config.originalMarks);

  return <LabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    result={`${t(lang, 'stories.lab.memoryOral')}: ${oral} ${t(lang, 'stories.lab.memoryMarks')}. ${t(lang, 'stories.lab.memorySymbolic')}: ${symbolic} ${t(lang, 'stories.lab.memoryMarks')}.`}
    onReset={onReset}
    onBack={onBack}
  >
    <div className="story-memory-lab">
      <label>
        {t(lang, 'stories.lab.memoryGeneration')}: {generation}
        <input
          type="range"
          min="0"
          max={Math.max(0, Math.trunc(definition.config.generations))}
          value={generation}
          onChange={(event) => onChange({ generation: clampInteger(Number(event.currentTarget.value), 0, definition.config.generations) })}
        />
      </label>
      <svg className="story-memory-chart" viewBox="0 0 240 120" role="img">
        <title>{t(lang, 'stories.lab.memoryChart')}</title>
        <desc>{t(lang, 'stories.lab.memoryChartDescription')}</desc>
        <rect x="35" y={105 - (oral / maxMarks) * 80} width="55" height={(oral / maxMarks) * 80} />
        <rect x="150" y={105 - (symbolic / maxMarks) * 80} width="55" height={(symbolic / maxMarks) * 80} />
        <text x="35" y="116">{t(lang, 'stories.lab.memoryOral')}: {oral}</text>
        <text x="150" y="116">{t(lang, 'stories.lab.memorySymbolic')}: {symbolic}</text>
      </svg>
      <p>{t(lang, 'stories.lab.memoryModel')}</p>
    </div>
  </LabFrame>;
}

function readNumber(value: unknown, key: string): number {
  if (typeof value !== 'object' || value === null || typeof (value as Record<string, unknown>)[key] !== 'number') return 0;
  return (value as Record<string, number>)[key];
}

function clampInteger(value: number, min: number, max: number): number {
  const safeMax = Math.max(min, Math.trunc(Number.isFinite(max) ? max : min));
  return Math.min(safeMax, Math.max(min, Math.trunc(Number.isFinite(value) ? value : min)));
}
