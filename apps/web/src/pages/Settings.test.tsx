import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { meQueryKey, type Me } from '../api/useMe';
import { t } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { VaultFrameProvider } from '../shell/VaultFrame';
import { ThemeProvider } from '../theme/ThemeContext';
import { Settings } from './Settings';

const VAULT = 'http://localhost:5174';

const SIGNED_IN: Me = { id: 'u1', email: 'hoc@vidu.vn', name: 'Người học' };

/**
 * `<LanguageProvider>` là BẮT BUỘC từ khi trang này đọc catalog, và nó không
 * phải một chi tiết của harness: `useLanguage()` NÉM ngoài provider, có chủ ý
 * (xem `i18n/LanguageProvider.tsx`). Một mặc định lặng lẽ ở đó sẽ cho ra một
 * trang hai thứ tiếng mà không bài kiểm nào đỏ.
 *
 * Ba provider còn lại tới cùng thứ bậc mới: `/settings` nay có bốn mục, và mục
 * Tài khoản đọc `useMe()`/`useLogout()` (cần QueryClient + Router) còn mục
 * Ngôn ngữ & giao diện đọc `useThemeContext()` (NÉM ngoài `<ThemeProvider>`).
 *
 * `me` được GIEO thẳng vào cache thay vì để `useMe()` đi hỏi máy chủ: với
 * `staleTime: 60_000` một mục đã gieo là mục còn tươi, nên không có `fetch` nào
 * rời khỏi bài kiểm này. Một bài kiểm giao diện đi gọi mạng thật là một bài
 * kiểm hỏng theo lịch của người khác.
 *
 * `state` mặc định là `FROM_AI_INVITE` — ý định mà lời mời "Mở trang cấu hình"
 * của `ai/AskPanel.tsx` gắn vào lần điều hướng — vì gần như mọi bài dưới đây
 * kiểm mục Trợ lý AI, tức chúng mô tả người dùng đến TỪ lời mời ấy. Vào
 * `/settings` mà KHÔNG mang ý định là một hợp đồng khác hẳn, và nó có describe
 * riêng ở cuối tệp: mục trung tính, không lớp phủ.
 */
const FROM_AI_INVITE = { section: 'ai', openVault: true } as const;

function renderSettings(
  origin: string | null = VAULT,
  me: Me | null = SIGNED_IN,
  state: unknown = FROM_AI_INVITE,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(meQueryKey, me);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/settings', state }]}>
        <LanguageProvider>
          <ThemeProvider>
            <VaultFrameProvider origin={origin}>
              <Settings />
            </VaultFrameProvider>
          </ThemeProvider>
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function frames(): HTMLIFrameElement[] {
  return Array.from(document.querySelectorAll('iframe'));
}

/** Tiêu đề của một khối trên trang Cài đặt. Trang nay là MỘT trang, nên mọi
 *  khối đều có mặt cùng lúc và không phải bấm gì để tới. */
function blockHeading(name: string): HTMLElement {
  return screen.getByRole('heading', { name });
}

/**
 * `LanguageProvider` và `useTheme` đều CẤT lựa chọn vào `localStorage`, và
 * `useTheme` còn viết vào `<html data-theme>`. Một bài đổi giao diện sẽ để lại
 * giao diện tối cho bài chạy sau nó — cùng cái bẫy mà `VaultFrame.test.tsx` đã
 * ghi lại: một bộ test phụ thuộc thứ tự là một bộ test nói dối ở đúng lúc nó
 * được tin nhất.
 */
beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('Trang cấu hình AI của TRANG CHÍNH', () => {
  /**
   * BÀI KIỂM TRUNG TÂM CỦA TASK NÀY, và lý do nó được viết trước mọi thứ khác.
   *
   * Ô nhập bí mật PHẢI nằm trong khung của kho khoá, không phải một ô trên
   * trang chính rồi gửi vào. Một ô trên trang chính đi qua DOM của trang chính,
   * và một course độc đọc được nó bằng đúng một listener `input` — tức là toàn
   * bộ kiến trúc hai origin (Task 1–5) trở thành trang trí.
   *
   * Khẳng định mạnh nhất viết được ở phía này là **không có một `<input>` nào**,
   * chứ không phải "không có input nào tên là bí mật": một ô tên `q` vẫn đọc
   * được y hệt. Trang này không có gì để người dùng gõ; nó chỉ giải thích và
   * mở khung ra.
   */
  it('KHÔNG chứa một <input>, <textarea> hay [contenteditable] nào', () => {
    const { container } = renderSettings();
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('textarea')).toHaveLength(0);
    expect(container.querySelectorAll('[contenteditable]')).toHaveLength(0);
  });

  /**
   * BÀI TRÊN, MỞ RỘNG CHO THỨ BẬC MỚI — và nó là bài chịu lực từ lúc `/settings`
   * có bốn mục.
   *
   * Bài trên chỉ đo mục ĐANG HIỆN, tức mục mặc định (Trợ lý AI). Ba mục còn lại
   * chưa được gắn vào DOM lúc ấy, nên một ô nhập nằm trong mục "Ngôn ngữ & giao
   * diện" — chỗ tự nhiên nhất để ai đó đặt một `<input type="radio">` chọn giao
   * diện, hay một ô tìm kiếm — sẽ đi qua bài trên mà không ai biết. Trên trình
   * duyệt thật thì `e2e/s2.spec.ts` cũng chỉ đo mục đang hiện.
   *
   * Và ràng buộc thì không đổi theo mục: mọi ô trên trang này đều đi qua DOM
   * của TRANG CHÍNH, nơi một khoá học `interactive` bị duyệt sót đọc được bằng
   * đúng một listener `input`. "Không có ô nào" phải đúng ở cả bốn mục, nếu
   * không thì nó chỉ đúng ở mục mà bài kiểm tình cờ nhìn vào.
   *
   * Kèm CHỐT CHỐNG-VACUOUS ở mỗi vòng: một danh sách rỗng cũng ra từ một mục
   * không vẽ gì cả, nên mỗi mục phải tự chứng minh nó có mặt bằng tiêu đề của
   * chính nó trước khi lời khẳng định "không có ô nào" có nghĩa.
   */
  it('KHÔNG có ô nhập nào ở BẤT KỲ khối nào trên trang', async () => {
    const { container } = renderSettings();

    // Trang nay là MỘT trang, nên bài này MẠNH hơn bản cũ chứ không yếu đi:
    // bản cũ phải bấm qua từng tab và chỉ đo được mục đang hiện, còn ở đây cả
    // bốn khối cùng nằm trong `container` một lúc.
    //
    // Chốt chống-vacuous: bốn khối phải tự chứng minh chúng có mặt trước khi
    // lời khẳng định "không có ô nào" có nghĩa. Một trang trắng cũng có 0 ô.
    for (const name of [
      t('vi', 'settings.section.account'),
      t('vi', 'settings.section.appearance'),
      t('vi', 'settings.ai.title'),
      t('vi', 'settings.section.localData'),
    ]) {
      expect(await screen.findByRole('heading', { name }), name).toBeInTheDocument();
    }

    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('textarea')).toHaveLength(0);
    expect(container.querySelectorAll('[contenteditable]')).toHaveLength(0);
  });

  /**
   * Chốt chống bẫy-không-cắm (kỹ thuật của Task 2): bài kiểm trên khẳng định
   * một danh sách RỖNG, và một trang không render gì cũng cho ra danh sách
   * rỗng. Bài này hỏi câu mà một trang chết không trả lời được.
   */
  it('có render thật — tiêu đề và phần giải thích đều có mặt', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: t('vi', 'settings.ai.title') })).toBeInTheDocument();
    expect(screen.getByTestId('vault-explainer')).toHaveTextContent(t('vi', 'settings.ai.blurbVault'));
  });

  /**
   * `<strong>kho khoá</strong>` nằm GIỮA câu — ca đã chốt QĐ-2. Bài này khẳng
   * định hai chuyện mà một `toHaveTextContent` đơn thuần không nói:
   *
   *   1. phần tử được chèn ĐÚNG CHỖ, không bị đẩy ra đầu hay cuối câu;
   *   2. câu vẫn là MỘT câu liền — `textContent` khớp nguyên văn bản dịch, nên
   *      một `tNode` nuốt mất mảnh chữ hay bỏ sót chỗ trống đều đỏ.
   */
  it('phần giải thích có <strong> nằm GIỮA câu, và câu không bị cắt rời', () => {
    renderSettings();
    const p = screen.getByTestId('vault-explainer');
    const strong = p.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe(t('vi', 'settings.ai.blurbVault'));
    expect(p.textContent).toBe(t('vi', 'settings.ai.blurb', t('vi', 'settings.ai.blurbVault')));
    // Không ở đầu, không ở cuối: có chữ ở cả hai phía của phần tử.
    expect(p.textContent?.indexOf(t('vi', 'settings.ai.blurbVault'))).toBeGreaterThan(0);
    expect(p.textContent?.endsWith(t('vi', 'settings.ai.blurbVault'))).toBe(false);
  });

  /**
   * Điểm vào của cổng mù #4 (S1-F29). Khung kho khoá vẽ sẵn bảng xác nhận của
   * Task 9 và form cấu hình của task này, nhưng cả hai chỉ NHÌN THẤY được khi
   * trang chính mở rộng khung ra. Trước task này việc đó không tồn tại, nên
   * `needs_consent` là ngõ cụt.
   */
  it('MỞ RỘNG khung kho khoá khi vào trang — nếu không, form nằm trong khung ẩn', () => {
    renderSettings();
    const f = frames()[0];
    expect(f).toBeVisible();
    expect(f.getAttribute('aria-hidden')).toBeNull();
  });

  it('đóng lại khi rời trang — khung không được che giáo trình ở route khác', () => {
    const { unmount } = renderSettings();
    expect(frames()[0]).toBeVisible();
    unmount();
    render(
      <MemoryRouter>
        <LanguageProvider>
          <VaultFrameProvider origin={VAULT}>
            <p>route khác</p>
          </VaultFrameProvider>
        </LanguageProvider>
      </MemoryRouter>,
    );
    expect(frames()[0]).not.toBeVisible();
  });

  it('đóng được bằng nút, rồi mở lại được — không kẹt ở màn trắng', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('button', { name: /đóng/i }));
    expect(frames()[0]).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: t('vi', 'settings.ai.open') }));
    expect(frames()[0]).toBeVisible();
  });

  /**
   * Escape cũng đóng được — cùng lỗi "stuck" mà người dùng báo, ở nửa còn lại.
   *
   * Một lớp phủ TOÀN màn hình chỉ thoát được bằng cách bấm trúng một nút là một
   * lớp phủ dễ thành cái bẫy. Bài này đo ở trang cha, đúng phạm vi mà bản sửa
   * hứa: khung kho khoá ở origin khác nên khi tiêu điểm đã vào trong khung thì
   * phím không nổi lên tới đây — giới hạn ấy ghi trong `shell/VaultFrame.tsx`
   * và không vá được từ phía này.
   */
  it('Escape cũng đóng được lớp phủ, không chỉ nút Đóng', async () => {
    const user = userEvent.setup();
    renderSettings();

    // Chốt chống-vacuous: phải đang MỞ thì "đóng được" mới có nghĩa.
    expect(frames()[0]).toBeVisible();

    await user.keyboard('{Escape}');
    expect(frames()[0]).not.toBeVisible();
    expect(document.querySelector('.vault-overlay')).toBeNull();

    // Và mở lại được — Escape không được để trang kẹt ở trạng thái chết.
    await user.click(screen.getByRole('button', { name: t('vi', 'settings.ai.open') }));
    expect(frames()[0]).toBeVisible();
  });

  /**
   * Bản dựng không có kho khoá phải NÓI RA điều đó. `unavailable` tách khỏi
   * `not_configured` ở Task 5 vì đúng lý do này: mời người học "vào cấu hình để
   * cắm key" chỉ đúng khi có chỗ để cắm.
   */
  it('nói thẳng khi bản dựng này KHÔNG có kho khoá, thay vì hiện một khung rỗng', () => {
    renderSettings(null);
    expect(frames()).toHaveLength(0);
    expect(screen.getByTestId('vault-unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('vi', 'settings.ai.open') })).toBeNull();
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
  it('trang có đủ bốn khối, đúng tên và đúng thứ tự', () => {
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
   * Lối vào từ lời mời AI (`state={{ section: 'ai' }}`) không còn ĐỔI thứ hiện
   * ra — trang chỉ có một, và mọi khối đều ở trên đó. Điều nó phải giữ là thứ
   * `e2e/s2.spec.ts` phụ thuộc: người bấm "Mở trang cấu hình" từ panel hỏi-đáp
   * tới nơi và thấy khối Trợ lý AI, không qua một cú bấm chọn mục nào nữa.
   */
  it('lối vào từ lời mời AI: khối Trợ lý AI có mặt ngay, không qua một cú bấm nào', () => {
    renderSettings();
    expect(blockHeading(t('vi', 'settings.ai.title'))).toBeInTheDocument();
    expect(screen.getByTestId('vault-explainer')).toBeInTheDocument();
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
   * Id ấy thuộc về `i18n/LanguageSwitcher.tsx` trên thanh công cụ, và
   * `e2e/s3.spec.ts` định vị bằng `document.getElementById('lang-select')` để
   * đo xem lớp phủ kho khoá có che kín trang hay không. Hai phần tử cùng id sẽ
   * làm phép đo ấy chọn nhầm phần tử — và im lặng, vì `getElementById` không
   * bao giờ báo có hai.
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

/* ═══════════════════════════════════════════════════════════════════════════ *
 * KHO KHOÁ ĐƯỢC ĐÓNG KHUNG, VÀ KHUNG ẤY MANG ĐỊA CHỈ THẬT
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Kiến trúc hai origin chỉ có giá trị nếu người dùng **nhìn thấy** nó.
 *
 * Trước thay đổi này, trang cấu hình chỉ KỂ rằng có "một địa chỉ riêng", và lớp
 * phủ mở ra tràn viền, không viền, không tên. Một câu như thế đúng y hệt trong
 * một bản dựng đã lỡ trỏ `VITE_VAULT_ORIGIN` về chính origin trang chính — tức
 * là đúng trong cả bản dựng mà cơ chế đã chết và `localStorage` không còn được
 * trình duyệt cách ly.
 *
 * Nên nhãn phải mang **origin thật**, và các bài dưới đây so nó với đúng chuỗi
 * mà `src` của khung trỏ tới. Một mutant thay `{origin}` bằng một chữ cố định
 * ("một địa chỉ riêng") làm cả hai bài đỏ.
 */
describe('khung kho khoá là một MẶT PHẲNG KHÁC, và nó nói ra địa chỉ của mình', () => {
  it('nhãn trong mục Trợ lý AI mang ĐÚNG origin mà `src` của khung trỏ tới', () => {
    renderSettings();
    const shownOrigin = screen.getByTestId('vault-origin-inline');
    expect(shownOrigin).toHaveTextContent(VAULT);
    expect(frames()[0].getAttribute('src')).toBe(`${VAULT}/`);
  });

  it('nhãn ấy nằm TRONG khung được đóng, không trôi tự do trên trang', () => {
    renderSettings();
    const plane = screen.getByTestId('vault-plane');
    expect(plane).toContainElement(screen.getByTestId('vault-frame-label'));
    expect(plane).toContainElement(screen.getByTestId('vault-origin-inline'));
  });

  it('thanh tiêu đề của lớp phủ cũng mang ĐÚNG origin ấy', () => {
    renderSettings();
    expect(screen.getByTestId('vault-origin')).toHaveTextContent(VAULT);
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * BÀI ĐẮT NHẤT CỦA TỆP NÀY: KHUNG KHÔNG ĐƯỢC TÁI SINH.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * `VaultFrame.tsx` viết ra ràng buộc bằng chữ: React **tháo và gắn lại** một
   * `<iframe>` bị đổi cha, và gắn lại một khung nghĩa là nạp lại tài liệu ở
   * origin kia — **xoá sạch key mà người dùng đang gõ dở**, không một lời cảnh
   * báo. Đó là lý do lớp bọc quanh khung luôn có mặt và chỉ `className` đổi.
   *
   * Thay đổi này thêm một lớp bọc THỨ HAI (`.vault-card`, để lớp phủ thành một
   * tấm có viền thay vì một mặt phẳng tràn viền), tức là thêm đúng một chỗ để
   * mắc lại lỗi ấy. Cách viết hiển nhiên —
   * `{expanded && <div className="vault-card">…<iframe/></div>}` — trông sạch
   * hơn và **hỏng**: mỗi lần mở ra là một khung mới.
   *
   * So sánh ĐỊNH DANH phần tử, không phải số lượng: một `toHaveLength(1)` vẫn
   * xanh khi khung cũ bị tháo và một khung mới thế chỗ, và đó chính xác là hình
   * dạng của lỗi này.
   *
   * Hai đường tới cùng một lỗi, nên hai bài:
   *   · mở → đóng → mở (lớp bọc `.vault-card` bị điều kiện hoá);
   *   · sang mục khác rồi quay lại (mục Trợ lý AI bị tháo cùng khung của nó).
   *
   * Đường thứ hai KHÔNG CÒN TỒN TẠI: Cài đặt nay là một trang, nên không có
   * "mục khác" để sang. Bài kiểm riêng cho nó đã bỏ cùng thao tác ấy — giữ lại
   * một bài mô tả một thao tác không tồn tại là giữ một lời khẳng định luôn
   * xanh. Đường thứ nhất (đóng rồi mở lại) vẫn nguyên, và nó là đường người
   * dùng thật đi.
   */
  it('mở → đóng → mở KHÔNG dựng lại khung — key gõ dở không được biến mất', async () => {
    const user = userEvent.setup();
    renderSettings();

    const original = frames()[0];
    expect(original).toBeVisible();

    await user.click(screen.getByRole('button', { name: /đóng/i }));
    expect(frames()[0]).toBe(original);

    await user.click(screen.getByRole('button', { name: t('vi', 'settings.ai.open') }));
    expect(frames()[0]).toBe(original);
    expect(frames()).toHaveLength(1);
  });

});

/**
 * Trợ lý AI là TUỲ CHỌN, và Cài đặt phải cư xử đúng như vậy.
 *
 * Người dùng báo lỗi này bằng một câu ngắn: *"I stuck at this screen, this AI
 * settings should be optional."* Vào `/settings` từ thanh bên là rơi thẳng vào
 * một lớp phủ TOÀN MÀN HÌNH cấu hình AI — `DEFAULT_SECTION` là `'ai'`, và
 * `AiSection` tự gọi `setExpanded(true)` lúc mount. Muốn đổi ngôn ngữ thì phải
 * đóng một trang cấu hình AI trước.
 *
 * Không bài nào cũ bắt được, vì cả tệp này lẫn `e2e/s3.spec.ts` đều mô tả
 * người dùng đến TỪ lời mời AI — đúng tiền đề mà thiết kế cũ dựa vào, và là
 * tiền đề mà bản IA mới đã phá khi cho "Cài đặt" một chỗ thường trực ở thanh
 * bên. Nên những bài dưới đây kiểm đúng cái lối vào mà không ai từng kiểm.
 */
describe('vào Cài đặt KHÔNG qua lời mời AI', () => {
  it('mở ra là thấy Tài khoản trước, Trợ lý AI ở phía dưới', () => {
    const { container } = renderSettings(VAULT, SIGNED_IN, null);

    // Không còn "mục đang xem" để đo — trang chỉ có một. Thứ thay thế nó là
    // THỨ TỰ: khối đầu tiên người dùng gặp phải là Tài khoản, không phải một
    // trang cấu hình AI.
    const headings = Array.from(container.querySelectorAll('.set-block h2')).map((h) => h.textContent);
    expect(headings[0]).toBe(t('vi', 'settings.section.account'));
    expect(headings.indexOf(t('vi', 'settings.ai.title'))).toBeGreaterThan(0);
  });

  it('KHÔNG bung lớp phủ kho khoá — đó là cả nội dung của lỗi được báo', () => {
    renderSettings(VAULT, SIGNED_IN, null);

    // Khung vẫn được GẮN (cầu nối postMessage cần nó), nhưng đang thu.
    expect(frames()).toHaveLength(1);
    expect(frames()[0]).not.toBeVisible();
    expect(document.querySelector('.vault-overlay')).toBeNull();
  });

  it('cuộn tới khối Trợ lý AI cũng không bung — phải tự mở mới mở', async () => {
    const user = userEvent.setup();
    renderSettings(VAULT, SIGNED_IN, null);

    // Đây là chỗ phân biệt "sửa đúng" với "chỉ đổi mục mặc định": khối AI ở
    // sẵn trên trang và đọc được, nhưng ĐỌC về nó khác với muốn một lớp phủ
    // toàn màn hình.
    expect(blockHeading(t('vi', 'settings.ai.title'))).toBeInTheDocument();
    expect(frames()[0]).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: t('vi', 'settings.ai.open') }));
    expect(frames()[0]).toBeVisible();
  });

  it('ý định hỏng hoặc bịa từ history.state không mở được lớp phủ', () => {
    // `history.state` người dùng dựng được bằng history API và nó sống qua
    // back/forward, nên `readIntent` chỉ nhận đúng giá trị đã biết.
    renderSettings(VAULT, SIGNED_IN, { section: 'khong-ton-tai', openVault: 'yes' });

    expect(blockHeading(t('vi', 'settings.section.account'))).toBeInTheDocument();
    expect(frames()[0]).not.toBeVisible();
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
    // `FROM_AI_INVITE`, thứ mở thẳng mục Trợ lý AI. Mục mặc định khi tới bằng
    // đường thường mới là Tài khoản — và đó chính là mục bài này hỏi.
    renderSettings(VAULT, SIGNED_IN, null);

    const button = await screen.findByRole('button', { name: /đăng xuất/i });
    expect(button).toBeEnabled();

    // ĐỐI CHỨNG: câu cảnh báo phải ở cùng màn. Đăng xuất ở đây XOÁ ghi chú và
    // tiến độ trên máy này (xem `auth/useLogout.ts`), và một nút làm điều đó mà
    // không nói ra là một cái bẫy — nhất là trên máy dùng chung.
    expect(screen.getByText(new RegExp(t('vi', 'settings.account.signOutWarning').slice(0, 24), 'i'))).toBeInTheDocument();
  });
});
