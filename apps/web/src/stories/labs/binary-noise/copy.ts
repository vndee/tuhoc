import type { Lang } from '../../../i18n';

interface BinaryNoiseCopy {
  prediction: string;
  mode: string;
  bsc: string;
  manual: string;
  manualLimit: string;
  probability: string;
  seed: string;
  newSeed: string;
  run: string;
  awaiting: string;
  staleSettings: string;
  staleMessage: string;
  staleSettingsBanner: string;
  staleMessageBanner: string;
  result: (errors: number, bits: number) => string;
  sourceHex: string;
  receivedHex: string;
  decoded: string;
  invalidUtf8: string;
  exact: string;
  changed: string;
  observedBer: (ber: number) => string;
  feedback: string;
  probabilityLimit: string;
  modelLimit: string;
}

export const binaryNoiseCopy = {
  vi: {
    prediction: 'Trước khi truyền, bạn dự đoán những vị trí bit nào sẽ đổi? Bạn có thể tiếp tục mà không cần trả lời.',
    mode: 'Chế độ nhiễu',
    bsc: 'Kênh đối xứng nhị phân (BSC)',
    manual: 'Tự lật bit',
    manualLimit: 'Chế độ tự lật chỉ áp dụng đúng tập bit bạn chọn; nó không đưa ra giả định các bit được lật ngẫu nhiên độc lập.',
    probability: 'Xác suất lật bit cấu hình p',
    seed: 'Seed nhiễu',
    newSeed: 'Đổi mẫu nhiễu',
    run: 'Chạy thử',
    awaiting: 'Chọn chế độ và thông số, rồi chạy để truyền toàn bộ câu.',
    staleSettings: 'Kết quả của thông số trước; kết quả cũ được giữ nguyên cho đến khi chạy lại.',
    staleMessage: 'Kết quả của câu trước; kết quả cũ được giữ nguyên cho đến khi chạy lại.',
    staleSettingsBanner: 'Các byte và phép giải mã dưới đây thuộc lần chạy với thông số trước.',
    staleMessageBanner: 'Các byte và phép giải mã dưới đây thuộc lần chạy với câu trước.',
    result: (errors, bits) => `Lần này đổi ${errors}/${bits} bit.`,
    sourceHex: 'Byte nguồn ở hệ thập lục phân',
    receivedHex: 'Byte nhận ở hệ thập lục phân',
    decoded: 'Văn bản giải mã UTF-8 nghiêm ngặt',
    invalidUtf8: 'Không thể giải mã thành văn bản UTF-8 hợp lệ',
    exact: 'Byte nhận khớp chính xác với byte nguồn.',
    changed: 'Byte nhận khác byte nguồn.',
    observedBer: (ber) => `Tỷ lệ lỗi bit quan sát (BER): ${(ber * 100).toFixed(2)}%.`,
    feedback: 'Dữ liệu nhận đúng chỉ khi mọi byte khớp, không phải khi số ký tự trông có vẻ giống nhau.',
    probabilityLimit: 'p là xác suất cấu hình của mô hình BSC, không phải tỷ lệ lỗi bắt buộc của mỗi lần chạy.',
    modelLimit: 'Chế độ BSC giả định các lần lật bit độc lập. Chế độ tự lật không mang giả định đó.',
  },
  en: {
    prediction: 'Before transmitting, which bit positions do you expect to change? You can continue without answering.',
    mode: 'Noise mode',
    bsc: 'Binary symmetric channel (BSC)',
    manual: 'Manual bit flips',
    manualLimit: 'Manual mode applies exactly the bit set you choose; it does not make an independent random-flip claim.',
    probability: 'Configured flip probability p',
    seed: 'Noise seed',
    newSeed: 'New noise sample',
    run: 'Run experiment',
    awaiting: 'Choose a mode and settings, then run to transmit the full message.',
    staleSettings: 'Result for the previous settings; the old result remains unchanged until you run again.',
    staleMessage: 'Result for the previous message; the old result remains unchanged until you run again.',
    staleSettingsBanner: 'The bytes and decoding below belong to the run with the previous settings.',
    staleMessageBanner: 'The bytes and decoding below belong to the run with the previous message.',
    result: (errors, bits) => `This run changed ${errors}/${bits} bits.`,
    sourceHex: 'Source bytes in hexadecimal',
    receivedHex: 'Received bytes in hexadecimal',
    decoded: 'Strict UTF-8 decoded text',
    invalidUtf8: 'Cannot decode as valid UTF-8 text',
    exact: 'Received bytes exactly match the source bytes.',
    changed: 'Received bytes differ from the source bytes.',
    observedBer: (ber) => `Observed bit error rate (BER): ${(ber * 100).toFixed(2)}%.`,
    feedback: 'Data is received exactly only when every byte matches, not merely when a character count looks similar.',
    probabilityLimit: 'p is the configured probability in the BSC model, not a required error rate for each run.',
    modelLimit: 'BSC mode assumes independent bit flips. Manual mode makes no such assumption.',
  },
} satisfies Record<Lang, BinaryNoiseCopy>;
