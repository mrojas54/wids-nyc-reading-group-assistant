// Body-validation tests — security-relevant guards (path traversal,
// paper-id ownership) get unit coverage that doesn't require a live
// Edge Function or Supabase environment.
import { describe, it, expect } from "vitest";
import { parseAnalyzePaperBody } from "../parse_body";

describe("parseAnalyzePaperBody — paper_id", () => {
  it("accepts a positive integer", () => {
    const r = parseAnalyzePaperBody({ paper_id: 42, pdf_storage_path: "42/abc.pdf" });
    expect(r).toEqual({ paperId: 42, pdfPath: "42/abc.pdf", provider: undefined });
  });

  it("rejects zero", () => {
    expect(parseAnalyzePaperBody({ paper_id: 0, pdf_storage_path: "0/a.pdf" })).toMatch(
      /positive integer/,
    );
  });

  it("rejects negatives", () => {
    expect(parseAnalyzePaperBody({ paper_id: -1, pdf_storage_path: "1/a.pdf" })).toMatch(
      /positive integer/,
    );
  });

  it("rejects non-integer numbers", () => {
    expect(parseAnalyzePaperBody({ paper_id: 1.5, pdf_storage_path: "1/a.pdf" })).toMatch(
      /positive integer/,
    );
  });

  it("rejects string paper_id (no implicit coercion)", () => {
    expect(parseAnalyzePaperBody({ paper_id: "42", pdf_storage_path: "42/a.pdf" })).toMatch(
      /positive integer/,
    );
  });

  it("rejects missing paper_id", () => {
    expect(parseAnalyzePaperBody({ pdf_storage_path: "1/a.pdf" })).toMatch(/positive integer/);
  });
});

describe("parseAnalyzePaperBody — pdf_storage_path (security guards)", () => {
  it("rejects empty path", () => {
    expect(parseAnalyzePaperBody({ paper_id: 42, pdf_storage_path: "" })).toMatch(/required/);
  });

  it("rejects path without paper-id prefix (cross-paper attack)", () => {
    // The classic case: caller knows paper 7's filename and tries to
    // synthesize it under their own paper-42 session.
    const r = parseAnalyzePaperBody({ paper_id: 42, pdf_storage_path: "7/evil.pdf" });
    expect(r).toMatch(/must start with "42\//);
  });

  it("rejects literal '..' path traversal", () => {
    const r = parseAnalyzePaperBody({ paper_id: 42, pdf_storage_path: "42/../7/x.pdf" });
    expect(r).toMatch(/may not contain '\.\.'/);
  });

  it("rejects percent-encoded path traversal (%2e%2e bypass)", () => {
    // Without the percent guard, this would slip past the .. check and
    // Supabase Storage would decode it to ../ at fetch time.
    const r = parseAnalyzePaperBody({
      paper_id: 42,
      pdf_storage_path: "42/%2e%2e/7/secret.pdf",
    });
    expect(r).toMatch(/percent-encoded/);
  });

  it("rejects any percent character even in benign positions", () => {
    // The guard is overzealous on purpose — legitimate paper paths are
    // <paper_id>/<uuid>.pdf, no percent encoding needed.
    const r = parseAnalyzePaperBody({
      paper_id: 42,
      pdf_storage_path: "42/file%20with%20spaces.pdf",
    });
    expect(r).toMatch(/percent-encoded/);
  });

  it("accepts a clean path under the right paper-id prefix", () => {
    const r = parseAnalyzePaperBody({
      paper_id: 42,
      pdf_storage_path: "42/abc-def-123.pdf",
    });
    expect(r).toEqual({ paperId: 42, pdfPath: "42/abc-def-123.pdf", provider: undefined });
  });

  it("rejects non-string pdf_storage_path", () => {
    expect(
      parseAnalyzePaperBody({ paper_id: 42, pdf_storage_path: 123 as unknown }),
    ).toMatch(/required/);
  });
});

describe("parseAnalyzePaperBody — provider passthrough", () => {
  it("forwards a valid-shaped string provider unchanged for downstream resolution", () => {
    // parseBody is intentionally permissive — resolveProvider does the
    // gemini/claude narrowing later, so unknown strings flow through.
    const r = parseAnalyzePaperBody({
      paper_id: 42,
      pdf_storage_path: "42/a.pdf",
      provider: "claude",
    });
    expect(r).toEqual({ paperId: 42, pdfPath: "42/a.pdf", provider: "claude" });
  });

  it("drops non-string provider silently", () => {
    const r = parseAnalyzePaperBody({
      paper_id: 42,
      pdf_storage_path: "42/a.pdf",
      provider: 123,
    });
    expect(r).toEqual({ paperId: 42, pdfPath: "42/a.pdf", provider: undefined });
  });
});
