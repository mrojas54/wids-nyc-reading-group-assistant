"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logServerAction } from "@/lib/log";

type RsvpChoice = "attending" | "declined" | "tentative";

export async function setRsvp(meetingId: number, status: RsvpChoice): Promise<void> {
  const sb = createSupabaseServerClient();

  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("not signed in");

  const { data: memberRow } = await sb
    .from("members")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!memberRow) throw new Error("not on roster");

  const { error } = await sb.from("meeting_attendance").upsert(
    {
      meeting_id: meetingId,
      member_id: memberRow.id,
      rsvp_status: status,
      responded_at: new Date().toISOString(),
    },
    { onConflict: "meeting_id,member_id" },
  );

  if (error) {
    await logServerAction(
      "setRsvp",
      "failure",
      `meeting ${meetingId}: ${status}`,
      error.message,
    );
    throw new Error(error.message);
  }

  await logServerAction(
    "setRsvp",
    "success",
    `meeting ${meetingId}: ${status}`,
  );
  revalidatePath("/dashboard");
}
