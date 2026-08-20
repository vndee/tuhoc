// Package migrations embeds the SQL migration files at compile time so the
// api binary is self-contained: internal/store reads them through
// migrations.FS instead of the filesystem, and the runtime image needs no
// migrations/ directory on disk (see apps/api/Dockerfile).
package migrations

import "embed"

// FS holds every *.sql file in this directory, embedded into the binary.
//
//go:embed *.sql
var FS embed.FS
