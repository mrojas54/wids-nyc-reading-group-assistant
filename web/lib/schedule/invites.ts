// STUB — the portal has no Google Calendar client and no email sender.
//
// Today a reading group is booked by /wids-schedule-reading-group, which uses
// the Calendar MCP (Step 5: create the event, invite every active member,
// capture `id` + `htmlLink`) and then writes those ids onto the meeting row
// (Step 6, migration 028). The RSVP email likewise goes out through the Gmail
// MCP as an operator-sent draft. Neither MCP is reachable from a Next.js
// server action, so this function exists to give scheduleMeeting one named
// seam to call — and to make the gap visible instead of silent: it returns
// `sent: false`, the action logs `needs_action`, and /admin/logs renders that
// row amber for the operator.
//
// Wiring it for real means: a Google Calendar API credential for the group's
// calendar, an events.insert with attendees + sendUpdates, then persisting
// calendar_event_id / calendar_html_link, then the RSVP email (templates in
// assets/emails/template/). Keep the return shape; the UI keys its copy on it.

export type InviteRequest = {
  meetingId: number;
  /** ISO TIMESTAMPTZ of the start. */
  scheduledAt: string;
  location: string;
  paperTitle: string | null;
  leaderName: string | null;
  attendeeEmails: string[];
};

export type InviteResult =
  | { sent: true; calendarEventId: string; calendarHtmlLink: string }
  | { sent: false; reason: string };

export async function createCalendarEventAndSendInvites(
  _request: InviteRequest,
): Promise<InviteResult> {
  return {
    sent: false,
    reason:
      "Calendar event and RSVP email are not wired in the portal yet — create the event with /wids-schedule-reading-group Step 5 and store calendar_event_id / calendar_html_link on the meeting row.",
  };
}
