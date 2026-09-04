import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PaperLanguageSwitcher } from '../../i18n/PaperLanguageSwitcher';
import { useLanguage } from '../../i18n/LanguageProvider';
import { Logo } from '../../shell/Logo';
import { useThemeContext } from '../../theme/ThemeContext';
import type { SceneId } from '../types';
import { findOwnedElement, storyShellActivationContext } from './StoryRendererInternals';

export interface StoryShellProps {
  variant: 'collection' | 'issue';
  children: ReactNode;
  compact?: boolean;
  progress?: { current: number; total: number };
  scenes?: Array<{ id: SceneId; label: string }>;
  activeSceneId?: SceneId;
}

export function StoryShell({
  variant,
  children,
  compact = false,
  progress,
  scenes = [],
  activeSceneId,
}: StoryShellProps) {
  const { t } = useLanguage();
  const { theme, toggle } = useThemeContext();
  const activation = useContext(storyShellActivationContext);
  const [contentsOpen, setContentsOpen] = useState(false);
  const shellRoot = useRef<HTMLDivElement>(null);
  const contentsTrigger = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const drawerId = 'story-contents-drawer';

  const closeContents = useCallback(() => {
    setContentsOpen(false);
    contentsTrigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!contentsOpen) return;
    drawer.current?.querySelector<HTMLElement>('a, button')?.focus();
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeContents();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [closeContents, contentsOpen]);

  const activateScene = useCallback((id: SceneId) => {
    history.replaceState(history.state, '', `${location.pathname}${location.search}#${id}`);
    const target = findOwnedElement(shellRoot.current, id);
    if (typeof target?.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
    activation?.onActivate(id);
  }, [activation]);

  const navigator = (insideDrawer = false) => <nav className="story-scene-nav" aria-label={t('stories.contents')}>
    {scenes.map((scene) => <a
      className={scene.id === activeSceneId ? 'is-active' : ''}
      href={`#${scene.id}`}
      key={scene.id}
      onClick={(event) => {
        event.preventDefault();
        activateScene(scene.id);
        if (insideDrawer) closeContents();
      }}
    >
      {scene.label}
    </a>)}
  </nav>;

  return <div className={`story-shell story-shell-${variant}${compact ? ' is-compact' : ''}`} ref={shellRoot}>
    <header className="story-shell-header">
      <Link to="/" className="story-shell-logo" aria-label={t('stories.home')}><Logo size={24} /></Link>
      <Link to="/stories" className="story-shell-masthead">{t('stories.masthead')}</Link>
      {variant === 'issue' ? <Link to="/stories" className="story-shell-back">{t('stories.backToCollection')}</Link> : null}
      <div className="story-shell-tools">
        <PaperLanguageSwitcher />
        <button type="button" className="story-theme-toggle" onClick={toggle} aria-label={t(theme === 'dark' ? 'topbar.themeToLight' : 'topbar.themeToDark')}>{theme === 'dark' ? '☀' : '◐'}</button>
        {progress ? <span className="story-progress" aria-live="polite">{t('stories.progress', progress.current, progress.total)}</span> : null}
        {scenes.length > 0 ? <button
          ref={contentsTrigger}
          type="button"
          className="story-contents-trigger"
          aria-controls={drawerId}
          aria-expanded={contentsOpen}
          onClick={() => setContentsOpen(true)}
        >
          {t('stories.contents')}
        </button> : null}
      </div>
      {scenes.length > 0 ? navigator() : null}
    </header>
    {contentsOpen ? <div
      aria-label={t('stories.contents')}
      className="story-contents-drawer"
      id={drawerId}
      ref={drawer}
      role="region"
    >
      {navigator(true)}
      <button type="button" onClick={closeContents}>{t('stories.closeContents')}</button>
    </div> : null}
    {children}
  </div>;
}
