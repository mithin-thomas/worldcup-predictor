package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/leaderboard"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

const leaderboardPageSize = 20

type leaderboardRowDTO struct {
	Rank      int    `json:"rank"`
	UserID    int64  `json:"user_id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Points    int64  `json:"points"`
	Exact     int64  `json:"exact"`
	Correct   int64  `json:"correct"`
	IsWinner  bool   `json:"is_winner"`
	IsMe      bool   `json:"is_me"`
}

type meRankDTO struct {
	Rank   int   `json:"rank"`
	Points int64 `json:"points"`
}

type leaderboardResponse struct {
	Period   string              `json:"period"`
	Week     string              `json:"week,omitempty"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"page_size"`
	Total    int                 `json:"total"`
	Rows     []leaderboardRowDTO `json:"rows"`
	Me       *meRankDTO          `json:"me"`
}

// GetLeaderboard serves the weekly or overall leaderboard (auth required).
func (d *Deps) GetLeaderboard(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	period := r.URL.Query().Get("period")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	if page > 10000 {
		page = 10000
	}

	var (
		rows     []store.LeaderboardRow
		sameRank func(a, b leaderboard.Row) bool
		weekLbl  string
		winners  map[int64]bool
		err      error
	)

	switch period {
	case "overall":
		rows, err = d.Leaderboard.OverallLeaderboard(r.Context())
		sameRank = leaderboard.OverallSameRank
	case "week":
		var weekMonIST time.Time
		if wp := r.URL.Query().Get("week"); wp != "" {
			parsed, perr := time.ParseInLocation("2006-01-02", wp, ist)
			if perr != nil {
				writeError(w, http.StatusBadRequest, "week must be YYYY-MM-DD")
				return
			}
			weekMonIST = leaderboard.ISTMonday(ist, parsed)
		} else {
			weekMonIST = leaderboard.ISTMonday(ist, now())
		}
		from := weekMonIST.UTC()
		to := weekMonIST.AddDate(0, 0, 7).UTC()
		weekLbl = weekMonIST.Format("2006-01-02")
		rows, err = d.Leaderboard.WeeklyLeaderboard(r.Context(), from, to)
		sameRank = leaderboard.WeeklySameRank
		if err == nil {
			wr, werr := d.Leaderboard.ListWeeklyResults(r.Context(), leaderboard.WeekStartKey(weekMonIST))
			if werr != nil {
				writeError(w, http.StatusInternalServerError, "could not load weekly winners")
				return
			}
			winners = make(map[int64]bool, len(wr))
			for _, x := range wr {
				if x.IsWinner {
					winners[x.UserID] = true
				}
			}
		}
	default:
		writeError(w, http.StatusBadRequest, "period must be week or overall")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load leaderboard")
		return
	}

	lrows := make([]leaderboard.Row, len(rows))
	for i, row := range rows {
		lrows[i] = leaderboard.Row{
			UserID: row.UserID, Name: row.Name, AvatarURL: row.AvatarURL,
			Points: row.Points, Exact: row.Exact, Correct: row.Correct,
			IsWinner: winners[row.UserID],
		}
	}
	ranked := leaderboard.Rank(lrows, sameRank)
	mine, hasMe := leaderboard.Find(ranked, u.ID)
	pageRows, total := leaderboard.Page(ranked, page, leaderboardPageSize)

	dto := leaderboardResponse{
		Period: period, Week: weekLbl, Page: page, PageSize: leaderboardPageSize, Total: total,
		Rows: make([]leaderboardRowDTO, 0, len(pageRows)),
	}
	for _, rr := range pageRows {
		dto.Rows = append(dto.Rows, leaderboardRowDTO{
			Rank: rr.Rank, UserID: rr.UserID, Name: rr.Name, AvatarURL: rr.AvatarURL,
			Points: rr.Points, Exact: rr.Exact, Correct: rr.Correct,
			IsWinner: rr.IsWinner, IsMe: rr.UserID == u.ID,
		})
	}
	if hasMe {
		dto.Me = &meRankDTO{Rank: mine.Rank, Points: mine.Points}
	}
	writeJSON(w, http.StatusOK, dto)
}
