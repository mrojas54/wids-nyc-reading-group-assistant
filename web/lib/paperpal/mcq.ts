// Pure state transitions for the multiple-choice assessment (McqMode).
//
// The component keeps this state in localStorage via usePaperLocalState and
// only renders; every rule about answering, hints, submitting and moving
// between questions lives here so it can be tested without a DOM. Each
// transition returns the same state object when the action is not allowed,
// so callers can skip the write (and any side effect) on a no-op.

import type { Lens, QuizQuestion } from "./types";

export interface McqState {
  idx: number;
  answers: Record<number, number>;
  submitted: Record<number, boolean>;
  hints: Record<number, number[]>;
  done: boolean;
}

export const MCQ_INITIAL: McqState = {
  idx: 0,
  answers: {},
  submitted: {},
  hints: {},
  done: false,
};

export const LENS_HINT_BUDGET: Record<Lens, number> = {
  beginner: 3,
  engineer: 2,
  expert: 1,
};

/** Stored index clamped to the quiz, so a shorter regenerated quiz never reads past the end. */
export function currentIndex(state: McqState, questionCount: number): number {
  return Math.min(
    Math.max(0, state.idx || 0),
    Math.max(0, questionCount - 1),
  );
}

/** Eliminate-an-option hints allowed per question: the lens budget, always leaving two options. */
export function hintCap(lens: Lens, optionCount: number): number {
  return Math.min(LENS_HINT_BUDGET[lens], Math.max(1, optionCount - 2));
}

export function eliminatedAt(state: McqState, idx: number): number[] {
  return state.hints[idx] || [];
}

export function selectAnswer(
  state: McqState,
  idx: number,
  option: number,
): McqState {
  if (state.submitted[idx] || eliminatedAt(state, idx).includes(option)) {
    return state;
  }
  return { ...state, answers: { ...state.answers, [idx]: option } };
}

/**
 * Eliminates one wrong option, preferring one the member has not selected.
 * If the only candidate left is the selected one, the selection is cleared.
 */
export function applyHint(
  state: McqState,
  idx: number,
  question: QuizQuestion,
  cap: number,
): McqState {
  const eliminated = eliminatedAt(state, idx);
  if (state.submitted[idx] || eliminated.length >= cap) return state;
  const candidates = question.options
    .map((_, i) => i)
    .filter((i) => i !== question.correctAnswerIndex && !eliminated.includes(i));
  if (!candidates.length) return state;
  const selected = state.answers[idx];
  const pick = candidates.find((i) => i !== selected) ?? candidates[0];
  let answers = state.answers;
  if (selected === pick) {
    answers = { ...state.answers };
    delete answers[idx];
  }
  return {
    ...state,
    hints: { ...state.hints, [idx]: [...eliminated, pick] },
    answers,
  };
}

export function submitAnswer(state: McqState, idx: number): McqState {
  if (state.answers[idx] == null || state.submitted[idx]) return state;
  return { ...state, submitted: { ...state.submitted, [idx]: true } };
}

/** Moves to the next question, or to the results view after the last one. */
export function nextQuestion(
  state: McqState,
  idx: number,
  questionCount: number,
): McqState {
  if (idx + 1 >= questionCount) return { ...state, done: true };
  return { ...state, idx: idx + 1 };
}

export function prevQuestion(state: McqState, idx: number): McqState {
  if (idx === 0) return state;
  return { ...state, idx: idx - 1 };
}

export function goToQuestion(state: McqState, idx: number): McqState {
  return { ...state, idx, done: false };
}

export function scoreQuiz(
  state: McqState,
  questions: readonly QuizQuestion[],
): number {
  return questions.reduce(
    (acc, q, i) => acc + (state.answers[i] === q.correctAnswerIndex ? 1 : 0),
    0,
  );
}

export type McqGrade = { label: string; stroke: string };

export function gradeFor(pct: number): McqGrade {
  if (pct >= 80) {
    return { label: "Strong recall", stroke: "var(--color-sage-600)" };
  }
  if (pct >= 60) {
    return {
      label: "Workable understanding",
      stroke: "var(--color-warning-500, #c89a3a)",
    };
  }
  return { label: "Re-read recommended", stroke: "var(--color-magenta-500)" };
}
