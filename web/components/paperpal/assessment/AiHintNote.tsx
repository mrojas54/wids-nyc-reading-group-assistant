"use client";

import type { HintConfidence } from "@/lib/paperpal/wire";

export type AiHintState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; hint: string; confidence: HintConfidence }
  | { status: "error"; message: string };

const CONFIDENCE_COLOR: Record<HintConfidence, string> = {
  low: "var(--color-paper-400)",
  medium: "var(--color-indigo-400)",
  high: "var(--color-sage-600)",
};

export function AiHintNote({ hint }: { hint: AiHintState | undefined }) {
  if (!hint || hint.status === "idle") return null;
  return (
    <div
      className="pp-hint-note"
      role="status"
      style={{ flexDirection: "column", alignItems: "stretch" }}
    >
      {hint.status === "loading" && <span>Asking the AI for a hint…</span>}
      {hint.status === "ready" && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                background: CONFIDENCE_COLOR[hint.confidence],
                color: "white",
                textTransform: "capitalize",
              }}
            >
              {hint.confidence} confidence
            </span>
            <strong>AI hint</strong>
          </div>
          <p style={{ marginTop: 6, lineHeight: 1.55 }}>{hint.hint}</p>
        </>
      )}
      {hint.status === "error" && <span>{hint.message}</span>}
    </div>
  );
}
