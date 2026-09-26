FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download || true
RUN go install golang.org/x/tools/cmd/goimports@v0.21.0
COPY . .
# goimports restores imports the IDE may have stripped (e.g. pgx) before compiling.
RUN goimports -w ./cmd ./internal ./migrations && go mod tidy && CGO_ENABLED=0 go build -o /out/api ./cmd/api

FROM alpine:3.20
RUN adduser -D app
USER app
COPY --from=build /out/api /usr/local/bin/api
EXPOSE 8080
ENTRYPOINT ["api"]
