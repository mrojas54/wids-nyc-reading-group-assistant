import { NextResponse } from "next/server";
import { requireLeaderRole } from "@/lib/auth/requireLeaderRole";
import { UnauthorizedError, ForbiddenError } from "@/lib/suggest/types";
import type { Tables } from "@/lib/database.types";

// The inferred select result is assigned to this Row-derived shape below, so a
// renamed column is a compile error — see lib/queries.ts for why that, and
// not `.returns<T>()`, is the guard.
type PastPickRow = Pick<Tables<"papers">, "id" | "s2_paper_id" | "title" | "abstract">;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireLeaderRole();
    const url = new URL(req.url);
    const windowParam = url.searchParams.get("window") ?? "all";

    const { createSupabaseServiceClient } = await import("@/lib/supabase/service");
    const client = createSupabaseServiceClient();

    let q = client
      .from("papers")
      .select("id, s2_paper_id, title, abstract")
      .not("s2_paper_id", "is", null);

    if (windowParam === "last6m") {
      const sixMonthsAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 6).toISOString();
      q = q.gte("added_at", sixMonthsAgo);
    }

    const { data, error } = await q;
    if (error) throw error;
    const rows: PastPickRow[] = data ?? [];
    const past_picks = rows
      // NULL s2_paper_id is excluded server-side above; narrow without a cast.
      .filter((r): r is PastPickRow & { s2_paper_id: string } => r.s2_paper_id !== null)
      .map(r => ({
        id: r.id,
        s2_paper_id: r.s2_paper_id,
        title: r.title ?? "",
        abstract: r.abstract ?? "",
      }));
    return NextResponse.json({ past_picks });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    console.error(JSON.stringify({ event: "past_picks_error", message: (e as Error).message }));
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
