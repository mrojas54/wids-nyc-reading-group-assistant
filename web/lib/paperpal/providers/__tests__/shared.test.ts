// Tests for the request plumbing claude.ts and gemini.ts share.
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateHint } from "../index";
import {
  postJson,
  requireEnvKey,
  toHintResult,
  toSocraticResult,
} from "../shared";
import type { ProviderMeta } from "../types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const meta: ProviderMeta = {
  provider: "claude",
  model: "m",
  durationMs: 1,
  inputTokens: null,
  outputTokens: null,
};

function respondWith(body: string, init: ResponseInit) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, init));
}

describe("requireEnvKey", () => {
  it("reads the key from process.env", () => {
    vi.stubEnv("SOME_KEY", "abc");
    expect(requireEnvKey("SOME_KEY")).toBe("abc");
  });

  it("names the missing variable", () => {
    vi.stubEnv("SOME_KEY", "");
    expect(() => requireEnvKey("SOME_KEY")).toThrow("SOME_KEY not set");
  });
});

describe("postJson", () => {
  it("sends a JSON POST with the given headers and signal", async () => {
    const fetchSpy = respondWith('{"ok":true}', { status: 200 });
    const signal = new AbortController().signal;
    const { json } = await postJson<{ ok: boolean; error?: { message?: string } }>("gemini", "https://x.test/", {
      headers: { "Content-Type": "application/json" },
      body: { a: 1 },
      signal,
    });
    expect(json.ok).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://x.test/");
    expect(init).toMatchObject({ method: "POST", body: '{"a":1}', signal });
  });

  it("throws the provider's error message", async () => {
    respondWith('{"error":{"message":"overloaded"}}', { status: 529 });
    await expect(
      postJson("claude", "https://x.test/", { headers: {}, body: {} }),
    ).rejects.toThrow("claude 529: overloaded");
  });

  it("throws on an error field even with a 200", async () => {
    respondWith('{"error":{"message":"bad"}}', { status: 200 });
    await expect(
      postJson("gemini", "https://x.test/", { headers: {}, body: {} }),
    ).rejects.toThrow("gemini 200: bad");
  });

  it("reports the status when an error page is not JSON", async () => {
    respondWith("<html>Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" });
    await expect(
      postJson("claude", "https://x.test/", { headers: {}, body: {} }),
    ).rejects.toThrow("claude 502: Bad Gateway");
  });

  it("says so when a 200 response is not JSON", async () => {
    respondWith("not json", { status: 200 });
    await expect(
      postJson("gemini", "https://x.test/", { headers: {}, body: {} }),
    ).rejects.toThrow("gemini 200: response was not JSON");
  });
});

describe("result shaping", () => {
  it("keeps low and high confidence and turns anything else into medium", () => {
    expect(toHintResult('{"hint":"h","confidence":"low"}', meta, "c").confidence).toBe("low");
    expect(toHintResult('{"hint":"h","confidence":"high"}', meta, "c").confidence).toBe("high");
    expect(toHintResult('{"hint":"h"}', meta, "c").confidence).toBe("medium");
  });

  it("names the provider when a field is missing", () => {
    expect(() => toHintResult("{}", meta, "c")).toThrow("claude hint missing 'hint' field");
    expect(() => toSocraticResult("{}", { ...meta, provider: "gemini" }, "c")).toThrow(
      "gemini socratic missing 'nextQuestion'",
    );
  });

  it("puts the raw text in the error when the model's JSON is malformed", () => {
    expect(() => toSocraticResult("Sure! {", meta, "claudeSocratic")).toThrow(
      /claudeSocratic: JSON.parse failed .* raw\[0:500\]: Sure! \{/,
    );
  });
});

describe.each(["gemini", "claude"] as const)("%s through the shared helper", (provider) => {
  it("reports a gateway's HTML 502 with the status", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    respondWith("<html>Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" });
    await expect(
      generateHint({ paperTitle: "T", questionText: "Q", userAnswer: "A" }, { provider }),
    ).rejects.toThrow(`${provider} 502: Bad Gateway`);
  });
});
