// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { SocraticMode } from "@/components/paperpal/assessment/SocraticMode";
import { McqMode } from "@/components/paperpal/assessment/McqMode";
import { keys, paperId, prompt, quiz } from "./request-fixtures";
import { ASSESSMENT_STORAGE_VERSION } from "@/lib/paperpal/assessment-store";

const auth = vi.hoisted(() => ({ pending: false }));
vi.mock("@/lib/supabase/browser", () => ({ createSupabaseBrowserClient: () => ({ auth: {
  getSession: () => auth.pending ? new Promise(() => {}) : Promise.resolve({ data: { session: { access_token: "local-only" } } }),
} }) }));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};
const success = (text: string) => Response.json({ next_question: `Mock reply to ${text}`, summary: null, provider: "local", model: "fixture" });
const saved = (key = keys.thread) => JSON.parse(localStorage.getItem(key) ?? "null");
let requestMode: "success" | "fetch-pending" | "body-pending" | "deferred";
let requests: { body: { user_response: string }; signal: boolean; pending?: ReturnType<typeof deferred<Response>> }[];
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear(); auth.pending = false; requestMode = "success"; requests = [];
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (!["/functions/v1/analyze-socratic", "/functions/v1/analyze-hint"].includes(String(input))) throw new Error("Unmocked request blocked");
    const entry = { body: JSON.parse(String(init?.body)), signal: !!init?.signal } as typeof requests[number];
    requests.push(entry);
    if (requestMode === "fetch-pending") return new Promise(() => {});
    if (requestMode === "body-pending") return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"partial":')); } }));
    if (requestMode === "deferred") { entry.pending = deferred<Response>(); return entry.pending.promise; }
    if (String(input).endsWith("analyze-hint")) return Response.json({ hint: "Mock hint", confidence: "high", provider: "local", model: "fixture" });
    return success(entry.body.user_response);
  });
});
afterEach(() => {
  cleanup(); vi.clearAllTimers(); vi.useRealTimers();
  expect(errorSpy.mock.calls, "unexpected React errors").toEqual([]);
  vi.restoreAllMocks(); localStorage.clear();
});
const tutor = (id = paperId) => render(<SocraticMode paperId={id} prompt={prompt} lens="engineer" />);
const mcq = (id = paperId) => render(<McqMode paperId={id} quiz={quiz} lens="engineer" />);
async function send(view: ReturnType<typeof render>, text: string) {
  await act(async () => {
    fireEvent.change(within(view.container).getByRole("textbox"), { target: { value: text } });
    fireEvent.click(within(view.container).getByRole("button", { name: "Send" }));
  });
}
function option(view: ReturnType<typeof render>, label: string) { return within(view.container).getByText(label).closest("button")!; }
function storageEvent(key: string) { window.dispatchEvent(new StorageEvent("storage", { key, newValue: localStorage.getItem(key), storageArea: localStorage })); }

it.each([[0,1], [1,0]])("two tutor tabs should retain both exchanges when responses finish %j then %j", async (first, second) => {
  requestMode = "deferred";
  const a = tutor(); const b = tutor();
  await send(a, "Reasoning from tab A."); await send(b, "Reasoning from tab B.");
  expect(requests).toHaveLength(2);
  await act(async () => { requests[first].pending!.resolve(success(requests[first].body.user_response)); });
  await act(async () => { storageEvent(keys.thread); });
  await act(async () => { requests[second].pending!.resolve(success(requests[second].body.user_response)); });
  const finalSaved = saved();
  expect.soft(finalSaved.filter((m: { body: string; role: string; kind?: string }) => m.role === "learner").map((m: { body: string; role: string; kind?: string }) => m.body).sort()).toEqual(["Reasoning from tab A.", "Reasoning from tab B."]);
});

it("two quiz tabs should preserve submissions to different questions", async () => {
  const a = mcq(); const b = mcq();
  fireEvent.click(option(a, "Code and execution traces"));
  fireEvent.click(within(a.container).getByRole("button", {name:"Submit answer"}));
  await act(async () => { storageEvent(keys.quiz); });
  fireEvent.click(within(b.container).getByRole("button", {name:/Q02/}));
  fireEvent.click(option(b, "The harness code"));
  fireEvent.click(within(b.container).getByRole("button", {name:"Submit answer"}));
  expect.soft(saved(keys.quiz).answers).toEqual({0:1,1:0});
  expect.soft(saved(keys.quiz).submitted).toEqual({0:true,1:true});
});

it("a late tutor response should preserve synthesis completed in another tab", async () => {
  requestMode = "deferred";
  const a = tutor(); const b = tutor();
  await send(a, "Slow tab A response."); await send(b, "Fast tab B response.");
  await act(async () => { requests[1].pending!.resolve(success(requests[1].body.user_response)); });
  fireEvent.click(within(b.container).getByRole("button", {name:"I've got it"}));
  expect(saved(keys.synthesis)).toBe(true);
  await act(async () => { storageEvent(keys.thread); storageEvent(keys.synthesis); });
  await act(async () => { requests[0].pending!.resolve(success(requests[0].body.user_response)); });
  const finalSaved = saved(); cleanup();
  const reloaded = tutor();
  expect.soft(finalSaved.some((m: { body: string; role: string; kind?: string }) => m.kind === "synthesis" && m.body === prompt.goalInsight)).toBe(true);
  expect.soft(within(reloaded.container).queryByText(prompt.goalInsight)).toBeInTheDocument();
});

it("control: sequential tutor exchanges in one tab preserve both", async () => {
  const view = tutor(); await send(view, "First sequential message."); await send(view, "Second sequential message.");
  expect(saved().filter((m: { body: string; role: string; kind?: string }) => m.role === "learner").map((m: { body: string; role: string; kind?: string }) => m.body)).toEqual(["First sequential message.","Second sequential message."]);
});

it("control: different paper IDs keep quiz progress separate", () => {
  const a = mcq(); const b = mcq("900008");
  fireEvent.click(option(a, "Code and execution traces")); fireEvent.click(within(a.container).getByRole("button", {name:"Submit answer"}));
  fireEvent.click(option(b, "A score alone")); fireEvent.click(within(b.container).getByRole("button", {name:"Submit answer"}));
  expect(saved(keys.quiz).answers).toEqual({0:1});
  expect(saved("paperpal:v1:900008:assessment:mcq").answers).toEqual({0:0});
});

it("saves the pending learner message before reload and ignores the cancelled response", async () => {
  requestMode = "deferred";
  const view = tutor(); await send(view, "Keep this pending reasoning.");
  expect(saved().filter((m: {role:string}) => m.role === "learner")).toHaveLength(1);
  view.unmount();
  const reloaded = tutor();
  expect(within(reloaded.container).getByText("Keep this pending reasoning.")).toBeVisible();
  await act(async () => { requests[0].pending!.resolve(success("late cancelled reply")); });
  expect(within(reloaded.container).queryByText("Mock reply to late cancelled reply")).not.toBeInTheDocument();
  expect(within(reloaded.container).getByRole("textbox")).toBeEnabled();
});

it("a reply started before another tab resets cannot resurrect the old thread", async () => {
  requestMode = "deferred";
  const a = tutor(); const b = tutor();
  await send(a, "Old request before reset.");
  requestMode = "success";
  await send(b, "A completed exchange before reset.");
  fireEvent.click(within(b.container).getByRole("button", {name:"I've got it"}));
  fireEvent.click(within(b.container).getByRole("button", {name:"Reset conversation"}));
  await act(async () => { requests[0].pending!.resolve(success("Old request before reset.")); });
  expect(saved().map((m: {body:string}) => m.body)).toEqual([prompt.openingQuestion]);
  expect(saved(keys.synthesis)).toBe(false);
});

it("preserves hints requested while a tutor reply is pending", async () => {
  requestMode = "deferred";
  const view = tutor(); await send(view, "A message with a concurrent hint.");
  fireEvent.click(within(view.container).getByRole("button", {name:"Hint"}));
  await act(async () => { requests[0].pending!.resolve(success("A message with a concurrent hint.")); });
  expect(saved().filter((m: {kind?:string}) => m.kind === "hint")).toHaveLength(1);
  expect(saved(keys.hints)).toBe(1);
});

it("replays independent concurrent quiz writes even when both tabs used the same starting clock", () => {
  const records = () => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith(`paperpal:${ASSESSMENT_STORAGE_VERSION}:`)).map(k => [k, localStorage.getItem(k)!]));
  const a = mcq();
  fireEvent.click(option(a, "Code and execution traces"));
  fireEvent.click(within(a.container).getByRole("button", {name:"Submit answer"}));
  const aRecords = records(); cleanup(); localStorage.clear();
  const b = mcq();
  fireEvent.click(within(b.container).getByRole("button", {name:/Q02/}));
  fireEvent.click(option(b, "The harness code"));
  fireEvent.click(within(b.container).getByRole("button", {name:"Submit answer"}));
  const bRecords = records(); cleanup(); localStorage.clear();
  // Merge independently produced writes in reverse arrival order.
  for (const [k,v] of Object.entries({...bRecords,...aRecords})) localStorage.setItem(k,v);
  const combined = mcq(); const ui = within(combined.container);
  fireEvent.click(ui.getByRole("button", {name:/Q01/}));
  expect(ui.getByText("Correct.")).toBeVisible();
  fireEvent.click(ui.getByRole("button", {name:/Q02/}));
  expect(ui.getByText("Correct.")).toBeVisible();
  expect(saved(keys.quiz).answers).toEqual({0:1,1:0});
  expect(saved(keys.quiz).submitted).toEqual({0:true,1:true});
});
