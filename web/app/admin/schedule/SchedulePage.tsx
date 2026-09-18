"use client";

// The operator's scheduling view. Every number on this page — the cell
// counts, the details card's lists, the leader heads-up — is read off one
// Poll built from the raw rows, so they cannot drift apart.
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Badge,
  Banner,
  Brandmark,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Icon,
  Input,
  MeetingTypeBadge,
} from "@/components/ui";
import {
  bestCandidate,
  buildPoll,
  cellAriaLabel,
  findCandidate,
  type CandidateDay,
  type Poll,
  type PollMember,
  type PollResponse,
  type PollWindow,
} from "@/lib/schedule/poll";
import {
  daysInMonth,
  firstWeekday,
  formatAuthors,
  formatDayShort,
  formatMonthTitle,
  formatPollWindow,
  joinNames,
  monthsCovering,
  parseDayKey,
  parseTimeLabel,
  toDayKey,
  type MonthRef,
} from "@/lib/schedule/format";
import { formatDateNY, formatTimeNY, nyDayKey } from "@/lib/time";
import type { ScheduleMeeting } from "@/lib/schedule/loadPoll";
import {
  requestAvailabilityReminder,
  scheduleMeeting,
  type ReminderResult,
  type ScheduleResult,
} from "./actions";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_TIME = "7:00 PM";

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

type Draft = { day: string | null; time: string; location: string };

function draftKey(meetingId: number): string {
  return `sched-draft:${meetingId}`;
}

function readDraft(meetingId: number): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(meetingId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      day: typeof parsed.day === "string" ? parsed.day : null,
      time: typeof parsed.time === "string" ? parsed.time : DEFAULT_TIME,
      location: typeof parsed.location === "string" ? parsed.location : "",
    };
  } catch {
    return null;
  }
}

function writeDraft(meetingId: number, draft: Draft): boolean {
  try {
    window.localStorage.setItem(draftKey(meetingId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

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
  const candidateDays = useMemo(() => poll.candidates.map((c) => c.day), [poll]);
  // The calendar pages over every month members could pick in, not just the
  // ones someone marked — a grey month is information too.
  const windowDays = useMemo(
    () => (pollWindow ? [pollWindow.start, pollWindow.end] : []),
    [pollWindow],
  );
  const months = useMemo<MonthRef[]>(() => {
    const today = parseDayKey(todayKey);
    return monthsCovering(
      [...windowDays, ...candidateDays],
      today ? { y: today.y, m: today.m } : { y: 2026, m: 1 },
    );
  }, [windowDays, candidateDays, todayKey]);

  const [selectedDay, setSelectedDay] = useState<string | null>(() => bestCandidate(poll));
  const [monthIndex, setMonthIndex] = useState(() => indexOfMonth(months, selectedDay));
  const [time, setTime] = useState(DEFAULT_TIME);
  const [location, setLocation] = useState(defaultLocation ?? "");
  const [draftState, setDraftState] = useState<"idle" | "saved" | "failed">("idle");
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
  const timeParts = parseTimeLabel(time);
  const leaderBusy = selected?.leader === "busy";
  const leaderUnknown = meeting.leader_id != null && !poll.leaderAnswered;
  const readyToBook = meeting.leader_id != null && meeting.paper != null;
  const scheduled = result?.ok === true ? result : null;
  // Compared as NY day keys so render stays pure (no Date.now()).
  const pollClosed = pollClosesAt != null && nyDayKey(pollClosesAt) < todayKey;

  function pick(day: string) {
    setSelectedDay(day);
    setDraftState("idle");
    setResult(null);
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
      if (r.ok) {
        try {
          window.localStorage.removeItem(draftKey(meeting.id));
        } catch {}
      }
    });
  }

  const month = months[Math.min(monthIndex, months.length - 1)];
  const legendTop = poll.answered > 7 ? `7 to ${poll.answered}` : "7 or more";
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
        <Card>
          <CardHeader>
            <div className="card-title-row">
              <div className="card-title-stack">
                <h2 className="heading">{formatMonthTitle(month)}</h2>
                <span className="meta">
                  {windowDays.length > 0 ? `Poll window ${formatPollWindow(windowDays)} · ` : ""}
                  {poll.answered} of {poll.total} answered
                </span>
              </div>
              <div className="nav-buttons">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Previous month"
                  disabled={months.length < 2 || monthIndex === 0}
                  onClick={() => setMonthIndex((i) => Math.max(0, i - 1))}
                >
                  <Icon name="chevronLeft" size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Next month"
                  disabled={months.length < 2 || monthIndex >= months.length - 1}
                  onClick={() => setMonthIndex((i) => Math.min(months.length - 1, i + 1))}
                >
                  <Icon name="chevronRight" size={16} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="cal-body">
              <div className="cal-week" aria-hidden="true">
                {WEEKDAYS.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <MonthGrid month={month} poll={poll} selectedDay={selectedDay} onPick={pick} />
              <div className="legend">
                <span>Number = members free that evening, of {poll.answered} who answered.</span>
                <span className="legend-item">
                  <span className="swatch" />3 or fewer
                </span>
                <span className="legend-item">
                  <span className="swatch" data-tier="1" />4 to 5
                </span>
                <span className="legend-item">
                  <span className="swatch" data-tier="2" />6
                </span>
                <span className="legend-item">
                  <span className="swatch" data-tier="3" />
                  {legendTop}
                </span>
                <span className="legend-item">
                  <span className="swatch swatch-selected" />
                  Selected
                </span>
                {poll.leaderName && (
                  <span className="legend-item">
                    <span className="swatch swatch-dashed" />
                    {poll.leaderName}, who leads, isn’t free
                  </span>
                )}
                <span>Grey days aren’t in the poll.</span>
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="sched-rail">
          <PaperHero meeting={meeting} />

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
                      : candidateDays.length > 0
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
                  onChange={(e) => {
                    setTime(e.target.value);
                    setDraftState("idle");
                  }}
                  error={time.trim() && !timeParts ? "Use a time like 7:00 PM." : undefined}
                  disabled={!!scheduled}
                  autoComplete="off"
                />
                <Input
                  label="Location"
                  value={location}
                  placeholder="Venue, e.g. Think Coffee, 4th Ave & 11th St"
                  onChange={(e) => {
                    setLocation(e.target.value);
                    setDraftState("idle");
                  }}
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
                    <Button variant="ghost" onClick={saveDraft} disabled={pending || draftState === "saved"}>
                      {draftState === "saved" ? "Draft saved" : "Save draft"}
                    </Button>
                    <Button
                      variant="primary"
                      iconRight="arrowRight"
                      onClick={schedule}
                      disabled={pending || !selected || !timeParts || !location.trim() || !readyToBook}
                    >
                      {pending ? "Scheduling…" : "Schedule and send invite"}
                    </Button>
                  </div>
                </>
              )}
            </CardFooter>
          </Card>
        </div>
      </div>
    </>
  );
}

function indexOfMonth(months: MonthRef[], day: string | null): number {
  const parts = day ? parseDayKey(day) : null;
  if (!parts) return 0;
  const i = months.findIndex((m) => m.y === parts.y && m.m === parts.m);
  return i < 0 ? 0 : i;
}

function MonthGrid({
  month,
  poll,
  selectedDay,
  onPick,
}: {
  month: MonthRef;
  poll: Poll;
  selectedDay: string | null;
  onPick: (day: string) => void;
}) {
  const leading = firstWeekday(month.y, month.m);
  const total = daysInMonth(month.y, month.m);
  const byDay = new Map(poll.candidates.map((c) => [c.day, c]));
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < leading; i++) {
    cells.push(<div className="cal-cell" key={`blank-${i}`} aria-hidden="true" />);
  }
  for (let d = 1; d <= total; d++) {
    const key = toDayKey({ y: month.y, m: month.m, d });
    const c = byDay.get(key);
    cells.push(
      <div className="cal-cell" key={key}>
        {c ? (
          <DayCell c={c} poll={poll} selected={key === selectedDay} onPick={onPick} />
        ) : (
          <div className="cal-plain" aria-hidden="true">
            {d}
          </div>
        )}
      </div>,
    );
  }
  return (
    <div role="group" aria-label={`Candidate evenings in ${formatMonthTitle(month)}`} className="cal-days">
      {cells}
    </div>
  );
}

function DayCell({
  c,
  poll,
  selected,
  onPick,
}: {
  c: CandidateDay;
  poll: Poll;
  selected: boolean;
  onPick: (day: string) => void;
}) {
  const busy = c.leader === "busy";
  return (
    <button
      type="button"
      className="cal-day"
      aria-pressed={selected}
      aria-label={cellAriaLabel(c, poll, selected)}
      data-tier={busy ? undefined : c.tier}
      data-leader={busy ? "busy" : undefined}
      onClick={() => onPick(c.day)}
    >
      <span className="cal-day-num">{parseDayKey(c.day)?.d}</span>
      <span className="cal-day-meta">{c.freeCount} free</span>
      {busy && poll.leaderName && <span className="cal-day-lead">{poll.leaderName} not free</span>}
    </button>
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

function PaperHero({ meeting }: { meeting: ScheduleMeeting }) {
  const paper = meeting.paper;
  const authors = formatAuthors(paper?.authors);
  const byline = [
    [authors, paper?.year].filter(Boolean).join(", "),
    meeting.leader_name ? `Led by ${meeting.leader_name}` : "No leader yet",
  ]
    .filter(Boolean)
    .join(" · ");
  const isArxiv = !!paper?.url && /arxiv\.org/i.test(paper.url);
  return (
    <Card variant="hero">
      <CardBody>
        <div className="hero-stack">
          <div className="hero-eyebrow-row">
            <MeetingTypeBadge type="reading_group" />
            <span className="eyebrow">Next paper</span>
          </div>
          <h2 className="heading">{paper ? paper.title : "No paper picked yet"}</h2>
          <p className="small" style={{ margin: 0 }}>
            {paper ? byline : "Pick one with /wids-find-paper, then come back to schedule."}
          </p>
          {paper && (
            <div className="hero-links">
              {paper.url && (
                <a className="hero-link" href={paper.url} target="_blank" rel="noreferrer">
                  {isArxiv ? "arXiv" : "Paper"} <Icon name="external" size={16} />
                </a>
              )}
              {paper.hasPaperPal ? (
                <Link className="hero-link" href={`/papers/${paper.id}`}>
                  Paper Pal <Icon name="check" size={16} />
                </Link>
              ) : (
                <span className="hero-note">
                  <Icon name="clock" size={16} />
                  Paper Pal not yet synthesized
                </span>
              )}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
