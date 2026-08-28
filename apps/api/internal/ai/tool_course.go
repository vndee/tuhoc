// tool_course.go cho agent (Pha 2) một cách ĐỌC giáo trình: cùng nguồn dữ
// liệu người học thấy — bảng published_* của Pha 1 (internal/catalog) —
// không có nguồn thứ hai nào khác. Task 6/8 lắp ToolRunner này vào vòng lặp
// gọi công cụ của model; Task 11 (handler) là nơi duy nhất nối CourseQuerier
// tới catalog.Usecase thật, nên gói này KHÔNG import internal/catalog — chỉ
// khai một interface hẹp vừa đủ dùng.
package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"golang.org/x/net/html"
)

// CourseQuerier là bề mặt hẹp nhất courseTool cần từ store giáo trình. Task
// 11 (handler) nối interface này với catalog.Usecase thật:
//   - Manifest ánh xạ catalog.Usecase.GetPublished — trả về
//     PublicCourse.ManifestJSON, JSON thô (đã là dữ liệu có cấu trúc, không
//     phải HTML, nên không cần lọc thẻ).
//   - ChapterHTML ánh xạ catalog.Usecase.GetChapter — trả về HTML thô của
//     MỘT chương; courseTool.Run lọc thẻ trước khi đưa vào lượt hội thoại
//     với model (xem stripTags bên dưới).
//
// Cả hai phương thức trả một error trần, không phân biệt "không tìm thấy"
// với lỗi khác — courseTool.Run cố tình không phân nhánh theo LOẠI lỗi (xem
// chú thích tại chỗ gọi), nên interface này không cần một sentinel error
// riêng để giữ hẹp nhất có thể.
type CourseQuerier interface {
	Manifest(ctx context.Context, slug string) ([]byte, error)
	ChapterHTML(ctx context.Context, slug, chapterID string) (string, error)
}

// ToolRunner là hình dạng chung một công cụ phải có để vòng lặp gọi công cụ
// (Task 6/8) dùng được nó mà không cần biết công cụ cụ thể là gì: Definition
// đi vào Request.Tools gửi cho DeepSeek, Run thực thi một ToolCall model vừa
// yêu cầu và trả về đúng chuỗi sẽ nằm trong Message{Role: "tool", ...}.Content
// của lượt tiếp theo.
type ToolRunner interface {
	Definition() Tool
	Run(ctx context.Context, argsJSON string) (string, error)
}

// courseTool là cài đặt ToolRunner duy nhất của tệp này — công cụ tên
// "read_course".
type courseTool struct {
	q CourseQuerier
}

// NewCourseTool dựng ToolRunner đọc giáo trình qua q.
func NewCourseTool(q CourseQuerier) ToolRunner {
	return &courseTool{q: q}
}

// Definition khai schema hai tham số: slug bắt buộc, chapter_id tuỳ chọn.
// Gọi không kèm chapter_id trả về mục lục (manifest) của course — cách model
// khám phá course có những chương nào; gọi kèm chapter_id trả về nội dung
// chương đó.
func (t *courseTool) Definition() Tool {
	return Tool{
		Type: "function",
		Function: ToolFunction{
			Name: "read_course",
			Description: "Read a published course. Call without chapter_id to get the " +
				"course's manifest (title, description, table of contents). Call again " +
				"with a chapter_id from that table of contents to read that chapter's text.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"slug": map[string]any{
						"type":        "string",
						"description": "The course's slug (its unique id in the catalog).",
					},
					"chapter_id": map[string]any{
						"type":        "string",
						"description": "Optional. The id of one chapter to read, from the course's manifest.",
					},
				},
				"required": []string{"slug"},
			},
		},
	}
}

// courseToolArgs là đúng shape JSON model gửi trong ToolCall.Function.Arguments.
type courseToolArgs struct {
	Slug      string `json:"slug"`
	ChapterID string `json:"chapter_id"`
}

// Run decode argsJSON, gọi CourseQuerier, và LUÔN trả về (text, nil) — không
// bao giờ (bất kỳ, non-nil error) — cho mọi trạng thái mà model có thể tự
// đọc và nói lại với người học: args hỏng, slug rỗng, course/chương không
// tồn tại, hay bất kỳ lỗi nào CourseQuerier trả về. Đây là quyết định có chủ
// đích (xem task-5-brief.md Bước 3, "một error Go làm hỏng lượt"): trả một
// error Go ở đây buộc vòng lặp gọi công cụ (Task 6/8) phải quyết định thay
// model — dừng lượt, retry, hay nuốt lỗi — trong khi model tự đọc được một
// câu "không tìm thấy course X" thì có thể tự quyết định bước tiếp theo
// (thử slug khác, hỏi lại người học, ...).
//
// Hệ quả của lựa chọn này: Run không phân biệt "slug không tồn tại" với
// "Postgres đang sập" — CourseQuerier là một interface trần (error, không
// phải một sentinel như catalog.ErrNotFound), nên tại đây không có cách nào
// phân biệt hai trường hợp mà không rộng interface ra hoặc import
// internal/catalog (cả hai điều brief cấm). Model nhận một câu chung
// "could not read course" cho cả hai — đủ để nó biết dừng lại và nói với
// người học, dù không đủ để nó biết ĐÂY LÀ LỖI TẠM THỜI hay VĨNH VIỄN. Ghi
// lại trong task-5-report.md như một điểm tự quyết định.
func (t *courseTool) Run(ctx context.Context, argsJSON string) (string, error) {
	var args courseToolArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return fmt.Sprintf("Error: could not parse arguments: %s", err), nil
	}
	if strings.TrimSpace(args.Slug) == "" {
		return "Error: slug is required.", nil
	}

	if args.ChapterID == "" {
		manifest, err := t.q.Manifest(ctx, args.Slug)
		if err != nil {
			return fmt.Sprintf("Error: could not read course %q: %s", args.Slug, err), nil
		}
		// CourseQuerier tự do trả ("", nil) hay (nil, nil) — thành công
		// nhưng không có nội dung (ví dụ một course tồn tại trong catalog
		// nhưng thiếu manifest do lỗi dữ liệu ở đâu đó khác). Không phân
		// biệt được đây là lỗi hay chỉ là dữ liệu rỗng nên KHÔNG gọi đây là
		// "Error" (khác nhánh err != nil ở trên) — nhưng vẫn phải là một
		// câu model đọc được, không phải chuỗi rỗng im lặng: chuỗi rỗng
		// trong Message{Role: "tool"}.Content không có dấu hiệu gì cho
		// model biết đây là "không có gì để đọc" thay vì "chương thật sự
		// trống trơn về nội dung" hay một lỗi lắp ráp Request ở tầng khác.
		if len(strings.TrimSpace(string(manifest))) == 0 {
			return fmt.Sprintf("Note: course %q returned an empty manifest (no error, but no content either).", args.Slug), nil
		}
		return string(manifest), nil
	}

	raw, err := t.q.ChapterHTML(ctx, args.Slug, args.ChapterID)
	if err != nil {
		return fmt.Sprintf("Error: could not read chapter %q of course %q: %s", args.ChapterID, args.Slug, err), nil
	}
	stripped := stripTags(raw)
	// Cùng lớp phòng vệ như nhánh manifest phía trên — kiểm SAU stripTags
	// vì HTML thô có thể không rỗng (ví dụ chỉ có "<script>...</script>"
	// hay vài thẻ trống "<p></p>") mà vẫn strip ra chuỗi rỗng; đó cũng là
	// một trường hợp "không có gì để đọc" cần báo, không chỉ trường hợp
	// ChapterHTML trả "" trực tiếp.
	if strings.TrimSpace(stripped) == "" {
		return fmt.Sprintf("Note: chapter %q of course %q returned no readable content (no error, but no content either).", args.ChapterID, args.Slug), nil
	}
	return stripped, nil
}

// stripHTMLBlockTags là các thẻ mà, khi mở hoặc đóng, đánh dấu một ranh giới
// khối văn xuôi — chèn một dòng mới ở đó để "Xin chào</p><p>tạm biệt" không
// dính liền thành "Xin chàotạm biệt" một khi thẻ đã biến mất. Các thẻ INLINE
// (b, i, span, a, strong, em, ...) CỐ TÌNH không có trong danh sách này —
// "Xin <b>chào</b>" phải ra "Xin chào" (một khoảng trắng, từ chính text node
// gốc " " trong "Xin "), không phải "Xin \nchào".
var stripHTMLBlockTags = map[string]bool{
	"p": true, "div": true, "br": true, "hr": true,
	"li": true, "ul": true, "ol": true,
	"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
	"tr": true, "table": true, "thead": true, "tbody": true,
	"blockquote": true, "section": true, "article": true,
	"header": true, "footer": true, "pre": true,
}

// stripRawTextTags là các thẻ mà TOÀN BỘ nội dung bên trong — không chỉ cặp
// thẻ mở/đóng — phải biến mất khỏi đầu ra.
//
// Đây là MƯỜI thẻ, không phải hai: golang.org/x/net/html.Tokenizer (bản
// v0.58.0 đang dùng, xem token.go dòng 844-860, hàm readRawOrRCDATA) tự
// chuyển sang "chế độ raw-text" sau MỘT trong mười thẻ mở này, và ở chế độ
// đó nó trả toàn bộ nội dung tới thẻ đóng tương ứng như MỘT TextToken duy
// nhất — không phân tích thẻ con bên trong nữa, dù nội dung ấy có trông
// giống hệt markup thật (`<script>x()</script>` là CHỮ trong TextToken đó,
// kèm dấu `<`/`>` thật). Một bảng chỉ có "script"/"style" bỏ sót tám thẻ còn
// lại — vòng review Task 5 đã đo bằng thực nghiệm rằng khi đó thân của cả
// tám thẻ lọt nguyên văn qua stripTags, phá đúng bất biến mà test của tệp
// này tự đặt ra (không còn dấu "<" trong đầu ra). Bảng dưới đây liệt kê đủ
// mười, chia ba nhóm theo LÝ DO xử lý (khác nhau) nhưng cùng một XỬ LÝ (xoá
// cả thân) — xem TestCourseToolStripsAllRawTextTagBodies, đo riêng từng thẻ,
// không suy ra từ một thẻ đại diện:
//
//  1. "script": brief (task-5-brief.md Bước 2) đòi rõ — thân là mã, không
//     phải văn bản người học đọc, và là bề mặt tiêm prompt trực tiếp nhất.
//  2. "style": tự thêm (brief không nêu) — CSS cũng không phải văn bản
//     người học đọc, cùng loại rác tốn token dù không cùng loại rủi ro tiêm
//     prompt như script.
//  3. "iframe", "noembed", "noframes", "noscript", "plaintext", "textarea",
//     "title", "xmp": tám thẻ HTML5 raw-text còn lại. Điểm chung của cả tám:
//     đặc tả HTML5 cho phép thân của chúng chứa bất kỳ chuỗi ký tự nào —
//     kể cả chuỗi trông giống hệt một thẻ khác — mà trình duyệt CỐ TÌNH
//     không diễn giải như markup (đó chính là lý do author dùng textarea/
//     xmp/plaintext để "hiện mã mà không cho nó chạy"). Với stripTags,
//     thuộc tính "an toàn vì trình duyệt không chạy nó" không có ý nghĩa gì
//     — đầu ra ở đây không phải HTML render trong trình duyệt, mà là văn
//     bản đưa thẳng vào context của model, và một chuỗi trông giống thẻ hệ
//     thống/công cụ (ví dụ giả một dấu phân cách vai trò) đọc y hệt thật một
//     khi đã nằm trong context — không có ranh giới "chỉ hiển thị, không
//     ảnh hưởng" như trong trình duyệt. Vì tầng này không có cách nào phân
//     biệt "author viết ví dụ mã vô hại trong <textarea>" với "kẻ tấn công
//     giấu chỉ thị trong <textarea>" — cả hai đều chỉ là một TextToken đơn
//     thuần — lựa chọn an toàn nhất là xử lý CẢ TÁM giống hệt script/style:
//     xoá sạch thân, không cố "vô hiệu hoá mà vẫn giữ chữ" (phương án (b) ở
//     task-5-report.md không được chọn — xem đó để biết vì sao).
//
// Đánh đổi CHẤP NHẬN: "title" mất nội dung. Đo trên fixtures/courses hiện
// có (không course nào dùng bất kỳ thẻ nào trong tám thẻ này ở nội dung
// chương thật — chỉ fixtures/format-v2/hostile/embedded-frame dùng iframe,
// và đó là ca CỐ TÌNH bị pkgcheck từ chối lúc publish, không phải nội dung
// hợp lệ) cho thấy đây không phải một mất mát đang xảy ra trong dữ liệu
// thật. Và ngay cả khi một chương có <title> hợp lệ, nội dung đó vốn đã
// trùng lặp: CourseQuerier.Manifest (không qua stripTags) đã mang tiêu đề
// course/chương riêng cho model đọc, nên một <title> lạc trong THÂN chương
// (đúng vị trí HTML của nó là <head>, không phải nội dung chương) không
// phải nguồn thông tin duy nhất bị mất — model vẫn có tiêu đề qua đường
// khác. Đánh đổi này đúng ở đây vì cả hai lý do cùng lúc: dữ liệu thật
// không dùng nó, và ngay cả khi dùng thì không mất thông tin không thể lấy
// lại ở nơi khác.
var stripRawTextTags = map[string]bool{
	"script":    true,
	"style":     true,
	"iframe":    true,
	"noembed":   true,
	"noframes":  true,
	"noscript":  true,
	"plaintext": true,
	"textarea":  true,
	"title":     true,
	"xmp":       true,
}

// stripTags lọc HTML thô của một chương thành văn bản thuần cho model đọc:
// bỏ mọi thẻ, giữ nguyên chữ, và xoá HẲN nội dung bên trong các thẻ trong
// stripRawTextTags (không chỉ cặp thẻ mở/đóng của chúng).
//
// Dùng golang.org/x/net/html.Tokenizer (đã có trong go.mod — không viết
// parser bằng regex, đúng yêu cầu task-5-brief.md) thay vì html.Parse/dựng
// cây DOM: tokenizer duyệt tuyến tính một lần, đúng đủ cho việc "đọc từng
// token, bỏ token nào không phải chữ" mà không cần cây — và tận dụng đúng
// một tính chất của tokenizer theo đặc tả HTML5: sau một thẻ mở nằm trong
// stripRawTextTags (mười thẻ — xem chú thích tại đó), MỌI byte tới thẻ đóng
// tương ứng được tokenizer trả về nguyên khối như MỘT text token duy nhất
// (raw text element), không tự ý phân tích tiếp thành thẻ con — nên "bỏ
// token text khi đang ở trong một thẻ thuộc stripRawTextTags" là đủ để xoá
// sạch thân thẻ, kể cả khi thân đó chứa những ký tự trông giống thẻ HTML
// (`x() ; if (a < b) ...`).
//
// Khác internal/pkgcheck/content.go's scanHTMLText — nơi gọi
// z.NextIsNotRawText() sau MỌI token, không điều kiện, để tắt HẲN chế độ
// raw-text cho toàn bộ tài liệu — hàm này chỉ gọi z.NextIsNotRawText() ở
// ĐÚNG MỘT chỗ: case html.SelfClosingTagToken bên dưới, và chỉ cho thẻ
// thuộc stripRawTextTags (xem chú thích tại case đó để biết vì sao). Với
// một thẻ MỞ THẬT (StartTagToken) trong stripRawTextTags, hàm này vẫn
// MUỐN tokenizer ở lại chế độ raw-text — mục đích chính là xoá sạch thân
// của đúng mười thẻ đó khi chúng thực sự có thân, không phải soi thẻ con
// bên trong chúng như scanHTMLText làm.
//
// # Vì sao dạng tự đóng ("<title/>") cần một xử lý riêng, và điều đo được
// LÀ SAI so với giả thuyết ban đầu
//
// Vòng review Task 5 (vòng 2) ban đầu giả thuyết "thẻ tự đóng không bao giờ
// khiến tokenizer bật chế độ raw-text" — SAI, và phép đo trực tiếp (viết
// một chương trình gọi thẳng html.Tokenizer, KHÔNG suy luận từ tài liệu)
// bác bỏ giả thuyết đó. Đọc readStartTag trong
// $(go env GOMODCACHE)/golang.org/x/net@v0.58.0/html/token.go (dòng
// ~844-859): z.rawTag được gán chỉ dựa vào TÊN thẻ — quyết định này xảy ra
// TRƯỚC cả khi hàm kiểm tra tự đóng hay không (đoạn "Look for a
// self-closing token" nằm SAU đoạn gán z.rawTag). Nghĩa là "<title/>" tự
// đóng cũng bật z.rawTag = "title" giống hệt "<title>" mở thường — lần gọi
// z.Next() TIẾP THEO sẽ nuốt mọi byte tới "</title>" (chữ, không phải thẻ
// thật) hoặc EOF làm MỘT text token duy nhất, dù thẻ vừa đọc là tự đóng.
// Đây thực ra khớp với đặc tả HTML5 thật: cú pháp tự đóng "/" vô nghĩa với
// phần tử raw-text (title/textarea là RCDATA, script/style/... là RAWTEXT)
// — trình duyệt thật CŨNG coi "<title/>" như một "<title>" chưa đóng, ăn
// tới "</title>" thật hoặc hết tài liệu.
//
// Nhưng đây KHÔNG phải hành vi ta muốn ở tầng lọc này. Một chương do AI
// sinh (xem manifest.json mẫu, generatedBy: "ai") hay một tác giả quen cú
// pháp tự đóng của các thẻ void thật (<br/>, <img/>) rất dễ viết
// "<title/>" với ý định "một thẻ trống, vô hại" — không ngờ nó âm thầm
// nuốt sạch toàn bộ phần chương còn lại (tới EOF nếu tài liệu không còn
// "</title>" nào khác, hoặc tệ hơn: tới một "</title>" hoàn toàn không
// liên quan nếu tình cờ có một cái xuất hiện sau đó — cắt nội dung ở một
// ranh giới ngẫu nhiên, khó dự đoán hơn cả "ăn tới EOF"). Với vai trò một
// bộ lọc trước khi đưa văn bản vào context model — không phải một trình
// render HTML — hậu quả im lặng và khó lường đó nghiêm trọng hơn việc giữ
// đúng ngữ nghĩa trình duyệt cho một cú pháp mà bản thân đặc tả coi là vô
// nghĩa ở vị trí đó.
//
// Vì vậy case html.SelfClosingTagToken bên dưới CHỦ ĐỘNG gọi
// z.NextIsNotRawText() cho mọi thẻ thuộc stripRawTextTags — xoá z.rawTag
// mà readStartTag vừa gán, để lần z.Next() tiếp theo tokenize BÌNH THƯỜNG
// (thẻ lồng như <b>bold</b> ngay sau "<title/>" ra đúng StartTag/Text/
// EndTag của nó). Điều này CỐ Ý khác hành vi trình duyệt thật cho đúng
// tám thẻ raw-text-nhưng-viết-tự-đóng — một đánh đổi có chủ đích, không
// phải sơ suất. Case html.StartTagToken (cặp mở/đóng thật) hoàn toàn không
// đổi — vẫn bật skipping bình thường, vẫn nuốt nguyên thân như một text
// token, đúng mục đích chính của hàm này.
//
// # "Nuốt tới hết tài liệu" ĐÚNG đặc tả vẫn còn, và vẫn giữ nguyên
//
// Sau khi sửa dạng tự đóng, "nuốt tới EOF" vẫn xảy ra cho một tình huống
// hợp lệ duy nhất: một thẻ MỞ THẬT (StartTagToken, không phải tự đóng)
// thuộc stripRawTextTags mà không có thẻ đóng tương ứng trong phần còn lại
// tài liệu (tác giả quên "</script>", hoặc "<plaintext>" — theo đặc tả
// HTML5 thẻ này vốn không có thẻ đóng, luôn ăn tới hết tài liệu). Trình
// duyệt thật xử lý y hệt: không có ranh giới nào khác để dừng đúng chỗ,
// nên "ăn tới EOF" ở ĐÂY là hành vi ĐÚNG, không phải một lỗi cần vá thêm.
// TestCourseToolStripsAllRawTextTagBodies's ca "plaintext/pair" canh riêng
// đúng hành vi này — đừng nhầm nó với lỗi thẻ-tự-đóng đã sửa ở trên.
func stripTags(rawHTML string) string {
	z := html.NewTokenizer(strings.NewReader(rawHTML))

	var sb strings.Builder
	skipping := false

	for {
		switch z.Next() {
		case html.ErrorToken:
			return normalizeStrippedText(sb.String())

		case html.StartTagToken:
			name, _ := z.TagName()
			tag := string(name)
			if stripRawTextTags[tag] {
				skipping = true
			}
			if stripHTMLBlockTags[tag] {
				sb.WriteByte('\n')
			}

		case html.SelfClosingTagToken:
			// CỐ TÌNH tách khỏi case StartTagToken ở trên. z.TagName() PHẢI
			// gọi trước z.NextIsNotRawText() — cả hai đọc/ghi trạng thái nội
			// bộ của z liên quan tới token vừa đọc, và thứ tự này khớp cách
			// internal/pkgcheck/content.go's scanHTMLText gọi
			// NextIsNotRawText (ngay sau z.Next(), trước khi dùng token).
			name, _ := z.TagName()
			tag := string(name)
			if stripRawTextTags[tag] {
				// z.rawTag vừa được readStartTag gán CHỈ DỰA VÀO TÊN thẻ —
				// xảy ra trước cả khi biết thẻ có tự đóng hay không (xem
				// chú thích "Vì sao dạng tự đóng..." phía trên hàm) — nên
				// KHÔNG can thiệp gì thì lần z.Next() kế tiếp vẫn nuốt mọi
				// thứ tới "</title>" (chữ) hay EOF làm một text token, y
				// hệt một thẻ mở thật, dù đây là thẻ tự đóng không có thân.
				// NextIsNotRawText() xoá z.rawTag đó — quyết định có chủ
				// đích, không phải hành vi trình duyệt thật (xem chú thích
				// trên hàm): thẻ tự đóng ở tầng lọc NÀY được coi là "trống,
				// không có gì để xoá", không phải "mở một vùng raw-text
				// không đáy". KHÔNG bật skipping ở đây — không có thân nào
				// để xoá.
				z.NextIsNotRawText()
			}
			if stripHTMLBlockTags[tag] {
				sb.WriteByte('\n')
			}

		case html.EndTagToken:
			name, _ := z.TagName()
			tag := string(name)
			if stripRawTextTags[tag] {
				skipping = false
			}
			if stripHTMLBlockTags[tag] {
				sb.WriteByte('\n')
			}

		case html.TextToken:
			if !skipping {
				sb.Write(z.Text())
			}

			// html.CommentToken, html.DoctypeToken: bỏ qua — không phải văn
			// bản người học đọc.
		}
	}
}

// normalizeStrippedText gộp khoảng trắng thừa mà bước lọc thẻ để lại: mỗi
// dòng được cắt hai đầu, dòng rỗng liên tiếp gộp thành một dòng trống duy
// nhất, và toàn khối được cắt hai đầu — đúng mức "gọn cho model đọc", không
// đi xa hơn (không đụng tới khoảng trắng NẰM TRONG một dòng chữ, ví dụ hai
// khoảng trắng liền trong văn bản gốc vẫn giữ nguyên).
func normalizeStrippedText(s string) string {
	lines := strings.Split(s, "\n")
	out := make([]string, 0, len(lines))
	prevBlank := true // nuốt dòng trống dẫn đầu
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			if prevBlank {
				continue
			}
			prevBlank = true
			out = append(out, "")
			continue
		}
		prevBlank = false
		out = append(out, line)
	}
	// Cắt dòng trống ở cuối (do nuốt-dòng-trống-dẫn-đầu chỉ xử lý đầu khối).
	for len(out) > 0 && out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	return strings.Join(out, "\n")
}
