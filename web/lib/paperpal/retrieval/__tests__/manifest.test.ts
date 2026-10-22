import { describe, expect, it } from 'vitest';
import { prepareManifest } from '../manifest.mts';

const input = { paperId: 41, pdfSha256: 'a'.repeat(64), extractionVersion: 'test-v1',
  pages: [{ page: 1, text: 'First page.' }, { page: 2, text: 'Second page.' }] };
describe('canonical local passage manifests', () => {
  it('binds the smaller Supabase chunking strategy to a distinct source version', () => {
    const sample = { ...input, pages: [{ page: 1, text: 'word '.repeat(600) }] };
    const shorter = prepareManifest(sample, 1000);
    expect(shorter.source).not.toEqual(prepareManifest(sample).source);
    expect(shorter.passages.every(p => p.text.length <= 1000)).toBe(true);
    expect(shorter.passages.map(p => p.text).join('')).toBe(sample.pages[0].text);
  });
  it('reuses exact IDs and source versions for unchanged text', () => {
    expect(prepareManifest(input)).toEqual(prepareManifest(structuredClone(input)));
    expect(prepareManifest(input).passages.map(p => p.page)).toEqual([1, 2]);
  });
  it('changes source version when extraction, PDF, or text changes', () => {
    const original = prepareManifest(input).source.sourceVersionId;
    for (const patch of [{ extractionVersion: 'v2' }, { pdfSha256: 'b'.repeat(64) }, { pages: [{ page: 1, text: 'Changed.' }] }]) {
      expect(prepareManifest({ ...input, ...patch }).source.sourceVersionId).not.toBe(original);
    }
  });
  it('preserves all characters and page boundaries while chunking', () => {
    const text = 'A sentence with spaces. '.repeat(600);
    const output = prepareManifest({ ...input, pages: [{ page: 1, text }] });
    expect(output.passages.length).toBeGreaterThan(1);
    expect(output.passages.map(p => p.text).join('')).toBe(text);
    for (const p of output.passages) {
      expect(p.text.length).toBeLessThanOrEqual(6000);
      expect(text.slice(p.start, p.end)).toBe(p.text);
    }
  });
  it('keeps physical page numbering when a page is empty', () => {
    expect(prepareManifest({ ...input, pages: [{ page: 1, text: '' }, { page: 2, text: 'Text.' }] }).passages[0].page).toBe(2);
  });
  it('rejects empty papers, duplicate page numbers, and invalid paper IDs', () => {
    for (const patch of [{ pages: [{ page: 1, text: ' ' }] }, { pages: [input.pages[0], input.pages[0]] }, { paperId: 0 }]) {
      expect(() => prepareManifest({ ...input, ...patch })).toThrow();
    }
  });
});
