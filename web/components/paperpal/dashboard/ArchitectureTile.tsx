"use client";

// Architecture tile — renders the first DiagramBreakdown via the shared
// MermaidDiagram. Below the diagram we list jump-target nodes; clicking a
// jump dispatches the prototype's `paperpal:goto-term` / `paperpal:goto-math`
// custom events so downstream code can scroll/focus the linked anchor.

import { MermaidDiagram } from "@/components/MermaidDiagram";
import { Tile, TileHeader } from "../primitives";
import type { DiagramBreakdown } from "@/lib/paperpal/types";

function jumpFromNode(jumpTo: { type: "term" | "math"; ref: string }): void {
  if (typeof window === "undefined") return;
  const eventName =
    jumpTo.type === "term" ? "paperpal:goto-term" : "paperpal:goto-math";
  window.dispatchEvent(new CustomEvent(eventName, { detail: jumpTo.ref }));

  const anchorId =
    jumpTo.type === "term"
      ? `term-${jumpTo.ref.replace(/\s+/g, "-")}`
      : `math-${jumpTo.ref.replace(/[^a-z0-9]/gi, "-")}`;
  const el = document.getElementById(anchorId);
  if (el) {
    const top = el.getBoundingClientRect().top + window.pageYOffset - 100;
    window.scrollTo({ top, behavior: "smooth" });
  }
}

export function ArchitectureTile({ diagram }: { diagram: DiagramBreakdown }) {
  const linked = diagram.nodes.filter((n) => n.jumpTo);

  return (
    <Tile id="section-diagram" className="pp-col-12">
      <TileHeader
        title="Architecture"
        count={`${diagram.nodes.length} blocks`}
      />
      <p className="pp-arch-desc">{diagram.description}</p>
      <MermaidDiagram source={diagram.mermaidCode} />
      {linked.length > 0 && (
        <div className="pp-arch-links">
          <div className="pp-arch-links-label">Jump from diagram</div>
          <div className="pp-arch-links-row">
            {linked.map((n) => (
              <button
                key={n.id}
                type="button"
                className="pp-arch-linkchip"
                onClick={() => n.jumpTo && jumpFromNode(n.jumpTo)}
                title={n.explanation}
              >
                <span className="pp-arch-linkchip-label">{n.label}</span>
                <span className="pp-arch-linkchip-glyph" aria-hidden>
                  ↗
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {diagram.significance && (
        <p className="pp-arch-sig">{diagram.significance}</p>
      )}
    </Tile>
  );
}
