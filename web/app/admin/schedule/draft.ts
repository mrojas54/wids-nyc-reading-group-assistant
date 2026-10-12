// Pencilled-in schedule drafts, kept in this browser's localStorage per
// meeting. Every call swallows storage errors: private windows and blocked
// site data must not break the page.
export const DEFAULT_TIME = "7:00 PM";

export type Draft = { day: string | null; time: string; location: string };

function draftKey(meetingId: number): string {
  return `sched-draft:${meetingId}`;
}

export function readDraft(meetingId: number): Draft | null {
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

export function writeDraft(meetingId: number, draft: Draft): boolean {
  try {
    window.localStorage.setItem(draftKey(meetingId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(meetingId: number): void {
  try {
    window.localStorage.removeItem(draftKey(meetingId));
  } catch {}
}
