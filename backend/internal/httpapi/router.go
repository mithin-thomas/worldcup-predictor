package httpapi

import (
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// NewRouter wires the API routes. debug=true enables non-production-only routes
// (currently the admin debug job trigger POST /api/admin/jobs/run).
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
			priv.Get("/leaderboard", d.GetLeaderboard)
			priv.Get("/winners", d.GetWinners)
			priv.With(d.RequireAdmin).Put("/admin/winners/paid", d.PutWinnerPaid)

			priv.Get("/bonus", d.GetBonus)
			priv.Put("/bonus", d.PutBonus)
			priv.Get("/teams", d.GetTeams)
			priv.Get("/players", d.GetPlayers)
			priv.With(d.RequireAdmin).Get("/admin/bonus/results", d.GetBonusResults)
			priv.With(d.RequireAdmin).Put("/admin/bonus/results", d.PutBonusResults)

			// Admin match management (all environments — not debug-gated).
			priv.With(d.RequireAdmin).Get("/admin/matches", d.GetAdminMatches)
			priv.With(d.RequireAdmin).Post("/admin/matches", d.PostAdminMatch)
			priv.With(d.RequireAdmin).Put("/admin/matches/{id}", d.PutAdminMatch)
			priv.With(d.RequireAdmin).Put("/admin/matches/{id}/result", d.PutAdminMatchResult)
			priv.With(d.RequireAdmin).Delete("/admin/matches/{id}", d.DeleteAdminMatch)

			// Admin user management (all environments — not debug-gated).
			priv.With(d.RequireAdmin).Get("/admin/users", d.GetAdminUsers)
			priv.With(d.RequireAdmin).Post("/admin/users/{id}/role", d.PostUserRole)

			// Admin settings + recompute (all environments — not debug-gated).
			priv.With(d.RequireAdmin).Get("/admin/settings", d.GetAdminSettings)
			priv.With(d.RequireAdmin).Put("/admin/settings", d.PutAdminSettings)
			priv.With(d.RequireAdmin).Post("/admin/recompute", d.PostRecompute)

			if debug {
				priv.With(d.RequireAdmin).Post("/admin/jobs/run", d.PostRunJob)
			}
		})
	})

	return r
}
