// Client wrapper for /functions/v1/analyze-socratic.
//
// Shape mirrors the deployed Edge Function body
// (supabase/functions/analyze-socratic/index.ts) which needs the full
// prompt context — topic, opening_question, scripted_probes, history —
// because the LLM probe is grounded in the original Socratic prompt
// rather than a server-side prompt_id lookup. The summary field is
// optional and `null` when the turn doesn't trigger wrap-up.

import type {
  AnalyzeSocraticResponse,
  SocraticHistoryEntry,
} from "./wire";
import { postPaperPalJson } from "./client";

export type FetchSocraticInput = {
  paperId: number;
  promptId: string;
  promptTopic: string;
  openingQuestion: string;
  scriptedProbes?: string[];
  history?: SocraticHistoryEntry[];
  userResponse: string;
  turnNumber: number;
};

export async function fetchSocratic(
  input: FetchSocraticInput,
  { accessToken }: { accessToken: string },
): Promise<AnalyzeSocraticResponse> {
  const body: Record<string, unknown> = {
    paper_id: input.paperId,
    prompt_id: input.promptId,
    prompt_topic: input.promptTopic,
    opening_question: input.openingQuestion,
    user_response: input.userResponse,
    turn_number: input.turnNumber,
  };
  if (input.scriptedProbes !== undefined) body.scripted_probes = input.scriptedProbes;
  if (input.history !== undefined) body.history = input.history;

  return postPaperPalJson<AnalyzeSocraticResponse>(
    "/functions/v1/analyze-socratic",
    body,
    accessToken,
  );
}
