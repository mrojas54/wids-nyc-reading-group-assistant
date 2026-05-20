"use client";

// "Suggest a paper you'd lead" composer for the Inbox. Picks a catalog
// paper + an optional note; proposePaper creates a placeholder meeting
// and attaches the suggestion to it.
import { useState, useTransition } from "react";
import type { CatalogPaper } from "@/lib/paperpal/inbox";
import { proposePaper } from "@/lib/paperpal/inbox-actions";

export default function ProposePaperForm({
  papers,
}: {
  papers: CatalogPaper[];
}) {
  const [paperId, setPaperId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (papers.length === 0) {
    return (
      <p className="propose-empty">
        The catalog is empty — there&apos;s nothing to propose yet.
      </p>
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!paperId || pending) return;
    setError(null);
    const id = Number(paperId);
    const text = note;
    startTransition(async () => {
      try {
        await proposePaper({ paperId: id, note: text });
        setPaperId("");
        setNote("");
        setDone(true);
      } catch {
        setError("Could not propose this paper — please retry.");
      }
    });
  }

  return (
    <form className="propose-form" onSubmit={onSubmit}>
      <div className="propose-row">
        <label className="propose-field">
          <span>Paper</span>
          <select
            value={paperId}
            onChange={(e) => {
              setPaperId(e.target.value);
              setDone(false);
            }}
            disabled={pending}
          >
            <option value="">Choose a paper…</option>
            {papers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="propose-field">
        <span>Why this one (optional)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="A line on why you'd like to lead it."
          rows={2}
          disabled={pending}
        />
      </label>
      <div className="propose-actions">
        <button
          type="submit"
          className="propose-btn"
          disabled={!paperId || pending}
        >
          {pending ? "Proposing…" : "Propose this paper"}
        </button>
        {done && <span className="propose-ok">Added to the pile.</span>}
        {error && (
          <span role="alert" className="propose-error">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
