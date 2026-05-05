# Copyright (C) 2026 Garudex Labs.  All Rights Reserved.
# Caracal, a product of Garudex Labs
#
# Audit service image; build context must be the caracal/ workspace root.

FROM golang:1.26-alpine AS builder
WORKDIR /build
COPY go.work go.work
COPY packages/shared/ packages/shared/
COPY services/audit/ services/audit/
WORKDIR /build/services/audit
RUN go mod download && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -o /audit ./cmd/audit

FROM gcr.io/distroless/static:nonroot
COPY --from=builder /audit /audit
USER nonroot:nonroot
ENTRYPOINT ["/audit"]
