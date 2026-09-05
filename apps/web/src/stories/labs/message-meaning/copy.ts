import type { Lang } from '../../../i18n';
import type { TransmissionConfig } from '../communication/types';

export interface MessageMeaningCopy {
  prediction: string;
  contextLegend: string;
  interpretationLegend: string;
  changed: string;
  unchanged: string;
  unsure: string;
  noInterpretation: string;
  interpretationNote: string;
  tryAnotherMessage: string;
  currentEvidence: string;
  earlierEvidence: string;
  notRun: string;
  stale: string;
  exact: string;
  silentCorruption: string;
  rejected: string;
  scene11Link: string;
  capturedSettings: (config: TransmissionConfig) => string;
  originalBytes: string;
  receivedBytes: string;
  originalText: string;
  receivedText: string;
  invalidOriginal: string;
  invalidReceived: string;
  rejectedSentence: string;
  illustrativeExample: string;
  illustrativeText: string;
  illustrativeBytes: (bytes: string) => string;
  separation: string;
  modelLimit: string;
}

export const messageMeaningCopy = {
  vi: {
    prediction: 'Cùng một câu được truyền đến có thể được hiểu khác đi khi bối cảnh thay đổi không? Dự đoán là tùy chọn và không được chấm điểm.',
    contextLegend: 'Bối cảnh hư cấu', interpretationLegend: 'Cách bạn đọc câu nói (tùy chọn)',
    changed: 'Đã thay đổi', unchanged: 'Không thay đổi', unsure: 'Chưa chắc',
    noInterpretation: 'Bạn chưa chọn cách hiểu.',
    interpretationNote: 'Lựa chọn này ghi lại cách đọc của bạn; nó không thay đổi hay chấm điểm bằng chứng giao nhận.',
    tryAnotherMessage: 'Thử một câu khác', currentEvidence: 'Bằng chứng truyền hiện tại',
    earlierEvidence: 'Bằng chứng của lần truyền trước', notRun: 'Không có bằng chứng giao nhận hiện tại',
    stale: 'Biên nhận thuộc một phiên bản câu trước', exact: 'Giao nhận chính xác',
    silentCorruption: 'Hỏng âm thầm', rejected: 'Giao nhận bị từ chối',
    scene11Link: 'Thử truyền ở cảnh 11',
    capturedSettings: (config) => `Thông số đã chụp: ${config.code}, ngân sách ${config.budget}, p=${config.p.toFixed(2)}, seed ${config.seed}.`,
    originalBytes: 'Byte gốc', receivedBytes: 'Byte nhận',
    originalText: 'Văn bản gốc:', receivedText: 'Văn bản nhận:',
    invalidOriginal: 'Byte gốc không phải UTF-8 hợp lệ.', invalidReceived: 'Byte nhận không phải UTF-8 hợp lệ.',
    rejectedSentence: 'Không câu nhận nào được chấp nhận.', illustrativeExample: 'Chỉ là ví dụ minh họa',
    illustrativeText: 'Ví dụ này chỉ minh họa rằng bối cảnh có thể đổi cách đọc; nó không phải biên nhận của câu hiện tại.',
    illustrativeBytes: (bytes) => `Byte ví dụ: ${bytes}.`,
    separation: 'Biên nhận chỉ trả lời điều gì xảy ra với byte trong một lượt đã chụp. Bối cảnh và cách hiểu là dữ liệu do người đọc chọn, không phải kết quả kỹ thuật.',
    modelLimit: 'Lab này không suy đoán ý định, không gọi AI, không chấm câu trả lời và không biến một ví dụ minh họa thành bằng chứng giao nhận.',
  },
  en: {
    prediction: 'Could the same delivered words be read differently when the context changes? The prediction is optional and is not scored.',
    contextLegend: 'Fictional context', interpretationLegend: 'How you read the sentence (optional)',
    changed: 'Changed', unchanged: 'Unchanged', unsure: 'Unsure',
    noInterpretation: 'You have not selected an interpretation.',
    interpretationNote: 'This records your reading; it does not alter or grade the delivery evidence.',
    tryAnotherMessage: 'Try another message', currentEvidence: 'Current transmission evidence',
    earlierEvidence: 'Earlier transmission evidence', notRun: 'No current delivery evidence',
    stale: 'Receipt for an earlier message revision', exact: 'Exact delivery',
    silentCorruption: 'Silent corruption', rejected: 'Rejected delivery',
    scene11Link: 'Try a transmission in scene 11',
    capturedSettings: (config) => `Captured settings: ${config.code}, budget ${config.budget}, p=${config.p.toFixed(2)}, seed ${config.seed}.`,
    originalBytes: 'Original bytes', receivedBytes: 'Received bytes',
    originalText: 'Original text:', receivedText: 'Received text:',
    invalidOriginal: 'Original bytes are not valid UTF-8.', invalidReceived: 'Received bytes are not valid UTF-8.',
    rejectedSentence: 'No received sentence was accepted.', illustrativeExample: 'Illustrative example only',
    illustrativeText: 'This example only shows that context can change a reading; it is not a receipt for the current message.',
    illustrativeBytes: (bytes) => `Example bytes: ${bytes}.`,
    separation: 'A receipt answers only what happened to bytes in one captured run. Context and interpretation are reader choices, not technical outcomes.',
    modelLimit: 'This lab does not infer intent, call AI, grade an answer, or turn an illustrative example into delivery evidence.',
  },
} satisfies Record<Lang, MessageMeaningCopy>;
