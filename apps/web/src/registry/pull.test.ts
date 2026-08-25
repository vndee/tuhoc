import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import * as importModule from '../course/import.ts';
import { t as lookup, type Translate } from '../i18n';
import { registryPackagePath, registryPackageUrl, pullFromRegistry } from './pull.ts';
import type { RegistryEntry } from './types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');

/** `t` đã gắn tiếng Việt — `pullFromRegistry` nhận ngôn ngữ bằng THAM SỐ. */
const t: Translate = (key, ...args) => lookup('vi', key, ...args);

const BASE = 'https://registry.example/reg';

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'so-dau-phay-dong',
    title: 'Số dấu phẩy động',
    description: 'Vì sao 0.1 + 0.2 không bằng 0.3',
    lang: 'vi',
    license: 'CC-BY-4.0',
    authors: [{ name: 'Ai đó' }],
    generatedBy: 'human',
    versions: ['1.0.0', '1.2.0'],
    latest: '1.2.0',
    bytes: 61790,
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...over,
  };
}

/* ====================================================================== *
 * 1. KHÔNG CÓ ĐƯỜNG THỨ TƯ
 * ====================================================================== */

/**
 * Đọc đúng ba biến thể `kind` mà `ImportSource` khai, từ CÂY CÚ PHÁP.
 *
 * Không `grep`: văn xuôi của `import.ts` nhắc tên cả ba đường ở nhiều chỗ (nhan
 * đề module, chú thích CORS, thông báo lỗi), nên một phép đếm theo chữ sẽ đếm
 * chú thích. Kiểu là thứ duy nhất nói được "gọi được bao nhiêu kiểu nguồn".
 */
function importSourceKinds(): string[] {
  const file = join(REPO_ROOT, 'apps', 'web', 'src', 'course', 'import.ts');
  const parsed = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

  const kinds: string[] = [];
  for (const statement of parsed.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || statement.name.text !== 'ImportSource') continue;
    if (!ts.isUnionTypeNode(statement.type)) throw new Error('ImportSource không còn là union — đọc lại tệp');
    for (const member of statement.type.types) {
      if (!ts.isTypeLiteralNode(member)) throw new Error('một nhánh của ImportSource không phải type literal');
      for (const prop of member.members) {
        if (!ts.isPropertySignature(prop) || prop.name.getText(parsed) !== 'kind') continue;
        const literal = prop.type;
        if (literal && ts.isLiteralTypeNode(literal) && ts.isStringLiteral(literal.literal)) {
          kinds.push(literal.literal.text);
        }
      }
    }
  }
  return kinds.sort();
}

describe('ba đường nhập, và KHÔNG đường thứ tư', () => {
  /**
   * Bài đọc-đồng-hồ. Một bộ dò hỏng trả `[]`, và `[]` "khớp" với mọi khẳng định
   * viết bằng `not.toContain`. Nên bộ dò phải tự chứng minh nó đọc được cây
   * cú pháp trước khi con số của nó có nghĩa.
   */
  it('đọc đúng đồng hồ của chính nó: một union ba nhánh cho ra ba tên', () => {
    const parsed = ts.createSourceFile(
      'probe.ts',
      "export type S = { kind: 'a'; x: 1 } | { kind: 'b' } | { kind: 'c' };",
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS,
    );
    const alias = parsed.statements[0];
    if (!alias || !ts.isTypeAliasDeclaration(alias) || !ts.isUnionTypeNode(alias.type)) throw new Error('probe hỏng');
    expect(alias.type.types).toHaveLength(3);
  });

  /**
   * KHẲNG ĐỊNH CHỊU LỰC của Task 6, và nó là **so bằng ĐÚNG**, không phải
   * `toContain`.
   *
   * `expect(kinds).toContain('zipUrl')` cũng đúng khi ai đó thêm một biến thể
   * `{ kind: 'registryFiles' }` bên cạnh — tức đúng với chính cái điều nó phải
   * cấm. Hệ thống con 1 đã đo được cả ba đường đi tới cùng một chỗ
   * (`runImport` → `rootPackage` → `validatePackage` → một `db.packages.put`),
   * và tính chất đáng giữ là *"không có bytes nào vào thư viện mà không đi qua
   * cái phễu ấy"*. Một đường thứ tư là một phễu thứ hai, dù nó tử tế đến đâu.
   */
  it('ImportSource khai ĐÚNG ba biến thể — kéo về từ registry không được thêm biến thể nào', () => {
    expect(importSourceKinds()).toEqual(['file', 'gitUrl', 'zipUrl']);
  });
});

/* ====================================================================== *
 * 2. ĐỊA CHỈ GÓI TRÊN REGISTRY
 * ====================================================================== */

describe('registryPackageUrl', () => {
  /**
   * So bằng ĐÚNG cả chuỗi. Một `toContain('so-dau-phay-dong')` cũng đúng với
   * `.../so-dau-phay-dong` (thiếu phiên bản, thiếu `.zip`) — tức đúng với một
   * URL 404.
   */
  it('địa chỉ gói được đánh theo PHIÊN BẢN, dưới cùng base với index.json', () => {
    expect(registryPackageUrl(BASE, 'so-dau-phay-dong', '1.2.0')).toBe(
      'https://registry.example/reg/courses/so-dau-phay-dong/1.2.0.zip',
    );
  });

  /**
   * `resolveRegistryBase` đã cắt dấu `/` cuối, nhưng hàm này cũng nhận base từ
   * `registryBase` của `<Catalog>` (thứ một bài kiểm hay một bản dựng tự chạy
   * truyền vào tay). Hai dấu gạch chéo liền nhau là một đường dẫn KHÁC trên
   * phần lớn máy chủ tĩnh, nên nó không được phép lọt ra.
   */
  it('base có dấu / ở cuối không sinh ra hai gạch chéo', () => {
    expect(registryPackageUrl(`${BASE}/`, 'x', '1.0.0')).toBe('https://registry.example/reg/courses/x/1.0.0.zip');
  });
});

/* ====================================================================== *
 * 3. KÉO VỀ ĐI QUA ĐƯỜNG `zipUrl` ĐÃ CÓ
 * ====================================================================== */

describe('pullFromRegistry', () => {
  /**
   * Bài chịu lực thứ hai: kéo về **gọi `importCourse`**, và nguồn nó dựng là
   * ĐÚNG một `{ kind: 'zipUrl' }`.
   *
   * `toEqual` trên cả object chứ không `expect(src.kind).toBe('zipUrl')`: cái
   * sau vẫn xanh khi hàm này lén nhét thêm trường (một danh sách tệp, một
   * cờ "bỏ qua kiểm định"), tức khi nó đã thôi là đường cũ mà chỉ còn đội tên
   * đường cũ.
   */
  it('gọi importCourse với ĐÚNG một nguồn zipUrl, không phải nguồn kiểu mới', async () => {
    const spy = vi
      .spyOn(importModule, 'importCourse')
      .mockResolvedValue({ ok: true, courseId: 'so-dau-phay-dong', version: '1.2.0' });

    await pullFromRegistry(entry(), { base: BASE, t });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toEqual({
      kind: 'zipUrl',
      url: 'https://registry.example/reg/courses/so-dau-phay-dong/1.2.0.zip',
    });
    spy.mockRestore();
  });

  /** Mặc định là `latest`; một phiên bản nói rõ thì đi theo nó. */
  it('kéo phiên bản được chỉ định thay vì latest', async () => {
    const spy = vi
      .spyOn(importModule, 'importCourse')
      .mockResolvedValue({ ok: true, courseId: 'so-dau-phay-dong', version: '1.0.0' });

    await pullFromRegistry(entry(), { base: BASE, version: '1.0.0', t });

    expect(spy.mock.calls[0]?.[0]).toEqual({
      kind: 'zipUrl',
      url: 'https://registry.example/reg/courses/so-dau-phay-dong/1.0.0.zip',
    });
    spy.mockRestore();
  });

  /**
   * Kéo về KHÔNG được nới một khẳng định nào của `importCourse`: kết quả trả
   * thẳng, `findings` không bị nuốt. Nếu hàm này bắt lỗi rồi trả `ok: true`
   * "cho gọn", một gói hỏng sẽ im lặng không vào thư viện mà người đọc vẫn
   * thấy "xong".
   */
  it('trả nguyên kết quả của importCourse, kể cả khi gói bị từ chối', async () => {
    const findings = [{ code: 'SCRIPT_TAG', path: 'chapters/c1.html', detail: '' }];
    const spy = vi.spyOn(importModule, 'importCourse').mockResolvedValue({ ok: false, findings });

    await expect(pullFromRegistry(entry(), { base: BASE, t })).resolves.toEqual({ ok: false, findings });
    spy.mockRestore();
  });
});

/* ====================================================================== *
 * 4. HỢP ĐỒNG VỚI PHÍA XUẤT BẢN
 * ====================================================================== */

/**
 * Cùng khuôn — và cùng lý do — như `schemaContract.test.ts`.
 *
 * `registryPackageUrl` một mình chỉ là một niềm tin về nơi tệp zip nằm. Niềm
 * tin ấy đúng hay sai là do **công việc xuất bản** quyết định, và hai bên sống
 * trong hai dự án khác nhau (`apps/web` và `tools/registry`) nên `tsc` không
 * nối chúng lại được. Đây là chỗ nối: bài kiểm chạy trong Node, nơi các import
 * `node:*` của phía xuất bản là vô hại, và nó so **giá trị thật của cả hai
 * bên** chứ không so hai chuỗi cùng chép tay.
 *
 * Đây chính là phép đo mà `PUBLIC_REGISTRY_BASE = null` bảo vệ ở tầng trên:
 * một URL không ai xuất bản hỏng bằng `TypeError` trần, không phân biệt được
 * với mất mạng (S1-F25). Một URL platform bịa ra cho gói cũng hỏng y hệt.
 */
describe('platform và phía xuất bản đồng ý về đường dẫn gói', () => {
  it('registryPackageUrl khớp ĐÚNG đường dẫn mà pack-site ghi vào _site', async () => {
    const { sitePackagePath } = await import('../../../../tools/registry/src/pack-site.ts');
    expect(registryPackageUrl(BASE, 'khoa-hoc', '2.3.4')).toBe(`${BASE}/${sitePackagePath('khoa-hoc', '2.3.4')}`);
  });

  /** Và nửa còn lại của cùng một hằng: platform dựng URL từ mảnh dùng chung ấy. */
  it('registryPackagePath là mảnh dùng chung, không phải một chuỗi chép tay thứ hai', async () => {
    const { sitePackagePath } = await import('../../../../tools/registry/src/pack-site.ts');
    expect(registryPackagePath('khoa-hoc', '2.3.4')).toBe(sitePackagePath('khoa-hoc', '2.3.4'));
  });
});
