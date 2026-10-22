import { describe, expect, it } from 'vitest';
import { rankPassages } from '../reranking.mts';
const hit = (id: string, text: string) => ({ id, text, page: 1, start: 0, end: text.length, score: .01 });
describe('answer-oriented passage ranking', () => {
  it('prefers a relevant explicit definition to related conclusions and chart fragments', () => {
    const rows = [hit('conclusion','Training reduces the faithfulness gap.'), hit('definition','Definition 1. Our faithfulness criterion bounds the reconstruction difference.'), hit('chart','Faithfulness gap 100 101 102')];
    expect(rankPassages('How is the faithfulness gap defined?', rows, [4.1,1.3,-2], 2).map(x=>x.id)).toEqual(['definition','conclusion']);
  });
  it('does not promote irrelevant definitions or change ranking for non-definition questions', () => {
    const rows=[hit('answer','We evaluated five model families.'),hit('unrelated','Definition 2. A graph is a set of vertices.')];
    expect(rankPassages('Which model families were evaluated?',rows,[3,-2],1)[0].id).toBe('answer');
    expect(rankPassages('What is the faithfulness gap?',rows,[3,-2],1)[0].id).toBe('answer');
  });
  it('does not let a weak definition mention outrank a much stronger answer', () => {
    const rows = [hit('answer','The faithfulness gap is measured on held-out prompts.'), hit('aside','Faithfulness here refers to the model card.')];
    expect(rankPassages('What is the faithfulness gap?', rows, [9, 0.01], 2).map(x=>x.id)).toEqual(['answer','aside']);
  });
  it('preserves canonical excerpts and rejects malformed scorer results', () => {
    const rows=[hit('canonical','Exact\n  source text.')];
    expect(rankPassages('Why?',rows,[2],1)[0]).toMatchObject({text:rows[0].text,start:0,end:rows[0].end});
    expect(()=>rankPassages('Why?',rows,[NaN],1)).toThrow();
    expect(()=>rankPassages('Why?',rows,[],1)).toThrow();
  });
});
