package httpapi

import (
	_ "embed"
	"net/http"
)

// openapiSpec is the API description, embedded at build time.
//
//go:embed openapi.yaml
var openapiSpec []byte

// GetOpenAPISpec serves the raw OpenAPI document (consumed by /docs).
func GetOpenAPISpec(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/yaml")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(openapiSpec)
}

// GetDocs serves the Scalar API reference UI, which renders /openapi.yaml.
func GetDocs(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(scalarHTML))
}

// scalarHTML loads Scalar's API-reference bundle from jsdelivr. Like the Google
// Identity Services loader, it's an unversioned, auto-updating CDN bundle with no
// stable hash, so Subresource Integrity is intentionally omitted. This is an
// internal API-docs page; for a hardened prod we'd self-host or pin + hash it.
const scalarHTML = `<!doctype html>
<html>
  <head>
    <title>SayScore API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.yaml"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`
