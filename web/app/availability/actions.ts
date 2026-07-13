"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logServerAction } from "@/lib/log";
import { nyDayAtHour } from "@/lib/time";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { blackedOutDays } from "@/lib/blackout";

export async function submitAvailability(meetingId: number, days: string[]): Promise<void> {
  if (days.length === 0) throw new Error("select at least one day");

  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("not signed in");

  const { data: memberRow } = await sb
    .from("members")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!memberRow) throw new Error("not on roster");

  // Reject blacked-out dates BEFORE deleting existing rows, so a rejected
  // submit leaves the member's prior availability intact. blackout_periods is
  // service-role-only (RLS), so read it with the service client, not `sb`.
  const svc = createSupabaseServiceClient();
  const { data: periods } = await svc
    .from("blackout_periods")
    .select("range_start, range_end");
  const blocked = blackedOutDays(days, periods ?? []);
  if (blocked.length > 0) {
    await logServerAction(
      "submitAvailability",
      "failure",
      `blackout rejected: ${blocked.join(", ")}`,
    );
    throw new Error(
      `These dates fall in a blackout window and can't be selected: ${blocked.join(", ")}`,
    );
  }

  const { error: delErr } = await sb
    .from("availability")
    .delete()
    .eq("meeting_id", meetingId)
    .eq("member_id", memberRow.id);
  if (delErr) {
    await logServerAction("submitAvailability", "failure", `delete: ${delErr.message}`);
    throw new Error(delErr.message);
  }

  const rows = days.map((day) => ({
    meeting_id: meetingId,
    member_id: memberRow.id,
    range_start: nyDayAtHour(day, 18),
    range_end: nyDayAtHour(day, 21),
  }));
  const { error: insErr } = await sb.from("availability").insert(rows);
  if (insErr) {
    await logServerAction("submitAvailability", "failure", `insert: ${insErr.message}`);
    throw new Error(insErr.message);
  }

  await logServerAction(
    "submitAvailability",
    "success",
    `meeting ${meetingId}: ${days.length} days`,
  );
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=1");
}
