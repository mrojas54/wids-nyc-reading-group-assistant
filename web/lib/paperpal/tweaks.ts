// Shared client-side "tweaks" state, persisted under the `tweaks`
// localStorage key and consumed via useTweaks — the topbar LensDropdown
// (lens) and the assessment mode strip (mode).
import { useGlobalLocalState } from "./hooks";
import type { Lens } from "./types";

export type AssessmentMode = "mcq" | "socratic";

export type Tweaks = {
  mode: AssessmentMode;
  lens: Lens;
};

export const DEFAULT_TWEAKS: Tweaks = {
  mode: "mcq",
  lens: "engineer",
};

type Setter = (next: Tweaks | ((prev: Tweaks) => Tweaks)) => void;

export function useTweaks(): [Tweaks, Setter] {
  return useGlobalLocalState<Tweaks>("tweaks", DEFAULT_TWEAKS);
}
