// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PreviewHarness } from "../PreviewHarness";

const auth = vi.hoisted(() => vi.fn(() => { throw new Error("Live auth is forbidden"); }));
vi.mock("@/lib/supabase/browser", () => ({ createSupabaseBrowserClient: auth }));
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Live requests are forbidden"); });
});
afterEach(() => {
  cleanup();
  expect(auth).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
const mount = (mode: "quiz" | "tutor") => render(<PreviewHarness run="1001" mode={mode} commit="fixture-commit" />);
async function send(text: string) {
  await act(async () => {
    fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Send", exact: true }));
  });
}

it("replies and hints without auth or network requests", async () => {
  const tutor = mount("tutor");
  await send("Synthetic reasoning.");
  expect(screen.getByText("Mock reply: Synthetic reasoning.")).toBeVisible();
  tutor.unmount();
  mount("quiz");
  fireEvent.click(screen.getByText("Code and execution traces"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ask AI" })); });
  expect(screen.getByText("Mock hint: compare the code with the execution trace.")).toBeVisible();
});

it("holds a reply until released and retains the exchange after remount", async () => {
  const view = mount("tutor");
  fireEvent.click(screen.getByRole("checkbox", { name: "Hold mock replies in this tab" }));
  await send("Held reasoning.");
  expect(screen.queryByText("Mock reply: Held reasoning.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Release 1 pending reply" })).toBeEnabled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Release 1 pending reply" })); });
  expect(screen.getByText("Mock reply: Held reasoning.")).toBeVisible();
  view.unmount();
  mount("tutor");
  expect(screen.getByText("Held reasoning.")).toBeVisible();
  expect(screen.getByText("Mock reply: Held reasoning.")).toBeVisible();
});

it("retains an unanswered learner message when a held request is abandoned", async () => {
  const view = mount("tutor");
  fireEvent.click(screen.getByRole("checkbox", { name: "Hold mock replies in this tab" }));
  await send("Keep this across reload.");
  view.unmount();
  mount("tutor");
  expect(screen.getByText("Keep this across reload.")).toBeVisible();
  expect(screen.getByText("No reply saved. You can send this message again.")).toBeVisible();
  expect(screen.queryByText("Mock reply: Keep this across reload.")).not.toBeInTheDocument();
});
