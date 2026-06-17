/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/quotes", () => ({ getQuoteOfDay: vi.fn() }));
import { getQuoteOfDay } from "@/lib/quotes";
import { QuoteCard } from "../QuoteCard";

const mockOfDay = vi.mocked(getQuoteOfDay);
const QUOTE = { id: "q", text: "A test quote of sufficient length.", verified: true as const };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("QuoteCard notable_contributions branch", () => {
  it("renders the contributions line when the author has one", () => {
    mockOfDay.mockReturnValue({
      author: {
        id: "x",
        name: "Ada Test",
        role: "Mathematician",
        notable_contributions: "Did a notable thing.",
      },
      quote: QUOTE,
    });
    render(<QuoteCard />);
    expect(screen.getByText("Did a notable thing.")).toBeInTheDocument();
  });

  it("omits the contributions line when the author has none", () => {
    mockOfDay.mockReturnValue({
      author: { id: "x", name: "Ada Test", role: "Mathematician" },
      quote: QUOTE,
    });
    render(<QuoteCard />);
    expect(screen.queryByText(/notable thing/i)).not.toBeInTheDocument();
  });
});
