import { Component, type ErrorInfo, type ReactNode } from 'react';
import { DEFAULT_LANG, readStoredLang, t } from '../i18n';

/**
 * Ngôn ngữ ĐỌC THẲNG TỪ THIẾT BỊ, không qua `useLanguage()`.
 *
 * Hai lý do, và cái thứ hai là cái quyết định:
 *
 *   1. đây là một class component (React vẫn chưa có `componentDidCatch`
 *      dạng hook), nên không có hook nào gọi được ở đây;
 *   2. **lớp này phải chạy được ngay cả khi cây React ở trên nó đã hỏng.**
 *      Nếu thứ vừa ném là `<LanguageProvider>`, một `useContext` ở đây sẽ
 *      ném lần thứ hai (`useLanguage()` NÉM ngoài provider, có chủ ý) và
 *      trang trắng — đúng thứ tệp này tồn tại để không bao giờ xảy ra nữa —
 *      quay lại.
 *
 * `readStoredLang()` chỉ đọc `localStorage` qua `db/local.ts` và trả `null`
 * cho mọi thứ nó không đọc được, nên nó không có đường nào để ném.
 */
function lang() {
  return readStoredLang() ?? DEFAULT_LANG;
}

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly error: Error | null;
}

/**
 * The last thing between a render error and a blank page.
 *
 * Without it, one `TypeError` thrown during render unmounts the entire React
 * tree: `#root` ends up empty and the reader sees white — no message, no
 * navigation, nothing to report. Measured 2026-08-22 on a production build
 * with the API unreachable: `document.body.innerHTML === '<div id="root">
 * </div>'`, and every unit gate stayed green throughout.
 *
 * That silence is the point. `docs/carried-forward.md` records five "blind
 * gates" whose common shape is *a gate measures what it can reach, and stays
 * quiet exactly where it cannot*. A white screen is the same family from the
 * user's side: the app fails in the one way that produces no evidence. This
 * converts that class into a visible, reportable state.
 *
 * Deliberately a class component: as of React 19 there is still no hook form
 * of `componentDidCatch`.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept: this is the only surviving trace once the tree is gone, and the
    // component stack is what turns "something threw" into "this screen threw".
    console.error(t(lang(), 'error.boundary.log'), error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="eb-fallback" role="alert">
        <h1 className="eb-title">{t(lang(), 'error.boundary.title')}</h1>
        <p className="eb-body">{t(lang(), 'error.boundary.body')}</p>
        <pre className="eb-detail">{error.message}</pre>
        <button className="btn" type="button" onClick={() => window.location.reload()}>
          {t(lang(), 'error.boundary.reload')}
        </button>
      </div>
    );
  }
}
