import type { Lang } from '../../../i18n';
import type { RouteId } from './model';

interface CableRouteCopy {
  prediction: string;
  routes: string;
  routeName: Record<RouteId, string>;
  routeOption: (name: string, length: number, hard: number, deep: number) => string;
  profile: (name: string) => string;
  budget: string;
  units: string;
  revealNext: string;
  allRevealed: string;
  awaiting: string;
  table: string;
  item: string;
  calculation: string;
  value: string;
  formula: string;
  length: string;
  hard: string;
  deep: string;
  total: string;
  shortfall: string;
  enoughExact: string;
  enoughWithMargin: (margin: number) => string;
  shortBy: (shortfall: number) => string;
  feedback: string;
  fictionalLimit: string;
  excludedFactors: string;
}

export const cableRouteCopy = {
  vi: {
    prediction: 'Trước khi xem các thành phần chi phí, bạn đoán tuyến nào sẽ cần ít đơn vị mô phỏng nhất? Bạn có thể tiếp tục mà không cần trả lời.',
    routes: 'Các tuyến giả lập',
    routeName: { north: 'Bắc', middle: 'Giữa', south: 'Nam' },
    routeOption: (name, length, hard, deep) => `${name} — L ${length} đơn vị mô phỏng; H ${hard} đoạn khó; D ${deep} đoạn sâu`,
    profile: (name) => `Mặt cắt tuyến giả lập ${name}`,
    budget: 'Ngân sách',
    units: 'đơn vị mô phỏng',
    revealNext: 'Xem thành phần tiếp theo',
    allRevealed: 'Đã xem đủ ba thành phần',
    awaiting: 'Xem từng thành phần để theo dõi nguồn lực cộng dồn.',
    table: 'Các thành phần chi phí tuyến',
    item: 'Mục',
    calculation: 'Phép tính',
    value: 'Giá trị (đơn vị mô phỏng)',
    formula: 'Công thức',
    length: 'Chiều dài',
    hard: 'Đoạn khó',
    deep: 'Độ sâu',
    total: 'Tổng',
    shortfall: 'Thiếu hụt',
    enoughExact: 'Ngân sách vừa đủ cho tuyến này.',
    enoughWithMargin: (margin) => `Ngân sách đủ, còn ${margin} đơn vị mô phỏng.`,
    shortBy: (shortfall) => `Thiếu ${shortfall} đơn vị mô phỏng so với tuyến này.`,
    feedback: 'Tuyến ngắn nhất chưa phải tuyến ít tốn nguồn lực nhất trong mô hình này.',
    fictionalLimit: 'Đây là bài tập quyết định dùng các tuyến giả lập và hàm chi phí công khai; các đơn vị mô phỏng không phải kilômét, ngày hay tiền thật.',
    excludedFactors: 'Mô hình không tối ưu tuyến cáp thật và không biến yếu tố môi trường hoặc chính trị thành các số đã biết.',
  },
  en: {
    prediction: 'Before revealing the cost components, which route do you expect will need the fewest simulation units? You can continue without answering.',
    routes: 'Fictional routes',
    routeName: { north: 'North', middle: 'Middle', south: 'South' },
    routeOption: (name, length, hard, deep) => `${name} — L ${length} simulation units; H ${hard} difficult segments; D ${deep} deep segments`,
    profile: (name) => `${name} fictional route profile`,
    budget: 'Budget',
    units: 'simulation units',
    revealNext: 'Reveal next component',
    allRevealed: 'All three components are revealed',
    awaiting: 'Reveal each component to follow the accumulating resource cost.',
    table: 'Route cost components',
    item: 'Item',
    calculation: 'Calculation',
    value: 'Value (simulation units)',
    formula: 'Formula',
    length: 'Length',
    hard: 'Difficult segments',
    deep: 'Depth',
    total: 'Total',
    shortfall: 'Shortfall',
    enoughExact: 'The budget is exactly enough for this route.',
    enoughWithMargin: (margin) => `The budget is enough, with ${margin} simulation units remaining.`,
    shortBy: (shortfall) => `The budget is ${shortfall} simulation ${shortfall === 1 ? 'unit' : 'units'} short for this route.`,
    feedback: 'The shortest route is not the least resource-intensive route in this model.',
    fictionalLimit: 'This decision exercise uses fictional routes and a disclosed cost function; the simulation units are not kilometres, days, or real money.',
    excludedFactors: 'It does not optimize a real cable route or treat environmental and political factors as known numbers.',
  },
} satisfies Record<Lang, CableRouteCopy>;
