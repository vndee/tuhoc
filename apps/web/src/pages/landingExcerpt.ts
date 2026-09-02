/**
 * Nội dung ví dụ cho landing (`Landing.tsx`).
 *
 * Trích đoạn là NỘI DUNG KHOÁ HỌC — chương 1.1 của khoá mẫu công khai
 * `fixtures/courses/bat-bien-vong-lap` — nên nó ở đây, không ở catalog i18n:
 * catalog giữ chuỗi giao diện, còn một chương thì mang ngôn ngữ của chính nó
 * (`manifest.lang = 'vi'`) dù giao diện đang là tiếng Anh, y như trong reader.
 *
 * Ghi chú lề và biên bản hỏi đáp là VÍ DỤ do nền tảng viết, không phải dữ liệu
 * của một người dùng thật và không phải một lượt gọi mô hình thật. Giao diện
 * gắn nhãn "ví dụ" ở mọi chỗ chúng xuất hiện (`landing.example`, và các đầu
 * mục "(ví dụ)"); đó là điều kiện để trang được phép trình diễn cơ chế mà
 * không bịa bằng chứng — xem PRODUCT.md, Positioning, lời hứa số 1.
 *
 * Đoạn dẫn bỏ câu cuối của chương ("Chương này đi từ chỗ bí đó…") để hành
 * động chính còn nằm trong khung nhìn đầu trên laptop có thanh trình duyệt —
 * đo ở 1440×900: 820px xuống ~740px. Câu được bôi đen là câu chương ấy thật sự nói, và ghi chú ví dụ nói đúng
 * điều chương 1.2 sẽ định nghĩa: một khẳng định đúng ở mọi lần lặp.
 */

export const DEMO_COURSE = {
  slug: 'bat-bien-vong-lap',
  title: 'Bất biến vòng lặp',
  chapters: [
    { id: 'c1', num: '1.1', title: 'Vì sao chạy thử không kết luận được' },
    { id: 'c2', num: '1.2', title: 'Ba nghĩa vụ của một bất biến' },
    { id: 'c3', num: '1.3', title: 'Tìm bất biến từ đâu ra' },
  ],
  part: 'Phần I · Từ chạy thử đến chứng minh',
} as const;

/** Một mảnh của một đoạn văn: chữ thường, in nghiêng, in đậm, hoặc câu được bôi đen. */
export interface Segment {
  readonly text: string;
  readonly kind?: 'i' | 'b' | 'mark';
}

export const EXCERPT_LEDE: readonly Segment[] = [
  { text: 'Ai cũng biết câu "kiểm thử chỉ chứng minh có lỗi, không chứng minh hết lỗi". Ít ai rút ra hệ quả của nó: nếu muốn một khẳng định đúng cho ' },
  { text: 'mọi', kind: 'i' },
  { text: ' đầu vào thì ' },
  { text: 'phải nói được điều gì đó về vòng lặp mà không cần biết nó đã chạy bao nhiêu lần', kind: 'mark' },
  { text: '.' },
];

export const EXCERPT_SETUP = 'Hàm dưới đây trả về phần tử lớn nhất của một dãy. Nó có một lỗi. Hãy tìm ra trước khi đọc tiếp:';

export const EXCERPT_CODE = `def lon_nhat(a):
    m = 0
    for i in range(len(a)):
        if a[i] > m:
            m = a[i]
    return m`;

export const EXCERPT_AFTER: readonly Segment[] = [
  { text: 'Sinh ngẫu nhiên mười nghìn dãy số nguyên trong khoảng [0, 1000] rồi so với hàm ' },
  { text: 'max', kind: 'b' },
  { text: ' có sẵn: ' },
  { text: 'mười nghìn lần khớp', kind: 'b' },
  { text: '. Sinh thêm một triệu lần nữa: vẫn khớp. Kết luận "hàm này đúng" nghe rất có cơ sở.' },
];

/** Ghi chú ví dụ, neo vào câu được bôi đen ở trên. Màu `y` là ô vàng `--s4`. */
export const EXAMPLE_NOTE = {
  quote: 'không cần biết nó đã chạy bao nhiêu lần',
  text: 'Đây chính là định nghĩa của bất biến: một khẳng định đúng ở MỌI lần lặp, độc lập với số lần.',
  color: 'y',
} as const;

/** Biên bản ví dụ: câu hỏi của người học, câu trả lời của gia sư có trích ghi chú. */
export const EXAMPLE_QA = {
  question: 'Mười nghìn lần chạy thử đều khớp mà vẫn sai được. Vậy chạy bao nhiêu lần mới đủ?',
  answerBefore:
    'Không có con số nào đủ, và ghi chú của bạn ở 1.1 đã chỉ đúng chỗ để bắt đầu:',
  answerQuote: 'một khẳng định đúng ở MỌI lần lặp, độc lập với số lần',
  answerAfter:
    'Mười nghìn lần chạy là mười nghìn mẫu từ một không gian đầu vào không đếm được. Bộ sinh chưa từng tạo một dãy toàn số âm, nên chúng không nói gì về ca ấy. Thứ bạn cần là một câu đúng cho mọi lần lặp; chương 1.2 gọi nó là bất biến và nêu ba việc nó phải làm.',
} as const;
