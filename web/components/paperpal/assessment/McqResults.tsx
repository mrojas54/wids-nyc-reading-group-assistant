"use client";

import { gradeFor } from "@/lib/paperpal/mcq";

const RADIUS = 56;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function McqResults({
  score,
  total,
  onRetake,
}: {
  score: number;
  total: number;
  onRetake: () => void;
}) {
  const pct = Math.round((score / total) * 100);
  const { label, stroke } = gradeFor(pct);
  const dash = CIRCUMFERENCE * (pct / 100);

  return (
    <div style={{ textAlign: "center", paddingTop: 16 }}>
      <div className="pp-score-circle">
        <svg viewBox="0 0 140 140">
          <circle
            cx="70"
            cy="70"
            r={RADIUS}
            fill="none"
            stroke="var(--color-paper-200)"
            strokeWidth="10"
          />
          <circle
            cx="70"
            cy="70"
            r={RADIUS}
            fill="none"
            stroke={stroke}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
          />
        </svg>
        <div className="pp-num">
          {score}/{total}
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
        {label}
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
        <button className="pp-btn" onClick={onRetake}>
          Retake
        </button>
      </div>
    </div>
  );
}
