"use client";

import { useState } from "react";
import type { AssessmentQuiz, Lens, QuizQuestion } from "@/lib/paperpal/types";
import { usePaperLocalState, recordHint } from "@/lib/paperpal/hooks";
import { fetchHint } from "@/lib/paperpal/hint";
import {
  MCQ_INITIAL,
  applyHint,
  currentIndex,
  eliminatedAt,
  goToQuestion,
  hintCap,
  nextQuestion,
  prevQuestion,
  scoreQuiz,
  selectAnswer,
  submitAnswer,
  type McqState,
} from "@/lib/paperpal/mcq";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { AnalyzeHintResponse } from "@/lib/paperpal/wire";
import { AiHintNote, type AiHintState } from "./AiHintNote";
import { McqResults } from "./McqResults";
import "./assessment.css";

const LENS_LABEL: Record<Lens, string> = {
  beginner: "Beginner",
  engineer: "Engineer",
  expert: "Expert",
};

export function McqMode({
  paperId,
  quiz,
  lens,
}: {
  paperId: string;
  quiz: AssessmentQuiz;
  lens: Lens;
}) {
  const questions = quiz.questions;
  const [state, setState] = usePaperLocalState<McqState>(
    paperId,
    "assessment:mcq",
    MCQ_INITIAL,
  );
  const [aiHint, setAiHint] = useState<Record<number, AiHintState>>({});

  const idx = currentIndex(state, questions.length);
  const current: QuizQuestion | undefined = questions[idx];
  const selected = state.answers[idx];
  const showFeedback = !!state.submitted[idx];
  const eliminated = eliminatedAt(state, idx);
  const HINT_CAP = hintCap(lens, current?.options.length ?? 0);

  if (!current) {
    return (
      <div className="pp-assessment-card">
        <p>No questions available.</p>
      </div>
    );
  }

  const apply = (next: McqState) => {
    if (next !== state) setState(next);
  };

  const setAnswer = (i: number) => apply(selectAnswer(state, idx, i));

  const useHint = () => {
    const next = applyHint(state, idx, current, HINT_CAP);
    if (next === state) return;
    setState(next);
    if (current.sectionRef) recordHint(paperId, current.sectionRef);
  };

  const askAiHint = async () => {
    if (selected == null || showFeedback) return;
    if (aiHint[idx]?.status === "loading") return;
    setAiHint((s) => ({ ...s, [idx]: { status: "loading" } }));
    try {
      const sb = createSupabaseBrowserClient();
      const { data } = await sb.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error("not_signed_in");
      const result: AnalyzeHintResponse = await fetchHint(
        {
          paperId: Number.parseInt(paperId, 10),
          questionText: current.question,
          questionOptions: current.options,
          userAnswer: current.options[selected],
        },
        { accessToken: token },
      );
      setAiHint((s) => ({
        ...s,
        [idx]: { status: "ready", hint: result.hint, confidence: result.confidence },
      }));
      if (current.sectionRef) recordHint(paperId, current.sectionRef);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const friendly =
        message === "not_attending_meeting_for_paper"
          ? "RSVP to a meeting using this paper to unlock written hints."
          : "Couldn't fetch a hint. Try again in a moment.";
      setAiHint((s) => ({ ...s, [idx]: { status: "error", message: friendly } }));
    }
  };

  const submit = () => apply(submitAnswer(state, idx));
  const next = () => apply(nextQuestion(state, idx, questions.length));
  const prev = () => apply(prevQuestion(state, idx));
  const goToQ = (i: number) => setState(goToQuestion(state, i));
  const reset = () => setState(MCQ_INITIAL);

  const score = scoreQuiz(state, questions);
  const done = state.done;

  return (
    <div className="pp-assessment-shell">
      <aside className="pp-assessment-rail">
        <span className="pp-eyebrow">Assessment · {LENS_LABEL[lens]} lens</span>
        <h4>{done ? "How did you do?" : "Verify your understanding."}</h4>
        <div className="pp-desc">
          {done
            ? "Click any question to revisit it, or jump back into the synthesis to revisit the answer."
            : `${questions.length} questions tuned to your lens. Submit each and review where the answer lived in the paper.`}
        </div>

        <div className="pp-qmap">
          {questions.map((q, i) => {
            const ans = state.answers[i];
            const sub = !!state.submitted[i];
            const ok = ans === q.correctAnswerIndex;
            const cls = [
              "pp-qmap-row",
              i === idx && !done && "is-current",
              ans != null && !sub && "is-answered",
              sub && ok && "is-correct",
              sub && !ok && "is-wrong",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button key={i} className={cls} onClick={() => goToQ(i)}>
                <span className="pp-qnum">
                  Q{String(i + 1).padStart(2, "0")}
                </span>
                <span className="pp-qmap-label">{q.question}</span>
                <span className="pp-qstatus" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 18,
            paddingTop: 16,
            borderTop: "1px dashed var(--border-1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span className="pp-eyebrow">Score</span>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 22,
              fontWeight: 500,
              color: "var(--fg-1)",
            }}
          >
            {score}{" "}
            <span style={{ color: "var(--fg-3)", fontSize: 16 }}>
              / {questions.length}
            </span>
          </span>
        </div>

        {done && (
          <button
            className="pp-btn"
            style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
            onClick={reset}
          >
            Retake assessment
          </button>
        )}
      </aside>

      <div className="pp-assessment-card">
        {!done ? (
          <>
            <div
              className="pp-assessment-progress"
              aria-label={`Question ${idx + 1} of ${questions.length}`}
            >
              {questions.map((_, i) => (
                <span
                  key={i}
                  className={`pp-tick ${i < idx ? "done" : ""} ${
                    i === idx ? "current" : ""
                  }`}
                />
              ))}
            </div>

            <div className="pp-assessment-card-meta">
              <span className="pp-eyebrow">
                Question {String(idx + 1).padStart(2, "0")} of{" "}
                {questions.length}
              </span>
              {current.sectionRef && (
                <span className="pp-eyebrow">
                  Reviews § {current.sectionRef}
                </span>
              )}
            </div>

            <div className="pp-quiz-q">{current.question}</div>

            {current.options.map((opt, i) => {
              const isOut = eliminated.includes(i);
              let cls = "pp-quiz-option";
              if (isOut) cls += " is-eliminated";
              if (selected === i && !isOut) cls += " is-selected";
              if (showFeedback) {
                if (i === current.correctAnswerIndex)
                  cls = "pp-quiz-option is-correct";
                else if (i === selected) cls = "pp-quiz-option is-wrong";
                else if (isOut) cls = "pp-quiz-option is-eliminated";
              }
              const letter = "ABCD"[i] ?? String(i + 1);
              return (
                <button
                  key={i}
                  className={cls}
                  onClick={() => setAnswer(i)}
                  disabled={showFeedback || isOut}
                  aria-disabled={showFeedback || isOut}
                >
                  <span className="pp-letter">{letter}</span>
                  <span className="pp-label">{opt}</span>
                  {isOut ? (
                    <span
                      className="pp-indicator-out"
                      aria-hidden="true"
                      style={{ fontSize: 11 }}
                    >
                      ×
                    </span>
                  ) : (
                    <span className="pp-indicator" />
                  )}
                </button>
              );
            })}

            {!showFeedback && eliminated.length > 0 && (
              <div className="pp-hint-note" role="status">
                <span className="pp-hint-note-icon">!</span>
                <span>
                  <strong>Hint applied.</strong>{" "}
                  {eliminated.length === 1
                    ? "One wrong option is out — narrow it down from here."
                    : `${eliminated.length} options eliminated.`}
                </span>
                <span className="pp-hint-note-meta">
                  {eliminated.length} / {HINT_CAP} used
                </span>
              </div>
            )}

            <AiHintNote hint={aiHint[idx]} />

            {showFeedback && (
              <div
                className={`pp-quiz-feedback ${
                  selected === current.correctAnswerIndex
                    ? "is-correct"
                    : "is-wrong"
                }`}
              >
                <p>
                  <strong>
                    {selected === current.correctAnswerIndex
                      ? "Correct."
                      : "Not quite."}
                  </strong>{" "}
                  {current.explanation}
                </p>
              </div>
            )}

            <div className="pp-assessment-footer">
              <button
                className="pp-btn"
                disabled={idx === 0}
                onClick={prev}
              >
                Previous
              </button>
              {!showFeedback ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    className="pp-btn-hint"
                    onClick={useHint}
                    disabled={eliminated.length >= HINT_CAP}
                    title={
                      eliminated.length >= HINT_CAP
                        ? "No more hints"
                        : "Eliminate one wrong option"
                    }
                  >
                    {eliminated.length === 0
                      ? "Hint"
                      : `Hint · ${HINT_CAP - eliminated.length} left`}
                  </button>
                  <button
                    className="pp-btn-hint"
                    onClick={askAiHint}
                    disabled={
                      selected == null || aiHint[idx]?.status === "loading"
                    }
                    title={
                      selected == null
                        ? "Pick an answer first"
                        : "Ask the AI for a written hint"
                    }
                  >
                    {aiHint[idx]?.status === "loading" ? "Thinking…" : "Ask AI"}
                  </button>
                  <button
                    className="pp-btn pp-btn-primary"
                    disabled={selected == null}
                    onClick={submit}
                  >
                    Submit answer
                  </button>
                </div>
              ) : (
                <button className="pp-btn pp-btn-primary" onClick={next}>
                  {idx + 1 < questions.length
                    ? "Next question"
                    : "See results"}
                </button>
              )}
            </div>
          </>
        ) : (
          <McqResults
            score={score}
            total={questions.length}
            onRetake={reset}
          />
        )}
      </div>
    </div>
  );
}
