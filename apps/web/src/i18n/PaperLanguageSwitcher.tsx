import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { LANGS, type Lang } from './index';
import { useLanguage } from './LanguageProvider';

/** A paper-and-chalk menu button for editorial surfaces such as the landing page. */
export function PaperLanguageSwitcher({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusOnOpenRef = useRef(0);
  const menuId = useId();
  const checkFilterId = `paper-language-check-${useId()}`;
  const frameFilterId = `paper-language-frame-${useId()}`;

  useEffect(() => {
    if (!open) return;

    optionRefs.current[focusOnOpenRef.current]?.focus();
    const ownerDocument = rootRef.current?.ownerDocument ?? document;
    const closeWhenPointerLeaves = (event: PointerEvent) => {
      if (isNodeFromDocument(event.target, ownerDocument) && !rootRef.current?.contains(event.target)) setOpen(false);
    };

    ownerDocument.addEventListener('pointerdown', closeWhenPointerLeaves);
    return () => ownerDocument.removeEventListener('pointerdown', closeWhenPointerLeaves);
  }, [open]);

  const openMenu = (focusIndex = LANGS.indexOf(lang)) => {
    focusOnOpenRef.current = Math.max(0, focusIndex);
    setOpen(true);
  };

  const closeMenu = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const choose = (next: Lang) => {
    if (next !== lang) setLang(next);
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  };

  const moveOptionFocus = (from: number, step: number) => {
    const next = (from + step + LANGS.length) % LANGS.length;
    optionRefs.current[next]?.focus();
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    openMenu(event.key === 'ArrowDown' ? 0 : LANGS.length - 1);
  };

  const handleOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, option: Lang, index: number) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveOptionFocus(index, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveOptionFocus(index, -1);
        break;
      case 'Home':
        event.preventDefault();
        optionRefs.current[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        optionRefs.current[LANGS.length - 1]?.focus();
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(option);
        break;
      case 'Escape':
        event.preventDefault();
        closeMenu(true);
        break;
    }
  };

  return (
    <div
      ref={rootRef}
      className={`paper-language${open ? ' is-open' : ''} ${className}`.trim()}
      onBlur={(event) => {
        if (isNodeFromDocument(event.relatedTarget, event.currentTarget.ownerDocument) && !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        id="lang-select"
        className="paper-language-trigger"
        type="button"
        aria-label={t('lang.switcher.label')}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        title={t(lang === 'vi' ? 'lang.name.vi' : 'lang.name.en')}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        {lang.toUpperCase()}
      </button>
      {open ? (
        <div id={menuId} className="paper-language-menu" role="menu" aria-label={t('lang.switcher.label')}>
          <PaperLanguageFilters checkFilterId={checkFilterId} frameFilterId={frameFilterId} />
          <PaperMenuFrame filterId={frameFilterId} />
          {LANGS.map((option, index) => {
            const selected = option === lang;
            const optionName = t(option === 'vi' ? 'lang.name.vi' : 'lang.name.en');
            return (
              <button
                key={option}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                aria-label={`${option.toUpperCase()} — ${optionName}`}
                className="paper-language-option"
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(option)}
                onKeyDown={(event) => handleOptionKeyDown(event, option, index)}
              >
                <span className="paper-language-code">{option.toUpperCase()}</span>
                <span className="paper-language-name">
                  <span aria-hidden="true">— </span>
                  {optionName}
                </span>
                <span className="paper-language-check" aria-hidden="true">
                  {selected ? <PaperLanguageCheck filterId={checkFilterId} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function isNodeFromDocument(value: EventTarget | null, ownerDocument: Document): value is Node {
  const OwnerNode = ownerDocument.defaultView?.Node;
  return OwnerNode ? value instanceof OwnerNode : typeof Node !== 'undefined' && value instanceof Node;
}

function PaperLanguageFilters({ checkFilterId, frameFilterId }: { checkFilterId: string; frameFilterId: string }) {
  return (
    <svg className="paper-language-filters" aria-hidden="true" focusable="false">
      <defs>
        <PaperLanguageFilter id={checkFilterId} seed={20} />
        <PaperLanguageFilter id={frameFilterId} seed={33} />
      </defs>
    </svg>
  );
}

function PaperLanguageFilter({ id, seed }: { id: string; seed: number }) {
  return (
    <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed={seed} result="noise" />
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  );
}

function PaperMenuFrame({ filterId }: { filterId: string }) {
  return (
    <svg
      className="paper-language-menu-frame"
      viewBox="0 0 188 94"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5 5 C47 1, 139 3, 183 6 C187 28, 185 67, 182 89 C137 93, 48 92, 5 88 C2 67, 2 27, 5 5 Z"
        filter={`url(#${filterId})`}
      />
      <path d="M8 48 C51 46, 137 50, 180 47" />
    </svg>
  );
}

function PaperLanguageCheck({ filterId }: { filterId: string }) {
  return (
    <svg viewBox="0 0 22 18" focusable="false">
      <path d="M3 9.5 L8 14 L19 3" filter={`url(#${filterId})`} />
    </svg>
  );
}
