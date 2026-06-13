# syntax=docker/dockerfile:1
# Multi-stage: build a static binary, run on a minimal distroless image
# (base-debian12 ships CA certs + tzdata, so HTTPS calls and Asia/Kolkata work).

FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/seedfixtures ./cmd/seedfixtures

FROM gcr.io/distroless/base-debian12:nonroot
ENV TZ=Asia/Kolkata
WORKDIR /
COPY --from=build /out/server /server
COPY --from=build /out/seedfixtures /seedfixtures
EXPOSE 8000
USER nonroot:nonroot
ENTRYPOINT ["/server"]
