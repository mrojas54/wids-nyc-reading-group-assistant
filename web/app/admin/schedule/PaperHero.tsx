"use client";

// The "Next paper" hero at the top of the scheduling rail.
import Link from "next/link";
import { Card, CardBody, Icon, MeetingTypeBadge } from "@/components/ui";
import { externalHttpUrl } from "@/lib/safeUrl";
import { formatAuthors } from "@/lib/schedule/format";
import type { ScheduleMeeting } from "@/lib/schedule/loadPoll";

export function PaperHero({ meeting }: { meeting: ScheduleMeeting }) {
  const paper = meeting.paper;
  const authors = formatAuthors(paper?.authors);
  const byline = [
    [authors, paper?.year].filter(Boolean).join(", "),
    meeting.leader_name ? `Led by ${meeting.leader_name}` : "No leader yet",
  ]
    .filter(Boolean)
    .join(" · ");
  // papers.url is operator-supplied, so a row could hold `javascript:…`. Link
  // only what parses as http(s); everything downstream — the arXiv label
  // included — reads this validated value, never paper.url.
  const paperUrl = externalHttpUrl(paper?.url);
  const isArxiv = !!paperUrl && /arxiv\.org/i.test(paperUrl);
  return (
    <Card variant="hero">
      <CardBody>
        <div className="hero-stack">
          <div className="hero-eyebrow-row">
            <MeetingTypeBadge type="reading_group" />
            <span className="eyebrow">Next paper</span>
          </div>
          <h2 className="heading">{paper ? paper.title : "No paper picked yet"}</h2>
          <p className="small" style={{ margin: 0 }}>
            {paper ? byline : "Pick one with /wids-find-paper, then come back to schedule."}
          </p>
          {paper && (
            <div className="hero-links">
              {paperUrl && (
                <a className="hero-link" href={paperUrl} target="_blank" rel="noreferrer">
                  {isArxiv ? "arXiv" : "Paper"} <Icon name="external" size={16} />
                </a>
              )}
              {paper.hasPaperPal ? (
                <Link className="hero-link" href={`/papers/${paper.id}`}>
                  Paper Pal <Icon name="check" size={16} />
                </Link>
              ) : (
                <span className="hero-note">
                  <Icon name="clock" size={16} />
                  Paper Pal not yet synthesized
                </span>
              )}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
