# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile
COPY frontend frontend
RUN pnpm build

FROM --platform=$BUILDPLATFORM golang:1.26.10-alpine AS backend
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend ./
COPY --from=frontend /src/backend/web/dist ./web/dist
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -tags=production -trimpath \
    -ldflags="-s -w -X main.version=$VERSION -X main.commit=$COMMIT -X main.buildTime=$BUILD_TIME" \
    -o /out/lumi ./cmd/lumi

FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -g 10001 lumi \
    && adduser -D -H -u 10001 -G lumi lumi \
    && mkdir -p /data/images && chown -R lumi:lumi /data
COPY --from=backend /out/lumi /usr/local/bin/lumi
ENV APP_ENV=production GIN_MODE=release HTTP_ADDR=:8080 DATA_DIR=/data TZ=Asia/Shanghai
USER 10001:10001
WORKDIR /data
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["/usr/local/bin/lumi", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/lumi"]
CMD ["serve"]
