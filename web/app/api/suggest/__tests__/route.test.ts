// Request handling for GET and POST /api/suggest. The ranking pipeline is
// covered in lib/suggest/__tests__/orchestrator.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ForbiddenError,
  ModelLoadError,
  S2RequestError,
  TimeoutError,
  UnauthorizedError,
} from "@/lib/suggest/types";

const m = vi.hoisted(() => ({
  requireLeaderRole: vi.fn(),
  orchestrate: vi.fn(),
  prewarmModel: vi.fn(),
  ensureModelLoaded: vi.fn(),
  getCached: vi.fn(),
  cacheMany: vi.fn(),
}));
vi.mock("@/lib/auth/requireLeaderRole", () => ({ requireLeaderRole: m.requireLeaderRole }));
vi.mock("@/lib/suggest/orchestrator", () => ({ orchestrate: m.orchestrate }));
vi.mock("@/lib/suggest/embedding-cache", () => ({ getCached: m.getCached, cacheMany: m.cacheMany }));
vi.mock("@/lib/suggest/s2-client", () => ({ s2ApiKey: () => "key", fetchPaperWithEmbedding: "fetch-fn" }));
vi.mock("@/lib/suggest/specter2-wasm", () => ({
  embedBatch: "embed-fn",
  isModelWarm: "warm-fn",
  prewarmModel: m.prewarmModel,
  ensureModelLoaded: m.ensureModelLoaded,
}));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ fake: true }) }));

import { GET, POST } from "../route";

const paper = (id: number) => ({ id, s2_paper_id: `S${id}`, title: `T${id}`, abstract: `A${id}` });
const validBody = { candidates: [paper(1)], past_picks: [paper(2)] };
const diagnostics = { cache_hits: 1, s2_fetched: 1, fallback_used: 0, cold_start: false, total_ms: 12 };

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/suggest", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  m.requireLeaderRole.mockResolvedValue({ userId: "user-1", role: "leader" });
  m.ensureModelLoaded.mockResolvedValue(undefined);
  m.orchestrate.mockResolvedValue({ results: [], diagnostics });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("GET /api/suggest (warmup)", () => {
  it("loads the model for a leader", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ warm: true });
    expect(m.prewarmModel).toHaveBeenCalled();
  });

  it.each([
    [new UnauthorizedError(), 401, "unauthorized"],
    [new ForbiddenError(), 403, "forbidden"],
  ])("refuses %s without starting the model load", async (err, status, error) => {
    m.requireLeaderRole.mockRejectedValue(err);
    const res = await GET();
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(error);
    // An unauthenticated GET must not be able to trigger the costly load.
    expect(m.prewarmModel).not.toHaveBeenCalled();
    expect(m.ensureModelLoaded).not.toHaveBeenCalled();
  });

  it("reports a model load failure as 502", async () => {
    m.ensureModelLoaded.mockRejectedValue(new Error("blob 403"));
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "wasm_model_load_failed", detail: "blob 403" });
  });
});

describe("POST /api/suggest", () => {
  it("runs the orchestrator with the real dependencies and a deadline", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await post(validBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [], diagnostics });

    const [req, deps, signal] = m.orchestrate.mock.calls[0];
    expect(req).toMatchObject(validBody);
    expect(deps).toMatchObject({
      apiKey: "key",
      client: { fake: true },
      fetchPaperWithEmbedding: "fetch-fn",
      embedBatch: "embed-fn",
      isModelWarm: "warm-fn",
    });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(m.prewarmModel).toHaveBeenCalled();

    // The cache helpers fall back to the service client when none is passed.
    await deps.getCached(undefined, [1]);
    expect(m.getCached).toHaveBeenCalledWith({ fake: true }, [1]);

    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      event: "suggest_request",
      user_id: "user-1",
      candidate_count: 1,
      past_pick_count: 1,
      outcome: "ok",
    });
  });

  it("rejects a malformed body as 400 and logs the error", async () => {
    const errLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ candidates: "nope" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(m.orchestrate).not.toHaveBeenCalled();
    expect(JSON.parse(errLog.mock.calls[0][0])).toMatchObject({ error_code: "invalid_request", status: 400 });
  });

  it.each([
    [new UnauthorizedError(), 401, "unauthorized"],
    [new ForbiddenError(), 403, "forbidden"],
  ])("maps %s from the role check", async (err, status, error) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.requireLeaderRole.mockRejectedValue(err);
    const res = await post(validBody);
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(error);
  });

  it.each([
    [new S2RequestError("s2 400"), 502, { error: "s2_request" }],
    [new ModelLoadError("blob 403"), 502, { error: "wasm_model_load_failed", detail: "blob 403" }],
    [new TimeoutError(), 504, { error: "timeout", elapsed_ms: 55_000 }],
    [new Error("boom"), 500, { error: "internal" }],
  ])("maps %s from the orchestrator", async (err, status, body) => {
    const errLog = vi.spyOn(console, "error").mockImplementation(() => {});
    m.orchestrate.mockRejectedValue(err);
    const res = await post(validBody);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
    expect(JSON.parse(errLog.mock.calls[0][0])).toMatchObject({ outcome: "error", status });
  });
});
