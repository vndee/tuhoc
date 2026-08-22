import { checkAndConsume, clearActivity, grantConsent, hasConsent, readActivity } from '../guard';
import type { GuardDecision } from '../guard';
import { clearConfig, readConfig, readPublicConfig, writeConfig } from '../keystore';
import { t } from '../lang';
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
  /**
   * Dịch lại MỌI chữ của màn hình sang ngôn ngữ hiện tại — **tại chỗ**.
   *
   * Đây là lý do nó tồn tại, và nó là một ràng buộc chứ không phải một cách
   * viết: `renderSettings` mở đầu bằng `root.textContent = ''`, nên "đổi ngôn
   * ngữ = gọi lại `renderSettings`" sẽ **xoá sạch ô nhập key đang gõ dở** —
   * đúng cái lỗi mà việc bỏ `?lang=` khỏi `src` của khung sinh ra để chữa.
   * Task 7 đo được nó ở đường bàn phím (16 lần Tab từ ô key là tới bộ chọn
   * ngôn ngữ của trang chính); nếu hàm này vẽ lại thì lỗi ấy vẫn còn nguyên,
   * chỉ đổi chỗ gây ra.
   *
   * Nó KHÔNG chạm `secretInput.value`, không đọc nó, không cất nó đi đâu để
   * rồi trả lại — **node của ô key không bị thay**. Không có bản sao thứ hai
   * nào của key được tạo ra ở đây, kể cả trong một biến cục bộ sống một dòng.
   */
  retranslate: () => void;
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
const testPrompt = (): string => t('vault.settings.testPrompt');

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
function warningFor(providerId: string): string {
  return providerId === 'openai' ? t('vault.settings.openaiWarning') : '';
}

// ───────────────────────── dựng DOM ─────────────────────────

function el(tag: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Một mẩu chữ, dưới dạng **cách lấy nó** chứ không dưới dạng chữ đã lấy.
 *
 * Toàn bộ màn hình này được dựng từ những hàm như vậy thay vì từ `string`, và
 * đó là điều duy nhất làm `retranslate()` khả thi mà không phải vẽ lại DOM:
 * một `string` chỉ biết ngôn ngữ tại lúc gọi `t()`, còn một `() => string`
 * biết ngôn ngữ tại lúc *chạy lại*.
 */
type Text = () => string;

function field(label: Text, control: HTMLElement, hint: Text | undefined, bind: Bind): HTMLElement {
  const wrap = el('div');
  wrap.className = 'vault-field';
  const labelEl = el('label') as HTMLLabelElement;
  bind(labelEl, label);
  const id = `vault-${control.dataset.role ?? 'x'}`;
  control.id = id;
  labelEl.htmlFor = id;
  wrap.appendChild(labelEl);
  wrap.appendChild(control);
  if (hint !== undefined) {
    const h = el('p');
    h.className = 'vault-hint';
    bind(h, hint);
    wrap.appendChild(h);
  }
  return wrap;
}

/** Gắn một mẩu chữ vào một node, và ghi nhớ mối nối ấy để dịch lại được. */
type Bind = (node: HTMLElement, text: Text) => void;

function button(role: string, text: Text, bind: Bind): HTMLButtonElement {
  const b = el('button') as HTMLButtonElement;
  b.type = 'button';
  b.dataset.role = role;
  bind(b, text);
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

  /**
   * Sổ của `retranslate()`: mỗi mối nối "node này lấy chữ từ hàm kia".
   *
   * Một MẢNG những việc phải làm lại, không một lần vẽ lại: xem
   * `SettingsHandle.retranslate` cho lý do đầy đủ. Mọi chữ trên màn hình này
   * phải đi qua `bind` hoặc `dynamic` — một `node.textContent = t(...)` viết
   * thẳng sẽ đứng yên ở tiếng cũ sau khi người dùng đổi ngôn ngữ, và không
   * triệu chứng nào khác.
   */
  const retranslators: Array<() => void> = [];

  /** Chữ TĨNH: một khoá, một node, dịch lại là gọi lại đúng hàm ấy. */
  const bind: Bind = (node, text) => {
    const apply = (): void => {
      node.textContent = text();
    };
    retranslators.push(apply);
    apply();
  };

  /** Chữ ĐỘNG: phụ thuộc trạng thái hiện tại (đã cắm key chưa, đang chọn nhà
   *  cung cấp nào, nút xoá đã lên nòng chưa). Chỉ ghi việc vào sổ; chỗ gọi tự
   *  quyết khi nào chạy lần đầu. */
  const dynamic = (apply: () => void): void => {
    retranslators.push(apply);
  };

  // ── phần giải thích ──────────────────────────────────────────────────────
  const title = el('h2');
  bind(title, () => t('vault.settings.title'));
  root.appendChild(title);
  const why = el('p');
  why.className = 'vault-note';
  bind(why, () => t('vault.settings.why'));
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
  root.appendChild(field(() => t('vault.settings.providerLabel'), providerSel, undefined, bind));

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
    field(() => t('vault.settings.modelLabel'), modelInput, () => t('vault.settings.modelHint'), bind),
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
  // Chỗ giữ chỗ là một THUỘC TÍNH, không phải `textContent`, nên nó không đi
  // qua `bind` được — nhưng nó vẫn là chữ, nên nó vẫn phải vào sổ. Một mối nối,
  // gọi ngay một lần và ghi vào sổ một lần: hai dòng `t()` rời nhau ở đây là
  // đúng cách để một trong hai trôi mất.
  const applyPlaceholder = (): void => {
    secretInput.placeholder = t('vault.settings.keyPlaceholder');
  };
  dynamic(applyPlaceholder);
  applyPlaceholder();
  root.appendChild(
    field(() => t('vault.settings.keyLabel'), secretInput, () => t('vault.settings.keyHint'), bind),
  );

  // ── nút ──────────────────────────────────────────────────────────────────
  const actions = el('div');
  actions.className = 'vault-actions';
  const saveBtn = button('save', () => t('vault.settings.save'), bind);
  const testBtn = button('test', () => t('vault.settings.test'), bind);
  // Nút xoá KHÔNG dùng `bind`: chữ của nó phụ thuộc `clearArmed`, và một `bind`
  // sẽ lặng lẽ hạ nòng nó khi người dùng đổi ngôn ngữ giữa hai cú bấm.
  const clearBtn = button('clear', () => t('vault.settings.clear'), (node, text) => {
    node.textContent = text();
  });
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

  /**
   * Câu đang hiện ở dòng trạng thái, giữ dưới dạng **cách dựng nó**.
   *
   * `null` là "chưa nói gì", khác với "một câu rỗng": dịch lại một dòng chưa có
   * gì phải để nó chưa có gì.
   *
   * Một câu kẹt lại ở tiếng cũ sau khi đổi ngôn ngữ là thứ không cổng nào hỏi
   * và ai cũng thấy — dòng này nằm ngay dưới ba cái nút.
   */
  let lastSaid: Text | null = null;

  function say(text: Text): void {
    lastSaid = text;
    status.textContent = text();
  }

  function repaintPanel(): void {
    renderVaultPanel(panelRoot, deps.panel);
  }

  function refreshCurrent(): void {
    const cfg = deps.readPublicConfig();
    current.textContent = cfg
      ? t('vault.settings.currentKey', cfg.providerId, cfg.model)
      : t('vault.settings.noKey');
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
    clearBtn.textContent = t('vault.settings.clear');
  }

  // ── sổ dịch lại: những mẩu chữ ĐỘNG ──────────────────────────────────────
  //
  // Năm mẩu, và cả năm đều đọc TRẠNG THÁI HIỆN TẠI thay vì đọc một chuỗi đã
  // dựng sẵn. Không mẩu nào trong số này chạm tới `secretInput.value`.
  dynamic(refreshCurrent);
  dynamic(() => {
    warning.textContent = warningFor(providerSel.value);
  });
  dynamic(() => {
    clearBtn.textContent = t(clearArmed ? 'vault.settings.clearArmed' : 'vault.settings.clear');
  });
  dynamic(() => {
    if (lastSaid !== null) status.textContent = lastSaid();
  });
  // Khung xác nhận + nhật ký tự dựng lại toàn bộ mỗi lần vẽ, và nó KHÔNG chứa ô
  // nhập nào — nên với nó, vẽ lại chính là dịch lại.
  dynamic(() => {
    repaintPanel();
  });

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
      say(() => t('vault.settings.noKeyTyped'));
      return;
    }
    const model = modelInput.value.trim();
    if (model === '') {
      say(() => t('vault.settings.noModel'));
      return;
    }
    deps.writeConfig({ providerId: providerSel.value, model, apiKey: secret });
    // Xoá ô ngay: một key nằm lại trong DOM sau khi đã cất đi là một bản sao
    // thứ hai không ai cần, và nó sống tới khi khung bị đóng.
    secretInput.value = '';
    refreshCurrent();
    say(() => t('vault.settings.saved'));
  });

  clearBtn.addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.textContent = t('vault.settings.clearArmed');
      say(() => t('vault.settings.clearWarning'));
      return;
    }
    disarmClear();
    deps.clearConfig();
    secretInput.value = '';
    refreshCurrent();
    say(() => t('vault.settings.cleared'));
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
      say(() => t('vault.settings.noModel'));
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
      say(() => t('vault.settings.noKeyAnywhere'));
      return;
    }

    const prompt = testPrompt();
    const decision = deps.checkAndConsume({ chars: prompt.length, providerId });
    repaintPanel();
    if (!decision.allow) {
      /*
       * MỘT GIỚI HẠN CÓ THẬT CỦA `retranslate()`, và nó nằm ở đây chứ không ở
       * chỗ khác: `decision.message` là chữ mà NGƯỜI GÁC đã dựng xong, ở ngôn
       * ngữ lúc nó quyết định. Không có khoá nào để dựng lại, nên nếu người
       * dùng đổi ngôn ngữ sau đó, đúng câu này ở lại tiếng cũ.
       *
       * Chấp nhận thay vì đuổi theo: sửa cho đủ là bắt `GuardDecision` chở
       * khoá + đối số thay vì chở chữ, và đó là một thay đổi của `guard.ts` —
       * tệp có bẫy trung tâm của HC-3, và không liên quan gì tới lỗi đang sửa.
       * Hai câu còn lại ở nhánh này thì dựng lại được, và chúng dựng lại.
       */
      const denied = decision.message;
      say(
        decision.code === 'needs_consent'
          ? () => t('vault.settings.needsConsent')
          : denied === null
            ? () => t('vault.settings.denied')
            : () => denied,
      );
      return;
    }

    const provider = deps.getProvider(providerId);
    if (!provider) {
      say(() => t('vault.provider.unknown'));
      return;
    }

    testBtn.disabled = true;
    say(() => t('vault.settings.calling'));
    try {
      let reply = '';
      for await (const chunk of provider.chat(
        { model, messages: [{ role: 'user', content: prompt }] },
        key,
      )) {
        reply += chunk;
        // `break` chạy `finally` của bộ đọc luồng, tức là HUỶ kết nối — không
        // chỉ ngừng đọc và bỏ lại một kết nối treo.
        if (reply.length >= TEST_REPLY_CHARS) break;
      }
      // Chữ của nhà cung cấp không dịch được, nhưng CÁI VỎ quanh nó thì có.
      const trimmed = reply.trim();
      say(reply === '' ? () => t('vault.settings.emptyReply') : () => t('vault.settings.reply', trimmed));
    } catch (e) {
      // `ProviderError` đã được Task 3 chứng minh là dựng HOÀN TOÀN từ hằng số
      // — thân hồi đáp 401 của nhà cung cấp có nguyên văn key trong đó, nên nó
      // không bao giờ được ghép vào thông điệp. Mọi lỗi KHÁC bị thay bằng một
      // câu hằng: `String(err)` là đường ngắn nhất để một `TypeError` mang URL,
      // `cause`, hay cả đối tượng yêu cầu đi thẳng lên màn hình.
      if (e instanceof ProviderError) {
        // Cùng giới hạn với `decision.message` ngay trên: `e.message` đã là chữ
        // dựng xong ở ngôn ngữ lúc ném.
        const failed = e.message;
        say(providerId === 'openai' ? () => t('vault.settings.openaiHint', failed) : () => failed);
      } else {
        say(() => t('vault.provider.callFailed'));
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

  /**
   * Chạy lại CẢ SỔ, không một mục nào bị bỏ.
   *
   * Không lọc, không "chỉ dịch phần tĩnh": một mục bị bỏ quên là một mẩu chữ
   * kẹt lại ở tiếng cũ, và triệu chứng của nó chỉ là *một dòng trông lạ* —
   * đúng hạng lỗi mà không ai báo và không cổng nào hỏi. `settings.test.ts`
   * đếm sổ này so với số mẩu chữ có thật trên màn hình.
   */
  function retranslate(): void {
    for (const apply of retranslators) apply();
  }

  return { repaintPanel, retranslate, whenIdle: () => inflight };
}
