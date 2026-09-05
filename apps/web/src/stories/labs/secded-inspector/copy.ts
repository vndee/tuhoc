import type { Lang } from '../../../i18n';

export interface SecdedInspectorCopy {
  prediction: string;
  dataLegend: string;
  dataBit: (position: number, value: number) => string;
  dataWord: (data: string) => string;
  encodedWord: (word: string) => string;
  normalLimit: string;
  advanced: string;
  advancedWarning: string;
  protectedLegend: string;
  protectedBit: (position: number, role: string, value: number, flipped: boolean) => string;
  flipped: string;
  notFlipped: string;
  parityP1: string;
  parityP2: string;
  parityP4: string;
  overallP0: string;
  dataD1: string;
  dataD2: string;
  dataD3: string;
  dataD4: string;
  sentWord: (word: string) => string;
  receivedWord: (word: string) => string;
  checksTable: string;
  check: string;
  positions: string;
  calculation: string;
  result: string;
  checkName: (weight: number) => string;
  positionsValue: (positions: readonly number[]) => string;
  passes: string;
  fails: string;
  overallParity: (value: number) => string;
  syndrome: (value: number, failed: readonly number[]) => string;
  decoderDecision: (decision: string) => string;
  noAlarm: string;
  correctedPosition: (position: number) => string;
  rejected: string;
  recoveredData: (data: string) => string;
  noRecoveredData: string;
  groundTruthExact: string;
  groundTruthWrong: string;
  groundTruthRejected: string;
  decisionTable: string;
  syndromeColumn: string;
  overallColumn: string;
  decoderAction: string;
  current: string;
  zero: string;
  nonzero: string;
  correctSyndrome: string;
  correctOverall: string;
  rejectDouble: string;
  noAlarmStatus: string;
  correctedStatus: (position: number) => string;
  rejectedStatus: string;
  misleadingStatus: (decision: string) => string;
  guarantee: string;
  counterexamples: string;
  modelLimit: string;
}

export const secdedInspectorCopy = {
  vi: {
    prediction: 'Bạn dự đoán mẫu kiểm tra chẵn lẻ nào sẽ chỉ ra bit bị lật? Dự đoán là tùy chọn và không được chấm điểm.',
    dataLegend: 'Bốn bit dữ liệu',
    dataBit: (position, value) => `Bit dữ liệu ${position}, giá trị ${value}`,
    dataWord: (data) => `Khối dữ liệu: ${data}`,
    encodedWord: (word) => `Từ mã hóa: ${word}`,
    normalLimit: 'Chế độ thường cho chọn tối đa hai vị trí lật. Chọn lại một vị trí để bỏ lật.',
    advanced: 'Nâng cao: cho phép ba lỗi lật trở lên',
    advancedWarning: 'Ngoài bảo đảm: với ba lỗi lật trở lên, bộ giải mã có thể sửa nhầm hoặc bỏ sót lỗi.',
    protectedLegend: 'Tám bit được bảo vệ; vị trí trên giao diện bắt đầu từ 1, còn chỉ số API của trình mô phỏng bắt đầu từ 0',
    protectedBit: (position, role, value, flipped) => `Vị trí ${position}, ${role}, giá trị ${value}, ${flipped ? 'đã lật' : 'chưa lật'}`,
    flipped: 'Đã lật', notFlipped: 'Chưa lật',
    parityP1: 'parity p1', parityP2: 'parity p2', parityP4: 'parity p4', overallP0: 'parity tổng p0',
    dataD1: 'dữ liệu d1', dataD2: 'dữ liệu d2', dataD3: 'dữ liệu d3', dataD4: 'dữ liệu d4',
    sentWord: (word) => `Từ gửi: ${word}`,
    receivedWord: (word) => `Từ nhận: ${word}`,
    checksTable: 'Các phép kiểm tra chẵn lẻ trên vị trí nhận 1 đến 7',
    check: 'Phép kiểm tra', positions: 'Nhóm vị trí', calculation: 'Phép tính XOR', result: 'Kết quả',
    checkName: (weight) => `Kiểm tra ${weight}`,
    positionsValue: (positions) => `vị trí ${positions.join(', ')}`,
    passes: 'Đạt', fails: 'Không đạt',
    overallParity: (value) => `Parity tổng trên vị trí 1–8: ${value}.`,
    syndrome: (value, failed) => failed.length === 0 ? `Syndrome: ${value}.` : `Syndrome: ${value} = ${failed.join(' + ')}.`,
    decoderDecision: (decision) => `Quyết định của bộ giải mã: ${decision}`,
    noAlarm: 'Không có tín hiệu lỗi',
    correctedPosition: (position) => `Đã sửa vị trí ${position}`,
    rejected: 'Từ chối',
    recoveredData: (data) => `Dữ liệu bộ giải mã trả về: ${data}.`,
    noRecoveredData: 'Bộ giải mã không trả về dữ liệu.',
    groundTruthExact: 'So sánh với dữ liệu gốc: dữ liệu được chấp nhận khớp chính xác.',
    groundTruthWrong: 'So sánh với dữ liệu gốc: dữ liệu được chấp nhận là sai.',
    groundTruthRejected: 'So sánh với dữ liệu gốc: không có dữ liệu khôi phục để so sánh.',
    decisionTable: 'Bảng quyết định SECDED', syndromeColumn: 'Syndrome', overallColumn: 'Parity tổng', decoderAction: 'Hành động bộ giải mã', current: 'Trạng thái hiện tại',
    zero: '0', nonzero: 'khác 0', correctSyndrome: 'Sửa vị trí do syndrome chỉ ra', correctOverall: 'Sửa parity tổng ở vị trí 8', rejectDouble: 'Từ chối vì phát hiện hai lỗi',
    noAlarmStatus: 'Không có tín hiệu lỗi.', correctedStatus: (position) => `Đã sửa vị trí ${position}.`, rejectedStatus: 'Đã phát hiện hai lỗi; khối này không được chấp nhận.',
    misleadingStatus: (decision) => `${decision}; so sánh của trình mô phỏng cho thấy dữ liệu được chấp nhận là sai.`,
    guarantee: 'Bảo đảm trong mô hình này: với tối đa hai bit bị lật trong một từ tám bit, SECDED sửa đúng một lỗi và phát hiện hai lỗi.',
    counterexamples: 'Ngoài bảo đảm, ba lỗi ở vị trí 1, 2, 3 dẫn đến sửa nhầm vị trí 8; thêm lỗi ở vị trí 8 có thể tạo trạng thái “không có tín hiệu lỗi” dù dữ liệu sai.',
    modelLimit: 'Bộ mã ngắn này không bảo vệ header, lỗi chèn hoặc xóa bit, hay toàn bộ packet. Bộ giải mã chỉ đọc từ nhận; so sánh dữ liệu gốc là bằng chứng riêng của trình mô phỏng.',
  },
  en: {
    prediction: 'Which parity check pattern will locate a flipped bit? The prediction is optional and is not scored.',
    dataLegend: 'Four data bits',
    dataBit: (position, value) => `Data bit ${position}, value ${value}`,
    dataWord: (data) => `Data word: ${data}`,
    encodedWord: (word) => `Encoded word: ${word}`,
    normalLimit: 'Normal mode allows at most two flipped positions. Select a position again to clear it.',
    advanced: 'Advanced: allow three or more flips',
    advancedWarning: 'Outside the guarantee: with three or more flips, the decoder may miscorrect or miss errors.',
    protectedLegend: 'Eight protected bits; UI positions are one-based; simulator API indices are zero-based',
    protectedBit: (position, role, value, flipped) => `Position ${position}, ${role}, value ${value}, ${flipped ? 'flipped' : 'not flipped'}`,
    flipped: 'Flipped', notFlipped: 'Not flipped',
    parityP1: 'parity p1', parityP2: 'parity p2', parityP4: 'parity p4', overallP0: 'overall parity p0',
    dataD1: 'data d1', dataD2: 'data d2', dataD3: 'data d3', dataD4: 'data d4',
    sentWord: (word) => `Sent word: ${word}`,
    receivedWord: (word) => `Received word: ${word}`,
    checksTable: 'Parity checks on received positions 1 through 7',
    check: 'Check', positions: 'Position group', calculation: 'XOR calculation', result: 'Result',
    checkName: (weight) => `Check ${weight}`,
    positionsValue: (positions) => `positions ${positions.join(', ')}`,
    passes: 'Passes', fails: 'Fails',
    overallParity: (value) => `Overall parity across positions 1–8: ${value}.`,
    syndrome: (value, failed) => failed.length === 0 ? `Syndrome: ${value}.` : `Syndrome: ${value} = ${failed.join(' + ')}.`,
    decoderDecision: (decision) => `Decoder decision: ${decision}`,
    noAlarm: 'No error signaled',
    correctedPosition: (position) => `Corrected position ${position}`,
    rejected: 'Rejected',
    recoveredData: (data) => `Decoder output data: ${data}.`,
    noRecoveredData: 'The decoder returned no data.',
    groundTruthExact: 'Ground-truth comparison: accepted data matches exactly.',
    groundTruthWrong: 'Ground-truth comparison: accepted data is wrong.',
    groundTruthRejected: 'Ground-truth comparison: no recovered data to compare.',
    decisionTable: 'SECDED decision table', syndromeColumn: 'Syndrome', overallColumn: 'Overall parity', decoderAction: 'Decoder action', current: 'Current decoder state',
    zero: '0', nonzero: 'Nonzero', correctSyndrome: 'Correct the position indicated by the syndrome', correctOverall: 'Correct overall parity at position 8', rejectDouble: 'Reject as two detected errors',
    noAlarmStatus: 'No error signaled.', correctedStatus: (position) => `Corrected position ${position}.`, rejectedStatus: 'Two errors detected; this block is not accepted.',
    misleadingStatus: (decision) => `${decision}; the simulator comparison says the accepted data is wrong.`,
    guarantee: 'Guarantee in this model: with at most two flipped bits in one eight-bit word, SECDED corrects one error and detects two errors.',
    counterexamples: 'Outside the guarantee, flips at positions 1, 2, and 3 cause a misleading repair at position 8; also flipping position 8 can produce “No error signaled” while the data is wrong.',
    modelLimit: 'This short code does not protect headers, insertion or deletion errors, or every packet. The decoder sees only the received word; comparison with the original data is separate simulator evidence.',
  },
} satisfies Record<Lang, SecdedInspectorCopy>;
