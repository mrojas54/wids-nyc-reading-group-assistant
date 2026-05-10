import { z } from "zod";

export const ResolvedPaperSchema = z.object({
  id: z.number().int(),
  s2_paper_id: z.string().min(1),
  title: z.string(),
  abstract: z.string().default(""),
});
export type ResolvedPaper = z.infer<typeof ResolvedPaperSchema>;

export const SuggestRequestSchema = z.object({
  candidates: z.array(ResolvedPaperSchema).min(1).max(10),
  past_picks: z.array(ResolvedPaperSchema).min(1),
  lambda: z.number().min(0).max(1).default(0.6),
  k: z.number().int().min(1).max(10).default(10),
});
export type SuggestRequest = z.infer<typeof SuggestRequestSchema>;

export type RankedResult = {
  paper_id: number;
  title: string;
  mmr_score: number;
};

export type SuggestDiagnostics = {
  cache_hits: number;
  s2_fetched: number;
  fallback_used: number;
  cold_start: boolean;
  total_ms: number;
};

export type SuggestResponse = {
  ranked: RankedResult[];
  diagnostics: SuggestDiagnostics;
};

export type S2Result =
  | { kind: "hit"; paperId: string; vector: Float32Array; title: string; abstract: string }
  | { kind: "fallback_needed"; paperId: string; reason: "no_embedding" | "not_in_corpus" | "s2_transient"; title: string; abstract: string }
  | { kind: "error"; paperId: string; status: number; message: string };

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}
export class ForbiddenError extends Error {
  constructor() {
    super("forbidden");
    this.name = "ForbiddenError";
  }
}
export class S2AuthError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "S2AuthError";
  }
}
export class S2RequestError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "S2RequestError";
  }
}
export class ModelLoadError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "ModelLoadError";
  }
}
export class TimeoutError extends Error {
  constructor() {
    super("timeout");
    this.name = "TimeoutError";
  }
}
