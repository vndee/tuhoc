package server_test

import (
	"go/scanner"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// MÁY CHỦ KHÔNG NÓI THAY NGƯỜI ĐỌC.
//
// ── Vì sao dây bẫy này tồn tại ────────────────────────────────────────────
//
// Hệ thống con 3 làm giao diện song ngữ. HC-1 của kế hoạch ghi "apps/api:
// 9 tệp .go có chuỗi tiếng Việt" và xếp chúng vào phần việc bóc chuỗi. Đo lại
// ở tầng TOKEN (go/scanner phân biệt được chuỗi với chú thích, đúng cùng lý do
// mà `apps/web/src/i18n/i18n.test.ts` đọc cây cú pháp thay vì grep), con số
// thật là **0 tệp mã sản phẩm**: cả 9 tệp ấy có tiếng Việt trong CHÚ THÍCH,
// và ba tệp còn lại có tiếng Việt trong *chuỗi* đều là tệp `_test.go` — chữ
// của chính bài kiểm, cùng lằn ranh mà `db/local.test.ts` vạch.
//
// ── Vì sao KHÔNG đổi hợp đồng API để trả "mã lỗi" ─────────────────────────
//
// Kế hoạch hỏi: dịch phía máy chủ, hay trả mã để client dịch? Câu trả lời
// "trả mã" đã ĐÚNG SẴN, và bằng một cơ chế có từ trước: **mã trạng thái
// HTTP**. `apps/web/src/api/client.ts`'s `describeAuthError` phân nhánh theo
// `error.status` và KHÔNG BAO GIỜ đọc thân phản hồi — đo được: không tệp sản
// phẩm nào dưới `apps/web/src` đọc `ApiError.body`. Thân phản hồi chỉ chở
// tiếng Anh kỹ thuật cho log và bug report.
//
// Thêm một trường `code` máy đọc được vào thân phản hồi sẽ là bề mặt API mới
// **không có người tiêu thụ**, và một hợp đồng không ai đọc là hợp đồng sẽ
// trôi dạt. Nên quyết định là: **không đổi gì**, và biến điều đó thành một
// ràng buộc đo được — chính là tệp này.
//
// ── Điều dây bẫy này thật sự canh ─────────────────────────────────────────
//
// Không phải "hôm nay sạch" (một câu về quá khứ), mà "ngày mai vẫn sạch": nếu
// ai đó viết một câu tiếng Việt vào một hồi đáp của máy chủ, người đọc đã chọn
// tiếng Anh sẽ nhận nó **trong im lặng** — không cổng nào khác trong repo hỏi
// được câu ấy, vì cổng chuỗi cứng của hệ song ngữ chỉ quét TypeScript và
// JavaScript của trình duyệt.
//
// PHẠM VI: mọi tệp `.go` KHÔNG PHẢI test dưới `apps/api`, kể cả gói chưa tồn
// tại lúc viết dòng này. Một danh sách gói được phép là đúng hình dạng cổng mù
// mà `no_key_transit_test.go` bên cạnh đã bác một lần rồi ("đừng loại trừ cả
// gói").

// Ký tự chỉ xuất hiện trong CHỮ Latin có dấu — không bao giờ trong mã định
// danh hay chuỗi kỹ thuật của repo này.
//
// Hai khoảng trống trong dãy là có chủ ý và giống hệt bên TypeScript: `×`
// (U+00D7) và `÷` (U+00F7) là ký hiệu TOÁN HỌC mà Latin-1 xếp giữa các chữ
// cái. Xem chú thích của `VIETNAMESE` ở `apps/web/src/i18n/i18n.test.ts`.
var accented = regexp.MustCompile(`[\x{00C0}-\x{00D6}\x{00D8}-\x{00F6}\x{00F8}-\x{024F}\x{1E00}-\x{1EFF}]`)

// Số tệp .go không-phải-test tối thiểu mà phép quét phải đọc được.
//
// CHỐT CHỐNG CỔNG MÙ: một đường dẫn sai làm phép quét đọc 0 tệp và báo đạt
// vĩnh viễn — đúng hình dạng của năm cổng mù trong `docs/carried-forward.md`.
// Đo ngày 2026-08-22: 30 tệp. Ngưỡng đặt thấp hơn hẳn để nó không phải sửa mỗi
// lần thêm một tệp, nhưng đủ cao để một cây rỗng không lọt.
const minProductionGoFiles = 20

// Tệp NEO — phép quét phải đọc được đúng những tệp mà vi phạm sẽ nằm ở đó.
// Một ngưỡng đếm mà không có mỏ neo vẫn xanh khi bộ lọc nuốt đúng thư mục
// đáng nhìn và để lại một thư mục khác cho đủ số.
var handlerSentinels = []string{
	"internal/auth/handler.go",
	"internal/catalog/handler.go",
	"internal/rating/handler.go",
	"internal/server/server.go",
	"internal/stats/handler.go",
	"internal/sync/handler.go",
}

// Chuỗi tiếng Việt trong mã sản phẩm mà một quyết định CÓ Ý THỨC đã cho phép.
//
// RỖNG, và nó phải ở lại rỗng: một mục ở đây là một câu tiếng Việt mà một
// người đọc tiếng Anh sẽ nhận được, nên nó cần một lý do viết ra ngay cạnh —
// cùng kỷ luật với `NOT_YET_EXTRACTED` bên `apps/web`.
var allowedVietnameseInProduction = map[string]string{}

type goHit struct {
	file string
	line int
	text string
}

// productionGoFiles: mọi tệp `.go` không-phải-test dưới `apps/api`.
func productionGoFiles(t *testing.T) []string {
	t.Helper()

	root := apiRoot(t)
	var out []string
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if info.Name() == "vendor" || info.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		out = append(out, p)
		return nil
	})
	if err != nil {
		t.Fatalf("không quét được nguồn Go dưới %s: %v", root, err)
	}
	sort.Strings(out)
	return out
}

// apiRoot neo ở `apps/api` bằng cách đi ngược lên tìm `go.mod`. KHÔNG có
// đường lui im lặng, cùng lý do `repoRoot` ở `no_key_transit_test.go` nêu.
func apiRoot(t *testing.T) string {
	t.Helper()

	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("không lấy được thư mục làm việc: %v", err)
	}
	for range 12 {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Fatalf("không tìm thấy go.mod khi đi ngược lên từ %q — phép quét này neo "+
		"ở gốc module và KHÔNG tự lui, vì một đường lui im lặng biến dây bẫy "+
		"thành cổng mù.", dir)
	return ""
}

// vietnameseStringLiterals đọc CHUỖI, không đọc chú thích.
//
// Đây là toàn bộ lý do hàm này dùng `go/scanner` thay vì `grep`: văn xuôi của
// repo này viết bằng tiếng Việt ở gần như mọi khối chú thích, nên một `grep`
// sẽ báo *mọi* tệp là vi phạm và dây bẫy lập tức thành tiếng ồn. Đó chính là
// cách con số "9 tệp .go" của HC-1 ra đời.
func vietnameseStringLiterals(path string, src []byte) []goHit {
	fset := token.NewFileSet()
	file := fset.AddFile(path, fset.Base(), len(src))

	var s scanner.Scanner
	s.Init(file, src, nil, 0)

	var hits []goHit
	for {
		pos, tok, lit := s.Scan()
		if tok == token.EOF {
			break
		}
		if tok != token.STRING {
			continue
		}
		text := lit
		if unq, err := strconv.Unquote(lit); err == nil {
			text = unq
		}
		if accented.MatchString(text) {
			hits = append(hits, goHit{file: path, line: fset.Position(pos).Line, text: text})
		}
	}
	return hits
}

// BÀI ĐỌC-ĐỒNG-HỒ. Không có nó, mọi khẳng định dưới đây có thể đang đo sai
// thứ: một bộ dò tính cả chú thích sẽ báo gần như mọi tệp là vi phạm, còn một
// bộ dò hỏng sẽ báo KHÔNG tệp nào — và cả hai đều "chạy".
func TestVietnameseDetectorReadsStringsNotComments(t *testing.T) {
	decoy := []byte(`package p

// Mở kho khoá — một chú thích, không phải một chuỗi.
/* Đoạn văn xuôi tiếng Việt trong khối chú thích, cũng không tính. */
const soDoHinh = 1

const ascii = "Danh muc"
const glyphs = "×÷←→"
`)
	if hits := vietnameseStringLiterals("decoy.go", decoy); len(hits) != 0 {
		t.Fatalf("bộ dò tính cả chú thích/định danh/ký hiệu: %+v", hits)
	}

	real := []byte(`package p

const a = "Thư viện"
const b = "plain ascii"
const c = ` + "`Đã đọc xong`" + `
`)
	got := vietnameseStringLiterals("real.go", real)
	if len(got) != 2 || got[0].text != "Thư viện" || got[1].text != "Đã đọc xong" {
		t.Fatalf("bộ dò bỏ lọt chuỗi thật (kể cả chuỗi raw): %+v", got)
	}

	// ĐỐI CHỨNG cho hai khoảng trống `×`/`÷`: bốn chữ cái ĐỨNG SÁT chúng trong
	// bảng mã vẫn phải bị bắt.
	edge := []byte("package p\n\nconst e = \"Ö Ø ö ø\"\n")
	if got := vietnameseStringLiterals("edge.go", edge); len(got) != 1 {
		t.Fatalf("dãy ký tự quá rộng — bỏ lọt Ö/Ø/ö/ø: %+v", got)
	}
}

// CHỐT CHỐNG CỔNG MÙ, tách khỏi bài chịu lực để một cây rỗng nói ra lý do
// thật thay vì báo "không có vi phạm".
func TestProductionGoScanIsNotVacuous(t *testing.T) {
	files := productionGoFiles(t)
	if len(files) < minProductionGoFiles {
		t.Fatalf("chỉ quét được %d tệp .go không-phải-test (tối thiểu %d) — đường "+
			"dẫn sai hoặc bộ lọc nuốt mất cây. Phép quét này ĐANG KHÔNG KIỂM GÌ; "+
			"đừng hạ ngưỡng, hãy sửa đường dẫn.", len(files), minProductionGoFiles)
	}

	root := apiRoot(t)
	seen := map[string]bool{}
	for _, f := range files {
		rel, err := filepath.Rel(root, f)
		if err != nil {
			t.Fatalf("không tính được đường dẫn tương đối cho %s: %v", f, err)
		}
		seen[filepath.ToSlash(rel)] = true
	}
	var missing []string
	for _, s := range handlerSentinels {
		if !seen[s] {
			missing = append(missing, s)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("quét được %d tệp nhưng THIẾU %d tệp neo: %s. Nếu một handler "+
			"thật sự đã bị xoá hoặc đổi tên thì sửa handlerSentinels MỘT CÁCH CÓ "+
			"Ý THỨC; nếu không, phép quét đang bỏ sót đúng chỗ vi phạm sẽ nằm.",
			len(files), len(missing), strings.Join(missing, ", "))
	}

	t.Logf("phép quét đọc %d tệp .go không-phải-test dưới %s", len(files), root)
}

// BÀI CHỊU LỰC. Máy chủ không viết một câu tiếng Việt nào vào bất cứ thứ gì
// nó gửi đi.
func TestServerSpeaksNoVietnamese(t *testing.T) {
	root := apiRoot(t)

	var offenders []string
	for _, path := range productionGoFiles(t) {
		src, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("không đọc được %s: %v", path, err)
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			t.Fatalf("không tính được đường dẫn tương đối cho %s: %v", path, err)
		}
		rel = filepath.ToSlash(rel)

		for _, hit := range vietnameseStringLiterals(path, src) {
			if _, ok := allowedVietnameseInProduction[hit.text]; ok {
				continue
			}
			offenders = append(offenders, rel+":"+strconv.Itoa(hit.line)+": "+hit.text)
		}
	}

	if len(offenders) > 0 {
		sort.Strings(offenders)
		t.Fatalf("máy chủ mang %d chuỗi tiếng Việt trong mã sản phẩm:\n  %s\n\n"+
			"Giao diện nền tảng song ngữ (spec §4.2), và MÁY CHỦ KHÔNG BIẾT NGƯỜI "+
			"ĐỌC ĐANG DÙNG TIẾNG NÀO — không có header, không có tuỳ chọn nào chở "+
			"thông tin ấy tới đây, và lựa chọn ngôn ngữ cố ý không rời khỏi thiết "+
			"bị (`itbook-lang` là tuỳ chọn THIẾT BỊ). Một câu tiếng Việt phát ra "+
			"từ đây sẽ tới một người đọc tiếng Anh trong im lặng.\n\n"+
			"Đường đúng: trả MÃ TRẠNG THÁI HTTP và để client dịch — đó là thứ "+
			"`apps/web/src/api/client.ts`'s describeAuthError đã làm (nó phân "+
			"nhánh theo `error.status`, không đọc thân phản hồi). Thân phản hồi "+
			"chỉ chở tiếng Anh kỹ thuật cho log và bug report.",
			len(offenders), strings.Join(offenders, "\n  "))
	}
}
