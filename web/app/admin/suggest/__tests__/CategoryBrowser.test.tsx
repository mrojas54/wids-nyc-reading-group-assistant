/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it.each([
    '<img src=x onerror=alert(1)>',
    'javascript:alert(1)',
    '../../search?query=test#fragment',
    'cs.NOT_A_CATEGORY',
  ])("removes the listing link for a tampered selection: %s", async value => {
    render(<CategoryBrowser />);
    const select = screen.getByRole("combobox");
    await userEvent.selectOptions(select, "cs.LG");
    expect(screen.getByRole("link")).toBeInTheDocument();

    // A DOM option is not a trusted source of category codes.
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
    fireEvent.change(select, { target: { value } });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("removes the link when the empty option is selected", async () => {
    render(<CategoryBrowser />);
    const select = screen.getByRole("combobox");
    await userEvent.selectOptions(select, "cs.LG");
    await userEvent.selectOptions(select, "");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("links to a category from the expanded taxonomy", async () => {
    render(<CategoryBrowser />);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.selectOptions(screen.getByRole("combobox"), "astro-ph.GA");
    expect(screen.getByRole("link")).toHaveAttribute(
      "href", "https://arxiv.org/list/astro-ph.GA/recent",
    );
    expect(screen.getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
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
