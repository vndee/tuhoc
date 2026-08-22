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

  /* ── trang cấu hình TRỢ LÝ AI (`pages/Settings.tsx`) ───────────────────── */

  'settings.ai.title': 'Trợ lý AI',
  /**
   * KHOÁ CÓ CHỖ TRỐNG ĐẦU TIÊN, và là ca đã chốt QĐ-2: `<strong>kho khoá</strong>`
   * nằm GIỮA câu, không bọc cả câu. Tham số là `string` chứ không phải
   * `ReactNode` — catalog không được biết React tồn tại (xem `../index.ts`);
   * `tNode()` ở `apps/web/src/i18n/tNode.tsx` mới là bên chèn phần tử vào.
   *
   * Câu giữ nguyên vẹn trong catalog thay vì bị cắt làm ba khoá, nên trật tự từ
   * của bản tiếng Anh khác được mà chỗ vẽ không phải biết.
   */
  'settings.ai.blurb': (vault: string) =>
    `Bạn dùng key của chính mình, và key ấy được cất trong ${vault} — một trang riêng chạy ở một địa chỉ riêng, mở ra đè lên trang này khi bạn vào đây. Trình duyệt cấm mã của trang bài học đọc bất cứ thứ gì bên trong kho khoá, nên một khóa học tương tác bị duyệt sót vẫn không lấy được key của bạn. Vì thế ô dán key nằm trong kho khoá, không nằm trên trang này.`,
  'settings.ai.blurbVault': 'kho khoá',
  'settings.ai.keyStays':
    'Key không rời khỏi trình duyệt này: nó không được đồng bộ giữa các thiết bị và không đi qua máy chủ của chúng tôi. Đổi máy thì cắm lại; xoá thì không lấy lại được.',
  'settings.ai.unavailable':
    'Bản dựng này không có kho khoá, nên chưa dùng được trợ lý AI. Đây là một thiếu sót của cấu hình khi triển khai, không phải của tài khoản bạn — phần đọc giáo trình vẫn chạy bình thường.',
  'settings.ai.open': 'Mở kho khoá',

  /* ══════════════════════════════════════════════════════════════════════ *
   * KHO KHOÁ (`apps/vault`) — origin riêng, và là lý do gói này không phụ
   * thuộc gì. Mọi khoá dưới đây được đọc bằng `apps/vault/src/lang.ts`.
   * ══════════════════════════════════════════════════════════════════════ */

  /* ── người gác (`guard.ts`) — câu đi kèm mỗi lần TỪ CHỐI ───────────────── */

  'vault.guard.needsConsent': 'Cần một cú bấm xác nhận trong khung kho khoá trước lời gọi đầu tiên của phiên này.',
  'vault.guard.unmeasurable': 'Kho khoá không đo được độ dài lời nhắc này nên từ chối gửi nó đi.',
  'vault.guard.promptTooLong': 'Lời nhắc này dài hơn toàn bộ ngân sách của một phiên nên kho khoá không gửi.',
  'vault.guard.budgetSpent': 'Phiên này đã gửi đi hết ngân sách ký tự. Hãy xác nhận lại trong khung kho khoá.',
  'vault.guard.rateLimited': 'Kho khoá đang giới hạn tần suất để không ai gọi hộ bằng key của bạn.',
  'vault.guard.bucketWriteFailed': 'Kho khoá không ghi được trạng thái hạn mức nên từ chối lời gọi này.',
  'vault.guard.budgetWriteFailed': 'Kho khoá không ghi được ngân sách ký tự nên từ chối lời gọi này.',

  /* ── ô cất key (`keystore.ts`) ─────────────────────────────────────────── */

  'vault.keystore.missingProviderOrModel': 'writeConfig: thiếu providerId hoặc model.',
  'vault.keystore.emptyKey': 'writeConfig: key rỗng — kho khoá không lưu cấu hình không dùng được.',

  /* ── giao thức + nhà cung cấp (`main.ts`, `providers/sse.ts`) ──────────── */

  'vault.protocol.version': (version: string) => `Kho khoá dùng giao thức v${version}.`,
  'vault.protocol.unsupported': 'Chưa hỗ trợ.',
  'vault.protocol.badChatShape': 'Yêu cầu chat không đúng hình dạng giao thức.',
  'vault.provider.unknown': 'Kho khoá không biết nhà cung cấp này.',
  'vault.provider.notConfigured': 'Chưa cắm key trong kho khoá.',
  'vault.provider.callFailed': 'Kho khoá không hoàn tất được lời gọi tới nhà cung cấp.',
  'vault.provider.unreachable': 'Không gọi được nhà cung cấp từ trình duyệt (mạng hoặc CORS).',
  'vault.provider.badKey': 'Key bị từ chối.',
  'vault.provider.rateLimited': 'Nhà cung cấp giới hạn tần suất.',

  /**
   * Hai câu này nói với NGƯỜI TRIỂN KHAI, không với người học — kho khoá từ
   * chối chạy khi không biết tin ai. Chúng vẫn đi qua catalog vì chúng nằm
   * trong `main.ts`, một tệp có cả chuỗi hướng tới người học; ngôn ngữ áp dụng
   * là ngôn ngữ đã đọc từ URL, đúng như mọi câu khác.
   *
   * `apps/vault/src/headers.ts` thì KHÁC và cố ý không nằm ở đây: nó chỉ được
   * `vite.config.ts` nhập, chạy ở Node **lúc dựng**, và alias `@tuhoc/i18n`
   * không áp cho chính tệp cấu hình — dịch nó sẽ làm hỏng bản dựng. Nó được
   * xếp vào `DEVELOPER_FACING` kèm phép đo.
   */
  'vault.boot.originRequired': 'VITE_APP_ORIGIN bắt buộc — kho khoá từ chối chạy khi không biết tin ai.',
  'vault.boot.originShape': (received: string) =>
    `VITE_APP_ORIGIN phải là một origin đúng nghĩa (scheme://host[:port]), không dấu "/" cuối, không đường dẫn, không "*" — nhận được ${received}.`,

  /* ── màn cấu hình trong khung (`ui/Settings.ts`) ───────────────────────── */

  /**
   * Lời nhắc của nút "Kiểm tra kết nối". NGẮN CÓ CHỦ Ý: nút này gọi thật, tức
   * tiêu tiền thật của người dùng. `settings.test.ts` ghim độ dài lại để nó
   * không phình ra — và vì độ dài ấy là một khẳng định, bản dịch cũng phải
   * ngắn.
   */
  'vault.settings.testPrompt': 'Trả lời đúng một từ: OK',
  'vault.settings.openaiWarning':
    'Cảnh báo đã đo được (2026-08-22): OpenAI chặn đường sinh chữ bằng CORS khi gọi thẳng từ trình duyệt — hồi đáp lỗi của họ không kèm Access-Control-Allow-Origin. Đường thành công chưa đo được, nên OpenAI có thể không dùng được ở đây, và nếu có thì lỗi sai key sẽ hiện ra là "không gọi được nhà cung cấp" chứ không phải "key bị từ chối". Hãy thử "Kiểm tra kết nối" trước khi tin vào nó. DeepSeek, OpenRouter, Groq và Anthropic đều đã đo được là gọi thẳng từ trình duyệt được.',
  'vault.settings.title': 'Trợ lý AI chạy bằng key của chính bạn',
  'vault.settings.why':
    'Ô dán key nằm trong khung này, và khung này là một trang riêng ở một origin riêng. Trình duyệt cấm mã của trang bài học đọc bất cứ thứ gì ở đây — kể cả ô bên dưới, kể cả chỗ cất key. Trang bài học chỉ gửi câu hỏi vào và nhận chữ trả lời ra; nó không bao giờ thấy key. Đó là lý do ô này không nằm ở trang cấu hình bên ngoài.',
  'vault.settings.providerLabel': 'Nhà cung cấp',
  'vault.settings.modelLabel': 'Mô hình',
  'vault.settings.modelHint': 'Để nguyên nếu bạn không có lý do cụ thể để đổi.',
  'vault.settings.keyPlaceholder': 'Dán key của bạn vào đây',
  'vault.settings.keyLabel': 'Key của bạn',
  'vault.settings.keyHint':
    'Key ở lại đúng trình duyệt này, đúng thiết bị này. Nó không được đồng bộ, không đi qua máy chủ của chúng tôi, và không có cách nào lấy lại nếu bạn xoá — hãy giữ bản gốc ở trang của nhà cung cấp.',
  'vault.settings.save': 'Lưu key trên máy này',
  'vault.settings.test': 'Kiểm tra kết nối',
  'vault.settings.clear': 'Xoá key khỏi máy này',
  'vault.settings.currentKey': (providerId: string, model: string) => `Máy này đã có key: ${providerId} · ${model}.`,
  'vault.settings.noKey': 'Máy này chưa có key nào.',
  'vault.settings.noKeyTyped': 'Chưa dán key nào vào ô bên trên.',
  'vault.settings.noModel': 'Chưa có tên mô hình.',
  'vault.settings.saved': 'Đã lưu key vào trình duyệt này. Bấm "Kiểm tra kết nối" để chắc chắn nó dùng được.',
  'vault.settings.clearArmed': 'Bấm lần nữa để xoá',
  'vault.settings.clearWarning': 'Bấm lần nữa để xoá hẳn key khỏi trình duyệt này. Không có cách lấy lại.',
  'vault.settings.cleared': 'Đã xoá key khỏi trình duyệt này.',
  'vault.settings.noKeyAnywhere': 'Chưa dán key nào, và máy này cũng chưa lưu key cho nhà cung cấp đang chọn.',
  'vault.settings.needsConsent':
    'Kho khoá chưa được xác nhận trong phiên này. Bấm nút "Cho phép trong phiên này" ngay bên dưới rồi thử lại.',
  'vault.settings.denied': 'Kho khoá đang từ chối lời gọi này.',
  'vault.settings.calling': 'Đang gọi nhà cung cấp…',
  'vault.settings.emptyReply': 'Gọi được nhà cung cấp, nhưng mô hình không trả về chữ nào. Thử một mô hình khác.',
  'vault.settings.reply': (reply: string) => `Gọi được nhà cung cấp. Mô hình trả lời: «${reply}»`,
  'vault.settings.openaiHint': (message: string) =>
    `${message} (Với OpenAI, xem cảnh báo CORS ở trên — lỗi này có thể không phải do key.)`,

  /* ── xác nhận + nhật ký (`ui/Consent.ts`) ──────────────────────────────── */

  'vault.log.title': 'Trợ lý AI đã gửi đi những gì',
  'vault.log.blurb':
    'Nhật ký ghi thời điểm và SỐ KÝ TỰ đã gửi. Nội dung lời nhắc không được ghi lại ở đây — một bản sao thứ hai của ghi chú riêng tư nằm cạnh key là điều kho khoá này từ chối tạo ra.',
  'vault.log.empty': 'Chưa có lời gọi nào.',
  'vault.log.total': (chars: string, calls: string) => `Tổng cộng ${chars} ký tự đã rời khỏi máy này, qua ${calls} lời gọi.`,
  'vault.log.entry': (when: string, chars: string, provider: string) => `${when} · ${chars} ký tự đã gửi · ${provider}`,
  'vault.log.unknownProvider': 'nhà cung cấp không rõ',
  'vault.log.denied': (rateLimited: string, needsConsent: string) =>
    `Kho khoá đã TỪ CHỐI ${rateLimited} lời gọi vì quá tần suất và ${needsConsent} lời gọi vì chưa được xác nhận.`,
  'vault.log.clear': 'Xoá nhật ký',
  'vault.consent.askAgainTitle': 'Trợ lý AI xin phép gọi tiếp bằng key của bạn',
  'vault.consent.askTitle': 'Trợ lý AI muốn gọi ra ngoài bằng key của bạn',
  'vault.consent.askAgainBody':
    'Kho khoá đã dừng lại và hỏi lại trước khi gửi thêm. Nhật ký ngay bên dưới cho biết chừng nào chữ đã rời khỏi máy này — hãy nhìn nó trước khi bấm lần này, vì mỗi cú bấm mở đường cho một lượng chữ tương đương nữa. Nếu con số ấy lớn hơn những gì bạn nhớ là mình đã hỏi, thì đừng bấm.',
  'vault.consent.askBody':
    'Trang bài học vừa yêu cầu kho khoá gọi nhà cung cấp AI. Kho khoá không cho lời gọi nào đi ra trước khi bạn bấm nút dưới đây, và cú bấm này chỉ có hiệu lực trong phiên hiện tại.',
  'vault.consent.allow': 'Cho phép trong phiên này',

  /* ══════════════════════════════════════════════════════════════════════ *
   * VỎ ỨNG DỤNG (`shell/`) — thanh bên, thanh trên, rail, lưới lỗi
   * ══════════════════════════════════════════════════════════════════════ */

  'app.name': 'Tự học',

  'nav.aria.main': 'Điều hướng chính',
  'nav.dashboard': 'Bảng điều khiển',
  'nav.library': 'Thư viện',
  'nav.import': 'Nhập khóa học',
  'nav.catalog': 'Danh mục registry',

  'sidebar.searchPlaceholder': 'Tìm chương…',
  'sidebar.progressPlaceholder': 'Tiến độ sẽ hiện ở đây',
  'sidebar.noCourseLoaded': 'Chưa có khóa học nào được tải.',

  'topbar.menu': 'Mở menu',
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

  'vault.frame.configError': '[kho khoá] cấu hình sai, tính năng AI bị tắt:',
  'vault.frame.overlayTitle': 'Kho khoá — trang này chạy ở một địa chỉ riêng, tách khỏi trang bài học',
  'vault.frame.close': 'Đóng',
  'vault.frame.title': 'Kho khoá',

  /* ══════════════════════════════════════════════════════════════════════ *
   * TRANG (`pages/`)
   * ══════════════════════════════════════════════════════════════════════ */

  /* ── chung ─────────────────────────────────────────────────────────────── */

  'course.loading': 'Đang tải khóa học…',
  'course.notFound': 'Không tìm thấy khóa học.',
  'chapter.notFound': 'Không tìm thấy chương này.',
  'chapter.notFoundInCourse': 'Không tìm thấy chương này trong khóa học.',

  /* ── bảng điều khiển (`pages/Dashboard.tsx`) ───────────────────────────── */

  'dashboard.lede': 'Tiến độ học tập và thời gian học của bạn.',
  'dashboard.logout': 'Đăng xuất',
  'dashboard.stats.loading': 'Đang tải số liệu học tập…',
  'dashboard.stats.error':
    'Không tải được số liệu học tập (có thể bạn đang ngoại tuyến). Phần trăm hoàn thành mỗi khóa học ở dưới vẫn chính xác — dữ liệu đó được lưu ngay trên máy bạn.',
  'dashboard.stats.streakDays': 'ngày liên tục',
  'dashboard.stats.totalMinutes': 'phút đã học',
  'dashboard.chart.aria': 'Số phút học trong 30 ngày gần nhất',
  'dashboard.chart.barTitle': (date: string, minutes: string) => `${date}: ${minutes} phút`,
  'dashboard.card.loading': 'Đang tải…',
  'dashboard.card.chaptersRead': (read: string, total: string) => `${read}/${total} chương đã học`,
  'dashboard.card.minutes': (minutes: string) => ` · ${minutes} phút`,
  'dashboard.ring.aria': (percent: string) => `${percent}% hoàn thành`,

  /* ── đăng nhập (`pages/Login.tsx`) ─────────────────────────────────────── */

  'login.title': 'Đăng nhập',
  'login.lede': 'Đăng nhập hoặc tạo tài khoản để đồng bộ tiến độ học trên nhiều thiết bị.',
  'login.tablist.aria': 'Đăng nhập hoặc đăng ký',
  'login.tab.login': 'Đăng nhập',
  'login.tab.register': 'Đăng ký',
  'login.field.email': 'Email',
  'login.field.password': 'Mật khẩu',
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

  'library.title': 'Thư viện',
  'library.lede': 'Mọi khóa học bạn đang có — trên máy chủ và trên thiết bị này.',
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
  'library.update.available': (version: string) => `Có bản mới: v${version}`,
  'library.update.view': 'Xem thay đổi',
  'library.tier.contentTitle': 'Hạng content: chỉ HTML, CSS, hình ảnh và công thức toán — không có JavaScript.',
  'library.tier.interactiveTitle':
    'Hạng interactive (§1.2): khóa học này được phép chứa JavaScript, và mã đó chạy trong trình duyệt của bạn khi bạn đọc.',
  'library.tier.interactiveLabel': 'interactive — chạy mã JavaScript',
  'library.tier.unknownTitle': 'Gói này không khai báo hạng, nên không có gì bảo đảm nó không chứa JavaScript.',
  'library.tier.unknownLabel': 'hạng không rõ — có thể chạy mã',
  'library.emptyState.lede':
    'Bạn chưa có khóa học nào. tuhoc cố ý không đóng gói sẵn khóa học nào — bạn tự chọn thứ mình đọc, và cách duy nhất để bắt đầu là nhập một gói.',
  'library.emptyState.wayFile': (zip: string) => `một tệp ${zip} có sẵn trên máy bạn — cách này chạy được cả khi mất mạng`,
  'library.emptyState.wayUrl': (zip: string) => `một đường dẫn tới tệp ${zip}`,
  'library.emptyState.wayRepo': 'một repo GitHub công khai',
  'library.emptyState.registry': 'Kho khóa học cộng đồng (registry) đang được xây dựng — khi có, nó sẽ hiện ngay ở đây.',

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
};

/** Hình dạng mà MỌI ngôn ngữ phải phủ đúng. Xem chú thích trên `vi`. */
export type Messages = typeof vi;
