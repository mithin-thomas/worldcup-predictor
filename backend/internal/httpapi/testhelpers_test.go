package httpapi

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// injectChiParam injects a chi URL parameter into the request context.
// This lets tests call handler methods directly without going through NewRouter.
func injectChiParam(req *http.Request, key, val string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, val)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}
