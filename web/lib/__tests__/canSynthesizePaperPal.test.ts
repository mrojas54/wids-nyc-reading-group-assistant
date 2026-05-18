// Unit tests for the Node-side canSynthesizePaperPal wrapper.
// The actual gate logic lives in the SQL function (migration 016);
// here we just verify the wrapper translates the RPC return shape
// correctly and is safe on error / null data.
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canSynthesizePaperPal } from "@/lib/queries";

function mockClient(
  rpcReturn: { data: unknown; error: unknown },
): SupabaseClient {
  return {
    rpc: vi.fn().mockResolvedValue(rpcReturn),
  } as unknown as SupabaseClient;
}

describe("canSynthesizePaperPal", () => {
  it("returns the owner verdict from the RPC", async () => {
    const sb = mockClient({
      data: { canSynthesize: true, reason: "owner" },
      error: null,
    });
    expect(await canSynthesizePaperPal(sb, 42)).toEqual({
      canSynthesize: true,
      reason: "owner",
    });
    expect(sb.rpc).toHaveBeenCalledWith("can_synthesize_paper_pal", { p_paper_id: 42 });
  });

  it("returns the leader verdict from the RPC", async () => {
    const sb = mockClient({
      data: { canSynthesize: true, reason: "leader" },
      error: null,
    });
    expect(await canSynthesizePaperPal(sb, 7)).toEqual({
      canSynthesize: true,
      reason: "leader",
    });
  });

  it("returns { false, none } on RPC error (safe on public route)", async () => {
    const sb = mockClient({
      data: null,
      error: { message: "auth.uid missing" },
    });
    expect(await canSynthesizePaperPal(sb, 99)).toEqual({
      canSynthesize: false,
      reason: "none",
    });
  });

  it("returns { false, none } when data is null", async () => {
    const sb = mockClient({ data: null, error: null });
    expect(await canSynthesizePaperPal(sb, 99)).toEqual({
      canSynthesize: false,
      reason: "none",
    });
  });

  it("defaults reason to 'none' when RPC returns a partial object", async () => {
    const sb = mockClient({ data: { canSynthesize: false }, error: null });
    expect(await canSynthesizePaperPal(sb, 1)).toEqual({
      canSynthesize: false,
      reason: "none",
    });
  });
});
