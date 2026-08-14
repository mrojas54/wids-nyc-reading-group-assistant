"use client";

// Grid "table" of events with expandable detail (pretty-printed context JSON +
// error stack + Copy as JSON). One row per command_log event.
import { useState } from "react";
import type { LogEvent, LogStatus, LogSeverity } from "@/lib/logs";
import { SOURCE_META, IconChevRight, IconCopy } from "./icons";

function StatusPill({ status }: { status: LogStatus }) {
  const label =
    status === "no_action" ? "no action"
    : status === "needs_action" ? "needs action"
    : status;
  return <span className={"statuspill " + status}>{label}</span>;
}

function SevChip({ sev }: { sev: LogSeverity }) {
  return <span className={"sevchip " + sev}>{sev}</span>;
}

function WhoCell({ who, onFilterWho }: { who: string | null; onFilterWho?: (who: string) => void }) {
  if (who === null) return <button type="button" className="who dash" tabIndex={-1}>—</button>;
  return (
    <button
      type="button"
      className="who"
      onClick={(e) => { e.stopPropagation(); onFilterWho?.(who); }}
      title={"Filter by " + who}
    >
      {who}
    </button>
  );
}

// Lightweight JSON renderer with colored key/string/number spans.
function JsonPretty({ obj }: { obj: Record<string, unknown> }) {
  const lines = JSON.stringify(obj, null, 2).split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const m = line.match(/^(\s*)"([^"]+)":\s*(.*)$/);
        if (m) {
          const [, indent, key, val] = m;
          let valEl;
          if (/^".*"[,]?$/.test(val)) valEl = <span className="s">{val}</span>;
          else if (/^-?\d+([.]\d+)?[,]?$/.test(val)) valEl = <span className="n">{val}</span>;
          else valEl = <span>{val}</span>;
          return (
            <div key={i}>{indent}<span className="k">&quot;{key}&quot;</span>: {valEl}</div>
          );
        }
        return <div key={i}>{line}</div>;
      })}
    </>
  );
}

function ErrorPane({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <pre className="codepane err">
      {lines.map((ln, i) => {
        const isAt = /^\s*at\s/.test(ln);
        return <div key={i} className={isAt ? "mut" : "err-t"}>{ln}</div>;
      })}
    </pre>
  );
}

function CopyButton({ ev, onCopy }: { ev: LogEvent; onCopy?: () => void }) {
  const [ok, setOk] = useState(false);
  const doCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const payload = JSON.stringify(
      {
        time: ev.tsAbs,
        source: ev.source,
        name: ev.name,
        status: ev.status,
        severity: ev.sev,
        who: ev.who,
        context: ev.context,
        error: ev.error,
      },
      null,
      2,
    );
    try {
      navigator.clipboard?.writeText(payload);
    } catch {
      /* clipboard unavailable — best effort */
    }
    setOk(true);
    onCopy?.();
    setTimeout(() => setOk(false), 1600);
  };
  return (
    <button type="button" className={"copybtn" + (ok ? " ok" : "")} onClick={doCopy}>
      <IconCopy size={13} />{ok ? "Copied" : "Copy as JSON"}
    </button>
  );
}

function LogRow({
  ev,
  open,
  onToggle,
  onFilterWho,
  onCopy,
}: {
  ev: LogEvent;
  open: boolean;
  onToggle: () => void;
  onFilterWho?: (who: string) => void;
  onCopy?: () => void;
}) {
  const meta = SOURCE_META[ev.source];
  const SrcIcon = meta.Icon;
  return (
    <div className={"logrow-wrap" + (open ? " is-open" : "")}>
      <div className="logrow" onClick={onToggle} role="button" aria-expanded={open}>
        <div className="c-meta">
          <div className="c-time" title={ev.tsAbs}>{ev.rel}</div>
          <div className="c-source">
            <span className="src-ic">{SrcIcon({ size: 15 })}</span>
            <span className="src-lbl">{meta.label}</span>
          </div>
        </div>
        <div className="c-name">{ev.name}</div>
        <div className="c-status"><StatusPill status={ev.status} /></div>
        <div className="c-sev"><SevChip sev={ev.sev} /></div>
        <div className="c-who"><WhoCell who={ev.who} onFilterWho={onFilterWho} /></div>
        <span className="c-summary">{ev.summary}</span>
        <div className="c-chev">
          <button
            type="button"
            className="chevbtn"
            aria-label={open ? "Collapse" : "Expand"}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
            <IconChevRight size={16} />
          </button>
        </div>
      </div>

      {open && (
        <div className="logrow-detail">
          <div className="detail-block">
            <div className="db-head"><span className="db-lbl">context</span></div>
            <pre className="codepane"><JsonPretty obj={ev.context} /></pre>
          </div>
          <div className="detail-block">
            <div className="db-head">
              <span className="db-lbl">error</span>
              <CopyButton ev={ev} onCopy={onCopy} />
            </div>
            {ev.error ? (
              <ErrorPane text={ev.error} />
            ) : (
              <pre className="codepane" style={{ color: "var(--color-indigo-300)" }}>null — no error attached</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type Props = {
  events: LogEvent[];
  openId: string | null;
  onToggle: (id: string) => void;
  onFilterWho?: (who: string) => void;
  onCopy?: () => void;
};

export function LogsTable({ events, openId, onToggle, onFilterWho, onCopy }: Props) {
  return (
    <div className="logtable">
      <div className="logrow-head">
        <div className="c-time">Time</div>
        <div className="c-source">Source</div>
        <div className="c-name">Name</div>
        <div className="c-status">Status</div>
        <div className="c-sev">Severity</div>
        <div className="c-who">Who</div>
        <div className="c-summary">Summary</div>
        <div className="c-chev"></div>
      </div>
      {events.map((ev) => (
        <LogRow
          key={ev.id}
          ev={ev}
          open={openId === ev.id}
          onToggle={() => onToggle(ev.id)}
          onFilterWho={onFilterWho}
          onCopy={onCopy}
        />
      ))}
    </div>
  );
}
