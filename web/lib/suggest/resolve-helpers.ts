/**
 * Helpers for /api/admin/resolve-papers.
 *
 * Extracted here so they can be unit-tested without the full Next.js route
 * context (auth, Supabase, etc.).
 */

// ---------------------------------------------------------------------------
// URL → canonical S2 paper ID
// ---------------------------------------------------------------------------

// Matches: https://arxiv.org/abs/2605.02028, https://arxiv.org/abs/2605.02028v1, etc.
const ARXIV_RE = /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i;
// Matches: https://doi.org/10.xxxx/yyyy, 10.xxxx/yyyy, doi:10.xxxx/yyyy
const DOI_RE = /(?:doi\.org\/|doi:)?(10\.\d{4,9}\/[^\s/?#]+)/i;
// Matches: ARXIV:2605.02028, DOI:10.xxxx/yyyy, CorpusId:12345, etc.
const CANONICAL_RE = /^[A-Z][A-Z0-9_]*:/;
// Matches: https://semanticscholar.org/paper/<id>
const S2_URL_RE = /(?:semanticscholar\.org|s2-cache[^/]*)\/paper\/([A-Za-z0-9]+)/i;
// Bare arXiv ID: 2605.02028 or 2605.02028v1
const BARE_ARXIV_RE = /^([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)$/;
// Old-style arXiv ID: hep-ph/9901234, cs.AI/0601001
const OLD_ARXIV_RE = /^([a-z-]+(?:\.[A-Z]{2})?)\/([0-9]{7})$/;

/**
 * Convert any supported paper URL / ID string to a canonical S2 paper ID
 * (e.g. "ARXIV:2605.02028v1", "DOI:10.xxxx/yyyy").
 * Returns null when the input doesn't match any known format.
 */
export function toS2PaperId(url: string): string | null {
  const s = url.trim();
  // Already a canonical prefix (ARXIV:, DOI:, MAG:, CorpusId:, …)
  if (CANONICAL_RE.test(s)) return s;
  // Mixed-case arXiv: prefix → normalise to ARXIV:
  if (/^arxiv:/i.test(s)) return `ARXIV:${s.slice(6)}`;
  // Full arXiv URL
  const arxiv = s.match(ARXIV_RE);
  if (arxiv) return `ARXIV:${arxiv[1]}`;
  // Bare arXiv ID
  const bare = s.match(BARE_ARXIV_RE);
  if (bare) return `ARXIV:${bare[1]}`;
  // Old-style arXiv ID (e.g. hep-ph/9901234)
  const oldArxiv = s.match(OLD_ARXIV_RE);
  if (oldArxiv) return `ARXIV:${oldArxiv[1]}/${oldArxiv[2]}`;
  // Semantic Scholar paper URL
  const s2Url = s.match(S2_URL_RE);
  if (s2Url) return s2Url[1];
  // DOI URL, doi: prefix, or bare DOI
  const doi = s.match(DOI_RE);
  if (doi) return `DOI:${doi[1]}`;
  return null;
}

// ---------------------------------------------------------------------------
// arXiv export API fallback
// ---------------------------------------------------------------------------

export const ARXIV_EXPORT_API = "https://export.arxiv.org/api/query";

/**
 * Parse all <entry> blocks from an arXiv Atom XML response.
 * Returns a Map keyed by arXiv ID (with version suffix when present, e.g.
 * "2605.02028v1") → { title, abstract }.
 */
export function parseArxivAtom(
  xml: string,
): Map<string, { title: string; abstract: string }> {
  const out = new Map<string, { title: string; abstract: string }>();
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const entry = m[1];
    // <id>http://arxiv.org/abs/2605.02028v1</id>
    const idM = entry.match(/<id>[^<]*\/abs\/([^<\s]+)<\/id>/);
    const titleM = entry.match(/<title>([\s\S]*?)<\/title>/);
    const summaryM = entry.match(/<summary>([\s\S]*?)<\/summary>/);
    if (!idM || !titleM) continue;
    const arxivId = idM[1].trim();
    const title = titleM[1].trim().replace(/\s+/g, " ");
    const abstract = summaryM ? summaryM[1].trim().replace(/\s+/g, " ") : "";
    out.set(arxivId, { title, abstract });
  }
  return out;
}

/**
 * Batch-fetch title+abstract from the arXiv export API for a list of
 * "ARXIV:xxx" canonical IDs that Semantic Scholar didn't return.
 *
 * Returns a Map of s2Id → { paperId, title, abstract } for hits only.
 * Degrades gracefully on network errors or non-200 responses (returns
 * an empty map so callers can decide whether to drop the paper).
 */
export async function fetchArxivBatch(
  s2Ids: string[],
): Promise<Map<string, { paperId: string; title: string; abstract: string }>> {
  const out = new Map<string, { paperId: string; title: string; abstract: string }>();
  if (s2Ids.length === 0) return out;

  const pairs = s2Ids.map(id => ({ s2Id: id, arxivId: id.slice("ARXIV:".length) }));
  const idList = pairs.map(p => p.arxivId).join(",");
  let res: Response;
  try {
    res = await fetch(
      `${ARXIV_EXPORT_API}?id_list=${encodeURIComponent(idList)}&max_results=10`,
      { signal: AbortSignal.timeout(10_000) },
    );
  } catch {
    return out; // network error — degrade gracefully
  }
  if (!res.ok) return out;

  const xml = await res.text();
  const parsed = parseArxivAtom(xml);

  for (const { s2Id, arxivId } of pairs) {
    // arXiv may return a versioned ID even when we passed an unversioned one
    // (or vice-versa), so match by stripping the version suffix from both sides.
    const baseId = arxivId.replace(/v\d+$/, "");
    const hit =
      parsed.get(arxivId) ??
      parsed.get(baseId) ??
      Array.from(parsed.entries()).find(([k]) => k.replace(/v\d+$/, "") === baseId)?.[1];
    if (hit) {
      out.set(s2Id, { paperId: s2Id, title: hit.title, abstract: hit.abstract });
    }
  }
  return out;
}
