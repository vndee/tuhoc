package search

import (
	"errors"

	"github.com/vndee/tuhoc-api/internal/auth"

	"github.com/gofiber/fiber/v2"

	"github.com/vndee/tuhoc-api/internal/apilog"
)

// Handler giữ phần HTTP: đọc tham số, hình dạng thân trả về, mã trạng thái.
// Không SQL (repo.go), không luật (usecase.go).
type Handler struct {
	uc *Usecase
}

// NewHandler dựng Handler trên uc.
func NewHandler(uc *Usecase) *Handler { return &Handler{uc: uc} }

type courseHitJSON struct {
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type chapterHitJSON struct {
	Slug         string `json:"slug"`
	CourseTitle  string `json:"courseTitle"`
	ChapterID    string `json:"chapterId"`
	ChapterTitle string `json:"chapterTitle"`
	Before       string `json:"before"`
	Match        string `json:"match"`
	After        string `json:"after"`
}

type resultsJSON struct {
	Courses   []courseHitJSON  `json:"courses"`
	Chapters  []chapterHitJSON `json:"chapters"`
	Truncated bool             `json:"truncated"`
}

// Search xử lý GET /search?q=&limit=.
//
// CÔNG KHAI, không auth.Require — cùng chính sách với ba route catalog còn
// lại (/courses, /courses/:slug, /courses/:slug/chapters/:id): nội dung mà
// endpoint này tìm trong đã đọc được không cần phiên. Giao diện chỉ hiện ô
// tìm kiếm cho người đã đăng nhập, nhưng đó là một lựa chọn về giao diện,
// KHÔNG phải một ranh giới bảo mật, và chỗ này là nơi nói rõ điều đó để vòng
// sau không nhầm cái sau thành cái trước.
func (h *Handler) Search(c *fiber.Ctx) error {
	q, err := NormalizeQuery(c.Query("q"))
	switch {
	case errors.Is(err, ErrQueryTooShort):
		return c.Status(fiber.StatusBadRequest).
			JSON(fiber.Map{"error": "query is too short"})
	case errors.Is(err, ErrQueryTooLong):
		return c.Status(fiber.StatusBadRequest).
			JSON(fiber.Map{"error": "query is too long"})
	case errors.Is(err, ErrQueryInvalid):
		return c.Status(fiber.StatusBadRequest).
			JSON(fiber.Map{"error": "query is not valid text"})
	case err != nil:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid query"})
	}

	res, err := h.uc.Search(c.Context(), q, ClampLimit(c.QueryInt("limit", 0)), auth.IsAdmin(c))
	if err != nil {
		apilog.Internal(c, "search.Search", err)
		return c.Status(fiber.StatusInternalServerError).
			JSON(fiber.Map{"error": "search failed"})
	}

	// make(..., len) chứ không phải slice nil: encoding/json biến slice nil
	// thành `null`, và một client gọi .map() trên đó sẽ ném lỗi khi không
	// có kết quả nào — đúng lý lẽ catalog.PublicList đã áp cho mảng của nó.
	out := resultsJSON{
		Courses:   make([]courseHitJSON, len(res.Courses)),
		Chapters:  make([]chapterHitJSON, len(res.Chapters)),
		Truncated: res.Truncated,
	}
	for i, ch := range res.Courses {
		out.Courses[i] = courseHitJSON{Slug: ch.Slug, Title: ch.Title, Description: ch.Description}
	}
	for i, ch := range res.Chapters {
		out.Chapters[i] = chapterHitJSON{
			Slug: ch.Slug, CourseTitle: ch.CourseTitle,
			ChapterID: ch.ChapterID, ChapterTitle: ch.ChapterTitle,
			Before: ch.Before, Match: ch.Match, After: ch.After,
		}
	}
	return c.Status(fiber.StatusOK).JSON(out)
}
