package rating_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/vndee/tuhoc-api/internal/rating"
)

// Hợp đồng liên ngôn ngữ: mọi `id` mà registry thật sự sinh ra PHẢI đi lọt
// `rating.RegistryID()`.
//
// Vì sao cần: `registry_id` ở phía Go và `RegistryEntry.id` ở phía registry
// (TypeScript, `tools/registry`) là CÙNG MỘT chuỗi, nhưng hai bên kiểm nó bằng
// hai đoạn mã khác nhau. Người dựng tầng rating cố ý KHÔNG chép luật sang bản
// thứ hai — đúng bài học "một bộ luật, ba bản, bất đồng 7/12 hàng" — nhưng hệ
// quả là mối ghép chỉ còn được giữ bằng CHÚ THÍCH, và ba thay đổi sẽ trôi qua
// trong im lặng:
//
//   1. registry siết luật id chặt hơn  → Go vẫn nhận, không ai biết;
//   2. registry cho phép id lồng thư mục → Go TỪ CHỐI một id hợp lệ, và triệu
//      chứng người dùng thấy chỉ là "chấm sao không hoạt động";
//   3. chưa từng có id registry THẬT nào đi qua validator này — repo registry
//      công khai còn chưa tồn tại (`docs/deploy.md` §5c).
//
// Bài kiểm này đọc chính những `manifest.json` mà `tools/registry` đọc, nên nó
// đo id THẬT chứ không đo một bản chép tay. Nó không thay được một cổng chạy
// trên registry thật, nhưng nó biến (2) từ im lặng thành ồn ào.
func TestEveryRealFixtureIDPassesRegistryID(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..", "fixtures", "courses")
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("không đọc được %s: %v", root, err)
	}

	checked := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(root, e.Name(), "manifest.json"))
		if err != nil {
			continue // không phải thư mục gói
		}
		var m struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Errorf("%s: manifest không phải JSON hợp lệ: %v", e.Name(), err)
			continue
		}
		got, err := rating.RegistryID(m.ID)
		if err != nil {
			t.Errorf("id THẬT %q bị rating.RegistryID() từ chối: %v — "+
				"registry và Go đang bất đồng về id nào là hợp lệ", m.ID, err)
		}
		if got != m.ID {
			t.Errorf("rating.RegistryID(%q) = %q — không được biến đổi id", m.ID, got)
		}
		checked++
	}

	// Chốt chống cổng mù: đường dẫn sai thì vòng lặp duyệt 0 gói và bài kiểm
	// xanh mà chưa kiểm gì. Dự án đã dính NĂM cổng cùng hình dạng ấy.
	if checked < 2 {
		t.Fatalf("chỉ kiểm được %d gói ở %s — đường dẫn sai, bài kiểm này đang không đo gì", checked, root)
	}
}
