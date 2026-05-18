// Body validation for analyze-paper. Extracted from the Deno entrypoint
// so both the Edge Function (Deno) and Vitest (Node) can import it —
// security-relevant guards (path traversal, paper-id ownership) deserve
// unit coverage that doesn't require a live Supabase environment.

export type AnalyzePaperBody = {
  paper_id?: unknown;
  pdf_storage_path?: unknown;
  provider?: unknown;
};

export type ParsedAnalyzePaperBody = {
  paperId: number;
  pdfPath: string;
  provider?: string;
};

// Returns the parsed payload on success, or a short error code on failure.
// String returns are intended to flow straight into a 400 response body.
export function parseAnalyzePaperBody(
  body: AnalyzePaperBody,
): ParsedAnalyzePaperBody | string {
  const paperId = typeof body.paper_id === "number" ? body.paper_id : NaN;
  if (!Number.isInteger(paperId) || paperId <= 0) {
    return "paper_id must be a positive integer";
  }

  const pdfPath = typeof body.pdf_storage_path === "string" ? body.pdf_storage_path : "";
  if (!pdfPath) return "pdf_storage_path is required";
  // Reject any percent-encoded path before further checks. Supabase
  // Storage decodes percent sequences server-side, so `42/%2e%2e/43/...`
  // would slip past the `..` check below and let a caller with write
  // access to paper 42's folder mint a signed URL for paper 43.
  if (pdfPath.includes("%")) {
    return "pdf_storage_path may not contain percent-encoded characters";
  }
  // Path must start with `<paper_id>/` — prevents a caller from synthesizing
  // paper 42 using a PDF uploaded under paper 7's folder (spec §13.4).
  if (!pdfPath.startsWith(`${paperId}/`)) {
    return `pdf_storage_path must start with "${paperId}/"`;
  }
  if (pdfPath.includes("..")) return "pdf_storage_path may not contain '..'";

  const provider = typeof body.provider === "string" ? body.provider : undefined;
  return { paperId, pdfPath, provider };
}
