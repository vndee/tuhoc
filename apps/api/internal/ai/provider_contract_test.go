package ai

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Bốn câu hỏi mà tài liệu DeepSeek không trả lời, và Task 0 đã đo trên API
// thật (hai lượt độc lập: điều phối viên Pha 2 đo thô trước, Task 0 đo lại
// từng mục một lần nữa và xác nhận khớp — xem
// .superpowers/sdd/2026-08-28-pha2-ai-may-chu/task-0-report.md). Mã của gói
// này được viết QUANH bốn câu trả lời ấy — xem chú thích trên Usage ở
// types.go. Nếu tệp đo biến mất hoặc bị rút gọn, người sửa mã sau này không
// còn cách nào biết vì sao vòng lặp agent lại có hình dạng hiện tại, ngoài
// việc đoán.
//
// Test không gọi mạng: một cổng phụ thuộc mạng thì đỏ vì Wi-Fi, và một cổng
// đỏ vì Wi-Fi là một cổng bị tắt. Test này chỉ đọc một tệp .md tĩnh đã có
// sẵn trong repo.

// minMeasuredDocBytes chặn dạng hỏng "tệp còn tồn tại nhưng bị rút gọn xuống
// gần rỗng" — một os.ReadFile thành công trên một tệp 3 byte vẫn qua được
// mọi strings.Contains phía dưới NẾU ai đó vô tình để lại đúng bốn cụm từ
// khoá đó trong một dòng chú thích ngắn rồi xoá sạch phần còn lại. Ngưỡng
// đặt dưới hẳn kích thước tệp thật (đo 2026-08-28: hơn 7KB) để một lần sửa
// nội dung hợp lệ không tự làm đỏ.
const minMeasuredDocBytes = 2000

// deepseekMeasuredDocPath tìm docs/deepseek-measured.md bằng cách đi ngược
// từ thư mục gói (go test đặt cwd ở đó) tới thư mục chứa go.work — cùng kỹ
// thuật neo-ở-gốc-repo mà
// apps/api/internal/server/provider_key_never_leaks_test.go dùng
// (providerKeyRepoRoot), vì cùng lý do: "docs/deepseek-measured.md" nói về
// TOÀN REPO, không phải riêng module Go apps/api, và một đường dẫn tương đối
// đếm-số-cấp-thư-mục (kiểu "../../../../docs/...") vỡ ngay khi ai đó di
// chuyển gói này hoặc đổi độ sâu thư mục — không có gì báo lỗi cho tới khi
// os.ReadFile lặng lẽ trả lỗi "no such file" ở một đường dẫn sai, và (nếu
// assertion phía dưới bị viết lơi tay) một tệp thiếu bị hiểu nhầm là "không
// có gì phải kiểm" thay vì "phép đo Task 0 không còn ở đó".
func deepseekMeasuredDocPath(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("không lấy được thư mục làm việc: %v", err)
	}
	for range 12 {
		if _, err := os.Stat(filepath.Join(dir, "go.work")); err == nil {
			return filepath.Join(dir, "docs", "deepseek-measured.md")
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Fatalf("không tìm thấy go.work khi đi ngược lên từ thư mục làm việc hiện " +
		"tại — không neo được gốc repo để tìm docs/deepseek-measured.md. Chạy " +
		"qua `go test ./internal/ai/...` từ trong apps/api (hoặc `make " +
		"test-api` từ gốc repo), không chạy tệp test này tách rời khỏi cây " +
		"module.")
	return ""
}

// TestMeasuredProviderFactsAreRecorded khẳng định docs/deepseek-measured.md
// còn ở đó VÀ còn ghi đủ bốn mục đo — không phải bị xoá, không phải bị rút
// gọn thành một khung sườn trống. Test FAIL-CLOSED ở từng bước: thiếu tệp,
// tệp quá nhỏ, hoặc thiếu một cụm từ khoá đều làm test đỏ, không có nhánh
// nào lặng lẽ bỏ qua rồi báo xanh.
func TestMeasuredProviderFactsAreRecorded(t *testing.T) {
	path := deepseekMeasuredDocPath(t)

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%s: %v — Task 0 tạo tệp này để Task 4b/6/7/9 đọc bốn con số "+
			"đo được thay vì đoán lại; nếu tệp bị xoá, phục hồi từ lịch sử git "+
			"hoặc chạy lại phép đo Task 0.", path, err)
	}
	if len(b) < minMeasuredDocBytes {
		t.Fatalf("%s chỉ có %d byte (tối thiểu %d) — tệp có mặt nhưng có vẻ đã "+
			"bị rút gọn mất nội dung đo thật. Đừng hạ ngưỡng này; phục hồi nội "+
			"dung.", path, len(b), minMeasuredDocBytes)
	}
	doc := string(b)

	// Bốn cụm từ khoá dưới đây là TÊN THẬT đo được ở Task 0 (Step 1-4 của
	// task-0-brief.md), không phải chuỗi giữ chỗ của brief gốc — brief dùng
	// đúng "prompt_cache_hit_tokens" làm ví dụ tình cờ trùng với tên thật đo
	// được, nên không cần sửa mục đó; ba mục còn lại được viết lại thành cụm
	// mô tả (không phải tên trường JSON) vì "tool_choice" một mình chỉ xác
	// nhận tài liệu CÓ NHẮC tới khái niệm này, còn nội dung đúng/sai của kết
	// luận (chỉ "auto"/"none" chạy được) được kiểm bởi chính lượt đo Task 0
	// ghi trong task-0-report.md, một test cấu trúc không gọi mạng không thể
	// tự phúc tra một sự kiện API bên ngoài.
	for _, need := range []string{
		"prompt_cache_hit_tokens", // §1: tên trường cache thật trong `usage`
		"tool_choice",             // §2: bốn giá trị tool_choice đã thử, chỉ hai chạy được
		"song song",               // §3: tool_calls có thể trả về nhiều phần tử trong một lượt
		"streaming",               // §4: usage có mặt ở chunk cuối của response stream
	} {
		if !strings.Contains(doc, need) {
			t.Errorf("docs/deepseek-measured.md thiếu mục đo %q — xem Task 0 của "+
				"plan Pha 2 (.superpowers/sdd/2026-08-28-pha2-ai-may-chu/"+
				"task-0-brief.md). Nếu mục này bị xoá hoặc đổi tên có chủ ý, sửa "+
				"needle này trong provider_contract_test.go kèm lý do — đừng xoá "+
				"cả bài kiểm.", need)
		}
	}
}
