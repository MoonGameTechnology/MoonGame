# Same verified Go toolchain pin as deploy/caddy/Dockerfile; no third-party Go modules.
FROM caddy:2-builder-alpine@sha256:ef9b65adf9a224770c6d5f6d1ae1bf99bc3caaa78d8c4bae3ea949ee6984f301 AS builder
ENV GOTOOLCHAIN=local CGO_ENABLED=0
WORKDIR /src
COPY probe.go .
RUN --network=none gofmt -w probe.go && go build -trimpath -ldflags="-s -w" -o /probe probe.go

FROM scratch
COPY --from=builder /probe /probe
USER 65532:65532
# This stage exports a binary for existing services; it has no running daemon.
HEALTHCHECK NONE
