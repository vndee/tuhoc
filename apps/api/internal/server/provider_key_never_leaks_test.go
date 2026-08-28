package server

import (
	"fmt"
	"io"
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
// ── VÌ SAO HAI NỬA, VÀ VÌ SAO KHÔNG NỬA NÀO ĐỦ MỘT MÌNH ────────────────────
//
// Nửa HÀNH VI (TestProviderKeySentinelAppearsInNoResponseOrLog) dựng app thật,
// đặt DEEPSEEK_API_KEY thành một chuỗi mốc dễ tìm, gọi những route THẬT, và
// đọc thân response cùng dòng log apilog THẬT phát ra. Đây là nửa chứng minh
// tính chất đúng với những gì máy chủ THỰC SỰ phát ra, không phải với những gì
// mã nguồn trông như sẽ phát ra.
//
// Nhưng nó chỉ thấy được những gì một request TRONG TỆP NÀY chạm tới. Đó
// không phải giả thuyết suông — cùng bài học csrf_samesite_test.go đã đo:
// trước tệp đó, auth_test.go chỉ khẳng định thuộc tính cookie trên response
// ĐĂNG KÝ, nên một mutant đổi SameSite của clearSessionCookie (một hàm khác,
// một route khác) khiến cả bộ vẫn xanh. Ở đây thì còn tệ hơn: Task 4/8 (chưa
// thi công lúc tệp này được viết) sẽ thêm cả một gói internal/ai mới với các
// route mới — không route nào trong số đó tồn tại để nửa hành vi này gọi tới.
// Một dòng `log.Printf("deepseek call: key=%s", cfg.DeepSeekAPIKey)` nằm
// trong internal/ai/client.go sẽ làm nửa hành vi này xanh VĨNH VIỄN, vì
// không request nào trong tệp này bao giờ chạm tới gói đó.
//
// Nửa CẤU TRÚC (TestProviderKeyNeverReachesLogOrResponse) đóng đúng lỗ đó:
// quét MỌI tệp .go sản phẩm dưới gốc repo — kể cả gói chưa tồn tại lúc viết
// dòng này — tìm hai hình dạng rò cụ thể, không phụ thuộc việc có route nào
// gọi tới nó trong test hay không. Quét thay vì tin vào review, vì chỗ rò dễ
// nhất không phải một dòng ai đó viết cố ý — nó là một `%v` trên cả struct
// cfg, thứ không trông giống lỗi bảo mật khi đọc diff.
//
// HAI HÌNH DẠNG RÒ NỬA CẤU TRÚC QUÉT:
//
//  1. Tên TRƯỜNG (DeepSeekAPIKey, BraveAPIKey) xuất hiện trên cùng dòng với
//     một lời gọi ghi ra ngoài (log/slog/fmt.Print*, hoặc response fiber
//     .JSON(/.SendString(). Quét theo TÊN BIẾN bền hơn quét theo tên header —
//     Brave dùng X-Subscription-Token chứ không phải Authorization, nên một
//     danh sách tên header sẽ phải nhớ CẢ HAI kiểu và vẫn có thể thiếu kiểu
//     thứ ba của nhà cung cấp tiếp theo; tên trường Go thì không đổi theo
//     nhà cung cấp.
//  2. Biến cấu hình `cfg` (đúng tên tham số config.Config dùng xuyên suốt
//     server.go — xem adminOrToken, New) xuất hiện NGUYÊN CỤM trên cùng dòng
//     với một lời gọi ghi ra ngoài. Đây là mutant chính brief nêu tên: in cả
//     struct config ra (`log.Printf("%v", cfg)`) rò TẤT CẢ các trường cùng
//     lúc, kể cả hai trường mới, mà không cần nhắc tên trường nào.
//
// Quét chỉ áp cho mã SẢN PHẨM (không phải *_test.go): các tệp test hợp pháp
// gán/so sánh cfg.DeepSeekAPIKey, cfg.BraveAPIKey liên tục (xem
// config_test.go), và bài kiểm hành vi ngay dưới đây tự nó cũng phải dựng cfg
// với key thật để có gì mà kiểm — quét cả test sẽ tự làm mình đỏ trên nền
// sạch, đúng bẫy "dây bẫy đỏ sẵn thì không ai tin" mà csrf_samesite_test.go
// đã né bằng cách không cấm chữ "Authorization" trần.

// providerKeyLeakFieldNeedles là tên hai trường mang key, hạ chữ thường vì
// nguồn được so khớp sau khi hạ chữ thường (xem providerKeyGoSources).
var providerKeyLeakFieldNeedles = []string{
	"deepseekapikey",
	"braveapikey",
}

// providerKeyLeakSinkNeedles là những cách mã Go thật sự GHI một giá trị ra
// ngoài tiến trình: log chuẩn, slog (thứ apilog viết qua), fmt.Print* (một số
// gói vẫn còn dùng để debug), và hai cách fiber trả response
// (.JSON(/.SendString(). Không có cách nào trong danh sách này là vô hại khi
// đứng cạnh tên một trường mang key hoặc biến `cfg` trên CÙNG một dòng.
var providerKeyLeakSinkNeedles = []string{
	"fmt.printf(",
	"fmt.println(",
	"fmt.sprintf(",
	"fmt.sprint(",
	"log.print",
	"log.fatal",
	"log.panic",
	"slog.",
	".json(",
	".sendstring(",
}

// providerKeyCfgWord so khớp biến `cfg` như một TỪ trọn vẹn — không khớp
// "corsCfg", "dbCfg", hay một trường có chữ "cfg" là hậu tố. Đo ngày
// 2026-08-28: mọi định danh `cfg` trong mã sản phẩm của apps/api ĐỀU là một
// config.Config (cmd/api/main.go, internal/server/server.go — `grep -rn
// '\bcfg\b' --include='*.go' . | grep -v _test.go` trả đúng những dòng đó),
// nên cụm từ này không phải một cái tên chung chung tình cờ trùng — nó LÀ
// tên biến project đặt cho config.Config ở khắp nơi.
var providerKeyCfgWord = regexp.MustCompile(`\bcfg\b`)

// minProductGoFilesForProviderKeyScan là chốt chống cổng mù: một đường dẫn
// sai (hoặc bộ lọc thư mục nuốt nhầm) làm phép quét đọc 0 tệp và báo đạt vĩnh
// viễn — đúng hình dạng bốn cổng mù ghi ở docs/carried-forward.md. Đo ngày
// 2026-08-28: `find . -name '*.go' -not -path '*/node_modules/*' -not -path
// './.git/*' -not -path '*/.claude/*' | grep -v _test.go | wc -l` → 26 tệp
// sản phẩm, tất cả dưới apps/api (repo chưa có module Go thứ hai). Ngưỡng đặt
// dưới hẳn con số đo được để một lần xoá gói hợp lệ không tự làm đỏ; chốt
// THẬT nằm ở danh sách sentinel bên dưới.
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
// Loại trừ *_test.go ngay ở bước đọc — không phải một tham số skipTests như
// no_key_transit_test.go từng dùng — vì KHÔNG phép quét nào trong tệp này
// từng cần nhìn vào mã test: cả hai hình dạng rò (tên trường, biến cfg) đều
// hợp pháp trong test (xem file-comment ở trên), nên không có lý do đọc
// chúng vào rồi lọc ra sau. Hệ quả phụ: tệp CHÍNH BÀI KIỂM NÀY không cần một
// bước tự loại trừ như hai gói kiểm trước — nó là *_test.go, nên không bao
// giờ được đọc vào map này ngay từ đầu.
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

	// Hai câu hỏi, và cả hai phải trả lời được — mỗi câu tương ứng một cách
	// phép quét có thể xanh mà chưa kiểm gì.
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

func providerKeyCfgMatch(line string) (string, bool) {
	if providerKeyCfgWord.MatchString(line) {
		return "cfg", true
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
	violatingField := map[string]string{
		"apps/api/internal/ai/client.go": strings.ToLower(`package ai
func debugLog(cfgKey string) {
	log.Printf("calling deepseek with key=%s", cfgKey /* DeepSeekAPIKey */)
}`),
	}
	// Dòng ở trên cố tình đặt tên trường ngay trong CHÚ THÍCH trên cùng dòng
	// với log.Printf — đúng hình dạng "một dòng ai đó thêm để debug rồi quên
	// xoá" mà phép quét này tồn tại để bắt, kể cả khi giá trị thật đi qua một
	// biến trung gian.
	if got := providerKeyScan(violatingField, providerKeyFieldMatch, providerKeyLeakSinkNeedles); len(got) == 0 {
		t.Error("phép quét tên trường không bắt được nguồn vi phạm tổng hợp — " +
			"bộ dò đã chết")
	}

	violatingCfgDump := map[string]string{
		"apps/api/internal/ai/client.go": strings.ToLower(`package ai
func debugLog(cfg config.Config) {
	log.Printf("loaded config: %v", cfg)
}`),
	}
	if got := providerKeyScan(violatingCfgDump, providerKeyCfgMatch, providerKeyLeakSinkNeedles); len(got) == 0 {
		t.Error("phép quét biến cfg không bắt được nguồn vi phạm tổng hợp — " +
			"bộ dò đã chết")
	}

	// Chiều ngược lại: nguồn vô hại không được khớp, ở cả hai phép quét.
	benign := map[string]string{
		"apps/api/internal/ai/client.go": strings.ToLower(`package ai
// DeepSeekAPIKey đi thẳng vào header Authorization gửi tới DeepSeek — đây
// KHÔNG phải một chỗ rò, vì đích đến là nhà cung cấp, không phải log hay
// response của TA.
func newRequest(cfg config.Config) *http.Request {
	req, _ := http.NewRequest("POST", cfg.DeepSeekBaseURL, nil)
	req.Header.Set("Authorization", "Bearer "+cfg.DeepSeekAPIKey)
	return req
}`),
	}
	if got := providerKeyScan(benign, providerKeyFieldMatch, providerKeyLeakSinkNeedles); len(got) != 0 {
		t.Errorf("phép quét tên trường báo vi phạm trên nguồn vô hại: %v", got)
	}
	if got := providerKeyScan(benign, providerKeyCfgMatch, providerKeyLeakSinkNeedles); len(got) != 0 {
		t.Errorf("phép quét biến cfg báo vi phạm trên nguồn vô hại: %v", got)
	}

	// Và phép quét thật phải chạm được vào repo thật.
	if n := len(providerKeyGoSources(t)); n < minProductGoFilesForProviderKeyScan {
		t.Errorf("providerKeyGoSources trả %d tệp", n)
	}
}

// TestProviderKeyNeverReachesLogOrResponse là NỬA CẤU TRÚC — xem chú thích
// đầu tệp cho lý do nó tồn tại bên cạnh nửa hành vi ngay dưới đây.
func TestProviderKeyNeverReachesLogOrResponse(t *testing.T) {
	sources := providerKeyGoSources(t)

	var offenders []string
	offenders = append(offenders, providerKeyScan(sources, providerKeyFieldMatch, providerKeyLeakSinkNeedles)...)
	offenders = append(offenders, providerKeyScan(sources, providerKeyCfgMatch, providerKeyLeakSinkNeedles)...)
	sort.Strings(offenders)

	for _, o := range offenders {
		t.Errorf("key nhà cung cấp có thể rời máy chủ ở đây: %s\n"+
			"Key nhà cung cấp (DeepSeekAPIKey, BraveAPIKey) chỉ được đi tới MỘT "+
			"nơi: một header trên request GỬI ĐI cho chính nhà cung cấp đó "+
			"(Authorization cho DeepSeek, X-Subscription-Token cho Brave). Nó "+
			"không bao giờ được đi vào log.*/slog.*/fmt.Print*, và không bao giờ "+
			"được đi vào một response JSON hay SendString của API này — kể cả "+
			"gián tiếp, qua việc in nguyên cả struct cfg. Xem spec §0.1, §3.2(3).", o)
	}
}

// ── NỬA HÀNH VI ──────────────────────────────────────────────────────────
//
// Dùng doTestRequest (observability_test.go) và captureSlog
// (observability_test.go) trực tiếp — cả hai đã tồn tại sẵn trong gói này để
// làm đúng việc cần ở đây (gửi request JSON/không-body và đọc thân response,
// chụp slog.Default() mà apilog viết qua), nên không có lý do viết lại.

// TestProviderKeySentinelAppearsInNoResponseOrLog là NỬA HÀNH VI.
//
// Dựng app THẬT với DEEPSEEK_API_KEY đặt thành một chuỗi mốc, gọi ba route
// thật — một route thành công không cần DB (`/healthz`), một route đọc DB
// thành công (`/courses`, danh sách rỗng), và một route trả lỗi nghiệp vụ
// (`/courses/khong-ton-tai`, 404 "không tìm thấy") — rồi khẳng định chuỗi mốc
// không xuất hiện trong BẤT KỲ thân response nào, và không xuất hiện trong
// bất kỳ dòng log apilog nào thu được suốt các lời gọi đó.
//
// Dùng store.TestPool(t) (Postgres thật qua testcontainers) thay vì Pool nil:
// một pool nil làm `/courses` panic (recover bắt được, nhưng đó là kiểm tra
// một điều khác — xem TestRecoveredPanicIsLoggedWithAStackTrace), còn ở đây
// ta muốn cả ba route trả lời NHƯ THẬT, để "route lỗi" nghĩa là một lỗi
// NGHIỆP VỤ (slug không tồn tại) chứ không phải một sự cố hạ tầng của chính
// bài test.
func TestProviderKeySentinelAppearsInNoResponseOrLog(t *testing.T) {
	const sentinel = "sk-SENTINEL-do-not-emit-7f3c1a"
	t.Setenv("DEEPSEEK_API_KEY", sentinel)

	cfg := config.Load()
	if cfg.DeepSeekAPIKey != sentinel {
		t.Fatalf("tự kiểm: config.Load() không đọc được sentinel vừa đặt — "+
			"got %q, muốn %q. Nếu điều này đỏ, phần còn lại của bài test không "+
			"kiểm gì cả.", cfg.DeepSeekAPIKey, sentinel)
	}

	pool := store.TestPool(t)
	logs := captureSlog(t)
	app := New(cfg, Deps{Pool: pool, LogOutput: io.Discard})

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

	if logged := logs.take(); strings.Contains(logged, sentinel) {
		t.Errorf("apilog mang key nhà cung cấp. Logged:\n%s", logged)
	}
}
