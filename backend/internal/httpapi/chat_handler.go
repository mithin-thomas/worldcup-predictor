package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/chat"
)

const maxChatMessages = 20

type chatMessageDTO struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Messages []chatMessageDTO `json:"messages"`
}

// PostChat streams an OpenAI chat completion back to the client as SSE.
// The system prompt is injected server-side; clients send only user/assistant turns.
func (d *Deps) PostChat(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if d.Chat == nil {
		writeError(w, http.StatusServiceUnavailable, "chat unavailable")
		return
	}

	var req chatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	msgs, err := validateChatMessages(req.Messages)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// SSE headers. Disable the server write deadline so a long stream isn't cut
	// off by the 15s WriteTimeout; disable proxy buffering for token-by-token flush.
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	w.WriteHeader(http.StatusOK)

	flusher, _ := w.(http.Flusher)
	writeFrame := func(s string) {
		_, _ = io.WriteString(w, s)
		if flusher != nil {
			flusher.Flush()
		}
	}

	onDelta := func(delta string) error {
		b, _ := json.Marshal(delta) // JSON-encode so newlines/`data:` are safe in SSE
		writeFrame("data: " + string(b) + "\n\n")
		return r.Context().Err() // non-nil if the client disconnected → abort
	}

	if err := d.Chat.StreamChat(r.Context(), chat.UserInfo{Name: u.Name}, msgs, onDelta); err != nil {
		slog.Error("chat stream", "err", err)
		b, _ := json.Marshal("the assistant is unavailable right now")
		writeFrame("event: error\ndata: " + string(b) + "\n\n")
		return
	}
	writeFrame("data: [DONE]\n\n")
}

// validateChatMessages enforces non-empty user/assistant turns and trims to the
// last maxChatMessages to bound token cost.
func validateChatMessages(in []chatMessageDTO) ([]chat.Message, error) {
	if len(in) == 0 {
		return nil, errors.New("messages required")
	}
	if len(in) > maxChatMessages {
		in = in[len(in)-maxChatMessages:]
	}
	out := make([]chat.Message, 0, len(in))
	for _, m := range in {
		if m.Role != chat.RoleUser && m.Role != chat.RoleAssistant {
			return nil, errors.New("invalid role")
		}
		if strings.TrimSpace(m.Content) == "" {
			return nil, errors.New("empty message content")
		}
		out = append(out, chat.Message{Role: m.Role, Content: m.Content})
	}
	return out, nil
}
