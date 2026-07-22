"use client";

// Section-by-section Terminology + Math tile.
// Two columns: Terminology (sage) | Math (magenta), repeated for each
// paper section (abstract / method / math / diagram). Wobble pill appears
// when useHintFlags reports any hint usage on a section.

import { useState } from "react";
import { Tile, TileHeader } from "../primitives";
import { useHintFlags } from "@/lib/paperpal/hooks";
import type {
  MathExplanation,
  SectionRef,
  TerminologyItem,
} from "@/lib/paperpal/types";

type Section = { id: SectionRef; label: string; eyebrow: string };

const SECTIONS: Section[] = [
  { id: "abstract", label: "Abstract", eyebrow: "01" },
  { id: "method", label: "Method", eyebrow: "02" },
  { id: "math", label: "Math logic", eyebrow: "03" },
  { id: "diagram", label: "Architecture", eyebrow: "04" },
];

export function SectionBreakdownTile({
  paperId,
  terminology,
  mathExplanations,
}: {
  paperId: string;
  terminology: TerminologyItem[];
  mathExplanations: MathExplanation[];
}) {
  const hintFlags = useHintFlags(paperId);
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  const [openMath, setOpenMath] = useState<Set<string>>(() => {
    const first = mathExplanations[0]?.formula;
    return first ? new Set([first]) : new Set();
  });

  const toggleMath = (id: string) => {
    setOpenMath((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const mathSectionFor = (m: MathExplanation): SectionRef =>
    m.sectionRef || "math";

  return (
    <Tile id="section-terms-math" className="pp-col-12 pp-sbtile">
      <TileHeader
        title={
          <>
            Terminology &amp; math{" "}
            <span className="pp-sbtile-sub">Section by section</span>
          </>
        }
        right={
          <div className="pp-sbtile-legend">
            <span>
              <span className="pp-sbtile-dot sage" /> {terminology.length} terms
            </span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>
              <span className="pp-sbtile-dot magenta" />{" "}
              {mathExplanations.length} equations
            </span>
          </div>
        }
      />

      <div className="pp-sbtile-colhead">
        <div className="pp-sbtile-colhead-cell">
          <span className="pp-sbtile-rule sage" />
          Terminology
        </div>
        <div className="pp-sbtile-colhead-cell">
          <span className="pp-sbtile-rule magenta" />
          Math
        </div>
      </div>

      <div className="pp-sbtile-sections">
        {SECTIONS.map((section) => {
          const sectionTerms = terminology.filter(
            (t) => t.sectionRef === section.id,
          );
          const sectionMath = mathExplanations.filter(
            (m) => mathSectionFor(m) === section.id,
          );
          if (sectionTerms.length === 0 && sectionMath.length === 0) {
            return null;
          }
          const wobble = hintFlags[section.id];

          return (
            <div className="pp-sb-section" key={section.id}>
              <div className="pp-sb-section-head">
                <span className="pp-sb-section-eyebrow">{section.eyebrow}</span>
                <h4 className="pp-sb-section-title">{section.label}</h4>
                {wobble && wobble.count > 0 && (
                  <span
                    className="pp-sb-wobble-dot"
                    title={`You used ${wobble.count} hint${
                      wobble.count === 1 ? "" : "s"
                    } on ${section.label}.`}
                  >
                    <span className="pp-sb-wobble-dot-glyph" />
                    Wobbled · {wobble.count}
                  </span>
                )}
                <span className="pp-sb-section-counts">
                  {sectionTerms.length}{" "}
                  {sectionTerms.length === 1 ? "term" : "terms"}
                  <span style={{ opacity: 0.4, margin: "0 6px" }}>·</span>
                  {sectionMath.length}{" "}
                  {sectionMath.length === 1 ? "equation" : "equations"}
                </span>
              </div>

              <div className="pp-sb-row">
                <div className="pp-sb-col">
                  {sectionTerms.length > 0 ? (
                    sectionTerms.map((t) => {
                      const isOpen = openTerm === t.term;
                      return (
                        <button
                          type="button"
                          key={t.term}
                          id={`term-${t.term.replace(/\s+/g, "-")}`}
                          className={`pp-sb-term ${isOpen ? "is-open" : ""}`}
                          onClick={() =>
                            setOpenTerm(isOpen ? null : t.term)
                          }
                        >
                          <div className="pp-sb-term-head">
                            <span className="pp-sb-term-name">{t.term}</span>
                            {t.sourcePage != null && (
                              <span
                                className="pp-sb-term-page"
                                title={`Source quote on page ${t.sourcePage}`}
                              >
                                p. {t.sourcePage}
                              </span>
                            )}
                          </div>
                          {t.dependsOn && t.dependsOn.length > 0 && (
                            <div className="pp-sb-term-deps">
                              <span className="pp-sb-term-deps-label">
                                depends on
                              </span>
                              {t.dependsOn.join(" · ")}
                            </div>
                          )}
                          <div className="pp-sb-term-def">{t.definition}</div>
                          {isOpen && t.context && (
                            <div className="pp-sb-term-ctx">
                              &ldquo;{t.context}&rdquo;
                            </div>
                          )}
                          {isOpen && t.sourceQuote && (
                            <div className="pp-sb-term-quote">
                              {t.sourcePage != null && (
                                <span className="pp-sb-term-quote-label">
                                  p. {t.sourcePage}
                                </span>
                              )}
                              {t.sourceQuote}
                            </div>
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <div className="pp-sb-empty">
                      No terms anchored in this section.
                    </div>
                  )}
                </div>

                <div className="pp-sb-col">
                  {sectionMath.length > 0 ? (
                    sectionMath.map((m) => {
                      const id = m.formula;
                      const isOpen = openMath.has(id);
                      return (
                        <div
                          className="pp-sb-math"
                          key={id}
                          id={`math-${id.replace(/[^a-z0-9]/gi, "-")}`}
                        >
                          {/* Monospace stub — KaTeX rendering is tracked in
                              issue #118 (see docs/superpowers/plans/
                              2026-05-16-paper-pal-katex-math-handoff.md). */}
                          <code className="pp-sb-math-formula">{m.formula}</code>
                          <div className="pp-sb-math-summary">
                            {m.simplifiedExplanation || m.description}
                          </div>
                          {m.variables && m.variables.length > 0 && (
                            <div className="pp-sb-math-vars">
                              {m.variables.map((v) => (
                                <span key={v.name} className="pp-sb-math-var">
                                  <span className="sym">{v.name}</span>
                                  <span style={{ opacity: 0.45 }}>—</span>
                                  <span>{v.meaning}</span>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="pp-sb-math-meta">
                            <button
                              type="button"
                              className="pp-sb-math-toggle"
                              onClick={() => toggleMath(id)}
                            >
                              {isOpen ? "− Hide derivation" : "+ Drill down"}
                            </button>
                          </div>
                          {isOpen && (
                            <>
                              <div className="pp-sb-math-derivation">
                                <ol>
                                  {m.stepByStep.map((s, si) => (
                                    <li key={si}>{s}</li>
                                  ))}
                                </ol>
                              </div>
                              {m.analogy && (
                                <div className="pp-sb-math-analogy">
                                  {m.analogy}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="pp-sb-empty">
                      <span className="pp-sb-empty-glyph">∅</span>
                      No formal equations in this section.
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}
