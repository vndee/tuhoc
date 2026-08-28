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
		return string(manifest), nil
	}

	raw, err := t.q.ChapterHTML(ctx, args.Slug, args.ChapterID)
	if err != nil {
		return fmt.Sprintf("Error: could not read chapter %q of course %q: %s", args.ChapterID, args.Slug, err), nil
	}
	return stripTags(raw), nil
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
// thẻ mở/đóng — phải biến mất khỏi đầu ra. "script" là điều task-5-brief.md
// đòi rõ ("thân <script> phải biến mất hoàn toàn — không chỉ thẻ mà cả nội
// dung bên trong", vì thân <script> là mã, không phải văn bản người học đọc,
// và một chương có thể chứa bất cứ gì ở đó). "style" là một quyết định tự
// thêm (không có trong brief): CSS trong <style> cũng không phải văn bản
// người học đọc, và cũng tốn token vô ích nếu lọt vào context — cùng lý do,
// không phải một bề mặt tiêm prompt riêng nhưng cùng một loại rác. Ghi lại
// trong task-5-report.md.
var stripRawTextTags = map[string]bool{
	"script": true,
	"style":  true,
}

// stripTags lọc HTML thô của một chương thành văn bản thuần cho model đọc:
// bỏ mọi thẻ, giữ nguyên chữ, và xoá HẲN nội dung bên trong các thẻ trong
// stripRawTextTags (không chỉ cặp thẻ mở/đóng của chúng).
//
// Dùng golang.org/x/net/html.Tokenizer (đã có trong go.mod — không viết
// parser bằng regex, đúng yêu cầu task-5-brief.md) thay vì html.Parse/dựng
// cây DOM: tokenizer duyệt tuyến tính một lần, đúng đủ cho việc "đọc từng
// token, bỏ token nào không phải chữ" mà không cần cây — và tận dụng đúng
// một tính chất của tokenizer theo đặc tả HTML5: sau một thẻ mở <script>
// hoặc <style>, MỌI byte tới thẻ đóng tương ứng được tokenizer trả về nguyên
// khối như MỘT text token duy nhất (raw text element), không tự ý phân tích
// tiếp thành thẻ con — nên "bỏ token text khi đang ở trong script/style" là
// đủ để xoá sạch thân thẻ, kể cả khi thân đó chứa những ký tự trông giống
// thẻ HTML (`x() ; if (a < b) ...`).
func stripTags(rawHTML string) string {
	z := html.NewTokenizer(strings.NewReader(rawHTML))

	var sb strings.Builder
	skipping := false

	for {
		switch z.Next() {
		case html.ErrorToken:
			return normalizeStrippedText(sb.String())

		case html.StartTagToken, html.SelfClosingTagToken:
			name, _ := z.TagName()
			tag := string(name)
			if stripRawTextTags[tag] {
				skipping = true
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
