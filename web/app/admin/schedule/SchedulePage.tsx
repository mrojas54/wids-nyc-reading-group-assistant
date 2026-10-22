"use client";

// The operator's scheduling view. Every number on this page — the cell
// counts, the details card's lists, the leader heads-up — is read off one
// Poll built from the raw rows, so they cannot drift apart.
import { useEffect, useMemo, useState, useTransition } from "react";
import { Badge, Banner, Brandmark, Button, Icon } from "@/components/ui";
import {
  bestCandidate,
  buildPoll,
  findCandidate,
  type PollMember,
  type PollResponse,
  type PollWindow,
} from "@/lib/schedule/poll";
import { joinNames } from "@/lib/schedule/format";
import { formatDateNY, nyDayKey } from "@/lib/time";
import type { ScheduleMeeting } from "@/lib/schedule/loadPoll";
import {
  requestAvailabilityReminder,
  scheduleMeeting,
  type ReminderResult,
  type ScheduleResult,
} from "./actions";
import { CalendarCard } from "./CalendarCard";
import { DetailsCard, type DraftState } from "./DetailsCard";
import { PaperHero } from "./PaperHero";
import { clearDraft, DEFAULT_TIME, readDraft, writeDraft } from "./draft";

export type SchedulePageProps = {
  viewerName: string | null;
  meeting: ScheduleMeeting | null;
  members: PollMember[];
  responses: PollResponse[];
  excludedDays: string[];
  /** What members could pick from; null when nothing is in prep. */
  pollWindow: PollWindow | null;
  defaultLocation: string | null;
  pollClosesAt: string | null;
  /** NY "today" as YYYY-MM-DD — the month to show when the poll is empty. */
  todayKey: string;
};

export function SchedulePage(props: SchedulePageProps) {
  return (
    <div className="sched">
      <header className="sched-header">
        <Brandmark variant="codex" />
        <div className="sched-header-right">
          <Badge tone="sage">Operator</Badge>
          {props.viewerName && (
            <span className="greet">
              Hi, <b>{props.viewerName}</b>
            </span>
          )}
        </div>
      </header>
      <main className="sched-main">
        <div className="sched-head">
          <div className="eyebrow">
            <Icon name="calendar" size={16} />
            <span>Next meeting</span>
          </div>
          <h1>Schedule the next meeting</h1>
          <p className="sched-lede">
            Pick an evening from the availability poll. When you schedule, we create the calendar
            event and email everyone the RSVP link.
          </p>
        </div>
        {props.meeting ? <Scheduler {...props} meeting={props.meeting} /> : <NothingToSchedule />}
      </main>
    </div>
  );
}

function NothingToSchedule() {
  return (
    <div className="empty-state">
      <div className="es-glyph">
        <Icon name="calendar" size={22} />
      </div>
      <div className="es-title">Sit tight.</div>
      <div className="es-body">
        Nothing to schedule right now — open the next cycle with /wids-meeting-start and the poll
        will show up here.
      </div>
    </div>
  );
}

function Scheduler({
  meeting,
  members,
  responses,
  excludedDays,
  pollWindow,
  defaultLocation,
  pollClosesAt,
  todayKey,
}: SchedulePageProps & { meeting: ScheduleMeeting }) {
  const poll = useMemo(
    () => buildPoll({ members, responses, leaderId: meeting.leader_id, excludedDays }),
    [members, responses, meeting.leader_id, excludedDays],
  );

  const [selectedDay, setSelectedDay] = useState<string | null>(() => bestCandidate(poll));
  const [time, setTime] = useState(DEFAULT_TIME);
  const [location, setLocation] = useState(defaultLocation ?? "");
  const [draftState, setDraftState] = useState<DraftState>("idle");
  const [reminder, setReminder] = useState<"idle" | "pending" | "sent" | "logged" | "error">("idle");
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [pending, startTransition] = useTransition();

  // Restore a pencilled-in draft from this browser. Server render has no
  // localStorage, so this has to happen after mount — a deliberate
  // setState-in-effect, same as the repo's other post-hydration reads.
  useEffect(() => {
    const draft = readDraft(meeting.id);
    if (!draft) return;
    /* eslint-disable react-hooks/set-state-in-effect -- client-only storage, read after hydration on purpose */
    if (draft.day && findCandidate(poll, draft.day)) setSelectedDay(draft.day);
    setTime(draft.time);
    if (draft.location) setLocation(draft.location);
    setDraftState("saved");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [meeting.id, poll]);

  const selected = findCandidate(poll, selectedDay);
  // Compared as NY day keys so render stays pure (no Date.now()).
  const pollClosed = pollClosesAt != null && nyDayKey(pollClosesAt) < todayKey;

  function pick(day: string) {
    setSelectedDay(day);
    setDraftState("idle");
    setResult(null);
  }

  function editTime(value: string) {
    setTime(value);
    setDraftState("idle");
  }

  function editLocation(value: string) {
    setLocation(value);
    setDraftState("idle");
  }

  function saveDraft() {
    setDraftState(writeDraft(meeting.id, { day: selectedDay, time, location }) ? "saved" : "failed");
  }

  function sendReminder() {
    setReminder("pending");
    startTransition(async () => {
      const r: ReminderResult = await requestAvailabilityReminder(meeting.id);
      setReminder(r.ok ? r.mode : "error");
    });
  }

  function schedule() {
    if (!selectedDay) return;
    startTransition(async () => {
      const r = await scheduleMeeting({ meetingId: meeting.id, day: selectedDay, time, location });
      setResult(r);
      if (r.ok) clearDraft(meeting.id);
    });
  }

  const unanswered = poll.unansweredNames;

  return (
    <>
      {unanswered.length > 0 && (
        <Banner
          tone="warning"
          title="Poll still open"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={sendReminder}
              disabled={reminder === "pending" || reminder === "sent" || reminder === "logged"}
            >
              {reminder === "pending"
                ? "Sending…"
                : reminder === "sent"
                  ? "Reminder sent"
                  : reminder === "logged"
                    ? "Reminder logged"
                    : reminder === "error"
                      ? "Try again"
                      : "Send reminder"}
            </Button>
          }
        >
          {pollClosesAt
            ? `Availability ${pollClosed ? "closed" : "closes"} ${formatDateNY(pollClosesAt)} — `
            : ""}
          {joinNames(unanswered)} {unanswered.length === 1 ? "hasn’t" : "haven’t"} answered yet.
          Counts below use the {poll.answered} {poll.answered === 1 ? "answer" : "answers"} so far.
        </Banner>
      )}

      <div className="sched-grid">
        <CalendarCard
          poll={poll}
          pollWindow={pollWindow}
          todayKey={todayKey}
          selectedDay={selectedDay}
          onPick={pick}
        />

        <div className="sched-rail">
          <PaperHero meeting={meeting} />
          <DetailsCard
            meeting={meeting}
            poll={poll}
            selected={selected}
            time={time}
            location={location}
            draftState={draftState}
            result={result}
            pending={pending}
            onTimeChange={editTime}
            onLocationChange={editLocation}
            onSaveDraft={saveDraft}
            onSchedule={schedule}
          />
        </div>
      </div>
    </>
  );
}
