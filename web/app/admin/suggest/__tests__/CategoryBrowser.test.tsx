/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { CategoryBrowser } from "../CategoryBrowser";

afterEach(cleanup);

describe("CategoryBrowser", () => {
  it("renders a category select and no link until a category is chosen", () => {
    render(<CategoryBrowser />);
    expect(screen.getByLabelText(/arXiv category/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows an arXiv listing link after selecting a category", async () => {
    render(<CategoryBrowser />);
    await userEvent.selectOptions(screen.getByLabelText(/arXiv category/i), "cs.LG");
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://arxiv.org/list/cs.LG/recent");
  });

  it("toggling 'show all' reveals non-data-science (Physics) categories", async () => {
    const hasPhysicsOption = () =>
      screen.queryAllByRole("option").some(o => o.textContent?.includes("astro-ph"));
    render(<CategoryBrowser />);
    // Relevant-only by default — no astro-ph (Physics) option present.
    expect(hasPhysicsOption()).toBe(false);
    await userEvent.click(screen.getByRole("checkbox"));
    expect(hasPhysicsOption()).toBe(true);
    // Unchecking re-filters back to the relevant subset.
    await userEvent.click(screen.getByRole("checkbox"));
    expect(hasPhysicsOption()).toBe(false);
  });
});
