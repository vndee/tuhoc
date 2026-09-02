import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { MessageKey, Translate } from '../i18n';
import { useLanguage } from '../i18n/LanguageProvider';

/**
 * `AgentConfigPanel` — nửa THỨ HAI của mục Trợ lý AI trong Cài đặt, Pha 2
 * (task-14-brief.md). Nó thay chỗ trước đây là form cấu hình vẽ BÊN TRONG
 * khung kho khoá: lời nhắc riêng (`system_prompt`) và danh sách tool bật/tắt
 * (`tools_enabled`), đọc/ghi qua `GET`/`PUT /ai/config`.
 *
 * HÌNH DẠNG DÂY, đo từ `configResponse`/`configRequest`
 * (`apps/api/internal/ai/handler.go`), KHÔNG đoán tên trường:
 *
 *   GET  200 { system_prompt, tools_enabled, available_tools,
 *              unavailable_tools, max_system_prompt_chars }
 *   PUT  nhận { system_prompt, tools_enabled } — CẢ HAI bắt buộc: phía Go
 *        khai chúng là CON TRỎ đúng để "vắng" khác "rỗng" — thiếu MỘT trong
 *        hai trả `FieldRequired`, không có nghĩa ngầm "giữ nguyên trường
 *        kia". `save()` bên dưới luôn gửi cả hai.
 *
 * TRẦN ĐỘ DÀI: SERVER LÀ NGUỒN SỰ THẬT DUY NHẤT, KỂ CẢ Ở CLIENT.
 * `configResponse.max_system_prompt_chars` là con số component này DÙNG THẬT
 * để kẹp — không phải một hằng client tự đoán và có thể trôi khỏi
 * `MaxSystemPromptChars` (Go). Xem doc comment của `configResponse` phía Go:
 * "the client reads the server's numbers instead of keeping a second copy
 * that can drift from this one." `MAX_SYSTEM_PROMPT_CHARS` bên dưới CHỈ là
 * một giá trị dự phòng cho khoảnh khắc CHƯA có dữ liệu từ server — form
 * (và do đó ô nhập) không vẽ trước khi `GET /ai/config` trả lời, nên hằng
 * số ấy trên thực tế không bao giờ là chỗ quyết định thật.
 *
 * ĐẾM BẰNG RUNE, KHÔNG PHẢI `.length` UTF-16 — cùng lỗ Task 13 để lại ở
 * `useAI.ts` (đã vá, xem `runeLength` ở đó): Go đếm
 * `utf8.RuneCountInString`, và một ký tự ngoài mặt phẳng cơ bản (một số
 * emoji) chiếm HAI code unit UTF-16 nhưng một rune. `AgentConfigPanel.test.
 * tsx` có một fixture chứa emoji đúng để đóng lỗ này ở phía component này.
 */

interface ConfigWire {
  readonly system_prompt: string;
  readonly tools_enabled: readonly string[];
  readonly available_tools: readonly string[];
  /**
   * TẬP CON của `available_tools`: những tool máy chủ này KHÔNG có runner
   * (`TurnTools` phía Go, ví dụ `web_search` khi thiếu `BRAVE_API_KEY`).
   *
   * TÙY CHỌN vì một máy chủ CŨ hơn client không gửi trường này — khi ấy
   * màn hình không vẽ nhãn nào, đúng cách nó hành xử trước khi trường này
   * ra đời, chứ KHÔNG đoán bừa rằng mọi tool đều chạy được.
   */
  readonly unavailable_tools?: readonly string[];
  readonly max_system_prompt_chars: number;
}

/**
 * VÒNG SỬA 1 (Minor #4): `export` bị bỏ — 0 chỗ gọi ngoài tệp này (kể cả
 * `AgentConfigPanel.test.tsx`, thứ chỉ render component rồi đọc DOM). Xem
 * chú thích tương ứng ở `CreditPanel.tsx` cho lý do đầy đủ.
 */
interface AgentConfigInfo {
  readonly systemPrompt: string;
  readonly toolsEnabled: readonly string[];
  readonly availableTools: readonly string[];
  readonly unavailableTools: readonly string[];
  readonly maxSystemPromptChars: number;
}

async function fetchConfig(): Promise<AgentConfigInfo> {
  const wire = await api.get<ConfigWire>('/ai/config');
  return {
    systemPrompt: wire.system_prompt,
    toolsEnabled: wire.tools_enabled,
    availableTools: wire.available_tools,
    unavailableTools: wire.unavailable_tools ?? [],
    maxSystemPromptChars: wire.max_system_prompt_chars,
  };
}

interface SaveInput {
  readonly systemPrompt: string;
  readonly toolsEnabled: readonly string[];
}

/**
 * `api.put` (`../api/client.ts`) trả `Promise<void>` CÓ CHỦ Ý — nó được
 * dựng cho `PUT /ratings/:id`, thứ trả `204` rỗng (xem chữ ký của nó ở đó).
 * `PUT /ai/config` thì KHÁC: nó trả lại `configResponse` đã lưu (đọc lại từ
 * DB, không phải echo — `handler.go`'s `PutConfig`, "Read back rather than
 * echo"). Rộng `api.put` ra `Promise<T>` cho MỘT chỗ gọi là đẩy rủi ro sang
 * `PUT /ratings`, chỗ gọi DUY NHẤT khác của nó; doc comment của `api.put`
 * tự mời chọn này ("A future PUT that does answer with a body should get
 * its own entry"). Ở đây chọn đường RẺ HƠN thay vì thêm một hàm dùng chung
 * mới: gọi `api.put` (bỏ qua thân trả về) rồi ĐỌC LẠI bằng `queryClient.
 * fetchQuery(['ai','config'])` trong `onSuccess` của `saveMutation` bên
 * dưới (KHÔNG PHẢI `invalidateQueries` suông — vòng review 1 đo được:
 * `invalidateQueries` một mình không đưa giá trị mới quay lại `draftPrompt`/
 * `draftTools`, nên nó là một round-trip đổi lấy không gì; `fetchQuery` trả
 * thẳng giá trị mới để gieo lại nháp) — một round-trip mạng nữa, nhưng
 * không đụng tệp dùng chung nào ngoài phạm vi task này.
 */
async function saveConfig(input: SaveInput): Promise<void> {
  await api.put('/ai/config', { system_prompt: input.systemPrompt, tools_enabled: input.toolsEnabled });
}

/**
 * Bản sao phía client của hằng Go `MaxSystemPromptChars`
 * (`apps/api/internal/ai/handler.go`) — CHỈ dùng trước khi `GET /ai/config`
 * trả lời (xem doc comment đầu tệp: trên thực tế không load-bearing, vì
 * form chỉ vẽ SAU khi có dữ liệu thật từ server).
 */
const MAX_SYSTEM_PROMPT_CHARS = 4000;

/**
 * Đếm RUNE (điểm mã Unicode), không phải `.length` (UTF-16 code unit) —
 * cùng lý do và cùng cách viết `runeLength` ở `useAI.ts`. Một ký tự ngoài
 * mặt phẳng cơ bản chiếm HAI code unit nhưng MỘT rune; `.length` đếm gấp
 * đôi những ký tự đó, còn trần phía Go đếm rune.
 */
function runeLength(s: string): number {
  return Array.from(s).length;
}

/** Nhãn dịch cho từng tên tool THẬT (`ToolNameReadCourse`/`ToolNameWebSearch`/
 *  `ToolNameReadMyNotes`, `handler.go`). Một tên chưa biết (server thêm tool
 *  mới, web chưa cập nhật) hiện NGUYÊN VĂN tên đó thay vì vỡ — server vẫn là
 *  nơi quyết định tool nào tồn tại (`available_tools`); web chỉ chưa có
 *  nhãn đẹp cho nó. */
const TOOL_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  read_course: 'settings.ai.toolReadCourse',
  web_search: 'settings.ai.toolWebSearch',
  read_my_notes: 'settings.ai.toolReadMyNotes',
};

function toolLabel(name: string, t: Translate): string {
  const key = TOOL_LABEL_KEYS[name];
  return key ? t(key) : name;
}

/** Mã lỗi `PUT /ai/config` sang câu cho người đọc — không bao giờ hiện
 *  `error.body.error` (câu tiếng Anh kỹ thuật của Go) thẳng ra màn hình,
 *  cùng luật `useAI.ts`'s `describeFailure` áp cho `/ai/chat`. */
function describeSaveError(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    const body = error.body as { code?: unknown } | undefined;
    const code = typeof body?.code === 'string' ? body.code : undefined;
    if (code === 'FieldTooLong') return t('settings.ai.promptTooLong');
    if (code === 'UnknownTool') return t('settings.ai.saveUnknownTool');
  }
  return t('settings.ai.saveRejected');
}

export function AgentConfigPanel() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['ai', 'config'], queryFn: fetchConfig, retry: false });

  // Bản NHÁP người dùng đang sửa — tách khỏi `query.data` (sự thật đã LƯU)
  // để gõ dở không bị một lần refetch nền ghi đè. `null` = "chưa gieo từ dữ
  // liệu server", phân biệt với chuỗi rỗng (một prompt rỗng hợp lệ).
  const [draftPrompt, setDraftPrompt] = useState<string | null>(null);
  const [draftTools, setDraftTools] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (query.data && draftPrompt === null && draftTools === null) {
      setDraftPrompt(query.data.systemPrompt);
      setDraftTools(new Set(query.data.toolsEnabled));
    }
    // Gieo ĐÚNG MỘT LẦN theo dữ liệu tải lần đầu — deps cố ý không gồm
    // `draftPrompt`/`draftTools` (chúng đổi vì SỬA, không vì tải lại).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: saveConfig,
    /**
     * VÒNG SỬA 1 (Minor #1): bản trước chỉ `invalidateQueries` rồi DỪNG —
     * `useEffect` gieo nháp (dưới) chỉ chạy khi `draftPrompt`/`draftTools`
     * còn `null`, tức ĐÚNG MỘT LẦN, lúc tải trang. Sau đó không có đường nào
     * đưa bản làm mới quay lại `draftPrompt`/`draftTools`, nên round-trip ấy
     * là mạng đổi lấy không gì — đo được: xoá cả khối này vẫn xanh toàn bộ.
     *
     * Sửa THẬT: `fetchQuery` (không phải `invalidateQueries` + đợi observer
     * tự cập nhật) để có luôn GIÁ TRỊ MỚI trong tay, rồi GHI ĐÈ `draftPrompt`/
     * `draftTools` bằng đúng giá trị ấy. Đây là "Read back rather than echo"
     * (`handler.go`'s `PutConfig`) làm cho THẬT ở phía client: máy chủ có
     * thể trả về khác thứ vừa gửi (dedupe, chuẩn hoá), và form phải hiện
     * ĐÚNG BẢN MÁY CHỦ GIỮ — `AgentConfigPanel.test.tsx`'s bài "đọc lại đúng
     * bản máy chủ đã lưu" đo trực tiếp điều này bằng một GET giả lập trả về
     * khác hẳn PUT vừa gửi.
     */
    onSuccess: async () => {
      const fresh = await queryClient.fetchQuery({ queryKey: ['ai', 'config'], queryFn: fetchConfig });
      setDraftPrompt(fresh.systemPrompt);
      setDraftTools(new Set(fresh.toolsEnabled));
    },
  });

  if (query.isPending) {
    return <p className="set-note">{t('settings.ai.configLoading')}</p>;
  }
  if (query.isError || !query.data || draftPrompt === null || draftTools === null) {
    return (
      <p className="set-note" role="alert">
        {t('settings.ai.configError')}
      </p>
    );
  }

  // `??`, KHÔNG `||` (vòng review 1, Minor): doc comment cả tệp này lập
  // luận "server là nguồn sự thật duy nhất" — `||` mâu thuẫn với chính lập
  // luận đó, vì nó âm thầm đổi một `max_system_prompt_chars: 0` THẬT SỰ do
  // server gửi thành 4000 (0 là falsy). `??` chỉ rơi về hằng dự phòng khi
  // trường này thật sự VẮNG (`null`/`undefined`), không phải khi nó là một
  // số hợp lệ mà client tình cờ coi là falsy.
  const cap = query.data.maxSystemPromptChars ?? MAX_SYSTEM_PROMPT_CHARS;
  const promptLength = runeLength(draftPrompt);
  const overCap = promptLength > cap;

  const toggleTool = (name: string) => {
    setDraftTools((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const submit = () => {
    if (overCap || draftPrompt === null || draftTools === null) return;
    // Thứ tự ỔN ĐỊNH: theo `available_tools` (thứ tự Go trả, `KnownToolNames`),
    // không theo thứ tự bấm — hai người bật đúng hai tool giống nhau bằng
    // hai trình tự bấm khác nhau phải gửi ĐÚNG MỘT mảng.
    const toolsEnabled = query.data!.availableTools.filter((name) => draftTools.has(name));
    saveMutation.mutate({ systemPrompt: draftPrompt, toolsEnabled });
  };

  return (
    <div className="set-agent-config">
      <p className="set-note">{t('settings.ai.configBlurb')}</p>

      <form
        className="set-agent-form"
        data-testid="agent-config-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="set-field">
          <label className="set-label" htmlFor="agent-config-prompt">
            {t('settings.ai.promptLabel')}
          </label>
          <textarea
            id="agent-config-prompt"
            className="set-textarea"
            rows={4}
            value={draftPrompt}
            placeholder={t('settings.ai.promptPlaceholder')}
            onChange={(e) => {
              setDraftPrompt(e.target.value);
            }}
          />
          <p
            className={overCap ? 'set-note set-note-warn' : 'set-note'}
            data-testid="agent-prompt-counter"
          >
            {t('settings.ai.promptCounter', String(promptLength), String(cap))}
          </p>
          {overCap && (
            <p className="set-note set-note-warn" role="alert" data-testid="agent-prompt-too-long">
              {t('settings.ai.promptTooLong')}
            </p>
          )}
        </div>

        {/*
          E4 của review tổng nhánh Pha 2. Trước bản này màn hình vẽ một công
          tắc cho MỌI tên trong `available_tools` và không nói gì thêm —
          nên trên một bản triển khai không có `BRAVE_API_KEY`, người học
          bật `web_search`, lưu thành công, rồi không gì xảy ra, mãi mãi.
          Chú thích của `KnownToolNames` phía Go tự gọi trạng thái ấy là
          "this tool is off right now"; giao diện chưa bao giờ nói câu đó.

          CÔNG TẮC VẪN BẤM ĐƯỢC, không `disabled`: lựa chọn được lưu bền và
          sống lâu hơn cái key còn thiếu (xem doc comment của
          `UnavailableTools` phía Go). Khoá công tắc lại sẽ biến "hôm nay
          chưa chạy được" thành "bạn không được phép chọn", và lúc người vận
          hành đặt key thì mọi người học phải tự bấm lại.
        */}
        <div className="set-field">
          <p className="set-label">{t('settings.ai.toolsTitle')}</p>
          <div className="set-tool-list">
            {query.data.availableTools.map((name) => {
              const enabled = draftTools.has(name);
              const unavailable = query.data.unavailableTools.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  role="checkbox"
                  aria-checked={enabled}
                  className={enabled ? 'set-tool-toggle on' : 'set-tool-toggle'}
                  data-testid={`agent-tool-${name}`}
                  onClick={() => {
                    toggleTool(name);
                  }}
                >
                  {toolLabel(name, t)}
                  {unavailable && (
                    <span className="set-tool-off" data-testid={`agent-tool-unavailable-${name}`}>
                      {' '}
                      ({t('settings.ai.toolUnavailable')})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {query.data.unavailableTools.length > 0 && (
            <p className="set-note set-note-warn" data-testid="agent-tools-unavailable-note">
              {t('settings.ai.toolsUnavailableNote')}
            </p>
          )}
        </div>

        {saveMutation.isError && (
          <p className="set-note set-note-warn" role="alert">
            {describeSaveError(saveMutation.error, t)}
          </p>
        )}
        {saveMutation.isSuccess && <p className="set-note">{t('settings.ai.saved')}</p>}

        <button type="submit" className="btn primary" disabled={overCap || saveMutation.isPending}>
          {t('settings.ai.save')}
        </button>
      </form>
    </div>
  );
}

export default AgentConfigPanel;
