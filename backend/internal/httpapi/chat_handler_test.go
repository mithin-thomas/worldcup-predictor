package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sayonetech/worldcup-predictor/backend/internal/chat"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type fakeStreamer struct {
	deltas []string
	err    error
}

func (f fakeStreamer) StreamChat(_ context.Context, _ []chat.Message, onDelta func(string) error) error {
	for _, d := range f.deltas {
		if err := onDelta(d); err != nil {
			return err
		}
	}
	return f.err
}

// authedChatReq builds a POST /api/chat request with a user in context.
func authedChatReq(body string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/api/chat", strings.NewReader(body))
	ctx := context.WithValue(r.Context(), userCtxKey, store.User{ID: 1})
	return r.WithContext(ctx)
}

func TestPostChat_StreamsSSE(t *testing.T) {
	d := &Deps{Chat: fakeStreamer{deltas: []string{"Hel", "lo"}}}
	rec := httptest.NewRecorder()
	d.PostChat(rec, authedChatReq(`{"messages":[{"role":"user","content":"hi"}]}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{`data: "Hel"`, `data: "lo"`, "data: [DONE]"} {
		if !strings.Contains(body, want) {
			t.Errorf("body missing %q\n%s", want, body)
		}
	}
}

func TestPostChat_DisabledReturns503(t *testing.T) {
	d := &Deps{Chat: nil}
	rec := httptest.NewRecorder()
	d.PostChat(rec, authedChatReq(`{"messages":[{"role":"user","content":"hi"}]}`))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("code = %d, want 503", rec.Code)
	}
}

func TestPostChat_ValidationErrors(t *testing.T) {
	d := &Deps{Chat: fakeStreamer{}}
	cases := map[string]string{
		"empty messages": `{"messages":[]}`,
		"bad role":       `{"messages":[{"role":"system","content":"x"}]}`,
		"empty content":  `{"messages":[{"role":"user","content":"  "}]}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			d.PostChat(rec, authedChatReq(body))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("code = %d, want 400", rec.Code)
			}
		})
	}
}

func TestValidateChatMessages_TrimsToLast20(t *testing.T) {
	in := make([]chatMessageDTO, 25)
	for i := range in {
		in[i] = chatMessageDTO{Role: "user", Content: "m"}
	}
	out, err := validateChatMessages(in)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != maxChatMessages {
		t.Errorf("len = %d, want %d", len(out), maxChatMessages)
	}
}
