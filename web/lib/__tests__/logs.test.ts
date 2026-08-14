import { describe, it, expect } from "vitest";
import {
  deriveSeverity,
  relativeTime,
  mapCommandLogRow,
  summarizeHeader,
  applyLogFilters,
  presetActive,
  DEFAULT_FILTERS,
  PRESETS,
  type CommandLogRow,
} from "@/lib/logs";

// A fixed "now" so relative-time math is deterministic.
const NOW = Date.parse("2026-05-30T19:12:00.000Z"); // 3:12pm EDT
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function row(over: Partial<CommandLogRow>): CommandLogRow {
  return {
    id: 1,
    ran_at: new Date(NOW - 4 * MIN).toISOString(),
    source: "server_action",
    name: "page_404",
    status: "success",
    summary: "/papers/999",
    error: null,
    duration_ms: null,
    actor: null,
    metadata: null,
    idempotency_key: null,
    ...over,
  };
}

describe("deriveSeverity", () => {
  it("maps status to severity", () => {
    expect(deriveSeverity("failure")).toBe("error");
    expect(deriveSeverity("no_action")).toBe("warn");
    expect(deriveSeverity("success")).toBe("info");
  });

  // migration 029. A task that could only leave a draft for a human to send
  // must not read as all-clear — that is exactly how the 2026-08-11
  // pre-meeting-reminder run left 8 members unreminded without anyone noticing.
  it("maps needs_action to warn, not info", () => {
    expect(deriveSeverity("needs_action")).toBe("warn");
    expect(deriveSeverity("needs_action")).not.toBe("info");
  });
});

describe("relativeTime", () => {
  it("renders sub-minute as 'just now'", () => {
    expect(relativeTime(new Date(NOW - 5_000).toISOString(), NOW)).toBe("just now");
  });
  it("renders minutes, hours, days", () => {
    expect(relativeTime(new Date(NOW - 4 * MIN).toISOString(), NOW)).toBe("4m ago");
    expect(relativeTime(new Date(NOW - 2 * HOUR).toISOString(), NOW)).toBe("2h ago");
    expect(relativeTime(new Date(NOW - 26 * HOUR).toISOString(), NOW)).toBe("1d ago");
  });
});

describe("mapCommandLogRow", () => {
  it("derives view-model fields from a real row", () => {
    const ev = mapCommandLogRow(
      row({ id: 7, status: "failure", name: "analyze_paper", error: "Error: timeout", summary: "paperId 42" }),
      NOW,
    );
    expect(ev.id).toBe("7");
    expect(ev.sev).toBe("error");
    expect(ev.rel).toBe("4m ago");
    expect(ev.who).toBeNull(); // command_log has no actor column
    expect(ev.error).toBe("Error: timeout");
    expect(ev.summary).toBe("paperId 42");
    // context is a derived, honest object built from real columns
    expect(ev.context).toMatchObject({ source: "server_action", name: "analyze_paper", status: "failure" });
    expect(typeof ev.tsAbs).toBe("string");
  });

  it("tolerates null summary/error", () => {
    const ev = mapCommandLogRow(row({ summary: null, error: null }), NOW);
    expect(ev.summary).toBe("");
    expect(ev.error).toBeNull();
  });

  it("wires migration-020 columns into who/durMs/context", () => {
    const ev = mapCommandLogRow(
      row({
        actor: "cron:availability-chase",
        duration_ms: 812,
        idempotency_key: "availability-chase:meeting=12",
        metadata: { meetingId: 12, recipients: 5 },
      }),
      NOW,
    );
    expect(ev.who).toBe("cron:availability-chase");
    expect(ev.durMs).toBe(812);
    expect(ev.context).toMatchObject({
      idempotencyKey: "availability-chase:meeting=12",
      durationMs: 812,
      metadata: { meetingId: 12, recipients: 5 },
    });
  });

  it("omits enrichment keys from context when the columns are null/empty", () => {
    const ev = mapCommandLogRow(row({ metadata: {} }), NOW);
    expect(ev.who).toBeNull();
    expect(ev.durMs).toBeNull();
    expect(ev.context).not.toHaveProperty("idempotencyKey");
    expect(ev.context).not.toHaveProperty("durationMs");
    expect(ev.context).not.toHaveProperty("metadata");
  });
});

describe("summarizeHeader", () => {
  const evs = (rows: Partial<CommandLogRow>[]) =>
    rows.map((r, i) => mapCommandLogRow(row({ id: i, ...r }), NOW));

  it("reports healthy when no errors or warnings in 24h", () => {
    const h = summarizeHeader(evs([{ status: "success" }, { status: "success" }]), NOW);
    expect(h.state).toBe("healthy");
  });

  it("reports a single error", () => {
    const h = summarizeHeader(
      evs([{ status: "failure", name: "analyze_paper", ran_at: new Date(NOW - 4 * MIN).toISOString() }]),
      NOW,
    );
    expect(h.state).toBe("error");
    if (h.state !== "error") throw new Error("expected error state");
    expect(h.mostRecent.name).toBe("analyze_paper");
  });

  it("reports multiple errors with a count", () => {
    const h = summarizeHeader(
      evs([
        { status: "failure", name: "server_error", ran_at: new Date(NOW - 4 * MIN).toISOString() },
        { status: "failure", name: "analyze_paper", ran_at: new Date(NOW - 30 * MIN).toISOString() },
        { status: "failure", name: "x", ran_at: new Date(NOW - 50 * MIN).toISOString() },
      ]),
      NOW,
    );
    expect(h.state).toBe("multi");
    if (h.state !== "multi") throw new Error("expected multi state");
    expect(h.count).toBe(3);
    expect(h.mostRecent.name).toBe("server_error");
  });

  it("reports warnings only when there are warns but no errors", () => {
    const h = summarizeHeader(
      evs([
        { status: "no_action", name: "auth_unlinked", ran_at: new Date(NOW - 38 * MIN).toISOString() },
        { status: "success" },
      ]),
      NOW,
    );
    expect(h.state).toBe("warn");
    if (h.state !== "warn") throw new Error("expected warn state");
    expect(h.count).toBe(1);
  });

  it("ignores events older than 24h", () => {
    const h = summarizeHeader(
      evs([{ status: "failure", ran_at: new Date(NOW - 2 * DAY).toISOString() }]),
      NOW,
    );
    expect(h.state).toBe("healthy");
  });
});

describe("applyLogFilters", () => {
  const sample = [
    mapCommandLogRow(row({ id: 1, source: "edge_function", name: "analyze_paper", status: "failure", summary: "paperId 42" }), NOW),
    mapCommandLogRow(row({ id: 2, source: "server_action", name: "page_404", status: "success", summary: "/papers/999" }), NOW),
    mapCommandLogRow(row({ id: 3, source: "scheduled_task", name: "pre_meeting_reminder", status: "success", summary: "sent 7 reminders" }), NOW),
  ];

  it("filters by source", () => {
    const out = applyLogFilters(sample, { ...DEFAULT_FILTERS, source: "server_action", range: "30d" }, NOW);
    expect(out.map((e) => e.id)).toEqual(["2"]);
  });

  it("filters by severity (derived)", () => {
    const out = applyLogFilters(sample, { ...DEFAULT_FILTERS, sev: "error", range: "30d" }, NOW);
    expect(out.map((e) => e.id)).toEqual(["1"]);
  });

  it("filters by free-text query across name/summary", () => {
    const out = applyLogFilters(sample, { ...DEFAULT_FILTERS, q: "reminders", range: "30d" }, NOW);
    expect(out.map((e) => e.id)).toEqual(["3"]);
  });

  it("filters by exact name (preset link)", () => {
    const out = applyLogFilters(sample, { ...DEFAULT_FILTERS, name: "page_404", range: "30d" }, NOW);
    expect(out.map((e) => e.id)).toEqual(["2"]);
  });

  it("filters out events outside the time range", () => {
    const old = mapCommandLogRow(row({ id: 9, ran_at: new Date(NOW - 5 * DAY).toISOString() }), NOW);
    const out = applyLogFilters([...sample, old], { ...DEFAULT_FILTERS, range: "24h" }, NOW);
    expect(out.find((e) => e.id === "9")).toBeUndefined();
  });
});

describe("presetActive", () => {
  it("is active only when every applied key matches and no query is set", () => {
    const broke = PRESETS.find((p) => p.id === "broke")!;
    const f = { ...DEFAULT_FILTERS, ...broke.apply };
    expect(presetActive(f, broke)).toBe(true);
    expect(presetActive({ ...f, q: "oops" }, broke)).toBe(false);
    expect(presetActive(DEFAULT_FILTERS, broke)).toBe(false);
  });
});
