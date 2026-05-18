// Zod schema mirroring web/lib/paperpal/types.ts ResearchPaperAnalysis.
// Used to validate the JSON payload returned by Gemini / Claude before we
// trust it as `paper_companions.payload`. A provider that hallucinates a
// missing required field gets rejected here, not deep inside React render.
//
// Kept deliberately permissive on optional fields (e.g. sectionRef) — the
// goal is "could this render?", not strict shape lock.
import { z } from "zod";

const sectionRef = z.enum(["abstract", "method", "math", "diagram"]).optional();

const terminologyItem = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
  context: z.string(),
  sectionRef,
  dependsOn: z.array(z.string()).optional(),
  sourceQuote: z.string().optional(),
  sourcePage: z.number().int().nonnegative().optional(),
});

const mathExplanation = z.object({
  formula: z.string(),
  description: z.string(),
  stepByStep: z.array(z.string()),
  simplifiedExplanation: z.string(),
  variables: z.array(z.object({ name: z.string(), meaning: z.string() })),
  analogy: z.string().optional(),
  significance: z.string(),
  sectionRef,
});

const diagramNode = z.object({
  id: z.string(),
  label: z.string(),
  explanation: z.string(),
  kind: z.enum(["input", "process", "storage", "output", "critical"]).optional(),
  jumpTo: z.object({ type: z.enum(["term", "math"]), ref: z.string() }).optional(),
});

const diagramBreakdown = z.object({
  id: z.string(),
  type: z.enum(["flowchart", "block", "sequence"]),
  mermaidCode: z.string().min(1),
  description: z.string(),
  nodes: z.array(diagramNode),
  significance: z.string(),
});

const learningResource = z.object({
  title: z.string(),
  url: z.string().url(),
  category: z.enum(["foundational", "survey", "tutorial", "course"]),
  type: z.enum(["video", "article", "book", "interactive"]),
  description: z.string(),
});

const quizQuestion = z.object({
  question: z.string(),
  options: z.array(z.string()).min(2),
  correctAnswerIndex: z.number().int().nonnegative(),
  explanation: z.string(),
  sectionRef,
});

const assessmentQuiz = z.object({
  title: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  questions: z.array(quizQuestion).min(1),
});

const codeSample = z.object({
  language: z.enum(["python", "typescript", "pseudocode"]),
  caption: z.string(),
  code: z.string(),
  highlights: z.array(z.number().int().nonnegative()).optional(),
});

const socraticPrompt = z.object({
  id: z.string(),
  topic: z.string(),
  openingQuestion: z.string(),
  goalInsight: z.string(),
  scriptedProbes: z.array(z.string()),
  hintBudgetByLens: z
    .object({
      beginner: z.number().int().nonnegative(),
      engineer: z.number().int().nonnegative(),
      expert: z.number().int().nonnegative(),
    })
    .optional(),
});

export const researchPaperAnalysisSchema = z.object({
  title: z.string().min(1),
  authors: z.array(z.string()),
  venue: z.string().optional(),
  pages: z.number().int().positive().optional(),
  uploadedAt: z.string().optional(),
  abstractBreakdown: z.string().min(1),
  methodBreakdown: z.string().optional(),
  terminology: z.array(terminologyItem),
  mathExplanations: z.array(mathExplanation),
  diagrams: z.array(diagramBreakdown),
  codeSamples: z.array(codeSample).optional(),
  learningResources: z.array(learningResource),
  keyTakeaways: z.array(z.string()).min(1),
  assessmentQuiz,
  socraticPrompts: z.array(socraticPrompt).optional(),
});

export type ResearchPaperAnalysisParsed = z.infer<typeof researchPaperAnalysisSchema>;
