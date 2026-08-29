import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Same rationale as `api/client.test.ts`: the 401 redirect is a hard
// `window.location` navigation jsdom cannot perform, so it is mocked at the
// module boundary and asserted as "was it requested", not "did it happen".
vi.mock('../api/navigation', () => ({
  redirectToLogin: vi.fn(),
}));

import { t as lookup, type Translate } from '../i18n';
import { redirectToLogin } from '../api/navigation';
import { ApiError, NotJsonError } from '../api/client';
import {
  FindingsError,
  adminAdjustCredit,
  adminGetAISettings,
  adminGetAIUser,
  adminListAIUsers,
  adminListCourses,
  adminListPricing,
  adminPublish,
  adminRollback,
  adminUnpublish,
  adminUpdateBasePrompt,
  adminUpdatePricing,
  describeAdminAIError,
  describeAdminError,
} from './adminApi';

const t: Translate = (key, ...args) => lookup('vi', key, ...args);

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.mocked(redirectToLogin).mockClear();
});
afterAll(() => server.close());

function row(over: Record<string, unknown> = {}) {
  return {
    slug: 'dai-so',
    title: 'Đại số',
    version: 3,
    published_at: '2026-08-20T10:15:30.000Z',
    versions: [1, 2, 3],
    ...over,
  };
}

const zip = () => new File([new Uint8Array([1, 2, 3, 4])], 'dai-so.zip', { type: 'application/zip' });

describe('adminListCourses', () => {
  it('GET /admin/courses → the array, verbatim', async () => {
    server.use(http.get('/admin/courses', () => HttpResponse.json([row()])));
    await expect(adminListCourses()).resolves.toEqual([row()]);
  });

  it('a non-2xx rejects with ApiError', async () => {
    server.use(http.get('/admin/courses', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    await expect(adminListCourses()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('adminPublish', () => {
  it('PUT /admin/courses/:slug, Content-Type application/zip, body = the raw bytes, slug percent-encoded', async () => {
    let method = '';
    let contentType: string | null = null;
    let path = '';
    let bodyBytes: Uint8Array | null = null;
    server.use(
      http.put('/admin/courses/:slug', async ({ request, params }) => {
        method = request.method;
        contentType = request.headers.get('content-type');
        path = String(params.slug);
        bodyBytes = new Uint8Array(await request.arrayBuffer());
        return HttpResponse.json({ slug: 'đại số', version: 4 }, { status: 201 });
      }),
    );

    await adminPublish('đại số', zip());

    expect(method).toBe('PUT');
    expect(path).toBe('đại số');
    expect(contentType).toBe('application/zip');
    expect(bodyBytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('201 resolves with {slug, version} — version is the server publish sequence, not a semver', async () => {
    server.use(http.put('/admin/courses/:slug', () => HttpResponse.json({ slug: 'dai-so', version: 4 }, { status: 201 })));
    await expect(adminPublish('dai-so', zip())).resolves.toEqual({ slug: 'dai-so', version: 4 });
  });

  /**
   * The 400 shape this whole task exists to render: EVERY finding at once,
   * not just the first. `FindingsError` is how that survives the trip from
   * `adminApi.ts` (which knows the wire shape) to `AdminCourses.tsx` (which
   * draws the table) without the screen having to know `{error, findings}`
   * is the body of an `ApiError`.
   */
  it('400 with findings → rejects with FindingsError carrying every finding, in order', async () => {
    const findings = [
      { code: 'MANIFEST_MISSING', path: 'manifest.json', detail: 'package has no manifest.json at its root' },
      { code: 'DUPLICATE_CHAPTER_ID', path: 'chapters/c1.html', detail: 'two chapters share one id' },
    ];
    server.use(
      http.put('/admin/courses/:slug', () =>
        HttpResponse.json({ error: 'invalid course package', findings }, { status: 400 }),
      ),
    );

    const failure = adminPublish('dai-so', zip());
    await expect(failure).rejects.toBeInstanceOf(FindingsError);
    await expect(failure).rejects.toMatchObject({ findings });
  });

  it('a 400 with NO findings array (e.g. slug mismatch) stays a plain ApiError, not a FindingsError', async () => {
    server.use(
      http.put('/admin/courses/:slug', () =>
        HttpResponse.json({ error: 'slug in package does not match URL slug' }, { status: 400 }),
      ),
    );

    const failure = adminPublish('dai-so', zip());
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.not.toBeInstanceOf(FindingsError);
  });

  it('401 triggers the shared redirectToLogin side effect, same as every other authenticated call', async () => {
    server.use(http.put('/admin/courses/:slug', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    await expect(adminPublish('dai-so', zip())).rejects.toBeInstanceOf(ApiError);
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });

  /**
   * Review round 1, finding 2. `client.ts`'s `request<T>` guards exactly
   * this — a 2xx whose body is not JSON (the SPA-fallback shape measured
   * 2026-08-22, `client.ts`'s own `NotJsonError` doc comment) — and
   * `adminListCourses`/`adminRollback` inherit it for free by going through
   * `api.get`/`api.post`. `adminPublish` hand-rolls its own request/parse
   * for the raw-bytes PUT and had silently dropped the same guard: before
   * the fix this resolved `{slug: undefined, version: undefined}` from an
   * HTML body — rendered by `AdminCourses.tsx` as an apparent SUCCESS
   * ("Published undefined, version undefined"). This asserts a REJECTION,
   * not merely "the resolved value is wrong", so a future regression back
   * to the silent-success shape cannot slip past by returning the right
   * type with the wrong values.
   */
  it('a 200 whose body is not JSON (e.g. an SPA index.html fallback) rejects — never a fake {slug, version} success', async () => {
    server.use(http.put('/admin/courses/:slug', () => HttpResponse.html('<!doctype html><p>not found</p>')));
    const failure = adminPublish('dai-so', zip());
    await expect(failure).rejects.toBeInstanceOf(NotJsonError);
  });

  /**
   * Final whole-branch review, Important 3 — the exact scenario the
   * finding names: `parseBody`'s old guard here only ever checked
   * `typeof parsed === 'string'`, so a 200 whose body is VALID JSON but is
   * an array (or `null`, or a bare primitive) sailed through, got cast to
   * `PublishResult` anyway, and `AdminCourses.tsx` would have rendered
   * "Published undefined, version undefined" as an apparent SUCCESS — the
   * array has no `.slug`/`.version` of its own. `isJsonContainer` (shared
   * with `client.ts`'s `request<T>`) closes this without opting into its
   * own `allowArray`, since a publish response is never legitimately an
   * array.
   */
  it('a 200 whose body is valid JSON but an array (not {slug, version}) rejects — never a fake success read off array indices', async () => {
    server.use(http.put('/admin/courses/:slug', () => HttpResponse.json([{ slug: 'dai-so', version: 4 }])));
    const failure = adminPublish('dai-so', zip());
    await expect(failure).rejects.toBeInstanceOf(NotJsonError);
  });

  it('a 200 whose body is valid JSON but null rejects', async () => {
    server.use(http.put('/admin/courses/:slug', () => HttpResponse.json(null)));
    const failure = adminPublish('dai-so', zip());
    await expect(failure).rejects.toBeInstanceOf(NotJsonError);
  });
});

describe('adminUnpublish', () => {
  it('DELETE /admin/courses/:slug, slug percent-encoded', async () => {
    let method = '';
    let path = '';
    server.use(
      http.delete('/admin/courses/:slug', ({ request, params }) => {
        method = request.method;
        path = String(params.slug);
        return HttpResponse.json({ slug: path });
      }),
    );

    await adminUnpublish('đại số');
    expect(method).toBe('DELETE');
    expect(path).toBe('đại số');
  });

  it('resolves (void) on 200', async () => {
    server.use(http.delete('/admin/courses/:slug', () => HttpResponse.json({ slug: 'dai-so' })));
    await expect(adminUnpublish('dai-so')).resolves.toBeUndefined();
  });

  it('404 (unknown slug) rejects with ApiError', async () => {
    server.use(http.delete('/admin/courses/:slug', () => HttpResponse.json({ error: 'not found' }, { status: 404 })));
    await expect(adminUnpublish('ghost')).rejects.toMatchObject({ status: 404 });
  });
});

describe('adminRollback', () => {
  it('POST /admin/courses/:slug/rollback, body {version}', async () => {
    let path = '';
    let body: unknown = null;
    server.use(
      http.post('/admin/courses/:slug/rollback', async ({ request, params }) => {
        path = String(params.slug);
        body = await request.json();
        return HttpResponse.json({ slug: path, version: 2 }, { status: 201 });
      }),
    );

    await expect(adminRollback('dai-so', 2)).resolves.toEqual({ slug: 'dai-so', version: 2 });
    expect(path).toBe('dai-so');
    expect(body).toEqual({ version: 2 });
  });

  it('400 with findings (rollback re-validates the stored package) → FindingsError', async () => {
    const findings = [{ code: 'CHAPTER_FILE_MISSING', path: 'chapters/c2.html', detail: 'missing' }];
    server.use(
      http.post('/admin/courses/:slug/rollback', () =>
        HttpResponse.json({ error: 'invalid course package', findings }, { status: 400 }),
      ),
    );
    await expect(adminRollback('dai-so', 2)).rejects.toBeInstanceOf(FindingsError);
  });
});

describe('describeAdminError', () => {
  it('maps a 500 to the server-down sentence', () => {
    expect(describeAdminError(new ApiError(500, { error: 'boom' }), t)).toBe(t('admin.error.serverDown'));
  });

  it('maps a 404 to the not-found sentence', () => {
    expect(describeAdminError(new ApiError(404, { error: 'not found' }), t)).toBe(t('admin.error.notFound'));
  });

  it('maps a plain (non-findings) 400 to the bad-request sentence', () => {
    expect(describeAdminError(new ApiError(400, { error: 'bad' }), t)).toBe(t('admin.error.badRequest'));
  });

  it('a non-ApiError (no response ever arrived) maps to the unreachable sentence', () => {
    expect(describeAdminError(new TypeError('Failed to fetch'), t)).toBe(t('admin.error.unreachable'));
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════
 * Task 17 — the seven `/admin/ai/*` calls (`adminListAIUsers` ...
 * `adminUpdateBasePrompt`) and `describeAdminAIError`.
 * ══════════════════════════════════════════════════════════════════════
 */

function aiUserRow(over: Record<string, unknown> = {}) {
  return { id: 'a1111111-0000-4000-8000-000000000001', email: 'hoc@vidu.test', role: 'user', balance_micro: 733100, ...over };
}

function pricingRow(over: Record<string, unknown> = {}) {
  return {
    model: 'deepseek-v4-pro',
    cost_micro_per_1k_in: 1320,
    cost_micro_per_1k_cached_in: 44,
    cost_micro_per_1k_out: 3960,
    credits_per_1k_in: 1320,
    credits_per_1k_cached_in: 44,
    credits_per_1k_out: 3960,
    updated_at: '2026-08-28T10:00:00.000Z',
    ...over,
  };
}

function settingsRow(over: Record<string, unknown> = {}) {
  return {
    base_system_prompt: 'You are a patient tutor.',
    credits_per_web_search: 700,
    cost_micro_per_web_search: 250,
    signup_grant_micro: 50000,
    max_tokens_per_turn: 8192,
    max_tool_rounds_per_turn: 6,
    max_base_prompt_chars: 20000,
    ...over,
  };
}

describe('adminListAIUsers', () => {
  it('GET /admin/ai/users (no ?q) when query is empty → the array, verbatim', async () => {
    let path = '';
    server.use(
      http.get('/admin/ai/users', ({ request }) => {
        path = new URL(request.url).pathname + new URL(request.url).search;
        return HttpResponse.json([aiUserRow()]);
      }),
    );
    await expect(adminListAIUsers('')).resolves.toEqual([aiUserRow()]);
    expect(path).toBe('/admin/ai/users');
  });

  it('a non-empty query is sent as ?q=<encoded>, trimmed', async () => {
    let search = '';
    server.use(
      http.get('/admin/ai/users', ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );
    await adminListAIUsers('  đại số@vidu.test  ');
    expect(search).toBe(`?q=${encodeURIComponent('đại số@vidu.test')}`);
  });

  it('a non-2xx rejects with ApiError', async () => {
    server.use(http.get('/admin/ai/users', () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    await expect(adminListAIUsers('')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('adminGetAIUser', () => {
  it('GET /admin/ai/users/:id, id percent-encoded → the detail object', async () => {
    let path = '';
    const detail = { ...aiUserRow(), recent_usage: [], recent_adjustments: [] };
    server.use(
      http.get('/admin/ai/users/:id', ({ request, params }) => {
        path = String(params.id);
        void request;
        return HttpResponse.json(detail);
      }),
    );
    await expect(adminGetAIUser('a b')).resolves.toEqual(detail);
    expect(path).toBe('a b');
  });

  it('404 (unknown id) rejects with ApiError', async () => {
    server.use(http.get('/admin/ai/users/:id', () => HttpResponse.json({ code: 'NotFound', error: 'no such user' }, { status: 404 })));
    await expect(adminGetAIUser('ghost')).rejects.toMatchObject({ status: 404 });
  });
});

describe('adminAdjustCredit', () => {
  it('POST /admin/ai/users/:id/credit, body {delta_micro, note} → {balance_micro}', async () => {
    let path = '';
    let body: unknown = null;
    server.use(
      http.post('/admin/ai/users/:id/credit', async ({ request, params }) => {
        path = String(params.id);
        body = await request.json();
        return HttpResponse.json({ balance_micro: 1148400 });
      }),
    );
    await expect(adminAdjustCredit('u1', 415300, 'top-up')).resolves.toEqual({ balance_micro: 1148400 });
    expect(path).toBe('u1');
    expect(body).toEqual({ delta_micro: 415300, note: 'top-up' });
  });

  it('a negative delta_micro is sent through unchanged (a debit, not an error)', async () => {
    let body: unknown = null;
    server.use(
      http.post('/admin/ai/users/:id/credit', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ balance_micro: 941700 });
      }),
    );
    await adminAdjustCredit('u1', -206700, 'correction');
    expect(body).toEqual({ delta_micro: -206700, note: 'correction' });
  });

  it('a 400 (e.g. empty note) rejects with ApiError carrying the code', async () => {
    server.use(
      http.post('/admin/ai/users/:id/credit', () =>
        HttpResponse.json({ code: 'FieldRequired', error: 'note is required' }, { status: 400 }),
      ),
    );
    const failure = adminAdjustCredit('u1', 100, '');
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 400, body: { code: 'FieldRequired' } });
  });

  it('401 triggers the shared redirectToLogin side effect', async () => {
    server.use(http.post('/admin/ai/users/:id/credit', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    await expect(adminAdjustCredit('u1', 100, 'note')).rejects.toBeInstanceOf(ApiError);
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });
});

describe('adminListPricing', () => {
  it('GET /admin/ai/pricing → the array, verbatim', async () => {
    server.use(http.get('/admin/ai/pricing', () => HttpResponse.json([pricingRow()])));
    await expect(adminListPricing()).resolves.toEqual([pricingRow()]);
  });
});

describe('adminUpdatePricing', () => {
  const input = {
    cost_micro_per_1k_in: 1320,
    cost_micro_per_1k_cached_in: 44,
    cost_micro_per_1k_out: 3960,
    credits_per_1k_in: 4170,
    credits_per_1k_cached_in: 44,
    credits_per_1k_out: 3960,
    note: 'raising the input rate',
  };

  it('PUT /admin/ai/pricing/:model, Content-Type application/json, model percent-encoded → the updated row', async () => {
    let method = '';
    let contentType: string | null = null;
    let path = '';
    let body: unknown = null;
    server.use(
      http.put('/admin/ai/pricing/:model', async ({ request, params }) => {
        method = request.method;
        contentType = request.headers.get('content-type');
        path = String(params.model);
        body = await request.json();
        return HttpResponse.json(pricingRow({ credits_per_1k_in: 4170 }));
      }),
    );

    await expect(adminUpdatePricing('deepseek v4', input)).resolves.toEqual(pricingRow({ credits_per_1k_in: 4170 }));
    expect(method).toBe('PUT');
    expect(path).toBe('deepseek v4');
    expect(contentType).toBe('application/json');
    expect(body).toEqual(input);
  });

  it('404 (unknown model) rejects with ApiError', async () => {
    server.use(http.put('/admin/ai/pricing/:model', () => HttpResponse.json({ code: 'NotFound', error: 'no such model' }, { status: 404 })));
    await expect(adminUpdatePricing('ghost-model', input)).rejects.toMatchObject({ status: 404 });
  });

  /**
   * `putJSON` (adminApi.ts) reuses the EXACT `isJsonContainer`/`NotJsonError`
   * guard `api.get`/`api.post` already apply — this proves that guard
   * survived the trip through the hand-rolled PUT path, the same shape of
   * regression `adminPublish`'s own equivalent test (above) exists to catch.
   */
  it('a 200 whose body is not JSON rejects with NotJsonError, never a fake success', async () => {
    server.use(http.put('/admin/ai/pricing/:model', () => HttpResponse.html('<!doctype html><p>not found</p>')));
    await expect(adminUpdatePricing('deepseek-v4-pro', input)).rejects.toBeInstanceOf(NotJsonError);
  });

  it('a 200 whose body is a JSON array (not an object) rejects with NotJsonError', async () => {
    server.use(http.put('/admin/ai/pricing/:model', () => HttpResponse.json([pricingRow()])));
    await expect(adminUpdatePricing('deepseek-v4-pro', input)).rejects.toBeInstanceOf(NotJsonError);
  });
});

describe('adminGetAISettings', () => {
  it('GET /admin/ai/settings → the settings object, verbatim', async () => {
    server.use(http.get('/admin/ai/settings', () => HttpResponse.json(settingsRow())));
    await expect(adminGetAISettings()).resolves.toEqual(settingsRow());
  });
});

describe('adminUpdateBasePrompt', () => {
  it('PUT /admin/ai/settings, body {base_system_prompt, note} → the updated settings', async () => {
    let body: unknown = null;
    server.use(
      http.put('/admin/ai/settings', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(settingsRow({ base_system_prompt: 'new prompt' }));
      }),
    );
    await expect(adminUpdateBasePrompt('new prompt', 'adding a rule')).resolves.toEqual(
      settingsRow({ base_system_prompt: 'new prompt' }),
    );
    expect(body).toEqual({ base_system_prompt: 'new prompt', note: 'adding a rule' });
  });

  it('an omitted note is not sent as a literal key at all (JSON.stringify drops `undefined`)', async () => {
    let body: unknown = null;
    server.use(
      http.put('/admin/ai/settings', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(settingsRow());
      }),
    );
    await adminUpdateBasePrompt('a prompt');
    expect(body).toEqual({ base_system_prompt: 'a prompt' });
  });

  it('a 400 (empty prompt) rejects with ApiError carrying FieldRequired', async () => {
    server.use(
      http.put('/admin/ai/settings', () =>
        HttpResponse.json({ code: 'FieldRequired', error: 'base_system_prompt must not be empty' }, { status: 400 }),
      ),
    );
    const failure = adminUpdateBasePrompt('', 'trying to clear it');
    await expect(failure).rejects.toMatchObject({ status: 400, body: { code: 'FieldRequired' } });
  });
});

describe('describeAdminAIError', () => {
  it('FieldRequired → the field-required sentence', () => {
    expect(describeAdminAIError(new ApiError(400, { code: 'FieldRequired', error: 'x' }), t)).toBe(
      t('admin.ai.error.fieldRequired'),
    );
  });

  it('AmountOutOfRange → the amount-out-of-range sentence', () => {
    expect(describeAdminAIError(new ApiError(400, { code: 'AmountOutOfRange', error: 'x' }), t)).toBe(
      t('admin.ai.error.amountOutOfRange'),
    );
  });

  it('FieldTooLong → the field-too-long sentence', () => {
    expect(describeAdminAIError(new ApiError(400, { code: 'FieldTooLong', error: 'x' }), t)).toBe(
      t('admin.ai.error.fieldTooLong'),
    );
  });

  it('NotFound → the not-found sentence', () => {
    expect(describeAdminAIError(new ApiError(404, { code: 'NotFound', error: 'x' }), t)).toBe(
      t('admin.ai.error.notFound'),
    );
  });

  it('an unrecognized/absent code falls back to describeAdminError (status-based)', () => {
    expect(describeAdminAIError(new ApiError(500, { error: 'boom' }), t)).toBe(t('admin.error.serverDown'));
    expect(describeAdminAIError(new ApiError(400, { error: 'no code at all' }), t)).toBe(t('admin.error.badRequest'));
  });

  it('a non-ApiError falls back to the unreachable sentence', () => {
    expect(describeAdminAIError(new TypeError('Failed to fetch'), t)).toBe(t('admin.error.unreachable'));
  });
});
