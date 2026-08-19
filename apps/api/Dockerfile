# syntax=docker/dockerfile:1
#
# Build context is apps/api itself (not the repo root):
#   docker build -t tuhoc-api apps/api
#
# This task (P1 T4) ships config + healthz only, so the image contains just
# the binary. Task 5 adds a migrations/ directory and a COPY line for it
# once internal/store exists (ruling F6 — apps/api/migrations/ does not
# exist yet, so copying it here would break this task's docker build gate).

# ---- build stage ----
FROM golang:1.25.5-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 GOOS=linux go build -o /out/tuhoc-api ./cmd/api

# ---- runtime stage ----
FROM scratch

COPY --from=build /out/tuhoc-api /tuhoc-api

EXPOSE 8080
USER 65532:65532

ENTRYPOINT ["/tuhoc-api"]
