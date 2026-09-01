/**
 * Two people, one browser — what must NOT survive the handover.
 *
 * This file exists because of a second-order consequence of Task 6's fix.
 * That fix was right and is not being reversed: a note being typed is
 * stamped into `localStorage` on every keystroke, because Chromium discards
 * IndexedDB transactions opened during a same-tab navigation and the note
 * was measurably lost at 0 ms and at 400 ms after F5 (see
 * `annotations/MarginCards.tsx`'s `DRAFT_KEY` comment and
 * `.superpowers/sdd/2026-08-19-p2-annotations/task-6-fix-report.md`). What
 * the fix also did, without anyone noticing, was open a SECOND local store
 * holding the user's own words — and `clearLocalData()`, the single truth
 * point for "this browser now belongs to somebody else", only ever emptied
 * the Dexie tables.
 *
 * `DRAFT_KEY` is a CONSTANT (`'itbook-note-draft'`), not a per-user key, and
 * `localStorage` never expires. So the words one reader typed sat in the
 * browser, inside the next reader's session, indefinitely.
 *
 * Why the whole flow and not just "does the function delete the key":
 * neither half of this bug is wrong on its own. Stamping the draft
 * synchronously is correct. Clearing every Dexie table is correct. The
 * defect is only visible where the two meet, so the test has to walk the
 * same ground a person does — type through the real editor, leave through
 * the real `useLogout`, arrive through the real `<Login>` — and both
 * doorways are checked, because both of them clear local data and both of
 * them are load-bearing (`db/local.ts`'s own doc comment names them).
 *
 * Deliberately no `<App/>` and no `useSyncLifecycle` here: ruling P2-F3
 * forbids "sync immediately on login", and a test that started a cycle
 * would quietly depend on the thing that must not exist.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useEffect, useRef, useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { annotationsQueryKey } from '../api/annotations';
import { type Anchor, type AnchorColor, selectionToAnchor } from '../annotations/anchor';
import { type CardFocus, DRAFT_KEY, MarginCards } from '../annotations/MarginCards';
import { normalizeContainer } from '../annotations/normalize';
import { type Ann, type ChapterContent, useAnnotations } from '../annotations/useAnnotations';
import { RequireAuth } from '../auth/RequireAuth';
import { useLogout } from '../auth/useLogout';
import { clearLocalData, db } from '../db/local';
import { Login } from '../pages/Login';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { ThemeProvider } from '../theme/ThemeContext';

/**
 * The theme key, written out rather than imported from the registry in
 * `db/local.ts` — the same choice `theme.test.tsx` makes.
 *
 * On purpose: this file's job is to say what is really in the browser after
 * a change of account. If it asked the registry which keys to look at, a
 * change that dropped a key OUT of the registry would take this test's
 * eyesight with it, and the whole point is to have one witness that cannot
 * be fooled that way. The registry's own consistency is pinned separately,
 * in `db/local.test.ts`.
 */
const THEME_KEY = 'itbook-theme';

/** What A typed and never got to save. Distinctive enough that any leak of it into B's session is unmistakable. */
const A_PRIVATE = 'chỗ này mình vẫn chưa hiểu, thấy mình dốt quá';

/** Wide enough for the rail column to exist — `reader.css` hides `#rail` below 1240px and jsdom's own default (1024) is the MOBILE branch. */
const WIDE = 1400;

function setViewportWidth(px: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: px });
}

const PROSE = [
  '<p>Entropy đo lượng thông tin trung bình mà một nguồn tin sinh ra.</p>',
  '<p>Kênh nhiễu làm giảm dung lượng truyền tin của toàn hệ thống.</p>',
].join('\n');

const QUOTE = 'Entropy đo lượng thông tin';

/** A real `Anchor` built through `./anchor`, from a detached copy of the chapter — the same construction `MarginCards.test.tsx` uses, and for the same reason: a hand-written `{exact,prefix,suffix}` would pin this file's idea of the projection rather than the real one. */
function makeAnchor(html: string, quote: string, color: AnchorColor = 'y'): Anchor {
  const scratch = document.createElement('div');
  scratch.innerHTML = html;
  const map = normalizeContainer(scratch);
  const walker = document.createTreeWalker(scratch, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const at = text.data.indexOf(quote);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + quote.length);
    const anchor = selectionToAnchor(map, range, color);
    if (anchor) return anchor;
  }
  throw new Error(`makeAnchor: không neo được ${JSON.stringify(quote)}`);
}

/**
 * Task 7, Pha 3: `useAnnotations` (the ONE instance `<Reader>` below owns)
 * reads/writes the server through `GET/POST /annotations` and
 * `PATCH/DELETE /annotations/:id` now, not Dexie — the same shift
 * `reader/ChapterView.test.tsx` already made. `annotationRows` stands in for
 * the backend the same way that file's own array does; `patchCount` is this
 * file's own witness for "was `updateNote` ever sent", since there is no
 * `db.outbox` any more to count.
 *
 * `rowOwners`/`currentAccountId` exist because this file's whole subject is
 * TWO ACCOUNTS, and a real `GET /annotations` (and every write endpoint) is
 * scoped server-side to whoever the session cookie names — B's request never
 * even reaches A's rows, no matter when it lands. `db.annotations` (the
 * pre-Task-7 local store this replaces) had no such scoping of its own; the
 * OLD version of this file's guarantee came entirely from `clearLocalData()`
 * emptying the ONE shared local table on logout, with nothing left for a
 * next account to inherit — including, incidentally, whatever the departing
 * reader's own in-flight write was about to land. Post-Task-7, annotations
 * are never cached locally at all, and a write dispatched a moment before a
 * crash is a REAL in-flight `fetch` with no local table left to wipe out
 * from under it — so the account boundary this file exists to test has moved
 * to the SERVER, same as production, and the mock has to enforce it there or
 * a stray write from a session that has already ended could still land and
 * (worse) a test asserting "B never sees A's note" would only be passing by
 * accident (both accounts sharing one course/chapter id in this fixture,
 * with nothing here otherwise telling them apart). Defaults to `'u-a'`
 * because every `seedNote` in this file seeds AS A, and A is always the
 * first account in every scenario; `setMe`/`bSignsIn` are the two places it
 * changes.
 */
let annotationRows: Ann[];
let rowOwners: Map<string, string>;
let currentAccountId: string;
let patchCount: number;

/** The one place `/me` is configured — every `server.use(http.get('/me', ...))`
 * in the old version of this file is now this call, so `currentAccountId`
 * can never drift out of step with what `/me` actually answers. */
function setMe(user: { id: string; email: string; name: string } | null): void {
  if (user) currentAccountId = user.id;
  server.use(
    user
      ? http.get('/me', () => HttpResponse.json(user))
      : http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })),
  );
}

/** Upserts by `id`, matching Dexie's `put` semantics the pre-Task-7 version
 * of this function relied on — some tests call this TWICE with the SAME id
 * (once for A, once for "B's own sync brings the same chapter's row down"
 * under the SAME id — the whole point of that scenario), and a plain `push`
 * would leave two rows with one id in `annotationRows`. Owned by whoever is
 * CURRENT when it is seeded, not a fixed account: every call in this file
 * happens to run before any `setMe`/`bSignsIn` (so it is A's, matching
 * `currentAccountId`'s own default) EXCEPT the one deliberate re-seed after
 * B has signed in, which is exactly how that row becomes B's own. */
function seedNote(id: string, note: string): Ann {
  const row: Ann = {
    id,
    courseId: 'c1',
    chapterId: 'ch1',
    anchor: makeAnchor(PROSE, QUOTE),
    note,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
  };
  const idx = annotationRows.findIndex((r) => r.id === id);
  if (idx === -1) annotationRows.push(row);
  else annotationRows[idx] = row;
  rowOwners.set(id, currentAccountId);
  return row;
}

/** Stands in for `ChapterView`: owns the element React never gives children to, holds the one `useAnnotations` instance, and mounts the cards where the rail portal would. */
function Reader() {
  const ref = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<ChapterContent>({ root: null, revision: 0 });
  const [focus, setFocus] = useState<CardFocus | null>(null);
  const store = useAnnotations('c1', 'ch1', content);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = PROSE;
    setContent((prev) => ({ root: el, revision: prev.revision + 1 }));
  }, []);

  return (
    <>
      <div ref={ref} data-testid="chapter" />
      {/* The witness every wait here uses: a painted `<mark>` is not the same event as the store publishing `list`, and the cards are built from `list`. */}
      <output data-testid="published">{store.list.length}</output>
      <aside data-testid="rail">
        <MarginCards content={content} store={store} visible focus={focus} onFocusChange={setFocus} />
      </aside>
    </>
  );
}

function LogoutButton() {
  const logout = useLogout();
  return (
    <button
      type="button"
      onClick={() => {
        void logout();
      }}
    >
      Đăng xuất
    </button>
  );
}

/**
 * `<Login>`, plus a sample of what was in `localStorage` the FIRST time the
 * sign-in screen rendered.
 *
 * Same idea as `Login.test.tsx`'s `SyncLifecycleProbe`, and for the same
 * reason: "the browser is clean once the dust settles" would also pass for
 * a fix that cleaned up late, by accident. This route's render phase runs
 * strictly after `useLogout`'s `await clearLocalData()` and strictly before
 * the departing reader's unmount flush — so a sample taken here is a sample
 * of what the truth point itself left behind, with nothing else's timing
 * mixed in.
 */
function LoginRoute({ onArrive }: { onArrive: (draft: string | null) => void }) {
  // A `useState` initializer runs exactly once, during the FIRST render of
  // this route, which is precisely the instant being sampled.
  useState(() => {
    onArrive(window.localStorage.getItem(DRAFT_KEY));
    return null;
  });
  return <Login />;
}

/** The browser: the reader at `/`, the sign-in page at `/login`, one query cache — the two routes an account handover actually passes through. */
function Browser({
  at = '/',
  onArriveAtLogin = () => {},
  onQueryClient = () => {},
}: {
  at?: string;
  onArriveAtLogin?: (draft: string | null) => void;
  onQueryClient?: (client: QueryClient) => void;
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  onQueryClient(queryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider><LanguageProvider><MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <Reader />
                <LogoutButton />
              </>
            }
          />
          <Route path="/login" element={<LoginRoute onArrive={onArriveAtLogin} />} />
        </Routes>
      </MemoryRouter></LanguageProvider></ThemeProvider>
    </QueryClientProvider>
  );
}

/**
 * The same browser, but with the real route guard in front of the reader —
 * which is what a COLD page load actually goes through, and what Task 7b
 * changed. `<Browser>` above mounts `<Reader/>` directly because its
 * subject is the note draft; this one's subject is the guard's new
 * offline branch, so the guard has to be in the tree.
 *
 * A fresh `QueryClient` per render is the point, not a detail: it is what
 * makes a second `render(...)` a COLD LOAD rather than a re-render. Nothing
 * of the previous session's in-memory cache survives it, so everything the
 * guard decides has to come from the durable stores — exactly as after F5.
 */
function GuardedBrowser({ at = '/' }: { at?: string }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider><LanguageProvider><MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route
            path="/"
            element={
              <RequireAuth>
                <Reader />
                <LogoutButton />
              </RequireAuth>
            }
          />
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter></LanguageProvider></ThemeProvider>
    </QueryClientProvider>
  );
}

const server = setupServer(
  // Nobody is signed in, by default — this is how the app says that (see api/useMe.ts).
  http.get('/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })),
  // `useLogout` runs the REAL engine's best-effort final flush before it
  // clears anything. These are the three endpoints one cycle can touch.
  http.post('/sync', () => HttpResponse.json({ applied: 0 })),
  http.get('/sync', () => HttpResponse.json({ progress: [], annotations: [], cursor: 'c0' })),
  http.post('/events/batch', () => HttpResponse.json({ accepted: 0 })),
  http.post('/auth/logout', () => new HttpResponse(null, { status: 200 })),
  // Tied to the ACTUAL request resolving, not to `bSignsIn`'s own timing —
  // the moment a real backend would start scoping requests to B's session.
  http.post('/auth/login', () => {
    currentAccountId = 'u-b';
    return HttpResponse.json({ id: 'u-b', email: 'b@example.com', name: 'B' });
  }),
  http.get('/annotations', ({ request }) => {
    const course = new URL(request.url).searchParams.get('course');
    const rows = annotationRows.filter(
      (r) => (course === null || r.courseId === course) && rowOwners.get(r.id) === currentAccountId,
    );
    return HttpResponse.json({ annotations: rows });
  }),
  http.post('/annotations', async ({ request }) => {
    const body = (await request.json()) as { id: string; courseId: string; chapterId: string; anchor: unknown; note: string };
    const at = new Date().toISOString();
    annotationRows.push({ ...body, createdAt: at, updatedAt: at });
    // Real backend: a row belongs to whoever's session created it.
    rowOwners.set(body.id, currentAccountId);
    return new HttpResponse(null, { status: 201 });
  }),
  // A real backend never applies a write to a row it does not consider
  // CURRENTLY yours — the same ownership check `GET` makes. Without it, a
  // write dispatched by A a moment before a crash (this file's `aPageDies`)
  // and only actually delivered to the mock later — after B has signed in on
  // the same browser — would silently land on the SAME id under B's account,
  // exactly the cross-account write the whole file exists to rule out.
  http.patch('/annotations/:id', async ({ request, params }) => {
    const id = String(params.id);
    const patch = (await request.json()) as { note?: string; anchor?: unknown };
    if (rowOwners.get(id) !== currentAccountId) return new HttpResponse(null, { status: 404 });
    patchCount += 1;
    const idx = annotationRows.findIndex((r) => r.id === id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    annotationRows[idx] = { ...annotationRows[idx], ...patch, updatedAt: new Date().toISOString() };
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete('/annotations/:id', ({ params }) => {
    const id = String(params.id);
    annotationRows = annotationRows.filter((r) => r.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(async () => {
  await clearLocalData();
  window.localStorage.clear();
  document.body.innerHTML = '';
  setViewportWidth(WIDE);
  annotationRows = [];
  rowOwners = new Map();
  currentAccountId = 'u-a';
  patchCount = 0;
});

afterEach(async () => {
  await clearLocalData();
  window.localStorage.clear();
  setViewportWidth(1024);
});

function cardFor(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-ann-card="${id}"]`);
  if (!el) throw new Error(`không có thẻ cho ghi chú ${id}`);
  return el;
}

async function waitForCards(count: number): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('published')).toHaveTextContent(String(count)));
  await waitFor(() => expect(document.querySelectorAll('[data-ann-card]')).toHaveLength(count));
}

/**
 * A types into the card for `id` and does not close it. Returns once the
 * real editor has stamped the draft — asserted, not assumed, so a later
 * failure can never be "the premise never happened".
 */
async function aTypesAPrivateNote(id: string): Promise<void> {
  await waitForCards(1);
  fireEvent.click(within(cardFor(id)).getByRole('button', { name: /Entropy/ }));
  const box = await screen.findByRole('textbox', { name: /ghi chú/i });
  fireEvent.change(box, { target: { value: A_PRIVATE } });
  expect(JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? 'null')).toEqual({ id, text: A_PRIVATE });
}

/**
 * A's page goes away the way `DRAFT_KEY` was built for — F5, Cmd+W, a
 * crash, a phone killing the tab — with the draft never written through.
 *
 * jsdom cannot kill a process, and unmounting a React tree runs the
 * orderly flush a killed tab never gets (which clears the stash on the way
 * out). So: let that flush finish, so nothing of it can fire late, then put
 * back EXACTLY the bytes the real editor wrote a moment ago — never a
 * hand-written literal. Surviving that is the entire property a synchronous
 * `localStorage` write has and an IndexedDB transaction does not.
 */
async function aPageDies(): Promise<void> {
  const survivesTheCrash = window.localStorage.getItem(DRAFT_KEY);
  expect(survivesTheCrash).not.toBeNull();
  cleanup();
  await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull());
  window.localStorage.setItem(DRAFT_KEY, survivesTheCrash!);
}

/** B fills in the real sign-in form and submits it. */
async function bSignsIn(): Promise<void> {
  const user = userEvent.setup();
  await screen.findByLabelText(/email/i);
  await user.type(screen.getByLabelText(/email/i), 'b@example.com');
  await user.type(screen.getByLabelText(/^mật khẩu$/i), 'secret123');
  await user.click(screen.getByRole('button', { name: /đăng nhập/i }));
}

/** Everything of A's that this browser could still be holding, in one place. */
async function whatIsLeftInTheBrowser(): Promise<{ tables: number[]; draft: string | null; theme: string | null }> {
  return {
    tables: await Promise.all(db.tables.map((t) => t.count())),
    draft: window.localStorage.getItem(DRAFT_KEY),
    theme: window.localStorage.getItem(THEME_KEY),
  };
}

describe('one browser, two accounts — the note draft is the departing user’s words', () => {
  it('logging out: A is typing when they sign out, and nothing of what they typed is left for B', async () => {
    // A device preference, not content: A set the app to dark. It must
    // SURVIVE — changing account is not a request to change the lighting.
    window.localStorage.setItem(THEME_KEY, 'dark');
    const row = await seedNote('11111111-1111-4111-8111-111111111111', '');

    let draftWhenTheBrowserWasDeclaredClean: string | null | undefined;
    render(<Browser onArriveAtLogin={(draft) => (draftWhenTheBrowserWasDeclaredClean = draft)} />);
    await aTypesAPrivateNote(row.id);

    // The real hook: stopSync → best-effort flush → POST /auth/logout →
    // clearLocalData → /login. The card is STILL OPEN while all of that
    // runs, which is exactly why the draft is still stashed at the moment
    // the browser is declared clean.
    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument(), { timeout: 10_000 });

    // Sampled by `LoginRoute` — after `clearLocalData()`, before the
    // departing reader's unmount flush. Asserting only the end state would
    // let a LATER, incidental cleanup stand in for the fix: the departing
    // editor's own flush does clear the stash on its way out, but only
    // when the row it is writing still exists and only whenever its
    // promise happens to settle. That is luck, not a guarantee, and this
    // is the line that tells the two apart.
    expect(draftWhenTheBrowserWasDeclaredClean).toBeNull();

    await bSignsIn();
    await waitFor(() => expect(screen.getByTestId('chapter')).toBeInTheDocument());

    const left = await whatIsLeftInTheBrowser();
    expect(left.tables).toEqual(db.tables.map(() => 0));
    expect(left.draft).toBeNull();
    expect(left.theme).toBe('dark');

    // And nothing A wrote is on B's screen, by the plainest test there is.
    expect(document.body.textContent ?? '').not.toContain(A_PRIVATE);
  }, 20_000);

  it('signing in over a dead session: A never logged out, and B still starts clean', async () => {
    window.localStorage.setItem(THEME_KEY, 'dark');
    const row = await seedNote('22222222-2222-4222-8222-222222222222', '');

    render(<Browser />);
    await aTypesAPrivateNote(row.id);
    await aPageDies();

    // Days later: A's 30-day cookie has expired, so B simply signs in.
    // No in-app logout anywhere in this scenario — `<Login>` is the only
    // thing standing between A's leftovers and B's session.
    render(<Browser at="/login" />);
    await bSignsIn();
    await waitFor(() => expect(screen.getByTestId('chapter')).toBeInTheDocument());

    const left = await whatIsLeftInTheBrowser();
    expect(left.tables).toEqual(db.tables.map(() => 0));
    expect(left.draft).toBeNull();
    expect(left.theme).toBe('dark');
    expect(document.body.textContent ?? '').not.toContain(A_PRIVATE);
  }, 20_000);

  it("B's own note for that chapter does not inherit A's words, and does not queue them into B's account", async () => {
    // The one way a stranded draft becomes VISIBLE rather than merely
    // retained: `MarginCards`'s recovery effect adopts a stash whose id
    // matches a row on screen (see its own doc comment — that is the half
    // of DRAFT_KEY that puts a rescued draft back into the note).
    //
    // Ids are `crypto.randomUUID()`, so a real collision between two
    // accounts is not a thing that happens; it is arranged here because
    // the assertion worth making is that the ADOPTION PATH is dead, not
    // that the lottery is hard to win. A fix that merely made the leak
    // unlikely would still pass a test built on luck; this one cannot.
    const sharedId = '33333333-3333-4333-8333-333333333333';
    await seedNote(sharedId, '');

    render(<Browser />);
    await aTypesAPrivateNote(sharedId);
    await aPageDies();

    let bsQueryClient: QueryClient | undefined;
    render(<Browser at="/login" onQueryClient={(client) => (bsQueryClient = client)} />);
    await bSignsIn();
    await waitFor(() => expect(screen.getByTestId('chapter')).toBeInTheDocument());
    // `patchCount` so far is A's OWN legitimate flush-on-unmount from
    // `aPageDies()` (saving A's own note, nothing to do with adoption) —
    // reset it here so the assertion below is scoped to what happens in B's
    // session, which is the only thing this test is about.
    patchCount = 0;

    // B's own sync brings down B's own note for the same chapter, into the
    // reader B already has open — the moment the recovery effect looks for
    // a row to give the stashed draft to. `seedNote` is a plain mutation of
    // the mock's own array, not a real `POST`/`PATCH` — so, unlike Dexie's
    // `liveQuery` (reactive to any local write), the already-mounted
    // `useQuery` has no trigger of its own to notice it: `invalidateQueries`
    // is what a real sync cycle would call once it had written the row, and
    // is the most direct stand-in available here.
    await seedNote(sharedId, '');
    await act(async () => {
      await bsQueryClient!.invalidateQueries({ queryKey: annotationsQueryKey('c1') });
    });
    await waitForCards(1);
    // The effect is keyed on `list`; give it a turn of the loop to fire.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(annotationRows.find((r) => r.id === sharedId)?.note).toBe('');
    expect(within(cardFor(sharedId)).queryByText(A_PRIVATE)).toBeNull();
    // The sharper harm: adoption goes through `updateNote`, which would have
    // sent a `PATCH /annotations/:id` — A's words would be POSTed into B's
    // server account under B's cookie on the next cycle.
    expect(patchCount).toBe(0);
  }, 20_000);
});

/* ====================================================================== *
 * Task 7b — the same handover, with the network down on the far side
 * ====================================================================== */

const A = { id: 'u-a', email: 'a@example.com', name: 'A' };
const B = { id: 'u-b', email: 'b@example.com', name: 'B' };

/** `GET /me` never reaches a server: `fetch` rejects with a bare TypeError, no status, no body. */
const NETWORK_IS_DOWN = http.get('/me', () => HttpResponse.error());

/** A cold load: nothing of the previous tree, nothing of its query cache. */
function coldLoad(at = '/'): void {
  cleanup();
  render(<GuardedBrowser at={at} />);
}

/**
 * Task 7b lets `<RequireAuth>` render a protected page when `GET /me` never
 * reached a server. That is a decision about AUTHENTICATION, and this is
 * where it has to be paid for: the one thing it may never do is put A's
 * words in front of B.
 *
 * The property being tested is not "the guard is strict" — a guard that
 * refused everything would pass a negative test and break the feature. It
 * is that the offline render is driven by THIS BROWSER'S CURRENT local
 * session: whatever `clearLocalData()` last left behind, and nothing older.
 * So both directions are here, and the positive one runs first, because a
 * negative result means nothing until the setup is known to work.
 */
describe('one browser, two accounts — reading offline must never open the previous account’s reader', () => {
  it('positive control: A’s own device, A’s own session, network dead — A reads their own note', async () => {
    setMe(A);
    const row = await seedNote('44444444-4444-4444-8444-444444444444', A_PRIVATE);

    render(<GuardedBrowser />);
    await waitForCards(1);
    expect(within(cardFor(row.id)).getByText(A_PRIVATE)).toBeInTheDocument();

    // The plane takes off.
    server.use(NETWORK_IS_DOWN);
    coldLoad();

    // Before Task 7b this was the sign-in screen — the bug this whole task
    // exists for, measured in a real browser in task-7-report.md §5.5.
    await waitForCards(1);
    expect(within(cardFor(row.id)).getByText(A_PRIVATE)).toBeInTheDocument();
  }, 20_000);

  it('A signs out, then the network dies: a cold load shows the outage, not A’s reader', async () => {
    setMe(A);
    await seedNote('55555555-5555-4555-8555-555555555555', A_PRIVATE);

    render(<GuardedBrowser />);
    await waitForCards(1);

    // The real hook — and the real `clearLocalData()` inside it, which takes
    // the offline marker with it because the marker is a `db.meta` row and
    // that function empties `db.tables`. Nothing was written for it.
    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument(), { timeout: 10_000 });

    server.use(NETWORK_IS_DOWN);
    coldLoad();

    expect(await screen.findByText(/kết nối/i)).toBeInTheDocument();
    expect(screen.queryByTestId('chapter')).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain(A_PRIVATE);
  }, 20_000);

  it('B signs in on A’s browser, then the network dies: B reads B’s empty library, never A’s note', async () => {
    // The full handover, and the one that matters: the offline door is OPEN
    // for B (B has a live local session, so the feature works for them) and
    // what is behind it is B's own empty local database.
    setMe(A);
    await seedNote('66666666-6666-4666-8666-666666666666', A_PRIVATE);

    render(<GuardedBrowser />);
    await waitForCards(1);

    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument(), { timeout: 10_000 });

    setMe(B);
    await bSignsIn();
    await waitFor(() => expect(screen.getByTestId('chapter')).toBeInTheDocument());

    server.use(NETWORK_IS_DOWN);
    coldLoad();

    // The guard opened — B is not punished for A having been here.
    await waitFor(() => expect(screen.getByTestId('chapter')).toBeInTheDocument());
    expect(screen.queryByText(/kết nối/i)).not.toBeInTheDocument();
    // And it opened onto B's own browser state, which holds nothing of A's.
    await waitForCards(0);
    expect(document.body.textContent ?? '').not.toContain(A_PRIVATE);
    expect(await db.annotations.count()).toBe(0);
  }, 20_000);

  it('A never logged out, but the server says 401: the answer wins over the marker, offline branch or not', async () => {
    // The bound on how long a device may stand in for the server: not a
    // timer, the first HTTP response that arrives. A dead cookie plus a
    // live network is a closed door on the very next load.
    setMe(A);
    await seedNote('77777777-7777-4777-8777-777777777777', A_PRIVATE);

    render(<GuardedBrowser />);
    await waitForCards(1);

    setMe(null);
    coldLoad();

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
    expect(screen.queryByTestId('chapter')).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain(A_PRIVATE);
  }, 20_000);
});
