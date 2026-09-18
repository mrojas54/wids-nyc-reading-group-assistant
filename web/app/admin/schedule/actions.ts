"use server";

import { revalidatePath } from "next/cache";
import { requireOperatorRole } from "@/lib/auth/requireOperatorRole";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { logServerAction } from "@/lib/log";
import { isDayBlackedOut } from "@/lib/blackout";
import { nyDayAtTime, nyDayKey } from "@/lib/time";
import { parseDayKey, parseTimeLabel } from "@/lib/schedule/format";
import { createCalendarEventAndSendInvites } from "@/lib/schedule/invites";

export type ScheduleInput = {
  meetingId: number;
  /** YYYY-MM-DD, one of the poll's candidate evenings. */
  day: string;
  /** As typed: "7:00 PM". */
  time: string;
  location: string;
};

export type ScheduleResult =
  | {
      ok: true;
      scheduledAt: string;
      /** False while createCalendarEventAndSendInvites is a stub. */
      inviteSent: boolean;
      /** Active members on the roster — who the invite goes (or will go) to. */
      total: number;
    }
  | { ok: false; message: string };

async function gate(): Promise<{ ok: true; actor: string } | { ok: false; message: string }> {
  try {
    const ctx = await requireOperatorRole();
    return { ok: true, actor: `member:${ctx.userId}` };
  } catch {
    return { ok: false, message: "Only the operator can schedule meetings." };
  }
}

/**
 * Book the reading group: the same row changes /wids-schedule-reading-group
 * Step 6 makes (scheduled_at, location, status='scheduled', an attendance row
 * per active member), then the calendar event and RSVP email through
 * createCalendarEventAndSendInvites — which is a stub today, so the action
 * logs `needs_action` and tells the caller the invite did not go out.
 *
 * Service client for every write: meetings and meeting_attendance have no
 * member-facing INSERT/UPDATE policy (migrations 008, 030).
 */
export async function scheduleMeeting(input: ScheduleInput): Promise<ScheduleResult> {
  const auth = await gate();
  if (!auth.ok) return auth;

  const day = parseDayKey(input.day) ? input.day : null;
  if (!day) return { ok: false, message: "Pick an evening from the poll first." };
  const time = parseTimeLabel(input.time);
  if (!time) return { ok: false, message: "Enter a start time like 7:00 PM." };
  const location = input.location.trim();
  if (!location) return { ok: false, message: "Enter a location." };

  const svc = createSupabaseServiceClient();

  const { data: meeting, error: meetingError } = await svc
    .from("meetings")
    .select("id, type, status, leader_id, paper_id, planned_by_admin_id, members:leader_id(name), papers:paper_id(title)")
    .eq("id", input.meetingId)
    .maybeSingle();
  if (meetingError || !meeting) return { ok: false, message: "We couldn't find that meeting." };
  if (meeting.type !== "reading_group" || meeting.status !== "prep" || meeting.planned_by_admin_id == null) {
    return { ok: false, message: "This meeting isn't waiting to be scheduled." };
  }
  if (meeting.leader_id == null || meeting.paper_id == null) {
    return { ok: false, message: "Pick a leader and paper first." };
  }

  // The evening has to be one someone actually marked, and not since
  // blacked out — the calendar greys both, but the client is not the gate.
  const [availabilityRes, blackoutRes] = await Promise.all([
    svc.from("availability").select("range_start").eq("meeting_id", meeting.id),
    svc.from("blackout_periods").select("range_start, range_end"),
  ]);
  if (availabilityRes.error) return { ok: false, message: "We couldn't read the poll — try again." };
  if (blackoutRes.error) return { ok: false, message: "We couldn't read the blackout windows — try again." };
  const inPoll = (availabilityRes.data ?? []).some((r) => nyDayKey(r.range_start) === day);
  if (!inPoll) return { ok: false, message: "That evening isn't in the poll." };
  if (isDayBlackedOut(day, blackoutRes.data ?? [])) {
    return { ok: false, message: "That evening falls in a blackout window." };
  }

  const scheduledAt = nyDayAtTime(day, time.hour, time.minute);

  // status='prep' in the WHERE makes a double submit a no-op instead of a
  // second booking; zero rows back means someone else got there first.
  const { data: updated, error: updateError } = await svc
    .from("meetings")
    .update({ scheduled_at: scheduledAt, location, status: "scheduled" })
    .eq("id", meeting.id)
    .eq("status", "prep")
    .select("id");
  if (updateError) {
    await logServerAction("scheduleMeeting", "failure", `meeting ${meeting.id}`, updateError.message, {
      actor: auth.actor,
    });
    return { ok: false, message: "We couldn't save the meeting — try again." };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, message: "This meeting was already scheduled." };
  }

  const { data: roster, error: rosterError } = await svc
    .from("members")
    .select("id, email")
    .eq("active", true);
  if (rosterError) {
    await logServerAction("scheduleMeeting", "failure", `meeting ${meeting.id}: roster`, rosterError.message, {
      actor: auth.actor,
    });
    return { ok: false, message: "Saved the date, but couldn't read the roster for the invite." };
  }
  const members = roster ?? [];
  if (members.length > 0) {
    const { error: attendanceError } = await svc.from("meeting_attendance").upsert(
      members.map((m) => ({ meeting_id: meeting.id, member_id: m.id, rsvp_status: "no_response" })),
      { onConflict: "meeting_id,member_id", ignoreDuplicates: true },
    );
    if (attendanceError) {
      await logServerAction(
        "scheduleMeeting",
        "failure",
        `meeting ${meeting.id}: attendance rows`,
        attendanceError.message,
        { actor: auth.actor },
      );
      return { ok: false, message: "Saved the date, but couldn't open RSVPs — check the event log." };
    }
  }

  const invite = await createCalendarEventAndSendInvites({
    meetingId: meeting.id,
    scheduledAt,
    location,
    paperTitle: meeting.papers?.title ?? null,
    leaderName: meeting.members?.name ?? null,
    attendeeEmails: members.map((m) => m.email),
  });

  // When the stub is replaced, persist invite.calendarEventId /
  // invite.calendarHtmlLink onto the row here (migration 028 columns). The
  // generated database.types.ts predates that migration, so the write is
  // left to the same change that regenerates the types.

  await logServerAction(
    "scheduleMeeting",
    invite.sent ? "success" : "needs_action",
    invite.sent
      ? `Scheduled reading_group ${meeting.id} at ${scheduledAt} at ${location}; invited ${members.length} members`
      : `Scheduled reading_group ${meeting.id} at ${scheduledAt} at ${location} — calendar invite and RSVP email NOT sent: ${invite.reason}`,
    undefined,
    {
      actor: auth.actor,
      metadata: {
        kind: "schedule_meeting",
        meeting_id: meeting.id,
        scheduled_at: scheduledAt,
        location,
        invite_sent: invite.sent,
        attendees: members.length,
      },
    },
  );

  // Members see the date on the dashboard hero and /me/rsvps; this page goes
  // to its empty state once nothing is left in prep.
  revalidatePath("/dashboard");
  revalidatePath("/me/rsvps");
  revalidatePath("/admin/schedule");

  return { ok: true, scheduledAt, inviteSent: invite.sent, total: members.length };
}

export type ReminderResult =
  | { ok: true; mode: "sent" | "logged" }
  | { ok: false; message: string };

/**
 * "Send reminder" on the poll banner. Reminder email is drafted by the
 * availability-chase task (scheduled_tasks/availability-chase.md, reply
 * 'remind'), not by the portal, so this records the operator's request as a
 * `needs_action` row the next chase run — or the operator — can act on.
 * One row per meeting per day; a double click is a no-op.
 */
export async function requestAvailabilityReminder(meetingId: number): Promise<ReminderResult> {
  const auth = await gate();
  if (!auth.ok) return auth;

  const svc = createSupabaseServiceClient();
  const { data: meeting } = await svc
    .from("meetings")
    .select("id, status")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting || meeting.status !== "prep") {
    return { ok: false, message: "This poll isn't open any more." };
  }

  const today = nyDayKey(new Date());
  await logServerAction(
    "requestAvailabilityReminder",
    "needs_action",
    `Operator asked for availability reminders for meeting ${meetingId} — draft them with availability-chase 'remind'`,
    undefined,
    {
      actor: auth.actor,
      idempotencyKey: `availability-reminder-request:meeting=${meetingId}:day=${today}`,
      metadata: { kind: "availability_reminder_requested", meeting_id: meetingId },
    },
  );
  return { ok: true, mode: "logged" };
}
