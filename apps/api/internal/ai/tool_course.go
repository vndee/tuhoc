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

	"github.com/vndee/tuhoc-api/internal/htmltext"
)

// CourseQuerier là bề mặt hẹp nhất courseTool cần từ store giáo trình. Task
// 11 (handler) nối interface này với catalog.Usecase thật:
//   - Manifest ánh xạ catalog.Usecase.GetPublished — trả về
//     PublicCourse.ManifestJSON, JSON thô (đã là dữ liệu có cấu trúc, không
//     phải HTML, nên không cần lọc thẻ).
//   - ChapterHTML ánh xạ catalog.Usecase.GetChapter — trả về HTML thô của
//     MỘT chương; courseTool.Run lọc thẻ trước khi đưa vào lượt hội thoại
//     với model (xem htmltext.Strip).
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
	stripped := htmltext.Strip(raw)
	// Cùng lớp phòng vệ như nhánh manifest phía trên — kiểm SAU htmltext.Strip
	// vì HTML thô có thể không rỗng (ví dụ chỉ có "<script>...</script>"
	// hay vài thẻ trống "<p></p>") mà vẫn strip ra chuỗi rỗng; đó cũng là
	// một trường hợp "không có gì để đọc" cần báo, không chỉ trường hợp
	// ChapterHTML trả "" trực tiếp.
	if strings.TrimSpace(stripped) == "" {
		return fmt.Sprintf("Note: chapter %q of course %q returned no readable content (no error, but no content either).", args.ChapterID, args.Slug), nil
	}
	return stripped, nil
}
