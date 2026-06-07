import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ARXIV_TAXONOMY, RELEVANT_CATEGORIES } from "@/lib/arxiv/taxonomy";

// __dirname = web/lib/arxiv/__tests__ → repo root is four levels up.
const canonical = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../data/arxiv-taxonomy.json"), "utf8"),
) as { categories: Array<{ code: string }> };

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);

describe("arxiv taxonomy artifacts", () => {
  it("TS module is in sync with the canonical JSON", () => {
    const ts = [...ARXIV_TAXONOMY].sort(byCode);
    const json = [...canonical.categories].sort(byCode);
    expect(ts).toEqual(json);
  });

  it("RELEVANT_CATEGORIES is a non-empty strict subset, all flagged relevant", () => {
    expect(RELEVANT_CATEGORIES.length).toBeGreaterThan(0);
    expect(RELEVANT_CATEGORIES.length).toBeLessThan(ARXIV_TAXONOMY.length);
    expect(RELEVANT_CATEGORIES.every(c => c.relevant)).toBe(true);
  });
});
