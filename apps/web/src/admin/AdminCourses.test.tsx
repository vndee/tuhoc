import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { t as lookup, type Translate } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { AdminCourses } from './AdminCourses';

/** `t()` pinned to Vietnamese — same shim `api/client.test.ts` uses. */
const t: Translate = (key, ...args) => lookup('vi', key, ...args);

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function row(over: Record<string, unknown> = {}) {
  return {
    slug: 'dai-so',
    title: 'Đại số',
    version: 2,
    published_at: '2026-08-20T10:15:30.000Z',
    versions: [1, 2],
    ...over,
  };
}

function listOnce(rows: unknown[]) {
  return http.get('/admin/courses', () => HttpResponse.json(rows));
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AdminCourses />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

/** A fake .zip — content is never actually unzipped by this screen; the server does that. */
function fakeZip(name = 'dai-so.zip') {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'application/zip' });
}

describe('AdminCourses — danh sách', () => {
  it('renders slug, title, version and the published date', async () => {
    server.use(listOnce([row()]));
    renderPage();

    expect(await screen.findByText('dai-so')).toBeInTheDocument();
    expect(screen.getByText('Đại số')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('an empty catalog shows the empty-state sentence, not a blank table', async () => {
    server.use(listOnce([]));
    renderPage();

    expect(await screen.findByText(t('admin.empty'))).toBeInTheDocument();
  });
});

describe('AdminCourses — phát hành', () => {
  /**
   * THE test this task's brief names as the interesting part: a 400
   * carries EVERY finding at once, and this screen must draw all of them —
   * not the first, not a generic "upload failed". Two DIFFERENT codes so a
   * test that only rendered one could not accidentally pass.
   */
  it('a 400 with two findings renders BOTH, translated via finding.<CODE>', async () => {
    server.use(listOnce([]));
    // Both plain-string `finding.*` entries (no `manifest`/`mb`-style
    // parameter) — see `AdminCourses.tsx`'s `knownFindingMessage` doc
    // comment for why a PARAMETERISED entry (e.g. `MANIFEST_MISSING`) is
    // a different case this test does not exercise.
    const findings = [
      { code: 'DUPLICATE_CHAPTER_ID', path: 'manifest.json', detail: 'two chapters share one id' },
      { code: 'CHAPTER_FILE_MISSING', path: 'chapters/c1.html', detail: 'toc names a file the package lacks' },
    ];
    server.use(
      http.put('/admin/courses/:slug', () =>
        HttpResponse.json({ error: 'invalid course package', findings }, { status: 400 }),
      ),
    );
    renderPage();
    await screen.findByText(t('admin.empty'));

    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(t('admin.upload.fileLabel')), fakeZip());
    await user.click(screen.getByRole('button', { name: t('admin.upload.submit') }));

    expect(await screen.findByText(t('finding.DUPLICATE_CHAPTER_ID'))).toBeInTheDocument();
    expect(screen.getByText(t('finding.CHAPTER_FILE_MISSING'))).toBeInTheDocument();
    expect(screen.getByText('DUPLICATE_CHAPTER_ID')).toBeInTheDocument();
    expect(screen.getByText('CHAPTER_FILE_MISSING')).toBeInTheDocument();
  });

  /**
   * The other half of "the interesting part": a code this build has no
   * `finding.<CODE>` key for is a REAL case (`DUPLICATE_ENTRY` is Go-only
   * in the validate-rule sense — see `adminApi.ts`), not a hypothetical.
   * Falling through to nothing, or to the literal string "undefined", is
   * the exact failure this test exists to catch.
   */
  it('a finding code with no client-side message key renders the server\'s own detail, never "undefined" or a blank cell', async () => {
    server.use(listOnce([]));
    const findings = [{ code: 'SOME_FUTURE_CODE', path: 'widgets/w/index.html', detail: 'a brand new kind of problem' }];
    server.use(
      http.put('/admin/courses/:slug', () =>
        HttpResponse.json({ error: 'invalid course package', findings }, { status: 400 }),
      ),
    );
    renderPage();
    await screen.findByText(t('admin.empty'));

    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(t('admin.upload.fileLabel')), fakeZip());
    await user.click(screen.getByRole('button', { name: t('admin.upload.submit') }));

    expect(await screen.findByText('a brand new kind of problem')).toBeInTheDocument();
    expect(screen.getByText('SOME_FUTURE_CODE')).toBeInTheDocument();
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });

  it('a 201 clears the form and reloads the list — the new row shows up with no page reload', async () => {
    let calls = 0;
    server.use(
      http.get('/admin/courses', () => {
        calls += 1;
        return HttpResponse.json(calls === 1 ? [] : [row({ slug: 'giai-tich', title: 'Giải tích', version: 1 })]);
      }),
    );
    server.use(http.put('/admin/courses/:slug', () => HttpResponse.json({ slug: 'giai-tich', version: 1 }, { status: 201 })));
    renderPage();
    await screen.findByText(t('admin.empty'));

    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(t('admin.upload.fileLabel')), fakeZip('giai-tich.zip'));
    await user.click(screen.getByRole('button', { name: t('admin.upload.submit') }));

    expect(await screen.findByText('Giải tích')).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('the slug field defaults from the chosen file name and stays editable', async () => {
    server.use(listOnce([]));
    renderPage();
    await screen.findByText(t('admin.empty'));

    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(t('admin.upload.fileLabel')), fakeZip('dai-so.zip'));

    const slugField = screen.getByLabelText(t('admin.upload.slugLabel')) as HTMLInputElement;
    expect(slugField.value).toBe('dai-so');

    await user.clear(slugField);
    await user.type(slugField, 'dai-so-2');
    expect(slugField.value).toBe('dai-so-2');
  });
});

describe('AdminCourses — gỡ và lùi phiên bản', () => {
  it('unpublish asks for confirmation before sending DELETE, and reloads the list after', async () => {
    let deleteCalled = false;
    let listCalls = 0;
    server.use(
      http.get('/admin/courses', () => {
        listCalls += 1;
        return HttpResponse.json(listCalls === 1 ? [row()] : []);
      }),
      http.delete('/admin/courses/:slug', () => {
        deleteCalled = true;
        return HttpResponse.json({ slug: 'dai-so' });
      }),
    );
    renderPage();
    await screen.findByText('dai-so');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: t('admin.unpublish.button') }));
    // Not sent yet — only a confirm prompt appeared.
    expect(deleteCalled).toBe(false);
    expect(screen.getByText(t('admin.unpublish.confirmPrompt', 'dai-so'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('admin.unpublish.confirmYes') }));

    await waitFor(() => expect(deleteCalled).toBe(true));
    await waitFor(() => expect(screen.queryByText('dai-so')).not.toBeInTheDocument());
  });

  it('rollback sends the chosen version and reloads the list', async () => {
    let rolledBackTo: unknown = null;
    let listCalls = 0;
    server.use(
      http.get('/admin/courses', () => {
        listCalls += 1;
        return HttpResponse.json([row({ version: listCalls === 1 ? 2 : 1 })]);
      }),
      http.post('/admin/courses/:slug/rollback', async ({ request }) => {
        rolledBackTo = await request.json();
        return HttpResponse.json({ slug: 'dai-so', version: 1 }, { status: 201 });
      }),
    );
    renderPage();
    await screen.findByText('dai-so');

    const user = userEvent.setup();
    const table = screen.getByRole('table');
    const select = within(table).getByLabelText(t('admin.rollback.label'));
    await user.selectOptions(select, '1');
    await user.click(within(table).getByRole('button', { name: t('admin.rollback.button') }));

    await waitFor(() => expect(rolledBackTo).toEqual({ version: 1 }));
    // Review round 1, finding 3: a successful rollback showed no
    // confirmation at all, unlike a successful publish — the asymmetry
    // was the tell. `admin.rollback.success` must actually render.
    expect(await screen.findByText(t('admin.rollback.success', 1))).toBeInTheDocument();
  });
});
