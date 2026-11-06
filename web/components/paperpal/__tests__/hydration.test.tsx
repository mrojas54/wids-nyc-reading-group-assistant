// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { MCQ_INITIAL, type McqState } from "@/lib/paperpal/mcq";
import type { AssessmentQuiz, SocraticPrompt } from "@/lib/paperpal/types";
import { AssessmentPanel } from "../assessment/AssessmentPanel";
import { McqMode } from "../assessment/McqMode";
import { SocraticMode } from "../assessment/SocraticMode";
import { SectionBreakdownTile } from "../dashboard/SectionBreakdownTile";

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: vi.fn(),
}));

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.restoreAllMocks();
});

async function hydrate(ui: ReactElement) {
  let html: string;
  // The server cannot see the member's saved browser state.
  vi.stubGlobal("window", undefined);
  try {
    html = renderToString(ui);
  } finally {
    vi.unstubAllGlobals();
  }
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const serverNode = container.firstElementChild;
  const onRecoverableError = vi.fn();
  await act(async () => {
    roots.push(hydrateRoot(container, ui, { onRecoverableError }));
  });
  return { container, serverNode, onRecoverableError };
}

const quiz: AssessmentQuiz = {
  title: "Harness quiz",
  difficulty: "easy",
  questions: [
    {
      question: "What does the proposer read?",
      options: ["Only the best score", "The full experiment history"],
      correctAnswerIndex: 1,
      explanation: "The filesystem contains code, scores, and traces.",
      sectionRef: "method",
    },
    {
      question: "What is optimized?",
      options: ["The harness", "The model weights"],
      correctAnswerIndex: 0,
      explanation: "The proposer changes the surrounding code.",
    },
  ],
};

const prompt: SocraticPrompt = {
  id: "harness",
  topic: "Harnesses",
  openingQuestion: "Why keep the experiment history?",
  goalInsight: "Detailed feedback helps improve the harness.",
  scriptedProbes: ["What would a single score leave out?"],
};

it("hydrates saved paper-40 quiz feedback without replacing the server DOM or saved answers", async () => {
  const key = "paperpal:v1:40:assessment:mcq";
  const saved: McqState = {
    ...MCQ_INITIAL,
    answers: { 0: 0 },
    submitted: { 0: true },
  };
  window.localStorage.setItem(key, JSON.stringify(saved));
  const write = vi.spyOn(Storage.prototype, "setItem");

  const { container, serverNode, onRecoverableError } = await hydrate(
    <McqMode paperId="40" quiz={quiz} lens="engineer" />,
  );

  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(container.firstElementChild).toBe(serverNode);
  expect(within(container).getByText("Not quite.")).toBeVisible();
  expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual(saved);
  expect(write).not.toHaveBeenCalledWith(key, JSON.stringify(MCQ_INITIAL));

  fireEvent.click(within(container).getByRole("button", { name: "Next question" }));
  expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ ...saved, idx: 1 });
});

it("hydrates a saved difficulty lens before showing the member's preference", async () => {
  const key = "paperpal:v1:tweaks";
  const saved = { mode: "mcq", lens: "expert" };
  window.localStorage.setItem(key, JSON.stringify(saved));

  const { container, serverNode, onRecoverableError } = await hydrate(
    <AssessmentPanel paperId="40" quiz={quiz} />,
  );

  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(container.firstElementChild).toBe(serverNode);
  expect(within(container).getByText("Assessment · Expert lens")).toBeVisible();
  expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual(saved);
});

it("hydrates saved hint markers and still responds to hint events", async () => {
  const key = "paperpal:v1:40:hintFlags";
  window.localStorage.setItem(key, JSON.stringify({ method: { count: 1, sources: ["assessment"] } }));

  const { container, serverNode, onRecoverableError } = await hydrate(
    <SectionBreakdownTile
      paperId="40"
      terminology={[{ term: "Harness", definition: "Code around the model", context: "", sectionRef: "method" }]}
      mathExplanations={[]}
    />,
  );

  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(container.firstElementChild).toBe(serverNode);
  expect(within(container).getByText("Wobbled · 1")).toBeVisible();
  await act(async () => {
    window.localStorage.setItem(key, JSON.stringify({ method: { count: 2, sources: ["assessment"] } }));
    window.dispatchEvent(new CustomEvent("paperpal:hint-flags-changed", { detail: { paperId: "40" } }));
  });
  expect(within(container).getByText("Wobbled · 2")).toBeVisible();
});

it("preserves an existing Socratic conversation while hydrating its server placeholder", async () => {
  const key = "paperpal:v1:40:socratic:thread:harness";
  const saved = [
    { role: "tutor", body: prompt.openingQuestion, ts: 1 },
    { role: "learner", body: "Scores alone do not explain failures.", ts: 2 },
  ];
  window.localStorage.setItem(key, JSON.stringify(saved));
  const write = vi.spyOn(Storage.prototype, "setItem");

  const { container, serverNode, onRecoverableError } = await hydrate(
    <SocraticMode paperId="40" prompt={prompt} lens="engineer" />,
  );

  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(container.firstElementChild).toBe(serverNode);
  expect(within(container).getByText(saved[1].body)).toBeVisible();
  expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual(saved);
  for (const [writtenKey, value] of write.mock.calls) {
    if (writtenKey === key) expect(JSON.parse(value)).toEqual(saved);
  }
});
