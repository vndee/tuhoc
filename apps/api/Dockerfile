# syntax=docker/dockerfile:1
#
# Build context is apps/api itself (not the repo root):
#   docker build -t tuhoc-api apps/api
#
# Migrations (ruling F6): internal/store embeds apps/api/migrations/*.sql
# via embed.FS (see migrations/migrations.go), and golang-migrate reads them
# from that embedded fs.FS at runtime — not from disk. So the *running*
# binary needs nothing under /migrations in the final image, and there is
# deliberately no COPY for it there. The build stage below still needs
# `COPY migrations ./migrations` — that copy is for `go build` itself,
# which requires the *.sql files on disk to satisfy the go:embed directive
# at compile time; it has nothing to do with runtime.
#
# Cross-compile: the build stage runs on the *build* platform natively
# (--platform=$BUILDPLATFORM) and cross-compiles the Go binary for the
# *target* platform via GOARCH=$TARGETARCH. A plain `docker build` targets
# the host's own arch (arm64 native builds stay fast on this Apple Silicon
# machine); a production build must pass --platform linux/amd64 explicitly
# to get an amd64 binary for a typical amd64 host — GOARCH is otherwise
# implicit and would silently ship the build host's architecture, which
# fails at container startup with "exec format error" on a different one.
# Task 16 (deploy config) must record --platform linux/amd64 for prod builds.

# ---- build stage ----
FROM --platform=$BUILDPLATFORM golang:1.25.5-alpine AS build
WORKDIR /src
ARG TARGETARCH

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
COPY migrations ./migrations

RUN CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build -o /out/tuhoc-api ./cmd/api

# ---- runtime stage ----
FROM scratch

COPY --from=build /out/tuhoc-api /tuhoc-api

EXPOSE 8080
USER 65532:65532

ENTRYPOINT ["/tuhoc-api"]
