.PHONY: up down tidy run test

up:
	docker compose up -d

down:
	docker compose down

tidy:
	go mod tidy

run:
	set -a && . ./.env && set +a && go run ./cmd/api

test:
	go test ./...
