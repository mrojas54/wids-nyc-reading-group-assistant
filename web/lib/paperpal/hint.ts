// Client wrapper for /functions/v1/analyze-hint.
//
// Shape mirrors the deployed Edge Function body
// (supabase/functions/analyze-hint/index.ts):
//   { paper_id, question_text, question_options?, user_answer }
// and the JSON response: { hint, confidence, provider, model }.

import type { AnalyzeHintResponse } from "./wire";
import { postPaperPalJson } from "./client";

export type FetchHintInput = {
  paperId: number;
  questionText: string;
  questionOptions?: string[];
  userAnswer: string;
};

export async function fetchHint(
  input: FetchHintInput,
  { accessToken }: { accessToken: string },
): Promise<AnalyzeHintResponse> {
  const body: Record<string, unknown> = {
    paper_id: input.paperId,
    question_text: input.questionText,
    user_answer: input.userAnswer,
  };
  if (input.questionOptions !== undefined) {
    body.question_options = input.questionOptions;
  }

  return postPaperPalJson<AnalyzeHintResponse>(
    "/functions/v1/analyze-hint",
    body,
    accessToken,
  );
}
