"use client";

import { useEffect, useRef, useState } from "react";
import { MermaidFrame } from "@/components/ui";

// Hex literals duplicated from globals.css because mermaid renders SVG strings
// outside the CSS cascade — var(--color-...) resolves to nothing here. If
// globals.css tokens change, update these too. Spec: project/mermaid-theme.md.
export const THEME_VARIABLES = {
  background: "#ffffff",
  // Default node fill — what untiered nodes get. Sage-50 keeps an
  // accidentally-untiered diagram looking deliberate.
  primaryColor: "#eff5f1", // sage-50
  primaryBorderColor: "#467560", // sage-600
  primaryTextColor: "#152a23", // sage-900
  // textColor / nodeTextColor are Mermaid-base-theme fallbacks for any element
  // not covered by primary/secondary/tertiaryTextColor (e.g. untiered nodes,
  // subgraph labels, edge labels). Must be dark or text goes white on sage fills.
  textColor: "#3f3a2e", // paper-700 — readable on any sage or paper surface
  nodeTextColor: "#3f3a2e", // paper-700
  // secondaryColor / tertiaryColor only fire for specific Mermaid sub-graph
  // contexts. Authors use the classDef tiers below for real differentiation.
  secondaryColor: "#dde9e1", // sage-100
  secondaryBorderColor: "#355c4b", // sage-700
  secondaryTextColor: "#152a23",
  tertiaryColor: "#bcd3c4", // sage-200
  tertiaryBorderColor: "#244338", // sage-800
  tertiaryTextColor: "#152a23",
  // Lines / arrows — sage-800 for strong contrast against any tier fill.
  lineColor: "#244338",
  edgeLabelBackground: "#faf8f4", // paper-50
  arrowheadColor: "#244338",
  // Notes / clusters
  noteBkgColor: "#fdf4e4", // warning-50
  noteTextColor: "#7c4f0a",
  noteBorderColor: "#c4811a",
  clusterBkg: "#faf8f4", // paper-50
  clusterBorder: "#d3c8b1", // paper-300
  fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif",
  fontSize: "14px",
};

// NOTE: tier names must NOT collide with Mermaid's internal SVG class names.
// Mermaid wraps the whole diagram in <g class="root">, so a `classDef root`
// emits `.root span { color: ... }` which then cascades onto every label in
// the diagram. We use `accent` for the highlighted-node tier instead.
const TIER_BLOCK = `
%% --- WiDS NYC tier classDefs (auto-injected) ---
classDef tier1  fill:#eff5f1,stroke:#467560,color:#152a23,stroke-width:1.5px
classDef tier2  fill:#dde9e1,stroke:#355c4b,color:#152a23,stroke-width:1.5px
classDef tier3  fill:#bcd3c4,stroke:#244338,color:#152a23,stroke-width:1.5px
classDef ghost  fill:#ffffff,stroke:#95b9a3,color:#355c4b,stroke-width:1.25px,stroke-dasharray:3 3
classDef accent fill:#244338,stroke:#152a23,color:#ffffff,stroke-width:1.5px
`.trim();

const TIERS = ["tier1", "tier2", "tier3", "ghost", "accent"] as const;

/**
 * Append any missing WiDS tier classDefs to a Mermaid source string.
 *
 * Defense in depth: the /wids-make-companion validator should already reject
 * untagged diagrams at commit time, but hand-edited content can bypass that.
 * We only *append* missing classDefs — author-written ones win. We do NOT
 * auto-tag nodes; a flat (untagged) diagram is a visible authoring bug,
 * whereas an auto-tagged diagram is an invisible one.
 */
export function ensureTierClassDefs(source: string): string {
  const present = new Set<string>();
  const re = /^\s*classDef\s+(\w+)\b/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) present.add(match[1]);
  const missing = TIERS.filter((t) => !present.has(t));
  if (missing.length === 0) return source;

  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(
      `[MermaidDiagram] Auto-injected tier classDefs: ${missing.join(", ")}. ` +
        `Author should declare these explicitly. See project/mermaid-theme.md.`,
    );
  }

  const block = TIER_BLOCK.split("\n")
    .filter((line) => {
      const m = line.match(/^\s*classDef\s+(\w+)\b/);
      return (
        !m ||
        (missing as readonly string[]).includes(m[1]) ||
        line.startsWith("%%")
      );
    })
    .join("\n");

  return `${source.trimEnd()}\n\n${block}\n`;
}

export function MermaidDiagram({
  source,
  caption,
}: {
  source: string;
  caption?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  // mermaid.initialize mutates global state; idempotent but only run once per mount.
  useEffect(() => {
    (async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: THEME_VARIABLES.fontFamily,
        themeVariables: THEME_VARIABLES,
      });
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    (async () => {
      const mermaid = (await import("mermaid")).default;
      try {
        const id = `m-${Math.random().toString(36).slice(2)}`;
        const normalized = ensureTierClassDefs(source);
        const { svg } = await mermaid.render(id, normalized);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        if (!cancelled) setErr(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (err) {
    return (
      <MermaidFrame caption={caption}>
        <div role="alert" className="mermaid-fallback">
          Diagram failed to render — see source.
          <details>
            <summary>Source</summary>
            <pre>{source}</pre>
          </details>
        </div>
      </MermaidFrame>
    );
  }

  return (
    <MermaidFrame caption={caption}>
      <div ref={ref} className="mermaid-svg" />
    </MermaidFrame>
  );
}
