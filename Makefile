GO_VERSION := 1.26.10
SQLC_VERSION := v1.31.1
GOLANGCI_VERSION := v2.15.0
VERSION ?= dev
COMMIT := $(shell git rev-parse --short HEAD)
BUILD_TIME := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS := -s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT) -X main.buildTime=$(BUILD_TIME)

.PHONY: install dev dev-deps lint lint-go test test-integration e2e build build-go migrate sqlc api docker

install:
	pnpm install --frozen-lockfile
	cd backend && go mod download

# Run the Vite dev server in another terminal with pnpm dev.
dev:
	cd backend && go run ./cmd/lumi serve

dev-deps:
	docker compose -f deploy/docker-compose.dev.yml up -d --wait

lint: lint-go
	pnpm lint
	pnpm typecheck

lint-go:
	cd backend && go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_VERSION) run --build-tags=integration
	cd backend && go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_VERSION) fmt --diff

test:
	cd backend && go test ./...
	pnpm test

test-integration:
	cd backend && go test -tags=integration -count=1 ./...

e2e: build
	pnpm test:e2e

build:
	pnpm build
	$(MAKE) build-go

build-go:
	cd backend && CGO_ENABLED=0 go build -tags=production -trimpath -ldflags '$(LDFLAGS)' -o ../bin/lumi ./cmd/lumi

migrate:
	cd backend && go run ./cmd/lumi migrate

sqlc:
	cd backend && go run github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION) generate

api:
	pnpm api:generate

docker:
	docker compose --env-file deploy/.env -f deploy/docker-compose.yml -f deploy/docker-compose.build.yml up --build -d --wait
