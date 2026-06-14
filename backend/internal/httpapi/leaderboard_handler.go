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

// istMonday returns the 00:00-IST Monday of the IST week containing the given
// IST instant (an IST-zoned time.Time).
func istMonday(istTime time.Time) time.Time {
	y, m, d := istTime.Date()
	day := time.Date(y, m, d, 0, 0, 0, 0, ist)
	offset := (int(day.Weekday()) + 6) % 7 // Monday=0
	return day.AddDate(0, 0, -offset)
}

// weekStartKey is the IST-Monday CALENDAR date as a midnight-UTC time, used as the
// weekly_results.week_start DATE key. (NOT istMon.UTC(), which is the prior UTC day
// at 18:30 and would store/compare against the wrong DATE.)
func weekStartKey(istMon time.Time) time.Time {
	y, m, d := istMon.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
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
			weekMonIST = istMonday(parsed)
		} else {
			weekMonIST = istMonday(now().In(ist))
		}
		from := weekMonIST.UTC()
		to := weekMonIST.AddDate(0, 0, 7).UTC()
		weekLbl = weekMonIST.Format("2006-01-02")
		rows, err = d.Leaderboard.WeeklyLeaderboard(r.Context(), from, to)
		sameRank = leaderboard.WeeklySameRank
		if err == nil {
			wr, werr := d.Leaderboard.ListWeeklyResults(r.Context(), weekStartKey(weekMonIST))
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
