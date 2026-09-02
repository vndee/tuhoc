import { act, fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { AskPanel } from './AskPanel';

/**
 * PHA 2: panel này không còn hỏi kho khoá qua `postMessage` — nó đi qua
 * `useAI`/`serverClient` tới `POST /ai/chat` thật (chặn bằng msw, cùng quy
 * ước với phần còn lại của `apps/web/src`). Không còn phép hỏi trạng thái
 * lúc mở (`useAI.ts`'s doc comment): panel luôn hiện ô nhập ngay, và trạng
 * thái chặn duy nhất (`NoCredit`) chỉ lộ ra SAU một lượt hỏi thật.
 *
 * VÌ SAO VẪN KHÔNG DÙNG `waitFor` — nguyên văn lý do của `useAI.test.tsx`:
 * mọi lần bơm dữ liệu vào stream nằm trong `act(async () => {…})`, cộng một
 * `flush()` thật (không phải timer giả) để nhường vòng lặp sự kiện cho pipeline
 * `fetch`/`ReadableStream` của `serverClient.ts`.
 */

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function controllableSSE() {
  const encoder = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  return {
    stream,
    event: (kind: string, payload: { text?: string; code?: string }) => {
      ctrl.enqueue(encoder.encode(`event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`));
    },
    close: () => {
      ctrl.close();
    },
  };
}

interface Captured {
  readonly question: string;
  readonly course_slug: string;
  readonly signal: AbortSignal;
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function nextChat(): { requests: Captured[]; sse: ReturnType<typeof controllableSSE> } {
  const requests: Captured[] = [];
  const sse = controllableSSE();
  server.use(
    http.post(
      '/ai/chat',
      async ({ request }) => {
        const body = (await request.json()) as { question: string; course_slug: string };
        requests.push({ ...body, signal: request.signal });
        return new HttpResponse(sse.stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      },
      { once: true },
    ),
  );
  return { requests, sse };
}

function wrap(node: ReactNode): ReactNode {
  return (
    <LanguageProvider>
      <MemoryRouter>{node}</MemoryRouter>
    </LanguageProvider>
  );
}

function typeQuestion(text: string): void {
  const box = screen.getByLabelText('Câu hỏi của bạn');
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const SYSTEM = 'KHOÁ HỌC:\nSố dấu phẩy động\n\nTRÍCH CHƯƠNG:\nSố mũ lệch 127.';

describe('AskPanel — không còn vòng dò trước khi gõ', () => {
  it('mở panel là thấy ngay ô nhập câu hỏi — không có màn hình trung gian nào', () => {
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    expect(screen.getByLabelText('Câu hỏi của bạn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hỏi' })).not.toBeDisabled();
    expect(screen.queryByTestId('ai-needs-setup')).toBeNull();
  });
});

/**
 * Important 2, review vòng 1: `useAI.ts`'s doc comment cấm giao diện gợi ý
 * "gia sư nhớ câu trước", nhưng bản trước của `AskPanel` vẽ mọi lượt thành
 * một mạch liền và nút xoá ghi "Hội thoại mới" — không một chữ nào nói mỗi
 * lượt là một yêu cầu riêng. Nhóm bài này canh cả hai phần của sửa chữa.
 */
describe('AskPanel — trung thực về việc KHÔNG có trí nhớ giữa các lượt', () => {
  it('câu "mỗi câu hỏi là một lượt riêng" hiện NGAY khi mở, trước cả câu hỏi đầu tiên', () => {
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    expect(screen.getByTestId('ai-no-memory-notice')).toHaveTextContent(
      'Mỗi câu hỏi là một lượt riêng — trợ lý không nhớ những câu bạn đã hỏi trước đó.',
    );
  });

  it('câu ấy vẫn còn đó sau khi đã có vài lượt — không phải một lời chào biến mất', async () => {
    const { sse } = nextChat();
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
      await flush();
    });
    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });
    expect(screen.getByTestId('ai-no-memory-notice')).toBeInTheDocument();
  });

  it('nút xoá ghi "Xoá tất cả", KHÔNG còn "Hội thoại mới" (ngụ ý một hội thoại liên tục)', async () => {
    const { sse } = nextChat();
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
      await flush();
    });
    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });
    expect(screen.getByRole('button', { name: 'Xoá tất cả' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hội thoại mới' })).toBeNull();
  });
});

/**
 * Task 12 (Pha 3) — `read_my_notes` bật MẶC ĐỊNH, và người học phải được báo.
 * Cùng kỷ luật với nhóm bài "không có trí nhớ" ở trên: câu công bố phải hiện
 * NGAY khi mở panel, trước cả câu hỏi đầu tiên — đúng lúc tool có thể đã được
 * gọi mà người học chưa từng thấy một dòng nào nói vậy.
 */
describe('AskPanel — công bố read_my_notes bật mặc định', () => {
  it('câu công bố hiện NGAY khi mở, kèm đường dẫn sang Cài đặt', () => {
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    expect(screen.getByTestId('ai-reads-notes-notice')).toHaveTextContent(
      'Gia sư có thể đọc tiến độ và ghi chú của bạn cho khoá học này để trả lời sát hơn.',
    );
    const link = screen.getByRole('link', { name: 'Cài đặt' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/settings');
  });

  it('câu công bố vẫn còn đó sau khi đã có vài lượt', async () => {
    const { sse } = nextChat();
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
      await flush();
    });
    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });
    expect(screen.getByTestId('ai-reads-notes-notice')).toBeInTheDocument();
  });
});

describe('AskPanel — courseSlug tới biên panel (Important 3, review vòng 1)', () => {
  it('courseSlug truyền vào AskPanel đi ra ĐÚNG course_slug trên dây', async () => {
    const { requests, sse } = nextChat();
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} courseSlug="so-dau-phay-dong" onClose={() => {}} />));
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
      await flush();
    });
    expect(requests[0].course_slug).toBe('so-dau-phay-dong');
    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });
  });

  it('KHÔNG truyền courseSlug (một màn không thuộc course nào) vẫn gửi được, course_slug rỗng', async () => {
    const { requests, sse } = nextChat();
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
      await flush();
    });
    expect(requests[0].course_slug).toBe('');
    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });
  });
});

/**
 * Minor #2, review vòng 1: `turn.failure && !blocked` (bản cũ) ẩn thông báo
 * của MỌI lượt hễ lượt CUỐI là `NoCredit` — một lượt trước đó hỏng vì
 * `ProviderFailed` mất tích khỏi mạch không lý do. Chỉ lượt GÂY RA chặn mới
 * cần ẩn (khối lời mời đã nói thay nó).
 */
describe('AskPanel — lỗi của lượt TRƯỚC không biến mất khi lượt SAU hết credit', () => {
  it('lượt 1 hỏng ProviderFailed vẫn còn thông báo, sau khi lượt 2 hỏng NoCredit và chặn ô nhập', async () => {
    const first = nextChat();
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    typeQuestion('hỏi 1');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
      await flush();
    });
    await act(async () => {
      first.sse.event('error', { code: 'ProviderFailed', text: 'the AI provider could not complete this turn' });
      first.sse.close();
      await flush();
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);

    server.use(
      http.post('/ai/chat', () => HttpResponse.json({ code: 'NoCredit', error: 'no AI credit remaining' }, { status: 402 })),
    );
    typeQuestion('hỏi 2');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
      await flush();
    });

    // Chặn đã bật (lời mời nạp hiện ra)...
    expect(screen.getByTestId('ai-needs-setup')).toBeInTheDocument();
    // ...NHƯNG thông báo của lượt 1 vẫn ở đó — nó không phải nguyên nhân
    // gây chặn, và người học vẫn cần biết lượt 1 đã hỏng vì sao.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nhà cung cấp AI không hoàn tất được lượt này. Thử lại sau một chút.',
    );
  });
});

describe('AskPanel — hỏi, chảy chữ, huỷ', () => {
  it('gửi ngữ cảnh chương GỘP VÀO question; câu hỏi HIỂN THỊ vẫn ngắn', async () => {
    const { requests, sse } = nextChat();
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));

    typeQuestion('Số mũ lệch là gì?');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
      await flush();
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].question).toBe(`${SYSTEM}\n\nSố mũ lệch là gì?`);
    expect(requests[0].course_slug).toBe('');
    expect(screen.getByText('Số mũ lệch là gì?')).toBeInTheDocument();

    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });
  });

  it('chữ CHẢY VỀ TỪNG MẢNH — màn hình đổi giữa chừng, không đợi hết mới hiện', async () => {
    const { sse } = nextChat();
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
      await flush();
    });

    await act(async () => {
      sse.event('delta', { text: 'Số mũ ' });
      await flush();
    });
    // Khẳng định GIỮA CHỪNG. Một cài đặt gom hết rồi mới vẽ vẫn xanh nếu chỉ
    // khẳng định ở cuối — đó là toàn bộ khác biệt giữa "streaming" và "chậm".
    expect(screen.getByTestId('ai-answer')).toHaveTextContent('Số mũ');
    expect(screen.getByRole('button', { name: 'Dừng' })).toBeInTheDocument();

    await act(async () => {
      sse.event('delta', { text: 'lệch 127.' });
      sse.event('done', {});
      sse.close();
      await flush();
    });
    expect(screen.getByTestId('ai-answer')).toHaveTextContent('Số mũ lệch 127.');
    expect(screen.queryByRole('button', { name: 'Dừng' })).toBeNull();
  });

  it('bấm Dừng huỷ THẬT bằng AbortSignal, và giữ phần chữ đã nhận', async () => {
    const { requests, sse } = nextChat();
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
      await flush();
    });
    await act(async () => {
      sse.event('delta', { text: 'một nửa' });
      await flush();
    });

    await act(async () => {
      screen.getByRole('button', { name: 'Dừng' }).click();
      await flush();
    });

    expect(requests[0].signal.aborted).toBe(true);
    expect(screen.getByTestId('ai-answer')).toHaveTextContent('một nửa');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ĐÓNG panel giữa chừng cũng huỷ THẬT — không để lời gọi chạy tiếp và tính credit', async () => {
    const { requests, sse } = nextChat();
    const { unmount } = render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
      await flush();
    });
    await act(async () => {
      sse.event('delta', { text: 'x' });
      await flush();
    });

    unmount();
    await flush();
    expect(requests[0].signal.aborted).toBe(true);
  });

  it('hết credit GIỮA CHỪNG hiện lời mời nạp, không phải một mã lỗi trần', async () => {
    server.use(
      http.post('/ai/chat', () => HttpResponse.json({ code: 'NoCredit', error: 'no AI credit remaining' }, { status: 402 })),
    );
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
      await flush();
    });

    expect(screen.getByTestId('ai-needs-setup')).toBeInTheDocument();
    // Chặn xong thì ô nhập biến mất — không mời người học gõ một câu chắc
    // chắn hỏng nữa vì tài khoản vẫn hết credit.
    expect(screen.queryByLabelText('Câu hỏi của bạn')).toBeNull();
  });

  /**
   * CỔNG CHỐNG TÁI PHẠM cho E1 của review tổng nhánh Pha 2.
   *
   * `ai.panel.noCredit` từng bảo người học "Nạp thêm trong trang cấu hình" —
   * và `/settings` không có nút nạp, không form, không liên kết ra ngoài
   * (`CreditPanel.tsx` chỉ vẽ số dư + sổ dùng). Thanh toán là Pha 4.
   *
   * Đo lại 2026-08-29, và ghi CHÍNH XÁC thứ đã đo chứ không chép lại: quét
   * `topup|payment|stripe` (không dấu, không phân biệt hoa thường) trên
   * `apps/web/src` + `apps/api/internal` + mọi `packages/<gói>/src`, bỏ tệp test →
   * **0** kết quả. Từ `checkout` bị bỏ khỏi phép quét có chủ đích: nó khớp
   * 10 dòng, và cả 10 dùng nó theo nghĩa `git checkout`, không phải nghĩa
   * thanh toán — một needle cho dương tính giả không chứng minh được gì.
   *
   * Quét VĂN BẢN ĐÃ RENDER, không so khớp một khoá — cùng lối
   * `Settings.copy.test.tsx` và `Login.test.tsx` canh hai trang kia, và vì
   * cùng một lý do: lời hứa có thể quay lại qua BẤT KỲ khoá nào, kể cả một
   * khoá chưa ai đặt tên. Chốt chống-rỗng là dòng `ai-needs-setup` ngay
   * trên: nếu khối lời mời không render thì phép quét "không chứa" vô nghĩa.
   *
   * GIỚI HẠN, nói thẳng: đây là so khớp CỤM CỐ ĐỊNH. Một câu diễn đạt lại
   * cùng lời hứa mà né được cả bốn cụm sẽ đi qua. Vẫn chọn cách này vì nó
   * bắt được ca hồi quy thực tế nhất — ai đó khôi phục nguyên văn câu cũ.
   */
  it('lời mời KHÔNG hứa một nút nạp tiền không tồn tại (E1)', async () => {
    server.use(
      http.post('/ai/chat', () => HttpResponse.json({ code: 'NoCredit', error: 'no AI credit remaining' }, { status: 402 })),
    );
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
      await flush();
    });

    expect(screen.getByTestId('ai-needs-setup')).toBeInTheDocument();

    const rendered = document.body.textContent ?? '';
    for (const loiHua of [/nạp thêm/i, /tự nạp được ngay/i, /top up/i, /add credit yourself/i]) {
      expect(rendered).not.toMatch(loiHua);
    }
  });

  /**
   * BÀI CHỊU LỰC của Step 2 ở tầng UI: `NoCredit` và `ProviderFailed` phải
   * dẫn tới hai màn hình KHÁC NHAU — một lời mời nạp (chặn ô nhập), một lỗi
   * bình thường (không chặn, người học hỏi tiếp được ngay). Đột biến
   * (task-13-report.md): đổi `needsSetup` trong `AskPanel.tsx` thành
   * `Boolean(error)` (bất kỳ lỗi nào cũng chặn) ⇒ bài này phải ĐỎ.
   */
  it('lỗi của NHÀ CUNG CẤP hiện như một lỗi bình thường, KHÔNG giả làm lời mời nạp credit', async () => {
    const { sse } = nextChat();
    render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
      await flush();
    });
    await act(async () => {
      sse.event('error', { code: 'ProviderFailed', text: 'the AI provider could not complete this turn' });
      sse.close();
      await flush();
    });

    // Câu HIỂN THỊ là câu ĐÃ DỊCH theo mã, không phải chuỗi tiếng Anh thô mà
    // "error" event mang theo — xem `useAI.ts`'s `describeFailure`.
    expect(screen.getByRole('alert')).toHaveTextContent('Nhà cung cấp AI không hoàn tất được lượt này. Thử lại sau một chút.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('the AI provider could not complete this turn');
    expect(screen.queryByTestId('ai-needs-setup')).toBeNull();
    // KHÔNG chặn: ô nhập vẫn còn, người học hỏi tiếp được ngay.
    expect(screen.getByLabelText('Câu hỏi của bạn')).toBeInTheDocument();
  });

  it('`autoAsk` hỏi NGAY khi mở — "Đào sâu" không bắt người học gõ lại câu hỏi', async () => {
    const { requests, sse } = nextChat();
    render(
      wrap(
        <AskPanel
          heading="Đào sâu"
          system={SYSTEM}
          initialQuestion="Giải thích kỹ đoạn này giúp tôi."
          autoAsk
          onClose={() => {}}
        />,
      ),
    );
    await act(async () => {
      await flush();
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].question).toBe(`${SYSTEM}\n\nGiải thích kỹ đoạn này giúp tôi.`);

    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });
  });

  it('`autoAsk` KHÔNG hỏi hai lần dưới StrictMode-kiểu chốt — chỉ một request', async () => {
    const { requests, sse } = nextChat();
    render(wrap(<AskPanel heading="Đào sâu" system={SYSTEM} initialQuestion="x" autoAsk onClose={() => {}} />));
    await act(async () => {
      await flush();
    });
    expect(requests).toHaveLength(1);
    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 * KÉO ĐỔI CỠ — không đụng gì tới `useAI`/mạng, giữ nguyên từ Pha 1.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Bài này canh MỘT lỗi cụ thể, và nó là lỗi người dùng bắt được sau khi tôi báo
 * xong: kéo một lần rồi buông chuột, sau đó chỉ cần rê chuột ngang tay kéo là
 * panel lại chạy theo chuột.
 *
 * Nguyên nhân không nằm ở logic đổi cỡ mà ở một tính chất của React:
 * `e.currentTarget` chỉ có giá trị TRONG lúc React phát sự kiện, rồi về `null`.
 * Lệnh gỡ listener nằm trong `onUp` — chạy sau đó rất lâu — nên nó nổ vào `null`
 * và `pointermove` ở lại trên phần tử vĩnh viễn.
 *
 * Không có bài này thì lần refactor sau viết lại đúng như thế mà vẫn xanh: mọi
 * bài khác chỉ đo lúc ĐANG kéo, còn lỗi thì chỉ hiện ra SAU khi buông.
 */
describe('AskPanel — kéo đổi cỡ', () => {
  function panelBox(): HTMLElement {
    return screen.getByRole('dialog');
  }

  function grip(): HTMLElement {
    return screen.getByLabelText('Kéo để đổi cỡ khung');
  }

  /**
   * jsdom trả `getBoundingClientRect()` toàn số 0 cho MỌI phần tử, và điều đó
   * âm thầm làm hỏng một bài kiểm đổi cỡ: bề rộng mới tính từ `rect.width`, nên
   * với `rect.width === 0` mọi phép kéo đều rơi xuống dưới chặn dưới 320px và
   * bị kẹp về đúng 320. Hai lần kéo khác nhau ra cùng một con số, và bài kiểm
   * không phân biệt được "listener đã gỡ" với "chưa gỡ".
   *
   * Tôi đã viết bài kiểm ấy và nó XANH cả khi lỗi còn nguyên; phép thử đột biến
   * là thứ chỉ ra. Cho panel một cỡ thật thì số học lại có nghĩa.
   */
  function stubPanelSize(el: HTMLElement, width: number, height: number) {
    el.getBoundingClientRect = () =>
      ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  }

  /** jsdom không cài Pointer Capture API; panel chỉ cần nó không ném. */
  function stubPointerCapture(el: HTMLElement) {
    const captured = new Set<number>();
    Object.assign(el, {
      setPointerCapture: (id: number) => captured.add(id),
      releasePointerCapture: (id: number) => captured.delete(id),
      hasPointerCapture: (id: number) => captured.has(id),
    });
  }

  it('buông chuột xong thì rê chuột KHÔNG còn đổi cỡ nữa', () => {
    render(wrap(<AskPanel heading="Hỏi" system="ngữ cảnh" onClose={() => undefined} />));

    const g = grip();
    stubPointerCapture(g);
    stubPanelSize(panelBox(), 480, 400);

    // Panel chưa có cỡ inline nào: CSS đang quyết định.
    expect(panelBox().style.width).toBe('');

    fireEvent.pointerDown(g, { pointerId: 1, clientX: 500, clientY: 500 });
    // Kéo lên–trái là rộng ra và cao lên: 480 + 100 = 580px.
    act(() => {
      g.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 400, bubbles: true }));
    });
    const afterDrag = panelBox().style.width;
    expect(afterDrag, 'kéo mà cỡ không đổi — bài này đang đo nhầm thứ').toBe('580px');

    fireEvent.pointerUp(g, { pointerId: 1 });

    // ĐÂY là lời khẳng định thật: rê chuột sau khi đã buông. Toạ độ chọn sao
    // cho nếu listener CÒN sống thì con số ra khác hẳn (480 + 300 = 780px), chứ
    // không rơi vào cùng một mức bị kẹp.
    act(() => {
      g.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 200, bubbles: true }));
    });
    expect(panelBox().style.width, 'panel vẫn chạy theo chuột sau khi đã buông').toBe(afterDrag);
  });

  it('thao tác bị cắt ngang (pointercancel) cũng gỡ được listener', () => {
    render(wrap(<AskPanel heading="Hỏi" system="ngữ cảnh" onClose={() => undefined} />));

    const g = grip();
    stubPointerCapture(g);
    stubPanelSize(panelBox(), 480, 400);

    fireEvent.pointerDown(g, { pointerId: 1, clientX: 500, clientY: 500 });
    act(() => {
      g.dispatchEvent(new MouseEvent('pointermove', { clientX: 420, clientY: 420, bubbles: true }));
    });
    const afterDrag = panelBox().style.width;
    expect(afterDrag).toBe('560px');

    fireEvent.pointerCancel(g, { pointerId: 1 });
    act(() => {
      g.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 100, bubbles: true }));
    });
    expect(panelBox().style.width).toBe(afterDrag);
  });

  /**
   * Một cỡ inline thắng mọi luật CSS, nên sau một lần kéo thì nút "mở rộng" im
   * lặng không làm gì — lỗi thứ hai người dùng bắt được trong cùng một vòng.
   */
  it('bấm mở rộng trả quyền quyết định cỡ lại cho CSS', () => {
    render(wrap(<AskPanel heading="Hỏi" system="ngữ cảnh" onClose={() => undefined} />));

    const g = grip();
    stubPointerCapture(g);
    stubPanelSize(panelBox(), 480, 400);
    fireEvent.pointerDown(g, { pointerId: 1, clientX: 500, clientY: 500 });
    act(() => {
      g.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 400, bubbles: true }));
    });
    fireEvent.pointerUp(g, { pointerId: 1 });
    expect(panelBox().style.width).not.toBe('');

    fireEvent.click(screen.getByLabelText('Mở rộng khung hỏi–đáp'));
    expect(panelBox().style.width).toBe('');
  });
});
