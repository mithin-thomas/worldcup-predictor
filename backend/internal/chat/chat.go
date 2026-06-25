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

// UserInfo is the per-request identity of the signed-in user. Its values are
// substituted into the system prompt via {{user_name}} / {{user_first_name}}
// placeholders so the assistant can address (and roast) the user by name.
type UserInfo struct {
	Name string
}

// userNameFallback fills the name placeholders when the user has no display name.
const userNameFallback = "there"

// firstName returns the first whitespace-separated token of a display name.
func firstName(name string) string {
	if f := strings.Fields(name); len(f) > 0 {
		return f[0]
	}
	return ""
}

// interpolatePrompt substitutes the signed-in user's identity into the prompt
// template. Unknown placeholders are left untouched; a blank name falls back to
// "there" so "Hi {{user_name}}" still reads naturally.
func interpolatePrompt(template string, u UserInfo) string {
	full := strings.TrimSpace(u.Name)
	if full == "" {
		full = userNameFallback
	}
	first := firstName(u.Name)
	if first == "" {
		first = userNameFallback
	}
	out := strings.ReplaceAll(template, "{{user_name}}", full)
	return strings.ReplaceAll(out, "{{user_first_name}}", first)
}

// Streamer streams an assistant reply token-by-token. The signed-in user's
// identity is substituted into the system prompt before sending. onDelta is
// called per content chunk; returning an error from onDelta (e.g. client
// disconnected) aborts the stream.
type Streamer interface {
	StreamChat(ctx context.Context, user UserInfo, messages []Message, onDelta func(string) error) error
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
	temperature  float64
}

// New builds a streaming client. Caller ensures apiKey and systemPrompt are set.
// temperature (0–2) controls how playful/varied replies are; ~0.8–1.0 suits a
// sarcastic persona, lower is more deterministic.
func New(apiKey, model, systemPrompt string, temperature float64) *OpenAIClient {
	return &OpenAIClient{
		client:       openai.NewClient(option.WithAPIKey(apiKey)),
		model:        model,
		systemPrompt: systemPrompt,
		maxTokens:    defaultMaxTokens,
		temperature:  temperature,
	}
}

// StreamChat calls OpenAI with streaming enabled and forwards content deltas.
// The user's identity is substituted into the system prompt before sending.
func (c *OpenAIClient) StreamChat(ctx context.Context, user UserInfo, messages []Message, onDelta func(string) error) error {
	all := assembleMessages(interpolatePrompt(c.systemPrompt, user), messages)
	params := openai.ChatCompletionNewParams{
		Model:               openai.ChatModel(c.model),
		MaxCompletionTokens: openai.Int(c.maxTokens),
		Temperature:         openai.Float(c.temperature),
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
