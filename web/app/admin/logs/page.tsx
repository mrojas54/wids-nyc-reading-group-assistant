import { redirect } from "next/navigation";
import { requireLeaderRole } from "@/lib/auth/requireLeaderRole";
import { UnauthorizedError, ForbiddenError } from "@/lib/suggest/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { listCommandLog, summarizeHeader, type HeaderSummary, type LogEvent } from "@/lib/logs";
import { LogsPage } from "./LogsPage";
import "./logs.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Event log — /admin/logs",
};

export default async function AdminLogsPage() {
  // Auth gate — mirrors /admin/suggest.
  try {
    await requireLeaderRole();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/");
    if (e instanceof ForbiddenError) redirect("/dashboard");
    throw e;
  }

  // Request-time clock. This server component renders once per request, so the
  // value is stable for the render; the purity rule targets re-rendered client
  // components, where a moving clock would be the hazard.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  let events: LogEvent[] = [];
  let total = 0;
  let cursor: string | null = null;
  let summary: HeaderSummary = { state: "healthy" };
  let loadError = false;

  // command_log is RLS-locked with no policy → only the service-role client can
  // read it. We're already behind requireLeaderRole, so this is safe.
  try {
    const sb = createSupabaseServiceClient();
    const result = await listCommandLog(sb, { limit: 50, nowMs });
    events = result.events;
    total = result.total;
    cursor = result.nextCursor;
    summary = summarizeHeader(events, nowMs);
  } catch {
    loadError = true;
    summary = { state: "failed" };
  }

  return (
    <main>
      <LogsPage
        initialEvents={events}
        summary={summary}
        total={total}
        initialCursor={cursor}
        loadError={loadError}
        nowMs={nowMs}
      />
    </main>
  );
}
