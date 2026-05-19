"use client";

import { useMemo, useState } from "react";
import type { AssessmentQuiz, Lens, QuizQuestion } from "@/lib/paperpal/types";
import { usePaperLocalState, recordHint } from "@/lib/paperpal/hooks";
import { fetchHint } from "@/lib/paperpal/hint";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { AnalyzeHintResponse, HintConfidence } from "@/lib/paperpal/wire";
import "./assessment.css";

type AiHintState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; hint: string; confidence: HintConfidence }
  | { status: "error"; message: string };

const CONFIDENCE_COLOR: Record<HintConfidence, string> = {
  low: "var(--color-paper-400)",
  medium: "var(--color-indigo-400)",
  high: "var(--color-sage-600)",
};

interface McqState {
  idx: number;
  answers: Record<number, number>;
  submitted: Record<number, boolean>;
  hints: Record<number, number[]>;
  done: boolean;
}

const INITIAL: McqState = {
  idx: 0,
  answers: {},
  submitted: {},
  hints: {},
  done: false,
};

const LENS_LABEL: Record<Lens, string> = {
  beginner: "Beginner",
  engineer: "Engineer",
  expert: "Expert",
};

const LENS_HINT_BUDGET: Record<Lens, number> = {
  beginner: 3,
  engineer: 2,
  expert: 1,
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
    INITIAL,
  );
  const [aiHint, setAiHint] = useState<Record<number, AiHintState>>({});

  const idx = Math.min(
    Math.max(0, state.idx || 0),
    Math.max(0, questions.length - 1),
  );
  const current: QuizQuestion | undefined = questions[idx];
  const selected = state.answers[idx];
  const showFeedback = !!state.submitted[idx];
  const eliminated = state.hints[idx] || [];
  const optionCount = current?.options.length ?? 0;
  const HINT_CAP = useMemo(
    () => Math.min(LENS_HINT_BUDGET[lens], Math.max(1, optionCount - 2)),
    [lens, optionCount],
  );

  if (!current) {
    return (
      <div className="pp-assessment-card">
        <p>No questions available.</p>
      </div>
    );
  }

  const update = (patch: Partial<McqState>) =>
    setState({ ...state, ...patch });

  const setAnswer = (i: number) => {
    if (showFeedback || eliminated.includes(i)) return;
    update({ answers: { ...state.answers, [idx]: i } });
  };

  const useHint = () => {
    if (showFeedback || eliminated.length >= HINT_CAP) return;
    const candidates = current.options
      .map((_, i) => i)
      .filter(
        (i) => i !== current.correctAnswerIndex && !eliminated.includes(i),
      );
    if (!candidates.length) return;
    const pick = candidates.find((i) => i !== selected) ?? candidates[0];
    const nextHints = { ...state.hints, [idx]: [...eliminated, pick] };
    let nextAnswers = state.answers;
    if (selected === pick) {
      nextAnswers = { ...state.answers };
      delete nextAnswers[idx];
    }
    update({ hints: nextHints, answers: nextAnswers });
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

  const submit = () => {
    if (selected == null || showFeedback) return;
    update({ submitted: { ...state.submitted, [idx]: true } });
  };

  const next = () => {
    if (idx + 1 >= questions.length) update({ done: true });
    else update({ idx: idx + 1 });
  };

  const prev = () => {
    if (idx === 0) return;
    update({ idx: idx - 1 });
  };

  const goToQ = (i: number) => update({ idx: i, done: false });

  const reset = () => setState(INITIAL);

  const score = questions.reduce(
    (acc, q, i) => acc + (state.answers[i] === q.correctAnswerIndex ? 1 : 0),
    0,
  );
  const pct = Math.round((score / questions.length) * 100);

  const done = state.done;
  const grade =
    pct >= 80
      ? "Strong recall"
      : pct >= 60
      ? "Workable understanding"
      : "Re-read recommended";
  const stroke =
    pct >= 80
      ? "var(--color-sage-600)"
      : pct >= 60
      ? "var(--color-warning-500, #c89a3a)"
      : "var(--color-magenta-500)";
  const r = 56;
  const c = 2 * Math.PI * r;
  const dash = c * (pct / 100);

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

            {aiHint[idx] && aiHint[idx].status !== "idle" && (
              <div
                className="pp-hint-note"
                role="status"
                style={{ flexDirection: "column", alignItems: "stretch" }}
              >
                {aiHint[idx].status === "loading" && (
                  <span>Asking the AI for a hint…</span>
                )}
                {aiHint[idx].status === "ready" && (
                  <>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: CONFIDENCE_COLOR[
                            (aiHint[idx] as { confidence: HintConfidence }).confidence
                          ],
                          color: "white",
                          textTransform: "capitalize",
                        }}
                      >
                        {(aiHint[idx] as { confidence: HintConfidence }).confidence}{" "}
                        confidence
                      </span>
                      <strong>AI hint</strong>
                    </div>
                    <p style={{ marginTop: 6, lineHeight: 1.55 }}>
                      {(aiHint[idx] as { hint: string }).hint}
                    </p>
                  </>
                )}
                {aiHint[idx].status === "error" && (
                  <span>
                    {(aiHint[idx] as { message: string }).message}
                  </span>
                )}
              </div>
            )}

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
          <div style={{ textAlign: "center", paddingTop: 16 }}>
            <div className="pp-score-circle">
              <svg viewBox="0 0 140 140">
                <circle
                  cx="70"
                  cy="70"
                  r={r}
                  fill="none"
                  stroke="var(--color-paper-200)"
                  strokeWidth="10"
                />
                <circle
                  cx="70"
                  cy="70"
                  r={r}
                  fill="none"
                  stroke={stroke}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${c}`}
                />
              </svg>
              <div className="pp-num">
                {score}/{questions.length}
              </div>
            </div>
            <span className="pp-eyebrow">Result · {pct}%</span>
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 28,
                fontWeight: 500,
                letterSpacing: "-0.02em",
                marginTop: 8,
                color: "var(--fg-1)",
              }}
            >
              {grade}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 14,
                color: "var(--fg-3)",
                maxWidth: "48ch",
                margin: "6px auto 0",
                lineHeight: 1.55,
              }}
            >
              Jump back into the synthesis to revisit anything you missed.
            </div>
            <div
              style={{
                marginTop: 22,
                display: "flex",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <button className="pp-btn" onClick={reset}>
                Retake
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
