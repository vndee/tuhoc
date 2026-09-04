package search

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/vndee/tuhoc-api/internal/htmltext"
)

// Giới hạn của một truy vấn, và lý do từng con số.
const (
	// MinQueryRunes: dưới hai ký tự thì mọi truy vấn khớp gần như mọi
	// chương, và kết quả trả về là tiếng ồn chứ không phải câu trả lời.
	// Đếm bằng RUNE, không phải byte: "học" là ba rune và bảy byte, và một
	// ngưỡng tính theo byte sẽ nhận nó nhưng từ chối "ab".
	MinQueryRunes = 2

	// MaxQueryBytes chặn phía trên. Một truy vấn dài hơn số này không phải
	// một truy vấn — nó là một đoạn văn dán nhầm, hoặc một cách bắt server
	// quét cả kho với một mẫu không bao giờ khớp.
	MaxQueryBytes = 128

	// DefaultLimit là số hit chương cho bảng thả xuống ở thanh trên: đủ để
	// thấy có gì, không đủ để phải cuộn trong một bảng nổi.
	DefaultLimit = 8

	// MaxLimit là trần cho trang /search. Trần THẬT, không phải "không giới
	// hạn": trang ấy cũng hiện cờ truncated khi còn nữa.
	MaxLimit = 30

	// snippetContextRunes là số rune lấy mỗi bên chỗ khớp. Tính theo rune vì
	// cắt theo byte sẽ xẻ đôi một ký tự tiếng Việt và sinh ra U+FFFD.
	snippetContextRunes = 80
)

// ErrQueryTooShort và ErrQueryTooLong là hai lý do một truy vấn bị từ chối.
// Handler dịch cả hai thành 400 — tách ra để thông điệp nói đúng cái nào.
var (
	ErrQueryTooShort = errors.New("search: query is shorter than the minimum")
	ErrQueryTooLong  = errors.New("search: query is longer than the maximum")
	// ErrQueryInvalid: truy vấn không phải UTF-8 hợp lệ, hoặc chứa NUL. Cả
	// hai là lỗi của NGƯỜI GỌI và phải ra 400 — xem NormalizeQuery cho hai
	// đường mà chúng biến thành 500 nếu không chặn ở đây.
	ErrQueryInvalid = errors.New("search: query is not valid UTF-8")
)

// CourseHit là một khoá khớp.
type CourseHit struct {
	Slug        string
	Title       string
	Description string
}

// ChapterHit là một chương khớp, kèm đoạn trích ĐÃ CHIA BA MẢNH.
//
// Ba mảnh, không phải một chuỗi kèm chỉ số: Go đếm theo rune, JavaScript đếm
// theo đơn vị UTF-16. Tiếng Việt nằm gọn trong BMP nên hai cách đếm trùng
// nhau và MỌI bài test viết bằng tiếng Việt sẽ xanh — rồi một emoji trong
// bài làm chỗ tô sáng trượt đi một quãng, ở production, không ai bắt được.
// Ba mảnh thì không có phép tính chỉ số nào để mà sai.
//
// Before và After có thể mang "…" ở đầu/cuối khi đoạn trích bị cắt; phần tô
// sáng ở client vì thế không phải tự thêm gì.
type ChapterHit struct {
	Slug         string
	CourseTitle  string
	ChapterID    string
	ChapterTitle string
	Before       string
	Match        string
	After        string
}

// Results là toàn bộ câu trả lời cho một truy vấn.
type Results struct {
	Courses   []CourseHit
	Chapters  []ChapterHit
	Truncated bool
}

// Usecase giữ luật của gói: kiểm truy vấn, lọc chặng hai, cắt đoạn trích,
// và sắp kết quả. Không nói SQL và không biết gì về HTTP.
type Usecase struct {
	repo *Repo
}

// NewUsecase dựng Usecase trên repo.
func NewUsecase(repo *Repo) *Usecase { return &Usecase{repo: repo} }

// NormalizeQuery cắt khoảng trắng hai đầu và kiểm hai ngưỡng.
func NormalizeQuery(raw string) (string, error) {
	q := strings.TrimSpace(raw)
	if len(q) > MaxQueryBytes {
		return "", ErrQueryTooLong
	}
	// Hai phép kiểm này đứng TRƯỚC phép đếm rune, và cả hai đều phải có.
	//
	// utf8.RuneCountInString đếm MỖI byte hỏng là một rune, nên "\xff\xfe"
	// đếm ra 2 và lọt qua ngưỡng tối thiểu. Nó đi tiếp tới regexp.Compile,
	// hàm ấy từ chối UTF-8 không hợp lệ, và lỗi trả về đi vào nhánh 500 —
	// mang theo NGUYÊN BYTE truy vấn vào log ("invalid UTF-8: `\xff\xfe`").
	// Đó là 500 cho một lỗi của người gọi, và nó vòng qua đúng bất biến mà
	// apilog tự đặt cho mình: ghi c.Path(), không bao giờ ghi chuỗi truy vấn.
	//
	// NUL thì hợp lệ theo UTF-8 nhưng Postgres từ chối nó trong kiểu text
	// (SQLSTATE 22021), nên nó cũng thành 500 — ở tận tầng SQL, sau khi đã
	// mở một kết nối.
	if !utf8.ValidString(q) || strings.ContainsRune(q, 0) {
		return "", ErrQueryInvalid
	}
	if utf8.RuneCountInString(q) < MinQueryRunes {
		return "", ErrQueryTooShort
	}
	return q, nil
}

// ClampLimit kẹp limit về khoảng dùng được. Số không hợp lệ (0, âm, không
// phải số) rơi về mặc định chứ không thành lỗi: một tham số truy vấn hỏng
// không đáng làm hỏng cả một lượt tìm kiếm.
func ClampLimit(n int) int {
	switch {
	case n <= 0:
		return DefaultLimit
	case n > MaxLimit:
		return MaxLimit
	default:
		return n
	}
}

// manifestChapter là chỗ đứng của một chương trong manifest: tên để hiện, và
// thứ tự để sắp.
type manifestChapter struct {
	title string
	order int
}

// chapterIndex đọc manifest thành map chapter_id -> (tên, thứ tự).
//
// Manifest hỏng KHÔNG phải lỗi của lượt tìm kiếm: trả về map rỗng và để mọi
// hit của khoá ấy rơi về tên dự phòng. Một chương có thật, có nội dung khớp,
// biến mất khỏi kết quả chỉ vì JSON của khoá bị lỗi là cách hỏng tệ hơn hẳn
// một cái tên xấu.
func chapterIndex(raw json.RawMessage) map[string]manifestChapter {
	out := map[string]manifestChapter{}
	if len(raw) == 0 {
		return out
	}
	var m struct {
		Parts []struct {
			Chapters []struct {
				ID    string `json:"id"`
				Title string `json:"title"`
			} `json:"chapters"`
		} `json:"parts"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return out
	}
	order := 0
	for _, p := range m.Parts {
		for _, ch := range p.Chapters {
			if _, seen := out[ch.ID]; seen {
				continue
			}
			out[ch.ID] = manifestChapter{title: ch.Title, order: order}
			order++
		}
	}
	return out
}

// snippetAround tìm chỗ khớp đầu tiên trong text và cắt một đoạn quanh nó.
//
// Trả về ok=false khi KHÔNG tìm thấy — và đó chính là chặng lọc thứ hai (xem
// repo.go): text ở đây là văn bản ĐÃ GỠ THẺ, nên một truy vấn chỉ khớp trong
// markup (`class="entropy"`) tới đây là hết đường.
func snippetAround(text string, re *regexp.Regexp) (before, match, after string, ok bool) {
	loc := re.FindStringIndex(text)
	if loc == nil {
		return "", "", "", false
	}

	// Chuyển sang rune trước khi cắt. Chỉ số của regexp là BYTE; cắt thẳng
	// theo byte sẽ xẻ đôi một ký tự có dấu ở đúng mép đoạn trích.
	head := []rune(text[:loc[0]])
	match = text[loc[0]:loc[1]]
	tail := []rune(text[loc[1]:])

	if len(head) > snippetContextRunes {
		before = "…" + string(head[len(head)-snippetContextRunes:])
	} else {
		before = string(head)
	}
	if len(tail) > snippetContextRunes {
		after = string(tail[:snippetContextRunes]) + "…"
	} else {
		after = string(tail)
	}
	return before, match, after, true
}

// Search chạy cả hai chặng và trả về câu trả lời đã sắp.
func (u *Usecase) Search(ctx context.Context, q string, limit int) (Results, error) {
	// Kẹp lại Ở ĐÂY dù handler đã gọi ClampLimit. Không phải phòng thủ thừa:
	// `kept[:limit]` phía dưới panic với limit âm, và thứ duy nhất chặn nó
	// là một hàm nằm NGOÀI phương thức này. Hai gói hàng xóm (userdata,
	// catalog) đều đặt luật bên trong usecase; ở đây nó nằm ngoài, và cái
	// giá của việc ấy là một panic cách một chỗ gọi mới.
	limit = ClampLimit(limit)

	// (?i) cho khớp không phân biệt hoa thường ĐÚNG THEO UNICODE, và
	// FindStringIndex trả chỉ số trong chuỗi GỐC. Cách kia — hạ chuỗi về
	// chữ thường rồi tìm — cho chỉ số trong chuỗi đã hạ, mà phép hạ chữ có
	// thể đổi độ dài byte (ví dụ U+0130), nên chỉ số ấy không ánh xạ ngược
	// được về bản gốc. QuoteMeta làm mọi ký tự trong truy vấn thành chữ
	// thường theo nghĩa đen: người dùng gõ ".*" thì tìm ".*", không phải
	// một biểu thức chính quy khớp mọi thứ.
	re, err := regexp.Compile("(?i)" + regexp.QuoteMeta(q))
	if err != nil {
		// Không tới được sau khi NormalizeQuery đã kiểm UTF-8: QuoteMeta
		// thoát mọi ký tự đặc biệt, nên chỉ byte hỏng mới làm hỏng mẫu. Vẫn
		// bọc theo quy ước của gói — một lỗi trần ở đây sẽ vào apilog mà
		// không mang tên gói nào.
		return Results{}, fmt.Errorf("search: compile query pattern: %w", err)
	}

	courses, err := u.repo.SearchCourses(ctx, q, limit+1)
	if err != nil {
		return Results{}, err
	}
	truncated := len(courses) > limit
	if truncated {
		courses = courses[:limit]
	}

	candidates, err := u.repo.SearchChapters(ctx, q)
	if err != nil {
		return Results{}, err
	}
	// SQL chạm trần thì phía sau còn gì không ai biết — nói ra thay vì trả
	// về một danh sách trông như đã đầy đủ.
	if len(candidates) >= maxCandidates {
		truncated = true
	}

	slugs := make([]string, 0, len(candidates))
	seen := map[string]bool{}
	for _, c := range candidates {
		if !seen[c.Slug] {
			seen[c.Slug] = true
			slugs = append(slugs, c.Slug)
		}
	}
	manifests, err := u.repo.ManifestsFor(ctx, slugs)
	if err != nil {
		return Results{}, err
	}
	index := make(map[string]map[string]manifestChapter, len(manifests))
	for slug, raw := range manifests {
		index[slug] = chapterIndex(raw)
	}

	type ranked struct {
		hit   ChapterHit
		order int
	}
	kept := make([]ranked, 0, len(candidates))
	for _, c := range candidates {
		// Gỡ thẻ CHỈ KHI cần. Kể từ 0012, plain_text được dựng sẵn lúc publish
		// (catalog/repo.go), nên đường thường không gỡ gì cả — đo trên chương
		// lớn nhất thật, mỗi lần gỡ tốn 227 µs và ~213 KB cấp phát, và nó chạy
		// trên MỌI ứng viên trước khi `limit` cắt bất cứ thứ gì.
		text := c.Text
		if c.NeedsStrip {
			text = htmltext.Strip(text)
		}
		before, match, after, ok := snippetAround(text, re)
		if !ok {
			continue // chặng hai: chỉ khớp trong markup
		}
		// math.MaxInt, KHÔNG phải len(candidates)+1. Hai con số ở hai thang
		// đo khác nhau: `order` từ chapterIndex đếm trong manifest CỦA MỘT
		// KHOÁ, còn len(candidates) đếm số dòng SQL trả về cho CẢ truy vấn.
		// Một khoá 40 chương mà truy vấn chỉ khớp 2 thì dự phòng bằng 3, và
		// chương mồ côi nhảy lên TRƯỚC chương ở vị trí 10 — tức nó "xuống
		// cuối" hay "lên đầu" tuỳ vào một truy vấn chẳng liên quan rộng bao
		// nhiêu. TestSearchOrphanChapterSinksToBottom canh đúng ca ấy.
		title, order := c.ChapterID, math.MaxInt // dự phòng: xuống cuối
		if mc, found := index[c.Slug][c.ChapterID]; found {
			if mc.title != "" {
				title = mc.title
			}
			order = mc.order
		}
		kept = append(kept, ranked{
			hit: ChapterHit{
				Slug: c.Slug, CourseTitle: c.CourseTitle,
				ChapterID: c.ChapterID, ChapterTitle: title,
				Before: before, Match: match, After: after,
			},
			order: order,
		})
	}

	// Nhóm theo khoá (tên khoá), rồi theo thứ tự MỤC LỤC trong khoá đó.
	// chapter_id là mốc phá hoà cuối cùng để hai lần chạy giống hệt nhau
	// cho cùng một thứ tự — không phải một ý nghĩa hiển thị nào.
	sort.SliceStable(kept, func(i, j int) bool {
		a, b := kept[i], kept[j]
		if a.hit.CourseTitle != b.hit.CourseTitle {
			return a.hit.CourseTitle < b.hit.CourseTitle
		}
		if a.order != b.order {
			return a.order < b.order
		}
		return a.hit.ChapterID < b.hit.ChapterID
	})

	if len(kept) > limit {
		truncated = true
		kept = kept[:limit]
	}
	chapters := make([]ChapterHit, len(kept))
	for i, k := range kept {
		chapters[i] = k.hit
	}

	return Results{Courses: courses2hits(courses), Chapters: chapters, Truncated: truncated}, nil
}

// courses2hits đổi ứng viên khoá thành hit. Không có chặng lọc nào ở giữa —
// tiêu đề và mô tả là chữ thuần, không phải HTML (xem CourseCandidate).
func courses2hits(in []CourseCandidate) []CourseHit {
	out := make([]CourseHit, len(in))
	for i, c := range in {
		out[i] = CourseHit{Slug: c.Slug, Title: c.Title, Description: c.Description}
	}
	return out
}
