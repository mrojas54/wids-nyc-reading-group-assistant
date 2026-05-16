// Pure function: derive an 8-12 slide deck from a ResearchPaperAnalysis payload.
// Used by PresenterScreen. No side effects, no React imports.

import type { ResearchPaperAnalysis } from "./types";

export type TitleSlide = {
  kind: "title";
  title: string;
  sub: string;
  lead: string;
  targetSeconds: number;
  notes?: string;
};
export type ClaimSlide = {
  kind: "claim";
  eyebrow: string;
  title: string;
  body: string;
  targetSeconds: number;
  notes?: string;
};
export type MathSlide = {
  kind: "math";
  eyebrow: string;
  formula: string;
  cap: string;
  targetSeconds: number;
  notes?: string;
};
export type DiagramSlide = {
  kind: "diagram";
  eyebrow: string;
  title: string;
  body: string;
  mermaidCode?: string;
  targetSeconds: number;
  notes?: string;
};
export type CalloutSlide = {
  kind: "callout";
  eyebrow: string;
  title: string;
  body: string;
  targetSeconds: number;
  notes?: string;
};
export type StatsSlide = {
  kind: "stats";
  eyebrow: string;
  rows: { v: string; l: string }[];
  targetSeconds: number;
  notes?: string;
};
export type DiscussionSlide = {
  kind: "discussion";
  eyebrow: string;
  items: string[];
  targetSeconds: number;
  notes?: string;
};
export type EndSlide = {
  kind: "end";
  title: string;
  body: string;
  targetSeconds: number;
  notes?: string;
};

export type Slide =
  | TitleSlide
  | ClaimSlide
  | MathSlide
  | DiagramSlide
  | CalloutSlide
  | StatsSlide
  | DiscussionSlide
  | EndSlide;

function firstSentence(text: string | undefined, fallback = ""): string {
  if (!text) return fallback;
  const m = text.match(/^[^.!?]+[.!?]/);
  return (m ? m[0] : text).trim();
}

function trimToSentences(text: string | undefined, max = 2, fallback = ""): string {
  if (!text) return fallback;
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (!sentences) return text;
  return sentences.slice(0, max).join(" ").trim();
}

export function derivSlides(payload: ResearchPaperAnalysis): Slide[] {
  const slides: Slide[] = [];

  // 1 · Title
  slides.push({
    kind: "title",
    title: payload.title,
    sub: [payload.authors.slice(0, 3).join(", "), payload.venue]
      .filter(Boolean)
      .join(" — "),
    lead: payload.uploadedAt
      ? `Paper companion · uploaded ${payload.uploadedAt}`
      : "Paper companion",
    targetSeconds: 30,
    notes: "Welcome them in. Set the room — what this paper is, why it landed in the queue.",
  });

  // 2 · Abstract claim
  slides.push({
    kind: "claim",
    eyebrow: "The bet",
    title: firstSentence(payload.abstractBreakdown, "The core claim."),
    body: trimToSentences(payload.abstractBreakdown, 2),
    targetSeconds: 90,
    notes: "Sell the audacity of the central claim before sliding into mechanism.",
  });

  // 3 · Key terms callout (if terminology is rich)
  const keyTerms = payload.terminology.slice(0, 3);
  if (keyTerms.length > 0) {
    slides.push({
      kind: "callout",
      eyebrow: "Vocabulary that matters",
      title: keyTerms.map((t) => t.term).join(" · "),
      body: keyTerms
        .map((t) => `${t.term}: ${t.definition}`)
        .join("  "),
      targetSeconds: 75,
      notes: "Name the terms members will keep hitting. Define them once, in plain English.",
    });
  }

  // 4 · Math (one slide per top math, capped)
  const maths = payload.mathExplanations.slice(0, 2);
  for (const m of maths) {
    slides.push({
      kind: "math",
      eyebrow: m.description ? "The operation" : "Math",
      formula: m.formula,
      cap: m.simplifiedExplanation || m.significance || "",
      targetSeconds: 120,
      notes: m.stepByStep?.length
        ? `Walk it left-to-right. ${m.stepByStep.slice(0, 3).join(" → ")}`
        : m.significance,
    });
  }

  // 5 · Diagram
  const diagram = payload.diagrams[0];
  if (diagram) {
    slides.push({
      kind: "diagram",
      eyebrow: "Architecture",
      title: "What you can see on one slide",
      body: diagram.description,
      mermaidCode: diagram.mermaidCode,
      targetSeconds: 90,
      notes: diagram.significance,
    });
  }

  // 6 · Takeaways (callout)
  const takeaways = payload.keyTakeaways.slice(0, 3);
  if (takeaways.length > 0) {
    slides.push({
      kind: "callout",
      eyebrow: "Takeaways",
      title: "What to remember in six months.",
      body: takeaways.map((t, i) => `${i + 1}. ${t}`).join("  "),
      targetSeconds: 75,
      notes: "Repeat the punchlines. If they remember nothing else, these.",
    });
  }

  // 7 · Discussion
  const probes: string[] = [];
  for (const p of payload.socraticPrompts ?? []) {
    probes.push(p.openingQuestion);
    if (probes.length >= 3) break;
  }
  while (probes.length < 3) {
    const t = payload.terminology[probes.length];
    if (!t) break;
    probes.push(`How would you explain "${t.term}" to a new member?`);
  }
  if (probes.length === 0) {
    probes.push("What surprised you in this paper?");
  }
  slides.push({
    kind: "discussion",
    eyebrow: "Open questions for the room",
    items: probes,
    targetSeconds: 240,
    notes: "Open the floor. Don't answer — facilitate. Capture answers in the Q&A pads.",
  });

  // 8 · End
  slides.push({
    kind: "end",
    title: "Thank you.",
    body: "Notes + companion live in the chapter portal.",
    targetSeconds: 20,
    notes: "Wrap. Thank the room. Tease the next paper.",
  });

  return slides.slice(0, 12);
}
