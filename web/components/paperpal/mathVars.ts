// Pure math-variable helpers shared by server and client components.
// Kept out of Highlighted.tsx (a "use client" module) so Server Components
// like AbstractTile can call mathVarsFromExplanations directly — importing a
// plain function from a "use client" file yields a client-reference proxy,
// not the real callable.

import type { MathExplanation } from "@/lib/paperpal/types";

export type MathVar = { symbol: string; meaning: string; mathId?: string };

// Derive a deduplicated math-variable list from MathExplanation[] for the
// prose-highlighting pass.
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
