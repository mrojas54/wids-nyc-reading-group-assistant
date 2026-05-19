// Client wrapper for /functions/v1/analyze-hint.
//
// Shape mirrors the deployed Edge Function body
// (supabase/functions/analyze-hint/index.ts):
//   { paper_id, question_text, question_options?, user_answer }
// and the JSON response: { hint, confidence, provider, model }.

import type { AnalyzeHintResponse } from "./wire";

export type FetchHintInput = {
  paperId: number;
  questionText: string;
  questionOptions?: string[];
  userAnswer: string;
};

export type FetchHintError = Error & {
  status: number;
  code: string;
  detail?: unknown;
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

  const res = await fetch("/functions/v1/analyze-hint", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const raw = await res.json().catch(() => null);
    const parsed =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const code =
      parsed && typeof parsed.error === "string"
        ? (parsed.error as string)
        : `hint_failed_${res.status}`;
    const err = new Error(code) as FetchHintError;
    err.status = res.status;
    err.code = code;
    if (parsed?.detail !== undefined) err.detail = parsed.detail;
    throw err;
  }

  return (await res.json()) as AnalyzeHintResponse;
}
