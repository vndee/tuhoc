import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n/LanguageProvider';
import { useVaultFrame } from '../shell/VaultFrame';
import { VaultError } from './vaultClient';
import type { ChatMessage, VaultClientErrorCode } from './vaultClient';

/**
 * Hook hỏi–đáp AI. Nó KHÔNG BAO GIỜ chạm tới bí mật của người dùng: nó hỏi kho
 * khoá "đã cấu hình chưa, bằng nhà cung cấp nào", rồi gửi lời nhắc và nhận chữ.
 */

export type AIState = 'idle' | 'streaming' | 'done' | 'error';

export interface AskContext {
  /** Ngữ cảnh đặt vào vai `system` — Task 7/8 dựng nó từ chương đang đọc. */
  system?: string;
}

export interface AIFailure {
  code: VaultClientErrorCode;
  message: string;
}

/**
 * MỘT LƯỢT: câu hỏi của người học, và câu trả lời đang/đã chảy về.
 *
 * Trước đây hook này chỉ giữ MỘT chuỗi `text`, và `ask()` mở đầu bằng
 * `setText('')`. Hệ quả là hai điều mà người dùng báo cùng lúc: hỏi câu thứ hai
 * thì câu thứ nhất biến mất khỏi màn hình, và mô hình cũng không thấy nó — lời
 * gọi chỉ mang `[system, user]`, nên "hỏi tiếp" thật ra là hỏi lại từ đầu mỗi
 * lần. Cả hai đều là cùng một thiếu sót: không có cuộc hội thoại nào được giữ.
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
  /** Cả cuộc hội thoại, cũ trước mới sau. */
  turns: readonly AITurn[];
  state: AIState;
  /** Lỗi của lượt CUỐI, giữ lại cho những chỗ chỉ cần biết "vừa hỏng gì". */
  error: AIFailure | null;
  cancel: () => void;
  /** Xoá cuộc hội thoại. Không đụng tới kho khoá hay nhật ký của nó. */
  reset: () => void;
}

export function useAI(): UseAIResult {
  const { t } = useLanguage();
  const { client } = useVaultFrame();
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
   * gọi phải dừng ở phía kho khoá — không chỉ ngừng vẽ chữ. Một stream bị bỏ
   * rơi vẫn chảy tiếp và vẫn tính tiền vào key của chính họ.
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
      const turn: AITurn = { id, question: prompt, answer: '', failure: null };

      if (!client) {
        abortRef.current = null;
        setTurns((prev) => [...prev, { ...turn, failure: { code: 'unavailable', message: t('ai.error.unavailable') } }]);
        setState('error');
        return;
      }

      const ac = new AbortController();
      abortRef.current = ac;

      /**
       * LỊCH SỬ ĐỌC RA TỪ STATE HIỆN TẠI, trong chính lần cập nhật thêm lượt mới.
       *
       * `turns` bắt được trong closure có thể đã cũ nếu hai lời gọi đi sát nhau,
       * nên lịch sử được lấy từ `prev` — bản mà React đảm bảo là mới nhất — thay
       * vì từ biến ngoài.
       */
      let history: readonly AITurn[] = [];
      setTurns((prev) => {
        history = prev;
        return [...prev, turn];
      });
      setState('streaming');

      try {
        // Hỏi trạng thái ở MỖI lần, không nhớ lại: người học vừa cắm key trong
        // khung kho khoá xong là dùng được ngay, không phải tải lại trang.
        const status = await client.status();
        if (ac.signal.aborted) return;
        if (!status.configured || !status.providerId || !status.model) {
          throw new VaultError('not_configured', t('ai.error.notConfigured'));
        }

        /**
         * CẢ CUỘC HỘI THOẠI, không chỉ câu vừa gõ — đó là cả nội dung của việc
         * "hỏi tiếp". Một lượt hỏng (không có câu trả lời) thì KHÔNG vào lịch
         * sử: gửi một câu hỏi kèm một câu trả lời rỗng dạy mô hình rằng im lặng
         * là một câu trả lời hợp lệ.
         *
         * Cái giá nói thẳng: mỗi lượt gửi lại toàn bộ những lượt trước, nên số
         * ký tự rời máy tăng theo bình phương độ dài hội thoại. Đó không phải
         * một con số giấu đi được — kho khoá đếm nó, hiện nó trong nhật ký "đã
         * gửi đi những gì", và chặn khi vượt hạn mức phiên. Nút "Hội thoại mới"
         * là cách người đọc tự cắt nó.
         */
        const messages: ChatMessage[] = [
          ...(ctx?.system ? ([{ role: 'system', content: ctx.system }] as ChatMessage[]) : []),
          ...history.flatMap((past): ChatMessage[] =>
            past.answer === ''
              ? []
              : [
                  { role: 'user', content: past.question },
                  { role: 'assistant', content: past.answer },
                ],
          ),
          { role: 'user', content: prompt },
        ];

        await client.chat(
          { providerId: status.providerId, model: status.model, messages },
          (chunk) => {
            if (ac.signal.aborted) return;
            patch(id, (t0) => ({ ...t0, answer: t0.answer + chunk }));
          },
          ac.signal,
        );
        if (ac.signal.aborted) return;
        setState('done');
      } catch (e) {
        // Một lời gọi đã huỷ hỏng theo đúng thiết kế; nó không được hiện ra như
        // một lỗi của nhà cung cấp.
        if (ac.signal.aborted) return;
        const fail =
          e instanceof VaultError
            ? { code: e.code, message: e.message }
            : { code: 'provider_error' as const, message: String(e) };
        patch(id, (t0) => ({ ...t0, failure: fail }));
        setState('error');
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [client, patch, t],
  );

  const error = turns.length > 0 ? turns[turns.length - 1].failure : null;

  return { ask, turns, state, error, cancel, reset };
}
