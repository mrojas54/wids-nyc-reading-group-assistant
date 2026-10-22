"use client";

import { useState } from "react";
import { safeHref } from "@/lib/safeUrl";
import { formatDateNY } from "@/lib/time";
import type { HistoryItem } from "@/lib/queries";

export function YourHistory({ items }: { items: HistoryItem[] }) {
  const [showAll, setShowAll] = useState(false);

  if (items.length === 0) {
    return (
      <section className="history history-empty">
        <h3 className="section-eyebrow">Your history</h3>
        <p>Your past meetings will show up here once you&apos;ve attended one.</p>
      </section>
    );
  }

  const visible = showAll ? items : items.slice(0, 5);
  const hidden = items.length - visible.length;

  return (
    <section className="history">
      <h3 className="section-eyebrow">Your history</h3>
      <ul className="history-list">
        {visible.map((it) => {
          // papers.companion_url is operator-written and holds either a
          // site-relative path or an absolute URL, so it gets the href check.
          const companionHref = safeHref(it.companion_url);
          return (
            <li key={it.meeting_id} className="history-item">
              <div className="history-text">
                <div className="history-title">{it.paper_title ?? "(no paper)"}</div>
                <div className="history-meta">
                  {it.date ? formatDateNY(it.date) : "Date TBD"}
                </div>
              </div>
              {companionHref && (
                <a href={companionHref} className="history-link">
                  Paper Pal →
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="btn btn-ghost btn-sm history-more"
        >
          Show {hidden} more
        </button>
      )}
    </section>
  );
}
