"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Owner/leader-only card shown on /papers/<id> when the paper is in the
 * catalog but no Paper Pal JSON has been generated yet. Spec:
 * docs/superpowers/specs/2026-05-17-paper-pal-design.md §4.2.
 *
 * Offers two paths: in-portal synthesis at /new?paperId=<id> (PDF upload
 * + 5-stage SSE), and the legacy slash-command trigger as a fallback.
 */
export function PaperPalSynthesizePrompt({
  paperId,
  paperTitle,
  reason,
}: {
  paperId: number;
  paperTitle: string;
  reason: "owner" | "leader";
}) {
  const [copied, setCopied] = useState(false);
  const command = `/wids-make-companion ${paperId}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const role = reason === "owner" ? "the chapter operator" : "this paper's leader";
  const portalHref = `/new?paperId=${paperId}`;

  return (
    <section
      className="card"
      style={{
        padding: 24,
        borderRadius: "var(--radius-xl, 16px)",
        background: "var(--color-paper-50, #fafaf7)",
        border: "1px solid var(--color-paper-200, #e5e3da)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "var(--color-sage-700)",
          marginBottom: 8,
        }}
      >
        Paper Pal · not synthesized yet
      </div>

      <h1
        className="text-xl font-semibold"
        style={{ color: "var(--color-paper-800)", marginBottom: 8 }}
      >
        {paperTitle}
      </h1>

      <p
        style={{
          color: "var(--color-paper-700)",
          marginBottom: 16,
          lineHeight: 1.55,
        }}
      >
        You&rsquo;re seeing this because you&rsquo;re {role}. Synthesize the
        paper directly in the portal, or run the command below in Claude Code
        as a fallback.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <Link
          href={portalHref}
          className="btn btn-primary"
          style={{ minWidth: 180, textAlign: "center" }}
        >
          Synthesize in portal
        </Link>
        <span style={{ fontSize: 12, color: "var(--color-paper-600)" }}>
          Upload the PDF — runs as a 5-stage stream.
        </span>
      </div>

      <pre
        style={{
          background: "var(--color-paper-100, #f4f2eb)",
          padding: "12px 14px",
          borderRadius: 8,
          fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
          fontSize: 13,
          color: "var(--color-paper-800)",
          overflowX: "auto",
          marginBottom: 12,
        }}
      >
        {command}
      </pre>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          onClick={copy}
          className="btn btn-primary"
          style={{ minWidth: 140 }}
        >
          {copied ? "Copied" : "Copy command"}
        </button>
        <span
          style={{
            fontSize: 12,
            color: "var(--color-paper-600)",
          }}
        >
          Fallback: run from Claude Code if the portal upload fails.
        </span>
      </div>
    </section>
  );
}
