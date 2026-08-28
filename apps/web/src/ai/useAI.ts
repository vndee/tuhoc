import { useCallback, useEffect, useRef, useState } from 'react';
import type { Translate } from '../i18n';
import { useLanguage } from '../i18n/LanguageProvider';
import { chat, ServerAIError } from './serverClient';
import type { ServerAIErrorCode } from './serverClient';

/**
 * Hook hỏi–đáp AI — Pha 2, chạy trên MÁY CHỦ. Nó gửi câu hỏi tới `POST
 * /ai/chat` (`./serverClient.ts`) và nhận chữ chảy về; trả bằng credit của
 * người học, không phải key của họ nữa (đó là Pha 1 — xem lịch sử của tệp
 * này trong `git log` cho bản cũ, đi qua một khung ẩn giữ key riêng).
 *
 * KHÔNG CÒN LỊCH SỬ HỘI THOẠI TRÊN DÂY — quyết định sản phẩm, không phải một
 * thiếu sót. `chatRequest` phía Go (`apps/api/internal/ai/handler.go`) chỉ có
 * hai trường, `question` và `course_slug`, và lý do là một đường tiêm đã đo
 * được: `buildMessages` lọc `role` theo whitelist nhưng KHÔNG lọc
 * `ToolCalls`/`ToolCallID`, nên một client gửi lịch sử giả được "công cụ đã
 * trả về X" — một mục `role: "tool"` client tự bịa, đi vào lời nhắc với đúng
 * tư cách một kết quả tool THẬT. Đóng trường ấy lại đóng luôn đường tiêm. Cái
 * giá nói thẳng: mỗi lượt là một cuộc hội thoại RIÊNG, mô hình không nhớ câu
 * trước — bảng transcript riêng tư là việc của Pha 3 (cùng lúc `/progress`,
 * `/notes`, `/annotations` lên máy chủ). Giao diện phải trung thực với điều
 * này: `AskPanel` không được dựng gợi ý rằng gia sư nhớ câu trước.
 */

export type AIState = 'idle' | 'streaming' | 'done' | 'error';

export interface AskContext {
  /**
   * Ngữ cảnh dựng sẵn (chương đang đọc, hay đoạn "Đào sâu") — `./prompts.ts`
   * dựng nó. KHÔNG có vai `system` riêng trên dây: `chatRequest` phía Go chỉ
   * có `question`/`course_slug` (xem doc comment ở trên), nên đây là chỗ
   * QUYẾT ĐỊNH của Task 13 — không có trong brief, suy ra thẳng từ hợp đồng
   * dây đã đóng: ngữ cảnh này được GHÉP VÀO ĐẦU `question` thật gửi đi (xem
   * `ask()`), chứ không có đường nào khác để nó tới được mô hình. `turn.
   * question` hiển thị cho người đọc VẪN LÀ `prompt` gốc, ngắn — người đọc
   * không cần thấy khối ngữ cảnh dài đã gửi kèm, chỉ `AskPanel`'s `quote` mới
   * hiện lại nó khi cần (xem `DeepDive.tsx`).
   */
  system?: string;
  /** Chương đang đọc, cho công cụ `read_course` dùng làm ngữ cảnh. Vắng ⇒
   *  server nhận chuỗi rỗng — hợp lệ, chỉ mất khả năng công cụ đọc đúng
   *  chương. `ChapterView.tsx` (nơi thật sự biết slug) không thuộc bốn tệp
   *  Task 13 sở hữu, nên việc nối dây ở đó chưa nằm trong task này — xem
   *  task-13-report.md. */
  courseSlug?: string;
}

export interface AIFailure {
  code: ServerAIErrorCode;
  message: string;
}

/**
 * MỘT LƯỢT: câu hỏi của người học, và câu trả lời đang/đã chảy về.
 *
 * `turns` vẫn là một MẢNG các lượt độc lập, y hệt Pha 1 — spec §3.1 nói rõ
 * Task 13 chỉ đổi ĐƯỜNG RA của `useAI`, không đổi giao diện của nó, để
 * `AskPanel`/`DeepDive` không phải viết lại. Điều đã đổi thật là Ý NGHĨA của
 * mảng này: trước đây mỗi lượt sau mang theo CẢ lịch sử lên dây (xem lịch sử
 * git của tệp này); giờ mỗi lượt là một lời gọi ĐỘC LẬP tới máy chủ — `turns`
 * chỉ còn là NHẬT KÝ hiển thị phía trình duyệt, không phải một hàng đợi ngữ
 * cảnh cho lượt kế tiếp.
 */
export interface AITurn {
  readonly id: number;
  readonly question: string;
  /** Chữ đã nhận được cho lượt này. Lớn dần trong lúc stream. */
  readonly answer: string;
  /** Lượt này hỏng ở đâu, nếu có. Lỗi thuộc về LƯỢT, không thuộc về cả phiên. */
  readonly failure: AIFailure | null;
}

export interface UseAIResult {
  ask: (prompt: string, ctx?: AskContext) => Promise<void>;
  /** Cả cuộc hội thoại HIỂN THỊ, cũ trước mới sau — KHÔNG phải thứ mô hình
   *  thấy được (xem doc comment của module này: mỗi lượt là một lời gọi
   *  độc lập). */
  turns: readonly AITurn[];
  state: AIState;
  /** Lỗi của lượt CUỐI, giữ lại cho những chỗ chỉ cần biết "vừa hỏng gì". */
  error: AIFailure | null;
  cancel: () => void;
  /** Xoá cuộc hội thoại HIỂN THỊ. Máy chủ không giữ trạng thái nào để xoá
   *  theo — đã KHÔNG BAO GIỜ có transcript nào ở đó (xem doc comment của
   *  module). */
  reset: () => void;
}

/**
 * Mã lỗi ⇒ câu cho NGƯỜI ĐỌC. Không bao giờ hiện thẳng `ServerAIError.message`
 * ra màn hình — đó là quy tắc chính `handler.go` phía Go ghi ra bằng chữ cho
 * hai mã lỗi giữa-stream: "The English sentence beside the code is for logs
 * and bug reports, never for a reader." Quy tắc ấy áp dụng như nhau cho MƯỜI
 * mã, không riêng hai mã đó — nửa còn lại chỉ là chuỗi từ `fail()` phía Go,
 * cùng bản chất (tiếng Anh, không dịch, không hứa hình dạng câu chữ).
 *
 * `NoCredit` và `ProviderFailed` PHẢI dẫn tới hai khoá dịch khác nhau — đây
 * là bài học lặp lại từ 13 task phía Go: "fixture đặt hai giá trị khác nhau
 * lại bằng nhau làm mọi phép hoán vị giữa chúng vô hình." Nếu một sửa đổi sau
 * này gộp hai `case` này lại, `useAI.test.tsx` phải đỏ — xem bảng đột biến ở
 * task-13-report.md.
 */
function describeFailure(code: ServerAIErrorCode, t: Translate): string {
  switch (code) {
    case 'NoCredit':
      return t('ai.error.noCredit');
    case 'RateLimited':
      return t('ai.error.rateLimited');
    case 'ProviderFailed':
      return t('ai.error.providerFailed');
    case 'ToolBudgetExhausted':
      return t('ai.error.toolBudgetExhausted');
    case 'Unauthenticated':
      return t('ai.error.unauthenticated');
    case 'Network':
      return t('ai.error.network');
    case 'Aborted':
      // Không đường nào tới được màn hình bằng mã này — `ask()` trả về SỚM
      // khi `ac.signal.aborted`, trước khi chạm `describeFailure` (xem catch
      // bên dưới). Vẫn cần một câu ở đây vì kiểu `ServerAIErrorCode` không
      // loại trừ được nó lúc biên dịch.
      return t('ai.error.aborted');
    // InvalidBody/FieldRequired/FieldTooLong/UnknownTool/Internal: năm mã
    // này là dấu hiệu MỘT LỖI CỦA CHÍNH TRANG CHÍNH (thân request sai hình
    // dạng, hoặc một sự cố máy chủ không phân loại được) — không phải điều
    // người học gây ra hay sửa được bằng một hành động cụ thể, khác hẳn năm
    // mã ở trên (nạp tiền, chờ, hỏi cụ thể hơn…). Một câu chung, trung thực
    // về việc "không biết chính xác vì sao", đúng hơn là bịa ra một khuyên
    // hành động không có căn cứ.
    case 'InvalidBody':
    case 'FieldRequired':
    case 'FieldTooLong':
    case 'UnknownTool':
    case 'Internal':
      return t('ai.error.requestRejected');
    default:
      return t('ai.error.requestRejected');
  }
}

export function useAI(): UseAIResult {
  const { t } = useLanguage();
  const [turns, setTurns] = useState<readonly AITurn[]>([]);
  const [state, setState] = useState<AIState>('idle');
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(0);

  /**
   * Ghi vào ĐÚNG một lượt theo `id`, không phải "lượt cuối".
   *
   * Hai lời gọi có thể chồng nhau trong đúng một khoảnh khắc: người học bấm Hỏi
   * lần nữa trong lúc lượt trước còn đang chảy. `ask()` huỷ lượt cũ, nhưng mẩu
   * cuối cùng của nó có thể đã nằm trong hàng đợi vi tác vụ. Ghi theo `id` thì
   * mẩu lạc ấy rơi vào lượt của chính nó thay vì nối vào câu trả lời mới.
   */
  const patch = useCallback((id: number, change: (turn: AITurn) => AITurn) => {
    setTurns((prev) => prev.map((turn) => (turn.id === id ? change(turn) : turn)));
  }, []);

  /**
   * Tháo component cũng phải HUỶ THẬT. Người học đóng panel giữa chừng thì lời
   * gọi phải dừng ở phía máy chủ — không chỉ ngừng vẽ chữ. Một stream bị bỏ
   * rơi vẫn chảy tiếp và vẫn tính credit.
   *
   * `serverClient.chat()` nhận đúng `AbortSignal` này làm tuỳ chọn `signal`
   * của `fetch()` — huỷ nó đóng THẬT kết nối TCP, không cần một thông điệp
   * huỷ riêng như Pha 1 từng phải dựng cho `postMessage` (xem `serverClient.
   * ts`'s doc comment).
   */
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;
    // Huỷ KHÔNG phải lỗi: giữ nguyên phần chữ đã nhận, quay về `idle`.
    setState('idle');
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setTurns([]);
    setState('idle');
  }, []);

  const ask = useCallback(
    async (prompt: string, ctx?: AskContext): Promise<void> => {
      abortRef.current?.abort();

      const id = (nextId.current += 1);
      // `question` HIỂN THỊ (ngắn, đúng thứ người học gõ) tách khỏi `question`
      // GỬI ĐI (có thể mang theo cả khối ngữ cảnh của `ctx.system`) — xem
      // `AskContext.system`'s doc comment.
      const turn: AITurn = { id, question: prompt, answer: '', failure: null };

      const ac = new AbortController();
      abortRef.current = ac;

      setTurns((prev) => [...prev, turn]);
      setState('streaming');

      const wireQuestion = ctx?.system ? `${ctx.system}\n\n${prompt}` : prompt;

      try {
        await chat(
          { question: wireQuestion, courseSlug: ctx?.courseSlug ?? '' },
          (text) => {
            if (ac.signal.aborted) return;
            patch(id, (t0) => ({ ...t0, answer: t0.answer + text }));
          },
          ac.signal,
        );
        if (ac.signal.aborted) return;
        setState('done');
      } catch (e) {
        // Một lời gọi đã huỷ hỏng theo đúng thiết kế; nó không được hiện ra như
        // một lỗi của nhà cung cấp.
        if (ac.signal.aborted) return;
        const code: ServerAIErrorCode = e instanceof ServerAIError ? e.code : 'Network';
        // `patch` GIỮ NGUYÊN `t0.answer` — nó chỉ đổi `failure`, không đụng
        // `answer`. Đây là toàn bộ cơ chế đứng sau "SSE đứt giữa chừng giữ
        // lại phần đã nhận": `serverClient.chat()` đã gọi `onChunk` cho mọi
        // mảnh tới trước khi kết nối hỏng (xem `serverClient.ts`'s doc
        // comment), nên `t0.answer` ở đây đã mang những mảnh ấy; dòng dưới
        // không xoá gì cả, chỉ THÊM `failure`.
        patch(id, (t0) => ({ ...t0, failure: { code, message: describeFailure(code, t) } }));
        setState('error');
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [patch, t],
  );

  const error = turns.length > 0 ? turns[turns.length - 1].failure : null;

  return { ask, turns, state, error, cancel, reset };
}
