import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({ provider: vi.fn(), insert: vi.fn(), savedSignal: vi.fn() }));
vi.mock("../../../../../supabase/functions/_shared/supabase.ts", () => ({
  extractBearer: () => "fixture-token",
  authClient: () => ({ from: () => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: { title: "Fixture paper" } }),
  }) }) }) }),
  serviceClient: () => ({ from: () => ({ insert: mocks.insert }) }),
}));
vi.mock("../../../../../supabase/functions/_shared/gate.ts", () => ({
  currentMemberId: async () => 7, canRequestHint: async () => true,
}));
vi.mock("@/lib/paperpal/providers/index.ts", () => ({
  nextSocraticTurn: mocks.provider, resolveProvider: () => "gemini",
}));

let handler: (request: Request) => Promise<Response>;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Deno", { serve: (callback: typeof handler) => { handler = callback; }, env: { get: () => undefined } });
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.insert.mockReturnValue({ abortSignal: mocks.savedSignal.mockResolvedValue({ error: null }) });
  vi.resetModules();
  const handlerPath = resolve(process.cwd(), "../supabase/functions/analyze-socratic/index.ts");
  await import(handlerPath);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const response = { nextQuestion: "Fixture reply", meta: { provider: "gemini", model: "fixture" } };
const request = (signal?: AbortSignal) => new Request("https://fixture.test", {
  method: "POST", signal, headers: { "x-paperpal-timeout-ms": "100" },
  body: JSON.stringify({ paper_id: 7, prompt_id: "p", prompt_topic: "topic", opening_question: "Q", user_response: "A", turn_number: 1 }),
});

it("does not insert a late provider result after the real handler times out", async () => {
  let resolve!: (value: typeof response) => void;
  mocks.provider.mockReturnValue(new Promise(r => { resolve = r; }));
  const pending = handler(request());
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending).status).toBe(502);
  expect(mocks.provider.mock.calls[0][1].signal.aborted).toBe(true);
  resolve(response);
  await Promise.resolve();
  expect(mocks.insert).not.toHaveBeenCalled();
});

it("inserts a timely result using the same cancellation signal", async () => {
  mocks.provider.mockResolvedValue(response);
  expect((await handler(request())).status).toBe(200);
  expect(mocks.insert).toHaveBeenCalledOnce();
  expect(mocks.savedSignal).toHaveBeenCalledWith(mocks.provider.mock.calls[0][1].signal);
  expect(vi.getTimerCount()).toBe(0);
});
