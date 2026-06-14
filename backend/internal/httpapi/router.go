package httpapi

import (
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// NewRouter wires all M1 routes. debug=true enables non-production-only routes
// (none yet in M1; the debug job trigger arrives in a later milestone).
func NewRouter(d *Deps, debug bool) chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)

	r.Get("/healthz", Healthz)

	// API reference (Scalar) + the OpenAPI document it renders. Public.
	r.Get("/docs", GetDocs)
	r.Get("/openapi.yaml", GetOpenAPISpec)

	r.Route("/api", func(api chi.Router) {
		api.Post("/auth/google", d.PostAuthGoogle)
		api.Post("/auth/logout", d.PostAuthLogout)

		api.Group(func(priv chi.Router) {
			priv.Use(d.RequireAuth)
			priv.Get("/me", d.GetMe)
			priv.Get("/matches", d.GetMatches)
			priv.Put("/matches/{id}/prediction", d.PutPrediction)

			if debug {
				priv.With(d.RequireAdmin).Post("/admin/jobs/run", d.PostRunJob)
			}
		})
	})

	return r
}
