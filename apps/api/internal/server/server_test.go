package server

import (
	"net/http/httptest"
	"testing"

	"github.com/vndee/tuhoc-api/internal/config"
)

func TestHealthz(t *testing.T) {
	app := New(config.Config{}, Deps{})
	req := httptest.NewRequest("GET", "/healthz", nil)
	resp, _ := app.Test(req)
	if resp.StatusCode != 200 {
		t.Fatalf("want 200 got %d", resp.StatusCode)
	}
}
