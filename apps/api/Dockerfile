# syntax=docker/dockerfile:1
#
# Build context is apps/api itself (not the repo root):
#   docker build -t tuhoc-api apps/api
#
# This task (P1 T4) ships config + healthz only, so the image contains just
# the binary. Task 5 adds a migrations/ directory and a COPY line for it
# once internal/store exists (ruling F6 — apps/api/migrations/ does not
# exist yet, so copying it here would break this task's docker build gate).
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

RUN CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build -o /out/tuhoc-api ./cmd/api

# ---- runtime stage ----
FROM scratch

COPY --from=build /out/tuhoc-api /tuhoc-api

EXPOSE 8080
USER 65532:65532

ENTRYPOINT ["/tuhoc-api"]
