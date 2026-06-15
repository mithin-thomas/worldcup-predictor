package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// Task 1: GET /api/admin/bonus/results tests

func TestGetBonusResults_AllSevenInOrderWithLabels(t *testing.T) {
	bs := &fakeBonusStore{}
	bs.results = []store.BonusResult{
		{Category: "winner", RefID: 9},
		{Category: "golden_ball", RefID: 42},
	}
	ps := &fakePlayerStore{
		teamNames:   map[int64]string{9: "Brazil"},
		playerNames: map[int64]string{42: "Messi"},
	}
	d := &Deps{Bonus: bs, Players: ps}
	req := ctxUser(httptest.NewRequest(http.MethodGet, "/api/admin/bonus/results", nil), 1)
	rec := httptest.NewRecorder()
	d.GetBonusResults(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200", rec.Code)
	}
	var got struct {
		Results []struct {
			Category string `json:"category"`
			Points   int    `json:"points"`
			RefType  string `json:"ref_type"`
			RefID    int64  `json:"ref_id"`
			Label    string `json:"label"`
			Set      bool   `json:"set"`
		} `json:"results"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if len(got.Results) != 7 {
		t.Fatalf("results=%d want 7", len(got.Results))
	}
	if got.Results[0].Category != "winner" || got.Results[0].Points != 30 || got.Results[0].Label != "Brazil" || !got.Results[0].Set {
		t.Errorf("winner row wrong: %+v", got.Results[0])
	}
	// find golden_ball → player label
	var gb bool
	for _, r := range got.Results {
		if r.Category == "golden_ball" {
			gb = true
			if r.RefType != "player" || r.Label != "Messi" || r.Points != 10 || !r.Set {
				t.Errorf("golden_ball row wrong: %+v", r)
			}
		}
		if r.Category == "runner_up" && (r.Set || r.RefID != 0 || r.Label != "") {
			t.Errorf("unset runner_up should be set:false ref:0 label:\"\"; got %+v", r)
		}
	}
	if !gb {
		t.Error("golden_ball missing")
	}
}

func TestGetBonusResults_CanonicalOrder(t *testing.T) {
	bs := &fakeBonusStore{}
	ps := &fakePlayerStore{}
	d := &Deps{Bonus: bs, Players: ps}
	req := ctxUser(httptest.NewRequest(http.MethodGet, "/api/admin/bonus/results", nil), 1)
	rec := httptest.NewRecorder()
	d.GetBonusResults(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200", rec.Code)
	}
	var got struct {
		Results []struct {
			Category string `json:"category"`
		} `json:"results"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&got)
	want := []string{"winner", "runner_up", "golden_ball", "golden_boot", "golden_glove", "young_player", "fair_play"}
	if len(got.Results) != len(want) {
		t.Fatalf("results=%d want %d", len(got.Results), len(want))
	}
	for i, w := range want {
		if got.Results[i].Category != w {
			t.Errorf("position %d: got %q want %q", i, got.Results[i].Category, w)
		}
	}
}

func TestGetBonusResults_UnsetRowsHaveZeroRefAndEmptyLabel(t *testing.T) {
	bs := &fakeBonusStore{} // no results
	ps := &fakePlayerStore{}
	d := &Deps{Bonus: bs, Players: ps}
	req := ctxUser(httptest.NewRequest(http.MethodGet, "/api/admin/bonus/results", nil), 1)
	rec := httptest.NewRecorder()
	d.GetBonusResults(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200", rec.Code)
	}
	var got struct {
		Results []struct {
			RefID int64  `json:"ref_id"`
			Label string `json:"label"`
			Set   bool   `json:"set"`
		} `json:"results"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&got)
	for _, r := range got.Results {
		if r.Set || r.RefID != 0 || r.Label != "" {
			t.Errorf("unset row should be set:false ref:0 label:\"\"; got set=%v ref=%d label=%q", r.Set, r.RefID, r.Label)
		}
	}
}

func TestGetBonusResults_CorrectPointsPerCategory(t *testing.T) {
	bs := &fakeBonusStore{}
	ps := &fakePlayerStore{}
	d := &Deps{Bonus: bs, Players: ps}
	req := ctxUser(httptest.NewRequest(http.MethodGet, "/api/admin/bonus/results", nil), 1)
	rec := httptest.NewRecorder()
	d.GetBonusResults(rec, req)
	var got struct {
		Results []struct {
			Category string `json:"category"`
			Points   int    `json:"points"`
		} `json:"results"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&got)
	wantPoints := map[string]int{
		"winner":       30,
		"runner_up":    20,
		"golden_ball":  10,
		"golden_boot":  10,
		"golden_glove": 10,
		"young_player": 10,
		"fair_play":    10,
	}
	for _, r := range got.Results {
		if r.Points != wantPoints[r.Category] {
			t.Errorf("category %q: points=%d want %d", r.Category, r.Points, wantPoints[r.Category])
		}
	}
}

// Task 2: Auto-score on PUT tests

func TestPutBonusResults_AutoScores(t *testing.T) {
	bs := &fakeBonusStore{teamOK: true, playerOK: true}
	jr := &fakeJobRunner{}
	d := &Deps{Bonus: bs, Players: &fakePlayerStore{}, JobRunner: jr}
	body := `{"results":[{"category":"winner","ref_id":9}]}`
	req := ctxUser(httptest.NewRequest(http.MethodPut, "/api/admin/bonus/results", strings.NewReader(body)), 1)
	rec := httptest.NewRecorder()
	d.PutBonusResults(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200", rec.Code)
	}
	if bs.resultsSaved != 1 {
		t.Errorf("resultsSaved=%d want 1", bs.resultsSaved)
	}
	if jr.called == 0 {
		t.Error("auto-score must call RunBonusScore")
	}
}

func TestPutBonusResults_ScorerErrorStillSavedReturns500(t *testing.T) {
	bs := &fakeBonusStore{teamOK: true, playerOK: true}
	jr := &fakeJobRunner{bonusErr: errors.New("score boom")}
	d := &Deps{Bonus: bs, Players: &fakePlayerStore{}, JobRunner: jr}
	body := `{"results":[{"category":"winner","ref_id":9}]}`
	req := ctxUser(httptest.NewRequest(http.MethodPut, "/api/admin/bonus/results", strings.NewReader(body)), 1)
	rec := httptest.NewRecorder()
	d.PutBonusResults(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d want 500", rec.Code)
	}
	if bs.resultsSaved != 1 {
		t.Errorf("outcomes must be persisted even when scoring fails; resultsSaved=%d", bs.resultsSaved)
	}
}

func TestPutBonusResults_NilJobRunnerSkipsScoring(t *testing.T) {
	bs := &fakeBonusStore{teamOK: true, playerOK: true}
	d := &Deps{Bonus: bs, Players: &fakePlayerStore{}, JobRunner: nil}
	body := `{"results":[{"category":"winner","ref_id":9}]}`
	req := ctxUser(httptest.NewRequest(http.MethodPut, "/api/admin/bonus/results", strings.NewReader(body)), 1)
	rec := httptest.NewRecorder()
	d.PutBonusResults(rec, req)
	// nil runner: outcomes still saved, response is 200
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 when JobRunner is nil", rec.Code)
	}
	if bs.resultsSaved != 1 {
		t.Errorf("resultsSaved=%d want 1", bs.resultsSaved)
	}
}

// TestGetBonusResults_StaleRefIDDegradesToEmptyLabel asserts that a stored outcome
// whose ref_id is not present in the name store resolves to label:"" (graceful
// degradation) while still returning set:true and the stored ref_id.
func TestGetBonusResults_StaleRefIDDegradesToEmptyLabel(t *testing.T) {
	bs := &fakeBonusStore{}
	bs.results = []store.BonusResult{{Category: "winner", RefID: 999}}
	// fakePlayerStore with an empty teamNames map — id 999 is not present → ""
	ps := &fakePlayerStore{teamNames: map[int64]string{}}
	d := &Deps{Bonus: bs, Players: ps}
	req := ctxUser(httptest.NewRequest(http.MethodGet, "/api/admin/bonus/results", nil), 1)
	rec := httptest.NewRecorder()
	d.GetBonusResults(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 even with unknown ref_id", rec.Code)
	}
	var got struct {
		Results []struct {
			Category string `json:"category"`
			RefID    int64  `json:"ref_id"`
			Label    string `json:"label"`
			Set      bool   `json:"set"`
		} `json:"results"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if len(got.Results) == 0 {
		t.Fatal("expected results")
	}
	var winnerRow *struct {
		Category string `json:"category"`
		RefID    int64  `json:"ref_id"`
		Label    string `json:"label"`
		Set      bool   `json:"set"`
	}
	for i := range got.Results {
		if got.Results[i].Category == "winner" {
			winnerRow = &got.Results[i]
			break
		}
	}
	if winnerRow == nil {
		t.Fatal("winner row missing from results")
	}
	if !winnerRow.Set {
		t.Error("set should be true for a stored outcome")
	}
	if winnerRow.RefID != 999 {
		t.Errorf("ref_id=%d want 999", winnerRow.RefID)
	}
	if winnerRow.Label != "" {
		t.Errorf("label=%q want empty string for unknown ref_id", winnerRow.Label)
	}
}

// TestPutBonusResults_Idempotent documents that calling PutBonusResults twice with
// the same body is safe: the handler upserts on every call (idempotency is delegated
// to the SET-based scorer), so resultsSaved==2 and JobRunner is invoked each time.
func TestPutBonusResults_Idempotent(t *testing.T) {
	bs := &fakeBonusStore{teamOK: true, playerOK: true}
	jr := &fakeJobRunner{}
	d := &Deps{Bonus: bs, Players: &fakePlayerStore{}, JobRunner: jr}
	body := `{"results":[{"category":"winner","ref_id":9}]}`

	// First call
	req1 := ctxUser(httptest.NewRequest(http.MethodPut, "/api/admin/bonus/results", strings.NewReader(body)), 1)
	rec1 := httptest.NewRecorder()
	d.PutBonusResults(rec1, req1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first call: status=%d want 200", rec1.Code)
	}

	// Second call — same body
	req2 := ctxUser(httptest.NewRequest(http.MethodPut, "/api/admin/bonus/results", strings.NewReader(body)), 1)
	rec2 := httptest.NewRecorder()
	d.PutBonusResults(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second call: status=%d want 200", rec2.Code)
	}

	if bs.resultsSaved != 2 {
		t.Errorf("resultsSaved=%d want 2 (upsert ran each time)", bs.resultsSaved)
	}
	if jr.called != 2 {
		t.Errorf("JobRunner.called=%d want 2 (scorer invoked each time)", jr.called)
	}
}
