# SayScore — Chat Assistant (OpenAI, prompt-only) — Design Spec

**Date:** 2026-06-22
**Branch (planned):** `feat/chat-assistant` (off `main`)
**Status:** Approved in brainstorming; ready for implementation plan.

## 1. Overview

Replace the third-party **MadCrow** chatbot widget with a first-party **OpenAI-powered chat
assistant**. It is **prompt-only** — no RAG, no tool calls — answering from a configurable system
prompt. A floating, World-Cup-themed launcher sits at the **bottom-right** of the authenticated app;
clicking it opens a chat panel. The assistant **streams** its reply (typing effect). Conversation
history is **session-only on the frontend** (`sessionStorage`); **no database** is involved.

The OpenAI API key is a secret, so the browser never talks to OpenAI directly: a thin **Go backend
endpoint** (`POST /api/chat`) holds the key + system prompt and proxies the streamed completion to
the client. The endpoint is **stateless** (no persistence).

## 2. Goals / Non-goals

**Goals**
- Remove the MadCrow widget completely (script, env var, build args, CI secret, README).
- A Go streaming proxy `POST /api/chat` that injects a configurable system prompt and streams an
  OpenAI chat completion back to the browser as SSE.
- A floating WC-themed chat launcher + panel, session-only history, live token streaming.
- Configurable via env (no code change to retune): API key, model, and the (~200-line) system
  **prompt file**.

**Non-goals (YAGNI)**
- No RAG, no tools/function-calling, no per-user memory, no DB persistence, no admin UI for the
  prompt (it's an env-configured file).
- No multi-assistant / threads. One assistant, one session conversation per browser tab.
- No analytics/logging of chat content beyond ordinary error logging.

## 3. Remove MadCrow

Delete every MadCrow reference (grep `madcrow`/`MADCROW`):
- `frontend/index.html` — the `<script src="…madcrow…widget.bundle.js" …>` block.
- `frontend/.env.example`, root `.env.example`, `.env.prod.example` — `VITE_MADCROW_ASSISTANT_ID` lines/comments.
- `frontend/Dockerfile`, `frontend/Dockerfile.prod` — `ARG`/`ENV VITE_MADCROW_ASSISTANT_ID`.
- `deploy/docker-compose.yml` — the `VITE_MADCROW_ASSISTANT_ID` build arg.
- `.github/workflows/deploy-ecr.yml` — the `VITE_MADCROW_ASSISTANT_ID=${{ secrets.… }}` build-arg line.
- `README.md` — the "MadCrow chatbot widget" section (replace with a short "Chat assistant" note).

## 4. Behavior & constraints

- The system prompt is **server-injected** and never accepted from the client. The browser sends
  only the `user`/`assistant` turns.
- **Auth-gated:** `POST /api/chat` is behind `RequireAuth` (internal app, signed-in employees only).
- **Cost/abuse guards:** a **per-user rate limit** on the chat route; the backend forwards only the
  **last 20 messages**; a `max_tokens` cap (~800) on the completion.
- **Unconfigured → disabled:** if `OPENAI_API_KEY` is empty or the prompt file is missing/unreadable
  at boot, the app still starts but `POST /api/chat` returns **503** and the frontend launcher hides
  (or shows a "chat unavailable" state). Config errors are logged at boot, never fatal.
- **History is session-only** (`sessionStorage`): survives reloads within the tab, clears on tab
  close.

## 5. Backend

### 5.1 Config (`internal/config`)
Add (via the existing `getenv` pattern):
- `OpenAIAPIKey` ← `OPENAI_API_KEY` (default `""`).
- `OpenAISystemPromptFile` ← `OPENAI_SYSTEM_PROMPT_FILE` (default `""`).
- `OpenAIModel` ← `OPENAI_MODEL` (default `gpt-4o-mini`).

`cmd/server/main.go` reads the prompt file at boot (`os.ReadFile`). If the key is set **and** the
file reads, it constructs the chat client and wires it into `Deps.Chat`; otherwise `Deps.Chat` is
`nil` (chat disabled) and a warning is logged.

### 5.2 `internal/chat` package
Decouples the HTTP layer from the OpenAI SDK so handlers are testable with a fake.

```go
type Message struct { Role string; Content string } // role: "user" | "assistant"

// Streamer streams an assistant reply token-by-token. onDelta is called for each
// content chunk; returning an error from onDelta (e.g. client disconnected) aborts.
type Streamer interface {
    StreamChat(ctx context.Context, messages []Message, onDelta func(string) error) error
}
```

- `OpenAIClient` implements `Streamer` using the **official `github.com/openai/openai-go` SDK**'s
  streaming chat completions. It prepends a `system` message (the loaded prompt), maps `messages`
  to the SDK's params (model = `OpenAIModel`, `max_tokens` cap), opens the stream, and calls
  `onDelta` per content delta.
- `New(apiKey, model, systemPrompt string) *OpenAIClient`.
- The exact SDK call (`client.Chat.Completions.NewStreaming(...)` etc.) is grounded against current
  `openai-go` docs during implementation (SDK signatures change); the interface above is the stable
  contract the handler/tests depend on.

### 5.3 Handler `POST /api/chat` (`internal/httpapi`)
- `Deps` gains `Chat chat.Streamer` (nil ⇒ disabled).
- Registered in the `RequireAuth` group with a per-user **chat rate limiter** (mirrors the existing
  write-limiter middleware).
- Request body: `{ "messages": [ { "role": "user"|"assistant", "content": "…" } ] }`.
- Validation → `400`: empty/oversized body (the existing `maxBodyBytes` guard applies), no messages,
  a role other than user/assistant, or empty content. Trims to the **last 20** messages.
- If `d.Chat == nil` → `503 {"error":"chat unavailable"}`.
- On success: set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`;
  obtain the `http.Flusher`; call `StreamChat`, writing each delta as an SSE frame and flushing:
  - delta → `data: <delta-as-JSON-string>\n\n`
  - done → `data: [DONE]\n\n`
  - mid-stream error → `event: error\ndata: <message>\n\n`
  (Encoding each delta as a JSON string keeps newlines/`data:` safe across SSE framing.)
- If streaming hasn't started yet and OpenAI errors, return a normal `502`/`503` JSON error instead
  of an SSE frame.

## 6. Frontend

### 6.1 `lib/chat.ts`
```ts
export type ChatMessage = { role: "user" | "assistant"; content: string };

// POSTs to /api/chat (credentials: "include"), reads response.body (ReadableStream),
// parses SSE `data:`/`event: error` frames, and calls onToken(delta) per chunk.
// Resolves when the stream ends ([DONE]); rejects on error/non-2xx.
export async function streamChat(
  messages: ChatMessage[],
  onToken: (delta: string) => void,
  signal?: AbortSignal,
): Promise<void>;
```
Uses `fetch` + `response.body.getReader()` + `TextDecoder` (EventSource can't POST). Surfaces a
`ChatUnavailableError` on 503 so the UI can hide/disable.

### 6.2 `components/ChatWidget.tsx`

**Visual direction (chosen in brainstorming): "Solid Stadium Card."** Opaque panel on `--surface`
(`#1c1c1e`) with a `--line` border and `--r-lg` (20px) radius; a **brand-gradient header banner**
(`--accent-grad`, white text) carrying the football mark, title, green "online" dot, and close;
neutral assistant bubbles on `--surface-2`, the user's bubble in solid `--brand`; a pill input with
a solid-blue circular send button. The **launcher** is a solid blue-gradient circle (`--accent-grad`)
with a **white football mark**, fixed bottom-right.

- **Launcher:** a fixed, bottom-right round button with the **World-Cup football mark** (white on the
  blue gradient), `aria-label="Open chat assistant"`, ≥44px target, brand styling per §7.
- **Panel:** header (title + close), a scrollable message list (user/assistant
  bubbles, a typing indicator while streaming), and an input row (textarea + Send). Opens/closes
  from the launcher; Escape closes; focus moves into the input on open and back to the launcher on
  close.
- **State:** `messages` persisted in `sessionStorage` (key `saxone_chat`); `open`, `streaming`,
  `error` in React state. On send: append the user message, then a new assistant message whose
  `content` grows as `streamChat`'s `onToken` fires. Input/Send disabled while streaming; an error
  shows an inline message + Retry. If chat is unavailable (503), the launcher is hidden.
- **Mount:** in `App.tsx`'s authenticated shell, alongside `VictoryCelebration` / `HowToPlayModal`.
- **§7 compliance:** dark tokens, all interactive states (hover/focus-ring/active/disabled/loading/
  error), `prefers-reduced-motion` for the typing/entrance motion, a11y throughout.

## 7. File structure

**Backend**
- Modify: `backend/internal/config/config.go` (3 fields)
- Create: `backend/internal/chat/chat.go` (Message, Streamer, OpenAIClient)
- Create: `backend/internal/httpapi/chat_handler.go` (`PostChat`)
- Modify: `backend/internal/httpapi/middleware.go` (`Deps.Chat`), `router.go` (route + chat limiter),
  `backend/cmd/server/main.go` (load prompt file, wire `Chat`)
- `backend/go.mod` / `go.sum` — add `github.com/openai/openai-go`

**Frontend**
- Create: `frontend/src/lib/chat.ts`, `frontend/src/components/ChatWidget.tsx`,
  `frontend/src/styles/chat.css` (or tokens.css additions), a WC chat icon in `components/icons.tsx`
- Modify: `frontend/src/App.tsx` (mount `ChatWidget`), `frontend/index.html` (remove MadCrow script)

**Config/build/docs**
- Modify: `frontend/.env.example`, `.env.example`, `.env.prod.example` (drop MadCrow; add
  `OPENAI_*` to backend examples), `frontend/Dockerfile`, `frontend/Dockerfile.prod`,
  `deploy/docker-compose.yml`, `.github/workflows/deploy-ecr.yml` (drop MadCrow build arg/secret),
  `README.md`, `docs/REQUIREMENTS.md`

## 8. Testing

**Backend**
- Handler tests with a **fake `chat.Streamer`** that emits canned deltas: SSE output contains the
  deltas + `[DONE]`; `401` unauthenticated; `503` when `Chat` is nil; `400` on empty/invalid body
  and bad roles; the last-20-messages trim is applied; the per-user rate limit triggers.
- A small unit test that the handler JSON-encodes deltas so newlines/`data:` in a delta don't break
  SSE framing.

**Frontend (Vitest)**
- `streamChat` parses a mocked `ReadableStream` of SSE frames → ordered `onToken` calls; 503 →
  `ChatUnavailableError`.
- `ChatWidget`: launcher opens/closes the panel; sending appends a user message then streams an
  assistant reply (mocked `streamChat`); `sessionStorage` persists across remount; error state shows Retry; launcher has its `aria-label` and is hidden when chat is unavailable.

## 9. Docs

- `docs/REQUIREMENTS.md`: new "Chat assistant" subsection (§3.x) — prompt-only OpenAI assistant,
  auth-gated streaming `POST /api/chat`, session-only history, no DB, env-configured prompt;
  add the endpoint to §11 and `OPENAI_API_KEY` / `OPENAI_SYSTEM_PROMPT_FILE` / `OPENAI_MODEL` to the
  §14 env-var list; remove the MadCrow mention.
- `README.md`: replace the MadCrow section with chat-assistant setup (the three env vars + where the
  prompt file lives).
