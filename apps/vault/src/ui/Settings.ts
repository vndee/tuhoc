import { checkAndConsume, clearActivity, grantConsent, hasConsent, readActivity } from '../guard';
import type { GuardDecision } from '../guard';
import { clearConfig, readConfig, readPublicConfig, writeConfig } from '../keystore';
import type { PublicConfig, StoredConfig } from '../keystore';
import { getProvider, listProviders } from '../providers';
import { ProviderError } from '../providers/types';
import type { Provider } from '../providers/types';
import { renderVaultPanel } from './Consent';
import type { PanelDeps } from './Consent';
import './vault.css';

/**
 * MÀN CẤU HÌNH CỦA KHO KHOÁ — và ô dán key nằm ở đây, không ở trang chính.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * **Đây là ràng buộc quyết định toàn bộ hệ thống con, nên nó nằm ở dòng đầu.**
 *
 * Một ô nhập trên trang chính rồi `postMessage` vào đây sẽ dễ hơn nhiều — và nó
 * làm mọi thứ Task 1–5 dựng lên thành trang trí. Key gõ vào một `<input>` của
 * trang chính đi qua DOM của trang chính, và một course hạng `interactive` bị
 * duyệt sót đọc được nó bằng đúng một listener `input`. Không có phép mã hoá,
 * không có `type="password"`, không có "xoá ngay sau khi gửi" nào cứu được điều
 * đó: giá trị đã ở sai origin từ ký tự đầu tiên.
 *
 * Vì vậy form này chạy ở origin kho khoá, và trang chính chỉ **mở rộng khung**
 * ra cho người dùng nhìn thấy. Phía đối xứng có một bài kiểm riêng ở
 * `apps/web/src/pages/Settings.test.tsx`: trang cấu hình của trang chính không
 * được chứa MỘT `<input>` nào — không phải "không có ô tên là key", mà là không
 * có ô nào, vì một ô tên `q` cũng đọc được y hệt.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **Mọi chữ đi vào `textContent`, không `innerHTML`** — S1-F43: một gói hạng
 * `content` "an toàn theo định nghĩa" chạy được mã tuỳ ý qua đúng một
 * `innerHTML`, và bốn cổng đều cho qua. Đây là origin giữ key.
 *
 * **Không một `console.*` nào trong tệp này**, kể cả để gỡ lỗi. `settings.test.ts`
 * cắm bẫy sáu phương thức cho mọi bài kiểm.
 */

// ───────────────────────── phụ thuộc, tiêm được để kiểm ─────────────────────

export interface SettingsDeps {
  listProviders: () => Array<{ id: string; label: string }>;
  getProvider: (id: string) => Provider | null;
  readPublicConfig: () => PublicConfig | null;
  readConfig: () => StoredConfig | null;
  writeConfig: (c: StoredConfig) => void;
  clearConfig: () => void;
  checkAndConsume: (input: { chars: number; providerId: string }) => GuardDecision;
  panel: PanelDeps;
}

export function defaultSettingsDeps(): SettingsDeps {
  return {
    listProviders,
    getProvider,
    readPublicConfig,
    readConfig,
    writeConfig,
    clearConfig,
    checkAndConsume,
    panel: { hasConsent, grantConsent, readActivity, clearActivity },
  };
}

export interface SettingsHandle {
  /** Vẽ lại CHỈ phần xác nhận + nhật ký.
   *
   *  Không phải phần tối ưu: `main.ts` gọi hàm này sau **mọi** quyết định của
   *  người gác, tức là mỗi lần trang chính nhắn `chat` vào. Vẽ lại cả màn hình
   *  ở đó sẽ **xoá sạch key người dùng đang gõ dở** mỗi lần một course gọi —
   *  một cách phá tính năng mà không cổng nào hỏi tới. `settings.test.ts` có
   *  bẫy cho đúng chỗ này. */
  repaintPanel: () => void;
  /** Chờ hành động đang chạy (chỉ "Kiểm tra kết nối" là bất đồng bộ). Chỉ để
   *  test có chỗ bám; giao diện thật không gọi. */
  whenIdle: () => Promise<void>;
}

// ───────────────────────── hằng số ─────────────────────────

/**
 * Lời nhắc của nút "Kiểm tra kết nối". **Ngắn có chủ ý**: nút này gọi thật, tức
 * là tiêu tiền thật của người dùng, và một lời nhắc dài biến một phép thử thành
 * một khoản phí. Bài kiểm ghim độ dài lại để nó không phình ra theo thời gian.
 */
const TEST_PROMPT = 'Trả lời đúng một từ: OK';

/** Cắt phần trả lời hiện lại. Vòng lặp `break` ở đây cũng **huỷ luồng** (xem
 *  `finally` của `sseDataPayloads`), nên nó thật sự dừng cuộc gọi chứ không chỉ
 *  ngừng đọc. */
const TEST_REPLY_CHARS = 60;

/**
 * Cảnh báo riêng cho OpenAI — **một phép đo, không phải một linh cảm.**
 *
 * Task 3 dò ngày 2026-08-22 từ một trang thật, key giả: `POST` sinh chữ của
 * OpenAI trả 401 **không kèm** `Access-Control-Allow-Origin`, nên trình duyệt
 * chặn hồi đáp và `fetch` từ chối bằng `TypeError`. Bốn nhà cung cấp còn lại đọc
 * được 401 bình thường. Đường **200** (key thật) chưa ai đo được.
 *
 * Chủ dự án quyết **giữ OpenAI kèm cảnh báo**. Cảnh báo phải hiện **trước** khi
 * người dùng dán key vào: gặp sau mới hiểu là đúng cái "đi tìm lỗi ở chỗ không
 * có lỗi" mà báo cáo Task 3 đã lo — một key OpenAI hoàn toàn đúng vẫn cho ra
 * "không gọi được nhà cung cấp".
 */
const OPENAI_WARNING =
  'Cảnh báo đã đo được (2026-08-22): OpenAI chặn đường sinh chữ bằng CORS khi gọi thẳng từ '
  + 'trình duyệt — hồi đáp lỗi của họ không kèm Access-Control-Allow-Origin. Đường thành công '
  + 'chưa đo được, nên OpenAI có thể không dùng được ở đây, và nếu có thì lỗi sai key sẽ hiện '
  + 'ra là "không gọi được nhà cung cấp" chứ không phải "key bị từ chối". Hãy thử '
  + '"Kiểm tra kết nối" trước khi tin vào nó. DeepSeek, OpenRouter, Groq và Anthropic đều đã '
  + 'đo được là gọi thẳng từ trình duyệt được.';

function warningFor(providerId: string): string {
  return providerId === 'openai' ? OPENAI_WARNING : '';
}

// ───────────────────────── dựng DOM ─────────────────────────

function el(tag: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function field(labelText: string, control: HTMLElement, hint?: string): HTMLElement {
  const wrap = el('div');
  wrap.className = 'vault-field';
  const label = el('label', labelText) as HTMLLabelElement;
  const id = `vault-${control.dataset.role ?? 'x'}`;
  control.id = id;
  label.htmlFor = id;
  wrap.appendChild(label);
  wrap.appendChild(control);
  if (hint !== undefined) {
    const h = el('p', hint);
    h.className = 'vault-hint';
    wrap.appendChild(h);
  }
  return wrap;
}

function button(role: string, text: string): HTMLButtonElement {
  const b = el('button', text) as HTMLButtonElement;
  b.type = 'button';
  b.dataset.role = role;
  return b;
}

/**
 * Vẽ màn cấu hình vào `root`. Gọi một lần; phần động sau đó được cập nhật tại
 * chỗ, **không** dựng lại — xem `repaintPanel`.
 */
export function renderSettings(root: Element, deps: SettingsDeps): SettingsHandle {
  root.textContent = '';

  const providers = deps.listProviders();
  const stored = deps.readPublicConfig();

  // ── phần giải thích ──────────────────────────────────────────────────────
  root.appendChild(el('h2', 'Trợ lý AI chạy bằng key của chính bạn'));
  const why = el(
    'p',
    'Ô dán key nằm trong khung này, và khung này là một trang riêng ở một origin riêng. '
      + 'Trình duyệt cấm mã của trang bài học đọc bất cứ thứ gì ở đây — kể cả ô bên dưới, kể cả '
      + 'chỗ cất key. Trang bài học chỉ gửi câu hỏi vào và nhận chữ trả lời ra; nó không bao giờ '
      + 'thấy key. Đó là lý do ô này không nằm ở trang cấu hình bên ngoài.',
  );
  why.className = 'vault-note';
  root.appendChild(why);

  const current = el('p');
  current.dataset.role = 'current';
  current.className = 'vault-current';
  root.appendChild(current);

  // ── nhà cung cấp ─────────────────────────────────────────────────────────
  const providerSel = document.createElement('select');
  providerSel.dataset.role = 'provider';
  for (const p of providers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    // `textContent`, không `innerHTML`: nhãn hôm nay là hằng số của kho khoá,
    // nhưng "hôm nay là hằng số" là đúng cái lập luận đã hỏng ở S1-F43.
    opt.textContent = p.label;
    providerSel.appendChild(opt);
  }
  if (stored && providers.some((p) => p.id === stored.providerId)) {
    providerSel.value = stored.providerId;
  }
  root.appendChild(field('Nhà cung cấp', providerSel));

  const warning = el('p');
  warning.dataset.role = 'provider-warning';
  warning.className = 'vault-warn';
  root.appendChild(warning);

  // ── mô hình ──────────────────────────────────────────────────────────────
  const modelInput = document.createElement('input');
  modelInput.type = 'text';
  modelInput.dataset.role = 'model';
  modelInput.autocomplete = 'off';
  modelInput.spellcheck = false;
  root.appendChild(
    field('Mô hình', modelInput, 'Để nguyên nếu bạn không có lý do cụ thể để đổi.'),
  );

  // ── key ──────────────────────────────────────────────────────────────────
  const secretInput = document.createElement('input');
  // `password`: người dùng cấu hình ở quán cà phê vẫn phải an toàn với người
  // đứng sau lưng. `autocomplete="off"` để trình duyệt không cất thêm một bản
  // sao ở chỗ kho khoá không kiểm soát được.
  secretInput.type = 'password';
  secretInput.dataset.role = 'secret';
  secretInput.autocomplete = 'off';
  secretInput.spellcheck = false;
  secretInput.placeholder = 'Dán key của bạn vào đây';
  root.appendChild(
    field(
      'Key của bạn',
      secretInput,
      'Key ở lại đúng trình duyệt này, đúng thiết bị này. Nó không được đồng bộ, không đi qua '
        + 'máy chủ của chúng tôi, và không có cách nào lấy lại nếu bạn xoá — hãy giữ bản gốc ở '
        + 'trang của nhà cung cấp.',
    ),
  );

  // ── nút ──────────────────────────────────────────────────────────────────
  const actions = el('div');
  actions.className = 'vault-actions';
  const saveBtn = button('save', 'Lưu key trên máy này');
  const testBtn = button('test', 'Kiểm tra kết nối');
  const clearBtn = button('clear', 'Xoá key khỏi máy này');
  clearBtn.className = 'vault-danger';
  actions.appendChild(saveBtn);
  actions.appendChild(testBtn);
  actions.appendChild(clearBtn);
  root.appendChild(actions);

  const status = el('p');
  status.dataset.role = 'status';
  status.className = 'vault-status';
  // `aria-live`: kết quả của "Kiểm tra kết nối" tới sau vài giây và không có
  // tiêu điểm nào chuyển tới nó, nên người dùng đọc màn hình sẽ không biết gì
  // đã xảy ra.
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.appendChild(status);

  // ── khung xác nhận + nhật ký của Task 9, CÙNG màn hình ───────────────────
  //
  // Task 9 dặn: "renderVaultPanel đã có sẵn để nhúng vào màn cấu hình, đừng vẽ
  // nhật ký lần thứ hai." Và nó thuộc về đây vì lý do của chính Task 9: một nút
  // "cho phép" không kèm tầm nhìn vào những gì đã gửi đi là một con dấu cao su.
  const panelRoot = el('section');
  panelRoot.dataset.role = 'panel';
  panelRoot.className = 'vault-panel';
  root.appendChild(panelRoot);

  // ── trạng thái cục bộ ────────────────────────────────────────────────────

  /** Người dùng đã tự gõ tên mô hình chưa. Nếu rồi thì đổi nhà cung cấp KHÔNG
   *  được đè lên — đè đi là lặng lẽ đổi model mà họ vừa chọn có chủ ý. */
  let modelTouched = false;
  /** Nút xoá là hai bước; cờ này là bước một. */
  let clearArmed = false;
  let inflight: Promise<void> = Promise.resolve();

  function say(text: string): void {
    status.textContent = text;
  }

  function repaintPanel(): void {
    renderVaultPanel(panelRoot, deps.panel);
  }

  function refreshCurrent(): void {
    const cfg = deps.readPublicConfig();
    current.textContent = cfg
      ? `Máy này đã có key: ${cfg.providerId} · ${cfg.model}.`
      : 'Máy này chưa có key nào.';
  }

  function applyProvider(): void {
    warning.textContent = warningFor(providerSel.value);
    if (!modelTouched) {
      const p = deps.getProvider(providerSel.value);
      if (p) modelInput.value = p.defaultModel;
    }
  }

  function disarmClear(): void {
    if (!clearArmed) return;
    clearArmed = false;
    clearBtn.textContent = 'Xoá key khỏi máy này';
  }

  // ── hành vi ──────────────────────────────────────────────────────────────

  providerSel.addEventListener('change', () => {
    disarmClear();
    applyProvider();
  });

  modelInput.addEventListener('input', () => {
    modelTouched = true;
    disarmClear();
  });

  secretInput.addEventListener('input', disarmClear);

  saveBtn.addEventListener('click', () => {
    disarmClear();
    const secret = secretInput.value.trim();
    if (secret === '') {
      say('Chưa dán key nào vào ô bên trên.');
      return;
    }
    const model = modelInput.value.trim();
    if (model === '') {
      say('Chưa có tên mô hình.');
      return;
    }
    deps.writeConfig({ providerId: providerSel.value, model, apiKey: secret });
    // Xoá ô ngay: một key nằm lại trong DOM sau khi đã cất đi là một bản sao
    // thứ hai không ai cần, và nó sống tới khi khung bị đóng.
    secretInput.value = '';
    refreshCurrent();
    say('Đã lưu key vào trình duyệt này. Bấm "Kiểm tra kết nối" để chắc chắn nó dùng được.');
  });

  clearBtn.addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.textContent = 'Bấm lần nữa để xoá';
      say('Bấm lần nữa để xoá hẳn key khỏi trình duyệt này. Không có cách lấy lại.');
      return;
    }
    disarmClear();
    deps.clearConfig();
    secretInput.value = '';
    refreshCurrent();
    say('Đã xoá key khỏi trình duyệt này.');
  });

  testBtn.addEventListener('click', () => {
    disarmClear();
    inflight = runTest();
  });

  /**
   * "Kiểm tra kết nối" — gọi THẬT, và đi qua ĐÚNG người gác của Task 9.
   *
   * **Vì sao không đi tắt**, dù cú bấm này rõ ràng là của người thật ở đúng
   * origin: `guard.ts` tự mô tả mình là *"cửa DUY NHẤT dẫn ra mạng"*, và một
   * đường vòng ở đây làm câu ấy sai mà không cổng nào hỏi. Hệ quả cụ thể hơn:
   * nhật ký hoạt động nằm ngay bên dưới nút này sẽ nói "Chưa có lời gọi nào"
   * ngay sau khi một lời gọi thật vừa rời máy — và một nhật ký nói dối còn tệ
   * hơn không có nhật ký.
   *
   * Cái giá là lời gọi kiểm tra ĐẦU PHIÊN bị từ chối với `needs_consent`. Đó
   * không phải phiền toái: nút xác nhận nằm ngay bên dưới, cùng màn hình, và
   * việc cú bấm ấy là bắt buộc chính là cơ chế. Tự cấp quyền ở đây là mutant
   * M13 của Task 9 ("vẽ khung ra là tự cấp quyền"), đã bị giết một lần.
   */
  async function runTest(): Promise<void> {
    const providerId = providerSel.value;
    const model = modelInput.value.trim();
    if (model === '') {
      say('Chưa có tên mô hình.');
      return;
    }

    const typed = secretInput.value.trim();
    let key = typed;
    if (key === '') {
      // Ô trống ⇒ dùng key đã lưu, nhưng CHỈ khi nó thuộc đúng nhà cung cấp
      // đang chọn. Gửi key DeepSeek sang Anthropic là gửi bí mật của người dùng
      // cho một bên không được phép thấy nó, chỉ vì một ô select bị đổi.
      const cfg = deps.readConfig();
      if (cfg && cfg.providerId === providerId) key = cfg.apiKey;
    }
    if (key === '') {
      say('Chưa dán key nào, và máy này cũng chưa lưu key cho nhà cung cấp đang chọn.');
      return;
    }

    const decision = deps.checkAndConsume({ chars: TEST_PROMPT.length, providerId });
    repaintPanel();
    if (!decision.allow) {
      say(
        decision.code === 'needs_consent'
          ? 'Kho khoá chưa được xác nhận trong phiên này. Bấm nút "Cho phép trong phiên này" '
            + 'ngay bên dưới rồi thử lại.'
          : (decision.message ?? 'Kho khoá đang từ chối lời gọi này.'),
      );
      return;
    }

    const provider = deps.getProvider(providerId);
    if (!provider) {
      say('Kho khoá không biết nhà cung cấp này.');
      return;
    }

    testBtn.disabled = true;
    say('Đang gọi nhà cung cấp…');
    try {
      let reply = '';
      for await (const chunk of provider.chat(
        { model, messages: [{ role: 'user', content: TEST_PROMPT }] },
        key,
      )) {
        reply += chunk;
        // `break` chạy `finally` của bộ đọc luồng, tức là HUỶ kết nối — không
        // chỉ ngừng đọc và bỏ lại một kết nối treo.
        if (reply.length >= TEST_REPLY_CHARS) break;
      }
      say(
        reply === ''
          ? 'Gọi được nhà cung cấp, nhưng mô hình không trả về chữ nào. Thử một mô hình khác.'
          : `Gọi được nhà cung cấp. Mô hình trả lời: «${reply.trim()}»`,
      );
    } catch (e) {
      // `ProviderError` đã được Task 3 chứng minh là dựng HOÀN TOÀN từ hằng số
      // — thân hồi đáp 401 của nhà cung cấp có nguyên văn key trong đó, nên nó
      // không bao giờ được ghép vào thông điệp. Mọi lỗi KHÁC bị thay bằng một
      // câu hằng: `String(err)` là đường ngắn nhất để một `TypeError` mang URL,
      // `cause`, hay cả đối tượng yêu cầu đi thẳng lên màn hình.
      if (e instanceof ProviderError) {
        say(
          providerId === 'openai'
            ? `${e.message} (Với OpenAI, xem cảnh báo CORS ở trên — lỗi này có thể không phải do key.)`
            : e.message,
        );
      } else {
        say('Kho khoá không hoàn tất được lời gọi tới nhà cung cấp.');
      }
    } finally {
      testBtn.disabled = false;
      repaintPanel();
    }
  }

  // ── vẽ lần đầu ───────────────────────────────────────────────────────────
  if (stored) {
    modelInput.value = stored.model;
  } else {
    applyProvider();
  }
  warning.textContent = warningFor(providerSel.value);
  refreshCurrent();
  repaintPanel();

  return { repaintPanel, whenIdle: () => inflight };
}
