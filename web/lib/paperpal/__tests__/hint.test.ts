// Unit tests for the analyze-hint client wrapper. Component-level
// integration with McqMode is exercised manually — the wrapper is small
// enough that drift between contract and component will surface in tsc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchHint } from "../hint";

describe("fetchHint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs the wire body and returns the parsed response", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          hint: "Compare what each layer normalizes over.",
          confidence: "medium",
          provider: "gemini",
          model: "gemini-2.0",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const out = await fetchHint(
      {
        paperId: 42,
        questionText: "What does LayerNorm do?",
        questionOptions: ["A", "B", "C", "D"],
        userAnswer: "B",
      },
      { accessToken: "tok" },
    );
    expect(out.hint).toMatch(/normalizes/);
    expect(out.confidence).toBe("medium");
    const call = spy.mock.calls[0];
    expect(call[0]).toBe("/functions/v1/analyze-hint");
    const init = call[1] as RequestInit;
    expect(init.headers).toMatchObject({
      Authorization: "Bearer tok",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      paper_id: 42,
      question_text: "What does LayerNorm do?",
      question_options: ["A", "B", "C", "D"],
      user_answer: "B",
    });
  });

  it("omits question_options when not provided", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ hint: "h", confidence: "low", provider: "p", model: "m" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await fetchHint(
      { paperId: 1, questionText: "Q", userAnswer: "A" },
      { accessToken: "t" },
    );
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty("question_options");
  });

  it("throws a typed error containing the server `error` code on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "not_attending_meeting_for_paper" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(
      fetchHint(
        { paperId: 1, questionText: "Q", userAnswer: "A" },
        { accessToken: "t" },
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: "not_attending_meeting_for_paper",
    });
  });

  it("falls back to a generic error code when response body is unparseable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not json", { status: 500 }),
    );
    await expect(
      fetchHint(
        { paperId: 1, questionText: "Q", userAnswer: "A" },
        { accessToken: "t" },
      ),
    ).rejects.toMatchObject({ status: 500, code: "hint_failed_500" });
  });
});
