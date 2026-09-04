import { t } from '@tuhoc/i18n';
import { LabFrame } from '../LabFrame';
import type { LabRuntimeProps } from '../runtime';
import { evaluateTranscript, type Criterion } from './model';

export default function JudgmentCriteriaLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'judgment-criteria') {
    throw new Error(`JudgmentCriteriaLab expected definition kind "judgment-criteria", received "${definition.kind}".`);
  }

  const enabledIds = readEnabledIds(value);
  const criteria: Criterion[] = definition.config.criteria.map((criterion) => ({
    id: criterion.id,
    label: criterion.label[lang],
    finding: criterion.finding[lang],
  }));
  const findings = evaluateTranscript(criteria, enabledIds);
  const toggle = (id: string) => onChange({ enabledIds: enabledIds.includes(id) ? enabledIds.filter((item) => item !== id) : [...enabledIds, id] });

  return <LabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    result={findings.length === 0 ? t(lang, 'stories.lab.judgmentChoose') : findings.map((finding) => finding.label).join(', ')}
    onReset={onReset}
    onBack={onBack}
  >
    <div className="story-judgment-lab">
      <figure className="story-transcript" aria-label={t(lang, 'stories.lab.judgmentTranscript')}>
        {definition.config.transcript[lang].map((line, index) => <p key={`${line.speaker}-${index}`}>
          <strong>{t(lang, line.speaker === 'judge' ? 'stories.lab.judgmentJudge' : 'stories.lab.judgmentRespondent')}:</strong> {line.text}
        </p>)}
      </figure>
      <fieldset className="story-criteria-controls">
        <legend>{t(lang, 'stories.lab.judgmentCriteria')}</legend>
        {criteria.map((criterion) => <label key={criterion.id}>
          <input type="checkbox" checked={enabledIds.includes(criterion.id)} onChange={() => toggle(criterion.id)} />
          {criterion.label}
        </label>)}
      </fieldset>
      <ul className="story-criterion-findings" aria-label={t(lang, 'stories.lab.judgmentFindings')}>
        {findings.map((finding) => <li key={finding.criterionId}><strong>{finding.label}:</strong> {finding.finding}</li>)}
      </ul>
    </div>
  </LabFrame>;
}

function readEnabledIds(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as Record<string, unknown>).enabledIds)) return [];
  return [...new Set((value as { enabledIds: unknown[] }).enabledIds.filter((id): id is string => typeof id === 'string'))];
}
