import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, afterAll, afterEach, beforeAll } from 'vitest';
import type { Ann } from '../api/annotations';
import { meQueryKey, type Me } from '../api/useMe';
import { t } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { ThemeProvider } from '../theme/ThemeContext';
import { Settings } from './Settings';

const SIGNED_IN: Me = { id: 'u1', email: 'hoc@vidu.vn', name: 'Người học' };

/**
 * `AiSection` (`Settings.tsx`) nay gắn `CreditPanel`/`AgentConfigPanel` — cả
 * hai tự `GET /ai/credits`/`GET /ai/config` lúc gắn. Mỗi bài dựng `<Settings/>`
 * đều chạm chúng, nên msw cần một handler MẶC ĐỊNH lành mạnh cho cả hai —
 * chi tiết BÊN TRONG hai panel ấy (số dư, sổ dùng, trần rune, PUT…) có bộ
 * kiểm RIÊNG (`ai/CreditPanel.test.tsx`, `ai/AgentConfigPanel.test.tsx`);
 * tệp này chỉ còn phải canh rằng CẢ HAI có mặt đúng chỗ trên trang.
 */
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const DEFAULT_CREDITS = { balance_micro: 1_000_000, recent_usage: [] };
const DEFAULT_CONFIG = {
  system_prompt: '',
  tools_enabled: [],
  available_tools: ['read_course', 'web_search'],
  max_system_prompt_chars: 4000,
};

function mockAiRoutes(): void {
  server.use(
    http.get('/ai/credits', () => HttpResponse.json(DEFAULT_CREDITS)),
    http.get('/ai/config', () => HttpResponse.json(DEFAULT_CONFIG)),
  );
}

/**
 * Task 9: `LocalDataSection` (mục "Dữ liệu trên máy") nay đếm ghi chú qua
 * `GET /annotations` — mọi bài dựng `<Settings/>` chạm khối này, nên `msw`
 * cần một handler mặc định lành mạnh, cùng khuôn `mockAiRoutes` ở trên.
 * `renderSettings`'s `annotations` param (mặc định `[]`) đi thẳng vào đây,
 * chứ không phải một lời gọi `mockLocalDataRoutes` rời sau đó — hai lệnh
 * `server.use(...)` liên tiếp cho CÙNG một path thì cái sau thắng, nên gọi
 * rời sẽ lặng lẽ ghi đè danh sách bài kiểm vừa yêu cầu bằng `[]` của
 * `renderSettings`. Bài canh riêng ở `describe` cuối tệp truyền một danh
 * sách khác qua tham số này để phân biệt "đọc /annotations" với "đọc
 * db.annotations.count() cục bộ".
 */
function mockLocalDataRoutes(annotations: readonly Ann[] = []): void {
  server.use(http.get('/annotations', () => HttpResponse.json({ annotations })));
}

/**
 * `state` mặc định là `FROM_AI_INVITE` — ý định mà lời mời "Mở trang cấu hình"
 * của `ai/AskPanel.tsx` gắn vào lần điều hướng khi hết credit
 * (`needsSetup`/`ai.panel.noCredit`) — vì gần như mọi bài dưới đây kiểm mục
 * Trợ lý AI, tức chúng mô tả người dùng đến TỪ lời mời ấy. Ý định thứ hai mà
 * `state` từng mang — "mở sẵn khung kho khoá ra" — KHÔNG còn: `AskPanel.tsx`
 * (Task 13) đã ngừng gửi nó, và Task 16 đã gỡ chính cái khung ấy, nên chỉ
 * `section: 'ai'` (cuộn tới khối) còn sống. Vào
 * `/settings` mà KHÔNG mang ý định là một hợp đồng khác hẳn, và nó có describe
 * riêng ở cuối tệp: mục trung tính, không cuộn.
 */
const FROM_AI_INVITE = { section: 'ai' } as const;

function renderSettings(me: Me | null = SIGNED_IN, state: unknown = FROM_AI_INVITE, annotations: readonly Ann[] = []) {
  mockAiRoutes();
  mockLocalDataRoutes(annotations);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(meQueryKey, me);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/settings', state }]}>
        <LanguageProvider>
          <ThemeProvider>
            <Settings />
          </ThemeProvider>
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Tiêu đề của một khối trên trang Cài đặt. Trang nay là MỘT trang, nên mọi
 *  khối đều có mặt cùng lúc và không phải bấm gì để tới. */
function blockHeading(name: string): HTMLElement {
  return screen.getByRole('heading', { name });
}

/**
 * `LanguageProvider` và `useTheme` đều CẤT lựa chọn vào `localStorage`, và
 * `useTheme` còn viết vào `<html data-theme>`. Một bài đổi giao diện sẽ để lại
 * giao diện tối cho bài chạy sau nó: một bộ test phụ thuộc thứ tự là một bộ
 * test nói dối ở đúng lúc nó được tin nhất.
 */
beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 * TRỢ LÝ AI — Pha 2: credit + cấu hình agent, KHÔNG còn ô dán key nào
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Mục Trợ lý AI của trang Cài đặt — Pha 2', () => {
  /**
   * BÀI KIỂM TRUNG TÂM CỦA TASK NÀY, và lý do nó được viết trước mọi thứ khác.
   *
   * Pha 1: ô dán key BẮT BUỘC nằm trong khung của kho khoá, một origin riêng —
   * một ô trên trang chính đi qua DOM của trang chính, và một course độc đọc
   * được nó bằng đúng một listener `input`. Pha 2 xoá bỏ chính cái CẦN bảo vệ
   * (không còn key nào của người học — DeepSeek chạy bằng key CỦA NỀN TẢNG,
   * xem `pages/Settings.tsx`'s doc comment đầu tệp), nên ràng buộc đổi THEO,
   * không phải biến mất: KHÔNG `<input>`, KHÔNG `[contenteditable]` (không gì
   * trên trang này còn là một hạng cần chúng), và ĐÚNG MỘT `<textarea>` — ô
   * sửa lời nhắc riêng của `AgentConfigPanel`, thứ không phải bí mật.
   */
  it('KHÔNG có <input>/[contenteditable] nào — và ĐÚNG MỘT <textarea> (lời nhắc riêng, không phải key)', async () => {
    const { container } = renderSettings();

    // Chốt chống-vacuous: bốn khối phải tự chứng minh chúng có mặt trước khi
    // lời khẳng định về số lượng ô nhập có nghĩa.
    for (const name of [
      t('vi', 'settings.section.account'),
      t('vi', 'settings.section.appearance'),
      t('vi', 'settings.ai.title'),
      t('vi', 'settings.section.localData'),
    ]) {
      expect(await screen.findByRole('heading', { name }), name).toBeInTheDocument();
    }
    // `AgentConfigPanel` chỉ vẽ form SAU khi `GET /ai/config` trả lời — chờ
    // đúng phần tử ấy trước khi đếm.
    await screen.findByLabelText(t('vi', 'settings.ai.promptLabel'));

    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('[contenteditable]')).toHaveLength(0);
    expect(container.querySelectorAll('textarea')).toHaveLength(1);
  });

  it('có render thật — tiêu đề và câu giải thích đều có mặt, không còn nhắc "key"/"kho khoá"', async () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: t('vi', 'settings.ai.title') })).toBeInTheDocument();
    expect(await screen.findByText(t('vi', 'settings.ai.blurb'))).toBeInTheDocument();
  });

  /**
   * BẢO VỆ CHỐNG TÁI PHẠM — cùng khuôn `Settings.copy.test.tsx`'s chốt chống
   * "gói đã tải": quét NGUYÊN VĂN `document.body.textContent`, không so khớp
   * một khoá cụ thể, nên nó vẫn đỏ nếu lời hứa Pha 1 quay lại qua BẤT KỲ khoá
   * nào khác, kể cả một khoá mới không ai đặt tên trước.
   */
  it('KHÔNG còn chữ "kho khoá" hay "key của chính bạn" ở bất cứ đâu trên trang', async () => {
    renderSettings();
    await screen.findByLabelText(t('vi', 'settings.ai.promptLabel'));

    const rendered = document.body.textContent ?? '';
    expect(rendered).not.toContain('kho khoá');
    expect(rendered).not.toContain('key của chính bạn');
  });

  it('gắn CreditPanel — số dư credit có mặt trong mục Trợ lý AI', async () => {
    renderSettings();
    expect(await screen.findByText(t('vi', 'settings.ai.creditBalanceLabel'))).toBeInTheDocument();
  });

  it('gắn AgentConfigPanel — ô sửa lời nhắc riêng và danh sách tool có mặt', async () => {
    renderSettings();
    expect(await screen.findByLabelText(t('vi', 'settings.ai.promptLabel'))).toBeInTheDocument();
    expect(await screen.findByTestId('agent-tool-read_course')).toBeInTheDocument();
    expect(screen.getByTestId('agent-tool-web_search')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 * THỨ BẬC MỚI — `/settings` LÀ "CÀI ĐẶT", TRỢ LÝ AI LÀ MỘT MỤC BÊN TRONG
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('/settings là CÀI ĐẶT, không phải trang Trợ lý AI', () => {
  /**
   * Bốn mục được gọi ĐÍCH DANH, không đếm.
   *
   * Cùng lập luận mà `db/local.test.ts` dùng để liệt kê năm bảng Dexie theo tên
   * thay vì đếm chúng: một `toHaveLength(4)` vẫn xanh khi ai đó thêm một mục và
   * xoá một mục khác trong cùng một commit. Danh sách này là hợp đồng thứ bậc
   * của đặc tả IA, nên nó phải đọc được như một hợp đồng.
   */
  it('trang có đủ năm khối, đúng tên và đúng thứ tự', () => {
    const { container } = renderSettings();

    // Thứ tự đọc được từ DOM, không từ một danh sách hằng: đây là hợp đồng thứ
    // bậc của đặc tả IA, và nó phải đúng với thứ người dùng thấy khi cuộn.
    expect(
      Array.from(container.querySelectorAll('.set-block h2')).map((h) => h.textContent),
    ).toEqual([
      t('vi', 'settings.section.account'),
      t('vi', 'settings.section.appearance'),
      t('vi', 'settings.ai.title'),
      t('vi', 'settings.section.localData'),
      t('vi', 'settings.legal.title'),
    ]);
  });

  /**
   * "Chung" GỘP hai mục cũ, và bài này là thứ chứng minh phép gộp không đánh
   * rơi cái nào. Không có nó, một bản xoá nhầm `<AppearanceSection/>` khỏi
   * nhánh `general` vẫn xanh: danh sách tab ở bài trên chỉ đếm tab.
   */
  it('tài khoản và ngôn ngữ & giao diện ở CÙNG một trang, không phải hai nơi', () => {
    renderSettings();
    expect(blockHeading(t('vi', 'settings.section.account'))).toBeInTheDocument();
    expect(blockHeading(t('vi', 'settings.section.appearance'))).toBeInTheDocument();
  });

  it('tên trang là "Cài đặt" — cùng chữ với mục ở đáy thanh bên', () => {
    renderSettings();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(t('vi', 'account.settings'));
  });

  /**
   * Lối vào từ lời mời AI (`state={{ section: 'ai' }}`) không ĐỔI thứ hiện ra
   * — trang chỉ có một, và mọi khối đều ở trên đó. Điều nó phải giữ: người bấm
   * "Mở trang cấu hình" từ panel hỏi-đáp (hết credit) tới nơi và thấy khối Trợ
   * lý AI, không qua một cú bấm chọn mục nào nữa.
   */
  it('lối vào từ lời mời AI: khối Trợ lý AI có mặt ngay, không qua một cú bấm nào', async () => {
    renderSettings();
    expect(blockHeading(t('vi', 'settings.ai.title'))).toBeInTheDocument();
    expect(await screen.findByText(t('vi', 'settings.ai.blurb'))).toBeInTheDocument();
  });

  /**
   * Và nó KHÔNG giấu ba khối kia đi. Bản có tab làm đúng thế — vào bằng lời mời
   * AI thì chỉ thấy mục AI — nên bài này là thứ chặn một lần "khôi phục" vô ý
   * quay lại hành vi ấy.
   */
  it('lối vào ấy vẫn để ba khối kia trên trang', () => {
    renderSettings();
    expect(blockHeading(t('vi', 'settings.section.account'))).toBeInTheDocument();
    expect(blockHeading(t('vi', 'settings.section.appearance'))).toBeInTheDocument();
    expect(blockHeading(t('vi', 'settings.section.localData'))).toBeInTheDocument();
  });

  it('mục Tài khoản nói ra ai đang đăng nhập', () => {
    renderSettings();

    expect(screen.getByTestId('account-identity')).toHaveTextContent(
      t('vi', 'settings.account.signedInAs', SIGNED_IN.name, SIGNED_IN.email),
    );
  });

  /**
   * Bộ chọn ngôn ngữ ở đây KHÔNG được mang `id="lang-select"`.
   *
   * Id ấy thuộc về `i18n/LanguageSwitcher.tsx` trên thanh công cụ. Hai phần tử
   * cùng một id là một lỗi mà DOM không báo: `document.getElementById` trả về
   * phần tử ĐẦU TIÊN và không bao giờ nói rằng có hai — nên bất cứ ai định vị
   * bộ chọn trên thanh công cụ bằng id (mã, bài kiểm, hay một kịch bản e2e)
   * sẽ lặng lẽ chọn nhầm cái nằm trong trang Cài đặt.
   */
  it('bộ chọn ngôn ngữ trong Cài đặt KHÔNG chiếm id của bộ chọn trên thanh công cụ', () => {
    const { container } = renderSettings();

    const select = screen.getByLabelText(t('vi', 'settings.appearance.language'));
    expect(select.tagName).toBe('SELECT');
    expect(select.id).not.toBe('lang-select');
    expect(container.querySelectorAll('#lang-select')).toHaveLength(0);
  });

  it('mục Ngôn ngữ & giao diện đổi được giao diện, và nói ra giao diện đang dùng', async () => {
    const user = userEvent.setup();
    renderSettings();

    expect(screen.getByTestId('theme-now')).toHaveTextContent(t('vi', 'settings.appearance.themeNowLight'));

    // MỘT HÀNG CHỌN, không còn là một nút "đổi sang giao diện tối" — bản dựng
    // vẽ hàng chọn, và `role="radio"` là thứ nói ra "hai lựa chọn loại trừ
    // nhau" thay vì "một nút lật". Bài này đi theo hình dạng mới; điều nó đo —
    // đổi được thật, và trang nói ra thứ đang đúng — không đổi.
    const dark = screen.getByRole('radio', { name: t('vi', 'settings.appearance.themeDark') });
    expect(screen.getByRole('radio', { name: t('vi', 'settings.appearance.themeLight') })).toBeChecked();
    await user.click(dark);

    expect(dark).toBeChecked();
    expect(screen.getByTestId('theme-now')).toHaveTextContent(t('vi', 'settings.appearance.themeNowDark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

/**
 * Trợ lý AI là TUỲ CHỌN, và Cài đặt phải cư xử đúng như vậy.
 *
 * Người dùng báo lỗi này bằng một câu ngắn: *"I stuck at this screen, this AI
 * settings should be optional."* — bối cảnh Pha 1, khi `AiSection` từng tự
 * `setExpanded(true)` một lớp phủ TOÀN MÀN HÌNH lúc mount. Pha 2 không còn lớp
 * phủ nào để tự mở (không còn khung), nên bài kiểm này thu hẹp lại đúng phần
 * còn sống được: THỨ TỰ — khối đầu tiên người dùng gặp phải là Tài khoản,
 * không phải một khối cấu hình AI nào bị đẩy lên trước nó.
 */
describe('vào Cài đặt KHÔNG qua lời mời AI', () => {
  it('mở ra là thấy Tài khoản trước, Trợ lý AI ở phía dưới', () => {
    const { container } = renderSettings(SIGNED_IN, null);

    const headings = Array.from(container.querySelectorAll('.set-block h2')).map((h) => h.textContent);
    expect(headings[0]).toBe(t('vi', 'settings.section.account'));
    expect(headings.indexOf(t('vi', 'settings.ai.title'))).toBeGreaterThan(0);
  });

  it('ý định bịa từ history.state (mục không tồn tại) không làm trang vỡ — vẫn thấy Tài khoản trước', () => {
    // `history.state` người dùng dựng được bằng history API và nó sống qua
    // back/forward, nên `readIntent` chỉ nhận đúng giá trị đã biết.
    const { container } = renderSettings(SIGNED_IN, { section: 'khong-ton-tai' });

    const headings = Array.from(container.querySelectorAll('.set-block h2')).map((h) => h.textContent);
    expect(headings[0]).toBe(t('vi', 'settings.section.account'));
  });
});

/**
 * CỬA ĐĂNG XUẤT, và vì sao bài này sống ở đây kể từ vòng thiết kế lại.
 *
 * Nút "Đăng xuất" vốn ở đầu Bảng điều khiển, và `test/Dashboard.test.tsx` canh
 * nó ở đó. Bản dựng đã duyệt đưa đầu trang Học tiếp sang lối vào NHẬP GÓI, nên
 * nút ấy về đúng chỗ của nó: mục Tài khoản của `/settings`, đứng cạnh câu cảnh
 * báo về dữ liệu trên máy — thứ một nút trơ trọi ở đầu trang không mang theo
 * được.
 *
 * Bài này canh CỬA: nó có thật, nó bấm được, và nó không đứng một mình. CHUỖI
 * HÀNH VI phía sau (dừng sync, xả outbox, POST /auth/logout, xoá mọi bảng cục
 * bộ, về /login) có bộ canh riêng và kỹ hơn nhiều ở `auth/useLogout.test.tsx`
 * — mười bài. Chép lại chúng ở đây là nuôi hai bản của một sự thật.
 */
describe('Cài đặt — cửa đăng xuất', () => {
  it('mục Tài khoản mang nút Đăng xuất, và nút ấy không đứng trần trụi', async () => {
    // `state: null` chứ không phải mặc định: `renderSettings` mặc định gửi
    // `FROM_AI_INVITE`, thứ cuộn thẳng tới mục Trợ lý AI. Mục mặc định khi tới
    // bằng đường thường mới là Tài khoản — và đó chính là mục bài này hỏi.
    renderSettings(SIGNED_IN, null);

    const button = await screen.findByRole('button', { name: /đăng xuất/i });
    expect(button).toBeEnabled();

    // ĐỐI CHỨNG: câu cảnh báo phải ở cùng màn. Đăng xuất ở đây XOÁ ghi chú và
    // tiến độ trên máy này (xem `auth/useLogout.ts`), và một nút làm điều đó mà
    // không nói ra là một cái bẫy — nhất là trên máy dùng chung.
    expect(screen.getByText(new RegExp(t('vi', 'settings.account.signOutWarning').slice(0, 24), 'i'))).toBeInTheDocument();
  });
});

/**
 * "DỮ LIỆU TRÊN MÁY" KHÔNG CÒN CON SỐ NÀO — và không được có lại.
 *
 * Bản Task 9 của mục này đếm ghi chú từ `GET /annotations` và bài kiểm ở đây
 * từng canh đúng con số ấy. Nhưng một con số MÁY CHỦ đứng dưới tiêu đề "trên
 * máy" là một lời hứa sai theo cách khác: người dùng đọc nó thành "máy này
 * đang giữ 2 ghi chú của tôi", trong khi sau Pha 3 máy này không giữ ghi chú
 * nào. Mục nay chỉ có chữ (xem doc của `LocalDataSection`). Bài dưới đây gieo
 * hai ghi chú ở máy chủ và khẳng định KHÔNG có ô số nào trong mục này — kể cả
 * khi dữ liệu có sẵn để đếm.
 */
function ann(id: string): Ann {
  return {
    id,
    courseId: 'demo',
    chapterId: 'ch-1',
    anchor: { exact: 'x', color: 'y' },
    note: `ghi chú ${id}`,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

describe('Cài đặt — "Dữ liệu trên máy" chỉ có chữ, không con số', () => {
  it('không vẽ ô số nào trong mục, dù máy chủ có ghi chú để đếm', async () => {
    renderSettings(SIGNED_IN, FROM_AI_INVITE, [ann('a'), ann('b')]);

    const heading = await screen.findByRole('heading', { name: t('vi', 'settings.section.localData') });
    const section = heading.closest('section');
    expect(section).not.toBeNull();
    expect(section!.querySelector('.set-stats, .set-stat-v')).toBeNull();
    expect(section).toHaveTextContent(t('vi', 'settings.localData.draft'));
    expect(section).not.toHaveTextContent('2');
  });
});
