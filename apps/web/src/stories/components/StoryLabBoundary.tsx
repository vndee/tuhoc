import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t, type Lang } from '../../i18n';
import type { LabFallback } from '../types';

export interface StoryLabBoundaryProps {
  fallback: LabFallback;
  fallbackContent?: ReactNode;
  lang: Lang;
  resetKey?: string;
  children: ReactNode;
}

interface StoryLabBoundaryState {
  failed: boolean;
  resetKey?: string;
}

/** Limits a dynamically loaded lab's render error to its own scene. */
export class StoryLabBoundary extends Component<StoryLabBoundaryProps, StoryLabBoundaryState> {
  state: StoryLabBoundaryState = { failed: false };

  static getDerivedStateFromProps(props: StoryLabBoundaryProps, state: StoryLabBoundaryState): StoryLabBoundaryState | null {
    if (props.resetKey !== state.resetKey) return { failed: false, resetKey: props.resetKey };
    return null;
  }

  static getDerivedStateFromError(): Pick<StoryLabBoundaryState, 'failed'> {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // React owns reporting; the boundary's responsibility is the local fallback.
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    if (this.props.fallbackContent !== undefined) return this.props.fallbackContent;

    const { fallback, lang } = this.props;
    return <section className="story-lab-fallback" aria-label={fallback.diagramLabel[lang]}>
      <p>{t(lang, 'stories.labUnavailable')}</p>
      <figure>
        <div className="story-lab-diagram" aria-hidden="true" />
        <figcaption>{fallback.diagramLabel[lang]}</figcaption>
      </figure>
      <p>{fallback.explanation[lang]}</p>
    </section>;
  }
}
