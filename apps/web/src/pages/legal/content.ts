import type { Lang } from '../../i18n';

/**
 * Nội dung hai văn bản pháp lý — Quyền riêng tư và Điều khoản sử dụng.
 *
 * ## Vì sao nội dung nằm ở đây chứ không nằm trong `packages/i18n`
 *
 * Gói i18n giữ NHÃN giao diện: nút, tiêu đề cột, câu báo lỗi — thứ ngắn, được
 * gọi rải rác khắp ứng dụng, và cần `t()` để tra. Hai văn bản dưới đây là văn
 * xuôi dài, đọc từ đầu tới cuối, chỉ dùng ở đúng một trang. Nhét chúng vào
 * `vi.ts`/`en.ts` sẽ làm tệp nhãn phình gấp đôi và trộn hai loại nội dung có
 * vòng đời khác hẳn nhau: nhãn đổi khi giao diện đổi, còn văn bản pháp lý đổi
 * khi việc xử lý dữ liệu đổi.
 *
 * ## Mọi câu ở mục "Chúng tôi lưu gì" đều đọc ra từ lược đồ, không phải văn mẫu
 *
 * Danh sách dữ liệu lấy trực tiếp từ các bảng trong `apps/api` — `users`,
 * `sessions`, `progress`, `annotations`, `events`, `ai_usage`,
 * `user_agent_config`, `course_ratings`, `enrollments`, `ai_credits`,
 * `admin_audit`. Câu "không lưu nội dung hội thoại" cũng kiểm được: không có
 * bảng nào tên chứa `message`/`chat`/`thread`/`conversation`, và gói
 * `internal/ai` chỉ `INSERT` vào `ai_credits`, `ai_usage`, `admin_audit`,
 * `user_agent_config`.
 *
 * NẾU BẠN THÊM MỘT BẢNG CÓ `user_id`, hãy sửa mục ấy trong CẢ HAI ngôn ngữ.
 * Một chính sách kê thiếu thì tệ hơn không kê.
 */

export type Section = {
  /** Tiêu đề mục. */
  h: string;
  /** Các đoạn văn. Phần tử bắt đầu bằng "· " được vẽ thành gạch đầu dòng. */
  p: string[];
};

export type LegalDoc = {
  title: string;
  /** Ngày sửa lần cuối, dạng ISO — trang tự định dạng theo ngôn ngữ. */
  updated: string;
  lede: string;
  sections: Section[];
};

export type LegalId = 'privacy' | 'terms';

const UPDATED = '2026-09-06';

/** Một chỗ duy nhất. Địa chỉ này xuất hiện ở bốn mục trong hai văn bản; để nó
 *  rải rác là bảo đảm bốn chỗ ấy lệch nhau sau lần đổi đầu tiên. */
const CONTACT = 'tuhoc@duy.dev';

const privacyVi: LegalDoc = {
  title: 'Quyền riêng tư',
  updated: UPDATED,
  lede:
    'Tự học là một dự án cộng đồng, phi lợi nhuận. Trang này nói đúng những gì hệ thống lưu, ' +
    'những gì nó không lưu, và ai khác nhìn thấy dữ liệu của bạn. Nó được viết từ lược đồ cơ sở ' +
    'dữ liệu thật chứ không phải chép từ một mẫu có sẵn.',
  sections: [
    {
      h: 'Đọc thì không cần tài khoản',
      p: [
        'Mọi khoá học đọc được mà không cần đăng nhập. Nếu bạn chỉ đọc, chúng tôi không tạo hồ sơ nào cho bạn.',
        'Tài khoản chỉ đổi lấy một thứ: tiến độ, ghi chú và số dư trợ lý AI đi theo bạn giữa các thiết bị.',
      ],
    },
    {
      h: 'Chúng tôi lưu gì khi bạn có tài khoản',
      p: [
        '· Tài khoản — địa chỉ email, tên hiển thị (có thể để trống), mật khẩu đã băm, và thời điểm tạo. Chúng tôi không bao giờ lưu mật khẩu dạng đọc được.',
        '· Phiên đăng nhập — một mã phiên và thời điểm hết hạn, để bạn không phải đăng nhập lại mỗi lần mở trang.',
        '· Tiến độ — chương nào bạn đánh dấu đã đọc, ở khoá nào, lúc nào.',
        '· Ghi chú — nội dung ghi chú và vị trí neo của nó trong chương.',
        '· Sự kiện đọc — các mốc như mở một chương, kèm một khối dữ liệu nhỏ mô tả sự kiện.',
        '· Đánh giá và ghi danh khoá học.',
        '· Trợ lý AI — số dư tín dụng, và với mỗi lượt hỏi: tên mô hình, số token vào/ra, số lần gọi công cụ, số lần tìm web, và chi phí. Nếu bạn tự đặt lời nhắc hệ thống riêng, lời nhắc ấy được lưu.',
        '· Nhật ký quản trị — hành động của quản trị viên trên tài khoản và tín dụng, để việc gì đã làm còn dấu vết.',
      ],
    },
    {
      h: 'Thứ chúng tôi không lưu',
      p: [
        'Nội dung hội thoại với trợ lý AI không được lưu trên máy chủ của dự án. Không có bảng nào chứa tin nhắn; thứ được ghi lại là số token và chi phí, để trừ tín dụng.',
        'Câu hỏi của bạn vẫn được chuyển tới nhà cung cấp mô hình để có câu trả lời — xem mục bên dưới. Việc dự án không giữ bản sao không có nghĩa là không ai khác thấy nó.',
        'Chúng tôi không dùng dịch vụ theo dõi quảng cáo, không đặt cookie quảng cáo, và không bán hay trao đổi dữ liệu của bạn.',
      ],
    },
    {
      h: 'Cookie',
      p: [
        'Đúng một cookie: cookie phiên đăng nhập. Nó chỉ được đặt sau khi bạn đăng nhập, được gửi qua kết nối bảo mật, và hết hạn theo thời điểm ghi trong phiên.',
        'Lựa chọn ngôn ngữ được lưu trong bộ nhớ trình duyệt của bạn, không gửi lên máy chủ.',
      ],
    },
    {
      h: 'Những bên khác chạm vào dữ liệu',
      p: [
        'Dự án tự vận hành, nhưng chạy trên hạ tầng của người khác. Kê đủ ở đây:',
        '· Neon — cơ sở dữ liệu. Mọi thứ ở mục trên nằm tại đó.',
        '· Render — máy chủ API, đặt tại Singapore.',
        '· Cloudflare Pages — phục vụ giao diện web.',
        '· DeepSeek — nhà cung cấp mô hình cho trợ lý AI. Câu hỏi và ngữ cảnh chương bạn đang đọc được gửi tới đó để sinh câu trả lời. Dự án dùng một tài khoản duy nhất do dự án trả tiền; bạn không phải đưa khoá API nào cho chúng tôi.',
        '· Brave Search — chỉ khi trợ lý dùng công cụ tìm web. Khi ấy câu truy vấn được gửi tới đó.',
        '· GitHub — phần thảo luận dưới mỗi khoá được nhúng từ GitHub Discussions. Nếu bạn bình luận ở đó, bình luận ấy thuộc về GitHub và chính sách của họ, không phải của chúng tôi.',
        'Mỗi bên có chính sách riêng, và chúng tôi không kiểm soát được chính sách ấy.',
      ],
    },
    {
      h: 'Xoá tài khoản',
      p: [
        `Viết cho ${CONTACT} và chúng tôi xoá. Mọi bảng chứa dữ liệu của bạn đều liên kết tới tài khoản bằng ràng buộc xoá dây chuyền, nên xoá tài khoản là xoá tiến độ, ghi chú, sự kiện, lịch sử dùng AI, đánh giá và tín dụng cùng lúc.`,
        'Hai ngoại lệ, nói thẳng: bản sao lưu của nhà cung cấp cơ sở dữ liệu có vòng đời riêng và sẽ hết theo lịch của họ; và bình luận bạn viết trên GitHub Discussions phải xoá tại GitHub.',
      ],
    },
    {
      h: 'Trẻ em',
      p: [
        `Dự án không nhắm tới trẻ em dưới 13 tuổi và không cố ý thu thập dữ liệu của các em. Nếu bạn là phụ huynh và cho rằng con mình đã tạo tài khoản, viết cho ${CONTACT} để chúng tôi xoá.`,
      ],
    },
    {
      h: 'Liên hệ',
      p: [
        `Mọi câu hỏi về trang này, yêu cầu xoá dữ liệu, hay báo một lỗi bạn tìm thấy trong nội dung: ${CONTACT}.`,
        'Dự án được duy trì bởi tình nguyện viên, nên trả lời có thể chậm. Nếu việc bạn báo là một lỗi trong bài học, nói rõ khoá nào, chương nào, và câu nào — nó sẽ được sửa nhanh hơn nhiều.',
      ],
    },
    {
      h: 'Thay đổi',
      p: [
        'Khi việc xử lý dữ liệu đổi, trang này đổi theo, và ngày ở đầu trang đổi theo. Không có thông báo riêng nào được gửi đi.',
      ],
    },
  ],
};

const termsVi: LegalDoc = {
  title: 'Điều khoản sử dụng',
  updated: UPDATED,
  lede:
    'Đọc mục đầu tiên trước khi đọc bất cứ mục nào khác. Nó là mục quan trọng nhất trong trang, ' +
    'và nó nói về chất lượng của thứ bạn sắp học.',
  sections: [
    {
      h: 'Phần lớn nội dung ở đây do AI tạo ra',
      p: [
        'Đây là điều bạn cần biết trước tiên, và nó không nằm ở cuối trang bằng chữ nhỏ.',
        'Phần lớn giáo trình trên nền tảng này — văn bản, chứng minh, bài tập, số liệu, phần mềm minh hoạ — được sinh ra bởi mô hình ngôn ngữ, rồi được rà soát ở mức mà một dự án cộng đồng làm được. Rà soát ấy đã tìm ra và sửa hàng trăm lỗi, gồm cả những lỗi nằm trong chứng minh. Điều đó nói lên hai chuyện cùng lúc: nội dung được soi kỹ hơn vẻ ngoài của một trang web thông thường, và **vẫn còn lỗi chưa ai tìm ra**.',
        'Chúng tôi không tuyên bố nội dung ở đây là chính xác, đầy đủ, hay cập nhật.',
      ],
    },
    {
      h: 'Trách nhiệm chọn lọc và xác thực thuộc về người đọc',
      p: [
        'Bạn phải tự đánh giá và tự kiểm chứng mọi thứ bạn đọc ở đây trước khi tin hoặc dùng nó. Đối chiếu với sách giáo khoa, bài báo gốc, hoặc người có chuyên môn.',
        'Mỗi chương đều có mục ghi rõ giới hạn của chính nó và danh sách những kết quả nó mượn từ nơi khác. Hai mục ấy là chỗ bắt đầu tốt cho việc kiểm chứng — chúng tồn tại đúng để bạn kiểm được.',
        'Đừng dùng nội dung ở đây làm cơ sở cho quyết định có hậu quả thật — y tế, pháp lý, tài chính, an toàn kỹ thuật — mà không có người đủ chuyên môn xác nhận. Nội dung ở đây là tài liệu học tập, không phải lời khuyên chuyên môn.',
      ],
    },
    {
      h: 'Đây là dự án cộng đồng',
      p: [
        'Tự học được làm và duy trì như một dự án cộng đồng, phi lợi nhuận. Không có công ty đứng sau, không có đội ngũ trực, không có cam kết thời gian hoạt động.',
        'Dịch vụ được cung cấp "nguyên trạng". Nó có thể chậm, có thể lỗi, có thể ngừng, và có thể mất dữ liệu. Hãy tự giữ bản sao những ghi chú bạn thấy quan trọng.',
        'Chúng tôi có thể đổi, tạm dừng hoặc gỡ bất kỳ khoá học hay tính năng nào, bất cứ lúc nào.',
      ],
    },
    {
      h: 'Tài khoản của bạn',
      p: [
        'Bạn chịu trách nhiệm giữ mật khẩu và mọi việc xảy ra dưới tài khoản mình. Dùng một mật khẩu bạn chưa dùng ở nơi khác.',
        'Đừng dùng nền tảng để làm điều trái pháp luật, quấy rối người khác, hay phá hoại hệ thống. Chúng tôi có thể khoá tài khoản vi phạm mà không báo trước.',
      ],
    },
    {
      h: 'Trợ lý AI',
      p: [
        'Trợ lý chạy trên một tài khoản do dự án trả tiền, và mỗi tài khoản có một số dư tín dụng giới hạn. Hết tín dụng thì trợ lý ngừng cho tới khi được cấp thêm.',
        'Câu trả lời của trợ lý cũng do mô hình ngôn ngữ sinh ra, nên chịu đúng cảnh báo ở hai mục đầu trang này — có khi còn nặng hơn, vì nó trả lời tức thời và không qua vòng rà soát nào.',
        'Đừng dùng trợ lý để rút cạn tài nguyên, để bán lại quyền truy cập, hay để sinh nội dung vi phạm pháp luật.',
      ],
    },
    {
      h: 'Bản quyền và giấy phép',
      p: [
        'Các khoá học được phát hành theo giấy phép Creative Commons Ghi công 4.0 (CC BY 4.0), như khai trong tệp mô tả của từng khoá. Bạn được sao chép, sửa đổi và phân phối lại, kể cả cho mục đích thương mại, miễn là ghi công.',
        'Nếu bạn phân phối lại, hãy giữ nguyên lời khai rằng phần lớn nội dung do AI tạo ra. Bỏ lời khai ấy đi là truyền lại một tài liệu mà người nhận không có cách nào biết mình đang đọc gì.',
        'Ghi chú và bình luận bạn viết vẫn thuộc về bạn.',
      ],
    },
    {
      h: 'Giới hạn trách nhiệm',
      p: [
        'Trong phạm vi pháp luật cho phép, dự án và những người đóng góp không chịu trách nhiệm cho bất kỳ thiệt hại nào phát sinh từ việc bạn dùng nền tảng hoặc tin vào nội dung của nó.',
        'Câu trên không phải một mẹo pháp lý để né tránh: nó là hệ quả trực tiếp của hai mục đầu trang. Một dự án cộng đồng phát hành nội dung do máy sinh ra không thể bảo đảm điều nó không kiểm soát được, nên nó nói thẳng thay vì hứa suông.',
      ],
    },
    {
      h: 'Liên hệ',
      p: [
        `Mọi câu hỏi về trang này, yêu cầu xoá dữ liệu, hay báo một lỗi bạn tìm thấy trong nội dung: ${CONTACT}.`,
        'Dự án được duy trì bởi tình nguyện viên, nên trả lời có thể chậm. Nếu việc bạn báo là một lỗi trong bài học, nói rõ khoá nào, chương nào, và câu nào — nó sẽ được sửa nhanh hơn nhiều.',
      ],
    },
    {
      h: 'Thay đổi',
      p: [
        'Điều khoản có thể đổi. Bản mới có hiệu lực khi được đăng lên trang này, và ngày ở đầu trang đổi theo. Tiếp tục dùng nền tảng sau khi đổi nghĩa là bạn chấp nhận bản mới.',
      ],
    },
  ],
};

const privacyEn: LegalDoc = {
  title: 'Privacy',
  updated: UPDATED,
  lede:
    'Tự học is a non-commercial community project. This page states exactly what the system stores, ' +
    'what it does not, and who else sees your data. It was written from the real database schema, ' +
    'not copied from a template.',
  sections: [
    {
      h: 'Reading needs no account',
      p: [
        'Every course is readable without signing in. If you only read, we create no profile for you.',
        'An account buys one thing: your progress, notes and AI assistant balance follow you between devices.',
      ],
    },
    {
      h: 'What we store once you have an account',
      p: [
        '· Account — email address, display name (may be empty), a hashed password, and the time it was created. We never store a readable password.',
        '· Session — a session identifier and an expiry time, so you are not asked to sign in on every visit.',
        '· Progress — which chapters you marked as read, in which course, and when.',
        '· Notes — the note text and where it is anchored in the chapter.',
        '· Reading events — markers such as opening a chapter, with a small blob describing the event.',
        '· Course ratings and enrolments.',
        '· AI assistant — your credit balance and, per request: model name, input/output token counts, tool calls, web searches, and cost. If you set your own system prompt, that prompt is stored.',
        '· Admin log — administrator actions on accounts and credits, so what was done leaves a trace.',
      ],
    },
    {
      h: 'What we do not store',
      p: [
        'The content of your conversations with the AI assistant is not stored on the project’s servers. No table holds messages; what is recorded is token counts and cost, in order to charge credits.',
        'Your questions are still sent to the model provider to be answered — see below. That the project keeps no copy does not mean nobody else sees them.',
        'We use no advertising trackers, set no advertising cookies, and do not sell or trade your data.',
      ],
    },
    {
      h: 'Cookies',
      p: [
        'Exactly one: the session cookie. It is set only after you sign in, sent over a secure connection, and expires at the time recorded on the session.',
        'Your language choice is kept in your browser’s own storage and never sent to the server.',
      ],
    },
    {
      h: 'Others who touch the data',
      p: [
        'The project runs itself, but on other people’s infrastructure. The full list:',
        '· Neon — the database. Everything in the section above lives there.',
        '· Render — the API server, hosted in Singapore.',
        '· Cloudflare Pages — serves the web interface.',
        '· DeepSeek — the model provider for the AI assistant. Your question and the chapter context you are reading are sent there to produce an answer. The project uses a single account it pays for; you never hand us an API key.',
        '· Brave Search — only when the assistant uses its web search tool. The query is sent there.',
        '· GitHub — the discussion section under each course is embedded from GitHub Discussions. Anything you post there belongs to GitHub and their policy, not ours.',
        'Each of these has its own policy, and we do not control it.',
      ],
    },
    {
      h: 'Deleting your account',
      p: [
        `Write to ${CONTACT} and we delete it. Every table holding your data is linked to the account by a cascading delete, so removing the account removes progress, notes, events, AI usage history, ratings and credits at the same time.`,
        'Two exceptions, stated plainly: the database provider’s backups have their own lifetime and expire on their schedule; and comments you posted on GitHub Discussions must be deleted at GitHub.',
      ],
    },
    {
      h: 'Children',
      p: [
        `The project is not aimed at children under 13 and does not knowingly collect their data. If you are a parent and believe your child created an account, write to ${CONTACT} and we will delete it.`,
      ],
    },
    {
      h: 'Contact',
      p: [
        `Any question about this page, any request to delete data, or any error you find in the material: ${CONTACT}.`,
        'The project is maintained by volunteers, so replies may be slow. If you are reporting an error in the material, say which course, which chapter and which sentence — that gets fixed far faster.',
      ],
    },
    {
      h: 'Changes',
      p: [
        'When the data handling changes, this page changes, and the date at the top changes with it. No separate notice is sent.',
      ],
    },
  ],
};

const termsEn: LegalDoc = {
  title: 'Terms of Service',
  updated: UPDATED,
  lede:
    'Read the first section before any other. It is the most important thing on this page, ' +
    'and it is about the quality of what you are about to study.',
  sections: [
    {
      h: 'Most of the content here is AI-generated',
      p: [
        'This is the thing to know first, and it is not buried in small print at the bottom.',
        'Most of the coursework on this platform — prose, proofs, exercises, figures, interactive widgets — was produced by language models and then reviewed to the standard a community project can manage. That review found and fixed hundreds of errors, including errors inside proofs. That says two things at once: the material is scrutinised more than an ordinary web page, and **errors nobody has found yet remain**.',
        'We make no claim that anything here is accurate, complete, or current.',
      ],
    },
    {
      h: 'Selecting and verifying is the reader’s responsibility',
      p: [
        'You must judge and verify anything you read here before believing or relying on it. Check it against textbooks, original papers, or someone qualified.',
        'Every chapter carries a section stating its own limits and a ledger of the results it borrows from elsewhere. Those two sections are a good place to start checking — they exist precisely so that you can.',
        'Do not use this material as the basis for consequential decisions — medical, legal, financial, engineering safety — without confirmation from someone qualified. This is study material, not professional advice.',
      ],
    },
    {
      h: 'This is a community project',
      p: [
        'Tự học is built and maintained as a non-commercial community project. There is no company behind it, no staff on call, and no uptime commitment.',
        'The service is provided "as is". It may be slow, may break, may stop, and may lose data. Keep your own copy of notes that matter to you.',
        'We may change, suspend or remove any course or feature at any time.',
      ],
    },
    {
      h: 'Your account',
      p: [
        'You are responsible for your password and for everything done under your account. Use a password you have not used elsewhere.',
        'Do not use the platform to break the law, harass people, or attack the system. We may suspend an offending account without notice.',
      ],
    },
    {
      h: 'The AI assistant',
      p: [
        'The assistant runs on an account the project pays for, and each account has a limited credit balance. When credits run out the assistant stops until more are granted.',
        'The assistant’s answers are also generated by a language model, so the warnings in the first two sections apply to them — arguably more so, since they are produced on the spot and pass through no review at all.',
        'Do not use the assistant to drain resources, to resell access, or to generate unlawful content.',
      ],
    },
    {
      h: 'Copyright and licence',
      p: [
        'Courses are released under the Creative Commons Attribution 4.0 licence (CC BY 4.0), as declared in each course’s manifest. You may copy, adapt and redistribute them, including commercially, as long as you give credit.',
        'If you redistribute, keep the statement that most of the content is AI-generated. Removing it passes on a document whose reader has no way to know what they are reading.',
        'Notes and comments you write remain yours.',
      ],
    },
    {
      h: 'Limitation of liability',
      p: [
        'To the extent permitted by law, the project and its contributors are not liable for any damages arising from your use of the platform or your reliance on its content.',
        'That sentence is not a legal trick to dodge responsibility: it follows directly from the first two sections. A community project publishing machine-generated material cannot guarantee what it does not control, so it says so plainly instead of promising otherwise.',
      ],
    },
    {
      h: 'Contact',
      p: [
        `Any question about this page, any request to delete data, or any error you find in the material: ${CONTACT}.`,
        'The project is maintained by volunteers, so replies may be slow. If you are reporting an error in the material, say which course, which chapter and which sentence — that gets fixed far faster.',
      ],
    },
    {
      h: 'Changes',
      p: [
        'These terms may change. A new version takes effect when posted here, and the date at the top changes with it. Continuing to use the platform after a change means you accept the new version.',
      ],
    },
  ],
};

export const LEGAL: Record<LegalId, Record<Lang, LegalDoc>> = {
  privacy: { vi: privacyVi, en: privacyEn },
  terms: { vi: termsVi, en: termsEn },
};
