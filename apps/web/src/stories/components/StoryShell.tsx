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
  scenes?: Array<{ id: SceneId; label: string; accessibleLabel?: string }>;
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
      aria-label={scene.accessibleLabel}
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
        <button
          type="button"
          className="story-theme-toggle"
          onClick={toggle}
          aria-label={t(theme === 'dark' ? 'topbar.themeToLight' : 'topbar.themeToDark')}
          aria-pressed={theme === 'dark'}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" focusable="false">
            {theme === 'dark' ? <>
              <circle cx="10" cy="10" r="3.6" />
              <path d="M10 2.4v1.9M10 15.7v1.9M17.6 10h-1.9M4.3 10H2.4M15.4 4.6l-1.3 1.3M6 14l-1.4 1.4M15.4 15.4l-1.3-1.3M6 6L4.6 4.6" strokeLinecap="round" />
            </> : <path d="M16.5 12.4A6.8 6.8 0 017.6 3.5a6.9 6.9 0 108.9 8.9z" strokeLinejoin="round" />}
          </svg>
        </button>
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
