import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MalformedRegistryIndexError,
  SUPPORTED_INDEX_SCHEMA,
  UnsupportedRegistrySchemaError,
} from './index.ts';
import { registryIndexQueryKey, shouldRetryRegistry, useRegistryIndex } from './useRegistry.ts';

const BASE = 'https://registry.example/reg';
const INDEX_URL = `${BASE}/index.json`;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => localStorage.clear());

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('shouldRetryRegistry — thử lại cái đáng thử, và chỉ cái đó', () => {
  it('KHÔNG thử lại khi dữ liệu sai hình dạng', () => {
    // Thử lại một index hỏng cho ra đúng cái index hỏng ấy, chỉ chậm hơn ba
    // lần — và trong lúc chờ, người đọc nhìn một màn "đang tải" nói dối.
    expect(shouldRetryRegistry(0, new MalformedRegistryIndexError(['courses']))).toBe(false);
    expect(shouldRetryRegistry(0, new UnsupportedRegistrySchemaError(999, SUPPORTED_INDEX_SCHEMA))).toBe(false);
  });

  it('CÓ thử lại khi là lỗi vận chuyển, nhưng có trần', () => {
    expect(shouldRetryRegistry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryRegistry(9, new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('useRegistryIndex', () => {
  it('trả về danh mục, và khoá query ổn định', async () => {
    server.use(
      http.get(INDEX_URL, () =>
        HttpResponse.json({ schema: SUPPORTED_INDEX_SCHEMA, generatedAt: 'x', courses: [] }),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRegistryIndex({ base: BASE }), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.courses).toEqual([]);
    expect(registryIndexQueryKey(BASE)).toEqual(['registry', 'index', BASE]);
  });

  it('lỗi hình dạng tới người gọi dưới dạng `error`, KHÔNG ném ra ngoài lúc render', async () => {
    // Đây là điều tách "hiện thông báo" khỏi "trắng trang": một promise bị từ
    // chối trong `queryFn` thành `error` của query; một lỗi ném lúc render thì
    // gỡ cả cây.
    server.use(http.get(INDEX_URL, () => HttpResponse.json({ schema: SUPPORTED_INDEX_SCHEMA, generatedAt: 'x' })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRegistryIndex({ base: BASE }), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(MalformedRegistryIndexError);
    expect(result.current.data).toBeUndefined();
  });
});
