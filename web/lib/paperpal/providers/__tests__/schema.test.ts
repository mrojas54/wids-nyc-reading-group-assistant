// Zod schema sanity tests — validates that the schema accepts the shape
// PaperDashboard already renders and rejects mid-flight regressions.
import { describe, it, expect } from "vitest";
import { researchPaperAnalysisSchema } from "../schema";

const minimalPayload = {
  title: "Attention Is All You Need",
  authors: ["Vaswani et al."],
  abstractBreakdown: "Transformer replaces recurrence with attention.",
  terminology: [
    {
      term: "self-attention",
      definition: "Token weighting against other tokens in the sequence.",
      context: "encoder",
    },
  ],
  mathExplanations: [],
  diagrams: [
    {
      id: "d1",
      type: "flowchart" as const,
      mermaidCode: "flowchart TD\nA --> B",
      description: "Encoder block.",
      nodes: [{ id: "A", label: "Input", explanation: "Token embeddings." }],
      significance: "Captures the residual + attention sandwich.",
    },
  ],
  learningResources: [
    {
      title: "The Annotated Transformer",
      url: "https://nlp.seas.harvard.edu/2018/04/03/attention.html",
      category: "tutorial" as const,
      type: "article" as const,
      description: "Line-by-line walkthrough.",
    },
  ],
  keyTakeaways: ["Attention scales; recurrence does not."],
  assessmentQuiz: {
    title: "Quick check",
    difficulty: "easy" as const,
    questions: [
      {
        question: "What replaces recurrence in the Transformer?",
        options: ["Convolutions", "Self-attention", "Pooling"],
        correctAnswerIndex: 1,
        explanation: "Self-attention.",
      },
    ],
  },
};

describe("researchPaperAnalysisSchema", () => {
  it("accepts a minimally-valid payload", () => {
    expect(() => researchPaperAnalysisSchema.parse(minimalPayload)).not.toThrow();
  });

  it("rejects a payload missing title", () => {
    const { title: _t, ...rest } = minimalPayload;
    expect(() => researchPaperAnalysisSchema.parse(rest)).toThrow();
  });

  it("rejects an empty keyTakeaways array", () => {
    expect(() =>
      researchPaperAnalysisSchema.parse({ ...minimalPayload, keyTakeaways: [] }),
    ).toThrow();
  });

  it("rejects an assessmentQuiz with no questions", () => {
    expect(() =>
      researchPaperAnalysisSchema.parse({
        ...minimalPayload,
        assessmentQuiz: { ...minimalPayload.assessmentQuiz, questions: [] },
      }),
    ).toThrow();
  });

  it("accepts a payload with learningResources omitted", () => {
    const { learningResources: _lr, ...rest } = minimalPayload;
    expect(() => researchPaperAnalysisSchema.parse(rest)).not.toThrow();
  });

  it("rejects a learningResources URL that is not a URL", () => {
    expect(() =>
      researchPaperAnalysisSchema.parse({
        ...minimalPayload,
        learningResources: [
          { ...minimalPayload.learningResources[0], url: "not-a-url" },
        ],
      }),
    ).toThrow();
  });

  it("rejects a quiz question with fewer than two options", () => {
    expect(() =>
      researchPaperAnalysisSchema.parse({
        ...minimalPayload,
        assessmentQuiz: {
          ...minimalPayload.assessmentQuiz,
          questions: [
            {
              ...minimalPayload.assessmentQuiz.questions[0],
              options: ["only-one"],
            },
          ],
        },
      }),
    ).toThrow();
  });
});
