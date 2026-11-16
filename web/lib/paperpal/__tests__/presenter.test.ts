import { describe, expect, it } from "vitest";
import {
  clampSlideIndex,
  derivSlides,
  formatClock,
  presenterKeyAction,
  qaNoteKey,
  slideHeadline,
  slidePace,
  type Slide,
} from "../presenter";
import type { ResearchPaperAnalysis } from "../types";

const term = (t: string) => ({ term: t, definition: `${t} def`, context: "" });
const math = (formula: string) => ({
  formula,
  description: "d",
  stepByStep: ["one", "two", "three", "four"],
  simplifiedExplanation: `${formula} simply`,
  variables: [],
  significance: "sig",
});

const payload = (patch: Partial<ResearchPaperAnalysis> = {}): ResearchPaperAnalysis => ({
  title: "Attention Is All You Need",
  authors: ["Vaswani", "Shazeer", "Parmar", "Uszkoreit"],
  venue: "NeurIPS",
  uploadedAt: "2026-11-01",
  abstractBreakdown: "Attention replaces recurrence. It trains faster! Results hold? Extra.",
  terminology: [term("attention"), term("head"), term("mask"), term("token")],
  mathExplanations: [math("a=b"), math("c=d"), math("e=f")],
  diagrams: [{
    id: "d1", type: "flowchart", mermaidCode: "graph TD", description: "Encoder stack",
    nodes: [], significance: "diag sig",
  }],
  keyTakeaways: ["one", "two", "three", "four"],
  assessmentQuiz: { title: "q", difficulty: "easy", questions: [] },
  ...patch,
});

describe("derivSlides", () => {
  it("builds the full deck in order from a rich payload", () => {
    const slides = derivSlides(payload({
      socraticPrompts: [1, 2, 3, 4].map((n) => ({
        id: `s${n}`, topic: "t", openingQuestion: `Q${n}?`, goalInsight: "", scriptedProbes: [],
      })),
    }));
    expect(slides.map((s) => s.kind)).toEqual([
      "title", "claim", "callout", "math", "math", "diagram", "callout", "discussion", "end",
    ]);
    expect(slides[0]).toMatchObject({
      title: "Attention Is All You Need",
      sub: "Vaswani, Shazeer, Parmar — NeurIPS",
      lead: "Paper companion · uploaded 2026-11-01",
    });
    expect(slides[1]).toMatchObject({
      title: "Attention replaces recurrence.",
      body: "Attention replaces recurrence. It trains faster!",
    });
    expect(slides[2]).toMatchObject({ title: "attention · head · mask" });
    expect(slides[3]).toMatchObject({
      formula: "a=b", cap: "a=b simply", notes: "Walk it left-to-right. one → two → three",
    });
    expect(slides[6]).toMatchObject({ body: "1. one  2. two  3. three" });
    expect(slides[7]).toMatchObject({ items: ["Q1?", "Q2?", "Q3?"] });
  });

  it("drops optional slides a sparse payload can't fill", () => {
    const slides = derivSlides(payload({
      authors: [], venue: undefined, uploadedAt: undefined, abstractBreakdown: "",
      terminology: [], mathExplanations: [], diagrams: [], keyTakeaways: [],
    }));
    expect(slides.map((s) => s.kind)).toEqual(["title", "claim", "discussion", "end"]);
    expect(slides[0]).toMatchObject({ sub: "", lead: "Paper companion" });
    expect(slides[1]).toMatchObject({ title: "The core claim.", body: "" });
    expect(slides[2]).toMatchObject({ items: ["What surprised you in this paper?"] });
  });

  it("tops discussion questions up from the terminology", () => {
    const slides = derivSlides(payload({
      socraticPrompts: [{ id: "s", topic: "t", openingQuestion: "Why?", goalInsight: "", scriptedProbes: [] }],
    }));
    const discussion = slides.find((s) => s.kind === "discussion");
    expect(discussion).toMatchObject({
      items: [
        "Why?",
        'How would you explain "head" to a new member?',
        'How would you explain "mask" to a new member?',
      ],
    });
  });

  it("never returns more than 12 slides", () => {
    expect(derivSlides(payload()).length).toBeLessThanOrEqual(12);
  });
});

describe("presenter helpers", () => {
  it("formats seconds as MM:SS", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(90)).toBe("01:30");
    expect(formatClock(3725)).toBe("62:05");
  });

  it("clamps a slide index into the deck", () => {
    expect(clampSlideIndex(-1, 4)).toBe(0);
    expect(clampSlideIndex(2, 4)).toBe(2);
    expect(clampSlideIndex(9, 4)).toBe(3);
    expect(clampSlideIndex(3, 0)).toBe(0);
  });

  it("warns from 85% of the target and flags overtime from 100%", () => {
    expect(slidePace(76, 90)).toBe("ok");
    expect(slidePace(77, 90)).toBe("near");
    expect(slidePace(90, 90)).toBe("over");
  });

  it("maps the shortcut keys and ignores the rest", () => {
    expect(presenterKeyAction("ArrowRight")).toBe("next");
    expect(presenterKeyAction(" ")).toBe("next");
    expect(presenterKeyAction("ArrowLeft")).toBe("prev");
    expect(presenterKeyAction("F")).toBe("fullscreen");
    expect(presenterKeyAction("t")).toBe("reset");
    expect(presenterKeyAction("o")).toBe("overview");
    expect(presenterKeyAction("G")).toBe("overview");
    expect(presenterKeyAction("Escape")).toBe("escape");
    expect(presenterKeyAction("x")).toBeNull();
    expect(presenterKeyAction("Enter")).toBeNull();
  });

  it("names each slide kind in the overview", () => {
    const base = { targetSeconds: 1 };
    const cases: [Slide, string][] = [
      [{ ...base, kind: "math", eyebrow: "", formula: "E=mc^2", cap: "" }, "E=mc^2"],
      [{ ...base, kind: "stats", eyebrow: "", rows: [{ v: "3x", l: "faster" }, { v: "2", l: "GPUs" }] }, "3x faster · 2 GPUs"],
      [{ ...base, kind: "discussion", eyebrow: "", items: [] }, "Discussion"],
      [{ ...base, kind: "callout", eyebrow: "", title: "Callout", body: "" }, "Callout"],
    ];
    for (const [slide, headline] of cases) expect(slideHeadline(slide)).toBe(headline);
  });

  it("keys Q&A notes by slide and question", () => {
    expect(qaNoteKey(2, 1)).toBe("2:1");
  });
});
