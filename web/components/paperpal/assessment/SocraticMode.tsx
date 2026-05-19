"use client";

import { useEffect, useRef, useState } from "react";
import type { Lens, SocraticPrompt } from "@/lib/paperpal/types";
import { usePaperLocalState, recordHint } from "@/lib/paperpal/hooks";
import { fetchSocratic } from "@/lib/paperpal/socratic";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { SocraticHistoryEntry } from "@/lib/paperpal/wire";
import "./assessment.css";

type Role = "tutor" | "learner";

interface Message {
  role: Role;
  body: string;
  ts: number;
  kind?: "hint" | "synthesis";
  hintIndex?: number;
}

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
  const persistKey = `socratic:thread:${prompt.id}`;
  const hintBudget = prompt.hintBudgetByLens?.[lens] ?? LENS_HINT_BUDGET[lens];

  const [thread, setThread] = usePaperLocalState<Message[]>(
    paperId,
    persistKey,
    [],
  );
  const [hintsUsed, setHintsUsed] = usePaperLocalState<number>(
    paperId,
    `socratic:hints:${prompt.id}`,
    0,
  );
  const [synthesized, setSynthesized] = usePaperLocalState<boolean>(
    paperId,
    `socratic:synth:${prompt.id}`,
    false,
  );

  const [input, setInput] = useState("");
  const [pulse, setPulse] = useState(false);
  const [sending, setSending] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  // Seed opener once.
  useEffect(() => {
    if (thread.length === 0) {
      setThread([
        {
          role: "tutor",
          body: prompt.openingQuestion,
          ts: Date.now(),
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt.id]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length]);

  const hintsLeft = Math.max(0, hintBudget - hintsUsed);
  const learnerTurns = thread.filter((m) => m.role === "learner").length;
  const minFloor = 3 + hintsUsed;

  const append = (msg: Message) => setThread([...thread, msg]);

  function buildHistory(): SocraticHistoryEntry[] {
    return thread
      .filter((m) => m.kind !== "hint" && m.kind !== "synthesis")
      .map<SocraticHistoryEntry>((m) => ({
        role: m.role === "tutor" ? "ai" : "user",
        text: m.body,
      }));
  }

  const send = async () => {
    const text = input.trim();
    if (!text || synthesized || sending) return;
    setInput("");
    setNetworkError(null);
    const learnerMsg: Message = { role: "learner", body: text, ts: Date.now() };
    setSending(true);
    let probe: string | null = null;
    let summaryOut: string | null = null;
    try {
      const sb = createSupabaseBrowserClient();
      const { data } = await sb.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error("not_signed_in");
      const result = await fetchSocratic(
        {
          paperId: Number.parseInt(paperId, 10),
          promptId: prompt.id,
          promptTopic: prompt.topic,
          openingQuestion: prompt.openingQuestion,
          scriptedProbes: prompt.scriptedProbes,
          history: buildHistory(),
          userResponse: text,
          turnNumber: learnerTurns + 1,
        },
        { accessToken: token },
      );
      probe = result.next_question;
      summaryOut = result.summary;
    } catch (e) {
      // Fall back to the scripted probe so the conversation continues
      // when the LLM is unreachable. Surface the error so the learner
      // can decide whether to retry; the scripted fallback keeps the
      // session usable offline.
      const message = e instanceof Error ? e.message : String(e);
      setNetworkError(
        message === "not_attending_meeting_for_paper"
          ? "RSVP to a meeting using this paper to use the AI tutor."
          : "Tutor call failed — falling back to a scripted probe.",
      );
      const probeIdx = Math.min(
        learnerTurns,
        (prompt.scriptedProbes?.length ?? 1) - 1,
      );
      probe = prompt.scriptedProbes?.[probeIdx] ?? "Say more about that.";
    } finally {
      setSending(false);
    }

    const tutorMsg: Message = {
      role: "tutor",
      body: probe ?? "Say more about that.",
      ts: Date.now() + 1,
    };
    setThread([...thread, learnerMsg, tutorMsg]);
    if (summaryOut) {
      setThread([...thread, learnerMsg, tutorMsg, {
        role: "tutor",
        body: summaryOut,
        ts: Date.now() + 2,
        kind: "synthesis",
      }]);
      setSynthesized(true);
    }
  };

  const askHint = () => {
    if (hintsLeft <= 0 || synthesized) return;
    const probes = prompt.scriptedProbes ?? [];
    const hintText =
      probes[hintsUsed] ??
      `Think about what "${prompt.topic}" hinges on — what would break if we removed it?`;
    append({
      role: "tutor",
      body: hintText,
      ts: Date.now(),
      kind: "hint",
      hintIndex: hintsUsed + 1,
    });
    setHintsUsed(hintsUsed + 1);
    setPulse(false);
    // SocraticPrompt has no sectionRef; we still surface a generic flag if topic id maps.
    // Skip recordHint when no SectionRef is available.
  };

  const wrapUp = (override = false) => {
    if (synthesized) return;
    if (!override && learnerTurns < minFloor) return;
    append({
      role: "tutor",
      body: prompt.goalInsight,
      ts: Date.now(),
      kind: "synthesis",
    });
    setSynthesized(true);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // 60s idle pulse on hint button
  useEffect(() => {
    setPulse(false);
    if (input.trim().length > 0) return;
    if (hintsLeft <= 0) return;
    if (synthesized) return;
    const t = setTimeout(() => setPulse(true), IDLE_PULSE_MS);
    return () => clearTimeout(t);
  }, [input, hintsLeft, synthesized, thread.length]);

  const reset = () => {
    setThread([]);
    setHintsUsed(0);
    setSynthesized(false);
    setInput("");
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
