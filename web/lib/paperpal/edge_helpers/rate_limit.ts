// Rate-limit window computation for analyze-paper. Pure function so
// Vitest can exercise the env-var parsing without touching Deno.env.
//
// Contract: read PAPER_PAL_REGEN_COOLDOWN_SEC from the env, return
// the cooldown window in milliseconds. Non-numeric / negative values
// fall back to the default; zero is preserved (callers treat 0 as
// "rate-limiting disabled" — see analyze-paper's `window > 0` guard).

const DEFAULT_COOLDOWN_SEC = 300;

export function cooldownMs(envValue: string | undefined): number {
  const parsed = envValue ? parseInt(envValue, 10) : NaN;
  const seconds = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_COOLDOWN_SEC;
  return seconds * 1000;
}
