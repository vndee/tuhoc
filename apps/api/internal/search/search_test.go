// Package search_test lái GET /search qua HTTP thật, dựng bằng chính
// server.New — cùng cánh cửa một trình duyệt đi vào — trên Postgres thật qua
// store.TestPool. Gói test NGOÀI, cùng lý do catalog_test và userdata_test là
// gói ngoài: để import được server (vốn import search) mà không thành vòng.
//
// Dữ liệu mẫu ghi thẳng vào published_* bằng SQL thay vì publish qua zip:
// những gì gói này đo là CÁCH KHỚP và CÁCH CẮT, và một fixture viết ra tại
// chỗ nói rõ ca đang đo hơn hẳn một gói khoá học đầy đủ.
package search_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/htmltext"
	"github.com/vndee/tuhoc-api/internal/search"
	"github.com/vndee/tuhoc-api/internal/server"
	"github.com/vndee/tuhoc-api/internal/store"
)

const httpTimeoutMS = 30000

func newTestApp(pool *pgxpool.Pool) *fiber.App {
	return server.New(config.Config{CookieSecure: false},
		server.Deps{Pool: pool, LogOutput: io.Discard})
}

type chapterFixture struct {
	id, title, html string
}

// seedCourse ghi một khoá và các chương của nó, manifest dựng từ chính
// danh sách chương — trừ những chương có title rỗng, CỐ TÌNH bỏ khỏi
// manifest để đo ca "chương có trong bảng mà không có trong manifest".
func seedCourse(t *testing.T, pool *pgxpool.Pool, slug, title, description string, chapters []chapterFixture) {
	t.Helper()
	ctx := context.Background()

	type mch struct {
		ID    string `json:"id"`
		Title string `json:"title"`
	}
	parts := []map[string]any{{"title": "Phần 1", "chapters": []mch{}}}
	listed := []mch{}
	for _, ch := range chapters {
		if ch.title == "" {
			continue
		}
		listed = append(listed, mch{ID: ch.id, Title: ch.title})
	}
	parts[0]["chapters"] = listed
	manifest, err := json.Marshal(map[string]any{"id": slug, "title": title, "parts": parts})
	if err != nil {
		t.Fatalf("seed: marshal manifest: %v", err)
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO published_courses (slug, version, title, lang, description, manifest)
		 VALUES ($1, 1, $2, 'vi', $3, $4)`,
		slug, title, description, manifest); err != nil {
		t.Fatalf("seed: insert course %s: %v", slug, err)
	}
	for _, ch := range chapters {
		// plain_text điền SẴN, đúng như catalog.Publish làm kể từ migration
		// 0012 — nếu không, mọi bài test trong tệp này sẽ đo đường DỰ PHÒNG
		// (quét html thô) và đường thật của production không có ai chạm tới.
		// Đường dự phòng có bài riêng: seedLegacyChapter bên dưới.
		if _, err := pool.Exec(ctx,
			`INSERT INTO published_chapters (slug, chapter_id, file, html, plain_text)
			 VALUES ($1, $2, $3, $4, $5)`,
			slug, ch.id, "chapters/"+ch.id+".html", ch.html, htmltext.Strip(ch.html)); err != nil {
			t.Fatalf("seed: insert chapter %s/%s: %v", slug, ch.id, err)
		}
	}
}

// seedLegacyChapter ghi một chương với plain_text NULL — một chương publish
// TRƯỚC migration 0012, chưa qua BackfillPlainText.
func seedLegacyChapter(t *testing.T, pool *pgxpool.Pool, slug string, ch chapterFixture) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO published_chapters (slug, chapter_id, file, html, plain_text)
		 VALUES ($1, $2, $3, $4, NULL)`,
		slug, ch.id, "chapters/"+ch.id+".html", ch.html); err != nil {
		t.Fatalf("seed legacy: %s/%s: %v", slug, ch.id, err)
	}
}

type courseHit struct {
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type chapterHit struct {
	Slug         string `json:"slug"`
	CourseTitle  string `json:"courseTitle"`
	ChapterID    string `json:"chapterId"`
	ChapterTitle string `json:"chapterTitle"`
	Before       string `json:"before"`
	Match        string `json:"match"`
	After        string `json:"after"`
}

type searchBody struct {
	Courses   []courseHit  `json:"courses"`
	Chapters  []chapterHit `json:"chapters"`
	Truncated bool         `json:"truncated"`
}

func doSearch(t *testing.T, app *fiber.App, query string) (int, searchBody) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/search?"+query, nil)
	res, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("GET /search?%s: %v", query, err)
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var body searchBody
	if res.StatusCode == http.StatusOK {
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Fatalf("decode body %q: %v", string(raw), err)
		}
	}
	return res.StatusCode, body
}

func q(term string) string { return "q=" + url.QueryEscape(term) }

// TestSearchFindsChapterContent là ca cơ bản: chữ nằm TRONG bài, không phải
// trong tiêu đề, vẫn tìm ra — đó là toàn bộ lý do vòng này tồn tại.
func TestSearchFindsChapterContent(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả", []chapterFixture{
		{id: "c1", title: "Chương một", html: "<p>Một đại lượng gọi là entropy đo độ bất định.</p>"},
	})

	status, body := doSearch(t, app, q("entropy"))
	if status != http.StatusOK {
		t.Fatalf("status = %d, muốn 200", status)
	}
	if len(body.Chapters) != 1 {
		t.Fatalf("số hit chương = %d, muốn 1: %+v", len(body.Chapters), body.Chapters)
	}
	h := body.Chapters[0]
	if h.Slug != "khoa-a" || h.ChapterID != "c1" || h.ChapterTitle != "Chương một" {
		t.Errorf("hit sai chỗ: %+v", h)
	}
	if h.Match != "entropy" {
		t.Errorf("Match = %q, muốn %q", h.Match, "entropy")
	}
	if got := h.Before + h.Match + h.After; got != "Một đại lượng gọi là entropy đo độ bất định." {
		t.Errorf("ba mảnh ghép lại = %q, không bằng đoạn văn gốc", got)
	}
}

// TestSearchDropsMarkupOnlyMatch canh chặng lọc THỨ HAI (repo.go's doc).
// Không có nó, truy vấn khớp một tên lớp CSS và trả về một chương không hề
// nói tới thứ người dùng tìm — kèm đoạn trích cắt từ giữa một thuộc tính.
func TestSearchDropsMarkupOnlyMatch(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả", []chapterFixture{
		{id: "c1", title: "Chương một", html: `<div class="entropy-box"><p>Bài này nói về một chuyện khác hẳn.</p></div>`},
	})

	_, body := doSearch(t, app, q("entropy"))
	if len(body.Chapters) != 0 {
		t.Fatalf("khớp chỉ trong markup vẫn lọt ra: %+v", body.Chapters)
	}
}

// TestSearchDropsScriptBodyMatch: thân <script> không phải văn bản người học
// đọc, nên nó cũng không phải chỗ để tìm ra một kết quả. Tính chất này thừa
// hưởng từ htmltext (bảng mười thẻ raw-text) — ca này canh rằng nó THỰC SỰ
// còn hiệu lực sau khi hàm ấy đổi gói.
func TestSearchDropsScriptBodyMatch(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả", []chapterFixture{
		{id: "c1", title: "Chương một", html: `<script>var entropy = 1;</script><p>Không có gì ở đây.</p>`},
	})

	_, body := doSearch(t, app, q("entropy"))
	if len(body.Chapters) != 0 {
		t.Fatalf("chữ trong thân <script> vẫn thành kết quả: %+v", body.Chapters)
	}
}

// TestSearchTreatsPercentAsAnOrdinaryCharacter đo phần DUY NHẤT của việc
// thoát ký tự LIKE mà bề mặt HTTP nhìn thấy được — và nó ít hơn hẳn những gì
// một bài test ở đây có vẻ hứa. Hai phép đo đã cắt nó xuống còn thế này:
//
//  1. Gỡ HẲN phép thoát trong likePattern, mọi bài test HTTP vẫn xanh. Mẫu
//     "%" khớp mọi chương, nhưng chặng lọc thứ hai (usecase.go) bỏ sạch
//     những hit ấy, nên KẾT QUẢ không đổi. Cái hỏng là chi phí, không phải
//     câu trả lời.
//  2. Một mẫu LIKE hỏng cú pháp — kết thúc bằng dấu thoát lẻ — thì KHÔNG
//     input nào tạo ra được: likePattern luôn đóng mẫu bằng "%", nên một "\"
//     ở cuối truy vấn thành "\%", một escape hợp lệ. Không có 500 nào để mà
//     canh ở đây, dù bản nháp của chính bài test này từng khẳng định có.
//
// Còn lại đúng một tính chất người dùng thấy: dấu "%" họ gõ là một ký tự
// bình thường. Phép thoát tự nó được canh ở TestLikePatternEscapes
// (repo_internal_test.go) — đúng tầng sinh ra thứ nó bảo vệ.
func TestSearchTreatsPercentAsAnOrdinaryCharacter(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả", []chapterFixture{
		{id: "c1", title: "Chương một", html: "<p>Không có ký tự đặc biệt nào ở đây.</p>"},
		{id: "c2", title: "Chương hai", html: "<p>Hiệu suất đạt 90% sau ba lần thử.</p>"},
	})

	_, body := doSearch(t, app, q("0%"))
	if len(body.Chapters) != 1 || body.Chapters[0].ChapterID != "c2" {
		t.Errorf("tìm chuỗi chứa dấu %% ra %+v, muốn đúng chương c2", body.Chapters)
	}
}

// TestSearchHandlesVietnameseAndLongContext đo hai thứ cùng lúc: chữ có dấu
// khớp đúng, và đoạn trích cắt ở ranh giới RUNE — không sinh ra U+FFFD ở mép.
func TestSearchHandlesVietnameseAndLongContext(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	filler := strings.Repeat("Một câu đệm dài để đẩy chỗ khớp vào giữa. ", 12)
	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả", []chapterFixture{
		{id: "c1", title: "Chương một", html: "<p>" + filler + "Định lý mã hoá nguồn nói rằng… " + filler + "</p>"},
	})

	_, body := doSearch(t, app, q("mã hoá"))
	if len(body.Chapters) != 1 {
		t.Fatalf("số hit = %d, muốn 1", len(body.Chapters))
	}
	h := body.Chapters[0]
	if h.Match != "mã hoá" {
		t.Errorf("Match = %q, muốn %q", h.Match, "mã hoá")
	}
	for name, part := range map[string]string{"Before": h.Before, "Match": h.Match, "After": h.After} {
		if strings.ContainsRune(part, '�') {
			t.Errorf("%s bị cắt giữa một rune (có U+FFFD): %q", name, part)
		}
	}
	if !strings.HasPrefix(h.Before, "…") || !strings.HasSuffix(h.After, "…") {
		t.Errorf("đoạn trích dài phải có dấu cắt hai đầu: before=%q after=%q", h.Before, h.After)
	}
}

// TestSearchMatchesCaseInsensitively: gõ thường phải ra chữ hoa trong bài.
func TestSearchMatchesCaseInsensitively(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả", []chapterFixture{
		{id: "c1", title: "Chương một", html: "<p>ENTROPY viết hoa toàn bộ.</p>"},
	})

	_, body := doSearch(t, app, q("entropy"))
	if len(body.Chapters) != 1 {
		t.Fatalf("số hit = %d, muốn 1", len(body.Chapters))
	}
	if body.Chapters[0].Match != "ENTROPY" {
		t.Errorf("Match = %q — phải là chữ NHƯ TRONG BÀI, không phải như đã gõ", body.Chapters[0].Match)
	}
}

// TestSearchQueryIsLiteralNotRegex: người gõ ".*" đang tìm hai ký tự ấy.
func TestSearchQueryIsLiteralNotRegex(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả", []chapterFixture{
		{id: "c1", title: "Chương một", html: "<p>Một câu không có dấu chấm sao.</p>"},
	})

	_, body := doSearch(t, app, q(".*"))
	if len(body.Chapters) != 0 {
		t.Fatalf("truy vấn %q bị đối xử như biểu thức chính quy: %+v", ".*", body.Chapters)
	}
}

// TestSearchFindsCourseTitleAndDescription: hai cột chữ thuần, không qua
// chặng lọc thứ hai (xem CourseCandidate).
func TestSearchFindsCourseTitleAndDescription(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	seedCourse(t, pool, "khoa-a", "Nhập môn xác suất", "Một khoá về biến ngẫu nhiên", nil)

	_, byTitle := doSearch(t, app, q("xác suất"))
	if len(byTitle.Courses) != 1 || byTitle.Courses[0].Slug != "khoa-a" {
		t.Errorf("tìm theo tiêu đề ra %+v", byTitle.Courses)
	}
	_, byDesc := doSearch(t, app, q("ngẫu nhiên"))
	if len(byDesc.Courses) != 1 || byDesc.Courses[0].Slug != "khoa-a" {
		t.Errorf("tìm theo mô tả ra %+v", byDesc.Courses)
	}
}

// TestSearchRejectsShortAndLongQueries: hai ngưỡng, cùng một mã 400.
func TestSearchRejectsShortAndLongQueries(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)

	for _, term := range []string{"", " ", "a", "   b   "} {
		if status, _ := doSearch(t, app, q(term)); status != http.StatusBadRequest {
			t.Errorf("q=%q cho status %d, muốn 400", term, status)
		}
	}
	if status, _ := doSearch(t, app, q(strings.Repeat("a", 129))); status != http.StatusBadRequest {
		t.Errorf("truy vấn 129 byte cho status %d, muốn 400", status)
	}
	// Ba rune tiếng Việt (bảy byte) phải ĐƯỢC nhận: ngưỡng đếm rune, không
	// đếm byte.
	if status, _ := doSearch(t, app, q("học")); status != http.StatusOK {
		t.Errorf(`q="học" cho status %d, muốn 200 — ngưỡng đang đếm byte`, status)
	}
}

// TestSearchClampsLimitAndReportsTruncation: trần thật, và cờ nói ra khi cắt.
func TestSearchClampsLimitAndReportsTruncation(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	chapters := make([]chapterFixture, 0, 12)
	for i := 0; i < 12; i++ {
		chapters = append(chapters, chapterFixture{
			id:    fmt.Sprintf("c%02d", i),
			title: fmt.Sprintf("Chương %02d", i),
			html:  "<p>Chương này nói về entropy.</p>",
		})
	}
	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả", chapters)

	_, def := doSearch(t, app, q("entropy"))
	if len(def.Chapters) != 8 {
		t.Errorf("mặc định trả %d hit, muốn 8", len(def.Chapters))
	}
	if !def.Truncated {
		t.Error("Truncated = false trong khi còn 4 chương chưa trả về")
	}

	_, all := doSearch(t, app, q("entropy")+"&limit=30")
	if len(all.Chapters) != 12 {
		t.Errorf("limit=30 trả %d hit, muốn cả 12", len(all.Chapters))
	}
	if all.Truncated {
		t.Error("Truncated = true trong khi đã trả hết")
	}

	// Trần: limit=999 kẹp về 30, không phải "không giới hạn".
	if _, over := doSearch(t, app, q("entropy")+"&limit=999"); len(over.Chapters) != 12 {
		t.Errorf("limit=999 trả %d hit", len(over.Chapters))
	}
	// Rác thì rơi về mặc định, không thành lỗi.
	if status, junk := doSearch(t, app, q("entropy")+"&limit=abc"); status != http.StatusOK || len(junk.Chapters) != 8 {
		t.Errorf("limit=abc cho status %d và %d hit, muốn 200 và 8", status, len(junk.Chapters))
	}
}

// TestSearchOrdersChaptersByManifest: thứ tự hiển thị là thứ tự MỤC LỤC, kể
// cả khi nó ngược với thứ tự chapter_id mà SQL trả về.
func TestSearchOrdersChaptersByManifest(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	ctx := context.Background()
	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả", []chapterFixture{
		{id: "aaa", title: "Chương cuối", html: "<p>entropy</p>"},
		{id: "zzz", title: "Chương đầu", html: "<p>entropy</p>"},
	})
	// Manifest liệt kê zzz TRƯỚC aaa — ngược thứ tự bảng chữ cái của id.
	manifest := `{"id":"khoa-a","title":"Khoá A","parts":[{"title":"P1","chapters":[{"id":"zzz","title":"Chương đầu"},{"id":"aaa","title":"Chương cuối"}]}]}`
	if _, err := pool.Exec(ctx, `UPDATE published_courses SET manifest = $1 WHERE slug = 'khoa-a'`, manifest); err != nil {
		t.Fatalf("cập nhật manifest: %v", err)
	}

	_, body := doSearch(t, app, q("entropy"))
	if len(body.Chapters) != 2 {
		t.Fatalf("số hit = %d, muốn 2", len(body.Chapters))
	}
	if body.Chapters[0].ChapterID != "zzz" || body.Chapters[1].ChapterID != "aaa" {
		t.Errorf("thứ tự = %s, %s — muốn thứ tự mục lục (zzz, aaa)",
			body.Chapters[0].ChapterID, body.Chapters[1].ChapterID)
	}
}

// TestSearchKeepsChapterMissingFromManifest: một chương có thật, có nội dung
// khớp, KHÔNG được biến mất chỉ vì manifest không nhắc tới nó. Tên rơi về
// chapter_id — một cái tên xấu, không phải một kết quả mất tích.
func TestSearchKeepsChapterMissingFromManifest(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả", []chapterFixture{
		{id: "c1", title: "Chương một", html: "<p>entropy ở đây</p>"},
		{id: "mo-coi", title: "", html: "<p>entropy ở đây nữa</p>"}, // title rỗng = bỏ khỏi manifest
	})

	_, body := doSearch(t, app, q("entropy"))
	if len(body.Chapters) != 2 {
		t.Fatalf("số hit = %d, muốn 2 — một chương ngoài manifest đã bị nuốt: %+v", len(body.Chapters), body.Chapters)
	}
	var orphan *chapterHit
	for i := range body.Chapters {
		if body.Chapters[i].ChapterID == "mo-coi" {
			orphan = &body.Chapters[i]
		}
	}
	if orphan == nil {
		t.Fatalf("không thấy chương ngoài manifest: %+v", body.Chapters)
	}
	if orphan.ChapterTitle != "mo-coi" {
		t.Errorf("ChapterTitle = %q, muốn rơi về chapter_id", orphan.ChapterTitle)
	}
}

// TestSearchOmitsUnpublishedCourse: gỡ publish thì biến mất khỏi kết quả —
// qua ON DELETE CASCADE của migration 0005, không qua một điều kiện lọc nào
// ở tầng Go.
func TestSearchOmitsUnpublishedCourse(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	ctx := context.Background()
	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả entropy", []chapterFixture{
		{id: "c1", title: "Chương một", html: "<p>entropy</p>"},
	})

	if _, body := doSearch(t, app, q("entropy")); len(body.Chapters) != 1 || len(body.Courses) != 1 {
		t.Fatalf("trước khi gỡ: %d chương, %d khoá", len(body.Chapters), len(body.Courses))
	}
	if _, err := pool.Exec(ctx, `DELETE FROM published_courses WHERE slug = 'khoa-a'`); err != nil {
		t.Fatalf("gỡ publish: %v", err)
	}
	_, body := doSearch(t, app, q("entropy"))
	if len(body.Chapters) != 0 || len(body.Courses) != 0 {
		t.Errorf("sau khi gỡ vẫn còn: %d chương, %d khoá", len(body.Chapters), len(body.Courses))
	}
}

// TestSearchEmptyResultIsArrayNotNull: `null` làm client ném lỗi ở .map().
//
// So khớp NGUYÊN THÂN, không phải "không chứa chữ null". Bản đầu chỉ tìm
// chuỗi con ấy, nên một handler trả `{}` — hay bỏ hẳn hai khoá — vẫn xanh,
// trong khi `{}` phá client đúng bằng cách `null` phá.
func TestSearchEmptyResultIsArrayNotNull(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)

	req := httptest.NewRequest(http.MethodGet, "/search?"+q("khong-co-gi"), nil)
	res, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("GET /search: %v", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	const want = `{"courses":[],"chapters":[],"truncated":false}`
	if string(raw) != want {
		t.Errorf("thân trả về = %s, muốn %s", raw, want)
	}
}

// TestSearchRejectsInvalidText: hai chuỗi từng thành 500 phải thành 400.
//
// Cả hai lọt qua ngưỡng độ dài. "\xff\xfe" vì utf8.RuneCountInString đếm mỗi
// byte hỏng là một rune; NUL vì nó hợp lệ theo UTF-8. Cái đầu chết ở
// regexp.Compile và kéo NGUYÊN BYTE truy vấn vào log lỗi của máy chủ; cái sau
// chết tận trong Postgres (SQLSTATE 22021), sau khi đã mở một kết nối.
func TestSearchRejectsInvalidText(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)

	for name, term := range map[string]string{
		"UTF-8 hỏng":        "\xff\xfe",
		"NUL":               "a\x00b",
		"hỏng lẫn chữ thật": "entropy\xff",
	} {
		t.Run(name, func(t *testing.T) {
			status, _ := doSearch(t, app, q(term))
			if status != http.StatusBadRequest {
				t.Errorf("status = %d, muốn 400 — chuỗi này thành lỗi máy chủ", status)
			}
		})
	}
}

// TestSearchNegativeLimitDoesNotPanic: `kept[:limit]` với limit âm panic.
//
// Không tới được qua HTTP (ClampLimit đứng chắn ở handler), nên bài này gọi
// THẲNG usecase — đúng chỗ mà một chỗ gọi thứ hai sẽ đi vào.
func TestSearchNegativeLimitDoesNotPanic(t *testing.T) {
	pool := store.TestPool(t)
	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả", []chapterFixture{
		{id: "c1", title: "Chương một", html: "<p>entropy</p>"},
	})

	uc := search.NewUsecase(search.NewRepo(pool))
	res, err := uc.Search(context.Background(), "entropy", -1)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(res.Chapters) != 1 {
		t.Errorf("số hit = %d, muốn 1 — limit âm phải rơi về mặc định", len(res.Chapters))
	}
}

// TestSearchOrphanChapterSinksToBottom canh ĐÚNG lời hứa mà chú thích ở
// usecase.go viết ra: một chương không có trong manifest thì xuống CUỐI.
//
// Ca này khác TestSearchKeepsChapterMissingFromManifest ở đúng một điều, và
// điều ấy là toàn bộ vấn đề: manifest ở đây có NHIỀU chương hơn số ứng viên
// mà truy vấn trả về. Bài kia seed hai chương và cả hai đều khớp, nên mọi
// công thức dự phòng đều cho cùng một câu trả lời.
func TestSearchOrphanChapterSinksToBottom(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	ctx := context.Background()

	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả", []chapterFixture{
		{id: "mo-coi", title: "", html: "<p>entropy ở chương mồ côi</p>"},
		{id: "c10", title: "Chương mười", html: "<p>entropy ở chương mười</p>"},
	})
	// Manifest 40 chương; "c10" đứng thứ 10, và 39 chương còn lại KHÔNG có
	// nội dung nào khớp — nên chúng không thành ứng viên.
	chs := make([]map[string]string, 0, 40)
	for i := 0; i < 40; i++ {
		chs = append(chs, map[string]string{"id": fmt.Sprintf("c%d", i), "title": fmt.Sprintf("Chương %d", i)})
	}
	manifest, err := json.Marshal(map[string]any{
		"id": "khoa-a", "title": "Khoá A",
		"parts": []map[string]any{{"title": "P1", "chapters": chs}},
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE published_courses SET manifest = $1 WHERE slug = 'khoa-a'`, manifest); err != nil {
		t.Fatalf("cập nhật manifest: %v", err)
	}

	_, body := doSearch(t, app, q("entropy"))
	if len(body.Chapters) != 2 {
		t.Fatalf("số hit = %d, muốn 2: %+v", len(body.Chapters), body.Chapters)
	}
	if body.Chapters[0].ChapterID != "c10" || body.Chapters[1].ChapterID != "mo-coi" {
		t.Errorf("thứ tự = %s, %s — chương ngoài manifest phải xuống CUỐI",
			body.Chapters[0].ChapterID, body.Chapters[1].ChapterID)
	}
}

// TestSearchFindsChapterPublishedBeforePlainTextColumn: một chương có
// plain_text NULL vẫn tìm ra được.
//
// Đây là ca mà `NOT NULL DEFAULT ”` sẽ hỏng im lặng: chuỗi rỗng không khớp
// truy vấn nào, nên mọi chương đã publish sẽ biến mất khỏi tìm kiếm cho tới
// khi ai đó publish lại — không lỗi, không cảnh báo, chỉ là kết quả rỗng.
func TestSearchFindsChapterPublishedBeforePlainTextColumn(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả", nil)
	seedLegacyChapter(t, pool, "khoa-a", chapterFixture{
		id: "cu", html: "<p>Chương cũ vẫn nói về entropy.</p>",
	})

	_, body := doSearch(t, app, q("entropy"))
	if len(body.Chapters) != 1 || body.Chapters[0].ChapterID != "cu" {
		t.Fatalf("chương publish trước 0012 không tìm ra: %+v", body.Chapters)
	}
	// Và đoạn trích vẫn sạch thẻ — đường dự phòng gỡ thẻ trong Go.
	if got := body.Chapters[0].Before; strings.ContainsAny(got, "<>") {
		t.Errorf("đoạn trích còn thẻ HTML: %q", got)
	}
}

// TestSearchDropsMarkupOnlyMatchOnLegacyChapter: chặng lọc thứ hai vẫn phải
// làm việc trên đường dự phòng, nơi SQL quét HTML còn nguyên thẻ.
func TestSearchDropsMarkupOnlyMatchOnLegacyChapter(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	seedCourse(t, pool, "khoa-a", "Khoá A", "mô tả", nil)
	seedLegacyChapter(t, pool, "khoa-a", chapterFixture{
		id: "cu", html: `<div class="entropy-box"><p>Chuyện khác hẳn.</p></div>`,
	})

	_, body := doSearch(t, app, q("entropy"))
	if len(body.Chapters) != 0 {
		t.Fatalf("khớp chỉ trong markup lọt qua đường dự phòng: %+v", body.Chapters)
	}
}
