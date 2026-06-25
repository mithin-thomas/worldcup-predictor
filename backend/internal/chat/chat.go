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
