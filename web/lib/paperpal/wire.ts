// Wire types for the three Paper Pal Edge Function endpoints.
//
// Shapes mirror the actual Edge Function bodies (supabase/functions/*) — not
// the high-level plan, which predates the implementation. When the two
// disagree, this file follows the deployed function.
//
// Domain types (the `payload` shape inside paper_companions) live in
// ./types.ts. Keeping wire vs. domain split prevents browser code that
// only POSTs a request from pulling in the whole ResearchPaperAnalysis tree.

// ---------------------------------------------------------------------------
// /functions/v1/analyze-paper — SSE over POST
// ---------------------------------------------------------------------------

export type AnalyzePaperProvider = "gemini" | "claude";

export type AnalyzePaperRequest = {
  paper_id: number;
  pdf_storage_path: string;
  provider?: AnalyzePaperProvider;
};

export type AnalyzePaperRateLimited = {
  error: "rate_limited";
  retry_after_seconds: number;
};

export type AnalyzePaperErrorResponse = {
  error: string;
  detail?: unknown;
};

export type AnalyzePaperStage =
  | "parsing_pdf"
  | "generating_synthesis"
  | "drafting_assessment"
  | "persisting";

export type AnalyzePaperStageEvent = {
  stage: AnalyzePaperStage;
  elapsed_ms: number;
  provider?: string;
  model?: string;
};

export type AnalyzePaperCompleteEvent = {
  paper_id: number;
  provider: string;
  model: string;
  provider_duration_ms: number;
  duration_ms: number;
};

// The Edge Function emits `event: error` with `{ message, ...extra }`.
export type AnalyzePaperErrorEvent = {
  message: string;
};

// ---------------------------------------------------------------------------
// /functions/v1/analyze-hint — JSON over POST
// ---------------------------------------------------------------------------

export type HintConfidence = "low" | "medium" | "high";

export type AnalyzeHintRequest = {
  paper_id: number;
  question_text: string;
  question_options?: string[];
  user_answer: string;
};

export type AnalyzeHintResponse = {
  hint: string;
  confidence: HintConfidence;
  provider: string;
  model: string;
};

// ---------------------------------------------------------------------------
// /functions/v1/analyze-socratic — JSON over POST
// ---------------------------------------------------------------------------

export type SocraticHistoryEntry = {
  role: "ai" | "user";
  text: string;
};

export type AnalyzeSocraticRequest = {
  paper_id: number;
  prompt_id: string;
  prompt_topic: string;
  opening_question: string;
  scripted_probes?: string[];
  history?: SocraticHistoryEntry[];
  user_response: string;
  turn_number: number;
};

export type AnalyzeSocraticResponse = {
  next_question: string;
  summary: string | null;
  provider: string;
  model: string;
};
