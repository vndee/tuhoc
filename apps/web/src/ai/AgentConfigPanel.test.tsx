import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { AgentConfigPanel } from './AgentConfigPanel';

/**
 * `AgentConfigPanel` — nửa THỨ HAI của mục Trợ lý AI, thay chỗ trước đây là
 * form cấu hình VẼ BÊN TRONG khung kho khoá (task-14-brief.md). Đọc/ghi
 * `GET`/`PUT /ai/config` (`apps/api/internal/ai/handler.go`).
 *
 * HÌNH DẠNG DÂY — KHÔNG ĐOÁN TÊN TRƯỜNG, đọc thẳng từ `configResponse`/
 * `configRequest`:
 *
 *   GET  200 { system_prompt, tools_enabled, available_tools,
 *              unavailable_tools, max_system_prompt_chars }
 *   PUT  gửi { system_prompt, tools_enabled } — CẢ HAI bắt buộc (con trỏ
 *        phía Go: thiếu một trong hai ⇒ `FieldRequired`, KHÔNG hiểu ngầm
 *        là "giữ nguyên").
 *
 * TRẦN 4000 KÝ TỰ (RUNE) LÀ CỦA MÁY CHỦ. Client chỉ báo SỚM — task-14-brief:
 * "Server vẫn là chỗ quyết định; client báo sớm để người dùng không gõ 4000
 * ký tự rồi mới biết." `configResponse.max_system_prompt_chars` là SỐ THẬT
 * client dùng để kẹp — không phải một hằng số client tự đoán — nên fixture
 * dưới đây CỐ Ý dùng trần 50 (khác hẳn 4000) ở phần lớn bài, để chứng minh
 * component đọc SỐ CỦA MÁY CHỦ chứ không phải một hằng cứng.
 *
 * TRẦN RUNE VS UTF-16 — món nợ Task 13 để lại, ghi đích danh trong CHỈ THỊ
 * dispatch của vòng chạy Task 14 (KHÔNG PHẢI trong `task-14-brief.md` — tệp
 * đó chỉ 19 dòng, không có mục "Ba món nợ" nào; vòng review 1 bắt đúng một
 * trích dẫn sai chỗ tương tự và đây là chỗ sửa cho tương xứng): đổi đếm rune
 * sang `.length` UTF-16 thuần thì fixture KHÔNG có ký tự ngoài mặt phẳng cơ
 * bản (BMP) không bắt được lỗ này. Bài "trần THẬT 4000 rune, có emoji" dưới
 * đây dựng một chuỗi runeLength ĐÚNG 4000 nhưng `.length` (UTF-16) là 4001 —
 * một phép kẹp sai (`.length`) sẽ CHẶN NHẦM một lời nhắc hợp lệ.
 */

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(node: ReactNode): ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{node}</LanguageProvider>
    </QueryClientProvider>
  );
}

function mockConfigGet(body: JsonBodyType, status = 200): void {
  server.use(http.get('/ai/config', () => HttpResponse.json(body, { status })));
}

interface PutCapture {
  body: unknown;
  method: string;
  credentials: string;
  contentType: string | null;
}

function mockConfigPut(onRequest: (c: PutCapture) => JsonBodyType | Promise<JsonBodyType>): void {
  server.use(
    http.put('/ai/config', async ({ request }) => {
      const capture: PutCapture = {
        body: await request.json(),
        method: request.method,
        credentials: request.credentials,
        contentType: request.headers.get('content-type'),
      };
      return HttpResponse.json(await onRequest(capture));
    }),
  );
}

const BASE_CONFIG = {
  system_prompt: 'Trả lời ngắn gọn.',
  tools_enabled: ['read_course'],
  available_tools: ['read_course', 'web_search'],
  max_system_prompt_chars: 50,
};

describe('AgentConfigPanel — tải cấu hình', () => {
  it('vẽ ĐÚNG prompt đã lưu và ĐÚNG trạng thái bật/tắt của từng tool', async () => {
    mockConfigGet(BASE_CONFIG);
    render(wrap(<AgentConfigPanel />));

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(t('vi', 'settings.ai.promptLabel'));
    expect(textarea.value).toBe('Trả lời ngắn gọn.');

    expect(screen.getByTestId('agent-tool-read_course')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('agent-tool-web_search')).toHaveAttribute('aria-checked', 'false');
  });

  /**
   * VÒNG SỬA 1 (Minor #2): `not.toBe('')` + `not.toBe(other)` được thoả bởi
   * BẤT KỲ chuỗi không rỗng nào khác nhau — kể cả một chuỗi THÔ do lỗi đánh
   * máy trong `TOOL_LABEL_KEYS` (đo được: đổi khoá `read_course` →
   * `read_courses` làm `toolLabel()` rơi về nhánh dự phòng "hiện nguyên tên
   * tool", ra chuỗi `"read_course"` — không rỗng, khác nhãn `web_search`,
   * nên bài cũ vẫn xanh dù nhãn đã hỏng). So với bản DỊCH THẬT đọc từ
   * catalog (`t('vi', 'settings.ai.toolReadCourse')`), không phải chỉ
   * "khác nhau và không rỗng".
   */
  it('hai tool mang hai NHÃN KHÁC NHAU — đúng bản dịch thật, không phải tên tool thô', async () => {
    mockConfigGet(BASE_CONFIG);
    render(wrap(<AgentConfigPanel />));
    await screen.findByTestId('agent-tool-web_search');

    expect(screen.getByTestId('agent-tool-read_course').textContent).toBe(t('vi', 'settings.ai.toolReadCourse'));
    expect(screen.getByTestId('agent-tool-web_search').textContent).toBe(t('vi', 'settings.ai.toolWebSearch'));
    // Đối chứng phụ, giữ lại từ bản trước: hai bản dịch phải thật sự khác
    // nhau (bắt được nếu ai đó gán trùng khoá dịch cho cả hai tool).
    expect(t('vi', 'settings.ai.toolReadCourse')).not.toBe(t('vi', 'settings.ai.toolWebSearch'));
  });

  /**
   * E4 của review tổng nhánh Pha 2.
   *
   * `KnownToolNames()` (Go) trả CẢ HAI tool bất kể `BRAVE_API_KEY` có được
   * đặt hay không — chú thích của chính nó gọi trạng thái ấy là "this tool
   * is off right now". Giao diện KHÔNG BAO GIỜ nói câu đó: người học bật
   * `web_search`, lưu thành công (200), tải lại thấy vẫn bật, và không lượt
   * tìm kiếm nào từng chạy. `unavailable_tools` là nửa máy chủ; ba khẳng
   * định dưới đây là nửa giao diện.
   */
  it('một tool máy chủ chưa cấu hình được ĐÁNH DẤU, và vẫn bấm được', async () => {
    mockConfigGet({ ...BASE_CONFIG, unavailable_tools: ['web_search'] });
    render(wrap(<AgentConfigPanel />));
    await screen.findByTestId('agent-tool-web_search');

    // 1. Nhãn phụ nằm đúng trên tool KHÔNG chạy được, và KHÔNG nằm trên tool
    //    chạy được — một cài đặt đánh dấu cả hai cũng "hiện cảnh báo".
    expect(screen.getByTestId('agent-tool-unavailable-web_search')).toHaveTextContent(
      t('vi', 'settings.ai.toolUnavailable'),
    );
    expect(screen.queryByTestId('agent-tool-unavailable-read_course')).toBeNull();

    // 2. Câu giải thích chỉ hiện khi có ít nhất một tool như vậy.
    expect(screen.getByTestId('agent-tools-unavailable-note')).toHaveTextContent(
      t('vi', 'settings.ai.toolsUnavailableNote'),
    );

    // 3. NỬA DỄ MẤT NHẤT: công tắc vẫn bấm được. Lựa chọn lưu bền và sống
    //    lâu hơn cái key còn thiếu — khoá nó lại sẽ bắt mọi người học bấm
    //    lại vào ngày người vận hành đặt key.
    const toggle = screen.getByTestId('agent-tool-web_search');
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('không tool nào chưa cấu hình thì KHÔNG có nhãn phụ lẫn câu giải thích nào', async () => {
    mockConfigGet({ ...BASE_CONFIG, unavailable_tools: [] });
    render(wrap(<AgentConfigPanel />));
    await screen.findByTestId('agent-tool-web_search');

    expect(screen.queryByTestId('agent-tool-unavailable-web_search')).toBeNull();
    expect(screen.queryByTestId('agent-tools-unavailable-note')).toBeNull();
  });

  /**
   * MỘT MÁY CHỦ CŨ hơn client không gửi `unavailable_tools`. Khi ấy màn hình
   * KHÔNG được đoán bừa theo chiều nào — nó chỉ mất lớp thông tin mới, đúng
   * cách nó hành xử trước khi trường này ra đời. Cùng luật
   * `max_pricing_rate_micro` đã theo ở `AdminPricing.tsx`.
   */
  it('máy chủ không gửi `unavailable_tools` thì không đánh dấu gì cả', async () => {
    mockConfigGet(BASE_CONFIG);
    render(wrap(<AgentConfigPanel />));
    await screen.findByTestId('agent-tool-web_search');

    expect(screen.queryByTestId('agent-tool-unavailable-web_search')).toBeNull();
    expect(screen.queryByTestId('agent-tools-unavailable-note')).toBeNull();
  });

  it('lỗi tải cấu hình (500) hiện một câu, không phải một form trắng', async () => {
    mockConfigGet({ code: 'Internal', error: 'boom' }, 500);
    render(wrap(<AgentConfigPanel />));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(t('vi', 'settings.ai.promptLabel'))).toBeNull();
  });
});

describe('AgentConfigPanel — trần độ dài BÁO SỚM ở client, đọc số THẬT của máy chủ', () => {
  it('đúng trần (50) → Lưu vẫn bật; trần + 1 (51) → Lưu bị chặn, không phải 55', async () => {
    mockConfigGet(BASE_CONFIG); // max_system_prompt_chars: 50
    render(wrap(<AgentConfigPanel />));
    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(t('vi', 'settings.ai.promptLabel'));
    const save = screen.getByRole('button', { name: t('vi', 'settings.ai.save') });

    fireEvent.change(textarea, { target: { value: 'a'.repeat(50) } });
    expect(screen.getByTestId('agent-prompt-counter')).toHaveTextContent('50 / 50');
    expect(save).not.toBeDisabled();
    expect(screen.queryByTestId('agent-prompt-too-long')).toBeNull();

    fireEvent.change(textarea, { target: { value: 'a'.repeat(51) } });
    expect(screen.getByTestId('agent-prompt-counter')).toHaveTextContent('51 / 50');
    expect(save).toBeDisabled();
    expect(screen.getByTestId('agent-prompt-too-long')).toBeInTheDocument();
  });

  it('vượt trần thì KHÔNG một request PUT nào rời máy, kể cả submit form trực tiếp', async () => {
    mockConfigGet(BASE_CONFIG);
    let putCalled = false;
    server.use(
      http.put('/ai/config', () => {
        putCalled = true;
        return HttpResponse.json(BASE_CONFIG);
      }),
    );
    render(wrap(<AgentConfigPanel />));
    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(t('vi', 'settings.ai.promptLabel'));
    fireEvent.change(textarea, { target: { value: 'a'.repeat(51) } });

    // Bỏ qua nút (đã disabled) và submit form THẲNG — chốt chặn phải nằm
    // trong `onSubmit`, không chỉ nằm ở thuộc tính `disabled` của nút.
    fireEvent.submit(screen.getByTestId('agent-config-form'));
    await new Promise((r) => setTimeout(r, 0));

    expect(putCalled).toBe(false);
  });

  it('trần THẬT 4000 rune, có emoji: đúng 4000 rune (dù .length UTF-16 là 4001) → Lưu vẫn bật', async () => {
    mockConfigGet({ ...BASE_CONFIG, max_system_prompt_chars: 4000 });
    render(wrap(<AgentConfigPanel />));
    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(t('vi', 'settings.ai.promptLabel'));
    const save = screen.getByRole('button', { name: t('vi', 'settings.ai.save') });

    // 3999 ký tự ASCII + MỘT emoji ngoài mặt phẳng cơ bản (surrogate pair —
    // 2 code unit UTF-16, 1 rune). Tổng: 4000 rune ĐÚNG trần, nhưng
    // `.length` (UTF-16) là 4001 — một phép kẹp `.length` sai sẽ chặn NHẦM
    // chuỗi này.
    const exactly4000Runes = `${'a'.repeat(3999)}🎉`;
    expect(Array.from(exactly4000Runes).length).toBe(4000);
    expect(exactly4000Runes.length).toBe(4001); // xác nhận fixture THẬT SỰ khác biệt rune/UTF-16

    fireEvent.change(textarea, { target: { value: exactly4000Runes } });
    expect(screen.getByTestId('agent-prompt-counter')).toHaveTextContent('4000 / 4000');
    expect(save).not.toBeDisabled();
    expect(screen.queryByTestId('agent-prompt-too-long')).toBeNull();

    // Thêm đúng một rune (BMP, an toàn) → 4001 rune → phải chặn.
    fireEvent.change(textarea, { target: { value: `${exactly4000Runes}a` } });
    expect(screen.getByTestId('agent-prompt-counter')).toHaveTextContent('4001 / 4000');
    expect(save).toBeDisabled();
  });
});

describe('AgentConfigPanel — PUT gửi đúng thứ, và tool bật/tắt phản ánh vào đó', () => {
  it('PUT mang ĐÚNG {system_prompt, tools_enabled} — đúng chữ vừa gõ, đúng tool vừa bật', async () => {
    mockConfigGet(BASE_CONFIG);
    let captured: PutCapture | null = null;
    mockConfigPut((c) => {
      captured = c;
      return { ...BASE_CONFIG, system_prompt: 'Chi tiết hơn.', tools_enabled: ['read_course', 'web_search'] };
    });

    const user = userEvent.setup();
    render(wrap(<AgentConfigPanel />));
    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(t('vi', 'settings.ai.promptLabel'));

    fireEvent.change(textarea, { target: { value: 'Chi tiết hơn.' } });
    await user.click(screen.getByTestId('agent-tool-web_search'));
    await user.click(screen.getByRole('button', { name: t('vi', 'settings.ai.save') }));

    await waitFor(() => {
      expect(captured).not.toBeNull();
    });
    expect(captured!.method).toBe('PUT');
    expect(captured!.credentials).toBe('include');
    expect(captured!.contentType).toContain('application/json');
    expect(captured!.body).toEqual({
      system_prompt: 'Chi tiết hơn.',
      tools_enabled: ['read_course', 'web_search'],
    });
  });

  /**
   * VÒNG SỬA 1 (Minor #3): `submit()` xây `tools_enabled` bằng cách lọc
   * `availableTools` theo `draftTools.has(name)` — có CHỦ Ý, để thứ tự
   * KHÔNG phụ thuộc trình tự bấm (doc comment của `submit()` gọi rõ tính
   * chất này). Nhưng bài "PUT mang ĐÚNG…" ở trên chỉ bấm ĐÚNG MỘT trình tự
   * (bật `web_search`, giữ nguyên `read_course` đã bật sẵn) — trình tự ấy
   * TÌNH CỜ trùng thứ tự `available_tools`, nên nó không phân biệt được
   * "lọc theo available_tools" với "giữ nguyên thứ tự Set theo lúc bấm" (V8
   * giữ thứ tự chèn của `Set`, và ở bài kia thứ tự chèn CŨNG là read_course
   * rồi web_search). Bài này bấm NGƯỢC — `web_search` trước, `read_course`
   * sau — để hai giả thuyết cho ra hai mảng KHÁC NHAU, và chỉ "lọc theo
   * available_tools" cho ra mảng đúng.
   */
  it('bấm NGƯỢC thứ tự (web_search trước, read_course sau) vẫn gửi mảng theo available_tools, không theo thứ tự bấm', async () => {
    mockConfigGet({ ...BASE_CONFIG, tools_enabled: [] }); // cả hai tool tắt sẵn
    let captured: PutCapture | null = null;
    mockConfigPut((c) => {
      captured = c;
      return BASE_CONFIG;
    });

    const user = userEvent.setup();
    render(wrap(<AgentConfigPanel />));
    await screen.findByTestId('agent-tool-read_course');

    // NGƯỢC thứ tự `available_tools` (['read_course', 'web_search']).
    await user.click(screen.getByTestId('agent-tool-web_search'));
    await user.click(screen.getByTestId('agent-tool-read_course'));
    await user.click(screen.getByRole('button', { name: t('vi', 'settings.ai.save') }));

    await waitFor(() => {
      expect(captured).not.toBeNull();
    });
    expect(captured!.body).toEqual({
      system_prompt: 'Trả lời ngắn gọn.',
      tools_enabled: ['read_course', 'web_search'],
    });
  });

  it('bật rồi tắt lại MỘT tool: PUT không mang tool đó — trạng thái cuối, không phải một nửa', async () => {
    mockConfigGet(BASE_CONFIG); // read_course bật sẵn
    let captured: PutCapture | null = null;
    mockConfigPut((c) => {
      captured = c;
      return BASE_CONFIG;
    });

    const user = userEvent.setup();
    render(wrap(<AgentConfigPanel />));
    await screen.findByTestId('agent-tool-read_course');

    await user.click(screen.getByTestId('agent-tool-read_course')); // tắt
    await user.click(screen.getByRole('button', { name: t('vi', 'settings.ai.save') }));

    await waitFor(() => {
      expect(captured).not.toBeNull();
    });
    expect(captured!.body).toEqual({ system_prompt: 'Trả lời ngắn gọn.', tools_enabled: [] });
  });

  /**
   * VÒNG SỬA 1 (Minor #1): bản trước gọi `invalidateQueries(['ai','config'])`
   * trong `onSuccess` nhưng KHÔNG BAO GIỜ đọc lại kết quả vào `draftPrompt`/
   * `draftTools` — `useEffect` gieo nháp chỉ chạy khi CẢ HAI còn `null`, và
   * sau lần gieo đầu tiên chúng không bao giờ về `null` nữa. Reviewer đo:
   * xoá hẳn khối `onSuccess` đó vẫn 26/26 xanh — một round-trip mạng đổi lấy
   * KHÔNG GÌ. Bài này khẳng định hành vi PHẢI CÓ mà round-trip ấy tồn tại để
   * phục vụ: "Read back rather than echo" (`handler.go`'s `PutConfig`) — máy
   * chủ có thể chuẩn hoá/dedupe khác với thứ client vừa gửi, và form phải
   * hiện ĐÚNG BẢN MÁY CHỦ GIỮ, không phải bản nháp người dùng vừa gõ.
   */
  it('sau khi lưu, form đọc lại ĐÚNG bản máy chủ đã lưu — không phải bản nháp vừa gửi (đọc lại thật, không phải echo)', async () => {
    mockConfigGet(BASE_CONFIG);
    const SAVED_BY_SERVER = {
      ...BASE_CONFIG,
      system_prompt: 'Đã chuẩn hoá bởi máy chủ.',
      tools_enabled: ['web_search'],
    };
    server.use(
      http.put('/ai/config', () => {
        // Từ đây, GET KẾ TIẾP (round-trip đọc lại sau khi lưu) phải thấy
        // bản ĐÃ LƯU — không phải bản vừa gửi lên. Mô phỏng đúng phát biểu
        // "Read back rather than echo" ở phía Go.
        server.use(http.get('/ai/config', () => HttpResponse.json(SAVED_BY_SERVER)));
        return HttpResponse.json(SAVED_BY_SERVER);
      }),
    );

    const user = userEvent.setup();
    render(wrap(<AgentConfigPanel />));
    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(t('vi', 'settings.ai.promptLabel'));

    fireEvent.change(textarea, { target: { value: 'Bản nháp người dùng gõ, KHÁC bản máy chủ trả về.' } });
    await user.click(screen.getByRole('button', { name: t('vi', 'settings.ai.save') }));

    await waitFor(() => {
      expect(textarea.value).toBe('Đã chuẩn hoá bởi máy chủ.');
    });
    expect(screen.getByTestId('agent-tool-read_course')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('agent-tool-web_search')).toHaveAttribute('aria-checked', 'true');
  });

  it('lưu thành công hiện một xác nhận', async () => {
    mockConfigGet(BASE_CONFIG);
    mockConfigPut(() => BASE_CONFIG);

    const user = userEvent.setup();
    render(wrap(<AgentConfigPanel />));
    await screen.findByTestId('agent-tool-read_course');
    await user.click(screen.getByRole('button', { name: t('vi', 'settings.ai.save') }));

    expect(await screen.findByText(t('vi', 'settings.ai.saved'))).toBeInTheDocument();
  });
});

describe('AgentConfigPanel — máy chủ từ chối PUT, ba mã ba câu khác nhau', () => {
  /**
   * VÒNG SỬA 1 (I2): bài trước CHỈ khẳng định `new Set(messages).size === 3`
   * — "ba câu khác nhau" là điều kiện CẦN nhưng KHÔNG ĐỦ. Đo được: hoán vị
   * `FieldTooLong` ↔ `UnknownTool` trong `describeSaveError` (mỗi mã trả về
   * câu của mã KIA) vẫn cho ra ba chuỗi khác nhau đôi một — bài cũ không hề
   * biết `FieldTooLong` phải đi với CÂU NÀO, chỉ biết nó không trùng câu của
   * hai mã kia. Hậu quả thật: người học viết prompt quá dài nhận nhầm câu
   * "một tool không còn tồn tại" — lời khuyên sai hướng.
   *
   * Sửa: ghim TỪNG CẶP mã → khoá dịch, so với `t('vi', <khoá>)` đọc thẳng từ
   * catalog (không chép tay chuỗi tiếng Việt hai lần) — đúng khuôn
   * `useAI.test.tsx`'s bảng `DISTINCT_PRE_STREAM`/`DISTINCT_MID_STREAM`
   * (mô tả trong `task-13-report.md` §7.2, KHÔNG PHẢI trong `task-14-brief.
   * md` — tệp đó không nhắc tới hai tên này; sửa cùng đợt với trích dẫn sai
   * chỗ ở đầu tệp này mà vòng review 1 bắt được).
   */
  const CODE_TO_MESSAGE_KEY = {
    UnknownTool: 'settings.ai.saveUnknownTool',
    FieldTooLong: 'settings.ai.promptTooLong',
    InvalidBody: 'settings.ai.saveRejected',
  } as const;

  it('MỖI mã dẫn tới ĐÚNG câu của chính nó — không chỉ "ba câu khác nhau"', async () => {
    const messages: string[] = [];
    for (const [code, messageKey] of Object.entries(CODE_TO_MESSAGE_KEY)) {
      // Đặt lại TRƯỚC mỗi vòng — bài này chạy nhiều lượt render/PUT trong
      // MỘT `it()`, nên `afterEach`'s reset (chỉ chạy GIỮA hai `it()`)
      // không đủ; không đặt lại thì handler PUT của vòng trước còn đó.
      server.resetHandlers();
      mockConfigGet(BASE_CONFIG);
      server.use(http.put('/ai/config', () => HttpResponse.json({ code, error: 'x' }, { status: 400 })));

      const user = userEvent.setup();
      const { unmount } = render(wrap(<AgentConfigPanel />));
      await screen.findByTestId('agent-tool-read_course');
      await user.click(screen.getByRole('button', { name: t('vi', 'settings.ai.save') }));

      const alert = await screen.findByRole('alert');
      // CHỐT CHÍNH: đúng mã này phải cho đúng khoá này — không phải "một
      // khoá nào đó chưa dùng".
      expect(alert.textContent, `mã ${code}`).toBe(t('vi', messageKey));
      messages.push(alert.textContent ?? '');
      unmount();
    }

    // Chốt phụ, GIỮ LẠI từ bản trước: bắt cặp gộp mà bảng trên chưa liệt kê
    // tên (ví dụ nếu có ngày thêm mã thứ tư và quên thêm dòng cho nó).
    expect(new Set(messages).size).toBe(3);
  });
});
