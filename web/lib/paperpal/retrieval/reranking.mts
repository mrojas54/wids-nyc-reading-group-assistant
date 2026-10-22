export type PassageHit = { id: string; page: number; text: string; start: number; end: number; score: number };
const boilerplate = new Set('what which how is are was were the a an of to in by for does mean means meaning defined define definition explain please'.split(' '));

// Cross-encoder logits. A definition is promoted only when it is already close to
// the best passage, so a passing "X refers to" mention cannot outrank the answer.
const DEFINITION_MARGIN = 3;

/** Definition intent prioritizes explicit definitions with relevant cross-encoder evidence. */
export function rankPassages(question: string, passages: PassageHit[], scores: number[], limit: number) {
  if (scores.length !== passages.length || scores.some(s => !Number.isFinite(s))) throw new Error('Invalid reranker scores');
  const definition = /\b(defin(?:e|ed|ition)|meaning|what (?:is|are))\b/i.test(question);
  const terms = (question.toLowerCase().match(/[a-z]{3,}/g) || []).filter(t => !boilerplate.has(t));
  const best = Math.max(...scores);
  return passages.map((p, i) => {
    const text = p.text.toLowerCase();
    const explicitDefinition = definition && scores[i] > 0 && scores[i] >= best - DEFINITION_MARGIN
      && /\b(definition\s+\d|defined as|refers to|is defined)\b/.test(text)
      && terms.some(term => new RegExp(`\\b${term}\\b`).test(text));
    return { ...p, score: scores[i], hybridScore: p.score, explicitDefinition, order: i };
  }).sort((a,b) => Number(b.explicitDefinition)-Number(a.explicitDefinition) || b.score-a.score || a.order-b.order)
    .slice(0,limit).map(({ order: _order, explicitDefinition: _definition, ...hit }) => hit);
}
