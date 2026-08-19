# Tuhoc Platform

A multi-course self-study platform designed to aggregate, organize, and deliver interactive learning content. This monorepo contains the core infrastructure, course management kit, and the web and API applications that power the platform.

## Available Commands

| Command | Description |
|---------|-------------|
| `make dev-api` | Start the API development server (Go/Fiber) |
| `make dev-web` | Start the web development server (Bun) |
| `make test-api` | Run API tests |
| `make test-web` | Run web tests |
| `make test-extract` | Run content extraction tests |
| `make extract` | Extract course content from source material |

## Documentation

See the [platform design specification](docs/superpowers/specs/2026-08-19-tuhoc-platform-design.md) for full architecture and feature details.
