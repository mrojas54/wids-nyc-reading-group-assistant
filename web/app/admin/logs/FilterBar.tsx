"use client";

// Source/severity pills, time range, search, and the conditional sort dropdown
// (visible only when Source = Edge function, per the brief).
import type { LogFilters, LogSeverity, LogSource } from "@/lib/logs";
import { IconChevDown, IconSearch } from "./icons";

const SOURCE_OPTS: { v: LogSource | "all"; label: string }[] = [
  { v: "all", label: "All" },
  { v: "server_action", label: "Server action" },
  { v: "edge_function", label: "Edge function" },
  { v: "scheduled_task", label: "Scheduled task" },
  { v: "slash_command", label: "Slash command" },
];
const SEV_OPTS: { v: LogSeverity | "all"; label: string }[] = [
  { v: "all", label: "All" },
  { v: "info", label: "Info" },
  { v: "warn", label: "Warn" },
  { v: "error", label: "Error" },
];

type Props = {
  filters: LogFilters;
  set: (patch: Partial<LogFilters>) => void;
};

export function FilterBar({ filters, set }: Props) {
  const showSort = filters.source === "edge_function";
  return (
    <div className="filterbar">
      <div className="filtergroup" role="group" aria-label="Source">
        <span className="grp-lbl">Source</span>
        {SOURCE_OPTS.map((o) => (
          <button
            key={o.v}
            type="button"
            className={"pill" + (filters.source === o.v ? " is-on" : "")}
            aria-pressed={filters.source === o.v}
            onClick={() => set({ source: o.v })}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="filtergroup" role="group" aria-label="Severity">
        <span className="grp-lbl">Severity</span>
        {SEV_OPTS.map((o) => (
          <button
            key={o.v}
            type="button"
            className={"pill" + (filters.sev === o.v ? " is-on sev-" + o.v : "")}
            aria-pressed={filters.sev === o.v}
            onClick={() => set({ sev: o.v })}
          >
            {o.v !== "all" && <span className={"pdot " + o.v} />}
            {o.label}
          </button>
        ))}
      </div>

      <div className="opsel">
        <select value={filters.range} onChange={(e) => set({ range: e.target.value as LogFilters["range"] })} aria-label="Time range">
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        <span className="chev"><IconChevDown size={14} /></span>
      </div>

      {showSort && (
        <div className="opsel">
          <select value={filters.sort} onChange={(e) => set({ sort: e.target.value as LogFilters["sort"] })} aria-label="Sort">
            <option value="recent">Most recent</option>
            <option value="duration_desc">Slowest first</option>
          </select>
          <span className="chev"><IconChevDown size={14} /></span>
        </div>
      )}

      <div className="opsearch">
        <span className="s-icon"><IconSearch size={15} /></span>
        <input
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="email, paper id, or text…"
          aria-label="Search events"
        />
      </div>
    </div>
  );
}
