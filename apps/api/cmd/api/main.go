// Command api is the tuhoc backend entrypoint. This task (P1 T4) only
// wires config and the HTTP server; database connection setup belongs to
// Task 5 (internal/store does not exist yet).
package main

import (
	"log"

	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/server"
)

func main() {
	cfg := config.Load()

	app := server.New(cfg, server.Deps{})

	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
