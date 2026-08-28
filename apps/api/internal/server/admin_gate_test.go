package server

import "testing"

// TestAdminTokenMatches is the direct, HTTP-free proof of the one security
// property the task brief calls out explicitly: an empty CONFIGURED token
// must never match, no matter what a client supplies. This is a `package
// server` (internal) test specifically so it can call adminTokenMatches
// without going through a real HTTP request — see that function's own doc
// comment for why an HTTP-level reproduction of an "empty Bearer token"
// request is its own trap (fasthttp trims the trailing space that would
// make one before this code ever sees it, which is a fact about fasthttp's
// parser, not a guarantee this function is entitled to lean on).
func TestAdminTokenMatches(t *testing.T) {
	cases := []struct {
		name                 string
		configured, supplied string
		want                 bool
	}{
		{"empty configured, empty supplied: MUST NOT match", "", "", false},
		{"empty configured, non-empty supplied: MUST NOT match", "", "anything", false},
		{"configured set, empty supplied: no match", "s3cret", "", false},
		{"configured set, matching supplied: matches", "s3cret", "s3cret", true},
		{"configured set, wrong supplied: no match", "s3cret", "not-s3cret", false},
		{"configured set, supplied is a prefix of it: no match", "s3cret", "s3c", false},
		{"configured set, supplied has it as a prefix: no match", "s3cret", "s3cret-extra", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := adminTokenMatches(tc.configured, tc.supplied); got != tc.want {
				t.Errorf("adminTokenMatches(%q, %q) = %v, want %v", tc.configured, tc.supplied, got, tc.want)
			}
		})
	}
}
