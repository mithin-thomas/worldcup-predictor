# SayScore Chat Assistant (OpenAI, prompt-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the MadCrow widget with a first-party, prompt-only OpenAI chat assistant — a streaming Go proxy (`POST /api/chat`) and a bottom-right "Solid Stadium Card" chat widget with session-only history.

**Architecture:** The browser never sees the OpenAI key. A thin Go endpoint holds `OPENAI_API_KEY` + a file-loaded system prompt, calls OpenAI's streaming Chat Completions via the official `github.com/openai/openai-go/v3` SDK, and proxies content deltas to the client as SSE. The frontend `ChatWidget` keeps history in `sessionStorage` and renders the stream live. No database.

**Tech Stack:** Go 1.22 · chi/v5 · `openai-go/v3` · React 18 + TS + Vite · TanStack Query (not needed here — plain fetch streaming) · Vitest.

**Spec:** `docs/superpowers/specs/2026-06-22-sayscore-chat-assistant-design.md`

**Branch:** `feat/chat-assistant` (already created, off `main`; the design spec is already committed there).

---

## Conventions (read once)

- **Backend module:** `github.com/sayonetech/worldcup-predictor/backend`. Run Go commands from `backend/`.
- **Frontend:** run `pnpm` commands from `frontend/`. Vitest globals are on; setup at `src/test/setup.ts`.
- **Handlers** use `writeJSON` / `writeError` / `userFromContext` (in `internal/httpapi/middleware.go`).
- **Config** uses the `getenv(key, def)` / `os.Getenv` pattern in `internal/config/config.go`.
- **Frontend API base:** `const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";`, all fetches use `credentials: "include"`.
- **Commit** after each task with Conventional Commits; never `--no-verify`.

## File Structure

**Backend**
- Modify `backend/internal/config/config.go` — add `OpenAIAPIKey`, `OpenAISystemPromptFile`, `OpenAIModel`.
- Create `backend/internal/chat/chat.go` — `Message`, `Streamer`, `assembleMessages`, `LoadSystemPrompt`, `OpenAIClient`, `New`.
- Create `backend/internal/chat/chat_test.go` — tests for `assembleMessages` + `LoadSystemPrompt`.
- Create `backend/internal/httpapi/chat_handler.go` — `PostChat`, `validateChatMessages`.
- Create `backend/internal/httpapi/chat_handler_test.go` — handler tests with a fake `Streamer`.
- Modify `backend/internal/httpapi/middleware.go` — add `Chat chat.Streamer` to `Deps`.
- Modify `backend/internal/httpapi/ratelimit.go` — add `chatRate` / `chatBurst`.
- Modify `backend/internal/httpapi/router.go` — register the chat route with a dedicated limiter.
- Modify `backend/cmd/server/main.go` — load prompt file, construct the chat client, wire `Deps.Chat`.
- Modify `backend/go.mod` / `backend/go.sum` — add `github.com/openai/openai-go/v3`.

**Frontend**
- Create `frontend/src/lib/chat.ts` — `ChatMessage`, `ChatUnavailableError`, `streamChat`.
- Create `frontend/src/lib/chat.test.ts` — `streamChat` parsing + 503 tests.
- Create `frontend/src/components/ChatWidget.tsx` — launcher + panel.
- Create `frontend/src/components/ChatWidget.test.tsx` — widget tests.
- Create `frontend/src/styles/chat.css` — Direction B styles.
- Modify `frontend/src/components/icons.tsx` — add `BallChatIcon`.
- Modify `frontend/src/App.tsx` — mount `<ChatWidget />`.
- Modify `frontend/index.html` — remove the MadCrow `<script>`.

**Config / build / docs**
- Modify `frontend/.env.example`, root `.env.example`, `.env.prod.example`, `backend/.env.example`.
- Modify `frontend/Dockerfile`, `frontend/Dockerfile.prod`, `deploy/docker-compose.yml`, `.github/workflows/deploy-ecr.yml`.
- Modify `README.md`, `docs/REQUIREMENTS.md`.

---

### Task 1: Remove the MadCrow widget

**Files:**
- Modify: `frontend/index.html` (remove the MadCrow `<script>` block, lines ~27-38)
- Modify: `frontend/.env.example`, `.env.example`, `.env.prod.example` (drop `VITE_MADCROW_ASSISTANT_ID`)
- Modify: `frontend/Dockerfile`, `frontend/Dockerfile.prod` (drop the `ARG`/`ENV VITE_MADCROW_ASSISTANT_ID`)
- Modify: `deploy/docker-compose.yml` (drop the `VITE_MADCROW_ASSISTANT_ID` build arg, ~line 100)
- Modify: `.github/workflows/deploy-ecr.yml` (drop the `VITE_MADCROW_ASSISTANT_ID=…` build-arg line, ~line 89)
- Modify: `README.md` (delete the "## MadCrow chatbot widget" section, ~lines 247-270)

- [ ] **Step 1: Delete the MadCrow script from `frontend/index.html`**

Remove the entire comment block + `<script src="https://dashboard.madcrow.ai/widget.bundle.js" …></script>` (the lines between the GIS loader and `</head>`). Leave the GIS loader intact.

- [ ] **Step 2: Remove every other MadCrow reference**

In each file above, delete the `VITE_MADCROW_ASSISTANT_ID` line (and its surrounding comment lines in the `.env*` files and the README section). Use the file edit tool per file.

- [ ] **Step 3: Verify nothing references MadCrow anymore**

Run from repo root: `grep -rin madcrow . --exclude-dir=node_modules --exclude-dir=.git`
Expected: no output.

- [ ] **Step 4: Verify the frontend still builds**

Run from `frontend/`: `pnpm install && pnpm build`
Expected: build succeeds (the removed env var was build-time only).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove MadCrow chatbot widget"
```

---

### Task 2: Backend config for OpenAI

**Files:**
- Modify: `backend/internal/config/config.go`
- Test: `backend/internal/config/config_test.go` (create if absent, else append)
- Modify: `backend/.env.example`

- [ ] **Step 1: Write the failing test**

Create/append `backend/internal/config/config_test.go`:

```go
package config

import (
	"os"
	"testing"
)

func TestLoad_OpenAIDefaults(t *testing.T) {
	// Required vars so Load() succeeds.
	t.Setenv("SESSION_SECRET", "x")
	t.Setenv("GOOGLE_CLIENT_ID", "y")
	// Ensure OpenAI vars are unset for the default case.
	os.Unsetenv("OPENAI_API_KEY")
	os.Unsetenv("OPENAI_SYSTEM_PROMPT_FILE")
	os.Unsetenv("OPENAI_MODEL")

	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.OpenAIAPIKey != "" {
		t.Errorf("OpenAIAPIKey = %q, want empty", c.OpenAIAPIKey)
	}
	if c.OpenAISystemPromptFile != "" {
		t.Errorf("OpenAISystemPromptFile = %q, want empty", c.OpenAISystemPromptFile)
	}
	if c.OpenAIModel != "gpt-4o-mini" {
		t.Errorf("OpenAIModel = %q, want gpt-4o-mini", c.OpenAIModel)
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

Run from `backend/`: `go test ./internal/config/ -run TestLoad_OpenAIDefaults -v`
Expected: FAIL (compile error — fields don't exist).

- [ ] **Step 3: Add the config fields**

In `backend/internal/config/config.go`, add to the `Config` struct (after `SlackWebhookURL`):

```go
	OpenAIAPIKey           string
	OpenAISystemPromptFile string
	OpenAIModel            string
```

And in `Load()`'s struct literal (after `SlackWebhookURL: …`):

```go
		OpenAIAPIKey:           os.Getenv("OPENAI_API_KEY"),
		OpenAISystemPromptFile: os.Getenv("OPENAI_SYSTEM_PROMPT_FILE"),
		OpenAIModel:            getenv("OPENAI_MODEL", "gpt-4o-mini"),
```

- [ ] **Step 4: Run it and watch it pass**

Run from `backend/`: `go test ./internal/config/ -run TestLoad_OpenAIDefaults -v`
Expected: PASS.

- [ ] **Step 5: Document the env vars**

Append to `backend/.env.example`:

```bash
# ---- Chat assistant (OpenAI, prompt-only) ----
# Leave OPENAI_API_KEY blank to disable chat (POST /api/chat returns 503).
OPENAI_API_KEY=
# Path to a UTF-8 text file holding the system prompt (the assistant's persona/rules).
OPENAI_SYSTEM_PROMPT_FILE=./prompts/chat-system.txt
# Optional model override (default below).
OPENAI_MODEL=gpt-4o-mini
```

- [ ] **Step 6: Commit**

```bash
git add backend/internal/config/config.go backend/internal/config/config_test.go backend/.env.example
git commit -m "feat(config): add OpenAI chat env (key, prompt file, model)"
```

---

### Task 3: `internal/chat` package (SDK client + helpers)

**Files:**
- Create: `backend/internal/chat/chat.go`
- Test: `backend/internal/chat/chat_test.go`
- Modify: `backend/go.mod`, `backend/go.sum`

- [ ] **Step 1: Add the OpenAI Go SDK dependency**

Run from `backend/`: `go get github.com/openai/openai-go/v3@latest`
Expected: `go.mod`/`go.sum` updated.

- [ ] **Step 2: Write the failing test**

Create `backend/internal/chat/chat_test.go`:

```go
package chat

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAssembleMessages_PrependsSystem(t *testing.T) {
	got := assembleMessages("SYS", []Message{
		{Role: "user", Content: "hi"},
		{Role: "assistant", Content: "hello"},
	})
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}
	if got[0].Role != "system" || got[0].Content != "SYS" {
		t.Errorf("first = %+v, want system/SYS", got[0])
	}
	if got[1].Content != "hi" || got[2].Content != "hello" {
		t.Errorf("order not preserved: %+v", got)
	}
}

func TestLoadSystemPrompt(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "p.txt")
	if err := os.WriteFile(p, []byte("  be helpful  \n"), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := LoadSystemPrompt(p)
	if err != nil {
		t.Fatalf("LoadSystemPrompt: %v", err)
	}
	if s != "be helpful" {
		t.Errorf("got %q, want trimmed", s)
	}
	if _, err := LoadSystemPrompt(filepath.Join(dir, "missing.txt")); err == nil {
		t.Error("expected error for missing file")
	}
}
```

- [ ] **Step 3: Run it and watch it fail**

Run from `backend/`: `go test ./internal/chat/ -v`
Expected: FAIL (package/functions don't exist).

- [ ] **Step 4: Implement the package**

Create `backend/internal/chat/chat.go`:

```go
// Package chat proxies prompt-only chat completions to OpenAI. No RAG, no tools.
package chat

import (
	"context"
	"os"
	"strings"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

// Roles a client may send. The system prompt is injected server-side only.
const (
	RoleUser      = "user"
	RoleAssistant = "assistant"
)

const defaultMaxTokens = 800

// Message is one chat turn.
type Message struct {
	Role    string
	Content string
}

// Streamer streams an assistant reply token-by-token. onDelta is called per
// content chunk; returning an error from onDelta (e.g. client disconnected)
// aborts the stream.
type Streamer interface {
	StreamChat(ctx context.Context, messages []Message, onDelta func(string) error) error
}

// assembleMessages prepends the system prompt to the conversation.
func assembleMessages(systemPrompt string, msgs []Message) []Message {
	out := make([]Message, 0, len(msgs)+1)
	out = append(out, Message{Role: "system", Content: systemPrompt})
	return append(out, msgs...)
}

// LoadSystemPrompt reads and trims the prompt file. Errors if unreadable.
func LoadSystemPrompt(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

// OpenAIClient implements Streamer via the official openai-go SDK.
type OpenAIClient struct {
	client       openai.Client
	model        string
	systemPrompt string
	maxTokens    int64
}

// New builds a streaming client. Caller ensures apiKey and systemPrompt are set.
func New(apiKey, model, systemPrompt string) *OpenAIClient {
	return &OpenAIClient{
		client:       openai.NewClient(option.WithAPIKey(apiKey)),
		model:        model,
		systemPrompt: systemPrompt,
		maxTokens:    defaultMaxTokens,
	}
}

// StreamChat calls OpenAI with streaming enabled and forwards content deltas.
func (c *OpenAIClient) StreamChat(ctx context.Context, messages []Message, onDelta func(string) error) error {
	all := assembleMessages(c.systemPrompt, messages)
	params := openai.ChatCompletionNewParams{
		Model:               openai.ChatModel(c.model),
		MaxCompletionTokens: openai.Int(c.maxTokens),
		Messages:            make([]openai.ChatCompletionMessageParamUnion, 0, len(all)),
	}
	for _, m := range all {
		switch m.Role {
		case "system":
			params.Messages = append(params.Messages, openai.SystemMessage(m.Content))
		case RoleAssistant:
			params.Messages = append(params.Messages, openai.AssistantMessage(m.Content))
		default:
			params.Messages = append(params.Messages, openai.UserMessage(m.Content))
		}
	}

	stream := c.client.Chat.Completions.NewStreaming(ctx, params)
	for stream.Next() {
		evt := stream.Current()
		if len(evt.Choices) == 0 {
			continue
		}
		if delta := evt.Choices[0].Delta.Content; delta != "" {
			if err := onDelta(delta); err != nil {
				return err
			}
		}
	}
	return stream.Err()
}

var _ Streamer = (*OpenAIClient)(nil)
```

> Note: `MaxCompletionTokens` is the current SDK field; if the installed `openai-go/v3` version still uses `MaxTokens`, switch to that. `openai.Int(...)` returns the param option type for either.

- [ ] **Step 5: Run tests + vet**

Run from `backend/`: `go test ./internal/chat/ -v && go vet ./internal/chat/`
Expected: PASS, no vet errors.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/chat/ backend/go.mod backend/go.sum
git commit -m "feat(chat): OpenAI streaming client + prompt loader"
```

---

### Task 4: `POST /api/chat` streaming handler

**Files:**
- Create: `backend/internal/httpapi/chat_handler.go`
- Test: `backend/internal/httpapi/chat_handler_test.go`
- Modify: `backend/internal/httpapi/middleware.go` (add `Chat` to `Deps`)
- Modify: `backend/internal/httpapi/ratelimit.go` (add `chatRate`/`chatBurst`)
- Modify: `backend/internal/httpapi/router.go` (register route)

- [ ] **Step 1: Add `Chat` to `Deps`**

In `backend/internal/httpapi/middleware.go`, add the import `"github.com/sayonetech/worldcup-predictor/backend/internal/chat"` and add this field to the `Deps` struct (after `Celebrations`):

```go
	Chat               chat.Streamer
```

- [ ] **Step 2: Write the failing handler test**

Create `backend/internal/httpapi/chat_handler_test.go`:

```go
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
```

- [ ] **Step 3: Run it and watch it fail**

Run from `backend/`: `go test ./internal/httpapi/ -run TestPostChat -v`
Expected: FAIL (compile error — `PostChat` undefined).

- [ ] **Step 4: Implement the handler**

Create `backend/internal/httpapi/chat_handler.go`:

```go
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
	if _, ok := userFromContext(r.Context()); !ok {
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

	if err := d.Chat.StreamChat(r.Context(), msgs, onDelta); err != nil {
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
```

> Deviation from spec §5.3: once SSE headers are sent (200), a mid-stream OpenAI error is reported as an `event: error` frame rather than a 5xx (the status line is already committed). Pre-stream failures (nil `Chat`, validation) still return proper 4xx/503.

- [ ] **Step 5: Run handler tests**

Run from `backend/`: `go test ./internal/httpapi/ -run 'TestPostChat|TestValidateChatMessages' -v`
Expected: PASS.

- [ ] **Step 6: Add the chat rate limiter**

In `backend/internal/httpapi/ratelimit.go`, add to the `const (...)` rate block (next to `writeRate`/`writeBurst`):

```go
	chatRate  = rate.Limit(20.0 / 60.0) // ~20/min per user (bounds OpenAI spend)
	chatBurst = 5
```

- [ ] **Step 7: Register the route**

In `backend/internal/httpapi/router.go`, inside `NewRouter`, add after `writeLimiter := newKeyedLimiter(writeRate, writeBurst)`:

```go
	chatLimiter := newKeyedLimiter(chatRate, chatBurst)
```

And inside the `priv` group (e.g. after the celebrations routes):

```go
				priv.With(rateLimitWrites(chatLimiter)).Post("/chat", d.PostChat)
```

- [ ] **Step 8: Build, vet, and run the package tests**

Run from `backend/`: `go build ./... && go vet ./internal/httpapi/ && go test ./internal/httpapi/ -v`
Expected: builds; all httpapi tests pass.

- [ ] **Step 9: Commit**

```bash
git add backend/internal/httpapi/
git commit -m "feat(chat): streaming POST /api/chat handler + rate limit"
```

---

### Task 5: Wire the chat client in `cmd/server`

**Files:**
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Construct the chat client and wire it into Deps**

In `backend/cmd/server/main.go`, add the import `"github.com/sayonetech/worldcup-predictor/backend/internal/chat"`. Then, just before the `deps := &httpapi.Deps{...}` literal, add:

```go
	// Chat assistant (optional). Enabled only when an API key and a readable
	// prompt file are both present; otherwise POST /api/chat returns 503.
	var chatClient chat.Streamer
	if cfg.OpenAIAPIKey != "" && cfg.OpenAISystemPromptFile != "" {
		prompt, err := chat.LoadSystemPrompt(cfg.OpenAISystemPromptFile)
		if err != nil {
			logger.Warn("chat disabled: cannot read OPENAI_SYSTEM_PROMPT_FILE", "path", cfg.OpenAISystemPromptFile, "err", err)
		} else {
			chatClient = chat.New(cfg.OpenAIAPIKey, cfg.OpenAIModel, prompt)
			logger.Info("chat assistant enabled", "model", cfg.OpenAIModel)
		}
	} else {
		logger.Info("chat assistant disabled (set OPENAI_API_KEY + OPENAI_SYSTEM_PROMPT_FILE to enable)")
	}
```

Add to the `deps := &httpapi.Deps{...}` literal (after `Celebrations: st,`):

```go
		Chat:               chatClient,
```

- [ ] **Step 2: Build + vet**

Run from `backend/`: `go build ./... && go vet ./...`
Expected: builds clean.

- [ ] **Step 3: Run the full backend suite**

Run from `backend/`: `go test ./...`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add backend/cmd/server/main.go
git commit -m "feat(chat): wire OpenAI chat client into the server"
```

---

### Task 6: Frontend streaming client (`lib/chat.ts`)

**Files:**
- Create: `frontend/src/lib/chat.ts`
- Test: `frontend/src/lib/chat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/chat.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { streamChat, ChatUnavailableError } from "./chat";

function streamFrom(chunks: string[]) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    getReader() {
      return {
        read() {
          if (i < chunks.length) {
            return Promise.resolve({ value: enc.encode(chunks[i++]), done: false });
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("streamChat", () => {
  it("parses SSE data frames into ordered tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: streamFrom([`data: "Hel"\n\n`, `data: "lo"\n\n`, "data: [DONE]\n\n"]),
      }),
    );
    const tokens: string[] = [];
    await streamChat([{ role: "user", content: "hi" }], (t) => tokens.push(t));
    expect(tokens).toEqual(["Hel", "lo"]);
  });

  it("throws ChatUnavailableError on 503", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, body: null }));
    await expect(
      streamChat([{ role: "user", content: "hi" }], () => {}),
    ).rejects.toBeInstanceOf(ChatUnavailableError);
  });

  it("rejects on an error frame", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: streamFrom([`event: error\ndata: "boom"\n\n`]),
      }),
    );
    await expect(
      streamChat([{ role: "user", content: "hi" }], () => {}),
    ).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run from `frontend/`: `pnpm vitest run src/lib/chat.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/chat.ts`**

Create `frontend/src/lib/chat.ts`:

```ts
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** Thrown when the backend reports chat is not configured (503). */
export class ChatUnavailableError extends Error {
  constructor() {
    super("chat unavailable");
    this.name = "ChatUnavailableError";
  }
}

/**
 * POSTs the conversation to /api/chat and streams the reply, calling onToken
 * for each content delta. Resolves when the stream ends; rejects on error.
 */
export async function streamChat(
  messages: ChatMessage[],
  onToken: (delta: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (res.status === 503) throw new ChatUnavailableError();
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      handleFrame(frame, onToken);
    }
  }
}

function handleFrame(frame: string, onToken: (delta: string) => void) {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data = line.slice(5).trim();
  }
  if (!data || data === "[DONE]") return;
  const parsed = JSON.parse(data) as string;
  if (event === "error") throw new Error(parsed);
  onToken(parsed);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run from `frontend/`: `pnpm vitest run src/lib/chat.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/chat.ts frontend/src/lib/chat.test.ts
git commit -m "feat(chat): frontend SSE streaming client"
```

---

### Task 7: ChatWidget UI (Solid Stadium Card)

**Files:**
- Modify: `frontend/src/components/icons.tsx` (add `BallChatIcon`)
- Create: `frontend/src/styles/chat.css`
- Create: `frontend/src/components/ChatWidget.tsx`
- Test: `frontend/src/components/ChatWidget.test.tsx`
- Modify: `frontend/src/App.tsx` (mount widget)

- [ ] **Step 1: Add the football-chat icon**

Append to `frontend/src/components/icons.tsx`:

```tsx
export function BallChatIcon({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6.5l4.3 3.1-1.6 5H9.3l-1.6-5z" fill="currentColor" stroke="none" />
      <path d="M12 6.5V3.2M6.4 10.1 3.6 8.4M17.6 10.1l2.8-1.7M9 18.6l-1.4 2.6M15 18.6l1.4 2.6" />
    </svg>
  );
}
```

- [ ] **Step 2: Write the failing widget test**

Create `frontend/src/components/ChatWidget.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ChatWidget } from "./ChatWidget";
import * as chatLib from "../lib/chat";

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openPanel() {
  fireEvent.click(screen.getByLabelText(/open chat assistant/i));
}

describe("ChatWidget", () => {
  it("launcher opens and closes the panel", () => {
    render(<ChatWidget />);
    expect(screen.queryByPlaceholderText(/message/i)).toBeNull();
    openPanel();
    expect(screen.getByPlaceholderText(/message/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/close chat/i));
    expect(screen.queryByPlaceholderText(/message/i)).toBeNull();
  });

  it("sends a message and streams the assistant reply", async () => {
    vi.spyOn(chatLib, "streamChat").mockImplementation(async (_msgs, onToken) => {
      onToken("Hi ");
      onToken("there");
    });
    render(<ChatWidget />);
    openPanel();
    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "hello" } });
    fireEvent.click(screen.getByLabelText(/send message/i));
    expect(await screen.findByText("hello")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Hi there")).toBeInTheDocument());
  });

  it("persists history in sessionStorage across remount", async () => {
    vi.spyOn(chatLib, "streamChat").mockImplementation(async (_m, onToken) => onToken("yo"));
    const { unmount } = render(<ChatWidget />);
    openPanel();
    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "ping" } });
    fireEvent.click(screen.getByLabelText(/send message/i));
    await screen.findByText("yo");
    unmount();
    render(<ChatWidget />);
    openPanel();
    expect(screen.getByText("ping")).toBeInTheDocument();
    expect(screen.getByText("yo")).toBeInTheDocument();
  });

  it("Clear chat empties the conversation", async () => {
    vi.spyOn(chatLib, "streamChat").mockImplementation(async (_m, onToken) => onToken("yo"));
    render(<ChatWidget />);
    openPanel();
    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "ping" } });
    fireEvent.click(screen.getByLabelText(/send message/i));
    await screen.findByText("yo");
    fireEvent.click(screen.getByLabelText(/clear chat/i));
    expect(screen.queryByText("ping")).toBeNull();
  });

  it("shows an unavailable notice on 503", async () => {
    vi.spyOn(chatLib, "streamChat").mockRejectedValue(new chatLib.ChatUnavailableError());
    render(<ChatWidget />);
    openPanel();
    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "hi" } });
    fireEvent.click(screen.getByLabelText(/send message/i));
    expect(await screen.findByText(/assistant is unavailable/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run from `frontend/`: `pnpm vitest run src/components/ChatWidget.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `ChatWidget.tsx`**

Create `frontend/src/components/ChatWidget.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { streamChat, ChatUnavailableError, type ChatMessage } from "../lib/chat";
import { BallChatIcon } from "./icons";
import "../styles/chat.css";

const STORAGE_KEY = "saxone_chat";

function loadHistory(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Persist history (session-only).
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  // Focus the input when opening; auto-scroll on new content.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, streaming]);

  function close() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  function clearChat() {
    setMessages([]);
    setError(null);
  }

  async function send() {
    const text = draft.trim();
    if (!text || streaming) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setError(null);
    setStreaming(true);
    // Append an empty assistant message we grow as tokens arrive.
    setMessages((m) => [...m, { role: "assistant", content: "" }]);
    try {
      await streamChat(next, (delta) => {
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = {
            role: "assistant",
            content: copy[copy.length - 1].content + delta,
          };
          return copy;
        });
      });
    } catch (e) {
      // Drop the empty/partial assistant bubble and surface an error.
      setMessages((m) => (m[m.length - 1]?.content ? m : m.slice(0, -1)));
      setError(
        e instanceof ChatUnavailableError
          ? "The assistant is unavailable right now."
          : "Something went wrong. Please try again.",
      );
    } finally {
      setStreaming(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") close();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  if (!open) {
    return (
      <button
        ref={launcherRef}
        type="button"
        className="chat-launcher"
        aria-label="Open chat assistant"
        onClick={() => setOpen(true)}
      >
        <BallChatIcon />
      </button>
    );
  }

  return (
    <div className="chat-panel" role="dialog" aria-label="SayScore Assistant" onKeyDown={onKeyDown}>
      <header className="chat-head">
        <span className="chat-ava"><BallChatIcon size={18} /></span>
        <span className="chat-headtext">
          <span className="chat-title">SayScore Assistant</span>
          <span className="chat-status"><span className="chat-dot" />online</span>
        </span>
        <button type="button" className="chat-iconbtn" aria-label="Clear chat" onClick={clearChat}>Clear</button>
        <button type="button" className="chat-iconbtn" aria-label="Close chat" onClick={close}>✕</button>
      </header>

      <div className="chat-body" ref={bodyRef}>
        {messages.length === 0 && (
          <div className="chat-empty">Ask me anything about World Cup 2026 or how SayScore works. ⚽</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role === "user" ? "me" : "bot"}`}>
            {m.content || (streaming && i === messages.length - 1 ? (
              <span className="chat-typing" aria-label="Assistant is typing"><i /><i /><i /></span>
            ) : null)}
          </div>
        ))}
        {error && <div className="chat-error" role="alert">{error}</div>}
      </div>

      <div className="chat-foot">
        <input
          ref={inputRef}
          className="chat-input"
          placeholder="Message…"
          value={draft}
          disabled={streaming}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Message the assistant"
        />
        <button
          type="button"
          className="chat-send"
          aria-label="Send message"
          disabled={streaming || !draft.trim()}
          onClick={() => void send()}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
            <path d="M3 11l18-8-8 18-2-7-8-3z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add the styles**

Create `frontend/src/styles/chat.css` (Direction B — Solid Stadium Card; tokens from `tokens.css`):

```css
.chat-launcher {
  position: fixed; right: 18px; bottom: 18px; z-index: 60;
  width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
  display: grid; place-items: center; color: #fff;
  background: var(--accent-grad);
  box-shadow: 0 12px 26px -8px var(--coral-ring), 0 4px 10px -4px #000;
  transition: transform .15s ease, box-shadow .15s ease;
}
.chat-launcher:hover { transform: translateY(-2px); }
.chat-launcher:focus-visible { outline: none; box-shadow: var(--focus-ring), 0 12px 26px -8px var(--coral-ring); }
.chat-launcher:active { transform: translateY(0); }

.chat-panel {
  position: fixed; right: 18px; bottom: 18px; z-index: 60;
  width: min(360px, calc(100vw - 32px)); height: min(520px, calc(100vh - 120px));
  display: flex; flex-direction: column; overflow: hidden;
  border-radius: var(--r-lg); background: var(--surface);
  border: 1px solid var(--line); box-shadow: 0 24px 50px -22px #000;
}
.chat-head {
  display: flex; align-items: center; gap: 10px; padding: 13px 12px;
  background: var(--accent-grad); color: #fff;
}
.chat-ava { width: 30px; height: 30px; border-radius: 9px; flex: none;
  display: grid; place-items: center; background: rgba(255,255,255,.20); }
.chat-headtext { display: flex; flex-direction: column; line-height: 1.2; }
.chat-title { font-size: 14px; font-weight: 650; letter-spacing: -.01em; }
.chat-status { font-size: 11px; color: rgba(255,255,255,.85); display: flex; align-items: center; gap: 5px; }
.chat-dot { width: 6px; height: 6px; border-radius: 50%; background: #bfffcb; }
.chat-iconbtn {
  font: inherit; font-size: 12px; color: #fff; cursor: pointer;
  background: rgba(255,255,255,.16); border: none; border-radius: var(--r-pill);
  padding: 5px 10px; line-height: 1;
}
.chat-iconbtn:last-child { margin-left: 2px; padding: 5px 9px; }
.chat-iconbtn:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }

.chat-body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 9px; }
.chat-empty { color: var(--text-3); font-size: 13px; margin: auto 4px; text-align: center; }
.chat-msg { max-width: 84%; padding: 9px 12px; font-size: 13px; line-height: 1.4; word-wrap: break-word; }
.chat-msg.bot { align-self: flex-start; background: var(--surface-2); color: var(--text); border-radius: 14px 14px 14px 4px; }
.chat-msg.me  { align-self: flex-end;   background: var(--brand);     color: #fff;        border-radius: 14px 14px 4px 14px; }
.chat-error { align-self: stretch; color: var(--danger-fg); background: var(--danger-bg);
  border: 1px solid var(--danger-border); border-radius: var(--r-sm); padding: 8px 10px; font-size: 12.5px; }

.chat-typing { display: inline-flex; gap: 4px; padding: 2px 0; }
.chat-typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3);
  display: block; animation: chat-bb 1.1s infinite ease-in-out; }
.chat-typing i:nth-child(2) { animation-delay: .15s; }
.chat-typing i:nth-child(3) { animation-delay: .3s; }
@keyframes chat-bb { 0%,80%,100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }

.chat-foot { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--hairline, rgba(255,255,255,.07)); }
.chat-input { flex: 1; height: 38px; border-radius: var(--r-pill); padding: 0 14px;
  background: var(--bg-2); color: var(--text); border: 1px solid var(--line); font: inherit; font-size: 13px; }
.chat-input::placeholder { color: var(--text-3); }
.chat-input:focus-visible { outline: none; box-shadow: var(--focus-ring); border-color: var(--brand); }
.chat-input:disabled { opacity: .6; }
.chat-send { width: 38px; height: 38px; border-radius: 50%; flex: none; border: none; cursor: pointer;
  display: grid; place-items: center; color: #fff; background: var(--accent-grad);
  box-shadow: 0 6px 16px -6px var(--coral-ring); }
.chat-send:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
.chat-send:focus-visible { outline: none; box-shadow: var(--focus-ring); }

@media (prefers-reduced-motion: reduce) {
  .chat-launcher, .chat-send { transition: none; }
  .chat-typing i { animation: none; opacity: .6; }
}
```

> If `--hairline`, `--bg-2`, `--text-3`, or `--danger-*` differ in `tokens.css`, use the actual token names — confirm against `frontend/src/styles/tokens.css` (they exist there).

- [ ] **Step 6: Mount the widget in `App.tsx`**

In `frontend/src/App.tsx`, add the import near the other component imports:

```tsx
import { ChatWidget } from "./components/ChatWidget";
```

And render it inside the authenticated-shell fragment, right after the `{activeCelebration && (…)}` block (before the closing `</>`):

```tsx
      <ChatWidget />
```

- [ ] **Step 7: Run the widget tests + type-check**

Run from `frontend/`: `pnpm vitest run src/components/ChatWidget.test.tsx && pnpm tsc --noEmit`
Expected: all widget tests pass; type-check clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ChatWidget.tsx frontend/src/components/ChatWidget.test.tsx frontend/src/components/icons.tsx frontend/src/styles/chat.css frontend/src/App.tsx
git commit -m "feat(chat): Solid Stadium Card chat widget"
```

---

### Task 8: Docs, env, and final verification

**Files:**
- Modify: `docs/REQUIREMENTS.md`
- Modify: `README.md`
- Modify: `frontend/.env.example` (already cleaned in Task 1; nothing to add — chat env is backend-only)

- [ ] **Step 1: Update REQUIREMENTS.md**

Add a "Chat assistant" subsection under §3 describing: a prompt-only OpenAI assistant; bottom-right launcher; streaming `POST /api/chat` (auth-gated, rate-limited); session-only frontend history; no DB; the system prompt is loaded from `OPENAI_SYSTEM_PROMPT_FILE`. Add `POST /api/chat` to the API surface (§11) and `OPENAI_API_KEY` / `OPENAI_SYSTEM_PROMPT_FILE` / `OPENAI_MODEL` to the env-var list (§14). Remove any MadCrow mention if present.

- [ ] **Step 2: Update README.md**

Where the MadCrow section was removed (Task 1), add a short "## Chat assistant" section: it's an OpenAI prompt-only assistant; set `OPENAI_API_KEY`, point `OPENAI_SYSTEM_PROMPT_FILE` at a text file with the system prompt, optionally set `OPENAI_MODEL` (default `gpt-4o-mini`); leaving the key blank disables chat (503). Note history is session-only (no DB).

- [ ] **Step 3: Full backend suite**

Run from `backend/`: `go build ./... && go vet ./... && go test ./...`
Expected: all pass.

- [ ] **Step 4: Full frontend suite**

Run from `frontend/`: `pnpm tsc --noEmit && pnpm vitest run && pnpm build`
Expected: type-check clean, all tests pass, build succeeds.

- [ ] **Step 5: Spec-compliance sweep**

Confirm: no `madcrow`/`MADCROW` anywhere (`grep -rin madcrow . --exclude-dir=node_modules --exclude-dir=.git` → empty); `POST /api/chat` is in the `RequireAuth` group; the system prompt is never read from the request body; chat is disabled (503) when unconfigured.

- [ ] **Step 6: Commit**

```bash
git add docs/REQUIREMENTS.md README.md
git commit -m "docs: chat assistant in REQUIREMENTS + README; retire MadCrow"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** MadCrow removal (T1), config (T2), `internal/chat` SDK client + prompt file (T3), streaming `POST /api/chat` + auth + rate limit + validation + last-20 + 503 (T4), wiring/disable-when-unconfigured (T5), frontend streaming client (T6), Solid Stadium Card widget + sessionStorage + clear + error/unavailable + a11y (T7), docs/REQUIREMENTS/README (T8). ✓
- **Deviations noted inline:** (a) mid-stream OpenAI errors arrive as an SSE `event: error` frame, not a 5xx, because the 200 status is already committed; pre-stream failures remain 4xx/503. (b) The launcher always renders and surfaces "unavailable" in-panel on 503 (spec §4 allowed "hide or show unavailable state").
- **SDK caveat flagged:** `MaxCompletionTokens` vs `MaxTokens` field name depends on the installed `openai-go/v3` version — the implementer adjusts if the build complains.
- **Type consistency:** `chat.Message{Role,Content}`, `Streamer.StreamChat(ctx, []Message, func(string) error)`, `Deps.Chat chat.Streamer`, frontend `ChatMessage{role,content}`, `streamChat(messages, onToken, signal?)` are consistent across backend, frontend, and tests.
- **Server write-deadline:** handled via `http.NewResponseController(w).SetWriteDeadline(time.Time{})` so the 15s `WriteTimeout` doesn't truncate streams.
