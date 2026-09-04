import type { SceneId, StoryIllustration } from '../../types';

import { historyOfAiCover } from './cover';
import scene01ClayMemory768 from './assets/scene-01-clay-memory-768.webp';
import scene01ClayMemory1536 from './assets/scene-01-clay-memory.webp';
import scene02AbacusGears768 from './assets/scene-02-abacus-gears-768.webp';
import scene02AbacusGears1536 from './assets/scene-02-abacus-gears.webp';
import scene03LoomProgram768 from './assets/scene-03-loom-program-768.webp';
import scene03LoomProgram1536 from './assets/scene-03-loom-program.webp';
import scene04CodebreakingRoom768 from './assets/scene-04-codebreaking-room-768.webp';
import scene04CodebreakingRoom1536 from './assets/scene-04-codebreaking-room.webp';
import scene05ImitationDialogue768 from './assets/scene-05-imitation-dialogue-768.webp';
import scene05ImitationDialogue1536 from './assets/scene-05-imitation-dialogue.webp';
import scene06SymbolicPerceptron768 from './assets/scene-06-symbolic-perceptron-768.webp';
import scene06SymbolicPerceptron1536 from './assets/scene-06-symbolic-perceptron.webp';
import scene07ExpertSystem768 from './assets/scene-07-expert-system-768.webp';
import scene07ExpertSystem1536 from './assets/scene-07-expert-system.webp';
import scene08LossWinter768 from './assets/scene-08-loss-winter-768.webp';
import scene08LossWinter1536 from './assets/scene-08-loss-winter.webp';
import scene09ImagenetGpu768 from './assets/scene-09-imagenet-gpu-768.webp';
import scene09ImagenetGpu1536 from './assets/scene-09-imagenet-gpu.webp';
import scene10AttentionLanguage768 from './assets/scene-10-attention-language-768.webp';
import scene10AttentionLanguage1536 from './assets/scene-10-attention-language.webp';
import scene11HumanLoopAgent768 from './assets/scene-11-human-loop-agent-768.webp';
import scene11HumanLoopAgent1536 from './assets/scene-11-human-loop-agent.webp';
import scene12AgiHorizon768 from './assets/scene-12-agi-horizon-768.webp';
import scene12AgiHorizon1536 from './assets/scene-12-agi-horizon.webp';

const responsiveScene = (
  src: string,
  src768: string,
  bytes: number,
  provenanceId: string,
  dominantColor: string,
  alt: StoryIllustration['alt'],
  caption: StoryIllustration['caption'],
): StoryIllustration => ({
  src,
  srcSet: `${src768} 768w, ${src} 1536w`,
  sizes: '(max-width: 900px) 100vw, 58vw',
  width: 1536,
  height: 1024,
  bytes,
  alt,
  caption,
  provenanceId,
  dominantColor,
});

export { historyOfAiCover };

export const historyOfAiIllustrations: Record<SceneId, StoryIllustration> = {
  'scene-01': responsiveScene(
    scene01ClayMemory1536,
    scene01ClayMemory768,
    144166,
    'history-ai-scene-01',
    '#c7b697',
    {
      vi: 'Nhiều thế hệ chuyền một bảng đất sét dọc bàn trong khi dấu lời nói dần tan đi.',
      en: 'Several generations pass a clay tablet along a table while spoken marks fade.',
    },
    {
      vi: 'Minh hoạ: dấu ấn vật chất tồn tại khác với ký ức được truyền miệng.',
      en: 'Illustration: material impressions persist differently from spoken memory.',
    },
  ),
  'scene-02': responsiveScene(
    scene02AbacusGears1536,
    scene02AbacusGears768,
    192134,
    'history-ai-scene-02',
    '#bca27c',
    {
      vi: 'Đôi tay người buôn điều khiển bàn tính bên cạnh một cơ cấu bánh răng trong suốt.',
      en: "A merchant's hands work an abacus beside a transparent gear mechanism.",
    },
    {
      vi: 'Minh hoạ: trạng thái số đi qua cả người vận hành lẫn cơ cấu tính toán.',
      en: 'Illustration: numerical state passes through both operator and calculating mechanism.',
    },
  ),
  'scene-03': responsiveScene(
    scene03LoomProgram1536,
    scene03LoomProgram768,
    229574,
    'history-ai-scene-03',
    '#aeb49b',
    {
      vi: 'Nhiều thợ thủ công đưa thẻ lệnh và hoa văn đục lỗ qua một cỗ máy tưởng tượng.',
      en: 'Multiple craftspeople feed instruction cards and punched patterns through an imagined machine.',
    },
    {
      vi: 'Minh hoạ: chương trình xuất hiện từ vật liệu, máy móc và lao động tập thể.',
      en: 'Illustration: programs emerge from materials, machinery, and collective craft.',
    },
  ),
  'scene-04': responsiveScene(
    scene04CodebreakingRoom1536,
    scene04CodebreakingRoom768,
    231032,
    'history-ai-scene-04',
    '#777d70',
    {
      vi: 'Các nhân viên vận hành băng giấy và dãy rơ-le trong một phòng máy thời chiến.',
      en: 'Operators work paper tape and relay banks in a wartime computing room.',
    },
    {
      vi: 'Minh hoạ: tính toán thời chiến là một hệ thống người, băng giấy và hạ tầng rơ-le.',
      en: 'Illustration: wartime computation was a system of people, tape, and relay infrastructure.',
    },
  ),
  'scene-05': responsiveScene(
    scene05ImitationDialogue1536,
    scene05ImitationDialogue768,
    118614,
    'history-ai-scene-05',
    '#cbbca1',
    {
      vi: 'Một giám khảo đổi các cặp kính khi cân nhắc hai cuộc đối thoại bằng mẩu giấy.',
      en: 'A judge changes lenses while weighing two conversations carried on paper slips.',
    },
    {
      vi: 'Minh hoạ: kết luận phụ thuộc vào tiêu chí phán đoán, không có bên thắng được gắn nhãn.',
      en: 'Illustration: conclusions depend on criteria, with neither respondent labeled the winner.',
    },
  ),
  'scene-06': responsiveScene(
    scene06SymbolicPerceptron1536,
    scene06SymbolicPerceptron768,
    155920,
    'history-ai-scene-06',
    '#a99776',
    {
      vi: 'Một xưởng thập niên 1950 đặt quy tắc ký hiệu cạnh đường phân tách và máy perceptron nối dây.',
      en: 'A 1950s workshop sets symbolic rules beside a separator line and wired perceptron.',
    },
    {
      vi: 'Minh hoạ: hai cách tiếp cận chồng lấn nhưng cùng bộc lộ giới hạn biểu diễn.',
      en: 'Illustration: overlapping approaches reveal different limits of representation.',
    },
  ),
  'scene-07': responsiveScene(
    scene07ExpertSystem1536,
    scene07ExpertSystem768,
    150486,
    'history-ai-scene-07',
    '#b7aa88',
    {
      vi: 'Một nhóm chuyên gia cùng sửa cây quy tắc bằng các dải giấy phân nhánh.',
      en: 'A group of practitioners revises a branching rule tree made from paper strips.',
    },
    {
      vi: 'Minh hoạ: một ngoại lệ có thể buộc tri thức mã hoá phải đổi qua nhiều nhánh.',
      en: 'Illustration: one exception can force encoded knowledge to change across many branches.',
    },
  ),
  'scene-08': responsiveScene(
    scene08LossWinter1536,
    scene08LossWinter768,
    223714,
    'history-ai-scene-08',
    '#7d7664',
    {
      vi: 'Các nhà nghiên cứu làm việc quanh địa hình hàm mất mát bằng than khi hai đường tài trợ và kỳ vọng lên xuống phía sau.',
      en: 'Researchers work around a charcoal loss landscape as separate funding and expectation traces rise and fall behind them.',
    },
    {
      vi: 'Minh hoạ: tiến bộ kỹ thuật, tài trợ và kỳ vọng công chúng không chuyển động cùng một nhịp.',
      en: 'Illustration: technical progress, funding, and public expectations do not move in lockstep.',
    },
  ),
  'scene-09': responsiveScene(
    scene09ImagenetGpu1536,
    scene09ImagenetGpu768,
    261444,
    'history-ai-scene-09',
    '#9a9a7f',
    {
      vi: 'Người gắn nhãn, ảnh máy ảnh, bo mạch GPU và cửa sổ tích chập hội tụ trong một xưởng chung.',
      en: 'Labelers, camera images, GPU boards, and convolution windows converge in a shared workshop.',
    },
    {
      vi: 'Minh hoạ: bước tiến thị giác máy dựa cả vào tính toán lẫn lao động gắn nhãn thường bị che khuất.',
      en: 'Illustration: machine-vision gains depend on compute and often-hidden labeling labor.',
    },
  ),
  'scene-10': responsiveScene(
    scene10AttentionLanguage1536,
    scene10AttentionLanguage768,
    104924,
    'history-ai-scene-10',
    '#b9ad90',
    {
      vi: 'Những mảnh giấy trong suốt nối nhau bằng cung ngữ cảnh quanh một từ mơ hồ.',
      en: 'Translucent paper fragments connect through contextual arcs around an ambiguous word.',
    },
    {
      vi: 'Minh hoạ: cùng một từ nhận trọng số khác nhau theo ngữ cảnh, không hàm ý đọc được tâm trí.',
      en: 'Illustration: the same word receives different emphasis by context, without implying mind-reading.',
    },
  ),
  'scene-11': responsiveScene(
    scene11HumanLoopAgent1536,
    scene11HumanLoopAgent768,
    142988,
    'history-ai-scene-11',
    '#87917a',
    {
      vi: 'Các đoạn nét than đi qua bàn dụng cụ, tủ dữ liệu và bàn đề xuất rồi dừng tại từng cổng quyền hạn trước tay phê duyệt.',
      en: 'Short charcoal trace segments cross a tool bench, data cabinet, and proposal desk, stopping at each permission gate before an approval hand.',
    },
    {
      vi: 'Minh hoạ: các cổng quyền hạn ngắt luồng tác nhân trước khi con người chấp thuận.',
      en: 'Illustration: permission gates interrupt an agent trace before human approval.',
    },
  ),
  'scene-12': responsiveScene(
    scene12AgiHorizon1536,
    scene12AgiHorizon768,
    158548,
    'history-ai-scene-12',
    '#b6ad91',
    {
      vi: 'Nhiều nhóm đặt các khung đo khác nhau trước một chân trời trống khi bàn tay người xem bước vào khung hình.',
      en: "Several groups hold different measuring frames to a blank horizon as the viewer's hand enters the frame.",
    },
    {
      vi: 'Minh hoạ: những định nghĩa khác nhau đo một chân trời còn bỏ ngỏ, không phải vạch đích.',
      en: 'Illustration: different definitions measure an open horizon rather than a finish line.',
    },
  ),
};
