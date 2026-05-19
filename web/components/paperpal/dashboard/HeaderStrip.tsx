// Header for the synthesis dashboard: title / authors / venue / page-count
// on the left; an optional next-meeting hero on the right.

import type { ReactNode } from "react";
import { Badge, Eyebrow } from "../primitives";

export type NextMeetingHero = {
  whenLabel: string; // e.g. "Thu, May 22 · 6:30 PM"
  venue?: string | null;
  leaderName?: string | null;
  href?: string;
};

export function HeaderStrip({
  title,
  authors,
  venue,
  pages,
  uploadedAt,
  nextMeeting,
}: {
  title: string;
  authors: string[];
  venue?: string;
  pages?: number;
  uploadedAt?: string;
  nextMeeting?: NextMeetingHero | null;
}): ReactNode {
  return (
    <header className="pp-paper-header">
      <div className="pp-paper-header-main">
        <div className="pp-paper-header-meta">
          <Badge tone="sage">Synthesized</Badge>
          {venue && <Badge tone="neutral">{venue}</Badge>}
          {pages != null && <Badge tone="neutral">{pages} pp</Badge>}
          {uploadedAt && (
            <span className="pp-paper-header-stamp">
              Uploaded {uploadedAt}
            </span>
          )}
        </div>
        <h1 className="pp-paper-header-title">{title}</h1>
        <div className="pp-paper-header-authors">
          {authors.slice(0, 4).join(", ")}
          {authors.length > 4 && (
            <span style={{ color: "var(--fg-4)" }}>
              {" "}
              · +{authors.length - 4} more
            </span>
          )}
        </div>
      </div>

      {nextMeeting && (
        <aside className="pp-next-meeting">
          <Eyebrow tone="accent" dot>
            Next meeting
          </Eyebrow>
          <div className="pp-next-meeting-when">{nextMeeting.whenLabel}</div>
          {(nextMeeting.venue || nextMeeting.leaderName) && (
            <div className="pp-next-meeting-meta">
              {nextMeeting.venue}
              {nextMeeting.venue && nextMeeting.leaderName && " · "}
              {nextMeeting.leaderName && `Led by ${nextMeeting.leaderName}`}
            </div>
          )}
          {nextMeeting.href && (
            <a className="pp-next-meeting-link" href={nextMeeting.href}>
              Open meeting page
            </a>
          )}
        </aside>
      )}
    </header>
  );
}
