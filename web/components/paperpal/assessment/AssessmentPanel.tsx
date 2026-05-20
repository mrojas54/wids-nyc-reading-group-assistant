"use client";

import type { AssessmentQuiz, SocraticPrompt } from "@/lib/paperpal/types";
import { useTweaks, type AssessmentMode } from "@/lib/paperpal/tweaks";
import { McqMode } from "./McqMode";
import { SocraticMode } from "./SocraticMode";
import "./assessment.css";

export function AssessmentPanel({
  paperId,
  quiz,
  socraticPrompts,
}: {
  paperId: string;
  quiz: AssessmentQuiz;
  socraticPrompts?: SocraticPrompt[];
}) {
  const [tweaks, setTweaks] = useTweaks();

  const mode = tweaks.mode;
  const lens = tweaks.lens;
  const setMode = (m: AssessmentMode) =>
    setTweaks((prev) => ({ ...prev, mode: m }));

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
