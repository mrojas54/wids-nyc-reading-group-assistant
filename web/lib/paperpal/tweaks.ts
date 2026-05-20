// Shared client-side "tweaks" state, persisted under the `tweaks`
// localStorage key. The floating Tweaks panel was removed; the topbar
// LensDropdown still reads/writes `tweaks.lens` through useTweaks.
import { useGlobalLocalState } from "./hooks";
import type { Lens } from "./types";

export type AssessmentMode = "mcq" | "socratic";

export type Tweaks = {
  mode: AssessmentMode;
  lens: Lens;
  layers: {
    groupHighlights: boolean;
    marginNotes: boolean;
    explainSelection: boolean;
  };
  tiles: {
    citedPapers: boolean;
    mastery: boolean;
    diff: boolean;
  };
  surfaces: {
    presenter: boolean;
    review: boolean;
    reproduce: boolean;
    compare: boolean;
  };
  panelOpen: boolean;
};

export const DEFAULT_TWEAKS: Tweaks = {
  mode: "mcq",
  lens: "engineer",
  layers: {
    groupHighlights: true,
    marginNotes: true,
    explainSelection: true,
  },
  tiles: {
    citedPapers: true,
    mastery: true,
    diff: false,
  },
  surfaces: {
    presenter: true,
    review: false,
    reproduce: false,
    compare: false,
  },
  panelOpen: false,
};

type Setter = (next: Tweaks | ((prev: Tweaks) => Tweaks)) => void;

export function useTweaks(): [Tweaks, Setter] {
  return useGlobalLocalState<Tweaks>("tweaks", DEFAULT_TWEAKS);
}
