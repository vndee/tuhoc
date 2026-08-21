import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { packZip } from '@tuhoc/course-format';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { db } from '../db/local';
import { ImportCourse } from './ImportCourse';

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
afterEach(() => server.resetHandlers());
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
