// Boundary-neutral math-variable helper. Lives outside any `"use client"`
// module so Server Components (e.g. AbstractTile) can call it directly —
// importing a runtime value from a `"use client"` module yields a client
// reference proxy, not the function, and calling it throws at render time.

import type { MathExplanation } from "./types";

export type MathVar = { symbol: string; meaning: string; mathId?: string };

// Derive a deduplicated math-variable list from MathExplanation[] for the
// inline prose-highlighting pass.
export function mathVarsFromExplanations(
  explanations: MathExplanation[] | undefined,
): MathVar[] {
  if (!explanations) return [];
  const seen = new Map<string, MathVar>();
  for (const m of explanations) {
    for (const v of m.variables || []) {
      if (!seen.has(v.name)) {
        seen.set(v.name, { symbol: v.name, meaning: v.meaning });
      }
    }
  }
  return Array.from(seen.values());
}
