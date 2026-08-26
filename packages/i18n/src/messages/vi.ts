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
   * SỬA Ở fix-round-1 (task-14): bản cũ nói "Gói khoá học và ghi chú nằm
   * trong trình duyệt này" — sai từ Task 13, khi `db.packages` bị xoá khỏi
   * lược đồ Dexie (spec `2026-08-25-server-side-pivot.md` §1). Không còn gói
   * nào để nằm ở đây; hai con số ngay dưới câu này (`statNotes`, `statBytes`)
   * đã tự nói đúng những gì bảng này còn giữ.
   */
  'settings.localData.blurb': 'Ghi chú nằm trong trình duyệt này. Khoá học không tải gói nào về máy — đọc thẳng từ máy chủ.',
  'settings.localData.clearedOnSignOut':
    'Cơ sở dữ liệu mang tên TRÌNH DUYỆT, không mang tên người dùng — nên nó bị xoá sạch mỗi lần đổi người đăng nhập, kể cả khi không ai bấm đăng xuất.',
  'settings.localData.kept': 'Ngôn ngữ và giao diện thì ở lại: chúng là tuỳ chọn của thiết bị.',

  /* ── mục Trợ lý AI ─────────────────────────────────────────────────────── */

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
  'settings.ai.blurb': (vault: string) => `Chạy bằng key của chính bạn, cất trong ${vault} ở một địa chỉ riêng.`,
  'settings.ai.blurbVault': 'kho khoá',
  'settings.ai.keyStays':
    'Key không rời trình duyệt này, không đồng bộ, không đi qua máy chủ của chúng tôi.',
  'settings.ai.unavailable':
    'Bản dựng này không có kho khoá, nên chưa dùng được trợ lý AI. Đây là một thiếu sót của cấu hình khi triển khai, không phải của tài khoản bạn — phần đọc giáo trình vẫn chạy bình thường.',
  'settings.ai.open': 'Mở kho khoá',

  /**
   * NHÃN CỦA MẶT PHẲNG KIA, và nó mang **địa chỉ thật** chứ không phải một câu
   * chung chung về "một địa chỉ riêng".
   *
   * Kiến trúc hai origin chỉ có giá trị nếu người dùng NHÌN THẤY nó. Một câu
   * nói "chạy ở một địa chỉ riêng" thì đúng với cả một bản dựng đã lỡ trỏ kho
   * khoá về chính origin trang chính — tức là đúng với cả bản dựng mà cơ chế đã
   * chết. In ra origin thật làm cho lời hứa ấy KIỂM ĐƯỢC bằng mắt, ngay tại chỗ
   * người dùng sắp dán key.
   */
  /* "chạy ở", KHÔNG "khung dưới đây": khung mở ra thành một tấm NỔI LÊN TRÊN
     trang này, không nằm dưới nhãn. Một nhãn mô tả sai vị trí của thứ nó đặt
     tên là một nhãn dạy người đọc bỏ qua nhãn. */
  'settings.ai.frameLabel': (origin: string) =>
    `Kho khoá chạy ở ${origin} — một địa chỉ khác, tách khỏi trang bài học.`,
  'settings.ai.frameOpen': 'Kho khoá đang mở ở lớp trên. Bấm "Đóng" ở đó để quay lại trang này.',

  'settings.ai.budgetTitle': 'Hạn mức mỗi phiên',
  /**
   * KHÔNG in con số ở đây, có chủ ý. Ngân sách sống ở `SESSION_CHAR_BUDGET`
   * trong `apps/vault/src/guard.ts` — một origin khác, không có alias sang trang
   * chính — nên một con số chép sang đây là bản sao thứ hai của một sự thật, và
   * bản sao thứ hai thì trôi. Câu này nói đúng thứ trang chính biết chắc: rằng
   * hạn mức tồn tại, rằng khung sẽ hỏi lại, và rằng nó định giá bằng số cú bấm
   * chứ không chặn được gì.
   */
  'settings.ai.budgetBody':
    'Kho khoá đặt một hạn mức ký tự cho mỗi phiên. Tiêu hết thì nó hỏi lại, kèm nhật ký những gì đã rời máy.',

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
  /*
   * Kho khoá được thiết kế để NHÚNG. Mở thẳng địa chỉ của nó thì trang vẫn vẽ
   * đầy đủ mà không có một lối nào quay về bài học — người dùng báo đúng chuyện
   * này bằng một ảnh chụp thanh địa chỉ đang ở origin kho khoá. Hai chuỗi dưới
   * đây chỉ hiện khi trang KHÔNG nằm trong khung.
   */
  'vault.standalone.notice':
    'Đây là kho khoá, và nó được làm ra để nằm trong trang học chứ không phải mở riêng. Mở riêng thì nó vẫn cất và xoá key được, nhưng không có bài học nào ở đây.',
  'vault.standalone.back': 'Về trang học',
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
  'nav.continue': 'Học tiếp',
  'nav.courses': 'Khoá học',
  'nav.progress': 'Tiến độ',
  'account.settings': 'Cài đặt',
  'nav.dashboard': 'Bảng điều khiển',
  'nav.library': 'Thư viện',
  /**
   * Vẫn là nhan đề của chính màn nhập gói (nay nằm trong hộp thoại của
   * `/courses`), nên khoá này còn sống. Nhãn của cái NÚT mở hộp thoại là
   * `courses.import.action` — hai chữ khác nhau cho hai việc khác nhau: một
   * cái đặt tên cho màn hình, một cái mời người ta bấm.
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

  'vault.frame.configError': '[kho khoá] cấu hình sai, tính năng AI bị tắt:',
  /**
   * ĐỊA CHỈ THẬT trên thanh tiêu đề của khung, không phải chữ "một địa chỉ
   * riêng". Xem lý do đầy đủ ở `settings.ai.frameLabel`: một câu chung chung
   * vẫn đúng với một bản dựng đã lỡ trỏ kho khoá về chính origin trang chính,
   * còn origin in ra thì không.
   */
  'vault.frame.overlayLabel': (origin: string) => `Kho khoá — khung này chạy ở ${origin}, tách khỏi trang bài học`,
  'vault.frame.close': 'Đóng',
  'vault.frame.title': 'Kho khoá',

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
  'progress.stat.chapters': 'Chương đã học',
  'progress.stat.chaptersSub': (n: string) => `trên ${n} khoá trong máy này`,
  'progress.stat.streak': 'Chuỗi ngày liền',
  'progress.stat.streakSub': 'tính tới hôm nay',
  'progress.stat.notes': 'Ghi chú đã viết',
  'progress.stat.notesSub': 'còn giữ trên máy này',
  'progress.noCourses': 'Chưa có khoá học nào để đo. Nhập một gói ở mục Khoá học.',
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
   * vụ mọi khoá học công khai — không còn gói nào để tải), key nằm ở origin
   * kho khoá (`apps/vault`), tiến độ và ghi chú đồng bộ qua tài khoản
   * (`sync/engine.ts`).
   *
   * GẠCH ĐẦU DÒNG THỨ NHẤT VÀ THỨ BA ĐỔI Ở TASK NÀY (task-14, spec
   * `2026-08-25-server-side-pivot.md` §0.2) — khoá cũng đổi tên
   * (`login.point.offline` → `login.point.free`, `login.point.private` →
   * `login.point.sync`) để chỗ nào còn trỏ khoá cũ nổ compile thay vì lặng lẽ
   * trống. Bản cũ hứa "gói nằm trên máy bạn, đọc ngoại tuyến" — đúng khi
   * course còn là một gói tải về cất trong `db/local.ts`; sai từ khi course
   * chuyển hẳn lên máy chủ, vì đọc mà mất mạng giờ là hỏng chứ không phải một
   * tính năng. Bullet thứ ba từng là "course riêng tư không lộ ra registry" —
   * khái niệm ấy cũng rời đi cùng registry riêng tư (`courses.lede` đã tự
   * khai "mọi khoá học đều công khai"), nên chỗ của nó nay là lời hứa đồng bộ.
   */
  'login.pitch.headline': 'Khoá học mở cho mọi người.',
  'login.pitch.lede':
    'Mở một khoá học và đọc ngay — không cần cài đặt, không cần chờ tải. Bôi đen một đoạn để ghi chú thẳng lên trang, hoặc hỏi trợ lý AI bằng key của chính bạn.',
  'login.pitch.aria': 'Tự học làm được gì',
  'login.point.free': 'Đọc toàn bộ giáo trình miễn phí — không cần tài khoản',
  'login.point.ownKey': 'Trợ lý AI chạy bằng key của chính bạn, và key không đi qua máy chủ của chúng tôi',
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
  'courses.lede': 'Mọi khoá học, công khai — đọc miễn phí, không cần tài khoản.',
  'courses.loading': 'Đang tải danh mục…',
  'courses.empty': 'Chưa có khoá học nào được xuất bản.',
  'courses.list.aria': 'Danh mục khoá học',
  /**
   * `pages/Library.tsx`'s `EmptyLibrary` là nơi DUY NHẤT còn dùng khoá này —
   * `pages/Dashboard.tsx` đã tự viết lời mời riêng của nó (xem `home.empty.*`
   * bên dưới) vì thư viện không còn là khái niệm của trang chủ. Khoá này rời
   * đi cùng `pages/Library.tsx` ở một commit sau, không phải ở đây.
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
  'ai.panel.newThread': 'Hội thoại mới',
  'ai.panel.thinking': 'Đang nghĩ…',
  'ai.panel.needsSetup':
    'Trợ lý AI chạy bằng key của chính bạn, và máy này chưa có key nào. Key được cất trong kho khoá — một trang riêng ở một địa chỉ riêng, nên khoá học không đọc được nó.',
  'ai.panel.openSettings': 'Mở trang cấu hình',
  'ai.panel.unavailable':
    'Bản dựng này không có kho khoá, nên chưa dùng được trợ lý AI. Đây là thiếu sót của cấu hình khi triển khai, không phải của tài khoản bạn — phần đọc giáo trình vẫn chạy bình thường.',
  'ai.panel.probeFailed': 'Chưa hỏi được kho khoá xem đã cắm key chưa. Bạn vẫn có thể thử hỏi.',
  'ai.panel.questionLabel': 'Câu hỏi của bạn',
  'ai.panel.questionPlaceholder': 'Hỏi về chương đang đọc…',
  'ai.panel.stop': 'Dừng',
  'ai.panel.ask': 'Hỏi',
  'ai.deepDive.heading': 'Đào sâu',
  'ai.error.unavailable': 'Bản dựng này không có kho khoá, nên chưa dùng được AI.',
  'ai.error.notConfigured': 'Chưa cắm key vào kho khoá trên máy này.',

  /* ── phía trang chính của giao thức kho khoá (`ai/vaultClient.ts`) ─────── */

  'ai.vault.originShape': (received: string) =>
    `VITE_VAULT_ORIGIN phải là một origin đúng nghĩa (scheme://host[:port]), không dấu "/" cuối, không đường dẫn, không "*" — nhận được ${received}.`,
  'ai.vault.frameDetached': 'Khung kho khoá đã bị tháo trong lúc đang chờ.',
  'ai.vault.abortedBeforeSend': 'Đã huỷ trước khi gửi.',
  'ai.vault.abortedByUser': 'Người dùng đã huỷ.',
  'ai.vault.timeout': (ms: string) =>
    `Kho khoá không trả lời sau ${ms} ms. Khung có nạp được không, và origin có đúng không?`,

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
};

/** Hình dạng mà MỌI ngôn ngữ phải phủ đúng. Xem chú thích trên `vi`. */
export type Messages = typeof vi;
