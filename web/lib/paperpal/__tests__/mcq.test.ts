// Unit tests for the multiple-choice assessment state transitions that
// McqMode renders. Each no-op must return the same object so the component
// skips the localStorage write and the hint side effect.

import { describe, expect, it } from "vitest";
import type { QuizQuestion } from "../types";
import {
  MCQ_INITIAL,
  applyHint,
  currentIndex,
  goToQuestion,
  gradeFor,
  hintCap,
  nextQuestion,
  prevQuestion,
  scoreQuiz,
  selectAnswer,
  submitAnswer,
  type McqState,
} from "../mcq";

const q = (correct: number, options = ["A", "B", "C", "D"]): QuizQuestion => ({
  question: "Which?",
  options,
  correctAnswerIndex: correct,
  explanation: "Because.",
});

const state = (patch: Partial<McqState> = {}): McqState => ({
  ...MCQ_INITIAL,
  ...patch,
});

describe("currentIndex", () => {
  it("clamps a stored index into the quiz", () => {
    expect(currentIndex(state({ idx: 7 }), 3)).toBe(2);
    expect(currentIndex(state({ idx: -2 }), 3)).toBe(0);
    expect(currentIndex(state({ idx: 1 }), 3)).toBe(1);
    expect(currentIndex(state({ idx: 4 }), 0)).toBe(0);
  });
});

describe("hintCap", () => {
  it("uses the lens budget but always leaves two options", () => {
    expect(hintCap("beginner", 4)).toBe(2);
    expect(hintCap("beginner", 5)).toBe(3);
    expect(hintCap("engineer", 4)).toBe(2);
    expect(hintCap("expert", 4)).toBe(1);
    expect(hintCap("beginner", 2)).toBe(1);
  });
});

describe("selectAnswer", () => {
  it("records the option for the question", () => {
    expect(selectAnswer(state(), 0, 2).answers).toEqual({ 0: 2 });
  });

  it("ignores eliminated options and submitted questions", () => {
    const eliminated = state({ hints: { 0: [1] } });
    expect(selectAnswer(eliminated, 0, 1)).toBe(eliminated);
    const submitted = state({ answers: { 0: 0 }, submitted: { 0: true } });
    expect(selectAnswer(submitted, 0, 2)).toBe(submitted);
  });
});

describe("applyHint", () => {
  it("eliminates a wrong option the member has not selected", () => {
    const s = state({ answers: { 0: 0 } });
    const next = applyHint(s, 0, q(3), 2);
    expect(next.hints).toEqual({ 0: [1] });
    expect(next.answers).toEqual({ 0: 0 });
  });

  it("clears the selection when the only candidate left is selected", () => {
    const s = state({ answers: { 0: 2 }, hints: { 0: [0, 1] } });
    const next = applyHint(s, 0, q(3), 3);
    expect(next.hints).toEqual({ 0: [0, 1, 2] });
    expect(next.answers).toEqual({});
    expect(s.answers).toEqual({ 0: 2 });
  });

  it("never eliminates the correct answer", () => {
    let s = state();
    for (let i = 0; i < 3; i++) s = applyHint(s, 0, q(0), 3);
    expect(s.hints[0]).toEqual([1, 2, 3]);
    expect(applyHint(s, 0, q(0), 5)).toBe(s);
  });

  it("stops at the cap and after submitting", () => {
    const capped = state({ hints: { 0: [1] } });
    expect(applyHint(capped, 0, q(0), 1)).toBe(capped);
    const submitted = state({ answers: { 0: 0 }, submitted: { 0: true } });
    expect(applyHint(submitted, 0, q(0), 2)).toBe(submitted);
  });
});

describe("submitAnswer", () => {
  it("needs an answer and only submits once", () => {
    const empty = state();
    expect(submitAnswer(empty, 0)).toBe(empty);
    const answered = submitAnswer(state({ answers: { 0: 1 } }), 0);
    expect(answered.submitted).toEqual({ 0: true });
    expect(submitAnswer(answered, 0)).toBe(answered);
  });

  it("accepts option 0 as an answer", () => {
    expect(submitAnswer(state({ answers: { 0: 0 } }), 0).submitted).toEqual({
      0: true,
    });
  });
});

describe("navigation", () => {
  it("moves forward and finishes after the last question", () => {
    expect(nextQuestion(state(), 0, 3).idx).toBe(1);
    const finished = nextQuestion(state({ idx: 2 }), 2, 3);
    expect(finished.done).toBe(true);
    expect(finished.idx).toBe(2);
  });

  it("does not move back from the first question", () => {
    const first = state();
    expect(prevQuestion(first, 0)).toBe(first);
    expect(prevQuestion(state({ idx: 2 }), 2).idx).toBe(1);
  });

  it("jumping to a question leaves the results view", () => {
    const next = goToQuestion(state({ done: true, idx: 2 }), 0);
    expect(next).toMatchObject({ idx: 0, done: false });
  });
});

describe("scoring", () => {
  it("counts correct answers, submitted or not", () => {
    const questions = [q(0), q(1), q(2)];
    expect(scoreQuiz(state({ answers: { 0: 0, 1: 3, 2: 2 } }), questions)).toBe(2);
    expect(scoreQuiz(state(), questions)).toBe(0);
  });

  it("grades at the 80% and 60% boundaries", () => {
    expect(gradeFor(80).label).toBe("Strong recall");
    expect(gradeFor(79).label).toBe("Workable understanding");
    expect(gradeFor(60).label).toBe("Workable understanding");
    expect(gradeFor(59).label).toBe("Re-read recommended");
  });
});
