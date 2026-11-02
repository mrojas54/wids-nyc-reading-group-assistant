// @vitest-environment jsdom
// Plays one quiz through McqMode to check the component still wires its
// buttons to the state transitions in lib/paperpal/mcq.ts.
import { afterEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AssessmentQuiz } from "@/lib/paperpal/types";
import { McqMode } from "../McqMode";

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: vi.fn(),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const quiz: AssessmentQuiz = {
  title: "Quiz",
  difficulty: "easy",
  questions: [
    {
      question: "First question?",
      options: ["Alpha", "Beta", "Gamma", "Delta"],
      correctAnswerIndex: 1,
      explanation: "Beta is right.",
    },
    {
      question: "Second question?",
      options: ["One", "Two", "Three", "Four"],
      correctAnswerIndex: 3,
      explanation: "Four is right.",
    },
  ],
} as AssessmentQuiz;

const option = (label: string) =>
  screen.getByText(label).closest("button") as HTMLButtonElement;

it("answers, hints, submits and shows the result", () => {
  render(<McqMode paperId="7" quiz={quiz} lens="expert" />);

  const submit = screen.getByRole("button", { name: "Submit answer" });
  expect(submit).toBeDisabled();

  fireEvent.click(option("Beta"));
  fireEvent.click(screen.getByRole("button", { name: "Hint" }));
  expect(option("Alpha")).toBeDisabled();
  expect(screen.getByText("1 / 1 used")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Hint/ })).toBeDisabled();

  fireEvent.click(submit);
  expect(screen.getByText("Correct.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));

  expect(screen.getByText("Second question?", { selector: ".pp-quiz-q" })).toBeInTheDocument();
  fireEvent.click(option("One"));
  fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
  expect(screen.getByText("Not quite.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "See results" }));

  expect(screen.getByText("Result · 50%")).toBeInTheDocument();
  expect(screen.getByText("Re-read recommended")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Retake" }));
  expect(screen.getByText("First question?", { selector: ".pp-quiz-q" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Submit answer" })).toBeDisabled();
});
