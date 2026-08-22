import { describe, it, expect } from 'vitest';
import { PROTOCOL_VERSION, isVaultResponse } from '@vault-protocol';

/**
 * Alias `@vault-protocol` là hợp đồng giữa HAI ỨNG DỤNG ở HAI ORIGIN. Nó có hai
 * nửa — `apps/web/vite.config.ts` (lúc gói) và `apps/web/tsconfig.app.json`
 * (lúc kiểm kiểu) — và cho tới Task 5 thì KHÔNG tệp sản phẩm nào nhập nó.
 *
 * Đó chính xác là hình dạng của cổng mù #4 trong `docs/carried-forward.md`: một
 * đường dây không ai đi qua thì không cổng nào hỏi được nó có thông hay không.
 * `bun run test` và `tsc -b` vẫn xanh trọn vẹn với một alias gõ sai đường dẫn,
 * cho tới tận lúc Task 5 nhập nó và phát hiện ra.
 *
 * Tệp này là người đi qua đường dây đó. Nó cố tình rất nhỏ, và nó cũng là chốt
 * duy nhất bắt được việc hai phía trôi dạt số phiên bản giao thức.
 */
describe('@vault-protocol (hợp đồng với apps/vault)', () => {
  it('alias giải được, và trang chính thấy đúng phiên bản giao thức', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('isVaultResponse từ chối thứ không phải hồi đáp của kho khoá', () => {
    // Trang chính sẽ dùng đúng hàm này để lọc thông điệp; nếu nó nhận bừa thì
    // một trang bất kỳ `postMessage` về là bơm được chữ giả vào câu trả lời AI.
    expect(isVaultResponse({ v: 1, id: 'a', kind: 'done' })).toBe(true);
    expect(isVaultResponse({ v: 2, id: 'a', kind: 'done' })).toBe(false);
    expect(isVaultResponse({ v: 1, kind: 'done' })).toBe(false);
    expect(isVaultResponse(null)).toBe(false);
    expect(isVaultResponse('done')).toBe(false);
  });
});
