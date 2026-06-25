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
