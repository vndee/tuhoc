import type { Lang } from '../../../i18n';
import type { ChannelCode, TransmissionConfig } from '../communication/types';
import type { BatchConfig } from './batch';

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
  compare: string;
  cancelComparison: string;
  batchProgress: string;
  progress: (done: number, total: number) => string;
  incomplete: (done: number, total: number) => string;
  complete: string;
  batchTable: string;
  batchExact: string;
  batchRejected: string;
  batchSilent: string;
  batchBer: string;
  noDecodedBits: string;
  batchLimit: string;
  batchStaleMessage: string;
  batchStaleSettings: string;
  capturedBatch: (revision: number, config: BatchConfig) => string;
  excluded: (codes: string) => string;
  noEligible: string;
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
    currentReceipt: 'Biên nhận lần truyền đã chụp', previousReceipt: 'Lần truyền trước đó',
    previousReceiptWarning: 'Biên nhận này thuộc lượt trước, không phải lượt bị từ chối vì ngân sách.',
    staleMessage: 'Biên nhận của câu trước', staleSettings: 'Biên nhận của thông số trước',
    sourceHex: 'Byte nguồn đã chụp', receivedHex: 'Byte nhận ở hệ thập lục phân',
    capturedSettings: (config) => `Thông số đã chụp: ${config.code}, ngân sách ${config.budget}, p=${config.p.toFixed(2)}, seed ${config.seed}.`,
    flipped: (count) => `Bit bị lật trong kênh: ${count}.`, payloadErrors: (count) => `Lỗi bit dữ liệu sau giải mã: ${count}.`,
    exact: 'Nhận đúng từng byte', corrupted: 'Hỏng âm thầm: byte được chấp nhận khác byte nguồn.',
    rejected: 'Bị từ chối: SECDED phát hiện một mẫu lỗi không thể sửa.', noPayload: 'Không dữ liệu nào được chấp nhận.',
    validButDifferent: 'Văn bản nhận là UTF-8 hợp lệ, nhưng các byte không khớp chính xác.',
    invalidUtf8: 'Không thể giải mã thành văn bản UTF-8 hợp lệ',
    budgetExceeded: (missing) => `Vượt ngân sách: thiếu ${missing} lần dùng kênh. Toàn thông điệp bị từ chối và không có biên nhận mới.`,
    theory: 'Dung lượng BSC tiệm cận',
    theoryFormula: (p, capacity, rate) => `C = 1 − Hb(p). Với p=${p.toFixed(2)}, C=${capacity.toFixed(3)} bit/lần dùng; tốc độ mã đã chọn R=${rate.toFixed(3)}.`,
    theoryLimit: 'Đây là giới hạn tiệm cận dưới giả định BSC, không phải bảo đảm cho một lượt hữu hạn. R<C không bảo đảm mã ngắn raw, repetition hoặc SECDED này truyền tin cậy; R≥C không có nghĩa mọi thông điệp đơn lẻ đều thất bại.',
    modelLimit: 'Mô hình gửi UTF-8 chưa nén qua các lần lật bit độc lập. Nó không mô phỏng ACK, lỗi header, chèn/xóa bit hoặc truyền lại.',
    feedback: 'Ngân sách cho biết toàn thông điệp có thể đi qua hay không; biên nhận cho biết chính lượt đã chụp kết thúc thế nào.',
    compare: 'So sánh 200 lượt', cancelComparison: 'Hủy so sánh', batchProgress: 'Tiến độ so sánh',
    progress: (done, total) => `Đang so sánh: ${done} / ${total} lượt truyền.`,
    incomplete: (done, total) => `Chưa hoàn tất: ${done} / ${total} lượt truyền.`,
    complete: 'So sánh đã hoàn tất.', batchTable: 'So sánh 200 lượt đã hoàn tất',
    batchExact: 'Đúng toàn thông điệp / 200', batchRejected: 'Bị từ chối / 200', batchSilent: 'Hỏng âm thầm / 200',
    batchBer: 'Lỗi bit / bit dữ liệu được giải mã (BER)', noDecodedBits: 'Không có dữ liệu được giải mã; BER không xác định.',
    batchLimit: 'Mỗi mã đủ ngân sách dùng cùng 200 seed liên tiếp. Thành công là khớp toàn thông điệp. BER chỉ tính các lượt có dữ liệu đầu ra; số lượt bị từ chối được ghi riêng. Đây là so sánh thực nghiệm, không phải bảo đảm.',
    batchStaleMessage: 'So sánh của câu trước', batchStaleSettings: 'So sánh của thông số trước',
    capturedBatch: (revision, config) => `So sánh đã chụp: phiên bản ${revision}, ngân sách ${config.budget}, p=${config.p.toFixed(2)}, seed ${config.seed}.`,
    excluded: (codes) => `Không đủ ngân sách: ${codes}.`, noEligible: 'Không mã nào gửi được toàn thông điệp trong ngân sách này.',
  },
  en: {
    prediction: 'Which code do you expect to carry the whole message within this budget? The prediction is optional and is not scored.',
    code: 'Channel code', codeLabels: { raw: 'Raw', repeat3: 'Repeat three times', secded: 'SECDED (4,8)' },
    budget: 'Transmission budget in channel uses', probability: 'Configured flip probability p', seed: 'Noise seed',
    newSeed: 'New noise sample', run: 'Run transmission', awaiting: 'Run one transmission to create a receipt for the captured message and settings.',
    budgetTable: 'Current whole-message budget', budgetMetric: 'Item', budgetValue: 'Value',
    payloadBits: 'Payload bits', required: 'Required channel uses', capacity: 'Maximum payload capacity',
    unused: 'Unused channel uses', missing: 'Missing channel uses', codeRate: 'Code rate',
    currentReceipt: 'Captured transmission receipt', previousReceipt: 'Previous transmission attempt',
    previousReceiptWarning: 'This receipt is from the earlier run, not the budget-rejected attempt.',
    staleMessage: 'Receipt for the previous message', staleSettings: 'Receipt for the previous settings',
    sourceHex: 'Captured source bytes', receivedHex: 'Received bytes in hexadecimal',
    capturedSettings: (config) => `Captured settings: ${config.code}, budget ${config.budget}, p=${config.p.toFixed(2)}, seed ${config.seed}.`,
    flipped: (count) => `Raw channel flips: ${count}.`, payloadErrors: (count) => `Payload bit errors after decoding: ${count}.`,
    exact: 'Exact delivery', corrupted: 'Silent corruption: accepted bytes differ from the source.',
    rejected: 'Rejected: SECDED detected an uncorrectable error pattern.', noPayload: 'No payload was accepted.',
    validButDifferent: 'Received text is valid UTF-8, but the bytes are not exact.',
    invalidUtf8: 'Cannot decode as valid UTF-8 text',
    budgetExceeded: (missing) => `Budget exceeded: ${missing} more channel uses are required. The whole message was rejected and no new receipt was created.`,
    theory: 'Asymptotic BSC capacity',
    theoryFormula: (p, capacity, rate) => `C = 1 − Hb(p). At p=${p.toFixed(2)}, C=${capacity.toFixed(3)} bits/use; the selected code rate is R=${rate.toFixed(3)}.`,
    theoryLimit: 'This asymptotic BSC limit is not a finite-run guarantee. R<C does not guarantee reliable transmission by this short raw, repetition, or SECDED code; R≥C does not mean every individual message fails.',
    modelLimit: 'The model sends uncompressed UTF-8 through independent bit flips. It does not simulate acknowledgements, header errors, insertions/deletions, or retransmission.',
    feedback: 'The budget says whether the whole message can be sent; the receipt says how that captured run ended.',
    compare: 'Compare 200 trials', cancelComparison: 'Cancel comparison', batchProgress: 'Comparison progress',
    progress: (done, total) => `Comparing: ${done} / ${total} transmissions.`,
    incomplete: (done, total) => `Incomplete: ${done} / ${total} transmissions.`,
    complete: 'Comparison complete.', batchTable: 'Completed 200-trial comparison',
    batchExact: 'Whole-message exact / 200', batchRejected: 'Rejected / 200', batchSilent: 'Silent corruption / 200',
    batchBer: 'Bit errors / decoded payload bits (BER)', noDecodedBits: 'No decoded payload; BER is undefined.',
    batchLimit: 'Every eligible code uses the same 200 consecutive seeds. Success means the entire message matches. BER includes only output-bearing trials; rejected trials are counted separately. This is an empirical comparison, not a guarantee.',
    batchStaleMessage: 'Comparison for the previous message', batchStaleSettings: 'Comparison for the previous settings',
    capturedBatch: (revision, config) => `Captured comparison: revision ${revision}, budget ${config.budget}, p=${config.p.toFixed(2)}, seed ${config.seed}.`,
    excluded: (codes) => `Excluded by budget: ${codes}.`, noEligible: 'No code fits the whole message within this budget.',
  },
} satisfies Record<Lang, ChannelBudgetCopy>;
