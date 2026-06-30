package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/game"
)

// seenJTI is a single-use guard for run-token jtis (in-memory, single-instance —
// consistent with the rate limiter). Entries expire after the token TTL.
type seenJTI struct {
	mu  sync.Mutex
	at  map[string]time.Time
	ttl time.Duration
	now func() time.Time
}

func (s *seenJTI) consume(jti string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for k, t := range s.at { // opportunistic GC
		if now.Sub(t) > s.ttl {
			delete(s.at, k)
		}
	}
	if _, used := s.at[jti]; used {
		return false
	}
	s.at[jti] = now
	return true
}

func (d *Deps) initGameJTISet() {
	now := func() time.Time { return time.Now().UTC() }
	d.gameJTI = &seenJTI{at: map[string]time.Time{}, ttl: 15 * time.Minute, now: now}
}

func newJTI() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type gameBoardRowDTO struct {
	UserID    int64  `json:"user_id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Distance  int64  `json:"distance,omitempty"`
	Coins     int64  `json:"coins,omitempty"`
}

type gameLeaderboardResponse struct {
	Distance []gameBoardRowDTO `json:"distance"`
	Coins    []gameBoardRowDTO `json:"coins"`
	Me       struct {
		BestDistance int64 `json:"best_distance"`
		CoinPool     int64 `json:"coin_pool"`
	} `json:"me"`
	RunToken string `json:"run_token"`
}

func (d *Deps) GetGameLeaderboard(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	dist, err := d.Game.GameDistanceBoard(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load game boards")
		return
	}
	coins, err := d.Game.GameCoinBoard(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load game boards")
		return
	}
	me, err := d.Game.GameMeStanding(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load game boards")
		return
	}
	var resp gameLeaderboardResponse
	for _, row := range dist {
		resp.Distance = append(resp.Distance, gameBoardRowDTO{UserID: row.UserID, Name: row.Name, AvatarURL: row.AvatarURL, Distance: row.Distance})
	}
	for _, row := range coins {
		resp.Coins = append(resp.Coins, gameBoardRowDTO{UserID: row.UserID, Name: row.Name, AvatarURL: row.AvatarURL, Coins: row.Coins})
	}
	resp.Me.BestDistance, resp.Me.CoinPool = me.BestDistance, me.CoinPool
	resp.RunToken = d.GameTokens.Issue(u.ID, newJTI())
	writeJSON(w, http.StatusOK, resp)
}

type postGameRunRequest struct {
	RunToken   string  `json:"run_token"`
	Distance   int     `json:"distance"`
	Coins      int     `json:"coins"`
	DurationMs float64 `json:"duration_ms"`
}

func (d *Deps) PostGameRun(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req postGameRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Distance < 0 || req.Coins < 0 || req.DurationMs < 0 {
		writeError(w, http.StatusBadRequest, "invalid run fields")
		return
	}
	claims, err := d.GameTokens.Verify(req.RunToken)
	if err != nil {
		writeError(w, http.StatusForbidden, "invalid run token")
		return
	}
	if claims.UserID != u.ID {
		writeError(w, http.StatusForbidden, "run token does not match user")
		return
	}
	if !d.gameJTI.consume(claims.JTI) {
		writeError(w, http.StatusForbidden, "run token already used")
		return
	}
	run := game.Run{Distance: req.Distance, Coins: req.Coins, DurationMs: req.DurationMs}
	if err := game.ValidateRun(run, claims.IssuedAt, time.Now().UTC(), d.GameLimits); err != nil {
		switch {
		case errors.Is(err, game.ErrBadRunFields):
			writeError(w, http.StatusBadRequest, "invalid run fields")
		default:
			writeError(w, http.StatusUnprocessableEntity, "run rejected as implausible")
		}
		return
	}
	if err := d.Game.InsertGameRun(r.Context(), u.ID, int32(req.Distance), int32(req.Coins)); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save run")
		return
	}
	me, err := d.Game.GameMeStanding(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load standing")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"best_distance": me.BestDistance,
		"coin_pool":     me.CoinPool,
		"run_token":     d.GameTokens.Issue(u.ID, newJTI()),
	})
}
