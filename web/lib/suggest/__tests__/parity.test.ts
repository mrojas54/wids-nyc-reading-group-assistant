import { describe, it, expect } from "vitest";
import { embedBatch } from "@/lib/suggest/specter2-wasm";
import { cosineSim } from "@/lib/suggest/mmr";
import fs from "node:fs/promises";
import path from "node:path";

const RUN_PARITY = process.env.RUN_PARITY === "1";

describe.skipIf(!RUN_PARITY)("WASM SPECTER2 parity vs S2 canonical", () => {
  it("produces vectors with cos >= 0.997 against S2 for all fixture papers", async () => {
    const fixturesPath = path.resolve(__dirname, "../../../../scripts/specter2_parity_fixtures.json");
    const fixtures = JSON.parse(await fs.readFile(fixturesPath, "utf-8")) as Array<{
      paperId: string;
      title: string;
      abstract: string;
      vector: number[];
    }>;
    const localVecs = await embedBatch(fixtures.map(f => ({ title: f.title, abstract: f.abstract })));
    const sims = fixtures.map((f, i) => cosineSim(localVecs[i], Float32Array.from(f.vector)));
    const min = Math.min(...sims);
    const avg = sims.reduce((a, b) => a + b, 0) / sims.length;
    console.log(`parity: avg=${avg.toFixed(4)}, min=${min.toFixed(4)}`);
    expect(min).toBeGreaterThanOrEqual(0.997);
  }, 180_000);  // 3-minute timeout: WASM init + 20 papers' inference can take a couple minutes
});
