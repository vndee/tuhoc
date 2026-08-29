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

// TestCourseToolStripsAllRawTextTagBodies canh đúng điều review Task 5 buộc:
// stripRawTextTags phải kín cho cả MƯỜI thẻ mà golang.org/x/net/html.Tokenizer
// bật chế độ raw-text (xem chú thích tại stripRawTextTags trong
// tool_course.go), đo RIÊNG từng thẻ — không suy ra bất biến từ một thẻ đại
// diện (như <script> ở TestCourseToolStripsMarkupBeforeSendingToModel) rồi
// coi các thẻ còn lại là "chắc cũng vậy". Trước vòng sửa đầu, bảng
// stripRawTextTags chỉ có "script"/"style": tám thẻ dưới đây từng lọt nguyên
// văn `<payload>` (kèm dấu "<"/">" thật) ra đầu ra.
//
// Mỗi thẻ được thử CẢ HAI dạng, vì re-review vòng 2 đo được rằng chúng đi
// qua hai nhánh khác nhau hoàn toàn của stripTags:
//
//   - "/pair" (cặp mở/đóng đủ, "<TAG>...</TAG>"): tokenizer BẬT chế độ
//     raw-text thật — toàn thân tới thẻ đóng là MỘT TextToken duy nhất.
//     Đây là ca đã có từ vòng sửa đầu.
//   - "/self-closing" ("<TAG/>", không có thân, không có thẻ đóng riêng):
//     đo trực tiếp bằng golang.org/x/net/html (xem task-5-report.md, mục
//     "Vòng sửa 2") xác nhận điều NGƯỢC với giả thuyết ban đầu của vòng
//     review này — z.rawTag bị readStartTag gán CHỈ dựa vào tên thẻ, TRƯỚC
//     cả khi biết thẻ có tự đóng hay không, nên "<title/>" tự đóng CŨNG bật
//     chế độ raw-text cho lần z.Next() kế tiếp, giống hệt "<title>" mở
//     thường — không có chuyện "tự động quay lại tokenize bình thường".
//     Máy trạng thái CŨ (StartTagToken lẫn SelfClosingTagToken đều bật
//     skipping, chỉ EndTagToken mới tắt) không có đường tắt skipping cho
//     dạng tự đóng — vì không có EndTagToken nào của TAG đó tới sau — nên
//     toàn bộ phần chương CÒN LẠI sau "<TAG/>" biến mất, im lặng, không
//     phải chỉ thân thẻ (mà thẻ tự đóng vốn không có). Sửa đúng bằng cách
//     gọi z.NextIsNotRawText() trong case html.SelfClosingTagToken của
//     stripTags — xem chú thích tại đó để biết vì sao đây là một lựa chọn
//     CỐ Ý khác hành vi trình duyệt thật, không phải một hệ quả tự nhiên
//     của việc tách case. Ca "/self-closing" khẳng định thêm một điều ca
//     "/pair" không có: văn bản SAU thẻ (kể cả xuyên qua một thẻ lồng <b>)
//     còn nguyên — đó chính là bất biến bị phá.
func TestCourseToolStripsAllRawTextTagBodies(t *testing.T) {
	tags := []string{
		"script", "style", // đã canh ở hai test riêng phía trên; đo lại ở đây cho đủ bộ mười, không phá vỡ điều "một test cho mỗi thẻ".
		"iframe", "noembed", "noframes", "noscript", "plaintext", "textarea", "title", "xmp",
	}

	for _, tag := range tags {
		t.Run(tag+"/pair", func(t *testing.T) {
			// plaintext không có thẻ đóng thật theo đặc tả HTML5 (mọi byte
			// sau <plaintext> tới hết tài liệu đều là raw text) — chèn
			// "trước" TRƯỚC thẻ mở, không có "sau" sau thẻ đóng (không có
			// thẻ đóng để "sau" nằm sau nó một cách có ý nghĩa).
			var chapter string
			if tag == "plaintext" {
				chapter = "truoc <plaintext>payload <fake-tag>bad</fake-tag></plaintext>"
			} else {
				chapter = "truoc <" + tag + ">payload <fake-tag>bad</fake-tag></" + tag + "> sau"
			}

			out := runTool(t, `{"slug":"c","chapter_id":"c1"}`, withChapter(chapter))

			if strings.Contains(out, "<") {
				t.Errorf("<%s>: còn dấu \"<\" trong đầu ra: %q", tag, out)
			}
			if strings.Contains(out, "payload") {
				t.Errorf("<%s>: thân thẻ lọt vào context: %q", tag, out)
			}
			if !strings.Contains(out, "truoc") {
				t.Errorf("<%s>: mất văn bản đứng TRƯỚC thẻ: %q", tag, out)
			}
			if tag != "plaintext" && !strings.Contains(out, "sau") {
				t.Errorf("<%s>: mất văn bản đứng SAU thẻ: %q", tag, out)
			}
		})

		t.Run(tag+"/self-closing", func(t *testing.T) {
			// Dạng tự đóng không có thân để "payload" đại diện cho — bất
			// biến cần đo ở đây khác: PHẦN CÒN LẠI của chương sau "<TAG/>"
			// (kể cả xuyên qua một thẻ lồng <b>bold</b>) không được biến
			// mất. sau1/sau2 nằm hai bên <b> để phân biệt "mất một phần"
			// với "mất sạch từ <TAG/> trở đi" (đúng lỗi re-review mô tả).
			chapter := "truoc <" + tag + "/> sau1 <b>bold</b> sau2"

			out := runTool(t, `{"slug":"c","chapter_id":"c1"}`, withChapter(chapter))

			if strings.Contains(out, "<") {
				t.Errorf("<%s/>: còn dấu \"<\" trong đầu ra: %q", tag, out)
			}
			if !strings.Contains(out, "truoc") {
				t.Errorf("<%s/>: mất văn bản đứng TRƯỚC thẻ: %q", tag, out)
			}
			if !strings.Contains(out, "sau1") {
				t.Errorf("<%s/>: mất văn bản NGAY SAU thẻ tự đóng — dấu hiệu skipping bị kẹt true: %q", tag, out)
			}
			if !strings.Contains(out, "bold") {
				t.Errorf("<%s/>: mất chữ bên trong thẻ lồng <b> sau thẻ tự đóng: %q", tag, out)
			}
			if !strings.Contains(out, "sau2") {
				t.Errorf("<%s/>: mất văn bản Ở CUỐI chương, sau thẻ lồng <b>: %q", tag, out)
			}
		})
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
//
// Vòng review Task 5 chỉ ra out == "" quá yếu: gần như bất kỳ chuỗi nào —
// kể cả một câu sai hoàn toàn — cũng qua được kiểm tra đó. Test này thay
// bằng ba khẳng định cụ thể: câu lỗi phải bắt đầu bằng "Error:" (model cần
// nhận diện được đây là một lượt gọi công cụ thất bại, không phải nội dung
// course); câu lỗi phải nhắc "could not parse arguments" (đúng vấn đề thật
// — JSON hỏng — không phải một câu lỗi chung chung không nói lên gì); và
// store (fakeQuerier) không được gọi tới — args hỏng nghĩa là không có
// slug/chapter_id hợp lệ để gọi xuống store, giống hệt nguyên tắc
// TestCourseToolRequiresSlug áp cho trường hợp slug rỗng.
func TestCourseToolRejectsMalformedArgsAsText(t *testing.T) {
	f := &fakeQuerier{}
	tool := NewCourseTool(f)
	out, err := tool.Run(context.Background(), `{not json`)
	if err != nil {
		t.Fatalf("Run trả error Go thay vì văn bản: %v", err)
	}
	if !strings.HasPrefix(out, "Error:") {
		t.Errorf("câu lỗi không bắt đầu bằng \"Error:\", model khó nhận diện lượt gọi công cụ thất bại: %q", out)
	}
	if !strings.Contains(out, "could not parse arguments") {
		t.Errorf("câu lỗi không nói rõ vấn đề thật (JSON hỏng): %q", out)
	}
	if f.gotSlug != "" || f.gotChapterID != "" {
		t.Errorf("Run gọi store dù args không parse được — store thấy slug=%q chapter_id=%q", f.gotSlug, f.gotChapterID)
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

// TestCourseToolWarnsOnEmptyManifest canh lớp phòng vệ "thành công nhưng
// rỗng": nếu CourseQuerier.Manifest trả ("", nil) — không lỗi, nhưng cũng
// không có manifest — Run KHÔNG được trả một chuỗi rỗng im lặng cho model.
// Một chuỗi rỗng trong Message{Role: "tool"}.Content không có dấu hiệu gì
// để model biết đây là "course tồn tại nhưng manifest rỗng" khác với "lỗi
// lắp ráp Request ở tầng khác" hay bất kỳ lý do nào khác khiến model không
// nhận được gì.
func TestCourseToolWarnsOnEmptyManifest(t *testing.T) {
	out := runTool(t, `{"slug":"c"}`, withManifest(""))
	if out == "" {
		t.Fatal("Run trả chuỗi rỗng im lặng khi manifest rỗng nhưng không lỗi")
	}
	if !strings.Contains(out, "c") {
		t.Errorf("đầu ra không nhắc tới slug đã hỏi: %q", out)
	}
}

// TestCourseToolWarnsOnEmptyChapter: cùng lớp phòng vệ, cho nhánh chapter —
// ChapterHTML trả ("", nil) trực tiếp.
func TestCourseToolWarnsOnEmptyChapter(t *testing.T) {
	out := runTool(t, `{"slug":"c","chapter_id":"c1"}`, withChapter(""))
	if out == "" {
		t.Fatal("Run trả chuỗi rỗng im lặng khi ChapterHTML rỗng nhưng không lỗi")
	}
	if !strings.Contains(out, "c1") {
		t.Errorf("đầu ra không nhắc tới chapter_id đã hỏi: %q", out)
	}
}

// TestCourseToolWarnsOnChapterThatStripsToEmpty: một biến thể khác của
// "thành công nhưng rỗng" — ChapterHTML trả HTML KHÔNG rỗng (nên nhánh trên
// không bắt được), nhưng toàn bộ nội dung đó nằm trong các thẻ
// stripRawTextTags nên stripTags xoá sạch, để lại chuỗi rỗng sau khi lọc.
// Guard phải kiểm SAU stripTags, không chỉ kiểm ChapterHTML trả về có rỗng
// hay không.
func TestCourseToolWarnsOnChapterThatStripsToEmpty(t *testing.T) {
	out := runTool(t, `{"slug":"c","chapter_id":"c1"}`, withChapter(`<script>x()</script>`))
	if out == "" {
		t.Fatal("Run trả chuỗi rỗng im lặng khi HTML thô strip ra rỗng")
	}
	if !strings.Contains(out, "c1") {
		t.Errorf("đầu ra không nhắc tới chapter_id đã hỏi: %q", out)
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
