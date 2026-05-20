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
//    still enforces suggested_by = current_member_id(). To dedupe, an
//    already-proposed paper reuses its existing prep placeholder meeting
//    instead of minting a new one, so UNIQUE(meeting_id, paper_id) on
//    paper_suggestions fires and a repeat propose is an idempotent no-op.
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { logServerAction } from "@/lib/log";

const POSTGRES_UNIQUE_VIOLATION = "23505";
// Constraint behind UNIQUE(meeting_id, member_id) on volunteers — used to
// confirm a 23505 is the repeat-volunteer case and not some other clash.
const VOLUNTEERS_UNIQUE_CONSTRAINT = "volunteers_meeting_id_member_id_key";
// Constraint behind UNIQUE(meeting_id, paper_id) on paper_suggestions — a
// 23505 naming it means the paper is already proposed on that meeting.
const PAPER_SUGGESTIONS_UNIQUE_CONSTRAINT =
  "paper_suggestions_meeting_id_paper_id_key";

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

  // Validate the paper up front so a bad id fails cleanly here, rather than
  // minting a placeholder meeting and only then tripping the suggestion FK.
  const { data: paper, error: paperError } = await sb
    .from("papers")
    .select("id")
    .eq("id", input.paperId)
    .maybeSingle();
  if (paperError) {
    await logServerAction(
      "proposePaper",
      "failure",
      `paper ${input.paperId}`,
      paperError.message,
    );
    throw new Error(paperError.message);
  }
  if (!paper) {
    await logServerAction(
      "proposePaper",
      "failure",
      `paper ${input.paperId}`,
      "no such paper",
    );
    throw new Error("no such paper");
  }

  // Dedupe: if this paper already has a prep reading_group placeholder, reuse
  // it instead of minting a new meeting. That makes UNIQUE(meeting_id,
  // paper_id) on paper_suggestions reachable, so a repeat propose is a no-op.
  const { data: existing, error: existingError } = await sb
    .from("paper_suggestions")
    .select("meeting_id, meeting:meeting_id(type, status)")
    .eq("paper_id", input.paperId);
  if (existingError) {
    await logServerAction(
      "proposePaper",
      "failure",
      `paper ${input.paperId}`,
      existingError.message,
    );
    throw new Error(existingError.message);
  }
  const placeholder = (existing ?? []).find(
    (r: any) =>
      r.meeting?.type === "reading_group" && r.meeting?.status === "prep",
  );

  // meetings has no member-facing INSERT/DELETE policy — the service client
  // owns the placeholder meeting's lifecycle.
  const svc = createSupabaseServiceClient();
  let meetingId: number;
  let createdMeeting = false;

  if (placeholder) {
    meetingId = placeholder.meeting_id;
  } else {
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
    meetingId = meeting.id;
    createdMeeting = true;
  }

  const note = input.note?.trim();
  // The suggestion row goes through the RLS-scoped client so the
  // insert-as-self policy enforces suggested_by = current_member_id().
  const { error: suggestionError } = await sb.from("paper_suggestions").insert({
    meeting_id: meetingId,
    paper_id: input.paperId,
    suggested_by: memberId,
    source: "member",
    notes: note ? note : null,
  });

  if (suggestionError) {
    // A repeat propose of an already-proposed paper trips
    // UNIQUE(meeting_id, paper_id) — that exact 23505 is an idempotent no-op.
    const isRepeatPropose =
      suggestionError.code === POSTGRES_UNIQUE_VIOLATION &&
      suggestionError.message.includes(PAPER_SUGGESTIONS_UNIQUE_CONSTRAINT);
    if (isRepeatPropose) {
      await logServerAction(
        "proposePaper",
        "no_action",
        `paper ${input.paperId}, meeting ${meetingId} — already proposed`,
      );
      revalidatePath("/papers");
      return;
    }

    // A real failure: clean up only a meeting we just created — never a
    // reused placeholder. The delete needs the service client; if it fails,
    // log the orphan id so it can be reclaimed.
    if (createdMeeting) {
      const { error: cleanupError } = await svc
        .from("meetings")
        .delete()
        .eq("id", meetingId);
      if (cleanupError) {
        await logServerAction(
          "proposePaper",
          "failure",
          `paper ${input.paperId} — orphan meeting ${meetingId}, cleanup failed`,
          cleanupError.message,
        );
      }
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
    `paper ${input.paperId}, meeting ${meetingId}, member ${memberId}`,
  );
  revalidatePath("/papers");
}
