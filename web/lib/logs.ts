// Read + view-model layer for the /admin/logs operator page.
//
// Data source is the `command_log` table (migrations/001 + 002). That table is
// intentionally RLS-locked with no policy (see migrations/003), so reads MUST go
// through the service-role client and behind requireLeaderRole().
//
// The design (Claude Design handoff "Status Dashboard") asks for richer fields
// than the table stores — `severity`, `who`, and a JSON `context`. We DERIVE
// `severity` from `status`, and read the rest from real columns:
//   - severity   ← status            (failure→error, no_action/needs_action→warn,
//                                     success→info)
//   - who        ← actor             (migration 020; renders "—" when null)
//   - durMs      ← duration_ms       (migration 020; drives the duration sort)
//   - context    ← {source, name, status, ran_at} plus the migration-020
//                  enrichment (idempotencyKey, durationMs, metadata) when present
// mapCommandLogRow is the single place these columns are wired in.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatDateTimeNY } from "@/lib/time";

// `source` is constrained in the DB to these three. We keep `edge_function` in
// the UI vocabulary (the design includes it) even though no row carries it yet.
export type LogSource =
  | "server_action"
  | "edge_function"
  | "scheduled_task"
  | "slash_command";
// `needs_action` (migration 029) means the run did its own work and a human must
// now act for the outcome to be real — the canonical case is a scheduled task
// that can only create a Gmail draft, because the Gmail MCP exposes no send
// tool. It is deliberately distinct from `no_action` ("there was nothing to
// do"): both are warn, but only one is waiting on a person.
export type LogStatus = "success" | "failure" | "no_action" | "needs_action";
export type LogSeverity = "info" | "warn" | "error";

// Shape of a raw command_log row as returned by Supabase.
export type CommandLogRow = {
  id: number;
  ran_at: string;
  source: LogSource;
  name: string;
  status: LogStatus;
  summary: string | null;
  error: string | null;
  // Migration-020 enrichment columns (nullable; metadata defaults to {} in DB).
  duration_ms: number | null;
  actor: string | null;
  metadata: Record<string, unknown> | null;
  idempotency_key: string | null;
};

// The view-model the UI renders.
export type LogEvent = {
  id: string;
  ranAt: string;
  rel: string;
  tsAbs: string;
  source: LogSource;
  name: string;
  status: LogStatus;
  sev: LogSeverity;
  who: string | null;
  summary: string;
  durMs: number | null;
  context: Record<string, unknown>;
  error: string | null;
};

export type TimeRange = "24h" | "7d" | "30d";
export type SortMode = "recent" | "duration_desc";

export type LogFilters = {
  source: LogSource | "all";
  sev: LogSeverity | "all";
  range: TimeRange;
  q: string;
  sort: SortMode;
  name: string | null;
};

export const DEFAULT_FILTERS: LogFilters = {
  source: "all",
  sev: "all",
  range: "24h",
  q: "",
  sort: "recent",
  name: null,
};

const RANGE_MS: Record<TimeRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

// ----------------------------------------------------------------------------
// Pure helpers (unit-tested in __tests__/logs.test.ts)
// ----------------------------------------------------------------------------

export function deriveSeverity(status: LogStatus): LogSeverity {
  if (status === "failure") return "error";
  if (status === "no_action" || status === "needs_action") return "warn";
  return "info";
}

// Compact relative time: "just now", "4m ago", "2h ago", "1d ago".
export function relativeTime(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - Date.parse(iso));
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function mapCommandLogRow(rowData: CommandLogRow, nowMs: number): LogEvent {
  const context: Record<string, unknown> = {
    source: rowData.source,
    name: rowData.name,
    status: rowData.status,
    ranAt: rowData.ran_at,
  };
  // Surface the migration-020 enrichment in the expandable context pane, but
  // only when it carries signal — an empty metadata {} or null column is noise.
  if (rowData.idempotency_key) context.idempotencyKey = rowData.idempotency_key;
  if (rowData.duration_ms != null) context.durationMs = rowData.duration_ms;
  if (rowData.metadata && Object.keys(rowData.metadata).length > 0) {
    context.metadata = rowData.metadata;
  }

  return {
    id: String(rowData.id),
    ranAt: rowData.ran_at,
    rel: relativeTime(rowData.ran_at, nowMs),
    tsAbs: formatDateTimeNY(rowData.ran_at),
    source: rowData.source,
    name: rowData.name,
    status: rowData.status,
    sev: deriveSeverity(rowData.status),
    who: rowData.actor ?? null,
    summary: rowData.summary ?? "",
    durMs: rowData.duration_ms ?? null,
    context,
    error: rowData.error ?? null,
  };
}

export type HeaderSummary =
  | { state: "healthy" }
  | { state: "error"; count: 1; mostRecent: LogEvent }
  | { state: "multi"; count: number; mostRecent: LogEvent }
  | { state: "warn"; count: number; mostRecent: LogEvent }
  | { state: "failed" };

// Distil the sticky banner state from the most recent 24h of events.
// `events` is assumed newest-first (the order listCommandLog returns).
export function summarizeHeader(events: LogEvent[], nowMs: number): HeaderSummary {
  const cutoff = nowMs - RANGE_MS["24h"];
  const recent = events.filter((e) => Date.parse(e.ranAt) >= cutoff);
  const errors = recent.filter((e) => e.sev === "error");
  const warns = recent.filter((e) => e.sev === "warn");

  if (errors.length === 1) return { state: "error", count: 1, mostRecent: errors[0] };
  if (errors.length > 1) return { state: "multi", count: errors.length, mostRecent: errors[0] };
  if (warns.length > 0) return { state: "warn", count: warns.length, mostRecent: warns[0] };
  return { state: "healthy" };
}

function matchesQuery(ev: LogEvent, q: string): boolean {
  if (!q) return true;
  const hay = [ev.name, ev.who ?? "", ev.summary, ev.source, ev.error ?? ""]
    .join(" ")
    .toLowerCase();
  return hay.includes(q.trim().toLowerCase());
}

export function applyLogFilters(
  events: LogEvent[],
  f: LogFilters,
  nowMs: number,
): LogEvent[] {
  const cutoff = nowMs - RANGE_MS[f.range];
  let out = events.filter((ev) => {
    if (Date.parse(ev.ranAt) < cutoff) return false;
    if (f.source !== "all" && ev.source !== f.source) return false;
    if (f.sev !== "all" && ev.sev !== f.sev) return false;
    if (f.name && ev.name !== f.name) return false;
    if (!matchesQuery(ev, f.q)) return false;
    return true;
  });
  // Sort-by-duration only surfaces for edge functions (design rule). durMs is
  // null today, so this is a stable no-op until a duration column exists.
  if (f.source === "edge_function" && f.sort === "duration_desc") {
    out = out.slice().sort((a, b) => (b.durMs ?? 0) - (a.durMs ?? 0));
  }
  return out;
}

// ----------------------------------------------------------------------------
// Preset shortcut chips (linkability examples from the brief)
// ----------------------------------------------------------------------------

export type Preset = {
  id: string;
  label: string;
  dot: "err" | "slow" | "r404";
  apply: Partial<LogFilters>;
};

export const PRESETS: Preset[] = [
  {
    id: "broke",
    label: "What broke today",
    dot: "err",
    apply: { source: "server_action", sev: "error", range: "24h", name: null, sort: "recent" },
  },
  {
    id: "slow",
    label: "Slowest LLM calls",
    dot: "slow",
    apply: { source: "edge_function", sev: "all", range: "7d", name: null, sort: "duration_desc" },
  },
  {
    id: "r404",
    label: "Recent 404s",
    dot: "r404",
    apply: { source: "all", sev: "all", range: "24h", name: "page_404", sort: "recent" },
  },
];

export function presetActive(f: LogFilters, p: Preset): boolean {
  const keys = Object.keys(p.apply) as (keyof LogFilters)[];
  return keys.every((k) => f[k] === p.apply[k]) && !f.q;
}

// ----------------------------------------------------------------------------
// DB read (service-role client only — command_log is RLS-locked)
// ----------------------------------------------------------------------------

export type ListResult = {
  events: LogEvent[];
  total: number; // approx count in the widest (30d) window
  nextCursor: string | null; // ran_at of the oldest row, for keyset "Load more"
};

export type ListOptions = {
  limit?: number;
  before?: string | null; // keyset: only rows with ran_at < before
  nowMs?: number;
};

export async function listCommandLog(
  sb: SupabaseClient<Database>,
  opts: ListOptions = {},
): Promise<ListResult> {
  const limit = opts.limit ?? 50;
  const nowMs = opts.nowMs ?? Date.now();

  let query = sb
    .from("command_log")
    .select(
      "id, ran_at, source, name, status, summary, error, duration_ms, actor, metadata, idempotency_key",
    )
    .order("ran_at", { ascending: false })
    .limit(limit);

  if (opts.before) query = query.lt("ran_at", opts.before);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as CommandLogRow[];
  const events = rows.map((r) => mapCommandLogRow(r, nowMs));

  // Approximate "of ~N in this window" — count rows in the last 30 days.
  const since = new Date(nowMs - RANGE_MS["30d"]).toISOString();
  const { count } = await sb
    .from("command_log")
    .select("id", { count: "estimated", head: true })
    .gte("ran_at", since);

  return {
    events,
    total: count ?? events.length,
    nextCursor: rows.length === limit ? rows[rows.length - 1].ran_at : null,
  };
}
