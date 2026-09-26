import { redirect } from "next/navigation";
import { requireOperatorRole } from "@/lib/auth/requireOperatorRole";
import { UnauthorizedError, ForbiddenError } from "@/lib/suggest/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { loadSchedulePoll } from "@/lib/schedule/loadPoll";
import { nyDayKey } from "@/lib/time";
import { SchedulePage } from "./SchedulePage";
import "./schedule.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Schedule the next meeting — /admin/schedule",
};

export default async function AdminSchedulePage() {
  // Operator-only, not the wider leader gate the other /admin routes use:
  // members never see operator affordances, and leaders are members.
  let viewerName: string | null = null;
  try {
    const ctx = await requireOperatorRole();
    viewerName = ctx.name.split(/\s+/)[0] ?? null;
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/");
    if (e instanceof ForbiddenError) redirect("/dashboard");
    throw e;
  }

  // Cross-roster availability is select-own under RLS; the service client is
  // the only way to read the whole poll. Safe here: we are past the gate.
  const data = await loadSchedulePoll(createSupabaseServiceClient());

  return (
    <SchedulePage
      viewerName={viewerName}
      meeting={data.meeting}
      members={data.members}
      responses={data.responses}
      excludedDays={data.excludedDays}
      pollWindow={data.pollWindow}
      defaultLocation={data.defaultLocation}
      pollClosesAt={data.pollClosesAt}
      todayKey={nyDayKey(new Date())}
    />
  );
}
