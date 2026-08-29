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
 *              max_system_prompt_chars }
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
 * TRẦN RUNE VS UTF-16 — món nợ Task 13 để lại (task-14-brief.md mục "Ba
 * món nợ"): đổi đếm rune sang `.length` UTF-16 thuần thì fixture KHÔNG có
 * ký tự ngoài mặt phẳng cơ bản (BMP) không bắt được lỗ này. Bài
 * "trần THẬT 4000 rune, có emoji" dưới đây dựng một chuỗi runeLength ĐÚNG
 * 4000 nhưng `.length` (UTF-16) là 4001 — một phép kẹp sai (`.length`) sẽ
 * CHẶN NHẦM một lời nhắc hợp lệ.
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

  it('hai tool mang hai NHÃN KHÁC NHAU — không tool nào vô hình đứng cạnh một nhãn trùng', async () => {
    mockConfigGet(BASE_CONFIG);
    render(wrap(<AgentConfigPanel />));
    await screen.findByTestId('agent-tool-web_search');

    const readCourseLabel = screen.getByTestId('agent-tool-read_course').textContent;
    const webSearchLabel = screen.getByTestId('agent-tool-web_search').textContent;
    expect(readCourseLabel).not.toBe('');
    expect(webSearchLabel).not.toBe('');
    expect(readCourseLabel).not.toBe(webSearchLabel);
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
  it('UnknownTool, FieldTooLong, và mã hạ tầng khác dẫn tới BA câu khác nhau đôi một', async () => {
    const messages: string[] = [];
    for (const code of ['UnknownTool', 'FieldTooLong', 'InvalidBody']) {
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
      messages.push(alert.textContent ?? '');
      unmount();
    }

    expect(new Set(messages).size).toBe(3);
  });
});
