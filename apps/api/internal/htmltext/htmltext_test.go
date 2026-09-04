package htmltext_test

import (
	"strings"
	"testing"

	"github.com/vndee/tuhoc-api/internal/htmltext"
)

// TestStripKeepsInlineTextTogether canh cái ranh giới khiến bảng
// stripHTMLBlockTags cố tình BỎ các thẻ inline: một từ bị <b> cắt đôi phải
// liền lại thành một từ, còn hai đoạn văn thì không được dính vào nhau.
//
// Cả hai đều là điều kiện sống của một đoạn trích tìm kiếm. Ghép sai kiểu
// thứ nhất thì "entropy" không bao giờ khớp; ghép sai kiểu thứ hai thì đoạn
// trích nối hai câu chẳng liên quan thành một câu vô nghĩa.
func TestStripKeepsInlineTextTogether(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"thẻ inline không chèn ranh giới", "<p>en<b>tropy</b></p>", "entropy"},
		{"khoảng trắng gốc giữ nguyên", "<p>Xin <b>chào</b></p>", "Xin chào"},
		// Hai ranh giới khối liền nhau (</p> rồi <p>) thành MỘT dòng trống,
		// không phải hai — normalizeStrippedText gộp lại. Đoạn trích tìm
		// kiếm vì thế có thể mang một dòng trống ở giữa, và đó là hình dạng
		// đúng, không phải rác cần dọn.
		{"hai đoạn cách nhau một dòng trống", "<p>Xin chào</p><p>tạm biệt</p>", "Xin chào\n\ntạm biệt"},
		{"br là ranh giới", "một<br>hai", "một\nhai"},
		{"mục danh sách tách dòng", "<ul><li>một</li><li>hai</li></ul>", "một\n\nhai"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := htmltext.Strip(tc.in); got != tc.want {
				t.Errorf("Strip(%q) = %q, muốn %q", tc.in, got, tc.want)
			}
		})
	}
}

// TestStripRemovesRawTextBodies đo RIÊNG TỪNG THẺ trong bảng mười thẻ, không
// suy ra từ một thẻ đại diện — cùng kỷ luật mà bài test ở internal/ai đặt ra
// khi bảng này còn nằm ở đó.
//
// Với tìm kiếm, tính chất này không phải chuyện gọn gàng: thân <script> lọt
// ra ngoài nghĩa là một truy vấn khớp tên biến JavaScript và trả về một
// chương chẳng nói gì về thứ người dùng tìm.
func TestStripRemovesRawTextBodies(t *testing.T) {
	// "plaintext" không có thẻ đóng theo đặc tả HTML5 — nó ăn tới hết tài
	// liệu — nên nó được đo bằng một ca riêng bên dưới, không nằm ở đây.
	tags := []string{"script", "style", "iframe", "noembed", "noframes",
		"noscript", "textarea", "title", "xmp"}
	for _, tag := range tags {
		t.Run(tag, func(t *testing.T) {
			in := "<p>giữ lại</p><" + tag + ">BÍ MẬT</" + tag + "><p>giữ nốt</p>"
			got := htmltext.Strip(in)
			if strings.Contains(got, "BÍ MẬT") {
				t.Errorf("thân <%s> lọt ra: %q", tag, got)
			}
			if !strings.Contains(got, "giữ lại") || !strings.Contains(got, "giữ nốt") {
				t.Errorf("<%s> nuốt cả chữ ngoài thân nó: %q", tag, got)
			}
		})
	}

	t.Run("plaintext ăn tới hết tài liệu", func(t *testing.T) {
		got := htmltext.Strip("<p>giữ lại</p><plaintext>BÍ MẬT<p>và cả cái này</p>")
		if strings.Contains(got, "BÍ MẬT") || strings.Contains(got, "và cả cái này") {
			t.Errorf("plaintext phải nuốt tới EOF, còn lại: %q", got)
		}
		if !strings.Contains(got, "giữ lại") {
			t.Errorf("chữ TRƯỚC plaintext bị mất: %q", got)
		}
	})
}

// TestStripLeavesNoAngleBracket là bất biến mà gói cũ tự đặt ra cho mình:
// đầu ra không còn dấu "<" nào, kể cả khi thân một thẻ raw-text chứa thứ
// trông y hệt markup thật.
func TestStripLeavesNoAngleBracket(t *testing.T) {
	in := `<div class="a"><script>if (a < b) { x("<p>giả</p>") }</script><p>thật</p></div>`
	if got := htmltext.Strip(in); strings.ContainsAny(got, "<>") {
		t.Errorf("còn dấu ngoặc nhọn trong đầu ra: %q", got)
	}
}

// TestStripDoesNotLeakAttributes canh đúng cái bẫy khiến internal/search
// phải có chặng lọc thứ hai: chữ trong thuộc tính KHÔNG phải chữ của bài.
func TestStripDoesNotLeakAttributes(t *testing.T) {
	got := htmltext.Strip(`<div class="entropy-box" title="entropy"><p>chuyện khác</p></div>`)
	if strings.Contains(strings.ToLower(got), "entropy") {
		t.Errorf("chữ trong thuộc tính lọt vào văn bản: %q", got)
	}
}

// TestStripNormalizesWhitespace: dòng trống liên tiếp gộp lại, hai đầu cắt
// gọn — nhưng khoảng trắng NẰM TRONG một dòng chữ thì không đụng tới.
func TestStripNormalizesWhitespace(t *testing.T) {
	if got := htmltext.Strip("<p></p><p></p><p>một</p><p></p><p></p><p>hai</p><p></p>"); got != "một\n\nhai" {
		t.Errorf("gộp dòng trống sai: %q", got)
	}
	if got := htmltext.Strip("<p>hai  khoảng</p>"); got != "hai  khoảng" {
		t.Errorf("khoảng trắng trong dòng bị đụng tới: %q", got)
	}
}

// TestStripHandlesVietnamese: không rune nào bị xẻ đôi thành U+FFFD.
func TestStripHandlesVietnamese(t *testing.T) {
	in := "<p>Định lý mã hoá nguồn</p><p>Bất đẳng thức Kraft–McMillan</p>"
	got := htmltext.Strip(in)
	if strings.ContainsRune(got, '�') {
		t.Errorf("có U+FFFD trong đầu ra: %q", got)
	}
	if got != "Định lý mã hoá nguồn\n\nBất đẳng thức Kraft–McMillan" {
		t.Errorf("Strip = %q", got)
	}
}

// TestStripEmptyish: HTML không rỗng vẫn có thể strip ra chuỗi rỗng, và cả
// hai người gọi (công cụ đọc khoá, và tìm kiếm) đều dựa vào điều đó.
func TestStripEmptyish(t *testing.T) {
	for _, in := range []string{"", "<p></p>", "<script>x()</script>", "   ", "<!-- ghi chú -->"} {
		if got := htmltext.Strip(in); got != "" {
			t.Errorf("Strip(%q) = %q, muốn chuỗi rỗng", in, got)
		}
	}
}
