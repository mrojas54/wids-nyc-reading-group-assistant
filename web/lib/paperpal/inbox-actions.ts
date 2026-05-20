"use server";

// Server actions for the PaperPal Inbox "Want to lead" section.
//  • volunteerForMeeting — a member raises their hand to lead a meeting.
//    Writes volunteers(meeting_id, member_id) via the RLS-scoped client
//    (insert-as-self policy). UNIQUE(meeting_id, member_id) makes a repeat
//    click a no-op.
//  • proposePaper — a member proposes a catalog paper. Because
//    paper_suggestions.meeting_id is NOT NULL and meetings has no member
//    INSERT policy, this creates a placeholder reading_group meeting via
//    the service client, then attaches the suggestion to it.
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { logServerAction } from "@/lib/log";

const POSTGRES_UNIQUE_VIOLATION = "23505";

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

  // A repeat volunteer hits UNIQUE(meeting_id, member_id) — treat as success.
  if (error && error.code !== POSTGRES_UNIQUE_VIOLATION) {
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
  const { error: suggestionError } = await svc.from("paper_suggestions").insert({
    meeting_id: meeting.id,
    paper_id: input.paperId,
    suggested_by: memberId,
    source: "member",
    notes: note ? note : null,
  });

  if (suggestionError) {
    // Don't leave an orphan placeholder meeting behind.
    await svc.from("meetings").delete().eq("id", meeting.id);
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
