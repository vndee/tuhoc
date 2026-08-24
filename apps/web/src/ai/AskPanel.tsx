import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageProvider';
import { useVaultFrame } from '../shell/VaultFrame';
import { useAI } from './useAI';

/**
 * PANEL HỎI–ĐÁP. Một khung duy nhất phục vụ cả hai lối vào của hệ thống con 2:
 * hỏi về **chương đang đọc** (Task 7) và **"Đào sâu"** một đoạn bôi đen
 * (Task 8). Hai lối vào chỉ khác nhau ở lời nhắc chúng dựng, và lời nhắc do
 * `./prompts` dựng — nên phần giao diện không cần biết cái nào gọi nó.
 *
 * PANEL NÀY KHÔNG BAO GIỜ CHẠM BÍ MẬT CỦA NGƯỜI DÙNG. Nó hỏi kho khoá đúng hai
 * câu — "đã cấu hình chưa" và "trả lời hộ câu này" — qua `postMessage`, và cả
 * hai câu đều không có trường nào chở được bí mật (`apps/vault/src/protocol.ts`,
 * và `./noKeyLeak.test.ts` canh điều đó).
 *
 * ĐIỀU ĐÁNG NÓI NHẤT là **phép hỏi trạng thái lúc mở**, và vì sao nó không phải
 * là một vòng mạng thừa.
 *
 * Không có nó, người chưa cắm key sẽ: mở panel → nhìn thấy một ô nhập → nghĩ ra
 * một câu hỏi → gõ → bấm → và chỉ lúc ấy mới biết tính năng chưa dùng được. Đó
 * là "lỗi cụt" mà kế hoạch cấm: nó tiêu công của người học trước khi nói cho họ
 * biết điều đáng biết. Hỏi trước đổi lấy một vòng `postMessage` **trong cùng
 * trình duyệt** (không ra mạng, không tốn tiền) để lấy về một màn hình nói đúng
 * việc cần làm và **đường đi tới chỗ làm việc đó**.
 */

export interface AskPanelProps {
  /** Tiêu đề panel — "Hỏi về chương" hay "Đào sâu". */
  readonly heading: string;
  /** Ngữ cảnh đã dựng sẵn, đặt vào vai `system`. Xem `./prompts`. */
  readonly system: string;
  /** Đoạn người học bôi đen, hiện lại cho họ thấy panel đang nói về cái gì. */
  readonly quote?: string;
  readonly initialQuestion?: string;
  /** Hỏi ngay khi mở, không đợi người học gõ. "Đào sâu" dùng cái này. */
  readonly autoAsk?: boolean;
  readonly onClose: () => void;
}

/**
 * Kho khoá đã sẵn sàng chưa — **theo hiểu biết lúc mở panel**.
 *
 * `probe_failed` tách khỏi `unavailable` có chủ ý, cùng lý do `vaultClient.ts`
 * tách `unavailable` khỏi `not_configured`: "khung không trả lời" và "bản dựng
 * này không có khung" cần hai câu khác nhau, và chỉ một trong hai đáng để người
 * dùng thử lại.
 */
type Probe = 'checking' | 'ready' | 'not_configured' | 'unavailable' | 'probe_failed';

export function AskPanel({
  heading,
  system,
  quote,
  initialQuestion = '',
  autoAsk = false,
  onClose,
}: AskPanelProps) {
  const { t } = useLanguage();
  const { client, origin } = useVaultFrame();
  const { ask, text, state, error, cancel } = useAI();
  const [question, setQuestion] = useState(initialQuestion);
  const [probe, setProbe] = useState<Probe>('checking');
  /** `autoAsk` được phép nổ ĐÚNG MỘT LẦN. Dưới StrictMode, React chạy effect
   *  hai lần; không có chốt này thì mỗi lần mở "Đào sâu" là hai lời gọi trả
   *  tiền, và người dùng không có cách nào nhìn thấy cái thứ hai. */
  const fired = useRef(false);

  useEffect(() => {
    /**
     * `origin`, KHÔNG phải `client`, là câu trả lời cho "bản dựng này có kho
     * khoá không". Hai thứ ấy khác nhau đúng một commit, và khác biệt ấy đã
     * được đo và ghi trong `shell/VaultFrame.tsx`: `client` chỉ dựng được sau
     * khi `<iframe>` vào DOM, nên nó rơi vào commit SAU phần tử khung. Đọc
     * `client` ở đây thì mỗi lần mở panel người dùng thấy một nhoáng "bản dựng
     * này không có kho khoá" rồi nó biến mất — một câu SAI, hiện ra đúng lúc
     * người ta đang đọc.
     */
    if (origin === null) {
      setProbe('unavailable');
      return;
    }
    if (!client) {
      setProbe('checking');
      return;
    }
    let alive = true;
    client.status().then(
      (s) => {
        if (alive) setProbe(s.configured ? 'ready' : 'not_configured');
      },
      () => {
        if (alive) setProbe('probe_failed');
      },
    );
    return () => {
      alive = false;
    };
  }, [client, origin]);

  const send = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      void ask(trimmed, { system });
    },
    [ask, system],
  );

  useEffect(() => {
    if (!autoAsk || probe !== 'ready' || fired.current) return;
    fired.current = true;
    send(initialQuestion);
  }, [autoAsk, probe, initialQuestion, send]);

  /**
   * Trạng thái lúc mở và lỗi lúc gửi CHẢY VÀO CÙNG MỘT MÀN HÌNH.
   *
   * Người học có thể gỡ key trong khung kho khoá sau khi panel đã hỏi xong
   * trạng thái. `useAI` hỏi lại ở mỗi lời gọi (đó là thiết kế của nó), nên
   * đường đi thứ hai này có thật — và nếu nó hiện ra một mã lỗi trần trong khi
   * đường thứ nhất hiện lời mời, thì cùng một hoàn cảnh có hai bộ mặt.
   */
  const needsSetup = probe === 'not_configured' || error?.code === 'not_configured';
  const unavailable = probe === 'unavailable' || error?.code === 'unavailable';
  const blocked = needsSetup || unavailable;
  const streaming = state === 'streaming';

  return createPortal(
    <aside className="ai-panel" role="dialog" aria-label={heading}>
      <header className="ai-panel-bar">
        <b>{heading}</b>
        <button type="button" className="btn" aria-label={t('ai.panel.close')} onClick={onClose}>
          ×
        </button>
      </header>

      {quote && (
        <blockquote className="ai-panel-quote" data-testid="ai-quote">
          {quote}
        </blockquote>
      )}

      {needsSetup && (
        <div className="ai-panel-invite" data-testid="ai-needs-setup">
          <p>{t('ai.panel.needsSetup')}</p>
          <p>
            {/*
              `state`, không phải query string: `href` phải ở nguyên `/settings`
              (`e2e/s2.spec.ts` khoá đúng chuỗi ấy, và mục đang xem vốn không
              nằm trong URL — xem `pages/Settings.tsx`). Ý định đi kèm ở đây là
              thứ phân biệt "tôi vừa nói tôi cần cắm key" với "tôi bấm Cài đặt ở
              thanh bên"; thiếu nó thì Cài đặt phải đoán, và trước đây nó đoán
              bằng cách ném lớp phủ AI vào mặt tất cả mọi người.
            */}
            <Link className="btn primary" to="/settings" state={{ section: 'ai', openVault: true }}>
              {t('ai.panel.openSettings')}
            </Link>
          </p>
        </div>
      )}

      {unavailable && (
        <p className="ai-panel-invite" data-testid="ai-unavailable">
          {t('ai.panel.unavailable')}
        </p>
      )}

      {probe === 'probe_failed' && !error && (
        <p className="ai-panel-invite" data-testid="ai-probe-failed">
          {t('ai.panel.probeFailed')}
        </p>
      )}

      {(text || streaming) && (
        <div className="ai-panel-answer" data-testid="ai-answer" aria-live="polite">
          {text}
        </div>
      )}

      {error && !blocked && (
        <p className="ai-panel-error" role="alert">
          {error.message}
        </p>
      )}

      {!blocked && (
        <form
          className="ai-panel-ask"
          onSubmit={(e) => {
            e.preventDefault();
            send(question);
          }}
        >
          <label className="ai-panel-label" htmlFor="ai-question">
            {t('ai.panel.questionLabel')}
          </label>
          <textarea
            id="ai-question"
            rows={2}
            value={question}
            placeholder={t('ai.panel.questionPlaceholder')}
            onChange={(e) => {
              setQuestion(e.target.value);
            }}
          />
          {streaming ? (
            <button type="button" className="btn" onClick={cancel}>
              {t('ai.panel.stop')}
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={probe === 'checking'}>
              {t('ai.panel.ask')}
            </button>
          )}
        </form>
      )}
    </aside>,
    document.body,
  );
}

export default AskPanel;
