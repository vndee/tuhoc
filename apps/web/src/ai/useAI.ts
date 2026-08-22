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

export interface UseAIResult {
  ask: (prompt: string, ctx?: AskContext) => Promise<void>;
  text: string;
  state: AIState;
  error: AIFailure | null;
  cancel: () => void;
}

export function useAI(): UseAIResult {
  const { t } = useLanguage();
  const { client } = useVaultFrame();
  const [text, setText] = useState('');
  const [state, setState] = useState<AIState>('idle');
  const [error, setError] = useState<AIFailure | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const ask = useCallback(
    async (prompt: string, ctx?: AskContext): Promise<void> => {
      abortRef.current?.abort();

      if (!client) {
        abortRef.current = null;
        setText('');
        setState('error');
        setError({
          code: 'unavailable',
          message: t('ai.error.unavailable'),
        });
        return;
      }

      const ac = new AbortController();
      abortRef.current = ac;
      setText('');
      setError(null);
      setState('streaming');

      try {
        // Hỏi trạng thái ở MỖI lần, không nhớ lại: người học vừa cắm key trong
        // khung kho khoá xong là dùng được ngay, không phải tải lại trang.
        const status = await client.status();
        if (ac.signal.aborted) return;
        if (!status.configured || !status.providerId || !status.model) {
          throw new VaultError(
            'not_configured',
            t('ai.error.notConfigured'),
          );
        }

        const messages: ChatMessage[] = [
          ...(ctx?.system ? ([{ role: 'system', content: ctx.system }] as ChatMessage[]) : []),
          { role: 'user', content: prompt },
        ];

        await client.chat(
          { providerId: status.providerId, model: status.model, messages },
          (chunk) => {
            if (ac.signal.aborted) return;
            setText((prev) => prev + chunk);
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
        setError(fail);
        setState('error');
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [client, t],
  );

  return { ask, text, state, error, cancel };
}
