"use client";
import { useState } from "react";
import type { SuggestResponse, ResolvedPaper } from "@/lib/suggest/types";

type Status = "idle" | "pending" | "done" | "error";
type PastPicksWindow = "all" | "last6m";

export function SuggestForm() {
  const [candidatesText, setCandidatesText] = useState("");
  const [pastPicks, setPastPicks] = useState<PastPicksWindow>("all");
  const [lambda, setLambda] = useState(0.6);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<SuggestResponse | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("pending");
    setMessage("Parsing candidate URLs…");
    setResults(null);

    const urls = candidatesText
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean);
    if (urls.length === 0 || urls.length > 10) {
      setStatus("error");
      setMessage("Please enter 1–10 candidate paper IDs or URLs, one per line.");
      return;
    }

    const messageTimers = [
      window.setTimeout(() => setMessage("Embedding paper(s) locally (first run can be slow)…"), 8_000),
      window.setTimeout(() => setMessage("Still working — cold start can take up to ~55 s…"), 18_000),
    ];

    // Client budget = server `TIMEOUT_MS` (55s) + small transport buffer.
    // Must stay <= Vercel's `maxDuration` (60s) so the server still gets to
    // return its own JSON 504 before we abort.
    const ac = new AbortController();
    const hardTimeout = window.setTimeout(() => ac.abort(), 60_000);

    try {
      // Step A: resolve candidate URLs to ResolvedPaper objects
      setMessage("Resolving candidates against Semantic Scholar…");
      const resolveRes = await fetch("/api/admin/resolve-papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
        signal: ac.signal,
      });
      if (!resolveRes.ok) {
        const t = await resolveRes.text();
        throw new Error(`resolve failed (${resolveRes.status}): ${t}`);
      }
      const { resolved: candidates } = (await resolveRes.json()) as { resolved: ResolvedPaper[] };
      if (candidates.length === 0) {
        throw new Error("None of the URLs could be resolved to a paper. Check the format.");
      }

      // Step B: load past picks
      setMessage("Loading past picks…");
      const ppRes = await fetch(`/api/admin/past-picks?window=${pastPicks}`, { signal: ac.signal });
      if (!ppRes.ok) {
        const t = await ppRes.text();
        throw new Error(`past-picks failed (${ppRes.status}): ${t}`);
      }
      const { past_picks: pastPicksList } = (await ppRes.json()) as { past_picks: ResolvedPaper[] };
      if (pastPicksList.length === 0) {
        throw new Error("No past picks found in the selected window.");
      }

      // Step C: call the orchestrator
      setMessage("Querying Semantic Scholar and ranking…");
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidates, past_picks: pastPicksList, lambda }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`${res.status}: ${t}`);
      }
      const data = (await res.json()) as SuggestResponse;
      setResults(data);
      setStatus("done");
    } catch (e) {
      const err = e as Error;
      setStatus("error");
      setMessage(
        err.name === "AbortError"
          ? "Timed out after 60 s. Try again."
          : `Error: ${err.message}`,
      );
    } finally {
      messageTimers.forEach(window.clearTimeout);
      window.clearTimeout(hardTimeout);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="candidates" className="block text-sm font-medium">
            Candidate papers (Semantic Scholar IDs, arXiv URLs, or DOIs — one per line, max 10):
          </label>
          <textarea
            id="candidates"
            value={candidatesText}
            onChange={e => setCandidatesText(e.target.value)}
            rows={6}
            className="mt-1 block w-full rounded border px-2 py-1 font-mono text-sm"
            placeholder="arXiv:2501.12345"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Past picks to compare against:</label>
          <div className="mt-1 space-y-1 text-sm">
            <label>
              <input
                type="radio"
                checked={pastPicks === "all"}
                onChange={() => setPastPicks("all")}
              />{" "}
              All papers from prior cycles (default)
            </label>
            <br />
            <label>
              <input
                type="radio"
                checked={pastPicks === "last6m"}
                onChange={() => setPastPicks("last6m")}
              />{" "}
              Last 6 months only
            </label>
          </div>
        </div>
        <div>
          <label htmlFor="lambda" className="block text-sm font-medium">
            λ (relevance vs diversity): {lambda.toFixed(1)}
          </label>
          <input
            id="lambda"
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={lambda}
            onChange={e => setLambda(parseFloat(e.target.value))}
            className="mt-1 block w-full"
          />
        </div>
        <button
          type="submit"
          disabled={status === "pending"}
          className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50"
        >
          {status === "pending" ? "Working…" : "Submit"}
        </button>
      </form>

      {status === "pending" && <p className="mt-4 text-sm text-gray-600">⏳ {message}</p>}
      {status === "error" && <p className="mt-4 text-sm text-red-700">{message}</p>}
      {status === "done" && results && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">Suggested ranking</h2>
          <ol className="mt-2 list-decimal list-inside space-y-1">
            {results.ranked.map(r => (
              <li key={r.paper_id} className="text-sm">
                <span className="font-medium">{r.title || `paper #${r.paper_id}`}</span>{" "}
                <span className="text-gray-500">score {r.mmr_score.toFixed(2)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-gray-500">
            {results.diagnostics.cache_hits} cache hits ·{" "}
            {results.diagnostics.s2_fetched} fetched ·{" "}
            {results.diagnostics.fallback_used} fallback ·{" "}
            {results.diagnostics.cold_start ? " cold start" : " warm"} ·{" "}
            {results.diagnostics.total_ms} ms
          </p>
        </section>
      )}
    </>
  );
}
