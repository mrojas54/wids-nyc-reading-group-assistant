// Further reading, grouped by category. Type appears in an eyebrow pill —
// we use category/type labels rather than emoji icons per the design system.

import { Tile, TileHeader } from "../primitives";
import { externalHttpUrl } from "@/lib/safeUrl";
import type { LearningResource } from "@/lib/paperpal/types";

const CATEGORY_LABEL: Record<LearningResource["category"], string> = {
  foundational: "Foundational",
  survey: "Survey",
  tutorial: "Tutorial",
  course: "Course",
};

const CATEGORY_ORDER: LearningResource["category"][] = [
  "foundational",
  "survey",
  "tutorial",
  "course",
];

export function ResourcesTile({
  resources,
}: {
  resources: LearningResource[];
}) {
  // These URLs come from the model's synthesis, stored in paper_companions.
  // A row written before migration 037's CHECK could hold `javascript:…`, and
  // a resource that is not a web link is not further reading, so drop it
  // rather than render a dead or dangerous anchor.
  const linkable = resources.filter((r) => externalHttpUrl(r.url) !== null);

  const grouped = new Map<LearningResource["category"], LearningResource[]>();
  for (const r of linkable) {
    const list = grouped.get(r.category) ?? [];
    list.push(r);
    grouped.set(r.category, list);
  }

  return (
    <Tile id="section-resources" className="pp-col-12">
      <TileHeader title="Further reading" count={linkable.length} />
      <div className="pp-resources">
        {CATEGORY_ORDER.filter((c) => grouped.has(c)).map((cat) => (
          <div className="pp-resources-group" key={cat}>
            <div className="pp-resources-eyebrow">{CATEGORY_LABEL[cat]}</div>
            <ul className="pp-resources-list">
              {grouped.get(cat)!.map((r, i) => (
                <li key={`${r.url}-${i}`}>
                  <a
                    className="pp-resource-row"
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="pp-resource-row-main">
                      <div className="pp-resource-title">{r.title}</div>
                      <div className="pp-resource-meta">
                        <span className="pp-resource-type">{r.type}</span>
                        <span>{r.description}</span>
                      </div>
                    </div>
                    <span className="pp-resource-go" aria-hidden>
                      ↗
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Tile>
  );
}
