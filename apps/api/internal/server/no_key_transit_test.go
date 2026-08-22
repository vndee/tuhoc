package server

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// LỜI HỨA ĐANG ĐƯỢC CƯỠNG CHẾ Ở ĐÂY
//
// Spec §1.4: "Key không bao giờ chạm tới server của nền tảng — không đi qua,
// không nằm trong bộ nhớ tiến trình, không vào log, không vào database, không
// vào bản đồng bộ. Không có ngoại lệ, không có đường dự phòng."
// Spec §3.2(3): điều đó phải được CƯỠNG CHẾ chứ không chỉ ghi nhớ.
//
// Tệp này không có tính năng nào. Nó chỉ có dây bẫy. Nó XANH trên nền sạch —
// đó là hình dạng đúng — và chỉ đỏ khi ai đó mở lại đường ta đã đóng, kể cả
// với ý tốt, kể cả sáu tháng sau.
//
// VÌ SAO KHÔNG DÙNG app.GetRoutes() (spec §3.2 viết theo hướng đó)
//
// Fiber trả về method, path và TÊN handler. Bảng route không biết handler đọc
// trường nào từ body: một handler nhận {"api_key": "..."} trông y hệt một
// handler không nhận. Test dựa vào nó sẽ LUÔN xanh và không chặn gì — đúng họ
// với bốn cổng mù đã ghi ở docs/carried-forward.md, mà đặc điểm chung là "cổng
// đo thứ nó với tới được, và im lặng đúng chỗ nó không với tới".
//
// BA PHÉP QUÉT, VÀ VÌ SAO LÀ BA
//
// Có đúng hai đường để key đi qua server: client GỬI key lên, hoặc server GỌI
// nhà cung cấp. Phép quét 1 và 2 khoá đúng hai đường ấy bằng danh sách cấm —
// tên trường mang key, và tên host nhà cung cấp.
//
// Nhưng một danh sách cấm KHÔNG chứng minh được sự vắng mặt: một proxy đặt tên
// trường là "k" và đọc base URL từ biến môi trường thì không needle nào bắt
// được. Phép quét 3 vá đúng lỗ đó theo hướng không phụ thuộc tên nhà cung cấp:
// mã sản phẩm của API KHÔNG gọi ra ngoài, chấm hết. Một proxy bắt buộc phải gọi
// ra ngoài, nên nó không thể tồn tại mà phép quét 3 im lặng.
//
// Đo ngày 2026-08-22 trên nhánh này: `"net/http"` chỉ xuất hiện trong sáu tệp
// *_test.go, không tệp sản phẩm nào; không tệp Go nào nhắc tới một host nhà
// cung cấp; không thẻ struct nào mang tên trường trong danh sách cấm.

// Host của các nhà cung cấp ở §1.4 (đã dò CORS ngày 2026-08-20), cộng vài hàng
// xóm hiển nhiên. Danh sách này CỐ Ý không đầy đủ — nó không thể đầy đủ — nên
// nó là lớp phòng thủ thứ hai chứ không phải lớp duy nhất; lớp không phụ thuộc
// tên là TestAPIProductCodeMakesNoOutboundCall bên dưới.
var providerHosts = []string{
	"api.openai.com",
	"api.deepseek.com",
	"api.anthropic.com",
	"openrouter.ai",
	"api.groq.com",
	"generativelanguage.googleapis.com",
	"api.mistral.ai",
	"api.together.xyz",
	"api.x.ai",
}

// Tên trường mang key, ở dạng chúng xuất hiện trong thẻ struct JSON hoặc trong
// một lời gọi ĐỌC header. So khớp sau khi hạ chữ thường cả nguồn lẫn needle,
// nên `json:"API_Key"` và `c.Get("AUTHORIZATION")` cũng dính.
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

// Cách duy nhất để mã sản phẩm gọi ra ngoài. `"net/http"` có dấu nháy vì đó là
// dòng import; `fasthttp` xuất hiện trong CHÚ THÍCH ở server.go:83 nên phải
// khớp lời gọi chứ không khớp chữ trần, cùng lý do với "Authorization".
var outboundCallSites = []string{
	`"net/http"`,
	`fasthttp.client`,
	`fasthttp.hostclient`,
	`fasthttp.do(`,
	`resty.new(`,
}

// Số tệp .go tối thiểu phải quét được. Đo ngày 2026-08-22: repo có 25 tệp .go
// (17 tệp sản phẩm + 8 tệp test), TẤT CẢ nằm dưới apps/api/ — kiểm bằng
// `find . -name '*.go' -not -path '*/node_modules/*' -not -path './.git/*'`.
// Ngưỡng đặt ở 20 chứ không ở 25 để một lần xoá gói hợp lệ không làm đỏ dây
// bẫy; chốt THẬT nằm ở danh sách sentinel bên dưới, không ở con số này.
const minGoFilesScanned = 20

// Những tệp mà một vi phạm sẽ xuất hiện ở đó nếu nó xuất hiện ở đâu cả: điểm
// vào, nơi đăng ký route, và mọi handler đang bind body. Chốt theo tên tệp
// mạnh hơn chốt theo số đếm, cùng lý do đã ghi ở apps/web/src/db/local.test.ts
// cho danh sách năm bảng Dexie: một con số vẫn xanh khi người ta thêm một tệp
// và xoá một tệp khác.
var scanSentinels = []string{
	"apps/api/cmd/api/main.go",
	"apps/api/internal/server/server.go",
	"apps/api/internal/auth/handler.go",
	"apps/api/internal/course/handler.go",
	"apps/api/internal/sync/handler.go",
	"apps/api/internal/stats/handler.go",
}

// Thư mục không quét. `.claude` là mục BẮT BUỘC chứ không phải cho gọn: bản
// checkout chính giữ worktree của từng agent ở .claude/worktrees/agent-*/, mỗi
// cái là một bản sao đầy đủ của repo, nên thiếu dòng này thì phép quét đọc cả
// mã của các agent khác và báo lỗi bằng đường dẫn của họ.
var skippedDirs = map[string]bool{
	".git":         true,
	".claude":      true,
	"node_modules": true,
	"dist":         true,
	"build":        true,
	"vendor":       true,
}

// repoRoot đi ngược lên từ thư mục gói (go test đặt cwd ở đó) tới thư mục chứa
// go.work.
//
// VÌ SAO NEO Ở GỐC REPO CHỨ KHÔNG Ở apps/api: lời hứa nói về "máy chủ của
// chúng ta", không nói về module Go tên là tuhoc-api. Một dịch vụ Go mới ở
// apps/aiproxy/ CHÍNH LÀ đường dự phòng qua server mà chủ dự án đã cấm hai
// lần, và một phép quét neo ở apps/api sẽ im lặng tuyệt đối về nó. Hôm nay cả
// 25 tệp .go đều nằm dưới apps/api nên neo rộng hơn không đổi kết quả nào —
// nó chỉ đổi điều xảy ra vào cái ngày ai đó thêm module thứ hai.
//
// Không có đường lui khi thiếu go.work: một fallback im lặng về gốc module là
// đúng cái hình dạng đã sinh ra bốn cổng mù trước.
func repoRoot(t *testing.T) string {
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
	t.Fatalf("không tìm thấy go.work khi đi ngược lên từ %q — phép quét này "+
		"neo ở gốc repo và KHÔNG tự lui về gốc module, vì một đường lui im lặng "+
		"biến dây bẫy thành cổng mù. Chạy qua `make test-api` từ gốc repo.", dir)
	return ""
}

// goSources đọc mọi tệp .go của repo, khoá theo đường dẫn tương đối gốc repo
// (dấu gạch chéo xuôi), nội dung đã hạ chữ thường.
func goSources(t *testing.T) map[string]string {
	t.Helper()
	root := repoRoot(t)

	out := map[string]string{}
	self := 0
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if p != root && skippedDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		// Chính tệp này mang mọi chuỗi bị cấm trong danh sách trên. Bỏ qua nó,
		// nếu không nó tự làm mình đỏ.
		if info.Name() == "no_key_transit_test.go" {
			self++
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		out[rel] = strings.ToLower(string(b))
		return nil
	})
	if err != nil {
		t.Fatalf("không quét được nguồn Go dưới %s: %v", root, err)
	}

	// ── Chốt tự kiểm ─────────────────────────────────────────────────────
	// Ba câu hỏi, và cả ba phải trả lời được, vì mỗi câu tương ứng một cách
	// phép quét có thể xanh mà chưa kiểm gì.
	//
	// 1. Vòng quét có đọc được tệp nào không?
	if len(out) < minGoFilesScanned {
		t.Fatalf("chỉ quét được %d tệp Go dưới %s (tối thiểu %d) — đường dẫn "+
			"sai hoặc bộ lọc thư mục nuốt mất repo. Phép quét này ĐANG KHÔNG "+
			"KIỂM GÌ; đừng hạ ngưỡng, hãy sửa đường dẫn.",
			len(out), root, minGoFilesScanned)
	}
	// 2. Nó có đọc đúng những tệp mà vi phạm sẽ nằm ở đó không?
	var missing []string
	for _, s := range scanSentinels {
		if _, ok := out[s]; !ok {
			missing = append(missing, s)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("quét được %d tệp nhưng THIẾU %d tệp neo: %s. Nếu một tệp neo "+
			"thật sự đã bị xoá hoặc đổi tên thì sửa scanSentinels MỘT CÁCH CÓ Ý "+
			"THỨC; nếu không, phép quét đang bỏ sót đúng chỗ nó cần nhìn.",
			len(out), len(missing), strings.Join(missing, ", "))
	}
	// 3. Phép loại trừ có loại đúng một tệp — chính tệp này — không? Đổi tên
	//    tệp này mà quên sửa chuỗi ở trên sẽ cho self == 0 và mọi test dưới đây
	//    đỏ vì tệp tự khớp danh sách cấm của mình; chốt này nói thẳng lý do.
	if self != 1 {
		t.Fatalf("phép tự loại trừ khớp %d tệp, phải khớp đúng 1 (chính tệp "+
			"này). 0 = tệp đã đổi tên; >1 = có bản sao của dây bẫy.", self)
	}
	// In ra con số để `go test -v` nói được phép quét ĐÃ đọc bao nhiêu tệp, thay
	// vì để người đọc báo cáo phải tin lời. Rẻ, và nó là thứ duy nhất phân biệt
	// "xanh vì sạch" với "xanh vì không đọc gì".
	t.Logf("phép quét đọc %d tệp .go dưới %s (bỏ qua 1 tệp: chính dây bẫy này)",
		len(out), root)
	return out
}

// scan trả về các cặp "đường dẫn: chuỗi cấm" đã sắp xếp. Tách khỏi hai test
// dưới để chính nó kiểm được bằng nguồn tổng hợp — xem
// TestSourceScanIsNotVacuous.
func scan(sources map[string]string, needles []string, skipTests bool) []string {
	var hits []string
	for path, src := range sources {
		if skipTests && strings.HasSuffix(path, "_test.go") {
			continue
		}
		for _, n := range needles {
			if strings.Contains(src, strings.ToLower(n)) {
				hits = append(hits, path+": "+n)
			}
		}
	}
	sort.Strings(hits)
	return hits
}

// TestSourceScanIsNotVacuous là dây bẫy cho chính dây bẫy.
//
// Ba test dưới đây đều khẳng định "không tìm thấy gì". Một phép so khớp hỏng —
// needle rỗng, hạ chữ thường một bên, một lần "dọn dẹp" biến Contains thành
// Equal — cho ra đúng cùng một kết quả xanh. Test này bơm nguồn tổng hợp qua
// CÙNG hàm scan() và đòi nó ĐỎ, nên bộ dò được chứng minh còn sống ở mọi lần
// chạy chứ không chỉ ở buổi làm việc đã gài mutant tay.
func TestSourceScanIsNotVacuous(t *testing.T) {
	synthetic := map[string]string{
		"apps/aiproxy/main.go": strings.ToLower(`package main
import "net/http"
type req struct { Key string ` + "`" + `json:"api_key"` + "`" + ` }
func h(c *fiber.Ctx) { _ = c.Get("Authorization") }
const base = "https://api.deepseek.com/v1"`),
	}

	for _, tc := range []struct {
		name    string
		needles []string
	}{
		{"host nhà cung cấp", providerHosts},
		{"trường mang key", keyBearingFields},
		{"lời gọi ra ngoài", outboundCallSites},
	} {
		if got := scan(synthetic, tc.needles, false); len(got) == 0 {
			t.Errorf("scan(%s) không bắt được nguồn vi phạm tổng hợp — bộ dò đã "+
				"chết, và ba test dưới đây đang xanh một cách vô nghĩa", tc.name)
		}
	}

	// Chiều ngược lại: nguồn vô hại phải KHÔNG khớp, nếu không mọi thứ đều đỏ
	// và dây bẫy cũng vô dụng theo cách còn lại.
	benign := map[string]string{
		"apps/api/internal/course/handler.go": strings.ToLower(`package course
// Ghi chú vô hại nhắc tới fasthttp và header Authorization.
type req struct { Title string ` + "`" + `json:"title"` + "`" + ` }`),
	}
	for _, tc := range []struct {
		name    string
		needles []string
	}{
		{"host nhà cung cấp", providerHosts},
		{"trường mang key", keyBearingFields},
		{"lời gọi ra ngoài", outboundCallSites},
	} {
		if got := scan(benign, tc.needles, false); len(got) != 0 {
			t.Errorf("scan(%s) báo vi phạm trên nguồn vô hại: %v", tc.name, got)
		}
	}

	// Và phép quét thật phải chạm được vào repo thật.
	if n := len(goSources(t)); n < minGoFilesScanned {
		t.Errorf("goSources trả %d tệp", n)
	}
}

// Đường thứ nhất: server GỌI nhà cung cấp.
func TestServerNeverCallsAIProvider(t *testing.T) {
	for _, hit := range scan(goSources(t), providerHosts, false) {
		t.Errorf("%s — máy chủ KHÔNG được gọi nhà cung cấp AI. Key phải đi thẳng "+
			"từ trình duyệt người dùng tới nhà cung cấp, qua origin kho khoá "+
			"(apps/vault). Xem spec §1.4 và §3.2(3).", hit)
	}
}

// Đường thứ hai: client GỬI key lên.
//
// KHÔNG loại trừ gói nào, kể cả internal/auth — và đây là chỗ kế hoạch bị sửa.
//
// Kế hoạch bỏ qua internal/auth với lý do "nó được phép đọc cookie phiên của
// chính ta". Tiền đề đúng, nhưng KHÔNG LIÊN QUAN tới thứ đang cấm: đọc cookie
// phiên là c.Cookies(CookieName) (handler.go:126, 226), và trong danh sách cấm
// không có needle nào chạm tới cookie. Đo ngày 2026-08-22: không tệp nào của
// apps/api khớp bất kỳ needle nào ở keyBearingFields — nghĩa là phép loại trừ
// ấy mua được số không.
//
// Cái nó BÁN đi thì có thật: internal/auth là gói duy nhất trong repo đã có sẵn
// nghiệp vụ chứng thực, nên nó cũng là chỗ có xác suất cao nhất mọc ra một
// đường đọc token từ header — và phép loại trừ sẽ nuốt đúng cái đó trong im
// lặng. Cùng khuôn với S1-F43: một phần loại trừ viết bằng chữ, tiền đề đúng,
// không liên quan, và mở ra một lỗ.
//
// `json:"password"` (handler.go:43, 49) KHÔNG nằm trong danh sách cấm và không
// nên nằm: đó là bí mật của CHÍNH ta trên đường đăng nhập, không phải key nhà
// cung cấp. Ranh giới ở đây là "key của bên thứ ba", không phải "chuỗi nhạy cảm".
func TestNoRequestStructAcceptsAKey(t *testing.T) {
	for _, hit := range scan(goSources(t), keyBearingFields, false) {
		t.Errorf("%s — không route nào được nhận key của người dùng, kể cả "+
			"\"chỉ đi ngang không lưu\" (spec §7). Không có đường dự phòng qua "+
			"server: nhà cung cấp không cho gọi từ trình duyệt thì không được "+
			"hỗ trợ. Nếu chuỗi này KHÔNG dính tới key của bên thứ ba (ví dụ một "+
			"header của chính ta), sửa keyBearingFields ngay tại đây kèm lý do — "+
			"đừng loại trừ cả gói, vì một phép loại trừ theo tên gói chính là thứ "+
			"kế hoạch gốc đã đề xuất và bị bác ở đúng dòng chú thích trên.", hit)
	}
}

// ── DANH SÁCH CHO PHÉP CỦA PHÉP QUÉT LỜI GỌI RA NGOÀI ───────────────────
//
// Ngày ghi trong chú thích của TestAPIProductCodeMakesNoOutboundCall đã tới:
// hệ thống con 4 nhúng đọc GitHub Discussions (spec §5), nên **một** tệp sản
// phẩm phải gọi ra ngoài. Cách xử lý mà chú thích ấy chỉ định — và đã được
// làm ở đây — là thêm một danh sách cho phép HẸP, không phải xoá phép quét.
//
// HẸP tới mức nào, nói bằng thứ đo được:
//
//   - Khoá là ĐƯỜNG DẪN TUYỆT ĐỐI TÍNH TỪ GỐC REPO, khớp CHÍNH XÁC. Không
//     tiền tố thư mục, không glob, không "mọi thứ dưới internal/discuss/".
//     Một tệp proxy mới — apps/api/internal/aiproxy/client.go,
//     apps/aiproxy/main.go, hay ngay cả internal/discuss/proxy.go — KHÔNG
//     nằm trong bản đồ này nên vẫn ĐỎ. Đó là tính chất phải giữ, và
//     TestOutboundAllowlistStaysNarrow đo nó bằng nguồn tổng hợp ở mỗi lần
//     chạy chứ không bằng lời hứa trong chú thích này.
//   - Giá trị là danh sách needle CỤ THỂ được tha, không phải "tha tất".
//     `internal/discuss/client.go` được phép import `"net/http"` và không
//     được phép dùng `resty.new(` hay một fasthttp client — nếu nó mọc thêm,
//     phép quét đỏ đúng vào tệp đã-được-cho-phép.
//   - Mỗi mục còn phải TỰ KHAI ĐÍCH ĐẾN trong nguồn (allowlistDestinations).
//     Đây là phần trả lời thẳng vào mutant mà chính chú thích của phép quét
//     nêu tên: "một proxy đặt tên trường là k và đọc base URL từ biến môi
//     trường". Một tệp được cho phép mà KHÔNG viết host của nó ra thành hằng
//     trong mã thì không ai grep được nó gọi đi đâu, nên nó mất quyền được
//     cho phép và phép quét đỏ.
//
// VÌ SAO ĐÍCH ĐẾN NÀY KHÔNG PHẢI MỘT NHÀ CUNG CẤP AI: api.github.com phục vụ
// các luồng thảo luận CÔNG KHAI của repo registry. Thông tin xác thực dùng ở
// đó là token của MÁY CHỦ với GitHub (config.Config.GitHubToken), không phải
// key của người dùng với nhà cung cấp AI, và không request nào từ trình duyệt
// cung cấp, thay thế hay đọc được nó. Lời hứa ở spec §3.2 KHÔNG bị nới: hai
// phép quét kia — host nhà cung cấp và trường mang key — vẫn áp cho tệp này
// y như mọi tệp khác, KHÔNG có ngoại lệ nào, nên đường "client gửi key lên"
// và đường "server gọi nhà cung cấp AI" vẫn khoá kín như trước.
var outboundAllowlist = map[string][]string{
	"apps/api/internal/discuss/client.go": {`"net/http"`},
}

// allowlistDestinations: mọi tệp trong outboundAllowlist phải chứa ít nhất
// một trong các chuỗi này. Đây là "đích đến phải grep được" thành ràng buộc.
var allowlistDestinations = []string{"api.github.com"}

// scanOutbound là scan() cho lời gọi ra ngoài, đã trừ danh sách cho phép.
// Tách ra để chính nó chạy được trên nguồn tổng hợp — xem
// TestOutboundAllowlistStaysNarrow.
func scanOutbound(sources map[string]string) []string {
	var hits []string
	for _, hit := range scan(sources, outboundCallSites, true) {
		path, needle, _ := strings.Cut(hit, ": ")
		allowed := false
		for _, n := range outboundAllowlist[path] {
			if strings.EqualFold(n, needle) {
				allowed = true
				break
			}
		}
		if !allowed {
			hits = append(hits, hit)
		}
	}
	sort.Strings(hits)
	return hits
}

// Lớp không phụ thuộc tên nhà cung cấp.
//
// Chỉ áp cho mã SẢN PHẨM: các tệp *_test.go dùng net/http và httptest một cách
// chính đáng (sáu tệp, đo ngày 2026-08-22) và chúng không chạy trong sản xuất.
//
// KHI NÀO ĐƯỢC NỚI: hệ thống con 3 sẽ cần server đọc index.json của registry
// (spec §4.1) và có thể cần token GitHub cho Discussions (§5). Đó là lời gọi ra
// ngoài KHÔNG phải tới nhà cung cấp AI, và khi ngày ấy tới, cách đúng là thêm
// một danh sách cho phép hẹp ngay tại đây kèm chú thích nói rõ vì sao đích đến
// không phải một nhà cung cấp AI — chứ không phải xoá test này. Bắt người ta
// dừng lại một nhịp chính là toàn bộ giá trị của nó.
//
// Ngày ấy đã tới ở hệ thống con 4 (Discussions). Xem outboundAllowlist ngay
// trên đây: một mục, một tệp, một needle. Ba chốt dưới đây giữ cho nó không
// nở ra trong im lặng.
func TestAPIProductCodeMakesNoOutboundCall(t *testing.T) {
	sources := goSources(t)

	for _, hit := range scanOutbound(sources) {
		t.Errorf("%s — mã sản phẩm của API không gọi ra ngoài. Một proxy AI bắt "+
			"buộc phải gọi ra ngoài, nên chốt này bắt được cả proxy đặt tên trường "+
			"là \"k\" và lấy base URL từ biến môi trường — thứ mà danh sách host "+
			"không bao giờ bắt được. Nếu lời gọi này thật sự KHÔNG tới nhà cung "+
			"cấp AI, thêm nó vào danh sách cho phép ngay trên hàm này, kèm lý do "+
			"— và đọc chú thích của outboundAllowlist trước: khoá là đường dẫn "+
			"khớp CHÍNH XÁC, giá trị là needle cụ thể, và tệp phải tự khai đích "+
			"đến ra thành hằng trong mã.", hit)
	}

	// Chốt 1 — mục ÔI THIU. Một mục trỏ tới tệp không còn tồn tại là một lỗ
	// đang chờ: ai đó đổi tên tệp, mục ở lại, rồi một ngày có tệp mới trùng
	// tên và nó được tha miễn phí. Bắt phải xoá mục MỘT CÁCH CÓ Ý THỨC, cùng
	// lập luận với scanSentinels.
	for path := range outboundAllowlist {
		if _, ok := sources[path]; !ok {
			t.Errorf("outboundAllowlist có mục cho %q nhưng phép quét không thấy "+
				"tệp ấy. Nếu tệp đã bị xoá hoặc đổi tên, XOÁ mục này — đừng để "+
				"lại, vì nó sẽ tha miễn phí cho tệp tiếp theo trùng tên.", path)
		}
	}

	// Chốt 2 — ĐÍCH ĐẾN phải grep được. Đây là câu trả lời trực tiếp cho
	// mutant "đọc base URL từ biến môi trường": một tệp được cho phép gọi ra
	// ngoài mà không viết host của nó ra thành hằng thì không phép quét nguồn
	// nào biết nó gọi đi đâu, nên nó không được cho phép nữa.
	for path := range outboundAllowlist {
		src, ok := sources[path]
		if !ok {
			continue // đã báo ở chốt 1
		}
		named := false
		for _, d := range allowlistDestinations {
			if strings.Contains(src, strings.ToLower(d)) {
				named = true
				break
			}
		}
		if !named {
			t.Errorf("%s được cho phép gọi ra ngoài nhưng KHÔNG nhắc tới đích đến "+
				"nào trong %v. Một tệp lấy base URL từ biến môi trường trông y "+
				"hệt thế này, và đó đúng là mutant mà phép quét này tồn tại để "+
				"bắt. Viết host ra thành hằng trong mã, hoặc bỏ mục cho phép.",
				path, allowlistDestinations)
		}
	}
}

// TestOutboundAllowlistStaysNarrow chứng minh — bằng nguồn tổng hợp, ở MỌI
// lần chạy — rằng danh sách cho phép không nuốt mất thứ phép quét tồn tại để
// bắt.
//
// Không có bài này, "hẹp" chỉ là một tính từ trong chú thích. Một lần sửa
// tưởng như vô hại (đổi so khớp đường dẫn thành HasPrefix, hoặc để giá trị
// rỗng nghĩa là "tha tất") sẽ giữ nguyên màu xanh của
// TestAPIProductCodeMakesNoOutboundCall trên cây mã sạch hôm nay, và lặng lẽ
// mở cửa cho đúng cái proxy mà hệ thống con 2 đã cấm hai lần.
func TestOutboundAllowlistStaysNarrow(t *testing.T) {
	const proxy = `package main
import "net/http"
type c struct{ k string }
const base = "" // base URL lấy từ biến môi trường, không có host nào trong nguồn
`
	// Một tệp được cho phép, viết đúng như tệp thật: có needle được tha VÀ
	// tự khai đích đến.
	const allowed = `package discuss
import "net/http"
const APIURL = "https://api.github.com/graphql"
`

	cases := []struct {
		name     string
		path     string
		src      string
		wantHits bool
	}{
		{
			name:     "chính tệp được cho phép thì im lặng",
			path:     "apps/api/internal/discuss/client.go",
			src:      allowed,
			wantHits: false,
		},
		{
			// Tình huống trong chú thích của chính phép quét: một proxy AI
			// đặt tên trường là "k" và lấy base URL từ biến môi trường.
			name:     "proxy ở gói MỚI vẫn đỏ",
			path:     "apps/api/internal/aiproxy/client.go",
			src:      proxy,
			wantHits: true,
		},
		{
			// Cạnh nguy hiểm nhất: CÙNG thư mục với tệp được cho phép. Một
			// phép so khớp theo tiền tố thư mục sẽ tha cả cái này.
			name:     "proxy CÙNG thư mục với tệp được cho phép vẫn đỏ",
			path:     "apps/api/internal/discuss/proxy.go",
			src:      proxy,
			wantHits: true,
		},
		{
			// Module Go thứ hai — đúng đường dự phòng qua server mà chủ dự án
			// đã cấm hai lần, và lý do goSources neo ở gốc repo.
			name:     "module thứ hai ở apps/aiproxy vẫn đỏ",
			path:     "apps/aiproxy/main.go",
			src:      proxy,
			wantHits: true,
		},
		{
			// Đường dẫn khác hoa/thường hoặc lệch một ký tự KHÔNG được coi là
			// khớp: khớp chính xác nghĩa là chính xác.
			name:     "đường dẫn gần giống nhưng không khớp vẫn đỏ",
			path:     "apps/api/internal/discuss/client2.go",
			src:      allowed,
			wantHits: true,
		},
		{
			// Tệp được cho phép, nhưng mọc thêm một cách gọi ra ngoài KHÔNG
			// nằm trong danh sách needle được tha.
			name:     "needle ngoài danh sách, ngay trong tệp được cho phép, vẫn đỏ",
			path:     "apps/api/internal/discuss/client.go",
			src:      allowed + "\nvar cl = resty.New()\n",
			wantHits: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := scanOutbound(map[string]string{tc.path: strings.ToLower(tc.src)})
			if tc.wantHits && len(got) == 0 {
				t.Errorf("%s: danh sách cho phép đã nở ra — nguồn này PHẢI bị bắt "+
					"nhưng scanOutbound im lặng. Đây là lỗ mà phép quét lời gọi ra "+
					"ngoài tồn tại để bịt.", tc.path)
			}
			if !tc.wantHits && len(got) != 0 {
				t.Errorf("%s: bị bắt nhầm: %v — một dây bẫy đỏ sẵn thì không ai tin.",
					tc.path, got)
			}
		})
	}

	// Chiều còn lại của "hẹp": danh sách cho phép phải NHỎ. Nó không phải
	// một con số thẩm mỹ — mỗi mục là một tệp sản phẩm được quyền gọi ra
	// ngoài, và toàn bộ giá trị của phép quét nằm ở chỗ danh sách ấy đếm
	// được bằng mắt. Nếu một ngày cần mục thứ ba, hãy nâng con số này CÙNG
	// với một chú thích nói vì sao, chứ đừng để nó trôi.
	const maxAllowlistEntries = 2
	if len(outboundAllowlist) > maxAllowlistEntries {
		t.Errorf("outboundAllowlist có %d mục (trần %d). Mỗi mục là một tệp sản "+
			"phẩm được phép gọi ra ngoài; một danh sách dài là một danh sách "+
			"không ai đọc nữa.", len(outboundAllowlist), maxAllowlistEntries)
	}
}
