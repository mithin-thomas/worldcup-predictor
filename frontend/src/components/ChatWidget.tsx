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
    const el = bodyRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages, streaming]);

  function close() {
    setOpen(false);
    launcherRef.current?.focus();
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
        <span className="chat-ava">
          <BallChatIcon size={18} />
        </span>
        <span className="chat-headtext">
          <span className="chat-title">SayScore Assistant</span>
          <span className="chat-status">
            <span className="chat-dot" />
            online
          </span>
        </span>
        <button type="button" className="chat-close" aria-label="Close chat" onClick={close}>
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="chat-body" ref={bodyRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            Ask me anything about World Cup 2026 or how SayScore works. ⚽
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role === "user" ? "me" : "bot"}`}>
            {m.content ||
              (streaming && i === messages.length - 1 ? (
                <span className="chat-typing" aria-label="Assistant is typing">
                  <i />
                  <i />
                  <i />
                </span>
              ) : null)}
          </div>
        ))}
        {error && (
          <div className="chat-error" role="alert">
            {error}
          </div>
        )}
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
