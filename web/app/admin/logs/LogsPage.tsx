"use client";

// The live operator triage page: sticky status header + preset chips + filter
// bar + expandable table + keyset pagination. Filtering/sort/search run
// client-side over the loaded window; "Load more" pulls older rows via a
// server action.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyLogFilters,
  presetActive,
  DEFAULT_FILTERS,
  PRESETS,
  type HeaderSummary,
  type LogEvent,
  type LogFilters,
} from "@/lib/logs";
import { StatusHeader } from "./StatusHeader";
import { FilterBar } from "./FilterBar";
import { LogsTable } from "./LogsTable";
import { loadMoreCommandLog } from "./actions";
import { IconAlert, IconRefresh, IconInbox, IconChevDown, IconCheckCircle } from "./icons";

type Props = {
  initialEvents: LogEvent[];
  summary: HeaderSummary;
  total: number;
  initialCursor: string | null;
  loadError: boolean;
  nowMs: number;
};

// When the header reflects an error/warn state, navigating from it applies the
// matching filter so the operator lands on the relevant rows.
function navFiltersFor(summary: HeaderSummary): Partial<LogFilters> {
  switch (summary.state) {
    case "error":
    case "multi":
      return { source: "all", sev: "error", range: "24h", name: null, q: "" };
    case "warn":
      return { source: "all", sev: "warn", range: "24h", name: null, q: "" };
    default:
      return { sev: "error", range: "7d", name: null, q: "" };
  }
}

export function LogsPage({ initialEvents, summary, total, initialCursor, loadError, nowMs }: Props) {
  const router = useRouter();
  const [events, setEvents] = useState<LogEvent[]>(initialEvents);
  const [filters, setFilters] = useState<LogFilters>(DEFAULT_FILTERS);
  const [openId, setOpenId] = useState<string | null>(
    summary.state === "error" || summary.state === "multi" ? summary.mostRecent.id : null,
  );
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [liveError, setLiveError] = useState(loadError);
  const [stuck, setStuck] = useState(false);
  const [toast, setToast] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const set = useCallback((patch: Partial<LogFilters>) => setFilters((f) => ({ ...f, ...patch })), []);
  const filtered = useMemo(() => applyLogFilters(events, filters, nowMs), [events, filters, nowMs]);

  const showToast = () => {
    setToast(true);
    setTimeout(() => setToast(false), 1700);
  };

  const onToggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));
  const filterWho = (who: string) => set({ q: who });

  const onLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const res = await loadMoreCommandLog(cursor);
    setLoadingMore(false);
    if (!res.ok) {
      setLiveError(true);
      return;
    }
    setLiveError(false);
    setEvents((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      return [...prev, ...res.events.filter((e) => !seen.has(e.id))];
    });
    setCursor(res.nextCursor);
  };

  return (
    <div className="ops">
      <div className="ops-wrap">
        <StatusHeader
          summary={liveError ? { state: "failed" } : summary}
          stuck={stuck}
          onNavigate={() => set(navFiltersFor(summary))}
          onRetry={() => router.refresh()}
        />

        <div className="ops-pagehead">
          <div className="crumb">/admin/logs</div>
          <h1>Event log</h1>
          <div className="sub">Server actions, scheduled jobs and slash commands — newest first.</div>
          <div className="shortcuts">
            <span className="lbl">Jump to</span>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={"shortcut" + (presetActive(filters, p) ? " is-active" : "")}
                onClick={() => set({ ...p.apply, q: "" })}
              >
                <span className={"dot " + p.dot} />
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <FilterBar filters={filters} set={set} />

        {liveError && (
          <div className="loaderror" role="alert">
            <span className="le-icon"><IconAlert size={20} /></span>
            <div className="le-body">
              <div className="le-title">Couldn&rsquo;t refresh events</div>
              <div className="le-sub">
                The query to <code>command_log</code> failed. Showing the last good response below.
              </div>
            </div>
            <button type="button" className="le-retry" onClick={() => router.refresh()}>
              <IconRefresh size={14} style={{ marginRight: 4, verticalAlign: "-2px" }} />
              Retry
            </button>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="ops-empty">
            <span className="emp-art"><IconInbox size={46} sw={1.25} /></span>
            <h3>No events in this window</h3>
            <p>
              Nothing matched these filters in the last{" "}
              {filters.range === "24h" ? "24 hours" : filters.range === "7d" ? "7 days" : "30 days"}. Try
              widening the time range or clearing a filter.
            </p>
            <div className="emp-act">
              <button type="button" className="loadmore" onClick={() => setFilters(DEFAULT_FILTERS)}>
                Reset filters
              </button>
            </div>
          </div>
        ) : (
          <>
            <LogsTable
              events={filtered}
              openId={openId}
              onToggle={onToggle}
              onFilterWho={filterWho}
              onCopy={showToast}
            />
            <div className="ops-pager">
              <div className="showing">
                Showing <b>{filtered.length}</b> of ~{total.toLocaleString()} in this window.
              </div>
              {cursor && (
                <button type="button" className="loadmore" onClick={onLoadMore} disabled={loadingMore}>
                  <IconChevDown size={15} />
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {toast && (
        <div className="ops-toast">
          <IconCheckCircle size={16} />
          Event copied as JSON
        </div>
      )}
    </div>
  );
}
