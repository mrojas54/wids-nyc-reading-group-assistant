// Provider dispatch tests — verifies synthesizePaper / generateHint /
// nextSocraticTurn route to the right HTTP endpoint per opts.provider
// and parse the response correctly. Uses MSW to stub Gemini/Claude APIs
// + a local PDF blob server so we don't make real network calls.
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import {
  generateHint,
  nextSocraticTurn,
  synthesizePaper,
} from "../index";

const PDF_URL = "https://example.test/papers/42/abc.pdf";
const GEMINI_HOST = "https://generativelanguage.googleapis.com";
const CLAUDE_URL = "https://api.anthropic.com/v1/messages";

const FAKE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"

const validPayload = {
  title: "T",
  authors: ["A"],
  abstractBreakdown: "Short.",
  terminology: [{ term: "t", definition: "d", context: "c" }],
  mathExplanations: [],
  diagrams: [
    {
      id: "d",
      type: "flowchart",
      mermaidCode: "flowchart TD\nA-->B",
      description: "",
      nodes: [{ id: "A", label: "A", explanation: "x" }],
      significance: "s",
    },
  ],
  learningResources: [
    {
      title: "X",
      url: "https://example.test/x",
      category: "tutorial",
      type: "article",
      description: "d",
    },
  ],
  keyTakeaways: ["k"],
  assessmentQuiz: {
    title: "q",
    difficulty: "easy",
    questions: [
      { question: "q?", options: ["a", "b"], correctAnswerIndex: 0, explanation: "e" },
    ],
  },
};

const server = setupServer();

beforeAll(() => {
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.ANTHROPIC_API_KEY = "test-claude-key";
  server.listen({ onUnhandledRequest: "error" });
});
beforeEach(() => server.resetHandlers());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("synthesizePaper", () => {
  it("routes to Gemini and parses the structured payload", async () => {
    let receivedUrl = "";
    server.use(
      http.get(PDF_URL, () => HttpResponse.arrayBuffer(FAKE_PDF.buffer)),
      http.post(`${GEMINI_HOST}/v1beta/models/:model\\:generateContent`, ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(validPayload) }] } },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
        });
      }),
    );

    const result = await synthesizePaper(
      { pdfUrl: PDF_URL },
      { provider: "gemini" },
    );

    expect(result.meta.provider).toBe("gemini");
    expect(result.meta.inputTokens).toBe(10);
    expect(result.payload.title).toBe("T");
    // Verify Gemini was actually called (not Claude) and the API key
    // was forwarded. Deliberately NOT asserting the model string in the
    // URL — that would force a test edit on every routine model bump.
    expect(receivedUrl).toContain(GEMINI_HOST);
    expect(receivedUrl).toContain("key=test-gemini-key");
  });

  it("routes to Claude and parses the structured payload", async () => {
    let receivedAuth = "";
    let documentSourceType = "";
    server.use(
      http.get(PDF_URL, () => HttpResponse.arrayBuffer(FAKE_PDF.buffer)),
      http.post(CLAUDE_URL, async ({ request }) => {
        receivedAuth = request.headers.get("x-api-key") ?? "";
        const body = await request.json() as {
          messages: Array<{ content: Array<{ type: string; source?: { type: string } }> }>;
        };
        documentSourceType = body.messages[0].content.find((c) => c.type === "document")
          ?.source?.type ?? "";
        return HttpResponse.json({
          content: [{ type: "text", text: JSON.stringify(validPayload) }],
          usage: { input_tokens: 100, output_tokens: 50 },
        });
      }),
    );

    const result = await synthesizePaper(
      { pdfUrl: PDF_URL },
      { provider: "claude" },
    );

    expect(result.meta.provider).toBe("claude");
    expect(result.meta.model).toBe("claude-sonnet-4-7");
    expect(receivedAuth).toBe("test-claude-key");
    // Regression guard for the 60s-signed-URL-race fix — Claude must
    // receive the PDF as base64, NOT as a {type:"url"} reference.
    expect(documentSourceType).toBe("base64");
  });

  it("rejects when the provider returns JSON that fails schema validation", async () => {
    server.use(
      http.get(PDF_URL, () => HttpResponse.arrayBuffer(FAKE_PDF.buffer)),
      http.post(CLAUDE_URL, () =>
        HttpResponse.json({
          content: [{ type: "text", text: JSON.stringify({ title: "" }) }],
        }),
      ),
    );
    await expect(
      synthesizePaper({ pdfUrl: PDF_URL }, { provider: "claude" }),
    ).rejects.toThrow();
  });

  it("rejects on unknown provider", async () => {
    // @ts-expect-error — testing runtime guard against bad opts
    await expect(synthesizePaper({ pdfUrl: PDF_URL }, { provider: "ollama" })).rejects.toThrow(
      /unknown provider/,
    );
  });

  it("propagates a Gemini API error", async () => {
    server.use(
      http.get(PDF_URL, () => HttpResponse.arrayBuffer(FAKE_PDF.buffer)),
      http.post(`${GEMINI_HOST}/v1beta/models/:model\\:generateContent`, () =>
        HttpResponse.json({ error: { message: "quota exhausted" } }, { status: 429 }),
      ),
    );
    await expect(
      synthesizePaper({ pdfUrl: PDF_URL }, { provider: "gemini" }),
    ).rejects.toThrow(/quota exhausted/);
  });
});

describe("generateHint", () => {
  it("returns a hint + confidence from Gemini", async () => {
    server.use(
      http.post(`${GEMINI_HOST}/v1beta/models/:model\\:generateContent`, () =>
        HttpResponse.json({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ hint: "Revisit §3.", confidence: "high" }) }],
              },
            },
          ],
        }),
      ),
    );
    const r = await generateHint(
      {
        paperTitle: "T",
        questionText: "Q?",
        questionOptions: ["a", "b"],
        userAnswer: "a",
      },
      { provider: "gemini" },
    );
    expect(r.hint).toBe("Revisit §3.");
    expect(r.confidence).toBe("high");
  });

  it("defaults confidence to medium if provider returns an unknown value", async () => {
    server.use(
      http.post(CLAUDE_URL, () =>
        HttpResponse.json({
          content: [
            { type: "text", text: JSON.stringify({ hint: "...", confidence: "magical" }) },
          ],
        }),
      ),
    );
    const r = await generateHint(
      { paperTitle: "T", questionText: "Q?", userAnswer: "x" },
      { provider: "claude" },
    );
    expect(r.confidence).toBe("medium");
  });
});

describe("nextSocraticTurn", () => {
  it("returns the next question and optional summary", async () => {
    server.use(
      http.post(CLAUDE_URL, () =>
        HttpResponse.json({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                nextQuestion: "Why does that matter?",
                summary: "You worked out the residual sandwich.",
              }),
            },
          ],
        }),
      ),
    );
    const r = await nextSocraticTurn(
      {
        paperTitle: "T",
        promptTopic: "attention",
        openingQuestion: "Where does the residual go?",
        scriptedProbes: [],
        history: [{ role: "ai", text: "Where does the residual go?" }],
        userResponse: "Around the attention block.",
        turnNumber: 2,
      },
      { provider: "claude" },
    );
    expect(r.nextQuestion).toMatch(/matter/);
    expect(r.summary).toMatch(/residual sandwich/);
  });
});
