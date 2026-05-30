"use client";

// Sticky operator status banner. One-second answer to "is anything broken?".
// Driven by the real HeaderSummary derived from command_log (see lib/logs.ts).
import type { MouseEvent } from "react";
import type { HeaderSummary } from "@/lib/logs";
import {
  IconCheckCircle,
  IconDot,
  IconTriangle,
  IconAlert,
  IconArrowRight,
} from "./icons";

type Props = {
  summary: HeaderSummary;
  stuck?: boolean;
  updatedLabel?: string;
  onNavigate?: () => void;
  onRetry?: () => void;
};

function RelTip({ rel, abs }: { rel: string; abs: string }) {
  return <span className="sh-rel" title={abs}>{rel}</span>;
}

export function StatusHeader({ summary, stuck = false, updatedLabel = "Live", onNavigate, onRetry }: Props) {
  const cls = (s: string) => "statushead is-" + s + (stuck ? " is-stuck" : "");
  const click = (e: MouseEvent) => {
    e.preventDefault();
    onNavigate?.();
  };

  if (summary.state === "healthy") {
    return (
      <a className={cls("healthy")} href="#" onClick={click} aria-label="All clear. No errors in the last 24 hours.">
        <span className="sh-icon"><IconCheckCircle size={20} /></span>
        <span className="sh-body">
          <span className="sh-desktop">
            <span className="sh-lead">All clear</span>
            <span className="sh-sep">·</span>
            <span className="sh-msg" style={{ color: "var(--fg-2)" }}>No errors in the last 24h.</span>
          </span>
          <span className="sh-mobile">
            <span className="l1"><span className="sh-lead">All clear</span></span>
            <span className="l2">No errors in the last 24h.</span>
          </span>
        </span>
        <span className="sh-right"><span className="sh-meta">{updatedLabel}</span></span>
        <span className="sh-arrow"><IconArrowRight size={16} /></span>
      </a>
    );
  }

  if (summary.state === "failed") {
    return (
      <span className={cls("failed")} role="status" aria-label="Couldn't load status">
        <span className="sh-icon"><IconAlert size={19} /></span>
        <span className="sh-body">
          <span className="sh-desktop">
            <span className="sh-lead" style={{ fontWeight: "var(--fw-medium)" }}>Couldn&rsquo;t load status.</span>
          </span>
          <span className="sh-mobile">
            <span className="l1"><span className="sh-lead" style={{ fontWeight: "var(--fw-medium)" }}>Couldn&rsquo;t load status.</span></span>
          </span>
        </span>
        <span className="sh-right">
          <button className="sh-retry" onClick={(e) => { e.preventDefault(); onRetry?.(); }}>Retry</button>
        </span>
      </span>
    );
  }

  if (summary.state === "warn") {
    const ev = summary.mostRecent;
    const plural = summary.count === 1 ? "warning" : "warnings";
    return (
      <a className={cls("warn")} href="#" onClick={click}
        aria-label={`No errors, but ${summary.count} ${plural} in the last 24 hours. Most recent: ${ev.name} ${ev.rel}.`}>
        <span className="sh-icon"><IconTriangle size={19} /></span>
        <span className="sh-body">
          <span className="sh-desktop">
            <span className="sh-lead">No errors</span>
            <span className="sh-sep">·</span>
            <span style={{ color: "var(--fg-2)" }}><span className="countpill">{summary.count} {plural}</span> in last 24h</span>
            <span className="sh-sep">·</span>
            <span style={{ color: "var(--fg-3)" }}>most recent:</span>
            <span className="sh-name">{ev.name}</span>
            <RelTip rel={ev.rel} abs={ev.tsAbs} />
          </span>
          <span className="sh-mobile">
            <span className="l1">
              <span className="sh-lead">No errors</span>
              <span className="sh-sep">·</span>
              <span className="countpill">{summary.count} {plural}</span>
              <span style={{ color: "var(--fg-2)" }}>in last 24h</span>
            </span>
            <span className="l2">most recent: <span className="sh-name" style={{ fontSize: "var(--mn-sm)" }}>{ev.name}</span> {ev.rel}</span>
          </span>
        </span>
        <span className="sh-arrow"><IconArrowRight size={16} /></span>
      </a>
    );
  }

  if (summary.state === "multi") {
    const ev = summary.mostRecent;
    return (
      <a className={cls("error")} href="#" onClick={click}
        aria-label={`${summary.count} errors in the last 24 hours. Most recent: ${ev.name} ${ev.rel}.`}>
        <span className="sh-icon"><IconDot size={14} color="var(--color-danger-500)" /></span>
        <span className="sh-body">
          <span className="sh-desktop">
            <span className="countpill">{summary.count} errors</span>
            <span className="sh-lead">in the last 24h</span>
            <span className="sh-sep">·</span>
            <span style={{ color: "var(--fg-3)" }}>most recent:</span>
            <span className="sh-name">{ev.name}</span>
            <RelTip rel={ev.rel} abs={ev.tsAbs} />
            {ev.summary && <><span className="sh-sep">·</span><span className="sh-msg mono" style={{ color: "var(--fg-2)" }}>{ev.summary}</span></>}
          </span>
          <span className="sh-mobile">
            <span className="l1">
              <span className="countpill">{summary.count} errors</span>
              <span className="sh-lead">in the last 24h</span>
            </span>
            <span className="l2">most recent: <span className="sh-name" style={{ fontSize: "var(--mn-sm)" }}>{ev.name}</span> {ev.rel}</span>
          </span>
        </span>
        <span className="sh-arrow"><IconArrowRight size={16} /></span>
      </a>
    );
  }

  // single error (default attention state)
  const ev = summary.mostRecent;
  const msg = ev.error ? ev.error.split("\n")[0] : ev.summary;
  return (
    <a className={cls("error")} href="#" onClick={click}
      aria-label={`Last error ${ev.rel}: ${ev.name} ${ev.status}. ${msg}`}>
      <span className="sh-icon"><IconDot size={14} color="var(--color-danger-500)" /></span>
      <span className="sh-body">
        <span className="sh-desktop">
          <span className="sh-lead">Last error</span>
          <span className="sh-sep">·</span>
          <RelTip rel={ev.rel} abs={ev.tsAbs} />
          <span className="sh-sep">·</span>
          <span className="sh-name">{ev.name}</span>
          <span style={{ color: "var(--fg-2)" }}>{ev.status}</span>
          {msg && <><span className="sh-sep">·</span><span className="sh-msg" style={{ color: "var(--fg-2)" }}>{msg}</span></>}
        </span>
        <span className="sh-mobile">
          <span className="l1">
            <span className="sh-lead">Last error</span>
            <span className="sh-sep">·</span>
            <RelTip rel={ev.rel} abs={ev.tsAbs} />
            <span className="sh-sep">·</span>
            <span className="sh-name" style={{ fontSize: "var(--mn-sm)" }}>{ev.name}</span>
            <span style={{ color: "var(--fg-2)" }}>{ev.status}</span>
          </span>
          {msg && <span className="l2"><span className="q">{msg}</span></span>}
        </span>
      </span>
      <span className="sh-arrow"><IconArrowRight size={16} /></span>
    </a>
  );
}
