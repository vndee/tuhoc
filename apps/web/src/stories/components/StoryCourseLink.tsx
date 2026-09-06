import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { catalogQueryKey, fetchCatalog } from '../../api/catalog';
import { useLanguage } from '../../i18n/LanguageProvider';
import type { StoryDefinition } from '../types';

export function StoryCourseLink({ action }: { action: NonNullable<StoryDefinition['courseAction']> }) {
  const { lang } = useLanguage();
  const catalog = useQuery({ queryKey: catalogQueryKey(), queryFn: fetchCatalog, retry: false });
  const available = catalog.data?.some((course) => course.slug === action.slug) === true;
  const href = available ? `/c/${action.slug}` : '/courses';
  const label = (available ? action.label : action.fallbackLabel)[lang];

  return <Link className="story-course-link" to={href}>{label}</Link>;
}
