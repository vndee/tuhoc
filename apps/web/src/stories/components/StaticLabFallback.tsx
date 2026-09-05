import { t, type Lang } from '../../i18n';
import type { LabFallback } from '../types';

export interface StaticLabFallbackProps {
  fallback: LabFallback;
  lang: Lang;
  title: string;
  instruction: string;
  onRetry: () => void;
  onBack: () => void;
}

export function StaticLabFallback({ fallback, lang, title, instruction, onRetry, onBack }: StaticLabFallbackProps) {
  const table = fallback.table?.[lang];

  return <section className="story-lab-fallback" aria-label={title}>
    <h3>{title}</h3>
    <p>{instruction}</p>
    {table ? <table>
      <caption>{fallback.diagramLabel[lang]}</caption>
      <thead><tr>{table.headers.map((header, index) => <th scope="col" key={`${index}:${header}`}>{header}</th>)}</tr></thead>
      <tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>
        {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
      </tr>)}</tbody>
    </table> : <p className="story-lab-fallback-label">{fallback.diagramLabel[lang]}</p>}
    <p>{fallback.explanation[lang]}</p>
    <div className="story-lab-fallback-actions">
      <button type="button" onClick={onRetry}>{t(lang, 'landing.catalog.retry')}</button>
      <button type="button" onClick={onBack}>{t(lang, 'stories.backToIllustration')}</button>
    </div>
  </section>;
}
