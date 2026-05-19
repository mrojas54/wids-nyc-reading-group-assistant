import { describe, it, expect } from "vitest";
import { derivSlides } from "../presenter";
import type { ResearchPaperAnalysis } from "../types";

// Minimal payload that exercises every conditional branch in derivSlides.
const FULL: ResearchPaperAnalysis = {
  title: "Attention Is All You Need",
  authors: ["A. Vaswani", "N. Shazeer", "N. Parmar"],
  venue: "NeurIPS 2017",
  uploadedAt: "2026-05-01",
  abstractBreakdown:
    "We propose the Transformer. It dispenses with recurrence entirely. Attention alone is sufficient.",
  terminology: [
    { term: "Self-attention", definition: "Tokens attend to each other.", context: "Method", sectionRef: "method" },
    { term: "Positional encoding", definition: "Inject position.", context: "Method", sectionRef: "method" },
    { term: "Multi-head", definition: "Several attention heads in parallel.", context: "Method" },
    { term: "Softmax", definition: "Normalize to a distribution.", context: "Math" },
  ],
  mathExplanations: [
    {
      formula: "softmax(QK^T / sqrt(d_k)) V",
      description: "Scaled dot-product attention.",
      stepByStep: ["dot Q with K^T", "scale by sqrt(d_k)", "softmax", "multiply by V"],
      simplifiedExplanation: "Weighted lookup.",
      variables: [{ name: "Q", meaning: "query" }],
      significance: "Core operation.",
    },
    {
      formula: "PE(pos, 2i) = sin(pos / 10000^(2i/d))",
      description: "Sinusoidal positional encoding.",
      stepByStep: ["pick frequency", "evaluate sin/cos"],
      simplifiedExplanation: "Tag each position with a fingerprint.",
      variables: [{ name: "pos", meaning: "token position" }],
      significance: "Without it the model is bag-of-tokens.",
    },
    // Third should be ignored (cap is 2).
    {
      formula: "ignored",
      description: "",
      stepByStep: [],
      simplifiedExplanation: "",
      variables: [],
      significance: "",
    },
  ],
  diagrams: [
    {
      id: "arch",
      type: "flowchart",
      mermaidCode: "flowchart LR\n A --> B",
      description: "Encoder-decoder stack.",
      nodes: [],
      significance: "Two columns: encode then decode.",
    },
  ],
  learningResources: [],
  keyTakeaways: [
    "Attention scales better than recurrence.",
    "Positional encoding fills the locality gap.",
    "Heads specialize.",
    "Fourth takeaway, should be dropped (cap = 3).",
  ],
  assessmentQuiz: { title: "", difficulty: "medium", questions: [] },
  socraticPrompts: [
    {
      id: "p1",
      topic: "Attention",
      openingQuestion: "Why does scaling by sqrt(d_k) matter?",
      goalInsight: "Stability of gradient through softmax.",
      scriptedProbes: [],
    },
  ],
};

describe("derivSlides", () => {
  it("emits a complete deck for a typical payload", () => {
    const slides = derivSlides(FULL);
    const kinds = slides.map((s) => s.kind);
    expect(kinds[0]).toBe("title");
    expect(kinds.at(-1)).toBe("end");
    expect(kinds).toContain("claim");
    expect(kinds).toContain("callout");
    expect(kinds).toContain("math");
    expect(kinds).toContain("diagram");
    expect(kinds).toContain("discussion");
  });

  it("never exceeds 12 slides", () => {
    expect(derivSlides(FULL).length).toBeLessThanOrEqual(12);
  });

  it("caps math at 2 slides", () => {
    const maths = derivSlides(FULL).filter((s) => s.kind === "math");
    expect(maths.length).toBe(2);
  });

  it("falls back to a default discussion probe when no prompts or terms exist", () => {
    const bare: ResearchPaperAnalysis = {
      ...FULL,
      terminology: [],
      socraticPrompts: [],
    };
    const slides = derivSlides(bare);
    const discussion = slides.find((s) => s.kind === "discussion");
    expect(discussion).toBeDefined();
    if (discussion && discussion.kind === "discussion") {
      expect(discussion.items.length).toBeGreaterThan(0);
    }
  });

  it("skips the terminology callout when the payload has none", () => {
    const noTerms: ResearchPaperAnalysis = { ...FULL, terminology: [] };
    const slides = derivSlides(noTerms);
    const vocab = slides.find(
      (s) => s.kind === "callout" && s.eyebrow === "Vocabulary that matters",
    );
    expect(vocab).toBeUndefined();
  });

  it("skips the diagram slide when there are no diagrams", () => {
    const noDiag: ResearchPaperAnalysis = { ...FULL, diagrams: [] };
    const slides = derivSlides(noDiag);
    expect(slides.find((s) => s.kind === "diagram")).toBeUndefined();
  });

  it("respects keyTakeaways cap of 3 in the takeaways callout", () => {
    const slides = derivSlides(FULL);
    const takeaway = slides.find(
      (s) => s.kind === "callout" && s.eyebrow === "Takeaways",
    );
    expect(takeaway).toBeDefined();
    if (takeaway && takeaway.kind === "callout") {
      // Cap is 3 — the fourth takeaway in FULL should not appear.
      expect(takeaway.body).not.toContain("Fourth takeaway");
    }
  });

  it("each slide has a positive target time", () => {
    for (const s of derivSlides(FULL)) {
      expect(s.targetSeconds).toBeGreaterThan(0);
    }
  });
});
