// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { McqMode } from "../McqMode";
import { SocraticMode } from "../SocraticMode";
import { keys, paperId, prompt, quiz } from "./request-fixtures";
import { ASSESSMENT_STORAGE_VERSION } from "@/lib/paperpal/assessment-store";

const prefix = `paperpal:${ASSESSMENT_STORAGE_VERSION}:${encodeURIComponent(`${paperId}:assessment:mcq`)}:`;

vi.mock("@/lib/supabase/browser", () => ({ createSupabaseBrowserClient: () => ({ auth: {
  getSession: async () => ({ data: { session: { access_token: "fixture" } } }),
} }) }));

beforeEach(() => {
  localStorage.clear();
  let queue = Promise.resolve();
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: (_name: string, work: () => void) => (queue = queue.then(work)),
  } });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ next_question: "Mock reply", summary: null }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("does not read saved actions again on each composer keystroke", async () => {
  const view = render(<SocraticMode paperId={paperId} prompt={prompt} lens="engineer" />);
  const ui = within(view.container);
  await act(async () => {
    fireEvent.change(ui.getByRole("textbox"), { target: { value: "First turn" } });
    fireEvent.click(ui.getByRole("button", { name: "Send" }));
  });
  const reads = vi.spyOn(Storage.prototype, "getItem");
  for (const value of ["a", "ab", "abc", "abcd", "abcde"]) {
    fireEvent.change(ui.getByRole("textbox"), { target: { value } });
  }
  expect(reads).not.toHaveBeenCalled();
});

it("skips malformed saved actions without losing valid quiz progress", () => {
  const view = render(<McqMode paperId={paperId} quiz={quiz} lens="engineer" />);
  fireEvent.click(within(view.container).getByText("Code and execution traces").closest("button")!);
  const name = Object.keys(localStorage).find(key => /paperpal:v[23]:/.test(key))!;
  const entry = JSON.parse(localStorage.getItem(name)!);
  localStorage.setItem(name.replace(entry.id, "bad-action"), JSON.stringify({
    id: "bad-action", clock: 2, action: { type: "hint", idx: 0, cap: 2 },
  }));
  cleanup();
  const reloaded = render(<McqMode paperId={paperId} quiz={quiz} lens="engineer" />);
  fireEvent.click(within(reloaded.container).getByRole("button", { name: "Submit answer" }));
  expect(within(reloaded.container).getByText("Correct.")).toBeVisible();
});

it("compacts repeated quiz edits and retains the last answer after reload", async () => {
  const view = render(<McqMode paperId={paperId} quiz={quiz} lens="engineer" />);
  const ui = within(view.container);
  for (let i = 0; i < 200; i++) {
    await act(async () => {
      const label = i % 2 ? "Code and execution traces" : "A score alone";
      fireEvent.click(ui.getByText(label).closest("button")!);
    });
  }
  expect(Object.keys(localStorage).filter(key => /paperpal:v[23]:/.test(key)).length).toBeLessThan(70);
  cleanup();
  const reloaded = render(<McqMode paperId={paperId} quiz={quiz} lens="engineer" />);
  fireEvent.click(within(reloaded.container).getByRole("button", { name: "Submit answer" }));
  expect(within(reloaded.container).getByText("Correct.")).toBeVisible();
});

it("marks unanswered turns and excludes them from the next request history and turn count", async () => {
  localStorage.setItem(keys.thread, JSON.stringify([
    { role: "tutor", body: prompt.openingQuestion, ts: 0 },
    { role: "learner", id: "interrupted", body: "Unanswered reasoning", ts: 1 },
  ]));
  const view = render(<SocraticMode paperId={paperId} prompt={prompt} lens="engineer" />);
  const ui = within(view.container);
  expect(ui.getByText(/No reply saved/)).toBeVisible();
  await act(async () => {
    fireEvent.change(ui.getByRole("textbox"), { target: { value: "Fresh reasoning" } });
    fireEvent.click(ui.getByRole("button", { name: "Send" }));
  });
  const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
  expect(body.turn_number).toBe(1);
  expect(body.history).toEqual([{ role: "ai", text: prompt.openingQuestion }]);
});

it("preserves an older-clock write arriving during checkpoint publication", async () => {
  const original = Storage.prototype.setItem;
  let injected = false;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, name, value) {
    original.call(this, name, value);
    if (name === prefix + "checkpoint" && !injected) {
      injected = true;
      original.call(this, prefix + "other-tab", JSON.stringify({
        id: "other-tab", clock: 1, action: { type: "answer", idx: 1, option: 0 },
      }));
    }
  });
  const view = render(<McqMode paperId={paperId} quiz={quiz} lens="engineer" />);
  const ui = within(view.container);
  for (let i = 0; i < 64; i++) {
    await act(async () => { fireEvent.click(ui.getByText(i % 2 ? "Code and execution traces" : "A score alone").closest("button")!); });
  }
  expect(injected).toBe(true);
  cleanup();
  const reloaded = render(<McqMode paperId={paperId} quiz={quiz} lens="engineer" />);
  const restored = within(reloaded.container);
  fireEvent.click(restored.getByRole("button", { name: /Q02/ }));
  fireEvent.click(restored.getByRole("button", { name: "Submit answer" }));
  expect(restored.getByText("Correct.")).toBeVisible();
});

it("refreshes cached state from a storage event without a same-window custom event", () => {
  const view = render(<McqMode paperId={paperId} quiz={quiz} lens="engineer" />);
  const name = prefix + "remote";
  const value = JSON.stringify({ id: "remote", clock: 1, action: { type: "answer", idx: 0, option: 1 } });
  localStorage.setItem(name, value);
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key: name, newValue: value })); });
  const ui = within(view.container);
  expect(ui.getByRole("button", { name: "Submit answer" })).toBeEnabled();
  fireEvent.click(ui.getByRole("button", { name: "Submit answer" }));
  expect(ui.getByText("Correct.")).toBeVisible();
});

it("retries unsaved actions after storage becomes writable again", () => {
  const view = render(<McqMode paperId={paperId} quiz={quiz} lens="engineer" />);
  const ui = within(view.container);
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  fireEvent.click(ui.getByText("Code and execution traces").closest("button")!);
  expect(ui.getByRole("button", { name: "Submit answer" })).toBeEnabled();
  setItem.mockRestore();
  fireEvent.click(ui.getByRole("button", { name: "Submit answer" }));
  cleanup();
  const reloaded = render(<McqMode paperId={paperId} quiz={quiz} lens="engineer" />);
  expect(within(reloaded.container).getByText("Correct.")).toBeVisible();
});
