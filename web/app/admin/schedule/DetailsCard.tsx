"use client";

// The "Meeting details" card: the picked evening, warnings that block or
// colour the booking, the time and venue fields, who's free, and the
// save-draft / schedule actions.
import Link from "next/link";
import { Banner, Button, Card, CardBody, CardFooter, CardHeader, Input } from "@/components/ui";
import type { CandidateDay, Poll } from "@/lib/schedule/poll";
import { formatDayShort, parseTimeLabel } from "@/lib/schedule/format";
import { formatDateNY, formatTimeNY } from "@/lib/time";
import type { ScheduleMeeting } from "@/lib/schedule/loadPoll";
import type { ScheduleResult } from "./actions";

export type DraftState = "idle" | "saved" | "failed";

export function DetailsCard({
  meeting,
  poll,
  selected,
  time,
  location,
  draftState,
  result,
  pending,
  onTimeChange,
  onLocationChange,
  onSaveDraft,
  onSchedule,
}: {
  meeting: ScheduleMeeting;
  poll: Poll;
  selected: CandidateDay | null;
  time: string;
  location: string;
  draftState: DraftState;
  result: ScheduleResult | null;
  pending: boolean;
  onTimeChange: (time: string) => void;
  onLocationChange: (location: string) => void;
  onSaveDraft: () => void;
  onSchedule: () => void;
}) {
  const timeParts = parseTimeLabel(time);
  const leaderBusy = selected?.leader === "busy";
  const leaderUnknown = meeting.leader_id != null && !poll.leaderAnswered;
  const readyToBook = meeting.leader_id != null && meeting.paper != null;
  const scheduled = result?.ok === true ? result : null;
  const unanswered = poll.unansweredNames;

  return (
    <Card>
      <CardHeader>
        <h2 className="heading heading-sm">Meeting details</h2>
      </CardHeader>
      <CardBody>
        <div className="details-stack">
          <div className="field-stack">
            <span className="eyebrow">Date</span>
            <span className="date-big">
              {selected ? formatDayShort(selected.day) : "Pick an evening"}
            </span>
            <span className="small">
              {selected
                ? `${selected.freeCount} of ${poll.answered} free` +
                  (unanswered.length > 0
                    ? ` · ${unanswered.length} ${unanswered.length === 1 ? "hasn’t" : "haven’t"} answered`
                    : "")
                : poll.candidates.length > 0
                  ? "Tap an evening on the calendar."
                  : "No one has answered the poll yet."}
            </span>
          </div>

          {leaderBusy && poll.leaderName && (
            <div className="note-wheat">
              <span className="dot dot-warning" />
              <span>
                Heads up — {poll.leaderName}, who leads this paper, isn’t free that evening.
              </span>
            </div>
          )}
          {leaderUnknown && meeting.leader_name && (
            <div className="note-wheat">
              <span className="dot dot-warning" />
              <span>{meeting.leader_name}, who leads this paper, hasn’t answered the poll yet.</span>
            </div>
          )}
          {!readyToBook && (
            <div className="note-wheat">
              <span className="dot dot-warning" />
              <span>
                Pick a leader and paper first — /wids-pick-leader and /wids-find-paper.
              </span>
            </div>
          )}

          <Input
            label="Start time"
            hint="New York time"
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            error={time.trim() && !timeParts ? "Use a time like 7:00 PM." : undefined}
            disabled={!!scheduled}
            autoComplete="off"
          />
          <Input
            label="Location"
            value={location}
            placeholder="Venue, e.g. Think Coffee, 4th Ave & 11th St"
            onChange={(e) => onLocationChange(e.target.value)}
            disabled={!!scheduled}
            autoComplete="off"
          />

          <div className="who">
            <span className="eyebrow">Who’s free</span>
            <WhoRow dot="dot-free" label="Free" names={selected?.freeNames ?? []} empty="No one yet" />
            <WhoRow dot="dot-busy" label="Not free" names={selected?.busyNames ?? []} empty="No one" />
            <WhoRow dot="dot-warning" label="No answer" names={unanswered} empty="Everyone answered" />
          </div>
        </div>
      </CardBody>
      <CardFooter>
        {scheduled ? (
          <Banner tone="success" title="Scheduled">
            {formatDateNY(scheduled.scheduledAt)} · {formatTimeNY(scheduled.scheduledAt)}.{" "}
            {scheduled.inviteSent ? (
              <>The invite is on its way to all {scheduled.total} members.</>
            ) : (
              <>
                Meeting saved. The calendar invite and RSVP email still need to go out — we logged
                it in the <Link href="/admin/logs">event log</Link>.
              </>
            )}
          </Banner>
        ) : (
          <>
            {result && !result.ok && <p className="footer-error">{result.message}</p>}
            {draftState === "failed" && (
              <p className="footer-error">Couldn’t save a draft in this browser.</p>
            )}
            <div className="footer-actions">
              <Button variant="ghost" onClick={onSaveDraft} disabled={pending || draftState === "saved"}>
                {draftState === "saved" ? "Draft saved" : "Save draft"}
              </Button>
              <Button
                variant="primary"
                iconRight="arrowRight"
                onClick={onSchedule}
                disabled={pending || !selected || !timeParts || !location.trim() || !readyToBook}
              >
                {pending ? "Scheduling…" : "Schedule and send invite"}
              </Button>
            </div>
          </>
        )}
      </CardFooter>
    </Card>
  );
}

function WhoRow({
  dot,
  label,
  names,
  empty,
}: {
  dot: string;
  label: string;
  names: string[];
  empty: string;
}) {
  return (
    <div className="who-row">
      <span className={`dot ${dot}`} />
      <span>
        <b>
          {label} ({names.length})
        </b>{" "}
        <span className="names">{names.length ? names.join(", ") : empty}</span>
      </span>
    </div>
  );
}
