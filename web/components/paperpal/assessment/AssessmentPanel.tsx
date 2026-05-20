"use client";

import type {
  AssessmentQuiz,
  Lens,
  SocraticPrompt,
} from "@/lib/paperpal/types";
import { useGlobalLocalState } from "@/lib/paperpal/hooks";
import { McqMode } from "./McqMode";
import { SocraticMode } from "./SocraticMode";
import "./assessment.css";

type AssessmentMode = "mcq" | "socratic";

interface Tweaks {
  assessmentMode: AssessmentMode;
  lens: Lens;
  [k: string]: unknown;
}

const DEFAULT_TWEAKS: Tweaks = {
  assessmentMode: "mcq",
  lens: "engineer",
};

export function AssessmentPanel({
  paperId,
  quiz,
  socraticPrompts,
}: {
  paperId: string;
  quiz: AssessmentQuiz;
  socraticPrompts?: SocraticPrompt[];
}) {
  const [tweaks, setTweaks] = useGlobalLocalState<Tweaks>(
    "tweaks",
    DEFAULT_TWEAKS,
  );

  const mode = tweaks.assessmentMode;
  const lens = tweaks.lens;
  const setMode = (m: AssessmentMode) =>
    setTweaks({ ...tweaks, assessmentMode: m });

  const hasSocratic = !!socraticPrompts && socraticPrompts.length > 0;
  const activeSocratic = hasSocratic ? socraticPrompts![0] : null;

  return (
    <section aria-label="Assessment">
      <div className="pp-mode-strip" role="tablist">
        <button
          role="tab"
          aria-selected={mode === "mcq"}
          className={mode === "mcq" ? "is-active" : ""}
          onClick={() => setMode("mcq")}
        >
          Multiple choice
        </button>
        <button
          role="tab"
          aria-selected={mode === "socratic"}
          className={mode === "socratic" ? "is-active" : ""}
          onClick={() => setMode("socratic")}
          disabled={!hasSocratic}
          title={hasSocratic ? undefined : "No Socratic prompts for this paper"}
        >
          Socratic tutor
        </button>
      </div>

      {mode === "mcq" || !activeSocratic ? (
        <McqMode paperId={paperId} quiz={quiz} lens={lens} />
      ) : (
        <SocraticMode
          paperId={paperId}
          prompt={activeSocratic}
          lens={lens}
        />
      )}
    </section>
  );
}
