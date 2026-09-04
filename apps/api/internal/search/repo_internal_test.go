package search

import "testing"

// TestLikePatternEscapes canh likePattern ở ĐÚNG TẦNG CỦA NÓ.
//
// Không canh được qua HTTP: một mẫu không thoát vẫn cho kết quả đúng, vì
// chặng lọc thứ hai (usecase.go) dọn sạch mọi hit thừa mà mẫu ấy kéo về. Đo
// rồi mới biết — bài test HTTP viết ban đầu cho việc này vẫn xanh khi phép
// thoát bị gỡ bỏ hoàn toàn.
//
// Thứ hỏng khi không thoát là CHI PHÍ, không phải kết quả: truy vấn "%" kéo
// mọi chương trong hệ thống — tới trần maxCandidates, mỗi dòng hàng chục KB
// HTML — vào bộ nhớ của một request, để rồi bỏ đi gần hết. Một tính chất về
// chi phí thì phải đo ở tầng dựng ra chi phí ấy.
func TestLikePatternEscapes(t *testing.T) {
	cases := []struct {
		name, in, want string
	}{
		{"chữ thường", "entropy", `%entropy%`},
		{"dấu phần trăm", "90%", `%90\%%`},
		{"gạch dưới", "a_b", `%a\_b%`},
		{"dấu chéo ngược", `a\b`, `%a\\b%`},
		// Thứ tự thay thế: `\` phải đi TRƯỚC, nếu không nó thoát lại chính
		// những dấu `\` vừa thêm vào cho `%` và `_`.
		{"chéo ngược rồi phần trăm", `\%`, `%\\\%%`},
		{"cả ba", `\_%`, `%\\\_\%%`},
		{"tiếng Việt không đụng tới", "mã hoá", "%mã hoá%"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := likePattern(tc.in); got != tc.want {
				t.Errorf("likePattern(%q) = %q, muốn %q", tc.in, got, tc.want)
			}
		})
	}
}
