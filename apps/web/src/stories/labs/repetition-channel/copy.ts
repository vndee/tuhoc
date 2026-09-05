import type { Lang } from '../../../i18n';

interface RepetitionChannelCopy {
  prediction: string;
  mode: string;
  bsc: string;
  burst: string;
  probability: string;
  seed: string;
  newSeed: string;
  burstStart: string;
  burstLength: string;
  sharedInterval: (bits: number) => string;
  invalidInterval: string;
  run: string;
  awaiting: string;
  staleMessage: string;
  staleSettings: string;
  staleMessageBanner: string;
  staleSettingsBanner: string;
  observedTable: string;
  path: string;
  oneCopy: string;
  threeCopies: string;
  uses: string;
  flips: string;
  errors: string;
  correctPerUse: string;
  rate: string;
  theory: string;
  theoryValue: (p: number, probability: number) => string;
  originalHex: string;
  consecutive: string;
  relationships: string;
  position: string;
  original: string;
  rawReceived: string;
  repeatReceived: string;
  vote: string;
  outcome: string;
  unchanged: string;
  corrected: string;
  failure: string;
  sourceBit: (index: number) => string;
  bitValue: (label: string, value: number) => string;
  tripleValue: (value: string) => string;
  voteValue: (value: number) => string;
  range: (start: number, end: number, total: number) => string;
  previous: string;
  next: string;
  exactStatus: string;
  improvedStatus: (rawErrors: number, repeatErrors: number) => string;
  otherStatus: (rawErrors: number, repeatErrors: number) => string;
  feedback: string;
  modelLimit: string;
}

export const repetitionChannelCopy = {
  vi: {
    prediction: 'Bạn dự đoán đường gửi nào sẽ đưa được nhiều bit dữ liệu đúng hơn trên mỗi lần dùng kênh? Dự đoán là tùy chọn và không được chấm điểm.',
    mode: 'Mô hình nhiễu', bsc: 'Lật bit độc lập (BSC)', burst: 'Một đoạn lật chung',
    probability: 'Xác suất lật bit p', seed: 'Seed nhiễu', newSeed: 'Đổi mẫu nhiễu',
    burstStart: 'Chỉ số bắt đầu đoạn lật', burstLength: 'Độ dài đoạn lật',
    sharedInterval: (bits) => `Cùng đoạn được yêu cầu áp vào cả hai luồng và bị chặn bởi luồng gửi một lần dài ${bits} bit; hệ thống không tự cắt đoạn.`,
    invalidInterval: 'Đoạn lật phải nằm trọn trong luồng gửi một lần.', run: 'Chạy thử',
    awaiting: 'Chạy thử để so sánh hai đường gửi trên cùng các byte nguồn.',
    staleMessage: 'Kết quả của câu trước', staleSettings: 'Kết quả của thông số trước',
    staleMessageBanner: 'Bảng và các nhóm ba bit này thuộc về câu trước.',
    staleSettingsBanner: 'Bảng và các nhóm ba bit này thuộc về thông số trước.',
    observedTable: 'So sánh kênh quan sát được', path: 'Đường gửi', oneCopy: 'Một bản', threeCopies: 'Ba bản',
    uses: 'Lần dùng kênh', flips: 'Bit bị lật trong kênh', errors: 'Lỗi dữ liệu',
    correctPerUse: 'Bit dữ liệu đúng/lần dùng', rate: 'Tốc độ mã',
    theory: 'Lý thuyết kênh độc lập',
    theoryValue: (p, probability) => `Với p=${p.toFixed(2)}, 3p²−2p³ = ${probability.toFixed(3)} lỗi sau biểu quyết cho mỗi bit dữ liệu.`,
    originalHex: 'Byte gốc ở hệ thập lục phân',
    consecutive: 'Ba bit đi liên tiếp qua cùng mô hình kênh.',
    relationships: 'Các bit nguồn đang hiện và quan hệ ba bản của chúng',
    position: 'Vị trí', original: 'Gốc', rawReceived: 'Nhận một bản', repeatReceived: 'Nhận ba bản', vote: 'Biểu quyết', outcome: 'Kết quả',
    unchanged: 'Không đổi', corrected: 'Đã sửa', failure: 'Biểu quyết sai',
    sourceBit: (index) => `Bit nguồn ${index}`, bitValue: (label, value) => `${label} ${value}`,
    tripleValue: (value) => `nhận ba bản ${value}`, voteValue: (value) => `biểu quyết ${value}`,
    range: (start, end, total) => `Bit nguồn ${start}–${end} trên ${total}`,
    previous: 'Bit nguồn trước', next: 'Bit nguồn tiếp theo',
    exactStatus: 'Cả hai đường đều khôi phục mọi bit dữ liệu trong lượt này.',
    improvedStatus: (raw, repeat) => `Đường ba bản giảm lỗi dữ liệu từ ${raw} xuống ${repeat} trong lượt này.`,
    otherStatus: (raw, repeat) => `Lượt này đường một bản có ${raw} lỗi dữ liệu và đường ba bản có ${repeat}.`,
    feedback: 'Bạn đã dùng thêm kênh để tạo cơ hội sửa lỗi, không phải để thêm ý nghĩa.',
    modelLimit: 'Ba bản đi liên tiếp trong cùng mô hình kênh, không phải qua ba mạng độc lập. Biểu quyết giả định ranh giới nhóm được giữ đúng; cùng số bit lật nhưng phân bố khác có thể đổi kết quả, và cùng seed không có nghĩa hai luồng dài khác nhau nhận cùng số lần lật.',
  },
  en: {
    prediction: 'Which path will deliver more correct payload bits per channel use? The prediction is optional and is not scored.',
    mode: 'Noise model', bsc: 'Independent bit flips (BSC)', burst: 'One shared burst interval',
    probability: 'Configured flip probability p', seed: 'Noise seed', newSeed: 'New noise sample',
    burstStart: 'Burst start index', burstLength: 'Burst length',
    sharedInterval: (bits) => `The same requested interval is applied to both streams and is bounded by the ${bits}-bit one-copy stream; it is never silently clamped.`,
    invalidInterval: 'The burst interval must fit entirely inside the one-copy stream.', run: 'Run experiment',
    awaiting: 'Run the experiment to compare both paths on the same source bytes.',
    staleMessage: 'Result for the previous message', staleSettings: 'Result for the previous settings',
    staleMessageBanner: 'This table and these three-bit groups belong to the previous message.',
    staleSettingsBanner: 'This table and these three-bit groups belong to the previous settings.',
    observedTable: 'Observed channel comparison', path: 'Path', oneCopy: 'One copy', threeCopies: 'Three copies',
    uses: 'Channel uses', flips: 'Channel flips', errors: 'Payload errors',
    correctPerUse: 'Correct payload bits/use', rate: 'Code rate',
    theory: 'Independent-channel theory',
    theoryValue: (p, probability) => `At p=${p.toFixed(2)}, 3p²−2p³ = ${probability.toFixed(3)} decoded errors per payload bit.`,
    originalHex: 'Original bytes in hexadecimal',
    consecutive: 'Three bits travel consecutively through the same channel model.',
    relationships: 'Visible source bits and their three-copy relationships',
    position: 'Position', original: 'Original', rawReceived: 'Raw received', repeatReceived: 'Repeat received', vote: 'Vote', outcome: 'Outcome',
    unchanged: 'Unchanged', corrected: 'Corrected', failure: 'Majority failure',
    sourceBit: (index) => `Source bit ${index}`, bitValue: (label, value) => `${label} ${value}`,
    tripleValue: (value) => `repeat received ${value}`, voteValue: (value) => `vote ${value}`,
    range: (start, end, total) => `Source bits ${start}–${end} of ${total}`,
    previous: 'Previous source bits', next: 'Next source bits',
    exactStatus: 'Both paths recovered every payload bit in this run.',
    improvedStatus: (raw, repeat) => `Three copies reduced payload errors from ${raw} to ${repeat} in this run.`,
    otherStatus: (raw, repeat) => `This run produced ${raw} payload errors with one copy and ${repeat} with three copies.`,
    feedback: 'You used more channel resources to help correct errors, not to add meaning.',
    modelLimit: 'The copies travel consecutively through one channel model, not three independent networks. Majority voting assumes group boundaries stay intact; the same number of flips arranged differently can change the result, and an identical seed does not imply equal flip counts in streams of different lengths.',
  },
} satisfies Record<Lang, RepetitionChannelCopy>;
