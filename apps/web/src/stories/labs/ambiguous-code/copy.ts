import type { Lang } from '../../../i18n';

interface AmbiguousCodeCopy {
  prediction: string;
  codeFor: (symbol: string) => string;
  currentBook: string;
  sourceSymbols: string;
  addSymbol: string;
  deleteLast: string;
  clear: string;
  send: string;
  preset: string;
  invalidCodebook: string;
  invalidSymbols: string;
  prefixFree: string;
  prefixCollision: string;
  awaitingSend: string;
  signal: string;
  sentSymbols: string;
  treeLabel: string;
  readings: string;
  noReadings: string;
  exactTotal: (count: string) => string;
  hiddenReadings: string;
  sentBook: string;
  symbol: string;
  code: string;
  result: (count: string) => string;
  explanation: string;
}

export const ambiguousCodeCopy = {
  vi: {
    prediction: 'Bạn dự đoán tín hiệu này có bao nhiêu cách đọc? Dự đoán là tùy chọn và không được chấm điểm.',
    codeFor: (symbol) => `Mã cho ${symbol}`,
    currentBook: 'Bộ mã đang thử',
    sourceSymbols: 'Chuỗi ký hiệu nguồn',
    addSymbol: 'Thêm ký hiệu',
    deleteLast: 'Xoá ký hiệu cuối',
    clear: 'Xoá chuỗi',
    send: 'Gửi',
    preset: 'Dùng bộ mã không tiền tố',
    invalidCodebook: 'Mỗi mã phải có từ 1 đến 6 chữ số nhị phân.',
    invalidSymbols: 'Chọn từ 1 đến 6 ký hiệu A, B, C hoặc D.',
    prefixFree: 'Bộ mã này không có tiền tố; mỗi tín hiệu tách được có nhiều nhất một cách đọc.',
    prefixCollision: 'Bộ mã này có va chạm tiền tố. Một số tín hiệu có thể có nhiều cách đọc; số khác thì không.',
    awaitingSend: 'Chọn Gửi để ghi lại tín hiệu và các cách đọc của nó.',
    signal: 'Tín hiệu đã gửi',
    sentSymbols: 'Chuỗi nguồn dùng cho lần Gửi gần nhất',
    treeLabel: 'Cây phân nhánh giải mã cho tín hiệu gần nhất',
    readings: 'Các cách đọc tương đương',
    noReadings: 'Không có cách đọc trọn vẹn.',
    exactTotal: (count) => `Tổng chính xác: ${count}`,
    hiddenReadings: 'Danh sách chỉ hiện 32 cách đầu; tổng phía trên vẫn là số đầy đủ.',
    sentBook: 'Bộ mã dùng cho lần Gửi gần nhất',
    symbol: 'Ký hiệu',
    code: 'Mã',
    result: (count) => count === '0'
      ? 'Không có cách đọc hợp lệ.'
      : count === '1'
        ? 'Có 1 cách đọc hợp lệ.'
        : `Có ${count} cách đọc hợp lệ; người nhận thiếu quy ước để chọn.`,
    explanation: 'Mô hình thử mọi ranh giới mã hợp lệ thay vì chọn tham lam. Va chạm tiền tố tạo khả năng nhập nhằng, nhưng không làm cho mọi tín hiệu đều nhập nhằng.',
  },
  en: {
    prediction: 'How many readings do you predict this signal will allow? Prediction is optional and is not scored.',
    codeFor: (symbol) => `Code for ${symbol}`,
    currentBook: 'Codebook being tried',
    sourceSymbols: 'Source symbols',
    addSymbol: 'Add symbol',
    deleteLast: 'Delete last symbol',
    clear: 'Clear symbols',
    send: 'Send',
    preset: 'Use prefix-free preset',
    invalidCodebook: 'Use 1 to 6 binary digits for every code.',
    invalidSymbols: 'Choose 1 to 6 symbols from A, B, C and D.',
    prefixFree: 'This codebook is prefix-free; each decodable signal has at most one reading.',
    prefixCollision: 'This codebook has a prefix collision. Some signals may have several readings; others may not.',
    awaitingSend: 'Choose Send to record the signal and its possible readings.',
    signal: 'Sent signal',
    sentSymbols: 'Source used for the last Send',
    treeLabel: 'Branching decode for the last signal',
    readings: 'Equivalent readings',
    noReadings: 'No complete reading exists.',
    exactTotal: (count) => `Exact total: ${count}`,
    hiddenReadings: 'The list shows only the first 32 readings; the total above remains exact.',
    sentBook: 'Codebook used for the last Send',
    symbol: 'Symbol',
    code: 'Code',
    result: (count) => count === '0'
      ? 'There are 0 valid readings.'
      : count === '1'
        ? 'There is 1 valid reading.'
        : `There are ${count} valid readings; the receiver lacks a rule for choosing.`,
    explanation: 'The model tries every valid code boundary instead of making a greedy choice. A prefix collision makes ambiguity possible, but it does not make every signal ambiguous.',
  },
} satisfies Record<Lang, AmbiguousCodeCopy>;
