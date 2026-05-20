"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logServerAction } from "@/lib/log";
import { nyDayAtHour } from "@/lib/time";

export async function submitAvailability(meetingId: number, days: string[]): Promise<void> {
  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("not signed in");

  const { data: memberRow } = await sb
    .from("members")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!memberRow) throw new Error("not on roster");

  const { error: delErr } = await sb
    .from("availability")
    .delete()
    .eq("meeting_id", meetingId)
    .eq("member_id", memberRow.id);
  if (delErr) {
    await logServerAction("submitAvailability", "failure", `delete: ${delErr.message}`);
    throw new Error(delErr.message);
  }

  if (days.length > 0) {
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
  }

  await logServerAction(
    "submitAvailability",
    "success",
    `meeting ${meetingId}: ${days.length} days`,
  );
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=1");
}
