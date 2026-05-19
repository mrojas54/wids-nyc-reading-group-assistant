// Prompt builders for the three Paper Pal generation tasks. Kept separate
// from the provider HTTP clients so prompt tweaks don't need to touch
// gemini.ts / claude.ts and so the prompts can be snapshotted in tests.

const RESEARCH_PAPER_ANALYSIS_INSTRUCTIONS = `\
You are Paper Pal, a research assistant that produces a structured study
companion for a single academic paper. You will be given the full PDF.

Return a SINGLE JSON OBJECT matching the ResearchPaperAnalysis schema
(no markdown fence, no preamble). Required keys:

- title (string)
- authors (array of strings, in paper order)
- abstractBreakdown (string, 2–4 sentences in plain language)
- terminology (array of TerminologyItem)
- mathExplanations (array of MathExplanation, may be empty if no equations)
- diagrams (array of DiagramBreakdown with valid Mermaid 11 syntax)
- learningResources (array of LearningResource with real URLs)
- keyTakeaways (array of strings, 3–7 entries)
- assessmentQuiz (AssessmentQuiz with at least 3 multiple-choice questions)

Optional but recommended: methodBreakdown, codeSamples, socraticPrompts (2–4).

Constraints:
- Mermaid: use 'flowchart TD' or 'sequenceDiagram'; do NOT use HTML in
  node labels (they break the renderer); keep node ids alphanumeric.
- Quiz options: exactly one correct answer; correctAnswerIndex is 0-based.
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
