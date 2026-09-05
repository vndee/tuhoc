import type { Lang } from '../../../i18n';

export const messageExamples = {
  vi: 'Mình đã đến nơi. Mọi chuyện vẫn ổn.',
  en: 'I have arrived. Everything is all right.',
} as const;

export const communicationCopy: Record<Lang, {
  predict: string;
  try: string;
  explain: string;
  bits: string;
  previousBits: string;
  nextBits: string;
  noBits: string;
  bitRange: (start: number, end: number, total: number) => string;
  bitLabel: (index: number, value: 0 | 1, flipped: boolean) => string;
  messageLabel: string;
  messageInUse: string;
  draftPreview: string;
  commitMessage: string;
  useExample: string;
  privacy: string;
  graphemeCount: (count: number) => string;
  byteCount: (count: number) => string;
  errors: Record<'empty' | 'ill-formed' | 'grapheme-limit' | 'byte-limit', string>;
  resetSession: string;
  resetTitle: string;
  resetDescription: string;
  confirmReset: string;
  cancel: string;
}> = {
  vi: {
    predict: 'Dự đoán',
    try: 'Thử',
    explain: 'Giải thích và giới hạn',
    bits: 'Bit',
    previousBits: 'Bit trước',
    nextBits: 'Bit tiếp theo',
    noBits: 'Không có bit',
    bitRange: (start, end, total) => `Bit ${start.toLocaleString('vi-VN')}–${end.toLocaleString('vi-VN')} trên ${total.toLocaleString('vi-VN')}`,
    bitLabel: (index, value, flipped) => `Bit ${index}: ${value}${flipped ? ', đã lật' : ''}`,
    messageLabel: 'Câu của bạn',
    messageInUse: 'Câu đang dùng',
    draftPreview: 'Bản nháp',
    commitMessage: 'Dùng câu này',
    useExample: 'Dùng câu mẫu',
    privacy: 'Câu này chỉ được xử lý trong trình duyệt. Tải lại trang hoặc rời đặc san sẽ đặt lại lượt thử.',
    graphemeCount: (count) => `${count.toLocaleString('vi-VN')} / 120 cụm ký tự`,
    byteCount: (count) => `${count.toLocaleString('vi-VN')} / 1.024 byte UTF-8`,
    errors: {
      empty: 'Nhập một câu hoặc dùng câu mẫu.',
      'ill-formed': 'Câu này chứa Unicode không hợp lệ.',
      'grapheme-limit': 'Câu vượt quá 120 cụm ký tự.',
      'byte-limit': 'Câu vượt quá 1.024 byte UTF-8.',
    },
    resetSession: 'Bắt đầu lại lượt đọc',
    resetTitle: 'Bắt đầu lại lượt đọc?',
    resetDescription: 'Thao tác này xoá câu và tất cả kết quả trong lượt thử hiện tại.',
    confirmReset: 'Bắt đầu lại',
    cancel: 'Huỷ',
  },
  en: {
    predict: 'Predict',
    try: 'Try',
    explain: 'Explain and limits',
    bits: 'Bits',
    previousBits: 'Previous bits',
    nextBits: 'Next bits',
    noBits: 'No bits',
    bitRange: (start, end, total) => `Bits ${start.toLocaleString('en-US')}–${end.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`,
    bitLabel: (index, value, flipped) => `Bit ${index}: ${value}${flipped ? ', flipped' : ''}`,
    messageLabel: 'Your message',
    messageInUse: 'Message in use',
    draftPreview: 'Draft preview',
    commitMessage: 'Use this message',
    useExample: 'Use example message',
    privacy: 'This message is processed only in your browser. Reloading or leaving the edition resets this experiment.',
    graphemeCount: (count) => `${count.toLocaleString('en-US')} / 120 grapheme clusters`,
    byteCount: (count) => `${count.toLocaleString('en-US')} / 1,024 UTF-8 bytes`,
    errors: {
      empty: 'Enter a message or use the example.',
      'ill-formed': 'This message contains invalid Unicode.',
      'grapheme-limit': 'The message exceeds 120 grapheme clusters.',
      'byte-limit': 'The message exceeds 1,024 UTF-8 bytes.',
    },
    resetSession: 'Start a new experiment',
    resetTitle: 'Start a new experiment?',
    resetDescription: 'This clears the message and every result in the current experiment.',
    confirmReset: 'Start again',
    cancel: 'Cancel',
  },
};
