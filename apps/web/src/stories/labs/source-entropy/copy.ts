import type { Lang } from '../../../i18n';
import type { SymbolId, Weights } from '../communication/types';

interface SourceEntropyCopy {
  prediction: string;
  predictionLegend: string;
  predictionRecorded: (symbol: SymbolId) => string;
  weights: string;
  weight: (symbol: SymbolId) => string;
  seed: string;
  nextIndex: (counter: number) => string;
  draw: string;
  emptySource: string;
  awaiting: string;
  entropy: (value: number) => string;
  probabilityBar: (symbol: SymbolId, value: number) => string;
  contributionBar: (symbol: SymbolId, value: number) => string;
  distributionTable: string;
  symbol: string;
  weightHeader: string;
  probabilityHeader: string;
  contributionHeader: string;
  lastDraw: (symbol: SymbolId, surprise: number) => string;
  staleDraw: string;
  drawConditions: (weights: Weights, seed: number, index: number) => string;
  predictionAtDraw: (symbol: SymbolId | null) => string;
  drawResult: (draw: number, symbol: SymbolId, surprise: number) => string;
  staleDrawResult: (draw: number, symbol: SymbolId, surprise: number) => string;
  feedback: string;
  unitLimit: string;
  modelLimit: string;
}

export const sourceEntropyCopy = {
  vi: {
    prediction: 'Dự đoán là tùy chọn và không được chấm điểm. Bạn có thể rút ký hiệu mà không cần chọn.',
    predictionLegend: 'Dự đoán ký hiệu tiếp theo (tùy chọn)',
    predictionRecorded: (symbol) => `Dự đoán tùy chọn của bạn: ${symbol}.`,
    weights: 'Trọng số của nguồn',
    weight: (symbol) => `Trọng số cho ${symbol}`,
    seed: 'Seed lượt rút',
    nextIndex: (counter) => `Chỉ số lượt rút tiếp theo: ${counter}`,
    draw: 'Rút ký hiệu',
    emptySource: 'Ít nhất một ký hiệu phải có trọng số lớn hơn không.',
    awaiting: 'Đặt ít nhất một trọng số lớn hơn không để xem phân phối.',
    entropy: (value) => `Entropy: ${value.toFixed(3)} bit/ký hiệu nguồn`,
    probabilityBar: (symbol, value) => `Xác suất ${symbol}: ${(value * 100).toFixed(2)}%`,
    contributionBar: (symbol, value) => `Phần đóng góp entropy của ${symbol}: ${value.toFixed(3)} bit/ký hiệu nguồn`,
    distributionTable: 'Xác suất nguồn và các phần đóng góp entropy',
    symbol: 'Ký hiệu',
    weightHeader: 'Trọng số',
    probabilityHeader: 'Xác suất',
    contributionHeader: 'Đóng góp (bit/ký hiệu nguồn)',
    lastDraw: (symbol, surprise) => `Lượt rút gần nhất: ${symbol} · độ bất ngờ ${surprise.toFixed(3)} bit`,
    staleDraw: 'Lượt rút này thuộc về thông số nguồn trước đó.',
    drawConditions: (weights, seed, index) => `Điều kiện lượt rút: A=${weights[0]}, B=${weights[1]}, C=${weights[2]}, D=${weights[3]} · seed ${seed} · chỉ số ${index}.`,
    predictionAtDraw: (symbol) => symbol === null
      ? 'Không có dự đoán nào được ghi lại cho lượt rút này.'
      : `Dự đoán được ghi lại cho lượt rút này: ${symbol}.`,
    drawResult: (draw, symbol, surprise) => `Lượt rút ${draw} cho ra ${symbol}; độ bất ngờ ${surprise.toFixed(3)} bit.`,
    staleDrawResult: (draw, symbol, surprise) => `Kết quả của thông số trước: lượt rút ${draw} cho ra ${symbol}; độ bất ngờ ${surprise.toFixed(3)} bit.`,
    feedback: 'Độ bất định thay đổi; giá trị của điều được nói chưa được đo.',
    unitLimit: 'Entropy này đo độ bất định theo bit trên mỗi ký hiệu nguồn, không đo ý nghĩa.',
    modelLimit: 'Mô hình giả định mỗi lượt rút độc lập từ phân phối bốn ký hiệu đã chọn.',
  },
  en: {
    prediction: 'The prediction is optional and is not scored. You can draw without choosing one.',
    predictionLegend: 'Predict the next symbol (optional)',
    predictionRecorded: (symbol) => `Your optional prediction: ${symbol}.`,
    weights: 'Source weights',
    weight: (symbol) => `Weight for ${symbol}`,
    seed: 'Draw seed',
    nextIndex: (counter) => `Next draw index: ${counter}`,
    draw: 'Draw symbol',
    emptySource: 'At least one symbol must have a weight above zero.',
    awaiting: 'Set at least one weight above zero to see the distribution.',
    entropy: (value) => `Entropy: ${value.toFixed(3)} bits/source-symbol`,
    probabilityBar: (symbol, value) => `${symbol} probability: ${(value * 100).toFixed(2)}%`,
    contributionBar: (symbol, value) => `${symbol} entropy contribution: ${value.toFixed(3)} bits/source-symbol`,
    distributionTable: 'Source probability and entropy contributions',
    symbol: 'Symbol',
    weightHeader: 'Weight',
    probabilityHeader: 'Probability',
    contributionHeader: 'Contribution (bits/source-symbol)',
    lastDraw: (symbol, surprise) => `Last draw: ${symbol} · surprise ${surprise.toFixed(3)} bits`,
    staleDraw: 'This draw belongs to the previous source settings.',
    drawConditions: (weights, seed, index) => `Draw conditions: A=${weights[0]}, B=${weights[1]}, C=${weights[2]}, D=${weights[3]} · seed ${seed} · index ${index}.`,
    predictionAtDraw: (symbol) => symbol === null
      ? 'No prediction was recorded for this draw.'
      : `Prediction recorded for this draw: ${symbol}.`,
    drawResult: (draw, symbol, surprise) => `Draw ${draw} produced ${symbol}; surprise ${surprise.toFixed(3)} bits.`,
    staleDrawResult: (draw, symbol, surprise) => `Result for previous settings: draw ${draw} produced ${symbol}; surprise ${surprise.toFixed(3)} bits.`,
    feedback: 'The uncertainty changed; the value of what was said was not measured.',
    unitLimit: 'This entropy measures uncertainty in bits per source symbol, not meaning.',
    modelLimit: 'The model assumes independent draws from the selected four-symbol distribution.',
  },
} satisfies Record<Lang, SourceEntropyCopy>;
