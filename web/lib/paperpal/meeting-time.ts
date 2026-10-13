/** Meeting instants are stored in UTC and displayed in the NYC chapter's zone. */
export function formatMeetingTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
