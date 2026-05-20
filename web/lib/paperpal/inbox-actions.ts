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
//    still enforces suggested_by = current_member_id(). Dedupe: a paper's
//    placeholder is keyed by paper_id, and migration 019's partial unique
//    index allows at most one member-proposed prep placeholder per paper.
//    So while that placeholder is in prep, a repeat propose reuses it and
//    trips paper_suggestions' UNIQUE(meeting_id, paper_id) — an idempotent
//    no-op — and a concurrent propose that loses the meeting-insert race
//    reuses the winner rather than minting a duplicate.
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
// Partial unique index from migration 019 — one member-proposed prep
// placeholder per paper. A 23505 naming it means a concurrent propose won
// the race to create the placeholder meeting.
const MEETINGS_PLACEHOLDER_UNIQUE_INDEX =
  "meetings_propose_placeholder_paper_unique";

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

  // A member-proposed placeholder is a prep reading_group meeting with
  // paper_id set and no planned_by_admin_id (that column is set only on a
  // cycle's canonical meeting). Migration 019's partial unique index keeps
  // at most one such row per paper.
  const findPlaceholder = () =>
    sb
      .from("meetings")
      .select("id")
      .eq("type", "reading_group")
      .eq("status", "prep")
      .is("planned_by_admin_id", null)
      .eq("paper_id", input.paperId)
      .maybeSingle();

  const { data: existing, error: existingError } = await findPlaceholder();
  if (existingError) {
    await logServerAction(
      "proposePaper",
      "failure",
      `paper ${input.paperId}`,
      existingError.message,
    );
    throw new Error(existingError.message);
  }

  // meetings has no member-facing INSERT/DELETE policy — the service client
  // owns the placeholder meeting's lifecycle.
  const svc = createSupabaseServiceClient();
  let meetingId: number;
  let createdMeeting = false;

  if (existing) {
    // Sequential reuse: this paper already has a placeholder, so a repeat
    // propose attaches to it and the paper_suggestions unique check fires.
    meetingId = existing.id;
  } else {
    const { data: meeting, error: meetingError } = await svc
      .from("meetings")
      .insert({
        type: "reading_group",
        status: "prep",
        paper_id: input.paperId,
      })
      .select("id")
      .single();
    if (meetingError) {
      // A concurrent propose of the same paper raced us and inserted its
      // placeholder first — migration 019's unique index now rejects ours.
      // Reuse the winner instead of minting a duplicate.
      const lostPlaceholderRace =
        meetingError.code === POSTGRES_UNIQUE_VIOLATION &&
        meetingError.message.includes(MEETINGS_PLACEHOLDER_UNIQUE_INDEX);
      if (!lostPlaceholderRace) {
        await logServerAction(
          "proposePaper",
          "failure",
          `paper ${input.paperId}`,
          meetingError.message,
        );
        throw new Error(meetingError.message);
      }
      const { data: won, error: wonError } = await findPlaceholder();
      if (wonError || !won) {
        // wonError: the re-query itself failed. !won: the race winner is
        // gone — carry the triggering 23505 so the log shows the sequence.
        await logServerAction(
          "proposePaper",
          "failure",
          `paper ${input.paperId}`,
          wonError?.message ??
            `lost the placeholder race but found no winner (${meetingError.message})`,
        );
        throw new Error(
          wonError?.message ?? "could not resolve placeholder meeting",
        );
      }
      meetingId = won.id;
    } else if (!meeting) {
      await logServerAction(
        "proposePaper",
        "failure",
        `paper ${input.paperId}`,
        "meeting insert returned no row",
      );
      throw new Error("could not create meeting");
    } else {
      meetingId = meeting.id;
      createdMeeting = true;
    }
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
