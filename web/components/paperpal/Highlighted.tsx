"use client";

// Render prose with magenta-dotted terminology and indigo-dotted math variables.
// Hovering either reveals a tooltip via the shared Tooltip primitive.

import { Fragment, type ReactNode, useState } from "react";
import { Tooltip } from "./primitives";
import type { MathExplanation, TerminologyItem } from "@/lib/paperpal/types";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type MathVar = { symbol: string; meaning: string; mathId?: string };

type HoverTerm = {
  kind: "term";
  data: TerminologyItem;
  x: number;
  y: number;
};
type HoverMVar = { kind: "mvar"; data: MathVar; x: number; y: number };
type HoverState = HoverTerm | HoverMVar | null;

function renderWithTerms(
  text: string,
  terms: TerminologyItem[] | undefined,
  onHover: (t: TerminologyItem, e: React.MouseEvent) => void,
  onLeave: () => void,
): ReactNode[] {
  if (!terms || terms.length === 0) return [text];
  // Match longest first so "self-attention" wins over "attention".
  const sorted = [...terms].sort((a, b) => b.term.length - a.term.length);
  const pattern = sorted.map((t) => escapeRe(t.term)).join("|");
  if (!pattern) return [text];
  const re = new RegExp(`\\b(${pattern})\\b`, "gi");

  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    }
    const matched = m[0];
    const def =
      sorted.find((t) => t.term.toLowerCase() === matched.toLowerCase()) ??
      sorted[0];
    out.push(
      <span
        key={key++}
        className="pp-tx-term"
        onMouseEnter={(e) => onHover(def, e)}
        onMouseMove={(e) => onHover(def, e)}
        onMouseLeave={onLeave}
      >
        {matched}
      </span>,
    );
    last = m.index + matched.length;
  }
  if (last < text.length) {
    out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  }
  return out;
}

// Walks the term-tokenized output and applies math-var highlighting to plain
// string nodes. Existing <span class="pp-tx-term"> regions are left alone so
// we don't double-wrap.
function applyMathVars(
  children: ReactNode[],
  mvars: MathVar[],
  onHover: (v: MathVar, e: React.MouseEvent) => void,
  onLeave: () => void,
): ReactNode[] {
  if (!mvars || mvars.length === 0) return children;
  const pattern = mvars.map((v) => escapeRe(v.symbol)).join("|");
  if (!pattern) return children;
  const re = new RegExp(
    `(^|[^A-Za-z0-9_])(${pattern})(?=$|[^A-Za-z0-9_])`,
    "g",
  );

  let outerKey = 0;
  return children.map((node) => {
    if (typeof node !== "string") {
      // Fragment-wrapped strings come through as <Fragment>; recurse cheaply
      // by only handling raw strings — non-string nodes already encode terms.
      return node;
    }
    const parts: ReactNode[] = [];
    let last = 0;
    let innerKey = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(node)) !== null) {
      const prefix = m[1];
      const sym = m[2];
      const sIdx = m.index + prefix.length;
      if (sIdx > last) {
        parts.push(
          <Fragment key={`s${outerKey}-${innerKey++}`}>
            {node.slice(last, sIdx)}
          </Fragment>,
        );
      }
      const def = mvars.find((v) => v.symbol === sym) ?? mvars[0];
      parts.push(
        <span
          key={`m${outerKey}-${innerKey++}`}
          className="pp-tx-mvar"
          onMouseEnter={(e) => onHover(def, e)}
          onMouseMove={(e) => onHover(def, e)}
          onMouseLeave={onLeave}
        >
          {sym}
        </span>,
      );
      last = sIdx + sym.length;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    if (last < node.length) {
      parts.push(
        <Fragment key={`e${outerKey}-${innerKey++}`}>
          {node.slice(last)}
        </Fragment>,
      );
    }
    outerKey++;
    return parts.length > 0 ? <Fragment key={outerKey}>{parts}</Fragment> : node;
  });
}

export function Highlighted({
  text,
  terms,
  mathVars,
  mathHighlight = true,
}: {
  text: string;
  terms?: TerminologyItem[];
  mathVars?: MathVar[];
  mathHighlight?: boolean;
}) {
  const [hover, setHover] = useState<HoverState>(null);

  const onTermHover = (data: TerminologyItem, e: React.MouseEvent) =>
    setHover({ kind: "term", data, x: e.clientX, y: e.clientY });
  const onMVarHover = (data: MathVar, e: React.MouseEvent) =>
    setHover({ kind: "mvar", data, x: e.clientX, y: e.clientY });
  const onLeave = () => setHover(null);

  let parts = renderWithTerms(text, terms, onTermHover, onLeave);
  if (mathHighlight && mathVars && mathVars.length > 0) {
    parts = applyMathVars(parts, mathVars, onMVarHover, onLeave);
  }

  return (
    <>
      {parts}
      {hover?.kind === "term" && (
        <Tooltip x={hover.x} y={hover.y} visible>
          <div className="pp-tooltip-eyebrow">
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--color-magenta-400)",
              }}
            />
            Contextual term
          </div>
          <div className="pp-tooltip-term">{hover.data.term}</div>
          <div className="pp-tooltip-def">{hover.data.definition}</div>
          {hover.data.context && (
            <div className="pp-tooltip-ctx">&ldquo;{hover.data.context}&rdquo;</div>
          )}
          {hover.data.sourceQuote && (
            <div className="pp-tooltip-quote">
              <div className="pp-tooltip-quote-head">
                <span>From the paper</span>
                {hover.data.sourcePage != null && (
                  <span className="pp-tooltip-quote-page">
                    p. {hover.data.sourcePage}
                  </span>
                )}
              </div>
              &ldquo;{hover.data.sourceQuote}&rdquo;
            </div>
          )}
          {hover.data.sectionRef && (
            <div className="pp-tooltip-jump">
              Jump to {hover.data.sectionRef}
            </div>
          )}
        </Tooltip>
      )}
      {hover?.kind === "mvar" && (
        <Tooltip x={hover.x} y={hover.y} visible kind="mvar">
          <div className="pp-tooltip-eyebrow">
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--color-indigo-300)",
              }}
            />
            Math variable
          </div>
          <div
            className="pp-tooltip-term"
            style={{
              fontFamily: "var(--font-mono)",
              fontStyle: "italic",
            }}
          >
            {hover.data.symbol}
          </div>
          <div className="pp-tooltip-def">{hover.data.meaning}</div>
          <div className="pp-tooltip-jump">Open in Math logic</div>
        </Tooltip>
      )}
    </>
  );
}

// Helper: derive math-variable list from MathExplanation[] for the prose pass.
export function mathVarsFromExplanations(
  explanations: MathExplanation[] | undefined,
): MathVar[] {
  if (!explanations) return [];
  const seen = new Map<string, MathVar>();
  for (const m of explanations) {
    for (const v of m.variables || []) {
      if (!seen.has(v.name)) {
        seen.set(v.name, { symbol: v.name, meaning: v.meaning });
      }
    }
  }
  return Array.from(seen.values());
}
