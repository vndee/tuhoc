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

  /* ── trang CÀI ĐẶT (`pages/Settings.tsx`) ─────────────────────────────────
   *
   * `/settings` KHÔNG còn là "trang Trợ lý AI". Theo đặc tả IA
   * (`docs/superpowers/specs/2026-08-23-ia-redesign.md`) nó là **Cài đặt**, và
   * Trợ lý AI là MỘT MỤC bên trong nó. Tên trang dùng lại `account.settings` —
   * cùng chữ với mục ở đáy thanh bên, vì đó là cùng một nơi chốn và hai chữ
   * khác nhau cho một nơi là hai chữ sẽ trôi khác nhau.
   */

  'settings.nav.aria': 'Mục cài đặt',
  'settings.section.account': 'Tài khoản',
  'settings.section.appearance': 'Ngôn ngữ & giao diện',
  'settings.section.localData': 'Dữ liệu trên máy',
  'settings.section.general': 'Chung',
  'settings.lede': 'Tài khoản, giao diện, và những gì đang nằm trên máy này.',
  'settings.account.syncBlurb': 'Tiến độ đồng bộ qua tài khoản này.',
  'settings.appearance.themeLight': 'Sáng',
  'settings.appearance.themeDark': 'Tối',
  'settings.localData.statNotes': 'ghi chú',
  'settings.localData.statBytes': 'đang chiếm',
  'settings.localData.statsAria': 'Máy này đang giữ những gì',

  /* ── mục Tài khoản ─────────────────────────────────────────────────────── */

  'settings.account.loading': 'Đang hỏi máy chủ xem ai đang đăng nhập…',
  'settings.account.unknown': 'Chưa lấy được thông tin tài khoản. Phần này cần mạng.',
  'settings.account.signedInAs': (name: string, email: string) =>
    name === '' ? `Đang đăng nhập: ${email}` : `Đang đăng nhập: ${name} · ${email}`,
  /**
   * Câu này nói ra một hệ quả CÓ THẬT, không phải một lời doạ lịch sự:
   * `useLogout` gọi `clearSession()`, thứ xoá mọi bảng cục bộ. Người dùng bấm
   * "Đăng xuất" mà không biết điều đó sẽ mất ghi chú chưa kịp đồng bộ.
   *
   * ĐÃ BỎ "gói đã tải" ở fix-round-1 (task-14): Task 13 xoá bảng `db.packages`
   * — không còn gói khoá học nào tải về máy để đăng xuất xoá đi cả. Hai thứ
   * còn lại (ghi chú, hàng đợi tiến độ chưa gửi) vẫn đúng: `clearLocalData()`
   * xoá cả hai qua `useLogout`.
   */
  'settings.account.signOutWarning':
    'Đăng xuất xoá dữ liệu học của phiên này khỏi trình duyệt này: ghi chú và hàng đợi tiến độ chưa gửi được. Đó là cách duy nhất để dữ liệu của hai người dùng chung một máy không lẫn vào nhau.',

  /* ── mục Ngôn ngữ & giao diện ──────────────────────────────────────────── */

  'settings.appearance.blurb': 'Áp cho khung ứng dụng. Nội dung khoá học giữ ngôn ngữ của chính nó.',
  'settings.appearance.language': 'Ngôn ngữ',
  'settings.appearance.theme': 'Giao diện',
  'settings.appearance.themeNowLight': 'Đang dùng giao diện sáng.',
  'settings.appearance.themeNowDark': 'Đang dùng giao diện tối.',

  /* ── mục Dữ liệu trên máy ──────────────────────────────────────────────── */

  /**
   * SỬA HAI LẦN, và lần thứ hai sửa đúng cái mà lần thứ nhất bỏ sót.
   *
   * fix-round-1 (task-14) bỏ vế "Gói khoá học" — sai từ Task 13, khi
   * `db.packages` bị xoá khỏi lược đồ Dexie (spec
   * `2026-08-25-server-side-pivot.md` §1). Nhưng vế CÒN LẠI ("Ghi chú nằm
   * trong trình duyệt này") vẫn thiếu một nửa sự thật, và thiếu nó ở đúng
   * mục người dùng tìm tới để hỏi "các anh giữ gì của tôi": ghi chú CÓ một
   * bản trên máy chủ. Nó đi qua `POST /sync` (`sync/engine.ts`'s
   * `flushOutbox` gửi cả `progress` lẫn `annotations`), `sync/usecase.go`
   * đọc/ghi nó, và bảng `annotations` có từ migration `0001_init`.
   * `login.point.sync` ở dưới đã hứa đúng điều đó — "ghi chú theo bạn trên
   * mọi thiết bị" — nên trước bản này hai màn nói ngược nhau
   * (review tổng nhánh Pha 2, E5).
   *
   * KHÔNG hứa "dùng được khi mất mạng" ở đây dù bản trong trình duyệt có
   * làm được: đó là một khẳng định về HÀNH VI, và mục này chỉ được giao trả
   * lời một câu hỏi về NƠI CHỐN.
   */
  'settings.localData.blurb':
    'Ghi chú nằm ở hai nơi: một bản trong trình duyệt này, và một bản đồng bộ lên máy chủ theo tài khoản của bạn — nên đăng nhập ở thiết bị khác vẫn thấy đủ. Khoá học không tải gói nào về máy: đọc thẳng từ máy chủ.',
  'settings.localData.clearedOnSignOut':
    'Cơ sở dữ liệu mang tên TRÌNH DUYỆT, không mang tên người dùng — nên nó bị xoá sạch mỗi lần đổi người đăng nhập, kể cả khi không ai bấm đăng xuất.',
  'settings.localData.kept': 'Ngôn ngữ và giao diện thì ở lại: chúng là tuỳ chọn của thiết bị.',

  /* ── mục Trợ lý AI (Pha 2 — task-14: credit + cấu hình agent thay khung
     kho khoá) ────────────────────────────────────────────────────────────
     Task 15 đổi `login.point.ownKey` và `login.pitch.lede` (lời hứa Pha 1,
     "key của chính bạn") ở dưới, tại mục `login.*`. Ở ĐÂY áp cùng nguyên tắc,
     sớm hơn.

     LUẬT, VIẾT LẠI CHO ĐÚNG THỨ NÓ VỐN ĐỊNH NÓI (review tổng nhánh Pha 2,
     F4): bản trước cấm "nhắc lại 'key', 'kho khoá', hay 'địa chỉ riêng'" —
     rồi `settings.ai.blurb` ngay năm dòng dưới nhắc chữ "key". Luật ấy tự vi
     phạm vì nó cấm nhầm thứ: cấm CHỮ, trong khi thứ đã chết là LỜI HỨA. Câu
     duy nhất còn nhắc "key" ở đây nhắc nó để PHỦ ĐỊNH — "không còn key nào
     để bạn tự cắm hay tự giữ" — và một luật cấm cả câu phủ định sẽ buộc mục
     này im lặng về đúng thứ người đọc Pha 1 đang đi tìm.

     Luật thật: không câu nào dưới đây được nói rằng người học VẪN có, VẪN
     cắm, hay VẪN giữ một key nhà cung cấp, và không câu nào được nhắc tới
     "kho khoá" hay "địa chỉ riêng" như một thứ đang tồn tại — cả ba đã sai kể
     từ khi AI chuyển sang chạy trên máy chủ (Task 11). Nói rằng chúng KHÔNG
     còn thì được, và thường là việc phải làm. */

  'settings.ai.title': 'Trợ lý AI',
  'settings.ai.blurb':
    'Trợ lý AI chạy trên máy chủ của chúng tôi, trả bằng credit của tài khoản bạn — không còn key nào để bạn tự cắm hay tự giữ.',

  /* ── `CreditPanel.tsx` — số dư và sổ dùng gần đây, GET /ai/credits ──────── */

  'settings.ai.creditTitle': 'Credit',
  'settings.ai.creditBalanceLabel': 'Credit khả dụng',
  'settings.ai.creditLoading': 'Đang đọc số dư…',
  'settings.ai.creditError': 'Không đọc được số dư credit. Thử tải lại trang.',
  'settings.ai.usageTitle': 'Sổ dùng gần đây',
  'settings.ai.usageEmpty': 'Chưa có lượt hỏi nào được tính phí.',
  'settings.ai.usageColWhen': 'Thời điểm',
  'settings.ai.usageColModel': 'Mô hình',
  'settings.ai.usageColTokensIn': 'Token vào',
  'settings.ai.usageColTokensCached': 'Token vào (cache)',
  'settings.ai.usageColTokensOut': 'Token ra',
  'settings.ai.usageColToolCalls': 'Lượt gọi công cụ',
  'settings.ai.usageColWebSearches': 'Lượt tìm web',
  'settings.ai.usageColCredits': 'Credit đã trừ',

  /* ── `AgentConfigPanel.tsx` — prompt riêng và tool bật/tắt, GET/PUT
     /ai/config ────────────────────────────────────────────────────────── */

  'settings.ai.configTitle': 'Cấu hình agent',
  'settings.ai.configBlurb':
    'Lời nhắc riêng được thêm vào MỌI lượt hỏi của bạn — dùng nó để nói cho trợ lý biết bạn muốn được trả lời thế nào.',
  'settings.ai.configLoading': 'Đang đọc cấu hình…',
  'settings.ai.configError': 'Không đọc được cấu hình agent. Thử tải lại trang.',
  'settings.ai.promptLabel': 'Lời nhắc riêng của bạn',
  'settings.ai.promptPlaceholder': 'Ví dụ: luôn trả lời ngắn gọn, kèm ví dụ bằng Python.',
  /**
   * `(count: string, max: string) => …` — hai chuỗi SỐ THUẦN (không dấu
   * phân cách nghìn, có chủ ý): một bộ đếm ký tự đang gõ dở đổi liên tục,
   * và "4.000" (có dấu chấm) dễ đọc nhầm là "4" trong một số ngữ cảnh — số
   * trần rồi cũng KHÔNG đủ lớn (4000) để một dấu phân cách thật sự cần
   * thiết. `AgentConfigPanel.tsx` truyền `String(n)`, không `toLocaleString`.
   */
  'settings.ai.promptCounter': (count: string, max: string) => `${count} / ${max} ký tự`,
  'settings.ai.promptTooLong':
    'Lời nhắc dài hơn mức cho phép. Rút ngắn để lưu được — máy chủ sẽ từ chối bản dài hơn mức này dù bạn có bấm Lưu.',
  'settings.ai.toolsTitle': 'Công cụ agent được dùng',
  /* E4 của review tổng nhánh: `web_search` là một công tắc LUÔN HIỆN mà một
   * bản triển khai không có `BRAVE_API_KEY` KHÔNG BAO GIỜ chạy được. Người
   * học bật nó, lưu thành công, và không gì xảy ra — mãi mãi, không một
   * dòng chữ nào. `GET /ai/config` nay trả thêm `unavailable_tools`; hai
   * khoá dưới đây là nửa còn lại.
   *
   * Công tắc VẪN BẤM ĐƯỢC (không `disabled`): lựa chọn được lưu bền và sống
   * lâu hơn cái key còn thiếu — người vận hành đặt key, khởi động lại, và
   * mọi người học đã bật sẵn có nó ngay, không phải bấm lại. Nhãn phụ nói
   * đúng một điều: hôm nay bấm cũng không chạy. */
  'settings.ai.toolUnavailable': 'chưa bật trên máy chủ này',
  'settings.ai.toolsUnavailableNote':
    'Công cụ có nhãn "chưa bật trên máy chủ này" vẫn lưu được lựa chọn của bạn, nhưng máy chủ chưa được cấu hình để chạy nó — trợ lý sẽ bỏ qua cho tới khi quản trị viên bật.',
  'settings.ai.toolReadCourse': 'Đọc nội dung khoá học',
  'settings.ai.toolWebSearch': 'Tìm kiếm trên web',
  // Task 12 (Pha 3) — nhãn thứ ba cho `AgentConfigPanel.tsx`'s
  // `TOOL_LABEL_KEYS`, cùng hàng với hai khoá trên. `read_my_notes` bật
  // MẶC ĐỊNH (`ai.readsYourNotes` nói điều đó ở panel hỏi–đáp); công tắc ở
  // đây là nơi thật sự tắt được nó, và một nhãn tiếng Việt/Anh đọc được thay
  // vì tên kỹ thuật "read_my_notes" trần trụi đúng cho một tool BẬT SẴN từ
  // ngày đầu, không phải một tool người học tự bật.
  'settings.ai.toolReadMyNotes': 'Đọc tiến độ và ghi chú của bạn',
  'settings.ai.save': 'Lưu cấu hình',
  'settings.ai.saved': 'Đã lưu.',
  'settings.ai.saveUnknownTool': 'Một công cụ trong danh sách không còn tồn tại. Tải lại trang rồi thử lại.',
  'settings.ai.saveRejected': 'Máy chủ từ chối lưu cấu hình này. Thử lại sau một chút.',

  /* ══════════════════════════════════════════════════════════════════════ *
   * VỎ ỨNG DỤNG (`shell/`) — thanh bên, thanh trên, rail, lưới lỗi
   * ══════════════════════════════════════════════════════════════════════ */

  'app.name': 'Tự học',

  'nav.aria.main': 'Điều hướng chính',
  'nav.continue': 'Học tiếp',
  'nav.courses': 'Khoá học',
  'nav.progress': 'Tiến độ',
  'account.settings': 'Cài đặt',
  'nav.dashboard': 'Bảng điều khiển',
  'nav.library': 'Thư viện',
  /**
   * MỒ CÔI — không chỗ nào trong `apps/web/src` gọi khoá này (đo lại
   * 2026-08-29, review tổng nhánh Pha 2 mục F4).
   *
   * Chú thích trước ở đây khẳng định nó "còn sống" vì màn nhập gói "nay nằm
   * trong hộp thoại của `/courses`". Không có hộp thoại nào:
   * `pages/Courses.tsx`'s doc comment tự khai bằng nguyên văn "không tab,
   * không nút 'Nhập gói', không hộp thoại", và luồng import của người đọc
   * chết cùng `db.packages` ở Task 13. `courses.import.action` mà chú thích
   * ấy trỏ sang cũng mồ côi.
   *
   * KHÔNG XOÁ Ở ĐỢT NÀY, có chủ đích: đây là 2 trong ~168 khoá mồ côi mà
   * review đã đếm, phần lớn là tàn dư Pha 1, và `i18n.test.ts` chưa có cổng
   * bắt khoá mồ côi — nên xoá lẻ hai khoá vừa không đóng được lớp lỗi vừa
   * làm con số đã đo thành sai. Món nợ có tên nằm ở `docs/carried-forward.md`.
   * Thứ ĐƯỢC sửa ở đây là điều chú thích KHẲNG ĐỊNH, vì một khoá chết mang
   * nhãn "còn sống" là thứ lần sau có người dịch lại, hoặc dựng lại giao
   * diện quanh nó.
   */
  'nav.import': 'Nhập khóa học',

  'sidebar.searchPlaceholder': 'Tìm chương…',
  'sidebar.progressPlaceholder': 'Tiến độ sẽ hiện ở đây',
  'sidebar.noCourseLoaded': 'Chưa có khóa học nào được tải.',

  'topbar.menu': 'Mở menu',
  'topbar.searchPlaceholder': 'Tìm khoá, chương…',
  'topbar.searchOpen': 'Mở ô tìm kiếm',
  'topbar.searchClose': 'Đóng ô tìm kiếm',
  'topbar.searchSoon': 'Tìm kiếm chưa nối dây — sắp có.',
  'account.menuAria': 'Menu tài khoản',
  /** Cùng chữ với nhãn nút `#mark-btn` mà `reader/ChapterView.tsx` ghi đè. */
  'topbar.markRead': 'Đánh dấu đã học',
  'topbar.themeToLight': 'Chuyển sang giao diện sáng',
  'topbar.themeToDark': 'Chuyển sang giao diện tối',
  'topbar.prevChapter': 'Chương trước',
  'topbar.nextChapter': 'Chương sau',

  'rail.inChapter': 'Trong chương',
  'rail.empty': 'Chưa có nội dung.',

  'error.boundary.log': 'ErrorBoundary bắt được lỗi render:',
  'error.boundary.title': 'Màn hình này gặp lỗi',
  'error.boundary.body':
    'Phần còn lại của ứng dụng vẫn chạy. Tải lại trang thường là đủ; nếu lỗi lặp lại, nội dung dưới đây là thứ cần gửi kèm khi báo lỗi.',
  'error.boundary.reload': 'Tải lại trang',

  /* ══════════════════════════════════════════════════════════════════════ *
   * TRANG (`pages/`)
   * ══════════════════════════════════════════════════════════════════════ */

  /* ── chung ─────────────────────────────────────────────────────────────── */

  'course.loading': 'Đang tải khóa học…',
  'course.notFound': 'Không tìm thấy khóa học.',
  'course.parts.title': (n: string) => `Khoá này đi qua ${n} chặng`,
  'course.parts.hint': 'Chi tiết từng chương nằm ở mục lục bên trái.',
  'course.partCount': (read: string, total: string) => `${read}/${total}`,
  'chapter.notFound': 'Không tìm thấy chương này.',
  'chapter.notFoundInCourse': 'Không tìm thấy chương này trong khóa học.',

  /* ── học tiếp (`pages/Dashboard.tsx`) ──────────────────────────────────────
   *
   * Trang chủ KHÔNG còn là bảng số liệu. Mọi khoá `dashboard.stats.*`,
   * `dashboard.chart.*`, `dashboard.card.*` và `dashboard.ring.*` đã bị XOÁ
   * cùng lúc với phần giao diện đọc chúng: các con số chuyển sang `/progress`
   * (khối `progress.*` ngay dưới), và một khoá không ai đọc là thứ sẽ được
   * chép sang bản dịch thứ hai rồi trôi đi trong im lặng.
   */

  'home.title': 'Học tiếp',
  'home.lede': 'Chỗ bạn đang đọc dở, và những ghi chú gần đây.',
  'account.logout': 'Đăng xuất',
  'home.loading': 'Đang tìm chỗ bạn đọc dở…',
  'home.eyebrow': 'Đang đọc',
  'home.continue': 'Đọc tiếp',
  'home.start': 'Bắt đầu đọc',
  'home.reread': 'Đọc lại',
  'home.finished': 'Bạn đã đọc hết khoá này.',
  'home.chapters': (read: string, total: string) => `${read}/${total} chương đã đọc`,
  'home.chaptersUnknown': (read: string) => `${read} chương đã đọc`,
  'home.progressAria': (percent: string) => `${percent}% hoàn thành`,
  'home.notes.title': 'Ghi chú gần đây',
  'home.notes.loading': 'Đang tải ghi chú…',
  'home.notes.empty': 'Chưa có ghi chú nào. Bôi đen một đoạn khi đọc để ghi lại.',
  'home.notes.open': 'Mở chương',
  'home.notes.formula': 'công thức',
  'home.notes.aria': (course: string) => `Mở ghi chú này trong ${course}`,
  'toc.next': 'Tiếp theo',
  'toc.done': 'Đã đọc',

  /**
   * Trạng thái rỗng của Bảng điều khiển, sau khi luồng import chết.
   *
   * Bản trước dùng `<EmptyLibrary>` (`pages/Library.tsx`) — ba cách NHẬP một
   * gói. Nay không ai nhập gì nữa: mọi khoá học đã ở sẵn trên máy chủ, công
   * khai, đọc được ngay. Ruling S1-F17 ("trang chủ rỗng vẫn phải là một HÀNH
   * ĐỘNG") vẫn đúng nguyên vẹn — chỉ có hành động ấy đổi từ "nhập một gói"
   * thành "mở danh mục".
   */
  'home.empty.heading': 'Bạn chưa bắt đầu khoá nào',
  'home.empty.lede': 'Mọi khoá học đều đọc được ngay — không cần nhập gói, không cần chờ tải về.',
  'home.empty.cta': 'Xem danh mục khoá học',

  /* ── tiến độ (`pages/Progress.tsx`) ─────────────────────────────────────── */

  'progress.lede': 'Số liệu học tập của bạn, kể thành câu.',
  'progress.loading': 'Đang tải tiến độ…',
  'progress.error': 'Chưa lấy được tiến độ. Số liệu nằm trên máy chủ, nên phần này cần mạng.',
  /**
   * Task 6, Pha 3: `useProgress.ts`'s `toggleRead`/`toggleEx` giờ ghi lạc
   * quan lên `PUT /progress` — khi request đó hỏng, ô đã lật LÙI LẠI giá
   * trị cũ (không giữ một lời nói dối), và câu này là lời giải thích duy
   * nhất người học thấy, vẽ ngay cạnh nút vừa bấm (`reader/ChapterView.tsx`'s
   * `AuthedReaderExtras`, `role="alert"`) — không phải toast, kho này không
   * có hệ thống đó (xem `ErrorBoundary.tsx`/`AdminCredits.tsx` cho cùng quy
   * ước). Cùng tông "Chưa lưu được X." với `rating.error.unknown` ở trên.
   */
  'progress.saveFailed': 'Chưa lưu được tiến độ của bạn.',
  'progress.sentence': (minutes: string, streak: string) =>
    `Bạn đã học ${minutes} phút, với chuỗi ${streak} ngày liên tục.`,
  'progress.sentenceNoStreak': (minutes: string) =>
    `Bạn đã học ${minutes} phút. Chưa có chuỗi ngày nào đang chạy — học hôm nay là chuỗi bắt đầu lại.`,
  'progress.sentenceEmpty':
    'Chưa có phút học nào được ghi lại. Mở một chương và đọc; số liệu bắt đầu từ đó.',
  'progress.heat.title': 'Bảy tuần gần nhất',
  'progress.heat.aria': 'Lịch học cả năm, mỗi ô là một ngày',
  'progress.heat.cell': (date: string, minutes: string) => `${date}: ${minutes} phút`,
  'progress.year.title': (days: string, year: string) => `${days} ngày có học trong năm ${year}`,
  'progress.year.courses': 'Khoá học trong năm',
  'progress.year.noCourses': (year: string) => `Năm ${year} chưa có nhịp học nào được ghi lại.`,
  'progress.year.pickAria': 'Chọn năm',
  'progress.year.error': 'Chưa lấy được lịch của năm này.',
  'progress.heat.day': (date: string, minutes: string) => `${date}: ${minutes} phút`,
  'progress.heat.noData': (date: string) => `${date}: ngoài phạm vi số liệu máy chủ trả về`,
  'progress.heat.less': 'ít',
  'progress.heat.more': 'nhiều',
  'progress.byCourse': 'Theo khoá học',
  /**
   * fix-round-2 (task-14) — bản cũ nói "Nhập một gói ở mục Khoá học", một
   * hành động không còn tồn tại: `Courses.tsx` (đích của route `/courses`)
   * không còn nút "Nhập gói" nào (spec `2026-08-25-server-side-pivot.md`
   * §1). Tệ hơn một lời hứa sai — đây là một CHỈ DẪN sai, đưa người đọc tới
   * một màn hình để làm một việc không làm được ở đó.
   *
   * `Progress.tsx:161` nối chuỗi này với `{' '}` rồi một `<Link>` mang chữ
   * `nav.courses` ("Khoá học") ngay sau — nên câu ở đây CỐ Ý không lặp lại
   * "Khoá học" và không có dấu chấm cuối: nó dừng ngay trước từ mà cái Link
   * sẽ tự thêm vào, để cả hai đọc thành một câu liền mạch thay vì hai câu
   * chồng lên nhau ("...Khoá học. Khoá học" — điều bản cũ mắc phải).
   */
  'progress.noCourses': 'Chưa có khoá học nào để đo. Bắt đầu đọc ở mục',
  'progress.chaptersDone': (n: string) => `${n} chương đã đọc`,
  'progress.course.chapters': (read: string, total: string) => `${read}/${total} chương`,
  'progress.course.aria': (percent: string) => `${percent}% hoàn thành`,
  'progress.course.minutes': (minutes: string) => `${minutes} phút đã học`,

  /* ── đăng nhập (`pages/Login.tsx`) ─────────────────────────────────────── */

  /**
   * NỬA TRÁI — SẢN PHẨM TỰ GIỚI THIỆU.
   *
   * `/login` là màn hình đầu tiên của mọi người dùng mới, và trước đây nó là
   * một thẻ trôi giữa màn hình trống: người chưa có tài khoản đọc xong vẫn
   * không biết mình sắp đăng ký cái gì. Ba gạch đầu dòng dưới đây không phải
   * khẩu hiệu — mỗi câu tương ứng một tính chất mà mã trong repo này thật sự
   * giữ: khoá học đọc được ngay, miễn phí, không cần tài khoản (máy chủ phục
   * vụ mọi khoá học công khai — không còn gói nào để tải), trợ lý AI chạy
   * trên máy chủ của nền tảng và trả bằng credit (`internal/ai`,
   * `ai/serverClient.ts`) — không còn key riêng nào để người học tự giữ, tiến
   * độ và ghi chú đồng bộ qua tài khoản (`sync/engine.ts`).
   *
   * GẠCH ĐẦU DÒNG THỨ NHẤT VÀ THỨ BA ĐỔI Ở TASK 14 (spec
   * `2026-08-25-server-side-pivot.md` §0.2) — khoá cũng đổi tên
   * (`login.point.offline` → `login.point.free`, `login.point.private` →
   * `login.point.sync`) để chỗ nào còn trỏ khoá cũ nổ compile thay vì lặng lẽ
   * trống. Bản cũ hứa "gói nằm trên máy bạn, đọc ngoại tuyến" — đúng khi
   * course còn là một gói tải về cất trong `db/local.ts`; sai từ khi course
   * chuyển hẳn lên máy chủ, vì đọc mà mất mạng giờ là hỏng chứ không phải một
   * tính năng. Bullet thứ ba từng là "course riêng tư không lộ ra registry" —
   * khái niệm ấy cũng rời đi cùng registry riêng tư (`courses.lede` đã tự
   * khai "mọi khoá học đều công khai"), nên chỗ của nó nay là lời hứa đồng bộ.
   *
   * GẠCH ĐẦU DÒNG THỨ HAI (`login.point.ownKey`) VÀ CÂU LEDE ĐỔI Ở TASK 15
   * (bàn giao Pha 1 §2, cùng spec §0.1) — KHOÁ GIỮ NGUYÊN TÊN, chỉ đổi giá
   * trị: `ownKey` mô tả một TÍNH CHẤT ("có một trợ lý AI"), không phải cơ chế
   * đứng sau nó, nên tên khoá không sai theo cách buộc phải đổi tên như hai
   * khoá kia. Bản cũ hứa "trợ lý AI chạy bằng key của chính bạn, và key
   * không đi qua máy chủ của chúng tôi" — đúng khi kho khoá ở origin riêng
   * còn là đường DUY NHẤT gọi AI; sai từ khi `internal/ai` ship (Task 11) và
   * `useAI.ts` chuyển hẳn sang gọi máy chủ. `login.pitch.lede` mắc cùng lỗi ở
   * một câu phụ ("hỏi trợ lý AI bằng key của chính bạn") — sửa luôn ở đây,
   * cùng thời điểm, vì cùng một lời hứa chết theo cùng một sự kiện.
   */
  'login.pitch.headline': 'Khoá học mở cho mọi người.',
  'login.pitch.lede':
    'Mở một khoá học và đọc ngay — không cần cài đặt, không cần chờ tải. Bôi đen một đoạn để ghi chú thẳng lên trang, hoặc hỏi trợ lý AI ngay trong bài.',
  'login.pitch.aria': 'Tự học làm được gì',
  'login.point.free': 'Đọc toàn bộ giáo trình miễn phí — không cần tài khoản',
  'login.point.ownKey': 'Trợ lý AI chạy trên máy chủ của chúng tôi, trả bằng credit — không cần key của riêng bạn',
  'login.point.sync': 'Đăng nhập để tiến độ và ghi chú theo bạn trên mọi thiết bị',

  'login.title': 'Đăng nhập',
  'login.heading.login': 'Chào mừng trở lại',
  'login.heading.register': 'Tạo tài khoản',
  'login.lede': 'Tiến độ học đồng bộ giữa các máy của bạn.',
  'login.tablist.aria': 'Đăng nhập hoặc đăng ký',
  'login.tab.login': 'Đăng nhập',
  'login.tab.register': 'Đăng ký',
  'login.field.email': 'Email',
  'login.field.password': 'Mật khẩu',
  'login.field.emailPlaceholder': 'ban@vi-du.com',
  'login.password.show': 'Hiện mật khẩu',
  'login.password.hide': 'Ẩn mật khẩu',
  /**
   * fix-round-1 (task-14) — vòng đầu chỉ rút bản hai câu xuống còn một câu
   * ("đăng nhập chỉ để tiến độ và ghi chú theo bạn sang máy khác"), nhưng câu
   * còn lại vẫn là gần như NGUYÊN VĂN `login.point.sync` ("Đăng nhập để tiến
   * độ và ghi chú theo bạn trên mọi thiết bị") đứng cách đó vài dòng — chỗ
   * lặp chỉ chuyển từ "hai câu trùng nhau" sang "một câu trùng một bullet".
   *
   * SỬA THẬT ở vòng này: đổi góc nhìn thay vì rút gọn thêm. Panel bên trái đã
   * nói HẾT lợi ích của việc đăng nhập (tiến độ + ghi chú theo bạn); câu ở
   * đây không cần nói lại lợi ích ấy lần nữa, nó nói thứ panel bên trái không
   * nói: KHÔNG CÓ GÌ MẤT nếu chưa đăng nhập ngay bây giờ. Đây là câu trả lời
   * thật cho "tôi có phải quyết định ngay không" — và câu trả lời là không,
   * tài khoản tạo lúc nào cũng được.
   */
  'login.reassure': 'Không đăng nhập ngay cũng không mất gì — tạo tài khoản lúc nào cần thì tạo.',
  'login.switch.noAccount': 'Chưa có tài khoản?',
  'login.switch.hasAccount': 'Đã có tài khoản?',
  'login.switch.toRegister': 'Tạo tài khoản',
  'login.switch.toLogin': 'Đăng nhập',
  'login.field.name': 'Tên',
  'login.submit.loggingIn': 'Đang đăng nhập…',
  'login.submit.login': 'Đăng nhập',
  'login.submit.registering': 'Đang đăng ký…',
  'login.submit.register': 'Đăng ký',

  /* ── thư viện (`pages/Library.tsx`) ────────────────────────────────────── */

  /**
   * Nhãn NGUỒN. `registry` giữ nguyên ở cả hai ngôn ngữ có chủ ý: đó là tên
   * riêng của một hiện vật (kho course công khai), không phải một từ chung.
   */
  'library.source.registry': 'registry',
  'library.source.private': 'riêng tư',
  'library.source.import': 'tự nhập',
  'library.source.unknown': 'không rõ nguồn',

  /* ── màn Khoá học (`pages/Courses.tsx`) ────────────────────────────────
   *
   * MỘT danh mục công khai, không tab, không nút nhập — spec
   * `2026-08-25-server-side-pivot.md` §1, §2.4. Bản trước (hai tab, một nút
   * "Nhập gói", `courses.tabs.aria`/`courses.tab.*`/`courses.import.*`) đi
   * cùng luồng import của người đọc, nay đã chết; những khoá ấy ĐÃ BỊ XOÁ chứ
   * không để lại — một khoá mô tả một điều khiển không còn ai vẽ là thứ lần
   * sau có người dịch lại mà không biết nó chết rồi (task-13 report ghi rõ).
   * `courses.lede` đổi CÂU, không đổi TÊN KHOÁ: nó vẫn là câu dẫn của đúng
   * trang này, chỉ là trang ấy không còn "của bạn" lẫn "hai tab" để nói tới.
   */
  'courses.title': 'Khoá học',
  'courses.lede': 'Mọi khoá học, công khai. Chọn một khoá để bắt đầu đọc.',
  'courses.loading': 'Đang tải danh mục…',
  'courses.empty': 'Chưa có khoá học nào được xuất bản.',
  'courses.list.aria': 'Danh mục khoá học',
  /**
   * MỒ CÔI. Chú thích trước ở đây nói `pages/Library.tsx`'s `EmptyLibrary`
   * là "nơi DUY NHẤT còn dùng khoá này" và rằng nó "rời đi cùng
   * `pages/Library.tsx` ở một commit sau" — commit ấy đã xảy ra:
   * `pages/Library.tsx` KHÔNG còn tồn tại (đo lại 2026-08-29), và khoá thì
   * ở lại. Cùng lý do "không xoá lẻ" như `nav.import` bên trên.
   *
   * Mọi khoá `library.*` ngay dưới đây ở cùng tình trạng và cùng món nợ.
   */
  'courses.import.action': 'Nhập gói',
  'library.loading': 'Đang tải thư viện…',
  'library.empty.headingOffline': 'Chưa có khóa học nào trên thiết bị này',
  'library.empty.heading': 'Thư viện của bạn đang trống',
  'library.list.aria': 'Khóa học của bạn',
  'library.notice.server': (status: string) =>
    `Máy chủ có trả lời, nhưng báo lỗi (HTTP ${status}), nên thư viện trên máy chủ chưa tải được. Những khóa học đã lưu trên thiết bị này vẫn hiện ở dưới.`,
  'library.notice.offline':
    'Đang đọc bản lưu trên máy — máy chủ không trả lời một lần nào. Có thể bạn đang ngoại tuyến, hoặc máy chủ đang bị cấu hình sai (CORS/DNS): trình duyệt trả về đúng một lỗi trống cho cả hai, nên trang này không phân biệt được. Chỉ những khóa học đã lưu trên thiết bị này mới hiện ở dưới.',
  'library.meta.version': (version: string) => `phiên bản ${version}`,
  'library.meta.held': 'đã tải về máy',
  'library.meta.chapters': (read: string, total: string) => `${read}/${total} chương`,
  'library.update.available': (version: string) => `Có bản mới: v${version}`,
  'library.update.view': 'Xem thay đổi',
  'library.tier.contentTitle': 'Hạng content: chỉ HTML, CSS, hình ảnh và công thức toán — không có JavaScript.',
  'library.tier.interactiveTitle':
    'Hạng interactive (§1.2): khóa học này được phép chứa JavaScript, và mã đó chạy trong trình duyệt của bạn khi bạn đọc.',
  'library.tier.interactiveLabel': 'interactive — chạy mã JavaScript',
  'library.tier.unknownTitle': 'Gói này không khai báo hạng, nên không có gì bảo đảm nó không chứa JavaScript.',
  'library.tier.unknownLabel': 'hạng không rõ — có thể chạy mã',
  'library.emptyState.lede': (app: string) =>
    `${app} cố ý không đóng gói sẵn nội dung — bạn tự chọn thứ mình đọc. Bắt đầu bằng cách nhập một gói.`,
  'library.emptyState.wayFile': (zip: string) => `một tệp ${zip} trên máy bạn`,
  'library.emptyState.wayUrl': (zip: string) => `một đường dẫn tới tệp ${zip}`,
  'library.emptyState.wayRepo': 'một repo GitHub công khai',
  'library.emptyState.registry': 'Kho khoá học cộng đồng (registry) đang được xây dựng — khi có, nó sẽ hiện ngay ở đây.',

  /* ── nhập khóa học (`pages/ImportCourse.tsx`) ──────────────────────────── */

  'import.lede': (zip: string) =>
    `Một khóa học là một gói ${zip}. Sau khi nhập, gói nằm trên máy bạn và đọc được cả khi mất mạng.`,
  'import.way.file': 'Từ tệp trên máy',
  'import.way.filePick': 'Chọn gói .zip',
  'import.way.zipUrl': 'Từ một đường dẫn .zip',
  'import.way.zipUrlLabel': 'Đường dẫn tới tệp .zip',
  'import.way.zipUrlSubmit': 'Nhập từ đường dẫn',
  'import.way.repo': 'Từ repo GitHub công khai',
  'import.way.repoLabel': 'Đường dẫn repo',
  'import.way.repoSubmit': 'Nhập từ repo',
  /**
   * Câu về repo riêng tư có HAI thẻ nội tuyến ở giữa (`<strong>` và `<code>`),
   * nên nó đi qua `tNode`. Cắt nó thành ba khoá sẽ khoá cứng trật tự từ tiếng
   * Việt vào JSX.
   */
  'import.way.repoNote': (publicWord: string, zip: string) =>
    `Chỉ nhập được từ repo ${publicWord}. Repo riêng tư cần token truy cập, và tuhoc cố ý không giữ token của bạn. Nếu khóa học nằm trong repo riêng tư, hãy tải ${zip} của repo về máy rồi dùng “Từ tệp trên máy” ở trên — kết quả giống hệt.`,
  'import.way.repoNotePublic': 'công khai',
  'import.progress.files': (done: string, total: string) => ` ${done}/${total} tệp.`,
  'import.cancel': 'Huỷ',
  'import.cancelled': 'Đã huỷ nhập gói. Không có gì được lưu lại.',
  'import.done': (courseId: string, version: string) => `Đã nhập ${courseId} phiên bản ${version}. `,
  'import.done.open': 'Mở khóa học',
  'import.reroot': (folder: string, dropped: string) =>
    `Gói nằm trong thư mục ${folder} của tệp bạn chọn, nên tuhoc đã lấy thư mục đó làm gốc gói${dropped}.`,
  'import.reroot.dropped': (count: string) => ` và bỏ qua ${count} tệp nằm ngoài nó`,
  'import.failed.heading': 'Không nhập được gói này',
  'import.failed.one': 'Có một vấn đề cần sửa:',
  'import.failed.many': (count: string) => `Có ${count} vấn đề, liệt kê hết ở đây để bạn sửa một lượt:`,
  'import.stage.fetching': 'Đang tải gói…',
  'import.stage.unpacking': 'Đang giải nén…',
  'import.stage.checking': 'Đang kiểm tra nội dung gói…',
  'import.stage.saving': 'Đang lưu vào máy bạn…',

  /* ══════════════════════════════════════════════════════════════════════ *
   * TRANG ĐỌC (`reader/`) + GHI CHÚ (`annotations/`) + TRỢ LÝ AI (`ai/`)
   * ══════════════════════════════════════════════════════════════════════ */

  /* ── chương đang đọc (`reader/ChapterView.tsx`) ────────────────────────── */

  'reader.markUnread': 'Bỏ đánh dấu đã học',
  'reader.read': 'Đã học',
  'reader.kitFailed': 'Không tải được công cụ đọc (KaTeX/mô phỏng). Hãy thử tải lại trang.',
  'reader.chapterLoading': 'Đang tải chương…',
  'reader.askAi': 'Hỏi AI về chương này',
  'reader.askHeading': 'Hỏi về chương',
  'reader.prev': '← Chương trước',
  'reader.next': 'Chương sau →',
  /* `reader.railAria` đã rời đi cùng bộ tab của rãnh: nó là nhãn của
     `role="tablist"`, và chế độ đọc không còn tablist nào. Gỡ chứ không để lại
     — một khoá không ai gọi là một câu người dịch vẫn phải dịch. */
  'reader.notesTab': (count: string) => `Ghi chú (${count})`,
  'reader.exerciseCheckbox': (index: string) => `Đánh dấu đã làm bài tập ${index}`,
  'reader.exerciseDone': 'Đã làm',
  /* Chỉ hiện cho người đọc chưa đăng nhập ĐÃ ĐƯỢC XÁC NHẬN (GET /me → 401) —
     không phải mặc định trong lúc còn chờ /me trả lời, kẻo nó nháy lên cho cả
     người đã đăng nhập rồi mới biến mất. Xem `reader/ChapterView.tsx`. */
  'reader.anonNudge': 'Đăng nhập để lưu tiến độ, ghi chú và hỏi AI.',

  /* ── chế độ đọc: một cột chữ (`reader/TocDrawer.tsx`, hướng A) ──────────── */

  /* Nhãn NGẮN vì nó nằm trên thanh trên cạnh breadcrumb; câu đầy đủ ở `title`
     và `aria-label` của cùng nút ấy. */
  'reader.toc': 'Mục lục',
  'reader.tocOpen': 'Mở mục lục khoá học',
  'reader.tocClose': 'Đóng mục lục',
  'reader.tocAria': 'Mục lục khoá học',
  /* MỘT lối ra, không phải năm. Chữ hiện là "Thoát"; câu đầy đủ nói ra nó dẫn
     đi đâu, vì một nút tên "Thoát" không nói được điều đó. */
  'reader.exit': 'Thoát',
  'reader.exitAria': 'Thoát chế độ đọc — về Học tiếp',
  'reader.notesToggle': 'Hiện/ẩn ghi chú ở lề',
  'reader.tocEmpty': 'Khoá học này chưa có chương nào.',
  'reader.tocHeadingsEmpty': 'Chương này không có mục con.',

  /* ── thanh công cụ bôi chọn (`annotations/SelectionToolbar.tsx`) ───────── */

  'ann.color.yellow': 'Tô màu vàng',
  'ann.color.green': 'Tô màu xanh lá',
  'ann.color.blue': 'Tô màu xanh dương',
  'ann.color.purple': 'Tô màu tím',
  'ann.saveFailed': 'Không lưu được ghi chú. Hãy thử tô lại.',
  'ann.toolbarAria': 'Ghi chú đoạn đã chọn',
  'ann.note': 'Ghi chú',
  'ann.deepDive': 'Đào sâu',
  'ann.dismissAlert': 'Đóng thông báo',

  /**
   * Task 7, Pha 3: `useAnnotations.ts`'s `updateNote`/`remove`/`reattach` giờ
   * ghi lạc quan lên `PATCH`/`DELETE /annotations/:id` — trước Task 7, một
   * request hỏng ở BA chỗ này chỉ vào `console.error`, người học không hề
   * biết. Cache đã lùi lại giá trị cũ (đúng lẽ, không giữ một lời nói dối),
   * và câu này là lời giải thích duy nhất người học thấy, vẽ trong
   * `reader/ChapterView.tsx` (`role="alert"`) — cùng quy ước "một trường
   * cộng thêm, một chỗ vẽ" `progress.saveFailed` đã dùng ở Task 6. KHÁC với
   * `ann.saveFailed` ở trên: khoá đó là của `SelectionToolbar` khi TẠO ghi
   * chú (bôi chọn) hỏng, khoá này là khi SỬA/XOÁ/GẮN LẠI một ghi chú đã có
   * hỏng — hai sự kiện khác nhau, có thể cùng hiện một lúc, không sao.
   */
  'notes.saveFailed': 'Chưa lưu được ghi chú của bạn.',

  /* ── thẻ ghi chú bên lề (`annotations/MarginCards.tsx`) ────────────────── */

  'ann.card.collapsed': '▸ Đang thu gọn',
  'ann.card.offPage': '▸ Không hiện trên trang',
  'ann.card.emptyNote': '(chưa có nội dung)',
  'ann.card.editorAria': 'Nội dung ghi chú',
  'ann.card.delete': 'Xóa ghi chú',
  'ann.card.done': 'Xong',
  'ann.card.none': 'Chưa có ghi chú nào trong chương này.',
  'ann.card.sheetAria': 'Ghi chú',
  'ann.card.sheetClose': 'Đóng ghi chú',

  /* ── ghi chú mất neo (`annotations/OrphanPanel.tsx`) ───────────────────── */

  'ann.orphan.reattachFailed': 'Không gắn lại được. Hãy bôi chọn lại rồi thử lần nữa.',
  'ann.orphan.mathOnly':
    'Đoạn bạn chọn chỉ gồm công thức. Hãy chọn thêm chữ xung quanh để ghi chú tìm lại được chỗ này.',
  'ann.orphan.awayAria': 'Ghi chú chưa gắn lại được',
  'ann.orphan.awayBody': (count: string) =>
    `${count} ghi chú chưa gắn lại được. Mở chương này trên màn hình rộng hơn để nối lại.`,
  'ann.orphan.awayHide': 'Ẩn',
  'ann.orphan.heading': (count: string) => `Mồ côi (${count})`,
  'ann.orphan.lede':
    'Bản chương hiện tại không còn đoạn văn mà những ghi chú này neo vào. Nội dung ghi chú vẫn được giữ nguyên — bấm “Gắn lại” rồi bôi chọn đoạn tương ứng để nối lại.',
  'ann.orphan.waiting': 'Bôi chọn đoạn văn tương ứng trong chương, rồi bấm “Gắn vào đây”.',
  'ann.orphan.reattach': 'Gắn lại',
  'ann.orphan.showExact': 'Xem exact gốc',
  'ann.orphan.exactAria': 'Đoạn văn gốc của ghi chú',
  'ann.orphan.copy': 'Sao chép',
  'ann.orphan.barAria': 'Gắn lại ghi chú',
  'ann.orphan.barWhat': (quote: string) => `Gắn lại: ${quote}`,
  'ann.orphan.barHint': 'Bôi chọn đoạn văn mới trong chương.',
  'ann.orphan.barConfirm': 'Gắn vào đây',
  'ann.orphan.barCancel': 'Hủy',

  /* ── bảng hỏi AI (`ai/AskPanel.tsx`, `ai/DeepDive.tsx`, `ai/useAI.ts`) ─── */

  'ai.panel.close': 'Đóng trợ lý',
  'ai.panel.expand': 'Mở rộng khung hỏi–đáp',
  'ai.panel.resize': 'Kéo để đổi cỡ khung',
  'ai.panel.collapse': 'Thu khung hỏi–đáp',
  // KHÔNG còn "Hội thoại mới" (chữ Pha 1) — vòng review 1: máy chủ không nhớ
  // gì về bất kỳ lượt nào trước (xem `useAI.ts`'s doc comment), nên một nhãn
  // ngụ ý có một "hội thoại" mà nút này "làm mới" là nhận một sự liên tục
  // chưa từng có. Nó chỉ xoá thứ đang vẽ trên màn hình.
  'ai.panel.newThread': 'Xoá tất cả',
  'ai.panel.thinking': 'Đang nghĩ…',
  // THƯỜNG TRỰC, không gắn với lỗi nào — panel nói câu này TRƯỚC khi có gì
  // hỏng, vì nó đúng ngay cả ở câu hỏi ĐẦU TIÊN. Xem `useAI.ts`'s doc comment
  // cho lý do máy chủ không có trí nhớ giữa các lượt.
  'ai.panel.noMemory': 'Mỗi câu hỏi là một lượt riêng — trợ lý không nhớ những câu bạn đã hỏi trước đó.',
  // MẶC ĐỊNH BẬT, VÀ NGƯỜI HỌC PHẢI ĐƯỢC BÁO (task-12, Pha 3). `read_my_notes`
  // (công cụ phía máy chủ, `apps/api/internal/ai/tool_notes.go`) đọc tiến độ
  // và ghi chú của CHÍNH người đang hỏi cho course đang mở — migration 0010
  // bật nó cho MỌI tài khoản, kể cả những tài khoản đã tồn tại từ trước. Bật
  // mặc định là quyết định của chủ dự án; KHÔNG nói cho người học biết là một
  // quyết định khác mà không ai chọn — câu này, cộng đường dẫn sang Cài đặt
  // ngay sau nó trong `AskPanel.tsx`, là chỗ nói ra và chỗ tắt được.
  //
  // THƯỜNG TRỰC, cùng vị trí `ai.panel.noMemory` ngay trên: đúng ngay từ câu
  // hỏi đầu tiên, không đợi tool thật sự được gọi lượt nào.
  //
  // "cho khoá học này" LÚC RA MẮT LÀ SAI, và bản rà soát toàn nhánh (Quan
  // trọng 4) sửa MÃ chứ không sửa câu: trước đó slug của course là một
  // THAM SỐ DO MODEL CHỌN, còn course người học đang mở chỉ được nhắc như
  // lời khuyên trong prompt. Nay nó được buộc lúc dựng tool từ
  // Turn.CourseSlug và schema không còn tham số course nào — xem
  // `apps/api/internal/ai/tool_notes.go`, điều kiện 3 trong doc comment.
  'ai.readsYourNotes':
    'Gia sư có thể đọc tiến độ và ghi chú của bạn cho khoá học này để trả lời sát hơn.',
  // `ai.panel.noCredit` thay cho cặp Pha 1 `needsSetup`/`unavailable` (đã bỏ
  // — xem `git log` trên tệp này): Pha 2 không còn key cắm theo máy, và
  // không còn bản dựng nào thiếu route AI, nên cả hai trạng thái đó không
  // xảy ra được nữa. Trạng thái chặn duy nhất còn lại là hết credit nền
  // tảng cấp.
  //
  // BẢN TRƯỚC HỨA MỘT LỐI RA KHÔNG TỒN TẠI (review tổng nhánh Pha 2, E1):
  // nó bảo người học "nạp thêm trong trang cấu hình", và `/settings` không
  // có nút nạp, không form, không liên kết ra ngoài — `CreditPanel.tsx` chỉ
  // vẽ số dư cộng sổ dùng. Thanh toán là Pha 4 (spec §7); không có gì trong
  // mã sản phẩm hôm nay nhận tiền. Một câu chỉ đường tới một nút không tồn
  // tại tệ hơn hẳn một câu nói thẳng là chưa có đường: người học đi tới đó,
  // không thấy gì, rồi tự hỏi mình bỏ sót cái gì.
  //
  // Bản này nói ba điều theo đúng thứ tự người học cần: chuyện gì xảy ra,
  // vì sao họ không tự sửa được, và ai sửa được. "Chưa mở" chứ không phải
  // "không có" — nó SẼ mở ở Pha 4, và câu chữ không nên nói dối theo chiều
  // ngược lại.
  'ai.panel.noCredit':
    'Tài khoản đã hết credit AI. Nền tảng chưa mở thanh toán nên bạn chưa tự nạp được — liên hệ quản trị viên để được cấp thêm.',
  // NÚT VẪN Ở LẠI, và nhãn đổi để nói đúng thứ nó dẫn tới. `/settings` mục
  // Trợ lý AI không nạp được credit, nhưng nó vẫn trả lời đúng câu hỏi kế
  // tiếp của một người vừa hết tiền: đã tiêu bao nhiêu, vào những lượt nào
  // (`CreditPanel.tsx`'s số dư + sổ dùng gần đây). Nhãn cũ "Mở trang cấu
  // hình" mượn nghĩa từ câu hứa nạp tiền ở trên; bỏ câu ấy đi thì nhãn phải
  // tự đứng được.
  'ai.panel.openSettings': 'Xem số dư và sổ dùng',
  'ai.panel.questionLabel': 'Câu hỏi của bạn',
  'ai.panel.questionPlaceholder': 'Hỏi về chương đang đọc…',
  'ai.panel.stop': 'Dừng',
  'ai.panel.ask': 'Hỏi',
  'ai.deepDive.heading': 'Đào sâu',
  // Mười khoá dưới đây ứng với mười `ServerAIErrorCode` (`ai/serverClient.
  // ts`) — xem `useAI.ts`'s `describeFailure` cho quy tắc "mã nào dịch ra
  // câu nào", và VÌ SAO không câu nào ở đây là chuỗi thô máy chủ gửi.
  // Cùng lý do E1 với `ai.panel.noCredit` ở trên, và cố ý NGẮN HƠN: câu này
  // vẽ ở dòng lỗi của một lượt, cạnh khối lời mời đầy đủ, không thay nó.
  'ai.error.noCredit': 'Bạn đã dùng hết credit AI. Thanh toán chưa mở — liên hệ quản trị viên để được cấp thêm.',
  'ai.error.rateLimited': 'Bạn đang hỏi hơi nhanh — chờ một chút rồi thử lại.',
  'ai.error.providerFailed': 'Nhà cung cấp AI không hoàn tất được lượt này. Thử lại sau một chút.',
  'ai.error.toolBudgetExhausted':
    'Câu hỏi này cần nhiều bước tra cứu hơn mức lượt này cho phép. Hãy hỏi cụ thể hơn, hoặc tắt bớt một công cụ.',
  'ai.error.unauthenticated': 'Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục hỏi.',
  // Câu RIÊNG, kéo RA khỏi xô gộp bên dưới (vòng review 1): khác
  // Internal/InvalidBody/…, người học (hoặc ngữ cảnh chương ngắn hơn) THẬT
  // SỰ sửa được mã này bằng cách hỏi ngắn hơn.
  'ai.error.fieldTooLong': 'Câu hỏi của bạn quá dài, kể cả ngữ cảnh đang đọc. Hỏi ngắn hơn, hoặc bôi đen ít chữ hơn.',
  'ai.error.network': 'Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.',
  'ai.error.aborted': 'Đã huỷ.',
  // Chung cho `InvalidBody`/`FieldRequired`/`UnknownTool`/`Internal` — bốn
  // mã báo lỗi ở chính trang chính hoặc máy chủ, không phải điều người học
  // gây ra hay có một hành động cụ thể để sửa.
  'ai.error.requestRejected': 'Yêu cầu bị từ chối. Thử lại sau một chút.',

  /* ── LỜI NHẮC gửi cho mô hình (`ai/prompts.ts`) ────────────────────────── */

  /**
   * ĐÂY LÀ CHỖ SONG NGỮ CÓ HỆ QUẢ THẬT, không chỉ là chữ trên nút: câu vai
   * dưới đây bảo mô hình *trả lời bằng ngôn ngữ nào*. Một người đọc đã chọn
   * tiếng Anh mà vẫn nhận câu trả lời tiếng Việt thì bộ chọn ngôn ngữ chỉ đổi
   * được phần vỏ.
   *
   * `chapterSystemPrompt`/`deepDiveSystemPrompt` vì thế nhận `lang` như một
   * trường BẮT BUỘC — không có mặc định lặng lẽ, nên `tsc` bắt mọi chỗ gọi tự
   * nói ra nó đang hỏi hộ ai.
   */
  'ai.prompt.chapterRole': (cutMark: string) =>
    `Bạn là trợ giảng của một giáo trình tự học. Chỉ trả lời dựa trên phần chương được trích dưới đây. Phần trích có thể đã bị cắt bớt (dấu ${cutMark}); nếu câu hỏi rơi vào phần không có ở đây, hãy nói thẳng điều đó và chỉ tới mục tương ứng trong dàn ý thay vì đoán. Trả lời bằng tiếng Việt, ngắn gọn, và viết công thức bằng LaTeX trong $…$.`,
  'ai.prompt.deepDiveRole':
    'Bạn là trợ giảng của một giáo trình tự học. Người học vừa bôi đen một đoạn và muốn hiểu sâu hơn đúng đoạn ấy. Giải thích ý đoạn đó, vì sao nó đúng, và một ví dụ cụ thể. Trả lời bằng tiếng Việt, ngắn gọn, và viết công thức bằng LaTeX trong $…$.',
  'ai.prompt.field.course': 'KHOÁ HỌC',
  'ai.prompt.field.chapter': 'CHƯƠNG',
  'ai.prompt.field.outline': 'DÀN Ý CÁC MỤC',
  'ai.prompt.field.excerpt': 'TRÍCH CHƯƠNG',
  'ai.prompt.field.before': 'VĂN CẢNH TRƯỚC',
  'ai.prompt.field.selection': 'ĐOẠN ĐƯỢC CHỌN',
  'ai.prompt.field.after': 'VĂN CẢNH SAU',
  'ai.prompt.deepDiveQuestion': 'Giải thích kỹ đoạn này giúp tôi.',

  /* ── hộp thoại cập nhật gói (`course/UpdateDialog.tsx`) ────────────────── */

  'update.error.courseKit':
    'Chưa xem trước được: không tải được bộ dựng chương (công thức toán). Hãy kiểm tra kết nối rồi thử lại.',
  'update.error.unsafe': (version: string, findings: string) =>
    `Không thể cập nhật: bản ${version} chứa mã chạy được, điều không khóa học nào được phép. ${findings}`,
  'update.error.versionUnavailable': (version: string) =>
    `Chưa xem trước được: không lấy được bản ${version} của khoá học này.`,
  'update.summary.exact': (exact: string, total: string) => `${exact}/${total} ghi chú giữ đúng chỗ`,
  'update.summary.fuzzy': (count: string) => `${count} dịch nhẹ`,
  'update.summary.orphaned': (count: string) => `${count} mất neo`,
  'update.title': (courseTitle: string) => `Cập nhật “${courseTitle}”`,
  'update.previewing': 'Đang thử neo lại ghi chú của bạn trên bản mới…',
  'update.noNotes': 'Bạn chưa có ghi chú nào trong khoá học này, nên cập nhật không ảnh hưởng gì.',
  'update.alreadyLost': (count: string, fromVersion: string) =>
    `Trong đó ${count} ghi chú vốn đã mất neo từ trước — ở lại v${fromVersion} cũng không cứu được.`,
  'update.orphansKept': (notDeleted: string) =>
    `Ghi chú mất neo ${notDeleted}. Chúng vào mục “chưa gắn lại được” trong chương, còn nguyên từng chữ, để bạn nối lại bằng tay.`,
  'update.orphansKept.notDeleted': 'không bị xoá',
  'update.applying': 'Đang cập nhật…',
  'update.confirm': 'Cập nhật',
  'update.stay': (fromVersion: string) => `Ở lại v${fromVersion}`,

  /* ══════════════════════════════════════════════════════════════════════ *
   * CHUỖI LỖI — `course/import.ts`, `course/loader.ts`, `api/client.ts`,
   * `registry/`, `course/UpdateDialog.tsx`
   * ══════════════════════════════════════════════════════════════════════ */

  /* ── một phát hiện của bộ kiểm định gói, thành CÂU (`describeFinding`) ── */

  /**
   * MỘT KHOÁ CHO MỖI MÃ PHÁT HIỆN. `course/import.ts` giữ bảng `code → khoá`,
   * và `import.test.ts` đi hết `FINDING_CODES` + `IMPORT_FINDING_CODES` rồi đỏ
   * ở bất kỳ mã nào không có mục — nên một mã mới không thể lặng lẽ rơi xuống
   * câu "chưa được mô tả".
   *
   * Hai tham số của `finding.tooLarge`/`finding.manifestMissing` là HẰNG SỐ của
   * mã (trần MB, tên tệp manifest), không phải chữ — chúng đi qua tham số để
   * bản dịch đặt chúng ở đúng chỗ của ngữ pháp từng thứ tiếng.
   */
  'finding.undescribed': (where: string, detail: string) => `Gói có một vấn đề chưa được mô tả${where}: ${detail}`,
  'finding.EMPTY_PACKAGE': 'Gói này rỗng — không có tệp nào bên trong.',
  'finding.TOO_LARGE': (mb: string) => `Gói vượt trần ${mb} MB sau khi giải nén.`,
  'finding.PATH_ESCAPE': 'Một tệp trong gói trỏ ra ngoài thư mục gói. Gói này không an toàn để mở.',
  'finding.MANIFEST_MISSING': (manifest: string) => `Gói thiếu ${manifest} ở thư mục gốc — đó là tệp mô tả khóa học.`,
  'finding.MANIFEST_PARSE': (manifest: string) => `${manifest} không phải JSON hợp lệ.`,
  'finding.MANIFEST_FIELD': (manifest: string) => `${manifest} thiếu một trường bắt buộc hoặc trường đó sai kiểu.`,
  'finding.TIER_REMOVED':
    'Manifest của khóa học này còn trường "tier" — định dạng mới đã bỏ khái niệm "hạng". Hãy xoá trường đó khỏi manifest.json; phần tương tác giờ là một widget riêng, không còn khai qua "tier".',
  'finding.SEMVER': 'Số phiên bản của khóa học không đúng dạng X.Y.Z.',
  'finding.RUNTIME_RANGE': 'Khóa học yêu cầu một phiên bản runtime mà ứng dụng này không hỗ trợ.',
  'finding.DUPLICATE_CHAPTER_ID': 'Hai chương dùng chung một mã id.',
  'finding.CHAPTER_FILE_MISSING': 'Mục lục nhắc tới một tệp chương không có trong gói.',
  'finding.SCRIPT_TAG':
    'Chương này chứa thẻ <script>. Không khóa học nào được chứa mã chạy được — phần tương tác chỉ sống trong widget, chạy trong khung sandbox riêng.',
  'finding.EVENT_HANDLER_ATTR':
    'Chương này có thuộc tính bắt sự kiện (onclick, onerror…), tức là mã chạy được. Không khóa học nào được chứa mã chạy được — phần tương tác chỉ sống trong widget, chạy trong khung sandbox riêng.',
  'finding.JAVASCRIPT_URL':
    'Chương này có liên kết javascript:, tức là mã chạy được. Không khóa học nào được chứa mã chạy được — phần tương tác chỉ sống trong widget, chạy trong khung sandbox riêng.',
  'finding.EMBEDDED_FRAME':
    'Chương này nhúng một trang khác (iframe/embed/object). Không khóa học nào được chứa mã chạy được — phần tương tác chỉ sống trong widget, chạy trong khung sandbox riêng.',
  'finding.FORM_TAG':
    'Chương này có biểu mẫu <form> — biểu mẫu gửi dữ liệu đi nơi khác. Không khóa học nào được chứa mã chạy được — phần tương tác chỉ sống trong widget, chạy trong khung sandbox riêng.',
  'finding.JS_FILE_IN_PACKAGE':
    'Gói chứa một tệp JavaScript rời. Không khóa học nào được chứa mã chạy được — phần tương tác chỉ sống trong widget, chạy trong khung sandbox riêng.',
  'finding.TAG_ATTR_FLOOD': 'Một thẻ HTML trong gói mang quá nhiều thuộc tính để có thể là một tài liệu thật.',
  'finding.WIDGET_TOO_LARGE':
    'Một widget trong khóa học này nặng hơn mức cho phép. Hãy cắt bớt nội dung của widget, hoặc tách phần nặng (ảnh, dữ liệu) ra khỏi nó.',
  'finding.WIDGET_LINE_TOO_LONG':
    'Mã của một widget có một dòng quá dài — thường là dấu hiệu mã đã bị minify hoặc bị dồn hết vào một dòng. Hãy viết lại thành nhiều dòng bình thường.',
  'finding.WIDGET_BAD_NAME':
    'Tên của một widget không hợp lệ. Tên widget chỉ được dùng chữ thường, số và dấu gạch ngang, và không được quá dài.',
  'finding.WIDGET_FORBIDDEN_API':
    'Một widget trong khóa học này dùng cookie hoặc bộ nhớ của trình duyệt (localStorage…) — thứ một widget không có quyền chạm tới. Hãy bỏ phần mã đó đi.',
  'finding.WIDGET_EXTERNAL_URL':
    'Một widget trong khóa học này tải một thứ gì đó từ mạng. Widget phải tự chứa hoàn toàn — hãy bỏ đường dẫn đó đi, kể cả khi nó chỉ nằm trong chú thích.',
  'finding.WIDGET_EXTRA_FILE':
    'Một widget trong khóa học này mang nhiều hơn một tệp. Một widget chỉ được có đúng một tệp — hãy gộp phần còn lại vào đó, hoặc xoá đi.',
  'finding.WIDGET_MISSING':
    'Một chương nhắc tới một widget mà khóa học không có. Hãy kiểm tra lại tên widget, hoặc thêm widget đó vào gói.',
  'finding.WIDGET_ORPHAN':
    'Khóa học này mang một widget mà không chương nào dùng tới. Hãy xoá widget đó nếu không còn cần, hoặc thêm nó vào chương cần nó.',
  'finding.BAD_URL': 'Đường dẫn này không dùng được.',
  'finding.FETCH_FAILED': 'Không tải được.',
  'finding.FILE_READ_FAILED': 'Không đọc được tệp bạn chọn.',
  'finding.HTTP_ERROR': 'Máy chủ từ chối yêu cầu.',
  'finding.NOT_A_ZIP':
    'Tệp này không phải là một tệp .zip đọc được. Hãy chắc rằng bạn chọn đúng gói .zip của khóa học.',
  'finding.ZIP64_UNSUPPORTED': 'Tệp .zip này dùng một phần của định dạng zip64 mà tuhoc chưa đọc được.',
  'finding.ARCHIVE_INDEX_MISMATCH':
    'Gói này chứa tệp nén lồng nhau (một .zip bên trong — .docx, .xlsx và .pptx đều là .zip), nên mục lục của kho và dòng byte của nó không khớp nhau.',
  'finding.DUPLICATE_ENTRY': 'Trong gói có hai tệp trùng tên nhau, nên không biết tệp nào mới là thật.',
  'finding.PACKAGE_ROOT_AMBIGUOUS': 'Không rõ khóa học nào trong tệp này là khóa học bạn muốn nhập.',
  'finding.UNPACKABLE_ENTRY': 'Repo có mục không đóng gói được.',
  'finding.GIT_HOST_UNSUPPORTED': 'tuhoc chỉ nhập trực tiếp được từ GitHub.',
  'finding.GIT_REPO_UNREACHABLE': 'Không mở được repo này.',
  'finding.GIT_PATH_NOT_FOUND': 'Repo mở được, nhưng không tìm thấy thư mục bạn trỏ tới.',
  'finding.GIT_RATE_LIMITED': 'GitHub đang tạm chặn vì có quá nhiều yêu cầu từ mạng của bạn.',
  'finding.GIT_BAD_RESPONSE': 'Câu trả lời nhận được không phải của GitHub.',
  'finding.GIT_TREE_TRUNCATED':
    'Repo này quá lớn để đọc hết danh sách tệp trong một lần. Hãy tải .zip của repo về máy rồi nhập từ tệp.',
  'finding.GIT_TOO_MANY_FILES': 'Repo này có quá nhiều tệp để nhập trực tiếp.',
  'finding.WRITE_FAILED': 'Không lưu được gói vào bộ nhớ của trình duyệt.',
  'finding.CANCELLED': 'Đã huỷ nhập gói. Không có gì được lưu lại.',
  'finding.UNEXPECTED':
    'Có lỗi ngoài dự kiến khi nhập gói. Hãy thử lại; nếu vẫn vậy, đây là chi tiết kỹ thuật để báo lỗi:',

  /* ── phần `detail` do chính `course/import.ts` dựng ────────────────────── */

  'import.detail.manyRoots': (count: string, roots: string) =>
    `tệp này chứa ${count} khóa học (${roots}); hãy nhập từng gói một.`,
  'import.detail.httpStatus': (status: string) => `Máy chủ trả về HTTP ${status}.`,
  'import.detail.fetchFailed': (cause: string) =>
    `Có thể bạn đang ngoại tuyến, hoặc máy chủ chứa tệp không cho phép trang khác tải trực tiếp (CORS). Trình duyệt không cho biết là trường hợp nào. (${cause})`,
  'import.detail.bodyCutOff': (cause: string) =>
    `Máy chủ đã bắt đầu gửi tệp rồi kết nối đứt giữa chừng, nên gói tải về không đầy đủ. Hãy thử lại — thường lần sau là được. (${cause})`,
  'import.detail.privateRepo':
    'tuhoc chỉ nhập được từ repo Git CÔNG KHAI. Repo riêng tư cần token truy cập, và tuhoc cố ý không giữ token của bạn — nếu khóa học nằm trong repo riêng tư, hãy tải .zip của repo về máy rồi dùng "Từ tệp trên máy". Kết quả giống hệt. GitHub trả cùng một câu trả lời cho repo riêng tư và repo không tồn tại, nên cũng hãy kiểm tra lại đường dẫn.',
  'import.detail.rateLimited': 'Hãy thử lại sau ít phút, hoặc tải .zip của repo về máy rồi nhập từ tệp.',
  'import.detail.githubStatus': (status: string) => `GitHub trả về HTTP ${status}.`,
  'import.detail.captivePortal': (cause: string) =>
    `Máy chủ trả về nội dung không đọc được ở chỗ đáng lẽ là dữ liệu của GitHub. Nếu bạn đang dùng Wi-Fi công cộng, có thể mạng đó đang chặn bằng một trang đăng nhập — hãy đăng nhập vào mạng rồi thử lại. (${cause})`,
  'import.detail.subdirMissing': (ref: string, subdir: string) =>
    `Repo mở được, nhưng trong nhánh "${ref}" không có thư mục "${subdir}". Hãy kiểm tra lại đường dẫn.`,
  'import.detail.unpackable': (count: string) =>
    `${count} mục là symlink hoặc submodule; gói course chỉ chứa tệp thường. Nếu bạn không sửa được repo này, hãy tải .zip của nó về máy rồi dùng "Từ tệp trên máy".`,
  'import.detail.tooManyFiles': (count: string, cap: string) =>
    `${count} tệp, trần là ${cap}. Hãy tải .zip của repo về máy rồi nhập từ tệp.`,
  'import.detail.repoDeclaredBytes': (bytes: string) => `Repo khai báo ${bytes} byte.`,
  'import.detail.nestedArchive':
    'tuhoc đòi mục lục và dòng byte của kho khớp nhau từng tên — đó là hàng rào chặn kho "hai mặt", loại kho mà trình quét đọc ra một đằng còn trình giải nén đọc ra một nẻo. Hãy bỏ các tệp nén ra khỏi gói (hoặc nén chúng lại thành thư mục thường), rồi đóng gói bằng `tuhoc pack`.',
  'import.detail.zip64':
    'Kho zip64 thông thường thì tuhoc đọc được; kho này dùng phần mà tuhoc từ chối đoán — quá 65.535 mục, mục lục nằm quá mốc 4 GiB, hoặc bản ghi zip64 phiên bản 2. Hãy đóng gói bằng `tuhoc pack`.',
  'import.detail.bytesRead': (bytes: string) => `Đã đọc ${bytes} byte thì dừng.`,
  'import.detail.otherHost':
    'Với mọi nơi khác, hãy tải .zip của kho về máy rồi dùng "Từ tệp trên máy" — kết quả giống hệt.',
  'import.detail.fileGone': (cause: string) =>
    `Tệp có thể đã bị di chuyển, bị đổi, hoặc ổ đĩa chứa nó đã tháo ra sau khi bạn chọn. Hãy chọn lại tệp. (${cause})`,
  'import.detail.schemeOnly': 'Chỉ nhận đường dẫn bắt đầu bằng http:// hoặc https://.',
  'import.detail.parenthetical': (cause: string) => `(${cause})`,

  /* ── tải khoá học (`course/loader.ts`) ─────────────────────────────────── */

  'course.error.runtimeMismatch': (required: string, got: string) =>
    `Không tải được khóa học: phiên bản không tương thích (ứng dụng cần ${required}, khóa học khai báo "${got}").`,
  'course.error.notFound': 'Không tải được khóa học: không tìm thấy trên máy chủ.',
  'course.error.http': (status: string) => `Không tải được khóa học: máy chủ báo lỗi (HTTP ${status}).`,
  'course.error.parse': 'Không tải được khóa học: dữ liệu khóa học bị lỗi định dạng.',
  'course.error.missingAsset':
    'Không tải được khóa học: gói đã lưu trên máy thiếu tệp của chương này. Hãy nhập lại gói.',
  'course.error.unknown': 'Không tải được khóa học: đã xảy ra lỗi không xác định.',

  /* ── đăng nhập / mạng (`api/client.ts`) ────────────────────────────────── */

  'auth.error.badRequest': 'Yêu cầu không hợp lệ. Vui lòng kiểm tra lại thông tin đã nhập.',
  'auth.error.credentials': 'Email hoặc mật khẩu không đúng.',
  'auth.error.emailTaken': 'Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.',
  'auth.error.tooManyAttempts': 'Bạn đã thử quá nhiều lần. Vui lòng đợi một chút rồi thử lại.',
  'auth.error.serverDown': 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.',
  'auth.error.unknown': 'Đã xảy ra lỗi không xác định. Vui lòng thử lại.',
  'auth.error.unreachable':
    'Không thể kết nối tới máy chủ. Có thể bạn đang ngoại tuyến, hoặc máy chủ đang bị cấu hình sai (CORS/DNS).',
  // Task 11 (Pha 3): màn hình `<RequireAuth>` hiện ra khi KHÔNG có phản hồi
  // nào tới cho `GET /me` — không phải một lỗi máy chủ đã trả lời (đã có
  // `auth.error.unreachable` ở trên cho ca đó), mà là "trang này cần mạng để
  // mở, và máy không biết bạn còn phiên hay không". Từ khoá riêng vì màn hình
  // này không phải một lỗi ĐĂNG NHẬP — người xem nó có thể đã đăng nhập, chỉ
  // là máy không hỏi lại được máy chủ để xác nhận.
  'auth.needsNetwork': 'Cần có kết nối mạng để mở trang này. Vui lòng kiểm tra kết nối rồi thử lại.',

  /* ── danh mục registry (`registry/`) ───────────────────────────────────── */

  'registry.error.notConfigured':
    'Chưa có địa chỉ registry. Đặt biến môi trường VITE_REGISTRY_URL (địa chỉ gốc của registry, ví dụ https://<tổ-chức>.github.io/<repo>) lúc build, hoặc dùng registry công khai khi nó sẵn sàng.',
  'registry.error.unsupportedSchema': (found: string, supported: string) =>
    `Danh mục registry dùng định dạng phiên bản ${found}, còn bản tuhoc bạn đang chạy chỉ đọc được phiên bản ${supported}. Nền tảng cần được cập nhật. Danh mục KHÔNG được đọc thử — đọc một định dạng lạ theo phỏng đoán là cách sai lặng lẽ nhất.`,
  'registry.error.notJson': (contentType: string) =>
    `Địa chỉ registry trả về một trang web chứ không phải danh mục: thân phản hồi của index.json không phải JSON${contentType}. Thường là do địa chỉ registry sai, hoặc máy chủ trả trang 404 của chính nó thay cho tệp.`,
  'registry.error.malformed': (missing: string) =>
    `Danh mục registry đọc được nhưng thiếu hoặc sai kiểu ở: ${missing}. Đây là lỗi ở phía registry, không phải ở máy bạn.`,
  'registry.error.http': (status: string) =>
    `Registry trả mã ${status} cho index.json. Địa chỉ registry có thể sai, hoặc registry đang gặp sự cố.`,
  'registry.error.unreachable':
    'Không tải được danh mục registry. Có thể bạn đang ngoại tuyến, hoặc registry đang bị cấu hình sai (CORS/DNS).',

  'catalog.title': 'Danh mục khóa học',
  'catalog.lede': 'Kho khóa học cộng đồng. Mỗi gói ở đây đã đi qua đúng bộ luật kiểm định mà nền tảng dùng.',
  'catalog.loading': 'Đang tải danh mục…',
  'catalog.empty': 'Registry chưa có khóa học nào. Danh mục tải được bình thường — nó rỗng.',
  'catalog.listAria': 'Khóa học trên registry',
  'catalog.versionCount': (count: string) => `${count} bản`,

  /* ── HC-3: lọc theo ngôn ngữ ───────────────────────────────────────────
   *
   * `lang` của một course là một NHÃN TỰ DO lấy từ manifest — course viết
   * bằng ngôn ngữ nào cũng được, và `registry/types.ts` ghi rõ *"Nothing
   * translates on it"*. Nên chỉ CHỮ QUANH bộ lọc nằm ở đây; bản thân nhãn
   * (`vi`, `en`, `fr`, …) được vẽ nguyên văn như registry khai.
   */
  'catalog.filter.lang': 'Ngôn ngữ của khóa học',
  'catalog.filter.allLangs': 'Tất cả ngôn ngữ',
  'catalog.filter.count': (shown: string, total: string) => `Đang hiện ${shown} trong ${total} khóa học.`,

  /* ── HC-3: kéo về ──────────────────────────────────────────────────────── */

  'catalog.pull.action': 'Kéo về thư viện',
  'catalog.pull.busy': (title: string) => `Đang kéo ${title} về…`,
  'catalog.pull.done': (title: string, version: string) => `Đã kéo ${title} phiên bản ${version} về thiết bị này. `,
  'catalog.pull.open': 'Mở khóa học',
  'catalog.pull.failed': (title: string) => `Không kéo được ${title} về:`,

  /* ── hệ thống con 4: CHẤM SAO (`registry/Rating.tsx`) ──────────────────
   *
   * Ô chấm sao CHỈ xuất hiện cho course trên registry. Đó là một hàng rào
   * riêng tư, có cổng ở `registry/ratingFence.test.tsx`, không phải một quy
   * ước đặt chỗ — nên không khoá nào ở đây được dùng lại cho thư viện riêng.
   */

  'rating.yourVote': 'Đánh giá của bạn',
  'rating.star': (stars: number) => `${stars} sao`,
  /**
   * TRUNG BÌNH ĐI KÈM SỐ PHIẾU, luôn luôn. 5,0 từ một phiếu và 5,0 từ hai
   * trăm phiếu là cùng một con số và KHÔNG cùng một thông tin —
   * `ratingResponse` phía Go viết đúng câu ấy ở chỗ khai báo của nó.
   *
   * Dấu thập phân nằm TRONG BẢN DỊCH chứ không ở chỗ gọi: tiếng Việt viết
   * `4,5`, tiếng Anh viết `4.5`. Một `toFixed(1)` ở `Rating.tsx` sẽ ghim dấu
   * chấm cho cả hai ngôn ngữ, và không cổng nào trong repo bắt được điều đó.
   */
  'rating.summary': (average: number, count: number) =>
    `${average.toFixed(1).replace('.', ',')}/5 · ${count} phiếu`,
  'rating.none': 'Chưa có phiếu nào',
  'rating.saving': 'Đang lưu điểm…',
  'rating.saved': 'Đã lưu điểm của bạn.',
  'rating.error.rejected': 'Máy chủ không nhận điểm này. Điểm phải là một số sao từ 1 đến 5.',
  /**
   * 507 có CÂU RIÊNG vì nó là lỗi duy nhất người đọc tự xử lý được: tài
   * khoản đã chấm quá nhiều khóa học (trần của tầng Go, tồn tại vì
   * `registry_id` không có khoá ngoại và không thể có). Một câu chung sẽ đẩy
   * họ đi báo một lỗi không phải lỗi.
   */
  'rating.error.tooMany':
    'Bạn đã chấm quá nhiều khóa học nên không thêm được nữa. Sửa điểm của một khóa đã chấm thì vẫn được.',
  'rating.error.serverDown': 'Máy chủ đang gặp sự cố nên chưa lưu được điểm. Thử lại sau ít phút.',
  'rating.error.unknown': 'Chưa lưu được điểm của bạn.',
  'rating.error.unreachable':
    'Không gửi được điểm đi. Có thể bạn đang ngoại tuyến, hoặc bản tuhoc này chạy không kèm máy chủ.',

  /* ── hệ thống con 4: THẢO LUẬN (`registry/Discussion.tsx`) ──────────────
   *
   * `reason` trên dây là một TỪ VỰNG ĐÓNG (`""`/`disabled`/`unavailable`/
   * `rate_limited`) chứ không phải câu chữ — máy chủ cố ý không nói tiếng
   * Việt, để câu người đọc thấy nằm ở đây và dịch được. Bốn mã, bốn câu
   * KHÁC NHAU: gộp chúng lại là nói với người đọc rằng ba nguyên nhân khác
   * hẳn nhau đều là "lỗi".
   */

  'discuss.toggle': 'Thảo luận',
  'discuss.loading': 'Đang tải thảo luận…',
  'discuss.empty': 'Chưa có bình luận nào cho khóa học này.',
  'discuss.postOnGitHub': 'Đăng bình luận trên GitHub',
  /**
   * Chỗ giữ chỗ cho `author` RỖNG — một SENTINEL nghĩa là tài khoản người
   * bình luận đã bị xoá, không phải dữ liệu thiếu. Bình luận vẫn là bình
   * luận thật của một người, nên nó vẫn được hiện ra.
   */
  'discuss.deletedAuthor': 'Tài khoản đã bị xoá',
  'discuss.reason.disabled':
    'Nền tảng chưa được nối với repo thảo luận, nên chưa có gì để đọc ở đây. Đây là trạng thái bình thường của bản dựng hiện tại, không phải một lỗi.',
  'discuss.reason.unavailable':
    'Chưa tải được thảo luận từ GitHub. Phần còn lại của trang vẫn dùng được bình thường.',
  'discuss.reason.rateLimited':
    'Chưa tải được thảo luận: nền tảng đã dùng hết lượt hỏi GitHub cho ít phút vừa rồi. Thử mở lại sau.',
  /**
   * Mã lý do LẠ (máy chủ mới hơn ta). Không bao giờ vẽ nguyên văn cái mã ấy
   * lên màn hình: nó không dịch được, và chữ do máy chủ viết đi thẳng vào
   * giao diện là đúng thói quen mà cổng i18n tồn tại để chặn.
   */
  'discuss.reason.unknown': 'Chưa tải được thảo luận. Máy chủ trả về một lý do bản tuhoc này chưa biết.',
  'discuss.error': 'Chưa tải được thảo luận. Không đọc được câu trả lời của máy chủ.',

  /* ── runtime của trang đọc (`packages/course-kit/runtime.js`) ──────────── */

  /**
   * Hai câu HIỆN RA TRONG TRANG ĐỌC từ một tệp nạp bằng `<script src>`, không
   * bằng `import` — nên tệp ấy không đọc được catalog. Chữ được TRUYỀN VÀO
   * `CourseKit.initViz(root, strings)` bởi `reader/ChapterView.tsx`, và
   * `runtime.js` NÉM nếu thiếu thay vì lùi về một bản viết cứng.
   */
  'courseKit.vizMissing': (name: string) => `[mô phỏng "${name}" chưa sẵn sàng]`,
  'courseKit.vizFailed': 'Không dựng được mô phỏng này trong trình duyệt hiện tại.',

  /* ══════════════════════════════════════════════════════════════════════ *
   * QUẢN TRỊ — `/admin` (Task 15, `admin/AdminGuard.tsx`,
   * `admin/AdminCourses.tsx`, `admin/adminApi.ts`)
   * ══════════════════════════════════════════════════════════════════════ */

  /**
   * `AdminNav.tsx` — sub-nav dùng chung cho ba màn `/admin/*`. Task 17
   * thêm ba khoá này khi `AdminCredits`/`AdminPricing` ra đời, để
   * `AdminCourses` (Task 8/15) và hai màn mới có đường qua lại nhau.
   */
  'admin.nav.aria': 'Mục quản trị',
  'admin.nav.courses': 'Khoá học',
  'admin.nav.credits': 'Người dùng & credit',
  'admin.nav.pricing': 'Bảng giá & prompt nền',

  'admin.title': 'Quản trị khoá học',
  'admin.lede': 'Phát hành, gỡ, hoặc lùi phiên bản một khoá học — đi cùng bộ kiểm định mà `tuhoc pack` dùng ở dòng lệnh.',
  'admin.loading': 'Đang tải danh sách…',
  'admin.empty': 'Chưa có khoá học nào được phát hành.',

  'admin.table.slug': 'Slug',
  'admin.table.title': 'Tên khoá học',
  'admin.table.version': 'Phiên bản',
  'admin.table.publishedAt': 'Phát hành lúc',
  'admin.table.actions': 'Hành động',

  'admin.upload.heading': 'Phát hành gói mới',
  'admin.upload.fileLabel': 'Gói .zip',
  'admin.upload.slugLabel': 'Slug',
  'admin.upload.submit': 'Phát hành',
  'admin.upload.submitting': 'Đang phát hành…',
  'admin.upload.success': (slug: string, version: number) => `Đã phát hành ${slug}, phiên bản ${version}.`,

  /**
   * BẢNG FINDINGS — đúng tinh thần "in mọi vấn đề một lần" của `tuhoc pack`
   * ở dòng lệnh: một lần 400 mang MỌI phát hiện, và màn này vẽ hết, không
   * chỉ cái đầu tiên.
   */
  'admin.findings.heading': (count: number) => (count === 1 ? '1 vấn đề' : `${count} vấn đề`),
  'admin.findings.code': 'Mã',
  'admin.findings.path': 'Đường dẫn',
  'admin.findings.detail': 'Chi tiết',

  'admin.unpublish.button': 'Gỡ',
  'admin.unpublish.confirmPrompt': (slug: string) => `Chắc chắn muốn gỡ "${slug}"? Khoá học sẽ ngừng đọc được công khai.`,
  'admin.unpublish.confirmYes': 'Gỡ khoá học này',
  'admin.unpublish.confirmCancel': 'Thôi',

  'admin.rollback.label': 'Lùi về phiên bản',
  'admin.rollback.placeholder': 'Chọn một phiên bản…',
  'admin.rollback.button': 'Lùi phiên bản',
  'admin.rollback.versionOption': (version: number, current: boolean) => `v${version}${current ? ' (hiện tại)' : ''}`,
  'admin.rollback.success': (version: number) => `Đã lùi về phiên bản ${version}.`,

  'admin.error.badRequest': 'Yêu cầu không hợp lệ.',
  'admin.error.notFound': 'Không tìm thấy khoá học này.',
  'admin.error.serverDown': 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.',
  'admin.error.unknown': 'Đã xảy ra lỗi không xác định.',
  'admin.error.unreachable':
    'Không thể kết nối tới máy chủ. Có thể bạn đang ngoại tuyến, hoặc máy chủ đang bị cấu hình sai (CORS/DNS).',

  /* ══════════════════════════════════════════════════════════════════════ *
   * QUẢN TRỊ AI — Task 17, spec §7: `admin/AdminCredits.tsx` ("Người dùng &
   * credit") và `admin/AdminPricing.tsx` ("Bảng giá & prompt nền"), cả hai
   * nói chuyện với bảy route `/admin/ai/*`
   * (`apps/api/internal/ai/admin_handler.go`).
   * ══════════════════════════════════════════════════════════════════════ */

  'admin.ai.credits.title': 'Người dùng & credit',
  'admin.ai.credits.lede':
    'Tìm người dùng, xem số dư và sổ dùng, cộng hoặc trừ credit tay — mọi lần cộng/trừ đều bắt buộc ghi chú và được lưu vào sổ thao tác.',
  'admin.ai.credits.searchLabel': 'Tìm theo email',
  'admin.ai.credits.searchPlaceholder': 'vd: minh@vidu.test',
  'admin.ai.credits.searchButton': 'Tìm',
  'admin.ai.credits.loading': 'Đang tải…',
  'admin.ai.credits.empty': 'Không tìm thấy người dùng nào khớp.',
  'admin.ai.credits.colEmail': 'Email',
  'admin.ai.credits.colRole': 'Vai trò',
  'admin.ai.credits.colBalance': 'Số dư credit',
  'admin.ai.credits.colActions': 'Hành động',
  'admin.ai.credits.selectButton': 'Xem chi tiết',
  'admin.ai.credits.adjustTitle': 'Cộng / trừ credit tay',
  'admin.ai.credits.amountLabel': 'Số credit',
  'admin.ai.credits.directionLabel': 'Chiều',
  'admin.ai.credits.directionAdd': 'Cộng',
  'admin.ai.credits.directionSubtract': 'Trừ',
  'admin.ai.credits.noteLabel': 'Ghi chú (bắt buộc)',
  'admin.ai.credits.notePlaceholder': 'Vì sao bạn cộng/trừ khoản này — bắt buộc, sẽ lưu vào sổ thao tác.',
  'admin.ai.credits.adjustSubmit': 'Áp dụng',
  'admin.ai.credits.adjustSubmitting': 'Đang áp dụng…',
  'admin.ai.credits.adjustSuccess': 'Đã cập nhật số dư.',
  'admin.ai.credits.usageTitle': 'Sổ dùng gần đây',
  'admin.ai.credits.usageEmpty': 'Chưa có lượt hỏi nào được tính phí.',
  'admin.ai.credits.adjustmentsTitle': 'Lịch sử cộng/trừ tay',
  'admin.ai.credits.adjustmentsEmpty': 'Chưa có lần cộng/trừ tay nào cho tài khoản này.',
  'admin.ai.credits.colWho': 'Người thao tác',
  'admin.ai.credits.colNote': 'Ghi chú',

  'admin.ai.pricing.title': 'Bảng giá & prompt nền',
  'admin.ai.pricing.lede':
    'Sửa bảng quy đổi credit theo từng model và lời nhắc nền của agent — có hiệu lực ngay từ lượt hỏi kế tiếp, không cần triển khai lại.',
  'admin.ai.pricing.tableTitle': 'Bảng quy đổi credit',
  'admin.ai.pricing.loading': 'Đang tải…',
  'admin.ai.pricing.colModel': 'Model',
  'admin.ai.pricing.colCostIn': 'Giá vốn vào (/1K)',
  'admin.ai.pricing.colCostCachedIn': 'Giá vốn vào-cache (/1K)',
  'admin.ai.pricing.colCostOut': 'Giá vốn ra (/1K)',
  'admin.ai.pricing.colCreditsIn': 'Credit vào (/1K)',
  'admin.ai.pricing.colCreditsCachedIn': 'Credit vào-cache (/1K)',
  'admin.ai.pricing.colCreditsOut': 'Credit ra (/1K)',
  'admin.ai.pricing.colUpdatedAt': 'Cập nhật lúc',
  'admin.ai.pricing.colActions': 'Hành động',
  'admin.ai.pricing.rowNotePlaceholder': 'Vì sao đổi giá (không bắt buộc)',
  'admin.ai.pricing.save': 'Lưu',
  'admin.ai.pricing.saving': 'Đang lưu…',
  'admin.ai.pricing.saved': 'Đã lưu.',
  /* Nhan đề của MỘT form lưu HAI cột `ai_settings` (prompt nền +
   * `signup_grant_micro`) — tên khoá vẫn là `promptTitle` vì nó vẫn là nhan
   * đề của đúng khối ấy, chỉ là khối ấy nay có thêm một ô. Đổi tên khoá ở
   * đây không mua được gì: không nghĩa nào bị ĐẢO, chỉ được nới rộng, nên
   * không có chỗ gọi nào đang hiểu sai để bắt lỗi lúc biên dịch. */
  'admin.ai.pricing.promptTitle': 'Prompt nền & credit tặng khi đăng ký',
  'admin.ai.pricing.promptBlurb':
    'Lời nhắc này đứng TRƯỚC lời nhắc riêng của mọi người dùng — nó giữ vai trò gia sư và ranh giới an toàn, không được để rỗng.',
  'admin.ai.pricing.promptLabel': 'Prompt nền',
  'admin.ai.pricing.promptEmptyWarning': 'Prompt nền không được để rỗng — đây là ranh giới an toàn của agent.',
  'admin.ai.pricing.promptNoteLabel': 'Ghi chú (không bắt buộc)',

  /* ── ô "credit tặng khi đăng ký" (`ai_settings.signup_grant_micro`) ────
   *
   * Cột này CÓ route (`PUT /admin/ai/settings` nhận nó từ vòng sửa 1, mục
   * A1) nhưng KHÔNG có ô nhập cho tới đợt này — thêm ô cần đúng ba khoá
   * dưới đây, tức câu chữ người dùng, tức phạm vi đợt 2. Nó nằm CÙNG form
   * với prompt nền chứ không có form riêng vì `PUT /admin/ai/settings` đòi
   * `base_system_prompt` ở mọi lần gọi: một nút "lưu grant" riêng sẽ phải
   * gửi kèm bản nháp prompt đang gõ dở, tức lưu lén một thứ người vận hành
   * chưa định lưu.
   *
   * ĐƠN VỊ VIẾT THẲNG TRONG NHÃN: bảng giá ngay trên cùng màn cũng đo bằng
   * micro-credit, và một ô số không ghi đơn vị bên cạnh sáu cột có ghi là
   * đúng chỗ một số 0 thừa đi lọt. */
  'admin.ai.pricing.grantLabel': 'Credit tặng khi đăng ký (micro-credit)',
  'admin.ai.pricing.grantHint':
    'Mỗi tài khoản mới nhận số này ngay trong lượt đăng ký. Đặt 0 là TẮT hẳn: tài khoản mới sẽ bị chặn ngay ở câu hỏi đầu tiên cho tới khi có người nạp tay.',
  'admin.ai.pricing.grantInvalid': (max: string) => `Phải là số nguyên không âm, tối đa ${max}.`,

  'admin.ai.error.fieldRequired': 'Thiếu một trường bắt buộc.',
  'admin.ai.error.amountRequired': 'Số tiền không được để trống hoặc bằng 0.',
  'admin.ai.error.amountOutOfRange': 'Số vượt quá mức cho phép cho một lần thao tác.',
  'admin.ai.error.fieldTooLong': 'Nội dung dài hơn mức cho phép.',
  'admin.ai.error.notFound': 'Không tìm thấy.',
};

/** Hình dạng mà MỌI ngôn ngữ phải phủ đúng. Xem chú thích trên `vi`. */
export type Messages = typeof vi;
