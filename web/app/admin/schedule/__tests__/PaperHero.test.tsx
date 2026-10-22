/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { PaperHero } from "../PaperHero";
import type { ScheduleMeeting } from "@/lib/schedule/loadPoll";

afterEach(cleanup);

function meetingWithPaperUrl(url: string | null): ScheduleMeeting {
  return {
    id: 1,
    created_at: "2026-10-01T00:00:00Z",
    leader_id: 7,
    leader_name: "Ada",
    paper: {
      id: 42,
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani"],
      year: 2017,
      url,
      hasPaperPal: false,
    },
  };
}

describe("PaperHero", () => {
  it("links a paper whose URL is http(s)", () => {
    render(<PaperHero meeting={meetingWithPaperUrl("https://arxiv.org/abs/1706.03762")} />);
    const link = screen.getByRole("link", { name: /arXiv/i });
    expect(link).toHaveAttribute("href", "https://arxiv.org/abs/1706.03762");
  });

  // papers.url is operator-written, so a row can hold a script URL. The
  // operator schedule page is exactly where that would be worth stealing.
  it("renders no anchor for a javascript: URL", () => {
    render(<PaperHero meeting={meetingWithPaperUrl("javascript:alert(document.cookie)")} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(document.querySelector("a[href^='javascript:']")).toBeNull();
    // The rest of the card still renders — the link is dropped, not the paper.
    expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument();
  });

  it("renders no anchor for a data: URL", () => {
    render(
      <PaperHero
        meeting={meetingWithPaperUrl("data:text/html,<script>alert(1)</script>")}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not label an unparseable URL as arXiv", () => {
    // Would pass the old `/arxiv\.org/i` test against the raw column value.
    render(<PaperHero meeting={meetingWithPaperUrl("javascript:void('arxiv.org')")} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/arXiv/i)).not.toBeInTheDocument();
  });

  it("renders the card without a link when the paper has no URL", () => {
    render(<PaperHero meeting={meetingWithPaperUrl(null)} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument();
  });
});
