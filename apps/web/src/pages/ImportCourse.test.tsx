import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { packZip } from '@tuhoc/course-format';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../db/local';
import { ImportCourse } from './ImportCourse';

/**
 * An armed switch that makes `importCourse` THROW instead of resolving.
 *
 * `importCourse` promises it never throws, and this page must not depend on
 * that promise being kept — the version of this file with `try { … } finally`
 * and no `catch` turned one broken promise into a blank screen. The only way
 * to test the page's own net is to break the contract deliberately, so the
 * real module is used everywhere except when a test arms this.
 */
const armed = vi.hoisted(() => ({ throws: null as Error | null }));

vi.mock('./../course/import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../course/import')>();
  return {
    ...actual,
    importCourse: (...args: Parameters<typeof actual.importCourse>) => {
      if (armed.throws) throw armed.throws;
      return actual.importCourse(...args);
    },
  };
});

const COURSE_ID = 'bat-bien-vong-lap';
const encode = (text: string) => new TextEncoder().encode(text);

function manifest(): Record<string, unknown> {
  return {
    id: COURSE_ID,
    title: 'Bất biến vòng lặp',
    description: 'Ba chương về bất biến vòng lặp.',
    lang: 'vi',
    version: '1.0.0',
    runtime: '^1',
    tier: 'content',
    license: 'CC-BY-4.0',
    authors: [{ name: 'tuhoc' }],
    generatedBy: 'ai',
    parts: [
      {
        title: 'Phần I',
        chapters: [{ id: 'c1', num: '1.1', title: 'Chương một', short: 'C1', file: 'chapters/c1.html' }],
      },
    ],
  };
}

function zipBytes(chapterHtml = '<h1 class="ch-title">Chương một</h1>'): Uint8Array {
  return packZip(
    new Map([
      ['manifest.json', encode(JSON.stringify(manifest(), null, 2))],
      ['chapters/c1.html', encode(chapterHtml)],
    ]),
  );
}

function zipFile(bytes: Uint8Array, name = 'khoa-hoc.zip'): File {
  return new File([bytes as BlobPart], name, { type: 'application/zip' });
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  armed.throws = null;
});
afterAll(() => server.close());
beforeEach(() => db.packages.clear());

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/import']}>
        <Routes>
          <Route path="/import" element={<ImportCourse />} />
          <Route path="/c/:courseId" element={<p>trang khóa học</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The `<input type="file">` — it has no accessible role of its own. */
function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('không tìm thấy ô chọn tệp');
  return input;
}

it('nhập một gói từ tệp và mời người dùng mở khóa học ngay', async () => {
  const user = userEvent.setup();
  renderPage();

  await user.upload(fileInput(), zipFile(zipBytes()));

  expect(await screen.findByRole('link', { name: /mở khóa học/i })).toHaveAttribute(
    'href',
    `/c/${COURSE_ID}`,
  );
  expect(await db.packages.count()).toBe(1);
});

it('NÓI RA trên màn hình rằng gói nằm trong một thư mục con, và bao nhiêu tệp bị bỏ lại', async () => {
  // Ruling: re-rooting may stay at the import layer "nhưng phải HIỆN RA cho
  // người dùng… không được im lặng". Measured in review on a real browser
  // with a real `ditto --keepParent` archive: scanning the WHOLE of
  // `document.body.innerText` for the folder name found nothing — the page
  // said only "Đã nhập bat-bien-vong-lap phiên bản 1.0.0".
  const user = userEvent.setup();
  renderPage();

  const nested = new Map<string, Uint8Array>([
    [`${COURSE_ID}/manifest.json`, encode(JSON.stringify(manifest(), null, 2))],
    [`${COURSE_ID}/chapters/c1.html`, encode('<h1 class="ch-title">Chương một</h1>')],
    ['__MACOSX/bat-bien-vong-lap/._manifest.json', new Uint8Array([0x00, 0x05, 0x16, 0x07])],
  ]);
  await user.upload(fileInput(), zipFile(packZip(nested)));

  await screen.findByRole('link', { name: /mở khóa học/i });
  const note = screen.getByText(/gói nằm trong thư mục/i);
  expect(note.textContent).toContain(COURSE_ID);
  expect(note.textContent).toMatch(/1 tệp/);
});

it('nói ra bằng tiếng Việt vì sao gói bị từ chối — không phải mã lỗi', async () => {
  const user = userEvent.setup();
  renderPage();

  await user.upload(fileInput(), zipFile(zipBytes('<h1>a</h1><script>x()</script>')));

  // The claim is not "an error appeared". It is that what appeared is a
  // sentence: `SCRIPT_TAG` on its own is what the CLI prints, and putting it
  // in front of a learner is the failure this test exists to catch.
  const message = await screen.findByText(/thẻ <script>/i);
  expect(message).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('SCRIPT_TAG');
  expect(await db.packages.count()).toBe(0);
});

it('nêu HẾT các vấn đề trong một lần, và nói có bao nhiêu cái', async () => {
  const user = userEvent.setup();
  renderPage();

  const broken = packZip(
    new Map([
      ['manifest.json', encode(JSON.stringify({ ...manifest(), version: 'sai' }))],
      ['chapters/c1.html', encode('<h1>a</h1><script>x()</script>')],
      ['viz.js', encode('console.log(1)')],
    ]),
  );
  await user.upload(fileInput(), zipFile(broken));

  await screen.findByText(/3 vấn đề/i);
  expect(screen.getAllByRole('listitem').length).toBe(3);
});

it('nói RÕ RÀNG ngay trên màn hình rằng chỉ repo công khai mới dán được — trước khi ai đó dán nhầm', async () => {
  renderPage();

  // Not the error message afterwards: the note has to be readable BEFORE
  // anything is pasted, because GitHub's 404 for a private repo and its 404
  // for a typo are the same 404, and a reader who has read this already
  // knows which of the two to check.
  const note = screen.getByText(/token truy cập/i);
  expect(note.textContent).toMatch(/công khai/i);
  expect(note.textContent).toMatch(/riêng tư/i);
  expect(note.textContent).toMatch(/\.zip/i);
});

it('giải thích một repo không mở được, thay vì hiện "404"', async () => {
  server.use(
    http.get('https://api.github.com/repos/ai-do/repo-rieng-tu/git/trees/HEAD', () =>
      HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
    ),
  );
  const user = userEvent.setup();
  renderPage();

  await user.type(screen.getByLabelText(/đường dẫn repo/i), 'https://github.com/ai-do/repo-rieng-tu');
  await user.click(screen.getByRole('button', { name: /nhập từ repo/i }));

  const message = await screen.findByText(/không mở được repo/i);
  expect(message.textContent).toMatch(/công khai/i);
  expect(message.textContent).toMatch(/\.zip/i);
  expect(document.body.textContent).not.toMatch(/\b404\b/);
});

it('hiện trạng thái chờ trong một vùng aria-live, rồi dọn nó đi', async () => {
  // The scan is synchronous and can hold the main thread for about a second
  // on a 20 MB package (measured — see task-8-report.md). A waiting state
  // that is only *set* is not enough; it has to be announced, and it has to
  // go away.
  const user = userEvent.setup();
  renderPage();

  const live = document.querySelector('[role="status"]');
  expect(live).toHaveAttribute('aria-live', 'polite');

  await user.upload(fileInput(), zipFile(zipBytes()));

  await screen.findByRole('link', { name: /mở khóa học/i });
  expect(live?.textContent).not.toMatch(/đang tải|đang kiểm tra/i);
});

it('mạng đứt GIỮA thân phản hồi → nói ra, chứ không trở về trang trống', async () => {
  // The exact failure measured in review, driven through the real page: a
  // server that answers 200 with a correct Content-Length and then stops
  // sending. The page used to show nothing whatsoever — the stage line was
  // cleared by its `finally` and no error was ever set, so the reader saw the
  // button enable itself as though the click had not happened.
  server.use(
    http.get('https://vi-du.test/goi.zip', () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(1024));
          controller.error(new Error('kết nối bị cắt giữa chừng'));
        },
      });
      return new HttpResponse(body);
    }),
  );
  const user = userEvent.setup();
  renderPage();

  await user.type(screen.getByLabelText(/đường dẫn tới tệp \.zip/i), 'https://vi-du.test/goi.zip');
  await user.click(screen.getByRole('button', { name: /nhập từ đường dẫn/i }));

  const message = await screen.findByText(/kết nối đứt giữa chừng/i);
  expect(message).toBeInTheDocument();
  expect(screen.getByText(/không nhập được gói này/i)).toBeInTheDocument();
  expect(await db.packages.count()).toBe(0);
});

it('kể cả khi `importCourse` phá vỡ hợp đồng và NÉM, trang vẫn nói ra điều gì đó', async () => {
  armed.throws = new Error('hợp đồng bị phá: importCourse đã ném');
  const user = userEvent.setup();
  renderPage();

  await user.upload(fileInput(), zipFile(zipBytes()));

  // Not "an error appeared somewhere": the assertion is that the page is not
  // BLANK — the one outcome the missing `catch` produced.
  expect(await screen.findByText(/hợp đồng bị phá: importCourse đã ném/)).toBeInTheDocument();
  expect(screen.getByText(/không nhập được gói này/i)).toBeInTheDocument();
});

it('không để bấm nhập lần hai khi lần một chưa xong', async () => {
  let release: (() => void) | undefined;
  server.use(
    http.get('https://vi-du.test/goi.zip', async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return new HttpResponse(zipBytes() as BlobPart);
    }),
  );
  const user = userEvent.setup();
  renderPage();

  await user.type(screen.getByLabelText(/đường dẫn tới tệp \.zip/i), 'https://vi-du.test/goi.zip');
  await user.click(screen.getByRole('button', { name: /nhập từ đường dẫn/i }));

  await waitFor(() => expect(screen.getByRole('button', { name: /nhập từ đường dẫn/i })).toBeDisabled());
  expect(fileInput()).toBeDisabled();

  release?.();
  await screen.findByRole('link', { name: /mở khóa học/i });
  expect(await db.packages.count()).toBe(1);
});
