"use client";

import { useRef, useState } from "react";
import { McqMode } from "@/components/paperpal/assessment/McqMode";
import { SocraticMode } from "@/components/paperpal/assessment/SocraticMode";
import type { FetchSocraticInput } from "@/lib/paperpal/socratic";
import type { AnalyzeHintResponse, AnalyzeSocraticResponse } from "@/lib/paperpal/wire";
import { prompt, quiz } from "./fixtures";

export function PreviewHarness({ run, mode, commit }: {
  run: string; mode: "quiz" | "tutor"; commit: string;
}) {
  const [hold, setHold] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [completed, setCompleted] = useState(0);
  const pending = useRef(new Map<symbol, () => void>());
  // Negative IDs cannot overlap real papers; each run gets independent storage.
  const paperId = `-230${run}`;

  async function mockHint(): Promise<AnalyzeHintResponse> {
    setCompleted(n => n + 1);
    return { hint: "Mock hint: compare the code with the execution trace.", confidence: "high", provider: "fixture", model: "in-browser" };
  }

  function mockTutor(input: FetchSocraticInput, signal?: AbortSignal): Promise<AnalyzeSocraticResponse> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error("request_cancelled")); return; }
      const id = Symbol();
      const remove = () => {
        signal?.removeEventListener("abort", cancel);
        pending.current.delete(id);
        setPendingCount(pending.current.size);
      };
      const cancel = () => { remove(); reject(new Error("request_cancelled")); };
      const finish = () => {
        remove();
        setCompleted(n => n + 1);
        resolve({ next_question: `Mock reply: ${input.userResponse}`, summary: null, provider: "fixture", model: "in-browser" });
      };
      signal?.addEventListener("abort", cancel, { once: true });
      if (hold) {
        pending.current.set(id, finish);
        setPendingCount(pending.current.size);
      } else finish();
    });
  }

  return (
    <main style={{ maxWidth: 1120, margin: "24px auto", padding: 24 }}>
      <h1>Paper Pal preview checks</h1>
      <p>Synthetic data and in-browser replies. No sign-in, AI service, or database is used.</p>
      <p>Commit: <code>{commit}</code> · Run: {run} · Paper fixture: {paperId}</p>
      <p>Open this exact URL in two tabs to share progress. Use a new numeric <code>run</code> in the URL for a fresh fixture.</p>
      <nav aria-label="Fixture views" style={{ display: "flex", gap: 20, margin: "16px 0" }}>
        {/* Full navigations work with connect-src 'none'; Next links would prefetch. */}
        <a href={`?run=${run}&mode=quiz`}>Quiz fixture</a>
        <a href={`?run=${run}&mode=tutor`}>Tutor fixture</a>
      </nav>
      <fieldset style={{ padding: 12, marginBottom: 24 }}>
        <legend>Mock controls — this tab only</legend>
        <label><input type="checkbox" checked={hold} onChange={e => setHold(e.target.checked)} /> Hold mock replies in this tab</label>{" "}
        <button disabled={!pendingCount} onClick={() => { for (const release of [...pending.current.values()]) release(); }}>
          Release {pendingCount} pending {pendingCount === 1 ? "reply" : "replies"}
        </button>
        <p role="status">Pending mock replies: {pendingCount}. Completed mock responses: {completed}.</p>
      </fieldset>
      {mode === "quiz"
        ? <McqMode paperId={paperId} quiz={quiz} lens="engineer" requestHint={mockHint} />
        : <SocraticMode paperId={paperId} prompt={prompt} lens="engineer" requestTutor={mockTutor} />}
    </main>
  );
}
