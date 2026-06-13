import { describe, it, expect } from "vitest";
import { fnv1a, selectQuote, getQuoteOfDay, type QuoteBundle } from "../quotes";

const bundle: QuoteBundle = {
  version: 1,
  authors: ["q1", "q2", "q3", "q4", "q5"].map((id) => ({
    author: { id: `a-${id}`, name: `Name ${id}`, role: "Role" },
    quotes: [{ id, text: `T ${id}`, verified: true, sourceUrl: "https://x" }],
  })),
};

describe("fnv1a", () => {
  it("matches canonical 32-bit vectors (agrees with scripts/quotes.py)", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
    expect(fnv1a("foobar")).toBe(0xbf9cf968);
  });
});

describe("selectQuote", () => {
  it("is deterministic for a given date key", () => {
    expect(selectQuote(42, "", bundle).quote.id).toBe(selectQuote(42, "", bundle).quote.id);
  });

  it("scatters deterministically across the pool", () => {
    const chosen = new Set<string>();
    for (let k = 0; k < 200; k++) chosen.add(selectQuote(k, "", bundle).quote.id);
    expect(chosen.size).toBeGreaterThanOrEqual(2);
  });

  it("only returns verified quotes", () => {
    const mixed: QuoteBundle = {
      version: 1,
      authors: [
        { author: { id: "a1", name: "A1", role: "R" }, quotes: [{ id: "u", text: "x", verified: false }] },
        { author: { id: "a2", name: "A2", role: "R" }, quotes: [{ id: "v", text: "y", verified: true, sourceUrl: "https://x" }] },
      ],
    };
    for (let k = 0; k < 20; k++) expect(selectQuote(k, "", mixed).quote.id).toBe("v");
  });

  it("falls back when no verified quotes exist", () => {
    expect(selectQuote(3, "", { version: 1, authors: [] }).author.id).toBe("grace-hopper");
  });
});

describe("getQuoteOfDay", () => {
  it("returns a real quote from the committed bundle", () => {
    const sel = getQuoteOfDay(new Date("2026-06-13T12:00:00Z"));
    expect(sel.quote.text.length).toBeGreaterThan(0);
    expect(sel.author.name.length).toBeGreaterThan(0);
  });
});
