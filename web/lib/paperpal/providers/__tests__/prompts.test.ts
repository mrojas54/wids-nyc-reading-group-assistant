// Snapshot tests for the three prompt builders.
//
// Prompt wording directly affects model output quality — accidentally
// removing "Output JSON only." from buildSynthesisPrompt would break
// JSON.parse downstream and produce a runtime error in production.
// These snapshots make any wording change a deliberate reviewer
// checkpoint: when a snapshot fails, the diff IS the review.
import { describe, it, expect } from "vitest";
import { buildHintPrompt, buildSocraticPrompt, buildSynthesisPrompt } from "../prompts";

describe("buildSynthesisPrompt", () => {
  it("matches snapshot without paperTitle hint", () => {
    expect(buildSynthesisPrompt()).toMatchSnapshot();
  });

  it("appends the paper-title disambiguation block when paperTitle is set", () => {
    const p = buildSynthesisPrompt({ paperTitle: "Attention Is All You Need" });
    expect(p).toMatchSnapshot();
    expect(p).toContain("Attention Is All You Need");
    expect(p).toContain("Output JSON only.");
  });
});

describe("buildHintPrompt", () => {
  it("matches snapshot for an MCQ-style hint request", () => {
    expect(
      buildHintPrompt({
        paperTitle: "Attention Is All You Need",
        questionText: "What replaces recurrence in the Transformer?",
        questionOptions: ["Convolutions", "Self-attention", "Pooling"],
        userAnswer: "Convolutions",
      }),
    ).toMatchSnapshot();
  });

  it("omits the Options block when questionOptions is empty/absent", () => {
    const noOpts = buildHintPrompt({
      paperTitle: "T",
      questionText: "Q?",
      userAnswer: "A",
    });
    expect(noOpts).not.toContain("Options:");
    expect(noOpts).toContain("Output JSON only.");
  });
});

describe("buildSocraticPrompt", () => {
  it("labels turn-1 with '(none — this is turn 1)' when history is empty", () => {
    const p = buildSocraticPrompt({
      paperTitle: "T",
      promptTopic: "attention",
      openingQuestion: "Where does the residual go?",
      scriptedProbes: [],
      history: [],
      userResponse: "Around the attention block.",
      turnNumber: 1,
    });
    expect(p).toContain("(none — this is turn 1)");
  });

  it("serializes ai role as 'PaperPal:' and user role as 'User:' in the transcript", () => {
    const p = buildSocraticPrompt({
      paperTitle: "T",
      promptTopic: "attention",
      openingQuestion: "Where does the residual go?",
      scriptedProbes: ["What about the LayerNorm?"],
      history: [
        { role: "ai", text: "Where does the residual go?" },
        { role: "user", text: "Around the attention block." },
      ],
      userResponse: "And then LayerNorm normalizes the sum.",
      turnNumber: 3,
    });
    expect(p).toContain("PaperPal: Where does the residual go?");
    expect(p).toContain("User: Around the attention block.");
    expect(p).not.toContain("ai:");
    expect(p).toMatchSnapshot();
  });
});
