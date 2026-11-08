import { applyHint, goToQuestion, MCQ_INITIAL, nextQuestion, prevQuestion, selectAnswer, submitAnswer, type McqState } from "./mcq";
import type { QuizQuestion } from "./types";

export type QuizAction =
  | { type: "answer"; idx: number; option: number }
  | { type: "submit"; idx: number }
  | { type: "hint"; idx: number; question: Pick<QuizQuestion, "options" | "correctAnswerIndex">; cap: number }
  | { type: "next"; idx: number; count: number }
  | { type: "prev" | "go"; idx: number }
  | { type: "reset" };
export function reduceQuiz(state: McqState, action: QuizAction): McqState {
  switch (action.type) {
    case "answer": return selectAnswer(state, action.idx, action.option);
    case "submit": return submitAnswer(state, action.idx);
    case "hint": return applyHint(state, action.idx, action.question, action.cap);
    case "next": return nextQuestion(state, action.idx, action.count);
    case "prev": return prevQuestion(state, action.idx);
    case "go": return goToQuestion(state, action.idx);
    case "reset": return MCQ_INITIAL;
    default: return state;
  }
}

export interface TutorMessage {
  id?: string;
  replyTo?: string;
  role: "tutor" | "learner";
  body: string;
  ts: number;
  kind?: "hint" | "synthesis";
  hintIndex?: number;
}
export interface TutorState {
  thread: TutorMessage[];
  hintsUsed: number;
  synthesized: boolean;
  epoch: string;
}
export const TUTOR_INITIAL: TutorState = { thread: [], hintsUsed: 0, synthesized: false, epoch: "legacy" };
export function hasTutorReply(thread: TutorMessage[], message: TutorMessage): boolean {
  if (message.role !== "learner") return false;
  if (message.id) return thread.some(reply => reply.replyTo === message.id);
  const next = thread[thread.indexOf(message) + 1];
  return next?.role === "tutor" && !next.kind;
}
export type TutorAction =
  | { type: "send"; epoch: string; message: TutorMessage }
  | { type: "reply"; epoch: string; turnId: string; text: string; summary: string | null; ts: number }
  | { type: "hint"; probes: string[]; fallback: string; budget: number; ts: number }
  | { type: "synthesize"; text: string; ts: number }
  | { type: "reset"; epoch: string; opening: string; ts: number };
function beforeSummary(thread: TutorMessage[], message: TutorMessage): TutorMessage[] {
  const index = thread.findIndex(m => m.kind === "synthesis");
  const next = [...thread]; next.splice(index < 0 ? next.length : index, 0, message); return next;
}
export function reduceTutor(state: TutorState, action: TutorAction): TutorState {
  switch (action.type) {
    case "send":
      if (action.epoch !== state.epoch || state.thread.some(m => m.id === action.message.id)) return state;
      return { ...state, thread: beforeSummary(state.thread, action.message) };
    case "reply": {
      const index = state.thread.findIndex(m => m.id === action.turnId && m.role === "learner");
      if (action.epoch !== state.epoch || index < 0 || state.thread.some(m => m.replyTo === action.turnId)) return state;
      const thread = [...state.thread];
      thread.splice(index + 1, 0, { role: "tutor", body: action.text, ts: action.ts, replyTo: action.turnId });
      if (action.summary && !state.synthesized) thread.push({ role: "tutor", body: action.summary, ts: action.ts + 1, kind: "synthesis" });
      return { ...state, thread, synthesized: state.synthesized || !!action.summary };
    }
    case "hint":
      if (state.synthesized || state.hintsUsed >= action.budget) return state;
      return { ...state, hintsUsed: state.hintsUsed + 1, thread: [...state.thread, {
        role: "tutor", body: action.probes[state.hintsUsed] ?? action.fallback, ts: action.ts,
        kind: "hint", hintIndex: state.hintsUsed + 1,
      }] };
    case "synthesize":
      if (state.synthesized) return state;
      return { ...state, synthesized: true, thread: [...state.thread, { role: "tutor", body: action.text, ts: action.ts, kind: "synthesis" }] };
    case "reset": return { ...TUTOR_INITIAL, epoch: action.epoch, thread: [{ role: "tutor", body: action.opening, ts: action.ts }] };
    default: return state;
  }
}
