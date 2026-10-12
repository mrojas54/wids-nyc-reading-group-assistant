import { describe, expect, it } from 'vitest';
import { lexicalQuery } from '../candidates.mts';

describe('complementary lexical candidates', () => {
  it('retrieves subject phrases without requiring question boilerplate', () => {
    expect(lexicalQuery('How is the faithfulness gap defined?')).toBe('"faithfulness gap"');
    expect(lexicalQuery('Which language model families does the paper study?')).toBe('"language model" OR "model families"');
    expect(lexicalQuery('What does verification-aware training improve?')).toBe('"verification-aware training"');
  });
  it('does not rewrite negated, empty-subject, or very long questions', () => {
    expect(lexicalQuery('Which models were not evaluated?')).toBeNull();
    expect(lexicalQuery('What is it?')).toBeNull();
    expect(lexicalQuery('term '.repeat(20))).toBeNull();
  });
  it('removes query syntax without adding paper-specific terms', () => {
    expect(lexicalQuery('Define "sparse autoencoder".')).toBe('"sparse autoencoder"');
  });
});
