import type { Lang } from '../../../i18n';
import type { ChannelCode, TransmissionConfig } from '../communication/types';

interface ChannelBudgetCopy {
  prediction: string;
  code: string;
  codeLabels: Record<ChannelCode, string>;
  budget: string;
  probability: string;
  seed: string;
  newSeed: string;
  run: string;
  awaiting: string;
  budgetTable: string;
  budgetMetric: string;
  budgetValue: string;
  payloadBits: string;
  required: string;
  capacity: string;
  unused: string;
  missing: string;
  codeRate: string;
  currentReceipt: string;
  previousReceipt: string;
  previousReceiptWarning: string;
  staleMessage: string;
  staleSettings: string;
  sourceHex: string;
  receivedHex: string;
  capturedSettings: (config: TransmissionConfig) => string;
  flipped: (count: number) => string;
  payloadErrors: (count: number) => string;
  exact: string;
  corrupted: string;
  rejected: string;
  noPayload: string;
  validButDifferent: string;
  invalidUtf8: string;
  budgetExceeded: (missing: number) => string;
  theory: string;
  theoryFormula: (p: number, capacity: number, rate: number) => string;
  theoryLimit: string;
  modelLimit: string;
  feedback: string;
}

export const channelBudgetCopy = {
  vi: {
    prediction: 'Bạn dự đoán mã nào sẽ đưa nguyên câu qua ngân sách này? Dự đoán là tùy chọn và không được chấm điểm.',
    code: 'Mã kênh', codeLabels: { raw: 'Không mã hóa', repeat3: 'Lặp ba lần', secded: 'SECDED (4,8)' },
    budget: 'Ngân sách truyền tính bằng lần dùng kênh', probability: 'Xác suất lật bit p', seed: 'Seed nhiễu',
    newSeed: 'Đổi mẫu nhiễu', run: 'Truyền một lần', awaiting: 'Truyền một lần để tạo biên nhận cho đúng câu và thông số đang chọn.',
    budgetTable: 'Ngân sách toàn thông điệp hiện tại', budgetMetric: 'Thành phần', budgetValue: 'Giá trị',
    payloadBits: 'Bit dữ liệu', required: 'Lần dùng kênh cần thiết', capacity: 'Dung lượng dữ liệu tối đa',
    unused: 'Lần dùng kênh còn trống', missing: 'Lần dùng kênh còn thiếu', codeRate: 'Tốc độ mã',
    currentReceipt: 'Biên nhận lần truyền đã chụp', previousReceipt: 'Lần thành công trước đó',
    previousReceiptWarning: 'Biên nhận này thuộc lượt trước, không phải lượt bị từ chối vì ngân sách.',
    staleMessage: 'Biên nhận của câu trước', staleSettings: 'Biên nhận của thông số trước',
    sourceHex: 'Byte nguồn đã chụp', receivedHex: 'Byte nhận ở hệ thập lục phân',
    capturedSettings: (config) => `Thông số đã chụp: ${config.code}, ngân sách ${config.budget}, p=${config.p.toFixed(2)}, seed ${config.seed}.`,
    flipped: (count) => `Bit bị lật trong kênh: ${count}.`, payloadErrors: (count) => `Lỗi bit dữ liệu sau giải mã: ${count}.`,
    exact: 'Nhận đúng từng byte', corrupted: 'Hỏng âm thầm: byte được chấp nhận khác byte nguồn.',
    rejected: 'Bị từ chối: một từ SECDED phát hiện hai lỗi.', noPayload: 'Không dữ liệu nào được chấp nhận.',
    validButDifferent: 'Văn bản nhận là UTF-8 hợp lệ, nhưng các byte không khớp chính xác.',
    invalidUtf8: 'Không thể giải mã thành văn bản UTF-8 hợp lệ',
    budgetExceeded: (missing) => `Vượt ngân sách: thiếu ${missing} lần dùng kênh. Toàn thông điệp bị từ chối và không có biên nhận mới.`,
    theory: 'Dung lượng BSC tiệm cận',
    theoryFormula: (p, capacity, rate) => `C = 1 − Hb(p). Với p=${p.toFixed(2)}, C=${capacity.toFixed(3)} bit/lần dùng; tốc độ mã đã chọn R=${rate.toFixed(3)}.`,
    theoryLimit: 'Đây là giới hạn tiệm cận dưới giả định BSC, không phải bảo đảm cho một lượt hữu hạn. R<C không bảo đảm mã ngắn raw, repetition hoặc SECDED này truyền tin cậy; R≥C không có nghĩa mọi thông điệp đơn lẻ đều thất bại.',
    modelLimit: 'Mô hình gửi UTF-8 chưa nén qua các lần lật bit độc lập. Nó không mô phỏng ACK, lỗi header, chèn/xóa bit hoặc truyền lại.',
    feedback: 'Ngân sách cho biết toàn thông điệp có thể đi qua hay không; biên nhận cho biết chính lượt đã chụp kết thúc thế nào.',
  },
  en: {
    prediction: 'Which code do you expect to carry the whole message within this budget? The prediction is optional and is not scored.',
    code: 'Channel code', codeLabels: { raw: 'Raw', repeat3: 'Repeat three times', secded: 'SECDED (4,8)' },
    budget: 'Transmission budget in channel uses', probability: 'Configured flip probability p', seed: 'Noise seed',
    newSeed: 'New noise sample', run: 'Run transmission', awaiting: 'Run one transmission to create a receipt for the captured message and settings.',
    budgetTable: 'Current whole-message budget', budgetMetric: 'Item', budgetValue: 'Value',
    payloadBits: 'Payload bits', required: 'Required channel uses', capacity: 'Maximum payload capacity',
    unused: 'Unused channel uses', missing: 'Missing channel uses', codeRate: 'Code rate',
    currentReceipt: 'Captured transmission receipt', previousReceipt: 'Previous successful attempt',
    previousReceiptWarning: 'This receipt is from the earlier run, not the budget-rejected attempt.',
    staleMessage: 'Receipt for the previous message', staleSettings: 'Receipt for the previous settings',
    sourceHex: 'Captured source bytes', receivedHex: 'Received bytes in hexadecimal',
    capturedSettings: (config) => `Captured settings: ${config.code}, budget ${config.budget}, p=${config.p.toFixed(2)}, seed ${config.seed}.`,
    flipped: (count) => `Raw channel flips: ${count}.`, payloadErrors: (count) => `Payload bit errors after decoding: ${count}.`,
    exact: 'Exact delivery', corrupted: 'Silent corruption: accepted bytes differ from the source.',
    rejected: 'Rejected: a SECDED word detected two errors.', noPayload: 'No payload was accepted.',
    validButDifferent: 'Received text is valid UTF-8, but the bytes are not exact.',
    invalidUtf8: 'Cannot decode as valid UTF-8 text',
    budgetExceeded: (missing) => `Budget exceeded: ${missing} more channel uses are required. The whole message was rejected and no new receipt was created.`,
    theory: 'Asymptotic BSC capacity',
    theoryFormula: (p, capacity, rate) => `C = 1 − Hb(p). At p=${p.toFixed(2)}, C=${capacity.toFixed(3)} bits/use; the selected code rate is R=${rate.toFixed(3)}.`,
    theoryLimit: 'This asymptotic BSC limit is not a finite-run guarantee. R<C does not guarantee reliable transmission by this short raw, repetition, or SECDED code; R≥C does not mean every individual message fails.',
    modelLimit: 'The model sends uncompressed UTF-8 through independent bit flips. It does not simulate acknowledgements, header errors, insertions/deletions, or retransmission.',
    feedback: 'The budget says whether the whole message can be sent; the receipt says how that captured run ended.',
  },
} satisfies Record<Lang, ChannelBudgetCopy>;
