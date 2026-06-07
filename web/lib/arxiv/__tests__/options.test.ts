import { describe, it, expect } from "vitest";
import { buildCategoryOptions } from "@/lib/arxiv/options";

describe("buildCategoryOptions", () => {
  it("relevant-only (default) excludes the Physics group", () => {
    const groups = buildCategoryOptions(false);
    const names = groups.map(g => g.group);
    expect(names).toContain("Computer Science");
    expect(names).not.toContain("Physics");
  });

  it("show-all includes Physics", () => {
    const groups = buildCategoryOptions(true);
    expect(groups.map(g => g.group)).toContain("Physics");
  });

  it("groups and options are sorted, options carry code + name", () => {
    const groups = buildCategoryOptions(false);
    const groupNames = groups.map(g => g.group);
    expect(groupNames).toEqual([...groupNames].sort((a, b) => a.localeCompare(b)));
    const cs = groups.find(g => g.group === "Computer Science")!;
    const codes = cs.options.map(o => o.code);
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
    expect(cs.options[0]).toHaveProperty("name");
  });
});
