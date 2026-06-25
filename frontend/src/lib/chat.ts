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
