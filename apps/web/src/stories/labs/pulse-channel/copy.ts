import type { Lang } from '../../../i18n';
import type { PulseDuration, PulseSampleFraction, PulseTau } from './model';

interface PulseChannelCopy {
  prediction: string;
  source: string;
  alternating: string;
  message: string;
  duration: string;
  durationOption: (duration: PulseDuration) => string;
  tau: string;
  tauOption: (tau: PulseTau) => string;
  sampleFraction: string;
  sampleOption: (fraction: PulseSampleFraction) => string;
  run: string;
  awaiting: string;
  staleSettings: string;
  staleMessage: string;
  stalePlot: string;
  result: (errors: number, samples: number) => string;
  waveform: string;
  inputTrace: string;
  outputTrace: string;
  samples: string;
  symbol: string;
  time: string;
  sent: string;
  value: string;
  received: string;
  decision: (bit: 0 | 1) => string;
  feedback: string;
  modelLimit: string;
  patternLimit: string;
  noNoise: string;
}

export const pulseChannelCopy = {
  vi: {
    prediction: 'Trước khi chạy, bạn dự đoán người nhận sẽ nhầm bit nào khi xung ngắn hơn? Bạn có thể tiếp tục mà không cần trả lời.',
    source: 'Nguồn xung',
    alternating: 'Mẫu bit xen kẽ',
    message: 'Các byte của câu gốc',
    duration: 'Thời lượng ký hiệu T',
    durationOption: (duration) => `${duration} đơn vị mô phỏng`,
    tau: 'Bộ nhớ kênh tau',
    tauOption: (tau) => tau === 0 ? '0 (không có bộ nhớ)' : `${tau} đơn vị mô phỏng`,
    sampleFraction: 'Thời điểm lấy mẫu',
    sampleOption: (fraction) => `${fraction * 100}% thời lượng ký hiệu`,
    run: 'Chạy thử',
    awaiting: 'Chọn nguồn và thông số, rồi chạy để tạo dạng sóng và các điểm lấy mẫu.',
    staleSettings: 'Kết quả của thông số trước; dạng sóng cũ được giữ lại cho đến khi chạy lại.',
    staleMessage: 'Kết quả của câu trước; dạng sóng cũ được giữ lại cho đến khi chạy lại.',
    stalePlot: 'Dạng sóng và bảng dưới đây là ảnh chụp của lần chạy trước.',
    result: (errors, samples) => `${errors}/${samples} bit người nhận đọc sai trong cửa sổ.`,
    waveform: 'Dạng sóng đầu vào và đầu ra của kênh',
    inputTrace: 'Đầu vào NRZ (nét liền)',
    outputTrace: 'Đầu ra có bộ nhớ (nét đứt)',
    samples: 'Các điểm lấy mẫu của bộ nhận',
    symbol: 'Ký hiệu',
    time: 'Thời gian (đơn vị mô phỏng)',
    sent: 'Đã gửi',
    value: 'Biên độ lấy mẫu',
    received: 'Đã nhận',
    decision: (bit) => `Bit ${bit}`,
    feedback: 'Kênh còn giữ dấu vết của xung trước.',
    modelLimit: 'Đây là bộ lọc một cực dùng để quan sát bộ nhớ và giao thoa giữa ký hiệu, không phải mô hình định lượng của một tuyến cáp lịch sử.',
    patternLimit: 'Kết quả phụ thuộc vào mẫu bit; gửi nhanh hơn không làm mọi chuỗi đều sai.',
    noNoise: 'Lab này không thêm nhiễu ngẫu nhiên. Tất cả giá trị là dữ liệu mô phỏng, không phải số đo lịch sử.',
  },
  en: {
    prediction: 'Before running, where do you expect the receiver to mistake a bit as the pulses get shorter? You can continue without answering.',
    source: 'Pulse source',
    alternating: 'Alternating bit pattern',
    message: 'Original message bytes',
    duration: 'Symbol duration T',
    durationOption: (duration) => `${duration} simulation ${duration === 1 ? 'unit' : 'units'}`,
    tau: 'Channel memory tau',
    tauOption: (tau) => tau === 0 ? '0 (no memory)' : `${tau} simulation ${tau === 1 ? 'unit' : 'units'}`,
    sampleFraction: 'Sample point',
    sampleOption: (fraction) => `${fraction * 100}% into the symbol`,
    run: 'Run experiment',
    awaiting: 'Choose a source and settings, then run to create the waveform and sample points.',
    staleSettings: 'Result for the previous settings; the old waveform remains until you run again.',
    staleMessage: 'Result for the previous message; the old waveform remains until you run again.',
    stalePlot: 'The waveform and table below are a snapshot of the previous run.',
    result: (errors, samples) => `${errors}/${samples} receiver errors in this window.`,
    waveform: 'Input and channel-output waveform',
    inputTrace: 'NRZ input (solid line)',
    outputTrace: 'Channel output with memory (dashed line)',
    samples: 'Receiver sample points',
    symbol: 'Symbol',
    time: 'Time (simulation units)',
    sent: 'Sent',
    value: 'Sample amplitude',
    received: 'Received',
    decision: (bit) => `Bit ${bit}`,
    feedback: 'The channel still carries a trace of the previous pulse.',
    modelLimit: 'This is a one-pole filter for seeing memory and intersymbol interference, not a quantitative model of a historical cable route.',
    patternLimit: 'The result depends on the bit pattern; sending faster does not make every sequence fail.',
    noNoise: 'This lab adds no stochastic noise. All values are simulated data, not historical measurements.',
  },
} satisfies Record<Lang, PulseChannelCopy>;
