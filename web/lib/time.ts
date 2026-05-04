// Format a TIMESTAMPTZ in America/New_York for display.
const NYC = "America/New_York";

export function formatDateTimeNY(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NYC,
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(d);
}

export function formatDateNY(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NYC,
    weekday: "short", month: "short", day: "numeric",
  }).format(d);
}

// Build a TIMESTAMPTZ for a given calendar day at a given hour in NY local time.
// Returns ISO string suitable for storing in postgres.
export function nyDayAtHour(yyyyMmDd: string, hour: number): string {
  // Construct a Date "as if" it were in NY tz by computing the offset.
  const naive = new Date(`${yyyyMmDd}T${String(hour).padStart(2, "0")}:00:00`);
  const nyTime = new Date(naive.toLocaleString("en-US", { timeZone: NYC }));
  const offsetMs = naive.getTime() - nyTime.getTime();
  return new Date(naive.getTime() + offsetMs).toISOString();
}
