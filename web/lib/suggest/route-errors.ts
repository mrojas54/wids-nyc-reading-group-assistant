// The status codes the suggest, resolve-papers and backfill-embeddings routes
// share for errors they expect. Each route logs in its own format and handles
// anything this returns null for (a timeout, or an unexpected error).
import { z } from "zod";
import {
  ForbiddenError,
  ModelLoadError,
  S2AuthError,
  S2RequestError,
  UnauthorizedError,
} from "./types";

export type KnownError = { code: string; status: number; body: Record<string, unknown> };

export function knownErrorResponse(e: unknown): KnownError | null {
  const known = (code: string, status: number, extra: Record<string, unknown> = {}) => ({
    code,
    status,
    body: { error: code, ...extra },
  });
  if (e instanceof UnauthorizedError) return known("unauthorized", 401);
  if (e instanceof ForbiddenError) return known("forbidden", 403);
  if (e instanceof z.ZodError) return known("invalid_request", 400, { issues: e.issues });
  if (e instanceof S2AuthError) return known("s2_auth", 502);
  if (e instanceof S2RequestError) return known("s2_request", 502);
  if (e instanceof ModelLoadError) {
    return known("wasm_model_load_failed", 502, { detail: e.message });
  }
  return null;
}
