// Prompt builders for the three Paper Pal generation tasks. Kept separate
// from the provider HTTP clients so prompt tweaks don't need to touch
// gemini.ts / claude.ts and so the prompts can be snapshotted in tests.

const RESEARCH_PAPER_ANALYSIS_INSTRUCTIONS = `\
You are Paper Pal, a research assistant that produces a structured study
companion for a single academic paper. You will be given the full PDF.

Return a SINGLE JSON OBJECT matching the ResearchPaperAnalysis schema
(no markdown fence, no preamble). EVERY required field below MUST be
present; do not omit fields or substitute strings for objects.

TOP-LEVEL FIELDS (all required unless marked optional):
- title: string
- authors: string[]  (in paper order)
- venue?: string
- abstractBreakdown: string  (2–4 sentences, plain language)
- methodBreakdown?: string
- terminology: TerminologyItem[]
- mathExplanations: MathExplanation[]  (may be empty if no equations)
- diagrams: DiagramBreakdown[]
- codeSamples?: CodeSample[]
- learningResources: LearningResource[]
- keyTakeaways: string[]  (3–7 entries)
- assessmentQuiz: AssessmentQuiz
- socraticPrompts?: SocraticPrompt[]  (2–4 recommended)

OBJECT SHAPES — populate ALL required fields:

TerminologyItem {
  term: string;
  definition: string;
  context: string;   // REQUIRED. One sentence showing how the term is used in this paper.
  sectionRef?: "abstract" | "method" | "math" | "diagram";
  dependsOn?: string[];
  sourceQuote?: string;
  sourcePage?: number;
}

MathExplanation {
  formula: string;                 // LaTeX or plaintext equation
  description: string;             // What the equation models
  stepByStep: string[];            // Walk through derivation/usage, 2–5 steps
  simplifiedExplanation: string;   // Plain-language version
  variables: { name: string; meaning: string }[];
  analogy?: string;
  significance: string;            // Why this equation matters for the paper
  sectionRef?: "abstract" | "method" | "math" | "diagram";
}

DiagramBreakdown {
  id: string;                            // unique id, e.g. "model-arch"
  type: "flowchart" | "block" | "sequence";  // pick ONE of these exact values
  mermaidCode: string;                   // valid Mermaid 11 syntax
  description: string;
  nodes: {
    id: string;
    label: string;
    explanation: string;
    kind?: "input" | "process" | "storage" | "output" | "critical";
    jumpTo?: { type: "term" | "math"; ref: string };
  }[];
  significance: string;
}

CodeSample {
  language: "python" | "typescript" | "pseudocode";
  caption: string;
  code: string;
  highlights?: number[];
}

LearningResource {
  title: string;
  url: string;                                              // real, accessible URL — no inventions
  category: "foundational" | "survey" | "tutorial" | "course";  // pick ONE
  type: "video" | "article" | "book" | "interactive";       // pick ONE
  description: string;
}

AssessmentQuiz {
  title: string;          // REQUIRED, e.g. "Comprehension check"
  difficulty: "easy" | "medium" | "hard";  // pick ONE
  questions: QuizQuestion[];  // at least 3
}

QuizQuestion {
  question: string;
  options: string[];           // at least 2
  correctAnswerIndex: number;  // 0-based, exactly one correct
  explanation: string;
  sectionRef?: "abstract" | "method" | "math" | "diagram";
}

SocraticPrompt {
  id: string;                  // unique id, e.g. "loss-function-intuition"
  topic: string;               // short topic label
  openingQuestion: string;     // the first question to ask
  goalInsight: string;         // the realization you want the user to reach
  scriptedProbes: string[];    // 2–4 follow-up probes
  hintBudgetByLens?: { beginner: number; engineer: number; expert: number };
}
Do NOT return socraticPrompts as an array of strings — each entry MUST be the SocraticPrompt object above.

GLOBAL CONSTRAINTS:
- Mermaid: use 'flowchart TD' or 'sequenceDiagram'; do NOT use HTML in
  node labels (they break the renderer); keep node ids alphanumeric.
- Enum fields must use EXACTLY one of the listed values, lowercase, no synonyms.
- learningResources URLs must be real, accessible pages — no inventions.

Output JSON only.`;

export function buildSynthesisPrompt(opts?: { paperTitle?: string }): string {
  const hint = opts?.paperTitle
    ? `\n\nPaper title (for disambiguation, may differ from PDF metadata): ${opts.paperTitle}`
    : "";
  return RESEARCH_PAPER_ANALYSIS_INSTRUCTIONS + hint;
}

export function buildHintPrompt(input: {
  paperTitle: string;
  questionText: string;
  questionOptions?: string[];
  userAnswer: string;
}): string {
  const opts = input.questionOptions?.length
    ? `\nOptions:\n${input.questionOptions.map((o, i) => `  ${i}. ${o}`).join("\n")}`
    : "";
  return `\
You are Paper Pal, giving a Socratic-style hint on an assessment question
about the paper "${input.paperTitle}".

Question: ${input.questionText}${opts}
User's current answer: ${input.userAnswer}

Reply with a JSON object: { "hint": string, "confidence": "low"|"medium"|"high" }

Rules:
- The hint must NOT reveal the correct answer outright.
- Point to the concept or section of the paper to revisit.
- Set "confidence" to your confidence that this hint will help the user
  reach the right answer themselves (low if the question is unfamiliar
  territory, high if the misconception is obvious from their answer).

Output JSON only.`;
}

export function buildSocraticPrompt(input: {
  paperTitle: string;
  promptTopic: string;
  openingQuestion: string;
  scriptedProbes: string[];
  history: Array<{ role: "ai" | "user"; text: string }>;
  userResponse: string;
  turnNumber: number;
}): string {
  const transcript = input.history
    .map((t) => `${t.role === "ai" ? "PaperPal" : "User"}: ${t.text}`)
    .join("\n");
  const probes = input.scriptedProbes.length
    ? `\n\nScripted probes you may draw from:\n${input.scriptedProbes.map((p) => `  - ${p}`).join("\n")}`
    : "";
  return `\
You are Paper Pal running a Socratic conversation about "${input.paperTitle}",
focused on the topic: ${input.promptTopic}.

Opening question (turn 1, AI-side): ${input.openingQuestion}${probes}

Transcript so far:
${transcript || "(none — this is turn 1)"}

User's response (turn ${input.turnNumber}): ${input.userResponse}

Reply with a JSON object: { "nextQuestion": string, "summary"?: string }

Rules:
- "nextQuestion" must build on the user's response, not restart.
- Provide "summary" ONLY if the user has demonstrated they reached the
  goal insight; the summary should be 2–3 sentences capturing what they
  worked out. Otherwise omit it.
- Never assert facts the user hasn't earned in the transcript.

Output JSON only.`;
}

export const _internal = {
  RESEARCH_PAPER_ANALYSIS_INSTRUCTIONS,
};
