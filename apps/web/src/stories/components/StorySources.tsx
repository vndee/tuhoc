import { useState, type ReactNode } from 'react';
import { t, type Lang } from '../../i18n';
import type { IllustrationProvenance, SourceEntry } from '../types';

export interface StorySourcesProps {
  sceneSourceIds: string[];
  sources: SourceEntry[];
  provenance: IllustrationProvenance[];
  lang: Lang;
  all?: boolean;
}

function SourceList({ sources, lang }: { sources: SourceEntry[]; lang: Lang }) {
  return <ol className="story-source-list">{sources.map((source) => (
    <li key={source.id}>
      <a href={source.url} rel="noreferrer" target="_blank">{source.title}</a>
      <span>{source.authorsOrInstitution} · {source.year}</span>
      <span>{source.note[lang]}</span>
      <span>{t(lang, 'stories.sourceAccessed', source.accessedAt)}</span>
    </li>
  ))}</ol>;
}

function Disclosure({ children, label }: { children: ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  return <details aria-expanded={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{label}</summary>
    {children}
  </details>;
}

export function StorySources({ sceneSourceIds, sources, provenance, lang, all = false }: StorySourcesProps) {
  const ordered = all ? sources : sources.filter((source) => sceneSourceIds.includes(source.id));
  if (!all) return <Disclosure label={t(lang, 'stories.sourcesForScene')}><SourceList sources={ordered} lang={lang} /></Disclosure>;

  return <section className="story-all-sources" aria-labelledby="story-all-sources-title">
    <h2 id="story-all-sources-title">{t(lang, 'stories.allSources')}</h2>
    <SourceList sources={ordered} lang={lang} />
    <Disclosure label={t(lang, 'stories.makingOf')}>
      <ol className="story-provenance-list">{provenance.map((item) => (
        <li key={item.id}>
          <strong>{item.filename}</strong>
          <span>{item.sceneId} · {item.createdAt}</span>
          <span>{item.tool} · {item.model}</span>
          <span>{item.edits.join(', ')} · {item.license}</span>
          <Disclosure label={t(lang, 'stories.prompt')}><p>{item.prompt}</p></Disclosure>
        </li>
      ))}</ol>
    </Disclosure>
  </section>;
}
