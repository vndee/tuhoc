// Package search phục vụ GET /search: tìm một chuỗi trong danh mục công
// khai — tiêu đề khoá, mô tả, tên chương, và NGUYÊN VĂN nội dung chương.
//
// Chia theo khuôn internal/userdata: tệp này (repo.go) là nơi DUY NHẤT nói
// SQL, usecase.go giữ luật và phép cắt đoạn trích, handler.go giữ phần HTTP.
//
// # Vì sao lọc hai chặng, và chặng thứ hai đóng cái gì
//
// SQL ở đây chỉ lọc THÔ. Kể từ migration 0012 nó quét plain_text — văn bản
// đã gỡ thẻ, dựng sẵn lúc publish — nên hai chuyện xảy ra cùng lúc: chi phí
// mỗi lượt tìm rơi hẳn, và cái bẫy `<div class="entropy">` khớp một truy vấn
// "entropy" biến mất ngay từ SQL.
//
// Chặng hai VẪN CÒN, và không phải vì quán tính: một chương publish trước
// 0012 có plain_text NULL, và với nó câu truy vấn rơi về quét html thô — đúng
// tình trạng cũ, đúng cái bẫy cũ.
//
// Chặng hai nằm ở usecase.go: gỡ thẻ rồi TÌM LẠI chuỗi trong văn bản sạch,
// không thấy thì bỏ hit. Nên hàm ở đây trả về ỨNG VIÊN, không phải kết quả —
// tên các phương thức nói đúng điều đó, và số dòng chúng trả về luôn nhiều
// hơn số kết quả cuối cùng.
//
// Chiều ngược lại không tồn tại: chặng hai chỉ có thể BỎ BỚT ứng viên, không
// thêm được. Nên mọi thứ SQL bỏ sót là bỏ sót vĩnh viễn — xem likePattern
// cho một trường hợp như thế (một từ bị thẻ inline cắt đôi).
package search

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/vndee/tuhoc-api/internal/catalog"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// maxCandidates chặn số dòng chương SQL trả về cho MỘT truy vấn.
//
// Đây là một cái trần thật, không phải một con số cho đẹp: mỗi dòng mang
// nguyên văn HTML của một chương (hàng chục KB), và một truy vấn một-ký-tự-
// phổ-biến khớp mọi chương trong hệ thống. Không có trần này, "e" kéo cả
// kho giáo trình vào bộ nhớ của một request.
//
// Hệ quả được chấp nhận và nói ra: khi số ứng viên chạm trần, kết quả trả
// về được đánh dấu truncated — người dùng thấy "còn nữa" chứ không thấy một
// danh sách trông như đã đầy đủ.
const maxCandidates = 200

// CourseCandidate là một khoá khớp ở tiêu đề hoặc mô tả. Khác chương, hit
// khoá KHÔNG qua chặng lọc thứ hai: hai cột này là chữ thuần, không phải
// HTML, nên không có markup nào để khớp nhầm.
type CourseCandidate struct {
	Slug        string
	Title       string
	Description string
}

// ChapterCandidate là một chương mà SQL thấy khớp.
//
// Text là văn bản để tìm trong và cắt đoạn trích từ đó. Nó đi kèm ngay đây
// chứ không lấy sau, vì gọi lại từng chương một là N+1 truy vấn cho đúng dữ
// liệu vừa có trong tay.
//
// NeedsStrip cho biết Text còn là HTML thô hay đã là văn bản thuần. Kể từ
// migration 0012, published_chapters.plain_text được dựng sẵn lúc publish, nên
// đường thường là "đã thuần" và chặng hai chỉ còn là một phép tìm chuỗi. Một
// chương publish TRƯỚC 0012 có plain_text NULL cho tới khi
// catalog.BackfillPlainText chạy; với nó, Text là HTML thô và người gọi phải
// tự gỡ thẻ.
//
// Cờ này thà có mà thừa còn hơn thiếu: cách khác là lọc thẳng
// `WHERE plain_text ILIKE $1`, và khi ấy mọi chương chưa dẫn xuất biến mất
// khỏi mọi kết quả mà không có tín hiệu nào.
type ChapterCandidate struct {
	Slug        string
	CourseTitle string
	ChapterID   string
	Text        string
	NeedsStrip  bool
}

// Repo là tầng SQL của gói. Không giữ luật nào.
type Repo struct {
	pool *pgxpool.Pool
}

// NewRepo dựng Repo trên pool.
func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

// likePattern bọc q thành mẫu ILIKE '%q%', SAU KHI thoát ba ký tự có nghĩa
// đặc biệt với LIKE.
//
// Không thoát thì `%` khớp MỌI chương trong hệ thống và `_` khớp mọi ký tự
// đơn — hai hành vi người gõ không hề yêu cầu. Thứ tự thay thế quan trọng:
// `\` phải đi trước, nếu không nó thoát lại chính những dấu vừa thêm vào.
//
// Ký tự thoát là `\` — mặc định của Postgres cho LIKE, nên không mệnh đề
// ESCAPE nào cần viết ra ở các truy vấn bên dưới.
//
// # Cái phép thoát này CỨU, và cái nó không cứu
//
// Nó KHÔNG cứu tính đúng của kết quả. Đo rồi: gỡ hẳn nó đi thì mọi bài test
// đi qua HTTP vẫn xanh, vì chặng lọc thứ hai (usecase.go) bỏ sạch những hit
// mà một mẫu quá rộng kéo về. Thứ nó cứu là CHI PHÍ — không có nó, truy vấn
// "%%" kéo maxCandidates dòng, mỗi dòng hàng chục KB HTML, vào bộ nhớ của
// một request để rồi vứt gần hết.
//
// Nó cũng không cứu khỏi một mẫu hỏng cú pháp, vì không có mẫu nào hỏng được:
// hàm luôn đóng bằng "%", nên một "\" ở cuối truy vấn thành "\%" — hợp lệ.
// Ghi ra đây vì bản nháp đầu của gói này khẳng định ngược lại và viết hẳn một
// bài test cho điều đó; bài ấy xanh cả khi phép thoát đã bị gỡ.
func likePattern(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(q) + "%"
}

// SearchCourses trả về các khoá có q trong tiêu đề hoặc mô tả.
//
// Vị từ quyền lấy từ `catalog.VisibilityPredicate`, không chép lại: `/search` là route CÔNG KHAI
// và nó đọc thẳng published_chapters, tức TOÀN VĂN chương. Lọc danh mục mà
// quên chỗ này thì khoá riêng biến khỏi mục lục nhưng vẫn moi ra được bằng
// cách gõ một câu trong chương vào ô tìm kiếm.
func (r *Repo) SearchCourses(ctx context.Context, q string, limit int, v catalog.Viewer) ([]CourseCandidate, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT pc.slug, pc.title, pc.description
		   FROM published_courses pc
		  WHERE (pc.title ILIKE $1 OR pc.description ILIKE $1)
		    AND `+catalog.VisibilityPredicate("pc", 3, 4)+`
		  ORDER BY pc.title
		  LIMIT $2`,
		likePattern(q), limit, v.IsAdmin, v.UID)
	if err != nil {
		return nil, fmt.Errorf("search: query published_courses: %w", err)
	}
	defer rows.Close()

	out := []CourseCandidate{}
	for rows.Next() {
		var c CourseCandidate
		if err := rows.Scan(&c.Slug, &c.Title, &c.Description); err != nil {
			return nil, fmt.Errorf("search: scan published_courses row: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("search: query published_courses: %w", err)
	}
	return out, nil
}

// SearchChapters trả về các chương mà SQL thấy khớp, kèm nguyên văn HTML cho
// chặng lọc thứ hai.
//
// ORDER BY ở đây là (slug, chapter_id) — một thứ tự ỔN ĐỊNH, không phải thứ
// tự hiển thị. Thứ tự hiển thị là thứ tự trong manifest, và usecase.go sắp
// lại theo đó sau khi đã có manifest trong tay. Hai việc khác nhau: cái này
// để cái trần maxCandidates cắt ở cùng một chỗ giữa hai lần chạy giống hệt
// nhau, thay vì cắt ngẫu nhiên theo thứ tự Postgres tình cờ trả về.
func (r *Repo) SearchChapters(ctx context.Context, q string, v catalog.Viewer) ([]ChapterCandidate, error) {
	// COALESCE(plain_text, html): quét văn bản thuần khi đã có, rơi về HTML
	// thô khi chưa. Sau khi BackfillPlainText chạy, nhánh thứ hai không còn
	// hàng nào — nhưng nó phải tồn tại, vì thiếu nó thì một chương chưa dẫn
	// xuất im lặng biến mất khỏi mọi kết quả.
	//
	// Quét plain_text rẻ hơn quét html theo HAI cách, không phải một: cột nhỏ
	// hơn (không thẻ, không thuộc tính), và Postgres không phải giải nén TOAST
	// một cột html hàng chục KB chỉ để chạy ILIKE trên nó.
	rows, err := r.pool.Query(ctx,
		`SELECT pch.slug, pc.title, pch.chapter_id,
		        COALESCE(pch.plain_text, pch.html),
		        pch.plain_text IS NULL
		   FROM published_chapters pch
		   JOIN published_courses pc ON pc.slug = pch.slug
		  WHERE COALESCE(pch.plain_text, pch.html) ILIKE $1
		    AND `+catalog.VisibilityPredicate("pc", 3, 4)+`
		  ORDER BY pch.slug, pch.chapter_id
		  LIMIT $2`,
		likePattern(q), maxCandidates, v.IsAdmin, v.UID)
	if err != nil {
		return nil, fmt.Errorf("search: query published_chapters: %w", err)
	}
	defer rows.Close()

	out := []ChapterCandidate{}
	for rows.Next() {
		var c ChapterCandidate
		if err := rows.Scan(&c.Slug, &c.CourseTitle, &c.ChapterID, &c.Text, &c.NeedsStrip); err != nil {
			return nil, fmt.Errorf("search: scan published_chapters row: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("search: query published_chapters: %w", err)
	}
	return out, nil
}

// ManifestsFor trả về manifest của từng slug trong slugs.
//
// Tên chương KHÔNG nằm trong published_chapters — migration 0005 không cho
// bảng ấy một cột title nào; tên sống trong published_courses.manifest
// (jsonb). Nên một hit chương chỉ có tên để hiển thị sau khi đọc manifest
// của khoá chứa nó.
//
// Gọi MỘT lần cho mọi slug riêng biệt, không phải một lần mỗi hit: mười
// chương của cùng một khoá dùng chung đúng một manifest, và manifest là cột
// nặng nhất trong bảng.
func (r *Repo) ManifestsFor(ctx context.Context, slugs []string) (map[string]json.RawMessage, error) {
	out := map[string]json.RawMessage{}
	if len(slugs) == 0 {
		return out, nil
	}

	rows, err := r.pool.Query(ctx,
		`SELECT slug, manifest FROM published_courses WHERE slug = ANY($1)`, slugs)
	if err != nil {
		return nil, fmt.Errorf("search: query manifests: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var slug string
		var manifest json.RawMessage
		if err := rows.Scan(&slug, &manifest); err != nil {
			return nil, fmt.Errorf("search: scan manifest row: %w", err)
		}
		out[slug] = manifest
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("search: query manifests: %w", err)
	}
	return out, nil
}
