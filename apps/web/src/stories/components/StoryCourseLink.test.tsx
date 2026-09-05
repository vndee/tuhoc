import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { writeLocalStorage } from '../../db/localStorage';
import { LANG_STORAGE_KEY } from '../../i18n';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import type { StoryDefinition } from '../types';
import { StoryCourseLink } from './StoryCourseLink';
import { catalogQueryKey } from '../../api/catalog';

const action: NonNullable<StoryDefinition['courseAction']> = {
  slug: '***REMOVED***',
  label: { vi: 'Học tiếp ***REMOVED***', en: 'Continue with Information Theory' },
  fallbackLabel: { vi: 'Khám phá các khoá học', en: 'Explore the courses' },
};

const course = {
  slug: '***REMOVED***', title: '***REMOVED***', lang: 'vi', description: 'Khoá học thật', version: 1,
};

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

function renderLink(lang: 'vi' | 'en' = 'vi') {
  if (lang === 'en') writeLocalStorage(LANG_STORAGE_KEY, 'en');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <LanguageProvider><MemoryRouter><StoryCourseLink action={action} /></MemoryRouter></LanguageProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

describe('StoryCourseLink', () => {
  it('links to the real matching course after the catalog confirms it exists', async () => {
    server.use(http.get('/courses', () => HttpResponse.json([course])));
    const { client } = renderLink();

    await waitFor(() => expect(client.getQueryState(catalogQueryKey())?.status).toBe('success'));

    expect(await screen.findByRole('link', { name: action.label.vi })).toHaveAttribute('href', '/c/***REMOVED***');
  });

  it.each([
    ['missing', () => HttpResponse.json([])],
    ['error', () => HttpResponse.error()],
  ])('uses the honest catalog fallback when the course is %s', async (_case, response) => {
    server.use(http.get('/courses', response));
    const { client } = renderLink();

    await waitFor(() => expect(client.getQueryState(catalogQueryKey())?.status).toBe(_case === 'error' ? 'error' : 'success'));

    expect(await screen.findByRole('link', { name: action.fallbackLabel.vi })).toHaveAttribute('href', '/courses');
  });

  it('uses the catalog fallback while the catalog is still loading', () => {
    server.use(http.get('/courses', async () => new Promise<never>(() => undefined)));
    renderLink();

    expect(screen.getByRole('link', { name: action.fallbackLabel.vi })).toHaveAttribute('href', '/courses');
  });

  it('uses the approved English action without claiming an English course edition', async () => {
    server.use(http.get('/courses', () => HttpResponse.json([course])));
    renderLink('en');

    const link = await screen.findByRole('link', { name: 'Continue with Information Theory' });
    expect(link).toHaveAttribute('href', '/c/***REMOVED***');
    expect(link).not.toHaveTextContent(/English edition/i);
  });
});
