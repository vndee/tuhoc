/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { db } from '../db/local';

/**
 * Nửa phía trình duyệt của lời hứa ở spec §1.4: key của người dùng không bao
 * giờ chạm tới máy chủ của chúng ta.
 *
 * Nửa phía Go (`apps/api/internal/server/no_key_transit_test.go`) khoá hai
 * đường đi qua server. Tệp này khoá đường thứ ba, nằm hoàn toàn trong trình
 * duyệt và không đường nào của server nhìn thấy: **trang chính tự cầm key**.
 * Ngay khi một tệp của `apps/web/src` chạm vào key, key đã ở sai origin —
 * `localStorage` của trang chính, Dexie, outbox, log — và outbox thì ĐỒNG BỘ
 * LÊN SERVER. Không cần ai viết một route nhận key thì key vẫn tới nơi.
 *
 * Kiến trúc: key sống ở `apps/vault` (origin riêng, cổng 5174). Trang chính
 * gửi lời nhắc bằng `postMessage` và nhận chữ về. Nó KHÔNG BAO GIỜ thấy key.
 *
 * Cả ba phép quét dưới đây XANH trên nền sạch — đo ngày 2026-08-22, xem
 * `.superpowers/sdd/2026-08-22-s2-ai-byok/task-4-report.md`. Đó là hình dạng
 * đúng của một dây bẫy, và cũng là hình dạng của một cổng chết, nên bộ dò được
 * chứng minh còn sống ở test đầu tiên chứ không ở lời hứa.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const WEB = resolve(SRC, '..');
const VAULT_PROTOCOL = resolve(WEB, '../vault/src/protocol.ts');

/** Tên trường mang key, ở dạng chúng xuất hiện trong mã TypeScript. */
const KEY_BEARING = /\bapiKey\b|\bapi_key\b|['"]x-api-key['"]|['"]anthropic-api-key['"]/i;

/**
 * Host nhà cung cấp. Chỉ `apps/vault` được phép nhắc tới chúng — nó là mã DUY
 * NHẤT chạy ở origin giữ key, nên nó là mã duy nhất được phép gọi thẳng. Một
 * host xuất hiện dưới `apps/web/src` nghĩa là trang chính đang tự gọi nhà cung
 * cấp, và để gọi được thì nó phải đang cầm key.
 */
const PROVIDER_HOST =
  /api\.openai\.com|api\.deepseek\.com|api\.anthropic\.com|openrouter\.ai|api\.groq\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.together\.xyz|api\.x\.ai/i;

/**
 * Nhập bất kỳ thứ gì của kho khoá NGOÀI `protocol`.
 *
 * `apps/web/vite.config.ts` đã ghi điều này bằng chữ ở alias `@vault-protocol`
 * ("đừng bao giờ alias thứ gì khác của apps/vault/ vào đây"), nhưng một chú
 * thích không chặn được `import { readKey } from '../../vault/src/keystore'` —
 * đường dẫn tương đối không cần alias nào cả. `keystore.ts` và `providers/*`
 * CHẠM tới key; kéo chúng vào bundle của trang chính là tự tay bốc key về đúng
 * cái origin mà toàn bộ kiến trúc này dựng lên để giữ nó ra ngoài.
 */
const VAULT_INTERNALS = /vault\/src\/(?!protocol)|@vault-protocol\//;

/**
 * Số tệp sản phẩm tối thiểu. Đo ngày 2026-08-22: `apps/web/src` có 93 tệp
 * .ts/.tsx, trong đó 50 tệp sản phẩm và 43 tệp test. Ngưỡng 40 chứ không 50 để
 * một lần dọn dẹp hợp lệ không làm đỏ dây bẫy; chốt THẬT là danh sách neo bên
 * dưới, không phải con số này.
 */
const MIN_PRODUCT_FILES = 40;

/**
 * Những tệp mà một rò rỉ sẽ đi qua nếu nó xảy ra: điểm vào, vỏ ứng dụng, lớp
 * lưu trữ cục bộ, lớp gọi API, và lớp đồng bộ lên server. Neo theo tên mạnh
 * hơn neo theo số đếm — cùng lập luận `db/local.test.ts` đã viết cho danh sách
 * năm bảng Dexie: một con số vẫn xanh khi người ta thêm một tệp và xoá một tệp
 * khác.
 */
const SCAN_SENTINELS = [
  'main.tsx',
  'App.tsx',
  'db/local.ts',
  'api/client.ts',
  'sync/engine.ts',
];

type Source = { path: string; text: string };

function allSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) allSources(p, acc);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) acc.push(p);
  }
  return acc;
}

function readSources(): Source[] {
  return allSources(SRC).map((p) => ({
    path: relative(WEB, p),
    text: readFileSync(p, 'utf8'),
  }));
}

/** Tách khỏi các test để chính nó kiểm được bằng nguồn tổng hợp. */
function offenders(sources: Source[], re: RegExp): string[] {
  return sources
    .filter((s) => re.test(s.text))
    .map((s) => s.path)
    .sort();
}

/**
 * Tên trường mang key trong một tệp .ts, sau khi đã bỏ chú thích. Chú thích
 * tiếng Việt của `protocol.ts` nhắc chữ "key" một cách hoàn toàn chính đáng
 * ("chưa cắm key"), và một dây bẫy đỏ vì văn xuôi thì không ai tin.
 */
function keyBearingDeclarations(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return code.match(/\b(api_?key|key|secret|token|credential|passphrase)\s*\??\s*:/gi) ?? [];
}

describe('key không rò sang trang chính', () => {
  /**
   * Dây bẫy cho chính dây bẫy.
   *
   * Ba test dưới đây đều khẳng định "không tìm thấy gì". Một phép quét đọc 0
   * tệp, hay một biểu thức hỏng, cho ra ĐÚNG CÙNG một kết quả xanh — đó là
   * khuôn của cả bốn cổng mù đã ghi ở `docs/carried-forward.md`: "cổng đo thứ
   * nó với tới được, và im lặng đúng chỗ nó không với tới".
   *
   * Test này hỏi ba câu mà một cổng chết không trả lời được: phép quét có đọc
   * tệp nào không, có đọc đúng những tệp cần đọc không, và bộ dò có còn bắt
   * được vi phạm không.
   */
  it('phép quét thật sự đọc mã nguồn, và bộ dò còn sống', () => {
    const sources = readSources();

    // Con số để phép quét tự nói nó ĐÃ đọc bao nhiêu tệp, thay vì để người đọc
    // báo cáo phải tin lời — đối trọng của `t.Logf` ở nửa Go. Reporter mặc định
    // nuốt stdout của test xanh; `bunx vitest run --reporter=verbose` in ra.
    console.log(`[noKeyLeak] phép quét đọc ${sources.length} tệp sản phẩm dưới ${SRC}`);

    expect(sources.length).toBeGreaterThanOrEqual(MIN_PRODUCT_FILES);
    const scanned = new Set(sources.map((s) => s.path.replace(/^src\//, '')));
    expect(SCAN_SENTINELS.filter((s) => !scanned.has(s))).toEqual([]);

    // Chiều ĐỎ: nguồn tổng hợp vi phạm phải bị bắt, qua đúng những hàm mà ba
    // test dưới dùng.
    const bad: Source[] = [
      { path: 'src/ai/x.ts', text: 'const apiKey = localStorage.getItem("k");' },
      { path: 'src/ai/y.ts', text: "fetch('https://api.deepseek.com/v1/chat')" },
      { path: 'src/ai/z.ts', text: "import { readKey } from '../../vault/src/keystore';" },
    ];
    expect(offenders(bad, KEY_BEARING)).toEqual(['src/ai/x.ts']);
    expect(offenders(bad, PROVIDER_HOST)).toEqual(['src/ai/y.ts']);
    expect(offenders(bad, VAULT_INTERNALS)).toEqual(['src/ai/z.ts']);

    // Chiều XANH: nguồn vô hại — kể cả nguồn nhập ĐÚNG thứ được phép nhập từ
    // kho khoá — phải không khớp gì. Một bộ dò bắt tất cả cũng vô dụng như một
    // bộ dò không bắt gì.
    const good: Source[] = [
      { path: 'src/ai/ok.ts', text: "import { PROTOCOL_VERSION } from '@vault-protocol';" },
      { path: 'src/ai/ok2.ts', text: 'const apiKeyword = 1; // vault, api, key' },
    ];
    expect(offenders(good, KEY_BEARING)).toEqual([]);
    expect(offenders(good, PROVIDER_HOST)).toEqual([]);
    expect(offenders(good, VAULT_INTERNALS)).toEqual([]);

    // Bộ dò của giao thức, cả hai chiều — kể cả chiều "chú thích tiếng Việt có
    // chữ key nhưng mã thì không", vốn là cách nó dễ đỏ oan nhất.
    expect(keyBearingDeclarations(`type R = { v: 1; kind: 'key'; apiKey: string };`)).toEqual([
      'apiKey:',
    ]);
    expect(
      keyBearingDeclarations(`/** chưa cắm key */\n// key: chú thích\ntype R = { configured: boolean };`),
    ).toEqual([]);
  });

  it('không tệp sản phẩm nào của trang chính chạm tới một trường tên là key', () => {
    // Trang chính KHÔNG BAO GIỜ chạm key: nó gửi lời nhắc cho kho khoá và nhận
    // chữ về. Nếu một task cần key ở đây để làm việc gì đó thì thiết kế sai —
    // dừng và báo, đừng nới biểu thức này.
    expect(offenders(readSources(), KEY_BEARING)).toEqual([]);
  });

  it('không tệp sản phẩm nào của trang chính gọi thẳng nhà cung cấp', () => {
    expect(offenders(readSources(), PROVIDER_HOST)).toEqual([]);
  });

  it('không tệp sản phẩm nào nhập phần ruột của kho khoá — chỉ `protocol` được phép', () => {
    expect(offenders(readSources(), VAULT_INTERNALS)).toEqual([]);
  });

  /**
   * Cánh cửa hợp pháp DUY NHẤT giữa hai origin, và vì sao nó cũng phải bị khoá.
   *
   * Ba phép quét trên tìm TÊN. Chúng bắt được `const apiKey = ...`, nhưng không
   * bắt được `const k = resp.value` — nếu giao thức có một thông điệp trả key
   * về thì trang chính cầm key mà không cần viết chữ "key" ở đâu cả, và không
   * phép quét theo tên nào cứu được.
   *
   * Chỗ chặn thật nằm ở hình dạng giao thức: `VaultRequest`/`VaultResponse`
   * không có trường nào mang key. Hôm nay đúng như vậy — `status` chỉ trả
   * `configured: boolean`, và không có `kind` nào để ĐỌC key ra, kể cả cho
   * chính trang cấu hình (key được nhập TRONG khung kho khoá, Task 6). Test
   * này khoá điều đó lại để nó không trôi mất trong một lần thêm tính năng.
   *
   * Đọc tệp nguồn chứ không nhập kiểu: kiểu TypeScript biến mất lúc chạy, nên
   * không có cách nào hỏi "union này có trường tên là key không" từ trong test.
   */
  it('giao thức kho khoá không có trường nào mang key — cánh cửa hợp pháp cũng bị khoá', () => {
    expect(keyBearingDeclarations(readFileSync(VAULT_PROTOCOL, 'utf8'))).toEqual([]);
  });

  /**
   * HC-1 của kế hoạch, và ràng buộc §3.2(1) của spec: key phải bị loại khỏi
   * đồng bộ, nên nó không được có bảng nào trong Dexie.
   *
   * Chốt gốc sống ở `db/local.test.ts` ("has exactly five tables"), và tệp này
   * KHÔNG thay nó — nó lặp lại chốt ấy từ phía lời hứa BYOK, để người thêm một
   * bảng `keys` gặp câu hỏi ở cả hai nơi: một lần với tư cách "bạn vừa đổi lược
   * đồ cục bộ", một lần với tư cách "bạn vừa đặt key vào thứ được đồng bộ".
   * Danh sách ghi bằng TÊN chứ không bằng số đếm, cùng lý do file kia đã nêu.
   */
  it('Dexie vẫn đúng năm bảng — key không được thêm bảng thứ sáu', () => {
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'annotations',
      'meta',
      'outbox',
      'packages',
      'progress',
    ]);
  });
});
