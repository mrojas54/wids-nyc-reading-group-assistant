// Provider abstraction entry point. Dispatches to gemini.ts or claude.ts
// based on opts.provider, applies zod validation, returns a uniform shape.
//
// Spec: docs/superpowers/specs/2026-05-17-paper-pal-edge-functions.md §5
//
// Imported from BOTH:
//   - Node (Vitest tests in __tests__/) via package-relative import
//   - Deno (supabase/functions/*) via a relative path + import_map that
//     maps "zod" → "npm:zod@^4"
//
// Keep this file (and everything it transitively imports) free of
// Node-specific APIs (fs, path, Buffer, process.*). The cross-runtime
// env shim in gemini.ts / claude.ts handles process.env vs Deno.env.
//
// Relative imports MUST carry the explicit `.ts` extension — Deno
// requires it; the Node/bundler side tolerates it via
// `allowImportingTsExtensions` in web/tsconfig.json.
import { geminiSynthesize, geminiHint, geminiSocratic } from "./gemini.ts";
import { claudeSynthesize, claudeHint, claudeSocratic } from "./claude.ts";
import { isProvider } from "./types.ts";
import type {
  HintInput,
  HintResult,
  Provider,
  SocraticInput,
  SocraticResult,
  SynthesizeOpts,
  SynthesizePaperInput,
  SynthesizePaperResult,
} from "./types.ts";

export type {
  Provider,
  StoredProvider,
  ProviderMeta,
  SynthesizePaperResult,
} from "./types.ts";
export { isProvider, isStoredProvider } from "./types.ts";
export { researchPaperAnalysisSchema } from "./schema.ts";

function unknownProvider(p: string): never {
  throw new Error(`unknown provider ${p}`);
}

export async function synthesizePaper(
  input: SynthesizePaperInput,
  opts: SynthesizeOpts,
): Promise<SynthesizePaperResult> {
  if (opts.provider === "gemini") return geminiSynthesize(input, opts);
  if (opts.provider === "claude") return claudeSynthesize(input, opts);
  return unknownProvider(opts.provider);
}

export async function generateHint(input: HintInput, opts: SynthesizeOpts): Promise<HintResult> {
  if (opts.provider === "gemini") return geminiHint(input, opts);
  if (opts.provider === "claude") return claudeHint(input, opts);
  return unknownProvider(opts.provider);
}

export async function nextSocraticTurn(
  input: SocraticInput,
  opts: SynthesizeOpts,
): Promise<SocraticResult> {
  if (opts.provider === "gemini") return geminiSocratic(input, opts);
  if (opts.provider === "claude") return claudeSocratic(input, opts);
  return unknownProvider(opts.provider);
}

// Helper for callers that want to honor the env default + admin override
// rule from spec §13.5 without re-implementing the precedence each time.
//
// Precedence: bodyProvider (admin-only) → envDefault → "gemini".
//
// We deliberately fall back to "gemini" rather than throwing on unknown
// values because the env default of `undefined` is a normal config state
// for prod (it just means "use the built-in default"). Bad-string inputs
// are silently coerced; a bad bodyProvider from an admin is on the admin
// to debug.
export function resolveProvider(opts: {
  envDefault: string | undefined;
  bodyProvider?: string;
  callerIsAdmin: boolean;
}): Provider {
  const requested = opts.callerIsAdmin && opts.bodyProvider ? opts.bodyProvider : opts.envDefault;
  return isProvider(requested) ? requested : "gemini";
}
