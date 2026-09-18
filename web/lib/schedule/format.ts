// Label helpers for the operator's scheduling view. Everything here works on
// "YYYY-MM-DD" day keys and plain {hour, minute} pairs, never on a Date in
// the machine's local zone, so the same input renders the same label on a
// Vercel box in UTC and a laptop in New York. Storage-bound conversions
// (day + time → TIMESTAMPTZ) live in lib/time.ts.

export type DayParts = { y: number; m: number; d: number };
export type TimeParts = { hour: number; minute: number };
export type MonthRef = { y: number; m: number }; // m is 1-based

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDayKey(key: string): DayParts | null {
  const m = DAY_KEY.exec(key);
  if (!m) return null;
  const parts = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  if (parts.m < 1 || parts.m > 12) return null;
  if (parts.d < 1 || parts.d > daysInMonth(parts.y, parts.m)) return null;
  return parts;
}

export function toDayKey({ y, m, d }: DayParts): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  // Day 0 of the next month is the last day of this one; UTC keeps it
  // independent of the host zone.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = Sunday. The column the 1st of the month lands in on a Sun-first grid. */
export function firstWeekday(y: number, m: number): number {
  return new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
}

function utcDate(parts: DayParts): Date {
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
}

const SHORT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC", weekday: "short", month: "short", day: "numeric",
});
const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC", month: "short", day: "numeric",
});
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC", month: "long", year: "numeric",
});

/** "Thu, Oct 15" — the product's short date form. */
export function formatDayShort(key: string): string {
  const parts = parseDayKey(key);
  return parts ? SHORT.format(utcDate(parts)) : key;
}

/** "Oct 15" */
export function formatMonthDay(key: string): string {
  const parts = parseDayKey(key);
  return parts ? MONTH_DAY.format(utcDate(parts)) : key;
}

/** "October 2026" */
export function formatMonthTitle({ y, m }: MonthRef): string {
  return MONTH_YEAR.format(new Date(Date.UTC(y, m - 1, 1)));
}

/**
 * "Oct 1 – 31" when the poll sits inside one month, "Sep 18 – Oct 31" when it
 * spans two. Empty string when there is nothing in the poll yet.
 */
export function formatPollWindow(days: readonly string[]): string {
  if (days.length === 0) return "";
  const sorted = [...days].sort();
  const first = parseDayKey(sorted[0]);
  const last = parseDayKey(sorted[sorted.length - 1]);
  if (!first || !last) return "";
  if (first.y === last.y && first.m === last.m) {
    return `${formatMonthDay(sorted[0])} – ${last.d}`;
  }
  return `${formatMonthDay(sorted[0])} – ${formatMonthDay(sorted[sorted.length - 1])}`;
}

/**
 * Every month from the earliest poll day to the latest, inclusive, so the
 * calendar can page through a poll that straddles a month boundary. With no
 * poll days at all, just the fallback month (today's).
 */
export function monthsCovering(days: readonly string[], fallback: MonthRef): MonthRef[] {
  const parsed = days.map(parseDayKey).filter((p): p is DayParts => p !== null);
  if (parsed.length === 0) return [fallback];
  let lo = { y: parsed[0].y, m: parsed[0].m };
  let hi = { y: parsed[0].y, m: parsed[0].m };
  for (const p of parsed) {
    if (p.y < lo.y || (p.y === lo.y && p.m < lo.m)) lo = { y: p.y, m: p.m };
    if (p.y > hi.y || (p.y === hi.y && p.m > hi.m)) hi = { y: p.y, m: p.m };
  }
  const out: MonthRef[] = [];
  let cur = lo;
  while (cur.y < hi.y || (cur.y === hi.y && cur.m <= hi.m)) {
    out.push(cur);
    cur = cur.m === 12 ? { y: cur.y + 1, m: 1 } : { y: cur.y, m: cur.m + 1 };
  }
  return out;
}

/**
 * Accepts what an operator would type into "Start time": "7:00 PM", "7 pm",
 * "7:30pm", "19:00", "7". Bare hours 1–6 read as evening (a 7 is 7 PM, a 19
 * is 19:00); nobody schedules a reading group for 7 in the morning.
 */
export function parseTimeLabel(raw: string): TimeParts | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const suffix = m[3]?.[0]; // "a" | "p" | undefined
  if (minute > 59) return null;
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix === "p" && hour !== 12) hour += 12;
    if (suffix === "a" && hour === 12) hour = 0;
  } else {
    if (hour > 23) return null;
    if (hour >= 1 && hour <= 11) hour += 12; // bare "7" is an evening
  }
  return { hour, minute };
}

/** "7:00 PM" */
export function formatTimeLabel({ hour, minute }: TimeParts): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** "Thu, Oct 15 · 7:00 PM" — the form the design system fixes for times. */
export function formatDayAndTime(day: string, time: TimeParts): string {
  return `${formatDayShort(day)} · ${formatTimeLabel(time)}`;
}

/**
 * "Vaswani et al." — a citation-style author line from the papers.authors
 * array. One author: the surname. Two: "A and B". More: first surname et al.
 */
export function formatAuthors(authors: readonly string[] | null | undefined): string | null {
  if (!authors || authors.length === 0) return null;
  const surname = (full: string) => full.trim().split(/\s+/).pop() ?? full;
  if (authors.length === 1) return surname(authors[0]);
  if (authors.length === 2) return `${surname(authors[0])} and ${surname(authors[1])}`;
  return `${surname(authors[0])} et al.`;
}

/** "Kim and Lin", "Kim, Lin and Sam", or just "Kim". */
export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
