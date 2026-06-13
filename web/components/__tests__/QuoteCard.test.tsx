/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { QuoteCard } from "../QuoteCard";

afterEach(cleanup);

describe("QuoteCard", () => {
  it("renders a labelled quote-of-the-day region", () => {
    render(<QuoteCard />);
    expect(screen.getByRole("region", { name: /quote of the day/i })).toBeInTheDocument();
  });

  it("shows a non-empty quote wrapped in curly quotes and an author name", () => {
    const { container } = render(<QuoteCard />);
    const text = container.textContent ?? "";
    expect(text).toContain("“"); // left double quote
    expect(text).toContain("”"); // right double quote
    expect(text.length).toBeGreaterThan(20);
  });
});
