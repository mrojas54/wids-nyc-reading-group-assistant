export function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`dim mismatch: ${a.length} vs ${b.length}`);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Maximum Marginal Relevance ranking.
 * Returns the indices of `candidates` in selection order.
 */
export function mmr(
  query: Float32Array,
  candidates: Float32Array[],
  lambda: number,
  k: number,
): number[] {
  if (candidates.length === 0) return [];
  const targetK = Math.min(k, candidates.length);
  const queryRel = candidates.map(c => cosineSim(query, c));
  const selected: number[] = [];
  const remaining = new Set<number>(candidates.map((_, i) => i));

  while (selected.length < targetK) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (const i of Array.from(remaining)) {
      let maxSelectedSim = 0;
      for (const s of selected) {
        const sim = cosineSim(candidates[i], candidates[s]);
        if (sim > maxSelectedSim) maxSelectedSim = sim;
      }
      const score = lambda * queryRel[i] - (1 - lambda) * maxSelectedSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    selected.push(bestIdx);
    remaining.delete(bestIdx);
  }
  return selected;
}
