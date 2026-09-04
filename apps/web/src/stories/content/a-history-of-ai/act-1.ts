import type { Localized, RichTextBlock, StoryAct, StoryScene } from '../../types';
import { historyOfAiIllustrations } from './assets';

export const blocks = (vi: string, en: string): Localized<RichTextBlock[]> => ({
  vi: [{ kind: 'paragraph', text: vi }],
  en: [{ kind: 'paragraph', text: en }],
});

export const technicalBlocks = (vi: string, en: string): Localized<RichTextBlock[]> => blocks(
  `${vi} Phần minh hoạ này không thay thế bằng chứng lịch sử hoặc đánh giá độc lập.`,
  `${en} This illustration never substitutes for historical evidence or independent evaluation.`,
);

const fallback = (vi: string, en: string) => ({
  diagramLabel: { vi: 'Sơ đồ minh hoạ có thể đọc bằng chữ', en: 'Text-readable illustrative diagram' },
  explanation: { vi, en },
});

export const actOne: StoryAct = {
  id: 'act-1', number: 1,
  title: { vi: 'Ngoại hoá tư duy', en: 'Thought outside the body' },
  question: { vi: 'Một ý nghĩ có thể sống ở đâu ngoài một con người?', en: 'Where can an idea live beyond one person?' },
  consequence: blocks(
    'Khi ký ức, số và thủ tục có thể rời một cơ thể, quyền giữ tri thức cũng thay đổi. Người viết, người vận hành và người sở hữu hạ tầng quyết định điều gì được lưu, chạy, sửa và truyền lại.',
    'When memory, number, and procedure can leave one body, power over knowledge changes too. Scribes, operators, and infrastructure owners help decide what is stored, executed, corrected, and passed on.',
  ),
  sceneIds: ['scene-01', 'scene-02', 'scene-03'],
};

export const actOneScenes = [
  {
    id: 'scene-01', actId: 'act-1',
    period: { vi: 'Thiên niên kỷ IV–III TCN', en: 'Fourth–third millennium BCE' },
    title: { vi: 'Dấu vết và trí nhớ chung', en: 'Marks and shared memory' },
    humanStory: blocks(
      'Trước khi có lĩnh vực AI, nhiều cộng đồng đã tìm cách để một điều được biết không phải chết cùng người biết nó. Ở Uruk, những bảng đất sét gắn với việc đếm, phân phối và quản lý trong các đô thị đang lớn lên; một dấu trên đất có thể đi qua bàn tay của người viết, người giao hàng và người kiểm tra. Vật liệu bền không trung tính: nó làm một bản ghi có thể được đối chiếu, nhưng cũng đặt việc đọc vào tay người biết quy ước và có quyền vào kho lưu trữ. Trí nhớ truyền miệng vẫn giàu bối cảnh, giọng nói và quan hệ; nó không đơn giản là phiên bản kém của bản ghi. Cảnh này là tiền sử của công cụ cho tư duy, không phải lời tuyên bố rằng AI bắt đầu từ chữ viết. Lab chỉ làm hiện một khác biệt trực giác: dấu hiệu có thể giữ mẫu qua nhiều lượt truyền, còn lịch sử thực phức tạp hơn mọi thanh trượt.',
      'Long before AI became a field, communities were finding ways for knowledge not to die with the knower. At Uruk, clay tablets were tied to counting, distribution, and administration in growing cities; a mark could pass through the hands of a scribe, courier, and checker. Durable material is not neutral: it makes a record comparable, while placing reading in the hands of people who know the convention and can enter the archive. Oral memory still carries context, voice, and relationship; it is not simply an inferior record. This scene is a prehistory of tools for thought, not a claim that AI begins with writing. The lab only makes one intuition visible: marks may preserve a pattern across transmissions, while real histories remain more complex than any slider.',
    ),
    technicalHinge: technicalBlocks(
      'Một ký hiệu tách nội dung khỏi khoảnh khắc phát ngôn: nó cho phép sao chép, kiểm tra và phối hợp ở khoảng cách. Nhưng bản ghi cần vật mang, quy ước đọc và lao động bảo quản. Trong lab, retention là tham số minh hoạ cho số dấu còn nhận ra sau từng thế hệ, không phải ước lượng khảo cổ hay thước đo chính xác về trí nhớ miệng. Mô hình cố ý giữ hai đường song song để người đọc hỏi điều gì bị mất khi một ý tưởng đổi vật mang.',
      'A symbol separates content from the moment of utterance: it permits copying, checking, and coordination at distance. Yet a record needs a carrier, a reading convention, and maintenance labor. In the lab, retention is an illustrative parameter for recognizable marks after each generation, not an archaeological estimate or a precise measure of oral memory. The model deliberately keeps two paths side by side so readers can ask what changes when an idea changes medium.',
    ),
    illustration: historyOfAiIllustrations['scene-01'],
    lab: { kind: 'external-memory', title: { vi: 'Trí nhớ ngoài cơ thể', en: 'External memory' }, instruction: { vi: 'Kéo qua các thế hệ để so hai cách truyền dấu.', en: 'Move through generations to compare two ways of carrying marks.' }, config: { generations: 8, originalMarks: 12, oralRetention: 0.78, symbolicRetention: 0.97 } },
    labFallback: fallback('Hai đường minh hoạ cho thấy dấu được mô hình hoá giữ lại khác nhau qua tám thế hệ.', 'Two illustrative paths show marks modeled to persist differently across eight generations.'),
    sourceIds: ['met-writing', 'british-cuneiform'],
    openQuestion: { vi: 'Ai được quyền đọc, sửa hoặc xoá một trí nhớ chung?', en: 'Who gets to read, amend, or erase a shared memory?' },
  },
  {
    id: 'scene-02', actId: 'act-1',
    period: { vi: 'Cổ đại đến cận đại', en: 'Antiquity to early modern periods' },
    title: { vi: 'Con số, bàn tính và máy cơ học', en: 'Number, abacus, and mechanism' },
    humanStory: blocks(
      'Một bàn tính không thay người tính bằng phép màu. Nó đặt số vào vị trí, đòi hỏi một bàn tay biết luật dịch hạt, và biến phép cộng thành chuỗi cử chỉ có thể học, quan sát và kiểm tra. Người buôn, người ghi sổ, thầy dạy và người thao tác đều là một phần của hệ thống tính. Computer History Museum mô tả giá trị trên bàn tính bằng vị trí của các marker; điều đó giúp thấy vì sao “trạng thái” không chỉ nằm trong đầu. Khi cơ cấu bánh răng xuất hiện, một phần chuyển trạng thái được gắn vào vật liệu và lực cơ học. Nhưng cơ cấu không tự chọn bài toán, tự hiểu sai số hay tự quyết ý nghĩa của kết quả. Đi từ hạt sang bánh răng là một đổi thay về cách thực thi, không phải một đường tiến hoá thẳng đến trí tuệ nhân tạo. Lab cho người đọc làm 7 + 5 trên bốn cột để thấy carry vừa là quy tắc vừa là thao tác.',
      'An abacus does not replace the calculator by magic. It puts number into position, requires hands that know the movement rules, and turns addition into gestures that can be taught, watched, and checked. Merchants, bookkeepers, teachers, and operators are all part of the calculating system. The Computer History Museum describes abacus value through marker position; that makes it easier to see why “state” is not only in a head. With gears, part of state transition is fixed into material and mechanical force. But a mechanism does not select the problem, understand an error, or decide what an answer means. Moving from beads to gears changes execution, not a straight evolutionary line toward AI. The lab lets readers perform 7 + 5 across four rods, making carry visible as both rule and action.',
    ),
    technicalHinge: technicalBlocks(
      'Biểu diễn theo vị trí cho phép cùng một thao tác cục bộ tham gia vào số lớn hơn: mỗi cột có giá trị riêng và carry liên kết các cột. Bàn tính làm quy tắc hiện thân trong thao tác; máy cơ học chuyển một số ràng buộc sang hình học bánh răng. Lab hiển thị trạng thái từng cột, vì vậy kết quả không phải một hộp đen. Bốn rod là giới hạn giao diện của minh hoạ, không phải mô hình lịch sử của mọi bàn tính.',
      'Positional representation lets the same local operation participate in larger numbers: every column has its value and carry links columns. The abacus embodies a rule in action; a mechanical device transfers some constraints into gear geometry. The lab shows each column state so the answer is not a black box. Its four rods are an interface limit for illustration, not a historical model of every abacus.'),
    illustration: historyOfAiIllustrations['scene-02'],
    lab: { kind: 'embodied-calculation', title: { vi: 'Cộng bằng trạng thái', en: 'Addition as state' }, instruction: { vi: 'Theo dõi bốn cột của phép 7 + 5.', en: 'Trace four rods while adding 7 + 5.' }, config: { left: 7, right: 5, rods: 4 } },
    labFallback: fallback('Bốn cột mô tả 7 cộng 5 bằng các bước và carry.', 'Four rods describe 7 plus 5 through steps and carry.'),
    sourceIds: ['smithsonian-abacus', 'chm-abacus'],
    openQuestion: { vi: 'Khi thao tác được đóng vào cơ cấu, trách nhiệm kiểm tra nằm ở ai?', en: 'When an operation is built into mechanism, who remains responsible for checking it?' },
  },
  {
    id: 'scene-03', actId: 'act-1',
    period: { vi: 'Thế kỷ XIX', en: 'Nineteenth century' },
    title: { vi: 'Logic, ký hiệu và chương trình', en: 'Logic, symbols, and programs' },
    humanStory: blocks(
      'Giữa thế kỷ XIX, tính toán là một chuỗi lao động: bảng số được tính, chép, rà và in bởi con người. Babbage muốn giảm lỗi nhưng dự án của ông cũng cho thấy máy không tách khỏi thợ cơ khí, vốn nhà nước, tranh chấp hợp đồng và giới hạn chế tạo chính xác. Analytical Engine được hình dung như một máy chung có thể nhận các chỉ dẫn khác nhau. Trong ghi chú xuất bản năm 1843, Ada Lovelace mô tả các bước giải một bài toán và suy nghĩ xa hơn số học, về việc ký hiệu có thể đại diện cho những thứ khác. Điều đó không biến bà thành một huyền thoại đơn độc: nó đặt công việc trí tuệ vào mạng lưới dịch thuật, xuất bản, máy móc và người làm nghề. Lab dùng thẻ 4 → ×2 → +3 để phân biệt phần máy giấy với thứ tự lệnh; khi đảo thẻ, trace giải thích sai khác thay vì chỉ phán “sai”.',
      'In the mid-nineteenth century, calculation was a chain of labor: numerical tables were computed, copied, checked, and printed by people. Babbage sought to reduce error, yet his projects also show that machines are inseparable from toolmakers, public finance, contract disputes, and limits of precision manufacture. The Analytical Engine was imagined as a general machine able to receive different instructions. In notes published in 1843, Ada Lovelace described steps for a mathematical problem and considered symbols standing for more than numbers. That does not make her a solitary myth; it situates intellectual work in a network of translation, publication, machinery, and skilled craft. The lab uses cards 4 → ×2 → +3 to distinguish a paper machine from instruction order; reversing cards opens a trace instead of merely declaring an error.',
    ),
    technicalHinge: technicalBlocks(
      'Một chương trình là mô tả có thứ tự của biến đổi, còn máy là cơ chế thực hiện mô tả ấy. Tách hai phần này tạo khả năng cùng phần cứng chạy nhiều thủ tục và giúp lỗi có thể lần theo. Lab chỉ dùng phép nhân và cộng trên số nguyên không âm; nó không mô phỏng Analytical Engine. Giá trị của nó là làm rõ rằng thay thứ tự thẻ đổi output, nên “đúng” luôn phụ thuộc vào thủ tục được viết và kiểm tra.',
      'A program is an ordered description of transformations, while a machine is the mechanism that carries it out. Separating the two enables one physical arrangement to run many procedures and makes failure traceable. The lab uses only multiplication and addition on non-negative integers; it does not simulate the Analytical Engine. Its value is to show that changing card order changes output, so correctness depends on a procedure that is written and checked.'),
    illustration: historyOfAiIllustrations['scene-03'],
    lab: { kind: 'executable-rules', title: { vi: 'Máy giấy và thẻ lệnh', en: 'A paper machine and instruction cards' }, instruction: { vi: 'Giữ thứ tự thẻ để biến 4 thành 11.', en: 'Keep the card order to turn 4 into 11.' }, config: { input: 4, target: 11, cards: [{ id: 'double', operation: 'multiply', operand: 2 }, { id: 'plus-three', operation: 'add', operand: 3 }] } },
    labFallback: fallback('Theo thứ tự ×2 rồi +3, đầu vào 4 cho 11; đổi thứ tự cho trace khác.', 'In the order ×2 then +3, input 4 yields 11; another order yields a different trace.'),
    sourceIds: ['chm-babbage', 'chm-ada'],
    openQuestion: { vi: 'Ai được nhìn thấy trace khi một thủ tục làm sai?', en: 'Who gets to see the trace when a procedure goes wrong?' },
  },
] satisfies StoryScene[];
