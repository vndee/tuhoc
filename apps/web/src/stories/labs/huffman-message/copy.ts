import type { Lang } from '../../../i18n';

interface HuffmanMessageCopy {
  prediction: string;
  run: string;
  step: string;
  complete: string;
  awaiting: string;
  staleBanner: string;
  mergeProgress: (step: number, total: number) => string;
  mergeHistory: string;
  noMerges: string;
  noMergesRevealed: string;
  merge: (left: string, right: string, parent: number) => string;
  tree: string;
  visibleNodes: string;
  treeWindow: (visible: number, total: number) => string;
  leafNode: (byte: string, count: number) => string;
  branchNode: (id: number, count: number) => string;
  shortNode: (id: number) => string;
  edge: (bit: 0 | 1, child: string, count: number, outside: boolean) => string;
  leafBoundary: string;
  byteSummary: (bytes: number, alphabet: number) => string;
  codesTable: string;
  byte: string;
  count: string;
  code: string;
  length: string;
  codeRange: (start: number, end: number, total: number) => string;
  previousCodes: string;
  nextCodes: string;
  sizeTable: string;
  sizePart: string;
  bits: string;
  raw: string;
  payload: string;
  header: string;
  padding: string;
  total: string;
  exact: string;
  mismatch: string;
  decoderRejected: string;
  decoderRejectedStatus: string;
  staleStatus: string;
  larger: string;
  smaller: string;
  equal: string;
  teachingNotice: string;
  feedback: string;
  modelLimit: string;
}

export const huffmanMessageCopy = {
  vi: {
    prediction: 'Bạn dự đoán toàn bộ gói minh họa có nhỏ hơn dữ liệu UTF-8 thô không? Dự đoán là tùy chọn và không được chấm điểm.',
    run: 'Chạy thử',
    step: 'Từng bước',
    complete: 'Hoàn tất',
    awaiting: 'Chạy thử để dựng mã byte và tính toàn bộ gói.',
    staleBanner: 'Cây và phép tính này thuộc về câu trước.',
    mergeProgress: (step, total) => `Lần ghép ${step} trên ${total}`,
    mergeHistory: 'Các lần ghép đang hiện',
    noMerges: 'Không cần ghép. Với một giá trị byte duy nhất, mã vẫn là 0.',
    noMergesRevealed: 'Chưa hiện lần ghép nào.',
    merge: (left, right, parent) => `${left} + ${right} → nút ${parent}`,
    tree: 'Cửa sổ cây dựng Huffman',
    visibleNodes: 'Các nút cây đang hiện',
    treeWindow: (visible, total) => `Đang hiện ${visible} trên ${total} nút dựng quanh cây con được chọn.`,
    leafNode: (byte, count) => `${byte}, tần số ${count}`,
    branchNode: (id, count) => `Nút ${id}, tần số ${count}`,
    shortNode: (id) => `nút ${id}`,
    edge: (bit, child, count, outside) => `${bit} → ${child}, tần số ${count}${outside ? ' (ngoài cửa sổ này)' : ''}.`,
    leafBoundary: 'Nút lá; không có cạnh con.',
    byteSummary: (bytes, alphabet) => `${bytes} byte UTF-8 · ${alphabet} giá trị byte`,
    codesTable: 'Các mã Huffman',
    byte: 'Byte',
    count: 'Tần số',
    code: 'Mã',
    length: 'Độ dài',
    codeRange: (start, end, total) => `Mã ${start}–${end} trên ${total}`,
    previousCodes: 'Mã trước',
    nextCodes: 'Mã tiếp theo',
    sizeTable: 'Phép tính dung lượng',
    sizePart: 'Thành phần',
    bits: 'Bit',
    raw: 'UTF-8 thô',
    payload: 'Dữ liệu đã mã hóa',
    header: 'Phần đầu và tần số',
    padding: 'Bit đệm',
    total: 'Toàn bộ gói',
    exact: 'Các byte giải mã khớp chính xác với byte nguồn.',
    mismatch: 'Các byte giải mã không khớp byte nguồn.',
    decoderRejected: 'Bộ giải mã độc lập từ chối gói.',
    decoderRejectedStatus: 'Không thể giải mã độc lập gói đã lưu.',
    staleStatus: 'Kết quả của câu trước; hãy chạy lại để cập nhật.',
    larger: 'Phần dữ liệu ngắn hơn, nhưng cả gói dài hơn vì bảng mã.',
    smaller: 'Các byte giải mã độc lập khớp và toàn bộ gói nhỏ hơn UTF-8 thô.',
    equal: 'Các byte giải mã độc lập khớp và toàn bộ gói bằng kích thước UTF-8 thô.',
    teachingNotice: 'Đây là định dạng minh họa, không phải ZIP, gzip hay định dạng trao đổi chuẩn.',
    feedback: 'Mã ngắn dành cho byte xuất hiện thường xuyên; chi phí bảng mã vẫn phải được gửi cùng.',
    modelLimit: 'Mô hình đếm byte UTF-8 và dùng bảng tần số đầy đủ; nó không phải bộ nén dùng trong sản phẩm.',
  },
  en: {
    prediction: 'Will the whole teaching packet be smaller than raw UTF-8? The prediction is optional and is not scored.',
    run: 'Run experiment',
    step: 'Step',
    complete: 'Complete',
    awaiting: 'Run the experiment to build a byte code and count the whole packet.',
    staleBanner: 'This tree and accounting belong to the previous message.',
    mergeProgress: (step, total) => `Merge ${step} of ${total}`,
    mergeHistory: 'Visible merge history',
    noMerges: 'No merge is needed. With one byte value, the code is still 0.',
    noMergesRevealed: 'No merges revealed yet.',
    merge: (left, right, parent) => `${left} + ${right} → node ${parent}`,
    tree: 'Huffman construction tree window',
    visibleNodes: 'Visible tree nodes',
    treeWindow: (visible, total) => `Showing ${visible} of ${total} construction nodes around the selected subtree.`,
    leafNode: (byte, count) => `${byte}, frequency ${count}`,
    branchNode: (id, count) => `Node ${id}, frequency ${count}`,
    shortNode: (id) => `node ${id}`,
    edge: (bit, child, count, outside) => `${bit} → ${child}, frequency ${count}${outside ? ' (outside this window)' : ''}.`,
    leafBoundary: 'Leaf node; no child edges.',
    byteSummary: (bytes, alphabet) => `${bytes} UTF-8 bytes · ${alphabet} byte values`,
    codesTable: 'Huffman codes',
    byte: 'Byte',
    count: 'Frequency',
    code: 'Code',
    length: 'Length',
    codeRange: (start, end, total) => `Codes ${start}–${end} of ${total}`,
    previousCodes: 'Previous codes',
    nextCodes: 'Next codes',
    sizeTable: 'Size accounting',
    sizePart: 'Part',
    bits: 'Bits',
    raw: 'Raw UTF-8',
    payload: 'Coded payload',
    header: 'Header and frequencies',
    padding: 'Padding',
    total: 'Total packet',
    exact: 'Decoded bytes exactly match the source bytes.',
    mismatch: 'Decoded bytes do not match the source bytes.',
    decoderRejected: 'Independent decoder rejected the packet.',
    decoderRejectedStatus: 'The saved packet could not be decoded independently.',
    staleStatus: 'Result for the previous message; run again to update it.',
    larger: 'The payload is shorter, but the full packet is larger because of its codebook.',
    smaller: 'The independently decoded bytes match and the full packet is smaller than raw UTF-8.',
    equal: 'The independently decoded bytes match and the full packet equals raw UTF-8 in size.',
    teachingNotice: 'This is a teaching format, not ZIP, gzip, or a standard interchange format.',
    feedback: 'Frequent bytes receive shorter codes, while the codebook cost still travels with them.',
    modelLimit: 'The model counts UTF-8 bytes and carries a full frequency table; it is not a production compressor.',
  },
} satisfies Record<Lang, HuffmanMessageCopy>;
