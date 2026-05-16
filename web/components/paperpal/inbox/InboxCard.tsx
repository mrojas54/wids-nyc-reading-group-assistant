// Single paper card used in the Inbox sections. Server component (no handlers).
import Link from "next/link";
import type { InboxPaper } from "@/lib/paperpal/inbox";

export type InboxCardVariant = "current" | "queued" | "proposed" | "past";

export type InboxCardProps = {
  paper: InboxPaper;
  variant: InboxCardVariant;
  badge?: { tone: "sage" | "warning" | "magenta" | "neutral"; label: string };
  scheduled?: string | null;
  leaderName?: string | null;
  pickPill?: { label: string; ghost?: boolean };
  pickAttribution?: { who: string; when?: string | null; verb?: string };
  note?: string | null;
  href?: string;
};

function authorsLine(authors: string[] | null): string {
  if (!authors || authors.length === 0) return "";
  if (authors.length <= 3) return authors.join(", ");
  return `${authors[0]} et al.`;
}

function formatScheduled(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function InboxCard({
  paper,
  variant,
  badge,
  scheduled,
  leaderName,
  pickPill,
  pickAttribution,
  note,
  href,
}: InboxCardProps) {
  const className = [
    "inbox-card",
    variant === "current" && "is-current",
    variant === "queued" && "is-queued",
    variant === "proposed" && "is-proposed",
  ]
    .filter(Boolean)
    .join(" ");

  const when = formatScheduled(scheduled);
  const body = (
    <>
      {badge && (
        <div className="status">
          <span className={`inbox-badge ${badge.tone}`}>{badge.label}</span>
        </div>
      )}
      <div className="title">{paper.title}</div>
      {paper.authors && paper.authors.length > 0 && (
        <div className="authors">{authorsLine(paper.authors)}</div>
      )}
      <div className="meta">
        {paper.venue && <span>{paper.venue}</span>}
      </div>
      {(when || leaderName) && (
        <div className="meeting-line">
          {when && <span>{when}</span>}
          {when && leaderName && <span>·</span>}
          {leaderName && <span>lead {leaderName}</span>}
        </div>
      )}
      {(pickPill || pickAttribution) && (
        <div className="pick-line">
          {pickPill && (
            <span className={`pick-pill${pickPill.ghost ? " ghost" : ""}`}>
              {pickPill.label}
            </span>
          )}
          {pickAttribution && (
            <span>
              <strong>{pickAttribution.who}</strong>
              {pickAttribution.verb ? ` ${pickAttribution.verb}` : ""}
              {pickAttribution.when ? ` · ${pickAttribution.when}` : ""}
            </span>
          )}
        </div>
      )}
      {note && <div className="proposed-note">&ldquo;{note}&rdquo;</div>}
    </>
  );

  const target = href ?? `/papers/${paper.id}`;
  return (
    <Link href={target} className={className} style={{ color: "var(--fg-1)" }}>
      {body}
    </Link>
  );
}
