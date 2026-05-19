// Domain types for the PaperPal synthesis dashboard.
// Mirrors the Gemini companion payload stored in `paper_companions.payload`.
// See design_handoff/architecture.md (Data model) for the source of truth.
//
// IMPORTANT: every type below MUST stay JSON-serializable. The payload
// crosses the server -> client component boundary and is also stored as
// jsonb in Postgres; functions, classes, dates, regexps, undefined values
// inside objects, and Maps/Sets will silently break either the React
// serializer or the DB write.

export type Lens = "beginner" | "engineer" | "expert";
export type SectionRef = "abstract" | "method" | "math" | "diagram";

export interface TerminologyItem {
  term: string;
  definition: string;
  context: string;
  sectionRef?: SectionRef;
  dependsOn?: string[];
  sourceQuote?: string;
  sourcePage?: number;
}

export interface MathExplanation {
  formula: string;
  description: string;
  stepByStep: string[];
  simplifiedExplanation: string;
  variables: { name: string; meaning: string }[];
  analogy?: string;
  significance: string;
  sectionRef?: SectionRef;
}

export interface DiagramNode {
  id: string;
  label: string;
  explanation: string;
  kind?: "input" | "process" | "storage" | "output" | "critical";
  jumpTo?: { type: "term" | "math"; ref: string };
}

export interface DiagramBreakdown {
  id: string;
  type: "flowchart" | "block" | "sequence";
  mermaidCode: string;
  description: string;
  nodes: DiagramNode[];
  significance: string;
}

export interface LearningResource {
  title: string;
  url: string;
  category: "foundational" | "survey" | "tutorial" | "course";
  type: "video" | "article" | "book" | "interactive";
  description: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswerIndex: number;
  explanation: string;
  sectionRef?: SectionRef;
}

export interface AssessmentQuiz {
  title: string;
  difficulty: "easy" | "medium" | "hard";
  questions: QuizQuestion[];
}

export interface CodeSample {
  language: "python" | "typescript" | "pseudocode";
  caption: string;
  code: string;
  highlights?: number[];
}

export interface SocraticPrompt {
  id: string;
  topic: string;
  // Section this prompt drives at. When present, hints taken in the
  // Socratic surface flow into useHintFlags() and surface the same
  // "Wobbled · N" pill on the synthesis dashboard as MCQ hints.
  sectionRef?: SectionRef;
  openingQuestion: string;
  goalInsight: string;
  scriptedProbes: string[];
  hintBudgetByLens?: { beginner: number; engineer: number; expert: number };
}

export interface ResearchPaperAnalysis {
  title: string;
  authors: string[];
  venue?: string;
  pages?: number;
  uploadedAt?: string;
  abstractBreakdown: string;
  methodBreakdown?: string;
  terminology: TerminologyItem[];
  mathExplanations: MathExplanation[];
  diagrams: DiagramBreakdown[];
  codeSamples?: CodeSample[];
  learningResources: LearningResource[];
  keyTakeaways: string[];
  assessmentQuiz: AssessmentQuiz;
  socraticPrompts?: SocraticPrompt[];
}

export interface HintFlag {
  count: number;
  sources: string[];
}

export type HintFlags = Partial<Record<SectionRef, HintFlag>>;
