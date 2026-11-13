// Request handling for POST /api/admin/backfill-embeddings. The batch logic is
// covered in lib/suggest/__tests__/backfill.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, ModelLoadError, S2AuthError, UnauthorizedError } from "@/lib/suggest/types";

const m = vi.hoisted(() => ({
  requireLeaderRole: vi.fn(),
  backfillBatch: vi.fn(),
  prewarmModel: vi.fn(),
}));
vi.mock("@/lib/auth/requireLeaderRole", () => ({ requireLeaderRole: m.requireLeaderRole }));
vi.mock("@/lib/suggest/backfill", () => ({ backfillBatch: m.backfillBatch }));
vi.mock("@/lib/suggest/s2-client", () => ({
  s2ApiKey: () => "key",
  fetchPaperWithEmbedding: "fetch-fn",
}));
vi.mock("@/lib/suggest/specter2-wasm", () => ({ embedBatch: "embed-fn", prewarmModel: m.prewarmModel }));
vi.mock("@/lib/suggest/embedding-cache", () => ({ cacheMany: "cache-fn" }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ fake: true }) }));

import { POST } from "../route";

const post = (body?: string) =>
  POST(new Request("http://localhost/api/admin/backfill-embeddings", { method: "POST", body }));

const breakdown = {
  s2_hits: 1,
  wasm_embedded: 1,
  s2_rate_limited: 1,
  s2_no_embedding: 0,
  s2_not_in_corpus: 0,
  s2_transient: 0,
};

beforeEach(() => {
  m.requireLeaderRole.mockResolvedValue({ userId: "u", role: "leader" });
  m.backfillBatch.mockResolvedValue({
    result: { embedded: 2, remaining: 3, total_eligible: 9, breakdown },
    batchSize: 2,
  });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("POST /api/admin/backfill-embeddings", () => {
  it("runs one batch with the service client, S2 key and real embedders", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await post(JSON.stringify({ batch_size: 5 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ embedded: 2, remaining: 3, total_eligible: 9, breakdown });
    expect(m.prewarmModel).toHaveBeenCalled();
    expect(m.backfillBatch).toHaveBeenCalledWith({ fake: true }, 5, "key", {
      fetchPaperWithEmbedding: "fetch-fn",
      embedBatch: "embed-fn",
      cacheMany: "cache-fn",
    });
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      event: "backfill_batch",
      batch_size: 2,
      s2_hits: 1,
      s2_rate_limited: 1,
      wasm_embedded: 1,
      remaining: 3,
    });
  });

  it("uses a batch of 10 when the body is missing or not JSON", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await post();
    await post("not json");
    expect(m.backfillBatch.mock.calls.map((c) => c[1])).toEqual([10, 10]);
  });

  it("returns the bare counts and logs nothing when the cache is already warm", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    m.backfillBatch.mockResolvedValue({
      result: { embedded: 0, remaining: 0, total_eligible: 9 },
      batchSize: 0,
    });
    const res = await post("{}");
    expect(await res.json()).toEqual({ embedded: 0, remaining: 0, total_eligible: 9 });
    expect(log).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range batch size before touching the database", async () => {
    const res = await post(JSON.stringify({ batch_size: 50 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(m.backfillBatch).not.toHaveBeenCalled();
  });

  it.each([
    [new UnauthorizedError(), 401, "unauthorized"],
    [new ForbiddenError(), 403, "forbidden"],
  ])("maps %s from the role check and does not warm the model", async (err, status, error) => {
    m.requireLeaderRole.mockRejectedValue(err);
    const res = await post("{}");
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(error);
    expect(m.prewarmModel).not.toHaveBeenCalled();
  });

  it.each([
    [new S2AuthError("s2 401"), 502, "s2_auth"],
    [new ModelLoadError("blob 403"), 502, "wasm_model_load_failed"],
  ])("maps %s from the batch", async (err, status, error) => {
    m.backfillBatch.mockRejectedValue(err);
    const res = await post("{}");
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(error);
  });

  it("logs an unexpected error and returns 500", async () => {
    const errLog = vi.spyOn(console, "error").mockImplementation(() => {});
    m.backfillBatch.mockRejectedValue(new Error("db down"));
    const res = await post("{}");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    expect(JSON.parse(errLog.mock.calls[0][0])).toMatchObject({ event: "backfill_error", message: "db down" });
  });
});
