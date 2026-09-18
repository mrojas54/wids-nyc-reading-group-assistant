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

export function formatTimeNY(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NYC,
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
  return nyDayAtTime(yyyyMmDd, hour, 0);
}

// Same as nyDayAtHour, with minutes — the operator's start-time field accepts
// "7:30 PM", which the hour-only helper cannot express.
export function nyDayAtTime(yyyyMmDd: string, hour: number, minute: number): string {
  // Construct a Date "as if" it were in NY tz by computing the offset.
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  const naive = new Date(`${yyyyMmDd}T${hh}:${mm}:00`);
  const nyTime = new Date(naive.toLocaleString("en-US", { timeZone: NYC }));
  const offsetMs = naive.getTime() - nyTime.getTime();
  return new Date(naive.getTime() + offsetMs).toISOString();
}

// The NY calendar day ("YYYY-MM-DD") a TIMESTAMPTZ falls on. Availability rows
// store 6 PM NY as range_start; reading the day back through UTC would be
// right today (22:00Z / 23:00Z) but only by luck of the offset, so go through
// the zone explicitly. en-CA formats as ISO-style Y-M-D.
export function nyDayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NYC,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
