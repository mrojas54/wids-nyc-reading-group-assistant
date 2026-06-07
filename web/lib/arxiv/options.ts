import { ARXIV_TAXONOMY, RELEVANT_CATEGORIES, type ArxivCategory } from "./taxonomy";

export interface CategoryOption {
  code: string;
  name: string;
}

export interface CategoryGroup {
  group: string;
  options: CategoryOption[];
}

/** Group categories for an <optgroup>-based <select>. Relevant-only by default. */
export function buildCategoryOptions(showAll: boolean): CategoryGroup[] {
  const source: readonly ArxivCategory[] = showAll ? ARXIV_TAXONOMY : RELEVANT_CATEGORIES;
  const byGroup = new Map<string, CategoryOption[]>();
  for (const c of source) {
    const bucket = byGroup.get(c.group) ?? [];
    bucket.push({ code: c.code, name: c.name });
    byGroup.set(c.group, bucket);
  }
  return [...byGroup.entries()]
    .map(([group, options]) => ({
      group,
      options: options.sort((a, b) => a.code.localeCompare(b.code)),
    }))
    .sort((a, b) => a.group.localeCompare(b.group));
}
