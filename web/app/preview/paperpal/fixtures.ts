import type { AssessmentQuiz, SocraticPrompt } from "@/lib/paperpal/types";

export const quiz: AssessmentQuiz = {
  title: "Preview fixture quiz", difficulty: "easy", questions: [
    { question: "What best explains a failed run?", options: ["A score alone", "Code and execution traces", "Only the model name", "Only the elapsed time"], correctAnswerIndex: 1, explanation: "Code and execution traces provide the missing context.", sectionRef: "method" },
    { question: "What does the proposer change?", options: ["The harness code", "The model weights", "The paper title", "The evaluation labels"], correctAnswerIndex: 0, explanation: "The proposer changes the surrounding harness code.", sectionRef: "method" },
  ],
};

export const prompt: SocraticPrompt = {
  id: "preview-storage", topic: "Diagnosing experiment failures",
  openingQuestion: "Why keep the full experiment history?",
  goalInsight: "Fixture synthesis: detailed feedback explains failures and guides the next change.",
  scriptedProbes: ["Compare the code with the execution trace.", "Consider what a single score leaves out.", "Separate observation from hypothesis."],
};
