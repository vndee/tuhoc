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

/**
 * Trần Go áp cho MỘT `question` — `MaxQuestionChars`,
 * `apps/api/internal/ai/handler.go`. RUNES (điểm mã Unicode), không phải
 * UTF-16 code unit hay byte: Go đếm bằng `utf8.RuneCountInString`.
 *
 * CON SỐ NÀY SỐNG Ở HAI NƠI — Go và đây — mà KHÔNG có cổng runtime nào canh
 * chúng khớp nhau; chỉ có tên biến trỏ sang nhau và người đọc mã bằng mắt.
 * Nếu Go đổi `MaxQuestionChars`, hằng số này phải đổi theo bằng tay.
 *
 * VÌ SAO HẰNG SỐ NÀY BẮT BUỘC PHẢI TỒN TẠI (đo được, không phải phòng xa):
 * `chapterSystemPrompt` (`./prompts.ts`) một mình đã dựng một `system` dài
 * ~7994–7995 rune trên MỌI chương thật của cả hai gói mẫu (`fixtures/
 * courses/`) — ngân sách `CHAPTER_CONTEXT_LIMIT = 8_000` của nó là một trần
 * CŨ, từ lúc `system` còn là một vai riêng trên dây (Pha 1) và không biết gì
 * về trần MỚI trên `question` gộp. Không kẹp ở đây, "Hỏi về chương" hỏng với
 * MỌI câu hỏi dài hơn khoảng sáu ký tự, trên MỌI chương đang tồn tại — xem
 * bài dùng fixture thật trong `useAI.test.tsx`.
 */
export const MAX_WIRE_QUESTION_CHARS = 8000;

/** Ký tự nối `system` và `prompt` khi gộp thành một `question` — xem
 *  `buildWireQuestion`. Tính vào ngân sách, không phải miễn phí. */
const WIRE_CONTEXT_SEPARATOR = '\n\n';

/**
 * Đếm RUNE, không phải `.length` (UTF-16 code unit). Một ký tự ngoài mặt
 * phẳng cơ bản (một số emoji, ký hiệu hiếm) chiếm HAI code unit nhưng MỘT
 * rune — `.length` đếm gấp đôi những ký tự đó, và trần phía Go đếm rune.
 * Tiếng Việt có dấu (tổ hợp hay dựng sẵn) đều nằm trong mặt phẳng cơ bản nên
 * không lệch, nhưng hàm này không được phép giả định trước điều đó.
 */
function runeLength(s: string): number {
  return Array.from(s).length;
}

/** Cắt `s` về ĐÚNG `limit` rune đầu — an toàn với surrogate pair, khác
 *  `s.slice(0, limit)` (có thể cắt đôi một rune ngoài mặt phẳng cơ bản). */
function runeSlice(s: string, limit: number): string {
  return Array.from(s).slice(0, Math.max(0, limit)).join('');
}

/**
 * Ghép `system` (ngữ cảnh, có thể vắng) và `prompt` (câu người học vừa gõ)
 * thành MỘT `question` gửi đi — kẹp để tổng KHÔNG BAO GIỜ vượt
 * `MAX_WIRE_QUESTION_CHARS`, dù `system` một mình đã gần lấp đầy trần đó.
 *
 * ƯU TIÊN CẮT: `system` bị cắt TRƯỚC, `prompt` chỉ bị cắt khi `system` đã về
 * 0 mà tổng vẫn vượt trần (câu hỏi cực dài, hiếm). Cắt ngữ cảnh chỉ làm câu
 * trả lời kém chính xác hơn; cắt câu người học VỪA GÕ là cắt đúng thứ họ
 * đang chờ được trả lời — và họ không thấy phần bị cắt để biết mà gõ lại.
 */
export function buildWireQuestion(system: string | undefined, prompt: string): string {
  if (!system) {
    return runeLength(prompt) > MAX_WIRE_QUESTION_CHARS ? runeSlice(prompt, MAX_WIRE_QUESTION_CHARS) : prompt;
  }
  const clampedPrompt =
    runeLength(prompt) > MAX_WIRE_QUESTION_CHARS ? runeSlice(prompt, MAX_WIRE_QUESTION_CHARS) : prompt;
  const budgetForSystem =
    MAX_WIRE_QUESTION_CHARS - runeLength(WIRE_CONTEXT_SEPARATOR) - runeLength(clampedPrompt);
  if (budgetForSystem <= 0) return clampedPrompt;
  const clampedSystem = runeLength(system) > budgetForSystem ? runeSlice(system, budgetForSystem) : system;
  return `${clampedSystem}${WIRE_CONTEXT_SEPARATOR}${clampedPrompt}`;
}

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
 * MỌI mã có một hành động RIÊNG người học có thể làm PHẢI dẫn tới một khoá
 * dịch RIÊNG — không chỉ `NoCredit` khác `ProviderFailed`. Đây là bài học
 * lặp lại từ 13 task phía Go: "fixture đặt hai giá trị khác nhau lại bằng
 * nhau làm mọi phép hoán vị giữa chúng vô hình," và review vòng 1 của chính
 * task này đo được nó SỐNG SÓT ở đây một lần: bộ kiểm ban đầu chỉ ghim CẶP
 * `NoCredit`/`ProviderFailed`, và một đột biến gộp NĂM mã còn lại vào một
 * câu (`ToolBudgetExhausted` mượn câu của `ProviderFailed`) vẫn xanh. Sáu mã
 * dưới đây — `NoCredit`, `RateLimited`, `ProviderFailed`,
 * `ToolBudgetExhausted`, `Unauthenticated`, `FieldTooLong` — mỗi mã một câu,
 * và `useAI.test.tsx` ghim từng câu bằng CHÍNH khoá dịch của nó (không so
 * chuỗi tiếng Việt viết tay hai lần — so với `t('vi', 'ai.error.<key>')`),
 * cộng một khẳng định "sáu câu khác nhau đôi một" bắt được MỌI cặp gộp, kể
 * cả cặp bài kiểm ban đầu chưa nghĩ tới.
 *
 * Bốn mã còn lại — `InvalidBody`/`FieldRequired`/`UnknownTool`/`Internal` —
 * GỘP chung một câu CÓ CHỦ Ý (`requestRejected`): cả bốn là dấu hiệu một lỗi
 * của chính trang chính hoặc một sự cố máy chủ không phân loại được, không
 * phải điều người học gây ra hay sửa được bằng một hành động cụ thể, nên
 * không có bốn câu khuyên hành động khác nhau để bịa ra. `FieldTooLong` bị
 * kéo RA khỏi xô này (khác bản đầu của task) vì nó KHÁC: câu hỏi/ngữ cảnh
 * quá dài là điều người học (hay `buildWireQuestion` ở trên, khi kẹp không
 * đủ) có thể sửa — "thử lại sau" là lời khuyên sai cho một điều kiện mà thử
 * lại nguyên văn không đổi gì.
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
    case 'FieldTooLong':
      return t('ai.error.fieldTooLong');
    case 'Network':
      return t('ai.error.network');
    case 'Aborted':
      // Không đường nào tới được màn hình bằng mã này — `ask()` trả về SỚM
      // khi `ac.signal.aborted`, trước khi chạm `describeFailure` (xem catch
      // bên dưới). Vẫn cần một câu ở đây vì kiểu `ServerAIErrorCode` không
      // loại trừ được nó lúc biên dịch.
      return t('ai.error.aborted');
    // InvalidBody/FieldRequired/UnknownTool/Internal — xem khối chú thích ở
    // trên cho lý do bốn mã này, và CHỈ bốn mã này, gộp chung một câu.
    case 'InvalidBody':
    case 'FieldRequired':
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

      const wireQuestion = buildWireQuestion(ctx?.system, prompt);

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
