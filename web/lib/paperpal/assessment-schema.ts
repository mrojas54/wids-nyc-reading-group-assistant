import { z } from "zod";

const index = z.number().int().nonnegative();
const message = z.object({
  id: z.string().optional(), replyTo: z.string().optional(),
  role: z.enum(["tutor", "learner"]), body: z.string(), ts: z.number().finite(),
  kind: z.enum(["hint", "synthesis"]).optional(), hintIndex: index.optional(),
});
export const quizStateSchema = z.object({
  idx: index, answers: z.record(z.string(), index),
  submitted: z.record(z.string(), z.boolean()),
  hints: z.record(z.string(), z.array(index)), done: z.boolean(),
});
export const tutorStateSchema = z.object({
  thread: z.array(message), hintsUsed: index, synthesized: z.boolean(), epoch: z.string(),
});
export const quizActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("answer"), idx: index, option: index }),
  z.object({ type: z.literal("submit"), idx: index }),
  z.object({ type: z.literal("hint"), idx: index, cap: index,
    question: z.object({ options: z.array(z.string()), correctAnswerIndex: index }) }),
  z.object({ type: z.literal("next"), idx: index, count: index }),
  z.object({ type: z.literal("prev"), idx: index }),
  z.object({ type: z.literal("go"), idx: index }),
  z.object({ type: z.literal("reset") }),
]);
export const tutorActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("send"), epoch: z.string(), message }),
  z.object({ type: z.literal("reply"), epoch: z.string(), turnId: z.string(),
    text: z.string(), summary: z.string().nullable(), ts: z.number().finite() }),
  z.object({ type: z.literal("hint"), probes: z.array(z.string()), fallback: z.string(),
    budget: index, ts: z.number().finite() }),
  z.object({ type: z.literal("synthesize"), text: z.string(), ts: z.number().finite() }),
  z.object({ type: z.literal("reset"), epoch: z.string(), opening: z.string(), ts: z.number().finite() }),
]);
