import { t } from './lang';

/** Phần cấu hình KHÔNG bí mật. Trang chính được biết những thứ này — nó cần
 *  biết đã có key hay chưa, và hiện tên nhà cung cấp/model trong giao diện. */
export interface PublicConfig {
  providerId: string;
  model: string;
}

/** Cấu hình đầy đủ, có key. Chỉ đường GỌI NHÀ CUNG CẤP (Task 3) mới được cầm
 *  giá trị này. */
export interface StoredConfig extends PublicConfig {
  apiKey: string;
}

/** HAI ô nhớ, không phải một blob JSON.
 *
 *  Kế hoạch viết một khoá duy nhất chứa cả `apiKey`. Đây là chỗ bản cài đặt này
 *  đi lệch, và lý do không phải là thẩm mỹ:
 *
 *  Với một blob, MỌI đường muốn biết "đã cấu hình chưa" đều buộc phải đọc chuỗi
 *  có chứa key vào bộ nhớ rồi tự hứa là sẽ không dùng. `status` là đường trang
 *  chính gọi được tự do — không giới hạn tần suất, không cần xác nhận — và nó
 *  không có việc gì với key. Một lời hứa không phải một hàng rào: đổi ba trường
 *  viết tay thành một dấu `...cfg` là key ra ngoài, và không cổng nào hỏi được
 *  vì "đọc rồi vứt đi" trông y hệt "không đọc" từ phía hồi đáp.
 *
 *  Tách đôi biến lời hứa thành thứ đo được: đường `status` chỉ chạm
 *  `tuhoc.vault.config`, và `keystore.test.ts` cắm bẫy vào `Storage.getItem` để
 *  khẳng định `tuhoc.vault.key` KHÔNG hề bị đọc. Bất biến đó không thể diễn đạt
 *  được dưới thiết kế một-blob.
 *
 *  Cái giá của phép tách là hai ô nhớ có thể lệch nhau; xem `writeConfig`. */
const PUBLIC_KEY = 'tuhoc.vault.config';
const SECRET_KEY = 'tuhoc.vault.key';

/** Có ô nhớ key hay không — trả lời bằng cách DUYỆT TÊN, không đọc giá trị.
 *
 *  `localStorage.key(i)` và `.length` liệt kê TÊN các ô nhớ; chỉ `getItem` mới
 *  trả về nội dung. Nhờ đó câu hỏi "đã cắm key chưa" trả lời được mà key không
 *  hề đi vào bộ nhớ — đúng thứ đường `status` cần, và là lý do bẫy trong
 *  `keystore.test.ts` ghi lại lời gọi `getItem` chứ không ghi lời gọi `key`. */
function secretExists(): boolean {
  for (let i = 0; i < localStorage.length; i += 1) {
    if (localStorage.key(i) === SECRET_KEY) return true;
  }
  return false;
}

/** Đọc phần công khai. KHÔNG BAO GIỜ gọi `getItem(SECRET_KEY)` — đó là toàn bộ
 *  lý do hàm này tồn tại tách khỏi `readConfig`.
 *
 *  Trả `null` cũng khi ô nhớ key không tồn tại, dù phần công khai vẫn còn: cái
 *  người hỏi muốn biết là "kho khoá dùng được chưa", và một cấu hình mất key
 *  thì không. Phép kiểm đó dùng `secretExists()` ở trên nên nó KHÔNG đọc key —
 *  hai điều này không mâu thuẫn nhau, và đó là điểm tinh tế của thiết kế. */
export function readPublicConfig(): PublicConfig | null {
  const raw = localStorage.getItem(PUBLIC_KEY);
  if (!raw) return null;
  if (!secretExists()) return null;
  try {
    const p = JSON.parse(raw) as Partial<PublicConfig>;
    if (typeof p.providerId !== 'string' || typeof p.model !== 'string') return null;
    // Dựng object MỚI với đúng hai trường, không trả thẳng `p`: một blob bị ghi
    // đè có thể mang thêm trường lạ, và trả `p` sẽ chuyển tiếp chúng ra hồi đáp.
    return { providerId: p.providerId, model: p.model };
  } catch {
    // JSON hỏng nghĩa là có thứ khác đã ghi đè. Coi như chưa cấu hình còn hơn
    // ném: người dùng cắm lại key mất mười giây, còn một kho khoá không chạy
    // được thì chặn toàn bộ tính năng.
    //
    // KHÔNG log `raw` ở đây, kể cả để gỡ lỗi — xem ràng buộc "key không vào
    // log". Ô nhớ này không chứa key sau phép tách ở trên, nhưng thói quen ghi
    // nội dung thô ra console là thứ sẽ theo người sửa sang đường khác.
    return null;
  }
}

/** Đọc cấu hình đầy đủ. Chỉ gọi ở đường thật sự cần key.
 *
 *  Trả `null` khi thiếu BẤT KỲ nửa nào: một cấu hình "có nhà cung cấp nhưng
 *  không có key" không dùng được, và nói nó đã sẵn sàng chỉ đổi một lỗi rõ ràng
 *  lúc cấu hình lấy một lỗi khó hiểu lúc gọi mạng. */
export function readConfig(): StoredConfig | null {
  const pub = readPublicConfig();
  if (!pub) return null;
  const apiKey = localStorage.getItem(SECRET_KEY);
  if (typeof apiKey !== 'string' || apiKey === '') return null;
  return { providerId: pub.providerId, model: pub.model, apiKey };
}

export function writeConfig(c: StoredConfig): void {
  // Từ chối trước khi ghi bất cứ gì. Đây là chỗ DUY NHẤT ngăn được trạng thái
  // "đã cấu hình nhưng không có key" — `readPublicConfig` cố tình không kiểm ô
  // nhớ kia, nên nó không thể tự phát hiện.
  //
  // Thông điệp lỗi nói về TRƯỜNG NÀO thiếu, không bao giờ chèn giá trị vào.
  if (!c.providerId || !c.model) {
    throw new Error(t('vault.keystore.missingProviderOrModel'));
  }
  if (!c.apiKey) {
    throw new Error(t('vault.keystore.emptyKey'));
  }
  // Key TRƯỚC, phần công khai SAU. Nếu lần ghi thứ hai hỏng (hết hạn ngạch,
  // chế độ riêng tư), thứ còn lại là một key mồ côi mà `readPublicConfig` không
  // thấy ⇒ kho khoá nói "chưa cấu hình" và người dùng cắm lại. Ghi ngược thứ tự
  // sẽ cho ra "đã cấu hình" mà không có key — hỏng ở đúng chiều tệ hơn.
  localStorage.setItem(SECRET_KEY, c.apiKey);
  localStorage.setItem(PUBLIC_KEY, JSON.stringify({ providerId: c.providerId, model: c.model }));
}

export function clearConfig(): void {
  localStorage.removeItem(SECRET_KEY);
  localStorage.removeItem(PUBLIC_KEY);
}
