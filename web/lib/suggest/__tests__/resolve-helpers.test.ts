import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import {
  toS2PaperId,
  parseArxivAtom,
  fetchArxivBatch,
  ARXIV_EXPORT_API,
} from "@/lib/suggest/resolve-helpers";

// ---------------------------------------------------------------------------
// toS2PaperId
// ---------------------------------------------------------------------------

describe("toS2PaperId", () => {
  // Full arXiv URLs
  it("parses abs URL without version", () => {
    expect(toS2PaperId("https://arxiv.org/abs/2501.12345")).toBe("ARXIV:2501.12345");
  });
  it("parses abs URL with version suffix", () => {
    expect(toS2PaperId("https://arxiv.org/abs/2605.02028v1")).toBe("ARXIV:2605.02028v1");
  });
  it("parses pdf URL", () => {
    expect(toS2PaperId("https://arxiv.org/pdf/2501.12345.pdf")).toBe("ARXIV:2501.12345");
  });
  it("parses http arxiv URL (not https)", () => {
    expect(toS2PaperId("http://arxiv.org/abs/2501.12345")).toBe("ARXIV:2501.12345");
  });

  // Bare / prefixed arXiv IDs
  it("parses bare arXiv ID", () => {
    expect(toS2PaperId("2501.12345")).toBe("ARXIV:2501.12345");
  });
  it("parses bare arXiv ID with version", () => {
    expect(toS2PaperId("2605.02028v1")).toBe("ARXIV:2605.02028v1");
  });
  it("parses mixed-case arXiv: prefix", () => {
    expect(toS2PaperId("arXiv:2501.12345")).toBe("ARXIV:2501.12345");
  });
  it("parses uppercase ARXIV: prefix (canonical pass-through)", () => {
    expect(toS2PaperId("ARXIV:2501.12345")).toBe("ARXIV:2501.12345");
  });
  it("parses old-style arXiv ID", () => {
    expect(toS2PaperId("hep-ph/9901234")).toBe("ARXIV:hep-ph/9901234");
  });

  // DOIs
  it("parses bare DOI", () => {
    expect(toS2PaperId("10.3390/math13101551")).toBe("DOI:10.3390/math13101551");
  });
  it("parses doi.org URL", () => {
    expect(toS2PaperId("https://doi.org/10.3390/math13101551")).toBe("DOI:10.3390/math13101551");
  });
  it("parses doi: prefix", () => {
    expect(toS2PaperId("doi:10.3390/math13101551")).toBe("DOI:10.3390/math13101551");
  });
  it("parses canonical DOI: prefix (pass-through)", () => {
    expect(toS2PaperId("DOI:10.3390/math13101551")).toBe("DOI:10.3390/math13101551");
  });

  // Semantic Scholar URLs
  it("parses semanticscholar.org paper URL", () => {
    expect(toS2PaperId("https://www.semanticscholar.org/paper/abc123def456")).toBe("abc123def456");
  });

  // Edge cases
  it("returns null for unparseable input", () => {
    expect(toS2PaperId("not a paper")).toBeNull();
  });
  it("strips leading/trailing whitespace", () => {
    expect(toS2PaperId("  ARXIV:2501.12345  ")).toBe("ARXIV:2501.12345");
  });
});

// ---------------------------------------------------------------------------
// parseArxivAtom
// ---------------------------------------------------------------------------

const ATOM_SINGLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2605.02028v1</id>
    <title>Attention Is All You Need</title>
    <summary>We propose a new simple network
architecture, the Transformer.</summary>
  </entry>
</feed>`;

const ATOM_MULTI = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2605.02028v1</id>
    <title>Paper One</title>
    <summary>Abstract one.</summary>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2501.12345v2</id>
    <title>Paper Two</title>
    <summary>Abstract two.</summary>
  </entry>
</feed>`;

const ATOM_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
</feed>`;

describe("parseArxivAtom", () => {
  it("parses a single entry", () => {
    const result = parseArxivAtom(ATOM_SINGLE);
    expect(result.size).toBe(1);
    const entry = result.get("2605.02028v1");
    expect(entry?.title).toBe("Attention Is All You Need");
    expect(entry?.abstract).toBe("We propose a new simple network architecture, the Transformer.");
  });

  it("collapses internal whitespace in multi-line abstract", () => {
    const result = parseArxivAtom(ATOM_SINGLE);
    const entry = result.get("2605.02028v1");
    expect(entry?.abstract).not.toMatch(/\n/);
  });

  it("parses multiple entries", () => {
    const result = parseArxivAtom(ATOM_MULTI);
    expect(result.size).toBe(2);
    expect(result.get("2605.02028v1")?.title).toBe("Paper One");
    expect(result.get("2501.12345v2")?.title).toBe("Paper Two");
  });

  it("returns empty map for feed with no entries", () => {
    expect(parseArxivAtom(ATOM_EMPTY).size).toBe(0);
  });

  it("returns empty string for missing abstract", () => {
    const xml = `<feed><entry>
      <id>http://arxiv.org/abs/2501.00001v1</id>
      <title>No Abstract Paper</title>
    </entry></feed>`;
    const result = parseArxivAtom(xml);
    expect(result.get("2501.00001v1")?.abstract).toBe("");
  });
});

// ---------------------------------------------------------------------------
// fetchArxivBatch
// ---------------------------------------------------------------------------

const server = setupServer();
beforeEach(() => server.listen());
afterEach(() => { server.resetHandlers(); server.close(); });

describe("fetchArxivBatch", () => {
  it("returns empty map for empty input", async () => {
    const result = await fetchArxivBatch([]);
    expect(result.size).toBe(0);
  });

  it("returns hit keyed by original ARXIV: s2Id", async () => {
    server.use(http.get(ARXIV_EXPORT_API, () => HttpResponse.text(ATOM_SINGLE)));
    const result = await fetchArxivBatch(["ARXIV:2605.02028v1"]);
    expect(result.size).toBe(1);
    const hit = result.get("ARXIV:2605.02028v1");
    expect(hit?.paperId).toBe("ARXIV:2605.02028v1");
    expect(hit?.title).toBe("Attention Is All You Need");
  });

  it("matches versioned response ID against unversioned request ID", async () => {
    // We request unversioned; arXiv returns versioned in the Atom <id>
    server.use(http.get(ARXIV_EXPORT_API, () => HttpResponse.text(ATOM_SINGLE)));
    const result = await fetchArxivBatch(["ARXIV:2605.02028"]); // no v1
    expect(result.size).toBe(1);
    expect(result.get("ARXIV:2605.02028")?.title).toBe("Attention Is All You Need");
  });

  it("returns hits for multiple IDs in one batch call", async () => {
    server.use(http.get(ARXIV_EXPORT_API, () => HttpResponse.text(ATOM_MULTI)));
    const result = await fetchArxivBatch(["ARXIV:2605.02028v1", "ARXIV:2501.12345v2"]);
    expect(result.size).toBe(2);
    expect(result.get("ARXIV:2605.02028v1")?.title).toBe("Paper One");
    expect(result.get("ARXIV:2501.12345v2")?.title).toBe("Paper Two");
  });

  it("returns empty map when arXiv responds with no entries", async () => {
    server.use(http.get(ARXIV_EXPORT_API, () => HttpResponse.text(ATOM_EMPTY)));
    const result = await fetchArxivBatch(["ARXIV:9999.99999"]);
    expect(result.size).toBe(0);
  });

  it("returns empty map on non-200 response (degrade gracefully)", async () => {
    server.use(http.get(ARXIV_EXPORT_API, () => new HttpResponse(null, { status: 503 })));
    const result = await fetchArxivBatch(["ARXIV:2605.02028v1"]);
    expect(result.size).toBe(0);
  });

  it("returns empty map on network error (degrade gracefully)", async () => {
    server.use(http.get(ARXIV_EXPORT_API, () => HttpResponse.error()));
    const result = await fetchArxivBatch(["ARXIV:2605.02028v1"]);
    expect(result.size).toBe(0);
  });
});
