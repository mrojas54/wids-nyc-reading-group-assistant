import { createHash } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  paperId: z.number().int().positive().safe(),
  pdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
  extractionVersion: z.string().min(1).max(200),
  pages: z.array(z.object({ page: z.number().int().positive(), text: z.string().max(1_000_000) })).min(1).max(1000),
});
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** Physical PDF pages and exact extracted text; UTF-16 offsets, no lossy normalization. */
export function prepareManifest(input: unknown, maxCharacters = 6000) {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 100 || maxCharacters > 6000) throw new Error('Invalid chunk size');
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid paper manifest');
  const data = parsed.data;
  const pages = [...data.pages].sort((a, b) => a.page - b.page);
  if (new Set(pages.map(p => p.page)).size !== pages.length) throw new Error('Duplicate physical page numbers');
  const sourceVersionId = sha(JSON.stringify({ ...data, pages, chunkingVersion: `page-${maxCharacters}-v1` }));
  const passages: Array<{ id: string; page: number; text: string; start: number; end: number }> = [];
  for (const { page, text } of pages) {
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + maxCharacters, text.length);
      if (end < text.length) {
        const boundary = text.lastIndexOf(' ', end - 1);
        if (boundary > start + maxCharacters / 2) end = boundary + 1;
        // Avoid splitting a UTF-16 surrogate pair in long unbroken text.
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      }
      const excerpt = text.slice(start, end);
      if (excerpt.trim()) passages.push({ id: sha(`${sourceVersionId}:${page}:${start}:${end}`), page, text: excerpt, start, end });
      start = end;
    }
  }
  if (!passages.length || passages.length > 2000) throw new Error('Paper must contain 1–2000 nonempty passages');
  return { source: { paperId: data.paperId, sourceVersionId }, passages };
}
