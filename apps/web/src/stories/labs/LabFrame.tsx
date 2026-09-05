import { useId, type ReactNode } from 'react';
import { t, type Lang } from '../../i18n';

export interface LabFrameProps {
  lang: Lang;
  title: string;
  instruction: string;
  result: ReactNode;
  onReset: () => void;
  onBack: () => void;
  children: ReactNode;
}

/** Shared accessible shell for each interactive editorial lab. */
export function LabFrame({ lang, title, instruction, result, onReset, onBack, children }: LabFrameProps) {
  const titleId = useId();

  return <section className="story-lab-frame" aria-labelledby={titleId}>
    <header className="story-lab-frame-header">
      <h3 id={titleId}>{title}</h3>
      <p>{instruction}</p>
    </header>
    <div className="story-lab-frame-body">{children}</div>
    <p className="story-lab-result" role="status" aria-live="polite" aria-atomic="true">{result}</p>
    <footer className="story-lab-frame-controls">
      <button type="button" onClick={onReset}>{t(lang, 'stories.reset')}</button>
      <button type="button" onClick={onBack}>{t(lang, 'stories.backToIllustration')}</button>
    </footer>
  </section>;
}
