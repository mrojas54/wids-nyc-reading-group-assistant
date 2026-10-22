// Question boilerplate, not domain vocabulary. The full question is always kept
// for embeddings, hybrid search, and cross-encoder scoring.
const boilerplate = new Set('a an the this that these those what which how who when where why is are was were be been being do does did can could would should will have has had of in on at by for to from with and or as it its their we they you your our paper study studies authors evaluate evaluated evaluation define defined definition mean means meaning explain tell list name please discuss improve'.split(' '));

export function lexicalQuery(question: string): string | null {
  // Negated questions keep the original broad retrieval path.
  if (/\b(not|never|without|except)\b|n't\b/i.test(question)) return null;
  const terms = (question.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [])
    .filter(term => !boilerplate.has(term));
  if (!terms.length || terms.length > 12) return null;
  return terms.length === 1 ? terms[0]
    : terms.slice(0,-1).map((term,i) => `"${term} ${terms[i+1]}"`).join(' OR ');
}
