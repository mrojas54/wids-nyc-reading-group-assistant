"use client";
import { useMemo, useState } from "react";
import { buildCategoryOptions } from "@/lib/arxiv/options";

export function CategoryBrowser() {
  const [showAll, setShowAll] = useState(false);
  const [code, setCode] = useState("");
  const groups = useMemo(() => buildCategoryOptions(showAll), [showAll]);

  return (
    <section className="mb-6 rounded border p-3">
      <h2 className="text-sm font-medium">Browse arXiv by category</h2>
      <p className="mt-1 text-xs text-gray-500">
        Pick a category to open its recent-papers listing on arXiv, then copy candidate
        IDs into the box below.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          aria-label="arXiv category"
          value={code}
          onChange={e => setCode(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="">Select a category…</option>
          {groups.map(g => (
            <optgroup key={g.group} label={g.group}>
              {g.options.map(o => (
                <option key={o.code} value={o.code}>
                  {o.code} — {o.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {code && (
          <a
            href={`https://arxiv.org/list/${code}/recent`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-emerald-700 underline"
          >
            Open {code} on arXiv ↗
          </a>
        )}
      </div>
      <label className="mt-2 flex items-center gap-1 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={showAll}
          onChange={e => setShowAll(e.target.checked)}
        />
        Show all categories (not just data-science archives)
      </label>
    </section>
  );
}
