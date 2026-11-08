"use client";

import { useEffect, useRef, useState } from "react";
import type { Lens, SocraticPrompt } from "@/lib/paperpal/types";
import { readSaved, useAssessmentStore } from "@/lib/paperpal/assessment-store";
import { hasTutorReply, reduceTutor, TUTOR_INITIAL, type TutorMessage } from "@/lib/paperpal/assessment-state";
import { tutorActionSchema, tutorStateSchema } from "@/lib/paperpal/assessment-schema";
import { fetchSocratic } from "@/lib/paperpal/socratic";
import { withPaperPalSession } from "@/lib/paperpal/request";
import type { SocraticHistoryEntry } from "@/lib/paperpal/wire";
import "./assessment.css";

const LENS_HINT_BUDGET: Record<Lens, number> = {
  beginner: 4,
  engineer: 3,
  expert: 2,
};

const IDLE_PULSE_MS = 60_000;

export function SocraticMode({
  paperId,
  prompt,
  lens,
}: {
  paperId: string;
  prompt: SocraticPrompt;
  lens: Lens;
}) {
  const ns = `paperpal:v1:${paperId}:socratic:`;
  const threadKey = `${ns}thread:${prompt.id}`;
  const hintKey = `${ns}hints:${prompt.id}`;
  const synthKey = `${ns}synth:${prompt.id}`;
  const hintBudget = prompt.hintBudgetByLens?.[lens] ?? LENS_HINT_BUDGET[lens];
  const [saved, dispatch] = useAssessmentStore(
    `${paperId}:socratic:${prompt.id}`, TUTOR_INITIAL,
    () => {
      const thread = readSaved<TutorMessage[]>(threadKey, []);
      return {
        thread: thread.length ? thread : [{ role: "tutor" as const, body: prompt.openingQuestion, ts: 0 }],
        hintsUsed: readSaved(hintKey, 0), synthesized: readSaved(synthKey, false), epoch: "legacy",
      };
    }, reduceTutor,
    (next) => {
      localStorage.setItem(threadKey, JSON.stringify(next.thread));
      localStorage.setItem(hintKey, JSON.stringify(next.hintsUsed));
      localStorage.setItem(synthKey, JSON.stringify(next.synthesized));
    },
    { state: tutorStateSchema, action: tutorActionSchema },
  );
  const { thread, hintsUsed, synthesized } = saved;
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => activeRequest.current?.abort(), []);

  const [input, setInput] = useState("");
  const [pulse, setPulse] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length]);

  const hintsLeft = Math.max(0, hintBudget - hintsUsed);
  const learnerTurns = thread.filter(m => hasTutorReply(thread, m)).length;
  const minFloor = 3 + hintsUsed;

  const send = async () => {
    const text = input.trim();
    if (!text || synthesized || activeRequest.current) return;
    const turnId = crypto.randomUUID();
    const epoch = saved.epoch;
    const current = dispatch({ type: "send", epoch, message: { id: turnId, role: "learner", body: text, ts: Date.now() } });
    if (!current.thread.some(m => m.id === turnId)) return;
    setInput("");
    setNetworkError(null);
    if (current.synthesized) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setSending(true);
    setPendingTurn(turnId);
    const history: SocraticHistoryEntry[] = current.thread
      .filter(m => m.id !== turnId && m.kind !== "hint" && m.kind !== "synthesis")
      .filter(m => m.role !== "learner" || hasTutorReply(current.thread, m))
      .map(m => ({ role: m.role === "tutor" ? "ai" : "user", text: m.body }));
    const turnNumber = current.thread.filter(m => hasTutorReply(current.thread, m)).length + 1;
    try {
      const result = await withPaperPalSession((token, signal, timeoutMs) => fetchSocratic({
        paperId: Number.parseInt(paperId, 10), promptId: prompt.id,
        promptTopic: prompt.topic, openingQuestion: prompt.openingQuestion,
        scriptedProbes: prompt.scriptedProbes, history, userResponse: text, turnNumber,
      }, { accessToken: token, signal, timeoutMs }), controller.signal);
      dispatch({ type: "reply", epoch, turnId, text: result.next_question,
        summary: result.summary, ts: Date.now() });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message === "request_cancelled") return;
      setNetworkError(message === "not_attending_meeting_for_paper"
        ? "RSVP to a meeting using this paper to use the AI tutor."
        : "Tutor call failed — falling back to a scripted probe.");
      const probeIdx = Math.min(turnNumber - 1, (prompt.scriptedProbes?.length ?? 1) - 1);
      dispatch({ type: "reply", epoch, turnId,
        text: prompt.scriptedProbes?.[probeIdx] ?? "Say more about that.", summary: null, ts: Date.now() });
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setSending(false);
        setPendingTurn(null);
      }
    }
  };

  const askHint = () => {
    dispatch({ type: "hint", probes: prompt.scriptedProbes ?? [],
      fallback: `Think about what "${prompt.topic}" hinges on — what would break if we removed it?`,
      budget: hintBudget, ts: Date.now() });
    setPulse(false);
  };
  const wrapUp = (override = false) => {
    if (!override && learnerTurns < minFloor) return;
    dispatch({ type: "synthesize", text: prompt.goalInsight, ts: Date.now() });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // 60s idle pulse on hint button. When the timer is armed, its cleanup
  // clears the pulse on the next dep change (typing, spending a hint, a new
  // message); the early returns below skip arming it.
  useEffect(() => {
    if (input.trim().length > 0) return;
    if (hintsLeft <= 0) return;
    if (synthesized) return;
    const t = setTimeout(() => setPulse(true), IDLE_PULSE_MS);
    return () => {
      clearTimeout(t);
      setPulse(false);
    };
  }, [input, hintsLeft, synthesized, thread.length]);

  const reset = () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setSending(false);
    setPendingTurn(null);
    dispatch({ type: "reset", epoch: crypto.randomUUID(), opening: prompt.openingQuestion, ts: Date.now() });
    setInput("");
    setNetworkError(null);
  };

  return (
    <div className="pp-socratic-shell">
      <div
        className="pp-assessment-rail"
        style={{ padding: "16px 20px" }}
      >
        <span className="pp-eyebrow">Socratic tutor · {prompt.topic}</span>
        <h4 style={{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 500, marginTop: 6 }}>
          Think out loud.
        </h4>
        <div className="pp-desc">
          No multiple choice — work the idea through in your own words. The
          tutor probes with follow-ups and only confirms once you&apos;ve reasoned
          to it.
        </div>
      </div>

      <div className="pp-socratic-card">
        <div className="pp-socratic-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="pp-name">{prompt.topic}</div>
            <div className="pp-sub">Tutor · grounded in this paper</div>
          </div>
          {synthesized && (
            <span
              className="pp-eyebrow"
              style={{ color: "var(--color-sage-700)" }}
            >
              Synthesized
            </span>
          )}
        </div>

        <div className="pp-socratic-thread" ref={threadRef}>
          {thread.map((m, i) => (
            <div
              key={i}
              className={`pp-bubble from-${m.role} ${
                m.kind === "synthesis" ? "is-synthesis" : ""
              } ${m.kind === "hint" ? "is-hint" : ""}`}
            >
              <div className="pp-who">
                {m.role === "tutor"
                  ? m.kind === "synthesis"
                    ? "Tutor · synthesis"
                    : m.kind === "hint"
                    ? `Hint${
                        m.hintIndex ? ` · ${m.hintIndex}/${hintBudget}` : ""
                      }`
                    : "Tutor"
                  : "You"}
              </div>
              <div>{m.body}</div>
              {m.role === "learner" && !hasTutorReply(thread, m) && (
                <small>{m.id === pendingTurn ? "Waiting for a reply…" : "No reply saved. You can send this message again."}</small>
              )}
            </div>
          ))}
        </div>

        <div className="pp-socratic-composer">
          <button
            className={`pp-socratic-hint-btn ${pulse ? "is-pulsing" : ""}`}
            onClick={askHint}
            disabled={hintsLeft <= 0 || synthesized}
            title={
              hintsLeft <= 0
                ? "No more hints on this topic"
                : "Get a nudge — won't reveal the answer"
            }
          >
            {hintsLeft === hintBudget ? "Hint" : `Hint · ${hintsLeft} left`}
          </button>
          {!synthesized && learnerTurns >= 1 ? (
            <button
              className="pp-socratic-wrap-btn"
              onClick={() => wrapUp(true)}
              title="You declare convergence — the tutor will synthesize what you worked through."
            >
              I&apos;ve got it
            </button>
          ) : (
            <span />
          )}
          <textarea
            className="pp-socratic-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={
              synthesized
                ? "This topic is synthesized."
                : "Type your reasoning… (Enter to send)"
            }
            rows={1}
            disabled={synthesized}
          />
          <button
            className="pp-socratic-send"
            onClick={() => void send()}
            disabled={!input.trim() || synthesized || sending}
            aria-label="Send"
          >
            {sending ? "…" : "↑"}
          </button>
        </div>
        {networkError && (
          <p
            role="alert"
            className="pp-hint-note"
            style={{ marginTop: 8 }}
          >
            {networkError}
          </p>
        )}
      </div>

      {synthesized && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="pp-btn" onClick={reset}>
            Reset conversation
          </button>
        </div>
      )}
    </div>
  );
}
