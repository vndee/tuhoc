package server

import (
	"bytes"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/store"
)

// CỔNG NÀY THAY no_key_transit_test.go, KHÔNG XOÁ NÓ MÀ KHÔNG ĐỂ LẠI GÌ.
//
// Kiến trúc cũ: key nhà cung cấp AI nằm trong trình duyệt của từng người học,
// ở một origin riêng (apps/vault). Máy chủ ta chưa từng thấy key nào —
// no_key_transit_test.go canh đúng lời hứa đó, bằng ba phép quét khẳng định
// "máy chủ không bao giờ NHẬN key". Pha 2 cố ý phá lời hứa ấy: agent giờ chạy
// trên máy chủ ta, dùng MỘT tài khoản DeepSeek (và một tài khoản Brave Search)
// mà nền tảng trả tiền — xem config.Config.DeepSeekAPIKey/BraveAPIKey.
//
// Rủi ro không biến mất, nó ĐỔI HẠNG (spec §0.1): rủi ro "một người học mất
// key của chính họ" biến mất; rủi ro "một vụ xâm nhập lấy được key của NỀN
// TẢNG, tiêu tiền trên tài khoản của TA" xuất hiện. Đây là cổng canh cái hạng
// mới, đúng như spec §8 ghi: "cổng mới: key nhà cung cấp từ env, không ra
// log, không ra response".
//
// Một khẳng định của tệp cũ SỐNG SÓT nguyên vẹn qua cú thay này:
// TestNoRequestStructAcceptsAKey ở cuối tệp. Nó TRỰC GIAO với cú chuyển
// trục — "máy chủ giữ key CỦA TA" (kiến trúc mới, được phép) không hề kéo
// theo "máy chủ được nhận key CỦA NGƯỜI DÙNG" (vẫn cấm tuyệt đối, không đổi
// từ Pha 1). Xem chú thích ngay phía trên định nghĩa test đó.
//
// ── VÌ SAO HAI NỬA, VÀ VÌ SAO KHÔNG NỬA NÀO ĐỦ MỘT MÌNH ────────────────────
//
// Nửa HÀNH VI (TestProviderKeySentinelAppearsInNoResponseOrLog) dựng app thật,
// đặt DEEPSEEK_API_KEY thành một chuỗi mốc dễ tìm, gọi những route THẬT, và
// đọc thân response cùng BA đích log THẬT phát ra (slog — thứ apilog viết
// qua, access log của fiber, và log chuẩn của stdlib). Đây là nửa chứng minh
// tính chất đúng với những gì máy chủ THỰC SỰ phát ra, không phải với những
// gì mã nguồn trông như sẽ phát ra.
//
// Nhưng nó chỉ thấy được những gì một request TRONG TỆP NÀY chạm tới. Đó
// không phải giả thuyết suông — cùng bài học csrf_samesite_test.go đã đo:
// trước tệp đó, auth_test.go chỉ khẳng định thuộc tính cookie trên response
// ĐĂNG KÝ, nên một mutant đổi SameSite của clearSessionCookie (một hàm khác,
// một route khác) khiến cả bộ vẫn xanh. Ở đây thì còn tệ hơn: Task 4 (chưa
// thi công lúc tệp này được viết) sẽ thêm cả một gói internal/ai mới với các
// route mới — không route nào trong số đó tồn tại để nửa hành vi này gọi tới.
// Một dòng `log.Printf("deepseek call: key=%s", cfg.DeepSeekAPIKey)` nằm
// trong internal/ai/client.go sẽ làm nửa hành vi này xanh VĨNH VIỄN, vì
// không request nào trong tệp này bao giờ chạm tới gói đó.
//
// Nửa CẤU TRÚC (TestProviderKeyNeverReachesLogOrResponse) đóng đúng lỗ đó:
// quét MỌI tệp .go sản phẩm dưới gốc repo — kể cả gói chưa tồn tại lúc viết
// dòng này — tìm hai hình dạng rò cụ thể, không phụ thuộc việc có route nào
// gọi tới nó trong test hay không.
//
// ── PHẠM VI THẬT CỦA NỬA CẤU TRÚC — ĐỌC TRƯỚC KHI TIN NÓ RỘNG HƠN THẾ ──────
//
// Hai giới hạn sau đây là CÓ THẬT, đã đo, không phải giả thuyết:
//
//  1. Chỉ khớp CÙNG MỘT DÒNG NGUỒN. Một lời gọi ghi ra ngoài (sink) và một
//     tham chiếu tới key phải nằm chung một dòng .go để bị bắt. Một sink bị
//     gofmt tách xuống dòng tiếp theo — `slog.Error("...",\n\t"key",
//     cfg.DeepSeekAPIKey)` — không bị bắt bởi nửa này (đo thực nghiệm, xem
//     round 2 review trong task-3-report.md). Đây không phải lỗi có thể vá
//     bằng một dòng sửa; ghép nhiều dòng thành một "câu lệnh" đúng nghĩa cần
//     một trình phân tích cú pháp Go thật (go/parser), không phải một phép
//     quét chuỗi theo dòng. Nửa HÀNH VI là lưới an toàn cho đúng trường hợp
//     này — nó không quan tâm mã nguồn viết trên mấy dòng, nó đọc log THẬT.
//  2. Chỉ khớp BA CÁI TÊN: `DeepSeekAPIKey`, `BraveAPIKey`, `apiKey`, cộng
//     biến `cfg`
//     khi nó đi làm đối số cho cả struct — hoặc kèm một động từ in-cả-struct
//     (`%v`/`%+v`/`%#v`, ví dụ `log.Printf("%+v", cfg)`), hoặc đứng như một
//     GIÁ TRỊ NGUYÊN không qua động từ format nào (ví dụ `c.JSON(cfg)`,
//     `slog.Error("boot", "cfg", cfg)` — xem providerKeyCfgBareValue; nhánh
//     này được thêm ở round 2 review vòng 2 sau khi nhánh động-từ-format một
//     mình đo được bỏ lọt cả ba hình dạng trên). Giá trị đổi tên khi đi qua
//     biên gói thì cổng này MÙ — và đây không phải giả
//     thuyết, chính repo có sẵn tiền lệ: `cfg.GitHubToken` đi vào
//     `discuss.NewHandlerForConfig(cfg.GitHubToken, ...)` rồi thành tham số
//     `token string` ở `NewClient`, rồi thành trường `c.token` trên struct
//     `Client` (`internal/discuss/client.go`) — từ biên gói `internal/discuss`
//     trở đi, không còn chuỗi `githubtoken` nào để khớp nữa. `internal/ai`
//     (Task 4) ĐÃ lặp lại đúng hình dạng đó cho `DeepSeekAPIKey`: trường trên
//     `ai.Client`/`ai.Brave` tên là `apiKey`. Vòng sửa sau review tổng nhánh
//     Pha 2 (C1) thu hẹp điểm mù ấy bằng cách thêm needle `apikey` — nên hôm
//     nay cổng này NHÌN THẤY một `fmt.Errorf(..., c.apiKey, ...)` trong
//     `internal/ai`, đo trực tiếp bằng đúng đột biến mà review đã dùng
//     (`stream.go:553`). Điều KHÔNG đổi: cổng vẫn không theo dõi GIÁ TRỊ qua
//     biên gói (đó là phân tích taint liên-hàm, ngoài tầm một phép quét
//     chuỗi viết tay) — nó chỉ canh được TRONG một tệp, TRÊN một dòng, và
//     chỉ với những TÊN nó biết. Một gói mới đặt tên khác nữa (`secret`,
//     `token`, `credential`) vẫn phải hoặc dùng một trong ba tên trên, hoặc
//     tự mang theo một cổng hành vi tương đương — như `internal/ai` làm với
//     TestCompleteErrorNeverContainsKey / TestCompleteStreamErrorNeverContainsKey
//     / TestBraveSearchErrorNeverContainsKey.
//  3. KHÔNG canh được ĐÍCH ĐẾN của một lời gọi ra ngoài. Tệp cũ
//     (no_key_transit_test.go) có một allowlist đích đến chặn "mã sản phẩm
//     không được gọi ra ngoài trừ danh sách cho phép hẹp" — nó bị xoá NGUYÊN
//     VẸN cùng cả tệp, và cổng này không thay nó. Hôm nay không gì cản
//     internal/ai gọi một host KHÁC DeepSeek nếu `DEEPSEEK_BASE_URL` (đọc từ
//     env) bị đổi. TODO(Task 4): viết cổng đích đến khi client DeepSeek ra
//     đời — đúng chỗ nó thuộc về, không phải ở đây.
//
// Một cổng hẹp được ghi lại đúng phạm vi là một cổng dùng được; một cổng hẹp
// mà chú thích nói là rộng hơn thật là một cái bẫy tự tin giả.

// providerKeyLeakFieldNeedles là tên các trường mang key, hạ chữ thường vì
// nguồn được so khớp sau khi hạ chữ thường (xem providerKeyGoSources).
//
// `apikey` (vòng sửa sau review tổng nhánh Pha 2, C1) là needle THỨ BA, thêm
// vào chứ không thay hai needle trên: nó THU HẸP đúng điểm mù mà PHẠM VI
// THẬT điểm 2 ở trên tự khai — `cfg.DeepSeekAPIKey` đi qua biên gói và trở
// thành trường `apiKey` trên `ai.Client`/`ai.Brave` (client.go:100,
// brave.go:74), từ đó không còn chuỗi `deepseekapikey` nào để khớp. Hai
// needle cụ thể ở trên vẫn đứng trước để NHÃN của một vi phạm gọi đúng tên
// trường config; `apikey` bao trùm cả hai và bắt thêm mọi biến thể trong
// gói khác.
//
// KHÔNG mở rộng thành `key` trần: đo ngày 2026-08-29 trên toàn repo, `apikey`
// + một sink bất kỳ khớp ĐÚNG 0 dòng mã sản phẩm (không dương tính giả nào),
// còn `key` trần thì khớp mọi `map key`, `query key`, `cache key` trong chú
// thích. Đây là lý do needle dừng ở `apikey`.
var providerKeyLeakFieldNeedles = []string{
	"deepseekapikey",
	"braveapikey",
	"apikey",
}

// providerKeyLeakSinkNeedles là những cách mã Go thật sự GHI một giá trị ra
// ngoài tiến trình.
//
// `fmt.errorf(` và `errors.new(` PHẢI có mặt, không phải một bổ sung tuỳ
// chọn: `err.Error()` là ống dẫn số một của CHÍNH REPO NÀY ra cả log lẫn
// thân response — đo được: `internal/apilog/apilog.go:56` viết
// `slog.Error("request failed", ..., "err", err.Error())`, và
// `internal/rating/handler.go:103` viết `"detail": err.Error()` thẳng vào
// thân response; `fmt.Errorf` là quy ước bọc lỗi CỦA DỰ ÁN NÀY (94 lần
// trong mã sản phẩm đo được ở vòng review 2). Thiếu hai needle này, một dòng
// `return fmt.Errorf("deepseek: %s: %w", cfg.DeepSeekAPIKey, err)` — một
// dòng, tham chiếu trường trần, đúng hình dạng cổng này tuyên bố bắt — đi
// qua xanh, và giá trị đó rồi lộ ra qua chính hai đường trên.
var providerKeyLeakSinkNeedles = []string{
	"fmt.printf(",
	"fmt.println(",
	"fmt.sprintf(",
	"fmt.sprint(",
	"fmt.errorf(",
	"errors.new(",
	"fmt.fprint", // phủ cả Fprint/Fprintf/Fprintln — cố tình không đóng ngoặc
	"log.print",
	"log.fatal",
	"log.panic",
	"slog.",
	".json(",
	".jsonp(", // KHÔNG chứa ".json(" như một chuỗi con — "p" chen giữa "n" và "(" — cần needle riêng
	".sendstring(",
	".send(",
	".writef(",
	"os.writefile(",
}

// providerKeyStructDumpVerbs là các động từ format IN CẢ STRUCT, không in
// một trường. Bắt buộc đi kèm `cfg` (xem providerKeyCfgMatch) chứ không tự
// đứng một mình, để tránh chính mìn dương tính giả round 2 review nêu tên:
// `log.Printf("listening on %s", cfg.Port)` dùng `%s`, không dùng verb nào
// trong danh sách này, nên không khớp — trong khi `log.Printf("%+v", cfg)`
// khớp cả `cfg` lẫn `%+v`.
var providerKeyStructDumpVerbs = []string{"%v", "%+v", "%#v"}

// providerKeyCfgWord so khớp biến `cfg` như một TỪ trọn vẹn — không khớp
// "corsCfg", "dbCfg", hay một trường có chữ "cfg" là hậu tố. Đo ngày
// 2026-08-28: mọi định danh `cfg` trong mã sản phẩm của apps/api ĐỀU là một
// config.Config (cmd/api/main.go, internal/server/server.go — `grep -rn
// '\bcfg\b' --include='*.go' . | grep -v _test.go` trả đúng những dòng đó),
// nên cụm từ này không phải một cái tên chung chung tình cờ trùng — nó LÀ
// tên biến project đặt cho config.Config ở khắp nơi.
var providerKeyCfgWord = regexp.MustCompile(`\bcfg\b`)

// providerKeyCfgBareValue so khớp `cfg` khi nó đứng như một GIÁ TRỊ NGUYÊN
// — tức không có `.` ngay sau nó — vì đó là hình dạng "cả struct đi làm đối
// số" mà một động từ format (%v/%+v/%#v) không phải cách duy nhất để tạo
// ra. Round 2 review đo được ba hình dạng bản trước (chỉ nhận biết qua động
// từ format) bỏ lọt, tất cả đều KHÔNG có %v/%+v/%#v nào trong dòng:
//
//	return c.JSON(cfg)                 // c.JSON tự marshal cả struct
//	slog.Error("boot", "cfg", cfg)     // slog tự render giá trị, không cần verb
//	c.Send([]byte(fmt.Sprint(cfg)))    // fmt.Sprint không có verb nào để quét
//
// RE2 (package regexp của Go) không có lookahead, nên không viết được
// "cfg KHÔNG theo sau bởi dấu chấm" trực tiếp. Thay vào đó khớp CHIỀU
// DƯƠNG: `cfg` theo sau bởi một trong các ký tự chỉ xuất hiện khi `cfg` là
// đối số/giá trị cuối cùng của một biểu thức — dấu phẩy, ngoặc đóng, ngoặc
// vuông đóng, ngoặc nhọn đóng (`,)]}`, có thể cách nhau khoảng trắng). Điều
// này KHÔNG khớp `cfg.Port` (ký tự ngay sau `cfg` là `.`, không nằm trong
// lớp trên) nên mìn dương tính giả round 2 review nêu tên (`main.go:69`,
// `log.Printf("listening on %s", cfg.Port)`) vẫn im lặng — xem case
// `logStartup` (dùng `cfg.Port`) trong TestProviderKeyStructuralScanIsNotVacuous.
var providerKeyCfgBareValue = regexp.MustCompile(`\bcfg\b\s*[,)\]}]`)

// minProductGoFilesForProviderKeyScan là chốt chống cổng mù: một đường dẫn
// sai (hoặc bộ lọc thư mục nuốt nhầm) làm phép quét đọc 0 tệp và báo đạt vĩnh
// viễn — đúng hình dạng bốn cổng mù ghi ở docs/carried-forward.md. Đo ngày
// 2026-08-28: 26 tệp sản phẩm, tất cả dưới apps/api. Ngưỡng đặt dưới hẳn con
// số đo được để một lần xoá gói hợp lệ không tự làm đỏ; chốt THẬT nằm ở danh
// sách sentinel bên dưới.
const minProductGoFilesForProviderKeyScan = 18

// providerKeyScanSentinels là những tệp mà một vi phạm SẼ nằm ở đó nếu nó
// nằm ở đâu cả hôm nay: nơi cấu hình được đọc ra (config.go), nơi nó được
// truyền vào server (main.go), và nơi nó được nhận vào làm tham số `cfg`
// (server.go). internal/ai (Task 4) và một client Brave (Task 8) chưa tồn
// tại lúc tệp này được viết — phép quét dưới đây vẫn phủ chúng vì nó đi bằng
// filepath.Walk trên GỐC REPO chứ không bằng danh sách tệp, nhưng không tệp
// nào có thể ghim làm sentinel cho một gói chưa được tạo.
var providerKeyScanSentinels = []string{
	"apps/api/internal/config/config.go",
	"apps/api/cmd/api/main.go",
	"apps/api/internal/server/server.go",
}

// providerKeySkippedDirs mirrors no_key_transit_test.go's list before it —
// `.claude` là mục BẮT BUỘC: bản checkout chính giữ worktree của từng agent
// dưới .claude/worktrees/agent-*/, mỗi cái là một bản sao đầy đủ của repo,
// nên thiếu dòng này phép quét đọc cả mã của agent khác và báo lỗi bằng
// đường dẫn của họ.
var providerKeySkippedDirs = map[string]bool{
	".git":         true,
	".claude":      true,
	"node_modules": true,
	"dist":         true,
	"build":        true,
	"vendor":       true,
}

// providerKeyRepoRoot đi ngược lên từ thư mục gói (go test đặt cwd ở đó) tới
// thư mục chứa go.work — neo ở GỐC REPO, không phải ở apps/api, cùng lý do
// no_key_transit_test.go's repoRoot nêu: lời hứa nói về "máy chủ của chúng
// ta", không nói về module Go tên tuhoc-api, và một module thứ hai
// (apps/aiproxy chẳng hạn) là chính con đường dự phòng dự án đã cấm. Không
// đường lui khi thiếu go.work: một fallback im lặng là đúng hình dạng đã
// sinh ra các cổng mù trước.
func providerKeyRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("không lấy được thư mục làm việc: %v", err)
	}
	for range 12 {
		if _, err := os.Stat(filepath.Join(dir, "go.work")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Fatalf("không tìm thấy go.work khi đi ngược lên từ %q — phép quét này neo "+
		"ở gốc repo và KHÔNG tự lui về gốc module. Chạy qua `make test-api` từ "+
		"gốc repo.", dir)
	return ""
}

// providerKeyGoSources đọc mọi tệp .go SẢN PHẨM (không phải *_test.go) của
// repo, khoá theo đường dẫn tương đối gốc repo, nội dung đã hạ chữ thường.
//
// Loại trừ *_test.go ngay ở bước đọc: cả hai hình dạng rò (tên trường, biến
// cfg) đều hợp pháp trong mã test — config_test.go tự nó gán/so sánh
// cfg.DeepSeekAPIKey liên tục, và TestProviderKeySentinelAppearsInNoResponseOrLog
// ngay dưới đây cũng phải dựng cfg thật để có gì mà kiểm — nên không có lý
// do đọc tệp test vào rồi lọc ra sau.
//
// KHÔNG dùng hàm này cho TestNoRequestStructAcceptsAKey phía dưới —
// property đó phải quét CẢ tệp test, xem providerKeyGoSourcesIncludingTests
// riêng và chú thích của keyBearingFields để hiểu vì sao.
func providerKeyGoSources(t *testing.T) map[string]string {
	t.Helper()
	root := providerKeyRepoRoot(t)

	out := map[string]string{}
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if p != root && providerKeySkippedDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		out[filepath.ToSlash(rel)] = strings.ToLower(string(b))
		return nil
	})
	if err != nil {
		t.Fatalf("không quét được nguồn Go dưới %s: %v", root, err)
	}

	if len(out) < minProductGoFilesForProviderKeyScan {
		t.Fatalf("chỉ quét được %d tệp Go sản phẩm dưới %s (tối thiểu %d) — "+
			"đường dẫn sai hoặc bộ lọc thư mục nuốt mất repo. Phép quét này ĐANG "+
			"KHÔNG KIỂM GÌ; đừng hạ ngưỡng, hãy sửa đường dẫn.",
			len(out), root, minProductGoFilesForProviderKeyScan)
	}
	var missing []string
	for _, s := range providerKeyScanSentinels {
		if _, ok := out[s]; !ok {
			missing = append(missing, s)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("quét được %d tệp nhưng THIẾU %d tệp neo: %s. Nếu một tệp neo "+
			"thật sự đã bị xoá hoặc đổi tên thì sửa providerKeyScanSentinels MỘT "+
			"CÁCH CÓ Ý THỨC; nếu không, phép quét đang bỏ sót đúng chỗ nó cần nhìn.",
			len(out), len(missing), strings.Join(missing, ", "))
	}
	t.Logf("phép quét key nhà cung cấp đọc %d tệp .go sản phẩm dưới %s", len(out), root)
	return out
}

// providerKeyScan trả về các dòng "path:line: [tag] src" đã sắp xếp, cho mọi
// dòng vừa khớp `match` (trả về nhãn khi khớp) vừa chứa ít nhất một needle
// trong `sinks`. Tách khỏi test để chính nó kiểm được bằng nguồn tổng hợp —
// xem TestProviderKeyStructuralScanIsNotVacuous.
func providerKeyScan(sources map[string]string, match func(line string) (tag string, ok bool), sinks []string) []string {
	var hits []string
	for path, src := range sources {
		for i, line := range strings.Split(src, "\n") {
			tag, ok := match(line)
			if !ok {
				continue
			}
			for _, sink := range sinks {
				if strings.Contains(line, sink) {
					hits = append(hits, fmt.Sprintf("%s:%d: [%s + %s] %s",
						path, i+1, tag, sink, strings.TrimSpace(line)))
					break
				}
			}
		}
	}
	sort.Strings(hits)
	return hits
}

func providerKeyFieldMatch(line string) (string, bool) {
	for _, f := range providerKeyLeakFieldNeedles {
		if strings.Contains(line, f) {
			return f, true
		}
	}
	return "", false
}

// providerKeyCfgMatch khớp "cả struct cfg đi làm đối số cho một sink" theo
// HAI hình dạng độc lập — cả hai đều phải giữ, không cái nào thay được cái
// kia:
//
//  1. `cfg` (nguyên từ) cộng một động từ format in-cả-struct (%v/%+v/%#v)
//     cùng dòng — bắt `log.Printf("%+v", cfg)`. Thu hẹp có chủ đích khỏi
//     một `\bcfg\b` trần (round 2 review vòng 1, mìn
//     `log.Printf("...%s...", cfg.Port)`).
//  2. `cfg` đứng như GIÁ TRỊ NGUYÊN (providerKeyCfgBareValue) — bắt
//     `c.JSON(cfg)`, `slog.Error("boot", "cfg", cfg)`,
//     `fmt.Sprint(cfg)`, những sink KHÔNG đọc một chuỗi format nên
//     nhánh 1 mù hoàn toàn với chúng (round 2 review vòng 2, ba hình dạng
//     nhánh 1 một mình bỏ lọt — xem case tương ứng trong
//     TestProviderKeyStructuralScanIsNotVacuous).
func providerKeyCfgMatch(line string) (string, bool) {
	if providerKeyCfgWord.MatchString(line) {
		for _, v := range providerKeyStructDumpVerbs {
			if strings.Contains(line, v) {
				return "cfg+" + v, true
			}
		}
	}
	if providerKeyCfgBareValue.MatchString(line) {
		return "cfg (giá trị nguyên)", true
	}
	return "", false
}

// TestProviderKeyStructuralScanIsNotVacuous is cổng cho chính cổng cấu trúc.
//
// Cả hai test structural bên dưới khẳng định "không tìm thấy gì". Một phép
// so khớp hỏng — needle rỗng, quên hạ chữ thường một bên, Contains bị đổi
// thành Equal trong một lần "dọn dẹp" — cho ra đúng cùng kết quả xanh. Test
// này bơm nguồn tổng hợp qua CÙNG hàm providerKeyScan và đòi nó ĐỎ, nên bộ dò
// được chứng minh còn sống ở mọi lần chạy, không chỉ ở buổi cài mutant tay
// nói trong báo cáo.
func TestProviderKeyStructuralScanIsNotVacuous(t *testing.T) {
	// Trực tiếp: trường trần ngay trong lời gọi sink, không qua biến trung
	// gian, không dựa vào một chú thích tình cờ lặp lại tên trường (round 2
	// review bắt đúng lỗi đó ở bản trước — một comment `/* DeepSeekAPIKey */`
	// trên cùng dòng làm phép quét khớp vì lý do SAI). Đây là hình dạng THẬT
	// cổng này tuyên bố bắt: một dòng, một trường trần, một sink.
	violatingField := map[string]string{
		"apps/api/internal/ai/client.go": strings.ToLower(`package ai
func debugLog(cfg config.Config) {
	log.Printf("calling deepseek with key=%s", cfg.DeepSeekAPIKey)
}`),
	}
	if got := providerKeyScan(violatingField, providerKeyFieldMatch, providerKeyLeakSinkNeedles); len(got) == 0 {
		t.Error("phép quét tên trường không bắt được nguồn vi phạm tổng hợp — " +
			"bộ dò đã chết")
	}

	// fmt.Errorf/errors.New là ống dẫn thật của repo (xem chú thích của
	// providerKeyLeakSinkNeedles) — nếu needle này rơi rụng, dòng dưới đây
	// phải vẫn bắt được, và test này đảm bảo nó bắt được ở MỌI lần chạy.
	violatingErrorf := map[string]string{
		"apps/api/internal/ai/client.go": strings.ToLower(`package ai
func call(cfg config.Config) error {
	return fmt.Errorf("deepseek call failed with key %s", cfg.DeepSeekAPIKey)
}`),
	}
	if got := providerKeyScan(violatingErrorf, providerKeyFieldMatch, providerKeyLeakSinkNeedles); len(got) == 0 {
		t.Error("phép quét tên trường không bắt được fmt.Errorf trên nguồn vi phạm — " +
			"đúng lỗ Critical 1 của round 2 review")
	}

	violatingCfgDump := map[string]string{
		"apps/api/internal/ai/client.go": strings.ToLower(`package ai
func debugLog(cfg config.Config) {
	log.Printf("loaded config: %+v", cfg)
}`),
	}
	if got := providerKeyScan(violatingCfgDump, providerKeyCfgMatch, providerKeyLeakSinkNeedles); len(got) == 0 {
		t.Error("phép quét biến cfg không bắt được nguồn vi phạm tổng hợp — " +
			"bộ dò đã chết")
	}

	// Round 2 review vòng 2: nhánh chỉ-nhận-động-từ-format (ở trên) bỏ lọt
	// ba hình dạng "cả struct đi làm đối số" KHÔNG có %v/%+v/%#v nào trong
	// dòng — đo được thật trên bản trước vòng này. providerKeyCfgBareValue
	// vá đúng lỗ đó; ba dòng dưới đây phải bắt được ĐỦ CẢ BA, độc lập với
	// nhánh động từ format.
	violatingCfgBareValue := map[string]string{
		"apps/api/internal/ai/client.go": strings.ToLower(`package ai
func h1(cfg config.Config) error {
	return c.JSON(cfg)
}
func h2(cfg config.Config) {
	slog.Error("boot", "cfg", cfg)
}
func h3(cfg config.Config) {
	c.Send([]byte(fmt.Sprint(cfg)))
}`),
	}
	if got := providerKeyScan(violatingCfgBareValue, providerKeyCfgMatch, providerKeyLeakSinkNeedles); len(got) != 3 {
		t.Errorf("phép quét cfg-giá-trị-nguyên phải bắt đúng 3 dòng "+
			"(c.JSON(cfg), slog.Error(..., cfg), fmt.Sprint(cfg)) — bắt được %d: %v",
			len(got), got)
	}

	// Chiều ngược lại: nguồn vô hại không được khớp, ở cả hai phép quét —
	// gồm CẢ mìn round 2 review nêu tên: cfg.Port cạnh log.Printf, không có
	// động từ in-cả-struct nào, không được khớp.
	benign := map[string]string{
		"apps/api/internal/ai/client.go": strings.ToLower(`package ai
// DeepSeekAPIKey đi thẳng vào header Authorization gửi tới DeepSeek — đây
// KHÔNG phải một chỗ rò, vì đích đến là nhà cung cấp, không phải log hay
// response của TA.
func newRequest(cfg config.Config) *http.Request {
	req, _ := http.NewRequest("POST", cfg.DeepSeekBaseURL, nil)
	req.Header.Set("Authorization", "Bearer "+cfg.DeepSeekAPIKey)
	return req
}
func logStartup(cfg config.Config) {
	log.Printf("listening on %s", cfg.Port)
}
// Hình dạng THẬT của chính repo này (main.go:62, server.go:386): cfg đứng
// TRẦN, ngay trước dấu phẩy — khớp providerKeyCfgBareValue — nhưng KHÔNG có
// sink nào trên dòng, nên vẫn phải im lặng. Đây không phải suy đoán: cả hai
// dòng dưới lấy nguyên hình dạng từ mã sản phẩm thật đang chạy.
func wireApp(cfg config.Config) {
	app := server.New(cfg, deps)
	_ = adminOrToken(cfg, handler)
}`),
	}
	if got := providerKeyScan(benign, providerKeyFieldMatch, providerKeyLeakSinkNeedles); len(got) != 0 {
		t.Errorf("phép quét tên trường báo vi phạm trên nguồn vô hại: %v", got)
	}
	if got := providerKeyScan(benign, providerKeyCfgMatch, providerKeyLeakSinkNeedles); len(got) != 0 {
		t.Errorf("phép quét biến cfg báo vi phạm trên nguồn vô hại (cfg.Port cạnh "+
			"log.Printf không có %%v/%%+v/%%#v phải im lặng — đây là mìn dương tính "+
			"giả round 2 review nêu tên): %v", got)
	}

	// Và phép quét thật phải chạm được vào repo thật — providerKeyGoSources
	// tự nó đã fatal nếu đọc quá ít tệp, nên không cần một điều kiện thừa ở
	// đây (một `if n < floor { t.Errorf }` sau lời gọi không bao giờ chạy
	// tới được, vì hàm đã Fatalf trước đó rồi — mã chết bị round 2 review
	// nêu tên).
	t.Logf("providerKeyGoSources đọc được %d tệp thật", len(providerKeyGoSources(t)))
}

// TestProviderKeyNeverReachesLogOrResponse là NỬA CẤU TRÚC — xem chú thích
// đầu tệp cho lý do nó tồn tại bên cạnh nửa hành vi, và cho PHẠM VI THẬT của
// nó (chỉ cùng dòng, chỉ hai tên trường + cfg, không canh đích đến).
func TestProviderKeyNeverReachesLogOrResponse(t *testing.T) {
	sources := providerKeyGoSources(t)

	var offenders []string
	offenders = append(offenders, providerKeyScan(sources, providerKeyFieldMatch, providerKeyLeakSinkNeedles)...)
	offenders = append(offenders, providerKeyScan(sources, providerKeyCfgMatch, providerKeyLeakSinkNeedles)...)
	sort.Strings(offenders)

	for _, o := range offenders {
		t.Errorf("key nhà cung cấp có thể rời máy chủ ở đây: %s\n"+
			"Cổng này cưỡng chế đúng MỘT điều: DeepSeekAPIKey/BraveAPIKey (hoặc "+
			"cfg khi bị in nguyên struct) không được đứng cùng dòng với một lời "+
			"gọi ghi ra ngoài qua log (log.*/slog.*/fmt.Print*/fmt.Errorf/"+
			"errors.New) hay một response của API này (.JSON(/.SendString(/...).\n"+
			"TODO(Task 4): cổng này KHÔNG canh đích đến của một lời gọi ra ngoài — "+
			"allowlist đó (chặn mã sản phẩm gọi ra ngoài trừ danh sách hẹp) bị xoá "+
			"cùng no_key_transit_test.go và chưa có cổng thay thế; viết nó khi "+
			"client DeepSeek ra đời. Xem spec §0.1, §3.2(3).", o)
	}
}

// ── PHẦN SỐNG SÓT TỪ no_key_transit_test.go: KHÔNG CHIỀU NHẬN KEY ─────────
//
// TestNoRequestStructAcceptsAKey khẳng định "không route/struct nào của repo
// này NHẬN một key của BÊN THỨ BA từ request" — TRỰC GIAO với mọi thứ ở
// trên. Cổng ở trên canh "máy chủ giữ key CỦA TA có rời máy chủ hay không";
// test này canh "máy chủ có nhận key CỦA NGƯỜI DÙNG hay không". Pha 2 đổi
// câu trả lời của câu hỏi thứ nhất (từ "không bao giờ có key" thành "có,
// nhưng không được rời máy chủ") nhưng KHÔNG đổi câu trả lời của câu hỏi thứ
// hai — nhà cung cấp không cho gọi được từ trình duyệt thì vẫn không được hỗ
// trợ (spec §7), y hệt Pha 1. Vì lý do đó, khẳng định này được khôi phục
// nguyên vẹn vào tệp cổng mới thay vì bị xoá theo cả tệp cũ.

// keyBearingFields là tên trường mang key, ở dạng chúng xuất hiện trong thẻ
// struct JSON hoặc trong một lời gọi ĐỌC header. So khớp sau khi hạ chữ
// thường cả nguồn lẫn needle, nên `json:"API_Key"` và `c.Get("AUTHORIZATION")`
// cũng dính. Nguyên văn từ no_key_transit_test.go — không có lý do viết lại
// một danh sách đã đo.
//
// Chỉ cấm lời gọi ĐỌC header, không cấm chữ "Authorization" trần: hôm nay
// apps/api/internal/course/course_test.go:1294 dựng một header Authorization
// để chứng minh server PHỚT LỜ nó (phiên chạy bằng cookie). Cấm chữ trần sẽ
// làm dây bẫy đỏ ngay trên nền sạch, và một dây bẫy đỏ sẵn thì không ai tin.
var keyBearingFields = []string{
	`json:"api_key`,
	`json:"apikey`,
	`json:"secret`,
	`json:"access_token`,
	`json:"refresh_token`,
	`json:"bearer`,
	`get("authorization")`,
	`get("x-api-key")`,
	`get("api-key")`,
	`get("anthropic-api-key")`,
	`peek("authorization")`,
	`peek("x-api-key")`,
	`getreqheaders()`,
}

// minAllGoFilesForKeyBearingScan / keyBearingScanSentinels mirror
// no_key_transit_test.go's own floor and anchor files — đo lại ngày
// 2026-08-28: 44 tệp .go dưới repo (26 sản phẩm + 18 test), tự loại 1 (chính
// tệp này) → 43 tệp phải đọc được. Ngưỡng đặt dưới hẳn con số đo để một lần
// xoá tệp hợp lệ không tự làm đỏ.
const minAllGoFilesForKeyBearingScan = 20

var keyBearingScanSentinels = []string{
	"apps/api/cmd/api/main.go",
	"apps/api/internal/server/server.go",
	"apps/api/internal/auth/handler.go",
	"apps/api/internal/catalog/handler.go",
	"apps/api/internal/sync/handler.go",
	"apps/api/internal/stats/handler.go",
}

// providerKeyGoSourcesIncludingTests đọc MỌI tệp .go của repo — kể cả
// *_test.go — trừ chính tệp này. Khác providerKeyGoSources (dùng cho hai
// test bên trên) một cách có chủ ý: property "không route nào nhận key của
// người dùng" phải đúng ở MỌI mã, kể cả một fixture test lỡ dựng đúng hình
// dạng chấp-nhận-key rồi bị copy-paste sang một handler thật sau này.
func providerKeyGoSourcesIncludingTests(t *testing.T) map[string]string {
	t.Helper()
	root := providerKeyRepoRoot(t)

	out := map[string]string{}
	self := 0
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if p != root && providerKeySkippedDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") {
			return nil
		}
		// Tệp này mang mọi chuỗi bị cấm trong keyBearingFields (ngay trong
		// khai báo biến ở trên) — không loại trừ chính mình thì tự làm mình
		// đỏ trên nền sạch.
		if info.Name() == "provider_key_never_leaks_test.go" {
			self++
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		out[filepath.ToSlash(rel)] = strings.ToLower(string(b))
		return nil
	})
	if err != nil {
		t.Fatalf("không quét được nguồn Go dưới %s: %v", root, err)
	}

	if len(out) < minAllGoFilesForKeyBearingScan {
		t.Fatalf("chỉ quét được %d tệp Go (kể cả test) dưới %s (tối thiểu %d) — "+
			"đường dẫn sai hoặc bộ lọc thư mục nuốt mất repo. Phép quét này ĐANG "+
			"KHÔNG KIỂM GÌ; đừng hạ ngưỡng, hãy sửa đường dẫn.",
			len(out), root, minAllGoFilesForKeyBearingScan)
	}
	var missing []string
	for _, s := range keyBearingScanSentinels {
		if _, ok := out[s]; !ok {
			missing = append(missing, s)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("quét được %d tệp nhưng THIẾU %d tệp neo: %s.",
			len(out), len(missing), strings.Join(missing, ", "))
	}
	if self != 1 {
		t.Fatalf("phép tự loại trừ khớp %d tệp, phải khớp đúng 1 (chính tệp "+
			"này). 0 = tệp đã đổi tên; >1 = có bản sao của dây bẫy.", self)
	}
	t.Logf("phép quét key-bên-thứ-ba đọc %d tệp .go (kể cả test) dưới %s "+
		"(bỏ qua 1: chính dây bẫy này)", len(out), root)
	return out
}

// scanKeyBearing trả về "path: needle" đã sắp xếp cho mọi needle xuất hiện
// BẤT KỲ ĐÂU trong nguồn (không cần cùng dòng với gì khác — bản thân sự có
// mặt của một trong các hình dạng này đã là vi phạm, không cần một sink đi
// kèm). Giống hệt hàm scan() của no_key_transit_test.go trước đây.
func scanKeyBearing(sources map[string]string, needles []string) []string {
	var hits []string
	for path, src := range sources {
		for _, n := range needles {
			if strings.Contains(src, strings.ToLower(n)) {
				hits = append(hits, path+": "+n)
			}
		}
	}
	sort.Strings(hits)
	return hits
}

// TestNoRequestStructAcceptsAKeyScanIsNotVacuous là dây bẫy cho chính dây
// bẫy khôi phục, cùng kỷ luật với TestProviderKeyStructuralScanIsNotVacuous
// ở trên.
func TestNoRequestStructAcceptsAKeyScanIsNotVacuous(t *testing.T) {
	violating := map[string]string{
		"apps/api/internal/ai/handler.go": strings.ToLower(`package ai
type bringYourOwnKeyRequest struct {
	APIKey string ` + "`" + `json:"api_key"` + "`" + `
}
func (h *Handler) Ask(c *fiber.Ctx) error {
	tok := c.Get("Authorization")
	_ = tok
	return nil
}`),
	}
	if got := scanKeyBearing(violating, keyBearingFields); len(got) == 0 {
		t.Error("scanKeyBearing không bắt được nguồn vi phạm tổng hợp — bộ dò đã chết")
	}

	benign := map[string]string{
		"apps/api/internal/course/course_test.go": strings.ToLower(`package course_test
func TestServerIgnoresAuthorizationHeader(t *testing.T) {
	req.Header.Set("Authorization", "Bearer some-users-own-key")
}`),
	}
	if got := scanKeyBearing(benign, keyBearingFields); len(got) != 0 {
		t.Errorf("scanKeyBearing báo vi phạm trên nguồn vô hại (Header.Set, không "+
			"phải Get/Peek đọc vào) — đây đúng là trường hợp course_test.go:1294 "+
			"thật đang làm: %v", got)
	}

	t.Logf("providerKeyGoSourcesIncludingTests đọc được %d tệp thật",
		len(providerKeyGoSourcesIncludingTests(t)))
}

// TestNoRequestStructAcceptsAKey là property SỐNG SÓT nguyên vẹn từ
// no_key_transit_test.go — xem chú thích khối ngay phía trên phần này cho
// lý do nó trực giao với cú thay cổng và vì sao được giữ lại.
func TestNoRequestStructAcceptsAKey(t *testing.T) {
	for _, hit := range scanKeyBearing(providerKeyGoSourcesIncludingTests(t), keyBearingFields) {
		t.Errorf("%s — không route nào được nhận key của người dùng, kể cả "+
			"\"chỉ đi ngang không lưu\" (spec §7). Không có đường dự phòng qua "+
			"server: nhà cung cấp không cho gọi từ trình duyệt thì không được "+
			"hỗ trợ. Nếu chuỗi này KHÔNG dính tới key của bên thứ ba (ví dụ một "+
			"header của chính ta), sửa keyBearingFields ngay tại đây kèm lý do.", hit)
	}
}

// ── NỬA HÀNH VI ──────────────────────────────────────────────────────────
//
// SỬA Ở ROUND 2 REVIEW VÒNG 2 (Important #3): bản trước gọi ba buffer dưới
// đây là "ba đích log riêng biệt TRONG TIẾN TRÌNH THẬT". Câu đó SAI, và
// đúng loại lỗi repo này chuyên đi dọn — một khẳng định nghe như đã kiểm
// mà không đúng với thứ nó mô tả. Sự thật, đo bằng cách đọc thẳng nguồn
// stdlib (`$(go env GOROOT)/src/log/slog/logger.go`,
// `.../log/slog/handler.go`):
//
//   - `slog.SetDefault` CHỈ được gọi từ mã TEST (vài tệp *_test.go, mỗi tệp
//     để tự chụp log của chính bài nó — không liệt kê tên ở đây, một danh
//     sách tên tệp trong một chú thích là thứ lệch lặng lẽ, và bản trước của
//     dòng này đã lệch đúng như thế: nó kể hai tệp trong khi đã có ba).
//     Điều KHÔNG đổi và là điều thật sự load-bearing: tiến trình sản phẩm —
//     `cmd/api/main.go` và mọi gói `internal/*` — KHÔNG BAO GIỜ gọi nó.
//   - Khi không ai gọi `SetDefault`, `slog.Default()` là một `*defaultHandler`
//     (log/slog/handler.go). Đọc thẳng chú thích trong nguồn của chính nó:
//     "Collect the level, attributes and message in a string and write it
//     with the default log.Logger. Let the log.Logger handle time and
//     file/line." — nghĩa là ở TIẾN TRÌNH SẢN PHẨM, `slog.Error(...)` (thứ
//     `apilog` gọi) tự nó chảy VÀO gói `log` chuẩn, không phải ngược lại.
//   - Ngược lại, `slog.SetDefault(l)` (log/slog/logger.go:62-74) làm đúng
//     điều ngược: nó gọi `log.SetOutput(&handlerWriter{l.Handler(), ...})`,
//     tức chiếm quyền ghi của gói `log` chuẩn và đẩy nó VÀO `l`'s Handler.
//     Đây CHỈ xảy ra trong bài test này, từ đúng dòng `captureSlog(t)` gọi
//     nó, không phải một pha nào trong vòng đời tiến trình thật.
//
// Hệ quả: tiến trình sản phẩm thật có ĐÚNG HAI đích log, không phải ba —
// (1) một luồng stderr DÙNG CHUNG cho cả `log.*` lẫn `slog.*` (vì
// `defaultHandler` tự chảy vào `log`), và (2) access log riêng của fiber
// (`Deps.LogOutput`). "Ba buffer" dưới đây là hình dạng CỦA CHÍNH HÀM TEST
// NÀY — nó chủ động dựng ra một sự phân tách không tồn tại trong tiến
// trình thật, để có thể chụp và kiểm riêng từng phần, KHÔNG PHẢI để mô tả
// kiến trúc logging thật của server.
//
//  1. slog buffer (`slogLogs`, qua captureSlog) — thứ apilog.Internal/
//     apilog.Panic viết qua, VÀ (chỉ trong khuôn khổ bài test này, từ thời
//     điểm captureSlog(t) chạy trở đi) thứ mọi lời gọi `log.Printf` cũng bị
//     đẩy vào, vì cơ chế `handlerWriter` nói trên. slog chỉ ghi ở nhánh
//     lỗi, nên phải CHỦ ĐỘNG ép một lỗi thật xảy ra (dropTable, mượn đúng
//     kỹ thuật observability_test.go dùng) — không có bước đó, không
//     request thành công nào tạo ra dù chỉ một dòng.
//  2. Access log của fiber (Deps.LogOutput) — bài trước đưa thẳng vào
//     io.Discard, nên "không tìm thấy sentinel trong access log" chưa từng
//     là một khẳng định có kiểm gì. Đưa vào một *bytes.Buffer thật.
//  3. `log.SetOutput(&stdlibLog)` — chỉ canh được CỬA SỔ TRƯỚC ĐIỂM
//     `captureSlog(t)` CHẠY TRONG CHÍNH HÀM TEST NÀY (không phải "trước
//     một pha khởi động nào của server thật" — server thật không có pha
//     đó). Sau điểm đó, `log.SetOutput` bị `handlerWriter` ghi đè lặng lẽ
//     (đúng cơ chế mục 1), nên mọi `log.Printf` gọi SAU đi vào `slogLogs`
//     chứ không vào `stdlibLog` nữa — đo thực nghiệm ở round 2 review vòng
//     1: mutant `log.Printf(...)` cài trong `New()` (chạy sau
//     captureSlog(t)) làm ĐỎ đúng khẳng định slog, không phải khẳng định
//     stdlib log (ghi lại trong task-3-report.md). Cửa sổ TRƯỚC đó — nơi
//     `stdlibLog` thật sự canh được — bị ép phát sinh nội dung bằng đúng cơ
//     chế config_test.go dùng cho cảnh báo COOKIE_SECURE
//     (TestLoad_CookieSecureGarbageFailsClosedWithWarning): đặt COOKIE_SECURE
//     thành một giá trị không hợp lệ TRƯỚC khi gọi config.Load().
//
// Vì mục 1 phụ thuộc vào một thuộc tính CỦA MỘT TỆP TEST KHÁC
// (captureSlog dựng handler với `Level: slog.LevelDebug`,
// observability_test.go:54 — thấp hơn `Info`, mức mặc định
// `slog.SetLogLoggerLevel` dùng cho log.Printf) mà không tệp nào ở đây
// khẳng định trực tiếp, có một canary riêng ngay trong thân hàm test dưới
// đây kiểm đúng thuộc tính đó — xem chú thích tại chỗ khai báo
// `logBridgeCanary`.

func TestProviderKeySentinelAppearsInNoResponseOrLog(t *testing.T) {
	const sentinel = "sk-SENTINEL-do-not-emit-7f3c1a"
	t.Setenv("DEEPSEEK_API_KEY", sentinel)
	// Ép config.go's parseCookieSecure log một cảnh báo qua stdlib `log` —
	// đích log duy nhất trong ba đích không có route nào ở dưới tự nhiên
	// chạm tới. Giá trị không liên quan gì tới sentinel; mục đích CHỈ là
	// chứng minh việc chụp log chuẩn của stdlib thật sự hoạt động.
	t.Setenv("COOKIE_SECURE", "not-a-valid-bool-anti-vacuity-check")

	var stdlibLog bytes.Buffer
	origLogOutput := log.Writer()
	log.SetOutput(&stdlibLog)
	t.Cleanup(func() { log.SetOutput(origLogOutput) })

	cfg := config.Load()
	if cfg.DeepSeekAPIKey != sentinel {
		t.Fatalf("tự kiểm: config.Load() không đọc được sentinel vừa đặt — "+
			"got %q, muốn %q. Nếu điều này đỏ, phần còn lại của bài test không "+
			"kiểm gì cả.", cfg.DeepSeekAPIKey, sentinel)
	}

	pool := store.TestPool(t)
	slogLogs := captureSlog(t)

	// Canary cho cầu nối log -> slog (xem khối chú thích "NỬA HÀNH VI" phía
	// trên cho lý do cầu nối này tồn tại và tại sao nó mong manh). Nó chỉ
	// sống vì captureSlog dựng handler với Level: slog.LevelDebug
	// (observability_test.go:54), trong khi slog.SetLogLoggerLevel mặc định
	// là Info — Info >= Debug nên log.Printf/log.Print lọt qua. Nếu ai đó hạ
	// mức đó xuống slog.LevelError (một cú dọn dẹp rất hợp lý — "mức Info
	// thì ai đọc"), cầu nối câm lặng nuốt mọi log.Printf, VÀ KHÔNG TEST NÀO
	// TRONG TỆP NÀY ĐỎ ĐỂ NÓI VÌ SAO: apilog.Internal vẫn ghi ở mức Error
	// nên `slogged` bên dưới vẫn không rỗng — chỉ là không rỗng VÌ MỘT LÝ DO
	// KHÁC, và mutation (a) (round 2 review vòng 1) sẽ thoát cả hai nửa
	// trong im lặng. Đốt một dòng mốc NGAY TẠI ĐÂY, qua log.Print (không
	// phải apilog/slog trực tiếp), và đòi nó CÓ MẶT trong slog trước khi tin
	// bất kỳ khẳng định "không có sentinel trong slog" nào ngay dưới —
	// chốt này đỏ trước và nói đúng lý do nếu cầu nối chết, thay vì để mất
	// nửa vùng phủ trong im lặng.
	const logBridgeCanary = "provider-key-log-bridge-canary-3f9c"
	log.Print(logBridgeCanary)

	var accessLog bytes.Buffer
	app := New(cfg, Deps{Pool: pool, LogOutput: &accessLog})

	type step struct {
		method string
		path   string
		want   int
	}
	steps := []step{
		{http.MethodGet, "/healthz", http.StatusOK},
		{http.MethodGet, "/courses", http.StatusOK},
		{http.MethodGet, "/courses/khong-ton-tai", http.StatusNotFound},
	}
	for _, s := range steps {
		resp, body := doTestRequest(t, app, s.method, s.path, nil, nil)
		if resp.StatusCode != s.want {
			t.Fatalf("%s %s: want %d got %d body=%s — bài test cần route này trả "+
				"lời đúng như mô tả để phép kiểm dưới đây có ý nghĩa",
				s.method, s.path, s.want, resp.StatusCode, body)
		}
		if strings.Contains(body, sentinel) {
			t.Errorf("%s %s: thân response mang key nhà cung cấp: %s", s.method, s.path, body)
		}
	}

	// Ép một lỗi 500 THẬT xảy ra, để apilog.Internal thật sự chạy và slog
	// thật sự có nội dung để kiểm — không có bước này, "không tìm thấy
	// sentinel trong slog" là một khẳng định đúng trên một buffer rỗng.
	dropTable(t, pool, "published_courses")
	resp500, body500 := doTestRequest(t, app, http.MethodGet, "/courses", nil, nil)
	if resp500.StatusCode != http.StatusInternalServerError {
		t.Fatalf("GET /courses (bảng published_courses đã bị xoá): muốn 500 để "+
			"ép apilog chạy thật, got %d body=%s", resp500.StatusCode, body500)
	}
	if strings.Contains(body500, sentinel) {
		t.Errorf("GET /courses (500): thân response mang key nhà cung cấp: %s", body500)
	}

	// ---- slog / apilog ----
	slogged := slogLogs.take()
	if !strings.Contains(slogged, logBridgeCanary) {
		t.Fatalf("cầu nối log -> slog đã chết: dòng mốc %q (ghi bằng log.Print "+
			"ngay sau captureSlog) không xuất hiện trong slog. Nguyên nhân nhiều "+
			"khả năng nhất: captureSlog's handler (observability_test.go) không "+
			"còn cấu hình Level: slog.LevelDebug — log.Printf/log.Print phát ở mức "+
			"Info, và bất kỳ mức lọc nào CAO HƠN Debug (ví dụ LevelError) nuốt câm "+
			"lặng mọi log.Printf trong khi apilog (ghi ở mức Error) vẫn lọt qua, "+
			"khiến 'slogged không rỗng' xanh vì MỘT LÝ DO KHÁC — đây chính là lỗ "+
			"round 2 review vòng 2 đo được. Logged:\n%s", logBridgeCanary, slogged)
	}
	if strings.Contains(slogged, sentinel) {
		t.Errorf("apilog (slog) mang key nhà cung cấp. Logged:\n%s", slogged)
	}

	// ---- access log (fiber logger middleware) ----
	if accessLog.Len() == 0 {
		t.Fatal("access log rỗng — Deps.LogOutput không thật sự được ghi vào " +
			"trong bài test này. Nếu điều này đỏ, khẳng định 'không có sentinel " +
			"trong access log' ngay dưới đây chưa từng kiểm gì.")
	}
	if strings.Contains(accessLog.String(), sentinel) {
		t.Errorf("access log (fiber logger) mang key nhà cung cấp. Logged:\n%s", accessLog.String())
	}

	// ---- stdlib log ----
	if stdlibLog.Len() == 0 {
		t.Fatal("stdlib log rỗng — COOKIE_SECURE=giá-trị-rác ở đầu bài test phải " +
			"buộc config.go's parseCookieSecure gọi log.Printf. Nếu điều này đỏ, " +
			"khẳng định 'không có sentinel trong stdlib log' ngay dưới đây chưa " +
			"từng kiểm gì.")
	}
	if strings.Contains(stdlibLog.String(), sentinel) {
		t.Errorf("stdlib log mang key nhà cung cấp. Logged:\n%s", stdlibLog.String())
	}
}
