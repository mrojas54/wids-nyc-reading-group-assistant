// Shared types for the provider abstraction.
// Kept in a separate file so Deno Edge Functions can import just the
// types without pulling in the heavier zod schema + provider impls.
import type { ResearchPaperAnalysis } from "../types";

export type Provider = "gemini" | "claude";

export type ProviderMeta = {
  provider: Provider;
  model: string;
  // Wall-clock duration of the provider call only; SSE-stage timing is
  // tracked separately by the caller.
  durationMs: number;
  // Provider-reported token counts when available (Gemini: usageMetadata;
  // Claude: usage). null when the provider doesn't expose them.
  inputTokens: number | null;
  outputTokens: number | null;
};

export type SynthesizePaperInput = {
  // Short-lived signed URL minted by the Edge Function from the storage
  // path the caller supplied. NEVER the caller-supplied URL directly —
  // see spec §13.4 (SSRF prevention).
  pdfUrl: string;
  // Hint-only; the provider may still pull title from the PDF itself.
  paperTitle?: string;
};

export type SynthesizePaperResult = {
  payload: ResearchPaperAnalysis;
  meta: ProviderMeta;
};

export type HintInput = {
  paperTitle: string;
  questionText: string;
  questionOptions?: string[];
  userAnswer: string;
};

export type HintResult = {
  hint: string;
  confidence: "low" | "medium" | "high";
  meta: ProviderMeta;
};

export type SocraticInput = {
  paperTitle: string;
  promptTopic: string;
  openingQuestion: string;
  scriptedProbes: string[];
  // Full transcript so far. The first turn has just the opening question;
  // subsequent turns include each user response and ai_next_question.
  history: Array<{ role: "ai" | "user"; text: string }>;
  userResponse: string;
  turnNumber: number;
};

export type SocraticResult = {
  nextQuestion: string;
  summary?: string;
  meta: ProviderMeta;
};

export type SynthesizeOpts = {
  provider: Provider;
  model?: string;
  // API keys are read from env in the provider implementations themselves
  // (Deno.env or process.env), so this object stays free of secrets.
};
