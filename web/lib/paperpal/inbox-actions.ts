"use server";

// Server actions for the PaperPal Inbox "Want to lead" section.
//  • volunteerForMeeting — a member raises their hand to lead a meeting.
//    Writes volunteers(meeting_id, member_id) via the RLS-scoped client
//    (insert-as-self policy). UNIQUE(meeting_id, member_id) makes a repeat
//    click a no-op.
//  • proposePaper — a member proposes a catalog paper. meetings has no
//    member INSERT policy, so the placeholder reading_group meeting is
//    created with the service client; the paper_suggestions row is then
//    inserted with the RLS-scoped client so the insert-as-self policy
//    still enforces suggested_by = current_member_id().
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { logServerAction } from "@/lib/log";

const POSTGRES_UNIQUE_VIOLATION = "23505";
// Constraint behind UNIQUE(meeting_id, member_id) on volunteers — used to
// confirm a 23505 is the repeat-volunteer case and not some other clash.
const VOLUNTEERS_UNIQUE_CONSTRAINT = "volunteers_meeting_id_member_id_key";

async function resolveMemberId(
  sb: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<number> {
  const { data, error } = await sb.rpc("current_member_id");
  if (error) throw new Error(error.message);
  if (typeof data !== "number") throw new Error("not on roster");
  return data;
}

export async function volunteerForMeeting(meetingId: number): Promise<void> {
  if (!Number.isInteger(meetingId)) throw new Error("invalid meeting id");
  const sb = await createSupabaseServerClient();
  const memberId = await resolveMemberId(sb);

  const { error } = await sb
    .from("volunteers")
    .insert({ meeting_id: meetingId, member_id: memberId });

  if (error) {
    // A repeat volunteer trips UNIQUE(meeting_id, member_id) — that exact
    // 23505 is an idempotent no-op; any other error is real.
    const isRepeatVolunteer =
      error.code === POSTGRES_UNIQUE_VIOLATION &&
      error.message.includes(VOLUNTEERS_UNIQUE_CONSTRAINT);
    if (!isRepeatVolunteer) {
      await logServerAction(
        "volunteerForMeeting",
        "failure",
        `meeting ${meetingId}`,
        error.message,
      );
      throw new Error(error.message);
    }
    await logServerAction(
      "volunteerForMeeting",
      "no_action",
      `meeting ${meetingId}, member ${memberId} — already volunteered`,
    );
    revalidatePath("/papers");
    return;
  }

  await logServerAction(
    "volunteerForMeeting",
    "success",
    `meeting ${meetingId}, member ${memberId}`,
  );
  revalidatePath("/papers");
}

export async function proposePaper(input: {
  paperId: number;
  note?: string;
}): Promise<void> {
  if (!Number.isInteger(input.paperId)) throw new Error("invalid paper id");
  const sb = await createSupabaseServerClient();
  const memberId = await resolveMemberId(sb);

  // meetings has no member-facing INSERT policy — use the service client to
  // create the placeholder meeting the suggestion attaches to.
  const svc = createSupabaseServiceClient();
  const { data: meeting, error: meetingError } = await svc
    .from("meetings")
    .insert({ type: "reading_group", status: "prep" })
    .select("id")
    .single();

  if (meetingError || !meeting) {
    await logServerAction(
      "proposePaper",
      "failure",
      `paper ${input.paperId}`,
      meetingError?.message ?? "meeting insert returned no row",
    );
    throw new Error(meetingError?.message ?? "could not create meeting");
  }

  const note = input.note?.trim();
  // The suggestion row goes through the RLS-scoped client so the
  // insert-as-self policy enforces suggested_by = current_member_id().
  const { error: suggestionError } = await sb.from("paper_suggestions").insert({
    meeting_id: meeting.id,
    paper_id: input.paperId,
    suggested_by: memberId,
    source: "member",
    notes: note ? note : null,
  });

  if (suggestionError) {
    // Don't leave an orphan placeholder meeting behind. The delete needs the
    // service client (meetings has no member-facing policy); if it fails,
    // log the orphan id so it can be reclaimed.
    const { error: cleanupError } = await svc
      .from("meetings")
      .delete()
      .eq("id", meeting.id);
    if (cleanupError) {
      await logServerAction(
        "proposePaper",
        "failure",
        `paper ${input.paperId} — orphan meeting ${meeting.id}, cleanup failed`,
        cleanupError.message,
      );
    }
    await logServerAction(
      "proposePaper",
      "failure",
      `paper ${input.paperId}`,
      suggestionError.message,
    );
    throw new Error(suggestionError.message);
  }

  await logServerAction(
    "proposePaper",
    "success",
    `paper ${input.paperId}, meeting ${meeting.id}, member ${memberId}`,
  );
  revalidatePath("/papers");
}
