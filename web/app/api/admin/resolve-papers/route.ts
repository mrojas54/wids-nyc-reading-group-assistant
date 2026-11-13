import { NextResponse } from "next/server";
import { z } from "zod";
import { requireLeaderRole } from "@/lib/auth/requireLeaderRole";
import { knownErrorResponse } from "@/lib/suggest/route-errors";
import { s2ApiKey } from "@/lib/suggest/s2-client";
import { resolvePapers } from "@/lib/suggest/resolve-papers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ResolveRequestSchema = z.object({
  urls: z.array(z.string().min(1)).min(1).max(10),
});

export async function POST(req: Request) {
  try {
    await requireLeaderRole();
    const body = await req.json();
    const { urls } = ResolveRequestSchema.parse(body);

    const apiKey = s2ApiKey();
    const { createSupabaseServiceClient } = await import("@/lib/supabase/service");
    const result = await resolvePapers(createSupabaseServiceClient(), urls, apiKey);

    if (result.kind === "no_valid_urls") {
      return NextResponse.json(
        {
          error: "no_valid_urls",
          details: "None of the inputs could be parsed as arXiv URL, DOI, or canonical S2 ID.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ resolved: result.resolved });
  } catch (e) {
    const known = knownErrorResponse(e);
    if (known) return NextResponse.json(known.body, { status: known.status });
    console.error(JSON.stringify({ event: "resolve_error", message: (e as Error).message }));
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
