package auth_test

import (
	"testing"

	"github.com/vndee/tuhoc-api/internal/auth"
)

// TestValidEmail pins both directions. The rejections are the bug that was
// reported ("I typed a bad address and it let me in"); the acceptances are
// the bug that over-strict validation would introduce next, so they are
// tested with the same weight.
func TestValidEmail(t *testing.T) {
	good := []string{
		"a@b.co",
		"duy.huynh@example.com",
		"user+tag@example.co.uk",
		"x_y-z@sub.domain.org",
		"UPPER@Example.COM",
		"1@2.3", // numeric but well-formed; refusing this is not our business
	}
	for _, s := range good {
		if !auth.ValidEmail(s) {
			t.Errorf("ValidEmail(%q) = false, want true — a real address was refused", s)
		}
	}

	bad := []string{
		"",
		"abc",             // the reported bug
		"abc@",            // no domain
		"@example.com",    // no local part
		"a b@example.com", // space
		"a@b",             // no dot in the domain — a typo on a public site
		"a@.com",          // leading dot
		"a@b.",            // trailing dot
		"Duy <a@b.co>",    // display-name form: stored value would not be what was typed
		"a@b.co, c@d.co",  // two addresses
		"a@b\n.co",        // newline, header-injection shaped
	}
	for _, s := range bad {
		if auth.ValidEmail(s) {
			t.Errorf("ValidEmail(%q) = true, want false", s)
		}
	}
}
