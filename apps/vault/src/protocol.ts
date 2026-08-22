/** Tăng khi hình dạng thông điệp đổi theo cách không tương thích ngược. Bên nhận
 *  từ chối phiên bản lạ thay vì đoán — một trang chính cũ gặp kho khoá mới phải
 *  hỏng ồn ào, không được im lặng gửi sai. */
export const PROTOCOL_VERSION = 1 as const;

export type VaultRequest =
  | { v: 1; id: string; kind: 'listProviders' }
  | { v: 1; id: string; kind: 'status' }
  | { v: 1; id: string; kind: 'chat'; providerId: string; model: string;
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> };

export type VaultResponse =
  | { v: 1; id: string; kind: 'providers'; providers: Array<{ id: string; label: string }> }
  | { v: 1; id: string; kind: 'status'; configured: boolean; providerId?: string; model?: string }
  | { v: 1; id: string; kind: 'chunk'; text: string }
  | { v: 1; id: string; kind: 'done' }
  | { v: 1; id: string; kind: 'error'; code: VaultErrorCode; message: string };

/** Mã lỗi là một union đóng, không phải chuỗi tự do: trang chính phải phân biệt được
 *  "chưa cắm key" (hiện lời mời cấu hình) với "nhà cung cấp từ chối" (hiện lỗi thật). */
export type VaultErrorCode =
  | 'not_configured' | 'bad_key' | 'rate_limited' | 'provider_error'
  | 'needs_consent' | 'unsupported_provider' | 'protocol_version';

export function isVaultResponse(x: unknown): x is VaultResponse {
  return typeof x === 'object' && x !== null
    && (x as { v?: unknown }).v === PROTOCOL_VERSION
    && typeof (x as { id?: unknown }).id === 'string'
    && typeof (x as { kind?: unknown }).kind === 'string';
}
