"use server";

// Keyset "Load more" for the operator logs page. Re-checks the leader role on
// every call (server actions are public endpoints) and reads command_log via
// the service-role client, since the table is RLS-locked with no policy.
import { requireLeaderRole } from "@/lib/auth/requireLeaderRole";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { listCommandLog, type LogEvent } from "@/lib/logs";

export type LoadMoreResult =
  | { ok: true; events: LogEvent[]; nextCursor: string | null }
  | { ok: false; error: string };

export async function loadMoreCommandLog(cursorIso: string): Promise<LoadMoreResult> {
  try {
    await requireLeaderRole();
  } catch {
    return { ok: false, error: "unauthorized" };
  }

  try {
    const sb = createSupabaseServiceClient();
    const { events, nextCursor } = await listCommandLog(sb, { before: cursorIso, limit: 50 });
    return { ok: true, events, nextCursor };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "query failed" };
  }
}
