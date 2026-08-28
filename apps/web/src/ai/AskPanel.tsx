import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageProvider';
import { renderMarkdown } from './markdown';
import { useAI } from './useAI';

/**
 * PANEL HỎI–ĐÁP. Một khung duy nhất phục vụ cả hai lối vào của hệ thống con 2:
 * hỏi về **chương đang đọc** (Task 7) và **"Đào sâu"** một đoạn bôi đen
 * (Task 8). Hai lối vào chỉ khác nhau ở lời nhắc chúng dựng, và lời nhắc do
 * `./prompts` dựng — nên phần giao diện không cần biết cái nào gọi nó.
 *
 * PHA 2: AI chạy trên máy chủ, trả bằng credit — panel này không còn hỏi
 * "đã cấu hình chưa" lúc mở (đó là một câu hỏi Pha 1, khi mỗi người học tự
 * cắm key riêng và một thiết bị có thể chưa cắm gì). Máy chủ luôn có AI cấu
 * hình sẵn; trạng thái duy nhất còn đáng chặn ô nhập là HẾT CREDIT, và nó chỉ
 * lộ ra SAU một lượt hỏi thật (`useAI`'s `error.code === 'NoCredit'`) — không
 * còn một vòng dò trước khi gõ. Xem `useAI.ts`'s doc comment cho lý do sản
 * phẩm đầy đủ, và task-13-report.md cho quyết định bỏ vòng dò này.
 */

export interface AskPanelProps {
  /** Tiêu đề panel — "Hỏi về chương" hay "Đào sâu". */
  readonly heading: string;
  /**
   * Ngữ cảnh đã dựng sẵn (chương đang đọc, hay đoạn "Đào sâu") — `./prompts`
   * dựng nó. Tên trường giữ nguyên từ Pha 1 để `ChapterView.tsx`/`DeepDive.
   * tsx` (không thuộc bốn tệp Task 13 sở hữu) không phải sửa chữ ký gọi;
   * `useAI.ts` là nơi quyết định nó đi đâu trên dây (gộp vào `question`, vì
   * `chatRequest` phía Go không có vai `system` riêng — xem `AskContext`'s
   * doc comment).
   */
  readonly system: string;
  /** Đoạn người học bôi đen, hiện lại cho họ thấy panel đang nói về cái gì. */
  readonly quote?: string;
  readonly initialQuestion?: string;
  /** Hỏi ngay khi mở, không đợi người học gõ. "Đào sâu" dùng cái này. */
  readonly autoAsk?: boolean;
  readonly onClose: () => void;
}

export function AskPanel({
  heading,
  system,
  quote,
  initialQuestion = '',
  autoAsk = false,
  onClose,
}: AskPanelProps) {
  const { t } = useLanguage();
  const { ask, turns, state, error, cancel, reset } = useAI();
  const [expanded, setExpanded] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  /**
   * Cỡ do người dùng KÉO ra. `null` = chưa kéo lần nào, tức để CSS quyết định
   * (kể cả khi bấm "mở rộng"). Một giá trị mặc định bằng số sẽ khoá cứng panel
   * ở đúng cỡ ấy và làm nút mở rộng thành nút không làm gì.
   */
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [question, setQuestion] = useState(initialQuestion);
  /** `autoAsk` được phép nổ ĐÚNG MỘT LẦN. Dưới StrictMode, React chạy effect
   *  hai lần; không có chốt này thì mỗi lần mở "Đào sâu" là hai lời gọi trả
   *  tiền, và người dùng không có cách nào nhìn thấy cái thứ hai. */
  const fired = useRef(false);

  const send = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      // Ô câu hỏi trống lại sau khi gửi. Giữ nguyên chữ cũ ở đó là mời người
      // dùng bấm Hỏi lần nữa và trả tiền cho đúng một câu hỏi hai lần.
      setQuestion('');
      void ask(trimmed, { system });
    },
    [ask, system],
  );

  /**
   * Cuộn xuống đáy khi chữ dài ra — nhưng CHỈ khi người đọc đang ở gần đáy.
   *
   * Kéo họ xuống trong lúc họ vừa cuộn ngược lên đọc lại lượt trước là cách
   * chắc chắn nhất để một khung chat thành thứ không đọc được.
   */
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [turns]);

  /**
   * Không còn vòng dò trước khi gõ (Pha 1 có — xem `AskPanelProps`'s doc
   * comment). "Đào sâu" hỏi ngay khi mở, và nếu tài khoản hết credit thì
   * lượt ấy tự hỏng với `NoCredit` — chốt `fired` vẫn cần, cùng lý do cũ
   * (StrictMode chạy effect hai lần).
   */
  useEffect(() => {
    if (!autoAsk || fired.current) return;
    fired.current = true;
    send(initialQuestion);
  }, [autoAsk, initialQuestion, send]);

  /**
   * HẾT CREDIT là trạng thái CHẶN duy nhất còn lại — Pha 1 có thêm
   * `not_configured`/`unavailable` (chưa cắm key / bản dựng không có kho
   * khoá), cả hai không còn ý nghĩa khi AI chạy trên máy chủ đã cấu hình sẵn.
   * Mọi mã lỗi KHÁC (`ProviderFailed`, `RateLimited`, `ToolBudgetExhausted`…)
   * hiện như một lỗi bình thường trong lượt, không chặn ô nhập — người học
   * vẫn hỏi tiếp được ngay.
   */
  const needsSetup = error?.code === 'NoCredit';
  const blocked = needsSetup;
  const streaming = state === 'streaming';

  /**
   * KÉO ĐỂ ĐỔI CỠ, từ góc TRÊN–TRÁI.
   *
   * Panel neo ở góc dưới–phải (`position: fixed; right; bottom`), nên góc đối
   * diện là góc duy nhất kéo ra được mà không phải đổi cả hệ neo: kéo lên và
   * sang trái thì hai cạnh kia đứng yên, và panel lớn ra về phía màn hình
   * trống. Kéo từ góc dưới–phải sẽ đẩy panel ra ngoài khung nhìn.
   *
   * `setPointerCapture` chứ không phải nghe `mousemove` trên `document`: nó giữ
   * được cả khi con trỏ chạy ra ngoài cửa sổ hoặc lướt qua một `<iframe>` — và
   * trang này CÓ một iframe (khung kho khoá), thứ nuốt sự kiện chuột của trang
   * cha. Không có capture thì kéo qua nó là mất luôn thao tác kéo.
   */
  const onResizeStart = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    /**
     * `grip` và `pointerId` được GIỮ RA BIẾN NGAY, không đọc lại từ `e` sau này.
     *
     * `e.currentTarget` của một sự kiện React chỉ có giá trị TRONG lúc React
     * phát sự kiện; xong lượt phát nó về `null`. Bản đầu của hàm này gỡ listener
     * bằng `e.currentTarget.removeEventListener(...)` bên trong `onUp` — thứ
     * chạy sau đó rất lâu — nên lệnh gỡ nổ vào `null` và KHÔNG listener nào
     * được gỡ. Hệ quả đúng như người dùng mô tả: kéo một lần rồi buông, sau đó
     * chỉ cần rê chuột ngang tay kéo là panel lại chạy theo chuột, vĩnh viễn.
     */
    const grip = e.currentTarget;
    const pointerId = e.pointerId;
    const panel = grip.closest('.ai-panel');
    if (!(panel instanceof HTMLElement)) return;
    e.preventDefault();
    grip.setPointerCapture(pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const rect = panel.getBoundingClientRect();

    const onMove = (move: PointerEvent) => {
      setSize({
        // Kéo sang TRÁI (dx âm) là rộng ra, nên dấu trừ. Chặn dưới ở 22rem/14rem
        // để panel không co về một mẩu không đọc được và không kéo được nữa;
        // chặn trên ở khung nhìn trừ hai lề.
        w: Math.max(320, Math.min(window.innerWidth - 32, rect.width - (move.clientX - startX))),
        h: Math.max(220, Math.min(window.innerHeight - 32, rect.height - (move.clientY - startY))),
      });
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      // Trả lại capture cho trình duyệt. `pointerup` tự thả, nhưng
      // `pointercancel` (chạm bị hệ điều hành cắt ngang) thì không chắc — và
      // một con trỏ còn bị giữ là một trang không bấm được ở đâu khác nữa.
      if (grip.hasPointerCapture?.(pointerId)) grip.releasePointerCapture(pointerId);
    };
    grip.addEventListener('pointermove', onMove);
    // `once` cho cả hai đường kết thúc: buông chuột, và thao tác bị cắt ngang.
    grip.addEventListener('pointerup', onUp, { once: true });
    grip.addEventListener('pointercancel', onUp, { once: true });
  }, []);

  return createPortal(
    <aside
      className={expanded ? 'ai-panel is-expanded' : 'ai-panel'}
      role="dialog"
      aria-label={heading}
      style={size ? { width: size.w, height: size.h, maxHeight: 'none' } : undefined}
    >
      {/*
        Tay kéo là một `<button>` chứ không phải một `<div>`: nó nhận focus, nên
        người dùng bàn phím ít nhất TAB tới được và biết nó có ở đó. Đổi cỡ bằng
        phím thì chưa có — nói ra chứ không giả vờ, và `aria-label` không hứa
        điều panel không làm được.
      */}
      <button
        type="button"
        className="ai-panel-grip"
        aria-label={t('ai.panel.resize')}
        onPointerDown={onResizeStart}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M11 1L1 11M11 5L5 11M11 9L9 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
      <header className="ai-panel-bar">
        <b>{heading}</b>
        <span className="ai-panel-bar-actions">
          {turns.length > 0 && (
            <button type="button" className="ai-panel-bar-btn" onClick={reset}>
              {t('ai.panel.newThread')}
            </button>
          )}
          {/* MỞ RỘNG. Một câu trả lời có khối mã và công thức không đọc được
              trong một cột 320px, và đó là hình dạng mặc định của panel này. */}
          <button
            type="button"
            className="ai-panel-bar-btn"
            aria-label={t(expanded ? 'ai.panel.collapse' : 'ai.panel.expand')}
            aria-pressed={expanded}
            onClick={() => {
              // Bỏ cỡ đã kéo tay. Một cỡ inline thắng mọi luật CSS, nên sau khi
              // người dùng kéo một lần thì nút này im lặng không làm gì — đúng
              // thứ vừa được báo là hỏng. Bấm mở rộng là nói "cho tôi cỡ chuẩn",
              // nên nó phải trả quyền quyết định lại cho CSS.
              setSize(null);
              setExpanded((on) => !on);
            }}
          >
            {expanded ? '⤡' : '⤢'}
          </button>
          <button
            type="button"
            className="ai-panel-bar-btn"
            aria-label={t('ai.panel.close')}
            onClick={onClose}
          >
            ×
          </button>
        </span>
      </header>

      {needsSetup && (
        <div className="ai-panel-invite" data-testid="ai-needs-setup">
          <p>{t('ai.panel.noCredit')}</p>
          <p>
            {/*
              `state`, không phải query string: `href` phải ở nguyên `/settings`
              và mục đang xem vốn không nằm trong URL — xem `pages/Settings.
              tsx`. Ý định đi kèm ở đây là thứ phân biệt "tôi vừa nói tôi hết
              credit" với "tôi bấm Cài đặt ở thanh bên"; thiếu nó thì Cài đặt
              phải đoán.
            */}
            <Link className="btn primary" to="/settings" state={{ section: 'ai' }}>
              {t('ai.panel.openSettings')}
            </Link>
          </p>
        </div>
      )}

      {/*
        CẢ CUỘC HỘI THOẠI, không chỉ câu trả lời cuối. `aria-live="polite"` ở
        vùng bao chứ không ở từng lượt: một `aria-live` cho mỗi lượt sẽ đọc lại
        toàn bộ lượt cũ mỗi lần thêm một lượt mới.
      */}
      {/*
        MỘT vùng cuộn, không phải ba.

        Trước đây panel tự cuộn, hội thoại cuộn, và khối trích dẫn cũng có
        `max-height` cộng `overflow-y` của riêng nó — ba thanh cuộn lồng nhau
        trên một khung rộng 30rem. Người dùng gọi đúng tên nó, và cái giá thật
        không chỉ là xấu: với ba vùng cuộn thì bánh xe chuột dừng ở vùng nào là
        chuyện may rủi.

        Nay chỉ khối này cuộn. Trích dẫn nằm TRONG nó — nó là phần mở đầu của
        cuộc hội thoại chứ không phải một thanh công cụ — nên nó cuộn đi cùng và
        hiện ra TRỌN VẸN thay vì bị cắt ở 7rem.
      */}
      <div className="ai-panel-thread" ref={threadRef} data-testid="ai-thread" aria-live="polite">
        {quote && (
          <blockquote className="ai-panel-quote" data-testid="ai-quote">
            {quote}
          </blockquote>
        )}
        {turns.length > 0 && (
          <>
          {turns.map((turn, index) => (
            <div className="ai-turn" key={turn.id}>
              <p className="ai-turn-q">{turn.question}</p>
              {turn.answer !== '' && (
                /*
                  `ai-answer` ở trên CÂU TRẢ LỜI CUỐI, không phải trên cả khung
                  hội thoại — và đó là một sửa chữa do e2e chỉ ra, không phải một
                  chi tiết. Khi tôi gắn nó lên khung, `toHaveText(FULL_ANSWER)`
                  bắt đầu thấy cả đoạn trích và cả câu hỏi của người học trộn vào
                  câu trả lời, còn `toHaveCount(0)` (dùng để khẳng định "chưa có
                  câu trả lời nào") thì không bao giờ về 0 nữa vì khung luôn được
                  dựng. Cái tên phải chỉ đúng thứ nó tên.
                */
                <div className="ai-turn-a" data-testid={index === turns.length - 1 ? 'ai-answer' : undefined}>
                  {renderMarkdown(turn.answer)}
                </div>
              )}
              {turn.failure && !blocked && (
                <p className="ai-panel-error" role="alert">
                  {turn.failure.message}
                </p>
              )}
              {turn.answer === '' && !turn.failure && streaming && (
                <p className="ai-turn-wait">{t('ai.panel.thinking')}</p>
              )}
            </div>
          ))}
          </>
        )}
      </div>

      {error && !blocked && turns.length === 0 && (
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
            <button type="submit" className="btn primary">
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
