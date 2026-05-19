// Unit tests for the analyze-socratic client wrapper.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSocratic } from "../socratic";

describe("fetchSocratic", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("POSTs the full wire body and returns parsed response", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          next_question: "What would happen if you removed the residual?",
          summary: null,
          provider: "gemini",
          model: "gemini-2.0",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const out = await fetchSocratic(
      {
        paperId: 42,
        promptId: "p1",
        promptTopic: "Residual connections",
        openingQuestion: "Why residuals?",
        scriptedProbes: ["What does y = F(x) + x give us?"],
        history: [
          { role: "ai", text: "Why residuals?" },
          { role: "user", text: "Gradient flow." },
        ],
        userResponse: "They keep the gradient norm closer to 1.",
        turnNumber: 2,
      },
      { accessToken: "tok" },
    );
    expect(out.next_question).toMatch(/residual/);
    expect(out.summary).toBeNull();

    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(JSON.parse(init.body as string)).toEqual({
      paper_id: 42,
      prompt_id: "p1",
      prompt_topic: "Residual connections",
      opening_question: "Why residuals?",
      scripted_probes: ["What does y = F(x) + x give us?"],
      history: [
        { role: "ai", text: "Why residuals?" },
        { role: "user", text: "Gradient flow." },
      ],
      user_response: "They keep the gradient norm closer to 1.",
      turn_number: 2,
    });
  });

  it("omits optional fields when undefined", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ next_question: "n", summary: null, provider: "p", model: "m" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await fetchSocratic(
      {
        paperId: 1,
        promptId: "x",
        promptTopic: "t",
        openingQuestion: "o",
        userResponse: "u",
        turnNumber: 1,
      },
      { accessToken: "t" },
    );
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty("scripted_probes");
    expect(body).not.toHaveProperty("history");
  });

  it("throws typed error on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "provider_failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(
      fetchSocratic(
        {
          paperId: 1,
          promptId: "x",
          promptTopic: "t",
          openingQuestion: "o",
          userResponse: "u",
          turnNumber: 1,
        },
        { accessToken: "t" },
      ),
    ).rejects.toMatchObject({ status: 502, code: "provider_failed" });
  });
});
