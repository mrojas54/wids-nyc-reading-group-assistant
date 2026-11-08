import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generateHint, nextSocraticTurn } from "../index";

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "fixture");
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it.each(["gemini", "claude"] as const)("passes cancellation through %s hint and tutor requests", async provider => {
  const controller = new AbortController();
  const seen: (AbortSignal | null | undefined)[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    seen.push(init?.signal);
    const text = JSON.stringify({ hint: "Fixture hint", confidence: "high", nextQuestion: "Fixture question" });
    return Response.json(provider === "gemini"
      ? { candidates: [{ content: { parts: [{ text }] } }] }
      : { content: [{ type: "text", text }] });
  });
  const opts = { provider, signal: controller.signal };
  await generateHint({ paperTitle: "T", questionText: "Q", userAnswer: "A" }, opts);
  await nextSocraticTurn({ paperTitle: "T", promptTopic: "P", openingQuestion: "Q", scriptedProbes: [], history: [], userResponse: "A", turnNumber: 1 }, opts);
  expect(seen).toEqual([controller.signal, controller.signal]);
});
