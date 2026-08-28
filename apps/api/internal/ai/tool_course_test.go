package ai

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// fakeQuerier là cài đặt giả của CourseQuerier dùng riêng cho test — không
// chạm Postgres, không chạm gói catalog. Nó ghi lại slug/chapterID vừa nhận
// (gotSlug/gotChapterID) để test xác nhận Run() thực sự chuyển tiếp đúng
// tham số xuống store, không phải trả cứng một giá trị đã cấu hình sẵn bất
// kể đầu vào.
type fakeQuerier struct {
	manifest    []byte
	manifestErr error
	chapterHTML string
	chapterErr  error

	gotSlug      string
	gotChapterID string
}

func (f *fakeQuerier) Manifest(ctx context.Context, slug string) ([]byte, error) {
	f.gotSlug = slug
	return f.manifest, f.manifestErr
}

func (f *fakeQuerier) ChapterHTML(ctx context.Context, slug, chapterID string) (string, error) {
	f.gotSlug = slug
	f.gotChapterID = chapterID
	return f.chapterHTML, f.chapterErr
}

// queryOption cấu hình một fakeQuerier trước khi runTool gọi Run() trên nó.
type queryOption func(*fakeQuerier)

func withManifest(json string) queryOption {
	return func(f *fakeQuerier) { f.manifest = []byte(json) }
}

func withManifestErr(err error) queryOption {
	return func(f *fakeQuerier) { f.manifestErr = err }
}

func withChapter(html string) queryOption {
	return func(f *fakeQuerier) { f.chapterHTML = html }
}

func withChapterErr(err error) queryOption {
	return func(f *fakeQuerier) { f.chapterErr = err }
}

// runTool dựng một fakeQuerier theo opts, chạy NewCourseTool(...).Run(...)
// với argsJSON, và đòi err == nil — đúng điều task-5-brief.md's Bước 3 yêu
// cầu: Run KHÔNG BAO GIỜ trả một error Go làm hỏng lượt của model, kể cả khi
// store bên dưới lỗi. Mọi trạng thái lỗi phải đi ra qua chuỗi trả về.
func runTool(t *testing.T, argsJSON string, opts ...queryOption) string {
	t.Helper()

	f := &fakeQuerier{}
	for _, o := range opts {
		o(f)
	}

	tool := NewCourseTool(f)
	out, err := tool.Run(context.Background(), argsJSON)
	if err != nil {
		t.Fatalf("Run trả một error Go thay vì văn bản — điều này làm hỏng lượt "+
			"gọi công cụ của model (xem task-5-brief.md Bước 3): %v", err)
	}
	return out
}

// TestCourseToolReturnsManifestWithoutChapterID: gọi không kèm chapter_id
// phải trả mục lục (manifest) — đây là cách model khám phá course có những
// chương nào trước khi xin đọc một chương cụ thể.
func TestCourseToolReturnsManifestWithoutChapterID(t *testing.T) {
	out := runTool(t, `{"slug":"c"}`, withManifest(`{"title":"Khoa hoc mau"}`))
	if !strings.Contains(out, "Khoa hoc mau") {
		t.Errorf("mục lục không có trong đầu ra: %q", out)
	}
}

// TestCourseToolReturnsChapterWithChapterID: gọi kèm chapter_id phải trả nội
// dung CHƯƠNG đó, không phải mục lục.
func TestCourseToolReturnsChapterWithChapterID(t *testing.T) {
	out := runTool(t, `{"slug":"c","chapter_id":"c1"}`, withChapter(`<p>hello chapter</p>`))
	if !strings.Contains(out, "hello chapter") {
		t.Errorf("nội dung chương không có trong đầu ra: %q", out)
	}
}

// TestCourseToolPassesSlugAndChapterIDThrough khẳng định Run thực sự CHUYỂN
// TIẾP slug/chapter_id từ argsJSON xuống store, chứ không trả cứng nội dung
// đã cấu hình sẵn bất kể input — một fakeQuerier trả cùng một giá trị dù
// nhận slug nào vẫn làm hai test phía trên xanh, nên cần một test riêng canh
// đúng việc CHUYỂN TIẾP tham số.
func TestCourseToolPassesSlugAndChapterIDThrough(t *testing.T) {
	f := &fakeQuerier{chapterHTML: "<p>x</p>"}
	tool := NewCourseTool(f)
	if _, err := tool.Run(context.Background(), `{"slug":"gioi-thieu-go","chapter_id":"ch-2"}`); err != nil {
		t.Fatalf("Run lỗi bất ngờ: %v", err)
	}
	if f.gotSlug != "gioi-thieu-go" {
		t.Errorf("slug chuyển tới store = %q, muốn %q", f.gotSlug, "gioi-thieu-go")
	}
	if f.gotChapterID != "ch-2" {
		t.Errorf("chapter_id chuyển tới store = %q, muốn %q", f.gotChapterID, "ch-2")
	}
}

// TestCourseToolStripsMarkupBeforeSendingToModel — nguyên văn Bước 2 của
// task-5-brief.md. Gửi HTML thô cho model là trả tiền token cho
// `<div class="...">` và cho một bề mặt tiêm prompt: nội dung chương do
// người soạn viết, và một thẻ chứa "bỏ qua hướng dẫn trước" đọc y như phần
// còn lại khi đã vào context.
func TestCourseToolStripsMarkupBeforeSendingToModel(t *testing.T) {
	out := runTool(t, `{"slug":"c","chapter_id":"c1"}`, withChapter(`<p>Xin <b>chào</b></p><script>x()</script>`))
	if strings.Contains(out, "<") {
		t.Errorf("còn thẻ trong đầu ra: %q", out)
	}
	if !strings.Contains(out, "Xin chào") {
		t.Errorf("mất chữ: %q", out)
	}
	if strings.Contains(out, "x()") {
		t.Errorf("thân <script> lọt vào context: %q", out)
	}
}

// TestCourseToolStripsStyleBodyToo: cùng lý do <script> phải biến mất hoàn
// toàn — CSS trong <style> không phải văn bản người học đọc, và cũng là một
// cách tốn token vô ích nếu lọt vào context. Đây là một quyết định tự đưa ra
// (brief chỉ nêu <script>), ghi lại trong task-5-report.md.
func TestCourseToolStripsStyleBodyToo(t *testing.T) {
	out := runTool(t, `{"slug":"c","chapter_id":"c1"}`, withChapter(`<style>.a{color:red}</style><p>noi dung</p>`))
	if strings.Contains(out, "color:red") {
		t.Errorf("thân <style> lọt vào context: %q", out)
	}
	if !strings.Contains(out, "noi dung") {
		t.Errorf("mất chữ: %q", out)
	}
}

// TestCourseToolReturnsTextErrorWhenCourseNotFound — Bước 3: slug không tồn
// tại phải trả một CHUỖI mà model đọc được để nói lại với người học, không
// phải một error Go làm hỏng lượt (runTool ở trên đã tự đòi err == nil).
func TestCourseToolReturnsTextErrorWhenCourseNotFound(t *testing.T) {
	out := runTool(t, `{"slug":"khong-ton-tai"}`, withManifestErr(errors.New("catalog: not found")))
	if out == "" {
		t.Fatal("đầu ra rỗng — model không có gì để đọc và nói lại với người học")
	}
	if !strings.Contains(out, "khong-ton-tai") {
		t.Errorf("đầu ra không nhắc tới slug đã hỏi, model khó nói lại đúng chuyện gì sai: %q", out)
	}
}

// TestCourseToolReturnsTextErrorWhenChapterNotFound: cùng tính chất, cho
// nhánh có chapter_id.
func TestCourseToolReturnsTextErrorWhenChapterNotFound(t *testing.T) {
	out := runTool(t, `{"slug":"c","chapter_id":"khong-ton-tai"}`, withChapterErr(errors.New("catalog: not found")))
	if out == "" {
		t.Fatal("đầu ra rỗng — model không có gì để đọc và nói lại với người học")
	}
	if !strings.Contains(out, "khong-ton-tai") {
		t.Errorf("đầu ra không nhắc tới chapter_id đã hỏi: %q", out)
	}
}

// TestCourseToolRejectsMalformedArgsAsText: argsJSON không parse được cũng
// không được panic hay trả error Go — cùng nguyên tắc Bước 3, áp cho một
// nguồn lỗi khác (đầu vào của chính model, không phải store).
func TestCourseToolRejectsMalformedArgsAsText(t *testing.T) {
	out := runTool(t, `{not json`)
	if out == "" {
		t.Fatal("đầu ra rỗng trên args hỏng")
	}
}

// TestCourseToolRequiresSlug: slug rỗng (hoặc vắng mặt) là một lỗi CÓ CHỮ,
// không phải một lời gọi store với slug rỗng.
func TestCourseToolRequiresSlug(t *testing.T) {
	f := &fakeQuerier{}
	tool := NewCourseTool(f)
	out, err := tool.Run(context.Background(), `{}`)
	if err != nil {
		t.Fatalf("Run trả error Go thay vì văn bản: %v", err)
	}
	if out == "" {
		t.Fatal("đầu ra rỗng khi thiếu slug")
	}
	if f.gotSlug != "" {
		t.Errorf("Run gọi store dù slug rỗng — store thấy slug = %q", f.gotSlug)
	}
}

// TestCourseToolDefinitionShape: Definition() phải khai tên "read_course",
// có tham số slug bắt buộc, chapter_id tuỳ chọn — đúng hình dạng Task 6/8 sẽ
// dựa vào khi lắp ToolRunner này vào vòng lặp gọi công cụ.
func TestCourseToolDefinitionShape(t *testing.T) {
	def := NewCourseTool(&fakeQuerier{}).Definition()

	if def.Type != "function" {
		t.Errorf("Type = %q, muốn %q", def.Type, "function")
	}
	if def.Function.Name != "read_course" {
		t.Errorf("Name = %q, muốn %q", def.Function.Name, "read_course")
	}

	props, ok := def.Function.Parameters["properties"].(map[string]any)
	if !ok {
		t.Fatalf("Parameters[\"properties\"] không phải map[string]any: %#v", def.Function.Parameters["properties"])
	}
	if _, ok := props["slug"]; !ok {
		t.Error("thiếu tham số slug trong schema")
	}
	if _, ok := props["chapter_id"]; !ok {
		t.Error("thiếu tham số chapter_id trong schema")
	}

	required, ok := def.Function.Parameters["required"].([]string)
	if !ok {
		t.Fatalf("Parameters[\"required\"] không phải []string: %#v", def.Function.Parameters["required"])
	}
	foundSlug, foundChapterID := false, false
	for _, r := range required {
		if r == "slug" {
			foundSlug = true
		}
		if r == "chapter_id" {
			foundChapterID = true
		}
	}
	if !foundSlug {
		t.Error("slug phải nằm trong required")
	}
	if foundChapterID {
		t.Error("chapter_id KHÔNG được nằm trong required — nó tuỳ chọn")
	}
}
