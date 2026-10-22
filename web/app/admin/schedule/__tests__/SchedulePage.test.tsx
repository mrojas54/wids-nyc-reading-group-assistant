/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { SchedulePage, type SchedulePageProps } from "../SchedulePage";
import { LEADER_ID, MEMBERS, OCT, RESPONSES } from "@/lib/schedule/__tests__/fixture";

const scheduleMeeting = vi.fn();
const requestAvailabilityReminder = vi.fn();
vi.mock("../actions", () => ({
  scheduleMeeting: (...args: unknown[]) => scheduleMeeting(...args),
  requestAvailabilityReminder: (...args: unknown[]) => requestAvailabilityReminder(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  scheduleMeeting.mockReset();
  requestAvailabilityReminder.mockReset();
  window.localStorage.clear();
});

const props: SchedulePageProps = {
  viewerName: "Alice",
  meeting: {
    id: 41,
    created_at: "2026-09-27T14:00:00.000Z",
    leader_id: LEADER_ID,
    leader_name: "Maya",
    paper: {
      id: 7,
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      year: 2017,
      url: "https://arxiv.org/abs/1706.03762",
      hasPaperPal: false,
    },
  },
  members: MEMBERS,
  responses: RESPONSES,
  excludedDays: [],
  pollWindow: { start: "2026-10-01", end: "2026-10-31" },
  defaultLocation: "Brooklyn Public Library, Central branch",
  pollClosesAt: "2026-10-04T14:00:00.000Z",
  todayKey: "2026-09-30",
};

describe("SchedulePage", () => {
  it("opens on the best evening, pressed, with the full cell label", () => {
    render(<SchedulePage {...props} />);
    const best = screen.getByRole("button", { name: "Thu, Oct 15: 7 of 8 free, selected" });
    expect(best).toHaveAttribute("aria-pressed", "true");
    expect(best).toHaveAttribute("data-tier", "3");
    expect(screen.getByText("Thu, Oct 15")).toBeInTheDocument();
    expect(screen.getByText("7 of 8 free · 2 haven’t answered")).toBeInTheDocument();
  });

  it("draws leader-busy evenings dashed and untinted, and grey days as non-interactive", () => {
    render(<SchedulePage {...props} />);
    const busy = screen.getByRole("button", { name: "Tue, Oct 6: 5 of 8 free, Maya who leads is not free" });
    expect(busy).toHaveAttribute("data-leader", "busy");
    expect(busy).not.toHaveAttribute("data-tier");
    expect(within(busy).getByText("Maya not free")).toBeInTheDocument();
    // Oct 2 is not in the poll: a plain number, not a button.
    expect(screen.queryByRole("button", { name: /Oct 2:/ })).toBeNull();
    expect(screen.getAllByRole("button").filter((b) => b.textContent === "2")).toHaveLength(0);
  });

  it("names who has not answered in the poll banner", () => {
    render(<SchedulePage {...props} />);
    expect(screen.getByText(/Kim and Lin haven’t answered yet/)).toBeInTheDocument();
    expect(screen.getByText(/Availability closes Sun, Oct 4/)).toBeInTheDocument();
    expect(screen.getByText("Poll window Oct 1 – 31 · 8 of 10 answered")).toBeInTheDocument();
  });

  it("pages across months when the window straddles one, and not otherwise", () => {
    const { unmount } = render(<SchedulePage {...props} />);
    expect(screen.getByRole("button", { name: "Previous month" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
    unmount();

    render(<SchedulePage {...props} pollWindow={{ start: "2026-09-27", end: "2026-10-31" }} />);
    // Opens on the month holding the best evening (October); September is one page back.
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
    const prev = screen.getByRole("button", { name: "Previous month" });
    expect(prev).not.toBeDisabled();
    fireEvent.click(prev);
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    expect(screen.getByText("Poll window Sep 27 – Oct 31 · 8 of 10 answered")).toBeInTheDocument();
  });

  it("re-derives the details card and the leader heads-up from the picked cell", () => {
    render(<SchedulePage {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Tue, Oct 6:/ }));
    expect(screen.getByText("Tue, Oct 6")).toBeInTheDocument();
    expect(screen.getByText("5 of 8 free · 2 haven’t answered")).toBeInTheDocument();
    expect(screen.getByText(/Heads up — Maya, who leads this paper, isn’t free/)).toBeInTheDocument();
    expect(screen.getByText("Free (5)")).toBeInTheDocument();
    expect(screen.getByText("Priya, Jules, Sofia, Tasha, Dana")).toBeInTheDocument();
    expect(screen.getByText("Not free (3)")).toBeInTheDocument();
    expect(screen.getByText("Maya, Anaïs, Renée")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tue, Oct 6: 5 of 8 free, Maya who leads is not free, selected" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Thu, Oct 15: 7 of 8 free" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("schedules the picked evening with the typed time and venue, then shows the result", async () => {
    // 7:30 PM EDT on Oct 15 — what the action would store for the typed time.
    scheduleMeeting.mockResolvedValue({
      ok: true,
      scheduledAt: "2026-10-15T23:30:00.000Z",
      inviteSent: false,
      total: 10,
    });
    render(<SchedulePage {...props} />);
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "7:30 PM" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule and send invite" }));
    expect(await screen.findByText("Scheduled")).toBeInTheDocument();
    expect(scheduleMeeting).toHaveBeenCalledWith({
      meetingId: 41,
      day: OCT(15),
      time: "7:30 PM",
      location: "Brooklyn Public Library, Central branch",
    });
    expect(screen.getByText(/Thu, Oct 15 · 7:30 PM/)).toBeInTheDocument();
    expect(screen.getByText(/still need to go out/)).toBeInTheDocument();
  });

  it("disables scheduling while the time is unparseable", () => {
    render(<SchedulePage {...props} />);
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "seven-ish" } });
    expect(screen.getByText("Use a time like 7:00 PM.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule and send invite" })).toBeDisabled();
  });

  it("flips the reminder button to the logged state", async () => {
    requestAvailabilityReminder.mockResolvedValue({ ok: true, mode: "logged" });
    render(<SchedulePage {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Send reminder" }));
    expect(await screen.findByRole("button", { name: "Reminder logged" })).toBeDisabled();
    expect(requestAvailabilityReminder).toHaveBeenCalledWith(41);
  });

  it("shows the empty state when nothing is in prep", () => {
    render(<SchedulePage {...props} meeting={null} />);
    expect(screen.getByText("Sit tight.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /free/ })).toBeNull();
  });
});
