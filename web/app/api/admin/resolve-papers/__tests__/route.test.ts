// Status-code mapping for POST /api/admin/resolve-papers. The resolving itself
// is covered in lib/suggest/__tests__/resolve-papers.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, S2AuthError, S2RequestError, UnauthorizedError } from "@/lib/suggest/types";

const m = vi.hoisted(() => ({
  requireLeaderRole: vi.fn(),
  resolvePapers: vi.fn(),
  s2ApiKey: vi.fn(),
}));
vi.mock("@/lib/auth/requireLeaderRole", () => ({ requireLeaderRole: m.requireLeaderRole }));
vi.mock("@/lib/suggest/resolve-papers", () => ({ resolvePapers: m.resolvePapers }));
vi.mock("@/lib/suggest/s2-client", () => ({ s2ApiKey: m.s2ApiKey }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ fake: true }) }));

import { POST } from "../route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/admin/resolve-papers", {
    method: "POST",
    body: JSON.stringify(body),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  m.requireLeaderRole.mockResolvedValue({ userId: "u", role: "leader" });
  m.s2ApiKey.mockReturnValue("key");
  m.resolvePapers.mockResolvedValue({ kind: "resolved", resolved: [] });
});

describe("POST /api/admin/resolve-papers", () => {
  it("resolves the URLs with the S2 key and the service client", async () => {
    const paper = { id: 1, s2_paper_id: "ARXIV:1706.03762", title: "T", abstract: "A" };
    m.resolvePapers.mockResolvedValue({ kind: "resolved", resolved: [paper] });
    const res = await post({ urls: ["1706.03762"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ resolved: [paper] });
    expect(m.resolvePapers).toHaveBeenCalledWith({ fake: true }, ["1706.03762"], "key");
  });

  it("returns 400 no_valid_urls when nothing parses", async () => {
    m.resolvePapers.mockResolvedValue({ kind: "no_valid_urls" });
    const res = await post({ urls: ["nonsense"] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_valid_urls");
  });

  it("rejects a malformed body before resolving", async () => {
    const res = await post({ urls: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(m.resolvePapers).not.toHaveBeenCalled();
  });

  it.each([
    [new UnauthorizedError(), 401, "unauthorized"],
    [new ForbiddenError(), 403, "forbidden"],
  ])("maps %s from the role check", async (err, status, error) => {
    m.requireLeaderRole.mockRejectedValue(err);
    const res = await post({ urls: ["1706.03762"] });
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(error);
    expect(m.resolvePapers).not.toHaveBeenCalled();
  });

  it.each([
    [new S2AuthError("x"), 502, "s2_auth"],
    [new S2RequestError("x"), 502, "s2_request"],
    [new Error("db down"), 500, "internal"],
  ])("maps %s from resolving", async (err, status, error) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.resolvePapers.mockRejectedValue(err);
    const res = await post({ urls: ["1706.03762"] });
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(error);
  });
});
