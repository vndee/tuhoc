import type { Lang } from '../../../i18n';

interface MorseSpacingCopy {
  example: string;
  letterGap: string;
  wordGap: string;
  units: string;
  standardPreset: string;
  joinedPreset: string;
  readSignal: string;
  awaitingRead: string;
  timeline: string;
  segments: string;
  segment: string;
  kind: string;
  mark: string;
  gap: string;
  duration: string;
  decoded: string;
  result: (reading: string) => string;
  unknownCode: string;
  modernModel: string;
  standardTiming: string;
  thresholdTitle: string;
  joinedThreshold: string;
  letterThreshold: string;
  wordThreshold: string;
}

export const morseSpacingCopy = {
  vi: {
    example: 'Ví dụ',
    letterGap: 'Khoảng nghỉ giữa các chữ',
    wordGap: 'Khoảng nghỉ giữa các từ',
    units: 'đơn vị',
    standardPreset: 'Dùng khoảng nghỉ chuẩn',
    joinedPreset: 'Nối ranh giới chữ',
    readSignal: 'Đọc tín hiệu',
    awaitingRead: 'Chọn Đọc tín hiệu để ghi lại dải dấu và khoảng nghỉ.',
    timeline: 'Dải thời gian tín hiệu',
    segments: 'Các đoạn trong tín hiệu gần nhất',
    segment: 'Đoạn',
    kind: 'Loại',
    mark: 'Dấu',
    gap: 'Khoảng nghỉ',
    duration: 'Thời lượng',
    decoded: 'Kết quả đọc',
    result: (reading) => `Dấu không đổi, cách chia chữ đã đổi. Bộ giải mã đọc “${reading}”.`,
    unknownCode: 'Nhóm dấu này không khớp với một chữ Morse quốc tế; bộ giải mã trả về unknown-code.',
    modernModel: 'Mô hình giảng dạy hiện đại: bài thử dùng mã Morse quốc tế hiện đại, không mô phỏng bản ghi năm 1844.',
    standardTiming: 'Thời lượng dấu theo ITU: chấm 1 đơn vị, gạch 3, khoảng trong chữ 1, giữa chữ 3 và giữa từ 7.',
    thresholdTitle: 'Ngưỡng của bộ giải mã',
    joinedThreshold: 'gap < 2: giữ các dấu trong cùng một chữ',
    letterThreshold: '2 ≤ gap < 5: bắt đầu một chữ mới',
    wordThreshold: 'gap ≥ 5: bắt đầu một từ mới',
  },
  en: {
    example: 'Example',
    letterGap: 'Gap between letters',
    wordGap: 'Gap between words',
    units: 'units',
    standardPreset: 'Use standard spacing',
    joinedPreset: 'Join the letter boundary',
    readSignal: 'Read signal',
    awaitingRead: 'Choose Read signal to record the marks and pauses.',
    timeline: 'Signal timeline',
    segments: 'Segments in the last signal',
    segment: 'Segment',
    kind: 'Kind',
    mark: 'Mark',
    gap: 'Gap',
    duration: 'Duration',
    decoded: 'Decoded result',
    result: (reading) => `The marks stayed the same; the letter boundaries changed. The decoder read “${reading}”.`,
    unknownCode: 'This mark group does not match an International Morse letter; the decoder returned unknown-code.',
    modernModel: 'Modern teaching model: this experiment uses modern International Morse, not a reconstruction of the 1844 record.',
    standardTiming: 'ITU mark timing: dot 1 unit, dash 3, within-letter gap 1, between-letter gap 3 and between-word gap 7.',
    thresholdTitle: 'Decoder thresholds',
    joinedThreshold: 'gap < 2: keep marks in the same letter',
    letterThreshold: '2 ≤ gap < 5: begin a new letter',
    wordThreshold: 'gap ≥ 5: begin a new word',
  },
} satisfies Record<Lang, MorseSpacingCopy>;
