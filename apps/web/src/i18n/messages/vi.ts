/**
 * NGUỒN SỰ THẬT của tập khoá dịch. Mọi khoá ra đời ở đây trước.
 *
 * `Messages` — kiểu suy ra từ chính object này — là cái làm cho một bản dịch
 * thiếu trở thành **lỗi biên dịch**. `messages/en.ts` khai
 * `export const en: Messages`, nên thiếu một khoá là TS2739 và thừa một khoá là
 * TS2353, cả hai đều làm `tsc -b` thoát khác 0. Đó là điểm mạnh DUY NHẤT của
 * cách tự viết so với một thư viện i18n: `i18next` và mọi thư viện cùng loại
 * trả về **chính chuỗi khoá** khi thiếu bản dịch, lúc chạy, và không cổng nào
 * trong repo này biết chuyện đó vừa xảy ra.
 *
 * KHÔNG dùng `as const`. Nó sẽ ghim mỗi giá trị thành kiểu chuỗi ký tự đúng
 * nghĩa đen ('Tiếng Việt' chứ không phải `string`), và khi ấy `en.ts` — vốn
 * phải mang chữ KHÁC — không thoả kiểu được. Kiểu ở đây phải mô tả *hình dạng*
 * của catalog, không phải nội dung của bản tiếng Việt.
 *
 * KHOÁ CÓ THAM SỐ LÀ HÀM, không phải chuỗi có chỗ trống. `'{n} khóa học'` thì
 * không có chỗ nào để nói rằng tiếng Anh cần 'course'/'courses' còn tiếng Việt
 * thì không đổi — và luật số nhiều là thứ nằm trong BẢN DỊCH, không nằm trong
 * chỗ gọi. Kiểu của hàm đi thẳng vào `Messages`, nên `en.ts` không thể khai
 * cùng khoá ấy bằng một chuỗi, và chỗ gọi không thể quên truyền `n`.
 *
 * Tên khoá viết theo `vùng.việc`, phẳng chứ không lồng: một object lồng làm
 * `keyof Messages` chỉ nhìn thấy tầng trên cùng, và khi ấy `t()` mất đúng thứ
 * nó tồn tại để giữ.
 */
export const vi = {
  /**
   * Tên của mỗi ngôn ngữ, viết bằng CHÍNH ngôn ngữ ấy — nên hai catalog có giá
   * trị giống hệt nhau ở hai khoá này, có chủ ý. Đó là quy ước của mọi bộ chọn
   * ngôn ngữ: người chỉ đọc được tiếng Anh phải tìm thấy "English" trên một
   * giao diện đang hiển thị tiếng Việt, nếu không thì bộ chọn ngôn ngữ chỉ dùng
   * được bởi người không cần tới nó.
   *
   * `i18n.test.ts` liệt kê `lang.name.vi` là ngoại lệ DUY NHẤT được phép còn
   * nguyên tiếng Việt trong bản tiếng Anh.
   */
  'lang.name.vi': 'Tiếng Việt',
  'lang.name.en': 'English',

  'lang.switcher.label': 'Ngôn ngữ giao diện',

  /**
   * Khoá có tham số đầu tiên, và nó ở đây để *cơ chế* có một chỗ dùng thật chứ
   * không phải để trang trí: Task 5 sẽ gặp hàng chục chuỗi kiểu này, và hình
   * dạng phải được chốt từ Task 4, lúc còn rẻ để đổi.
   */
  'library.courseCount': (count: number) => `${count} khóa học`,
};

/** Hình dạng mà MỌI ngôn ngữ phải phủ đúng. Xem chú thích trên `vi`. */
export type Messages = typeof vi;
