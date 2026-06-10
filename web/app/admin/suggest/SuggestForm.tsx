"use client";
import { useState } from "react";
import type { SuggestResponse, ResolvedPaper } from "@/lib/suggest/types";

type Status = "idle" | "pending" | "done" | "error";
type PastPicksWindow = "all" | "last6m";
type BackfillStatus = "idle" | "running" | "done" | "error";

export function SuggestForm() {
  const [candidatesText, setCandidatesText] = useState("");
  const [pastPicks, setPastPicks] = useState<PastPicksWindow>("all");
  const [lambda, setLambda] = useState(0.6);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<SuggestResponse | null>(null);
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus>("idle");
  const [backfillMessage, setBackfillMessage] = useState("");

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

    // Fire WASM warmup against the same Lambda function as the eventual POST,
    // intentionally NOT using ac.signal — the warmup may legitimately outlive
    // the form interaction, and aborting it would also cancel the in-flight
    // model load in the container we're about to POST to.
    void fetch("/api/suggest", { method: "GET" }).catch(() => {});

    try {
      // Steps A+B in parallel: resolve candidate URLs and load past picks.
      // They have no data dependency on each other.
      setMessage("Resolving candidates and loading past picks…");
      const [resolveRes, ppRes] = await Promise.all([
        fetch("/api/admin/resolve-papers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls }),
          signal: ac.signal,
        }),
        fetch(`/api/admin/past-picks?window=${pastPicks}`, { signal: ac.signal }),
      ]);
      if (!resolveRes.ok) {
        const t = await resolveRes.text();
        throw new Error(`resolve failed (${resolveRes.status}): ${t}`);
      }
      if (!ppRes.ok) {
        const t = await ppRes.text();
        throw new Error(`past-picks failed (${ppRes.status}): ${t}`);
      }
      const { resolved: candidates } = (await resolveRes.json()) as { resolved: ResolvedPaper[] };
      if (candidates.length === 0) {
        throw new Error("None of the URLs could be resolved to a paper. Check the format.");
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

  // Embed any papers that don't yet have a cached SPECTER2 vector. Loops
  // through batches so each call fits inside the 60s function budget.
  // Run this once after a deploy (or when adding many new papers) to keep
  // /admin/suggest cold-starts fast.
  async function onBackfill() {
    setBackfillStatus("running");
    setBackfillMessage("Starting backfill…");
    let totalEmbedded = 0;
    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        const res = await fetch("/api/admin/backfill-embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batch_size: 10 }),
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`backfill failed (${res.status}): ${t}`);
        }
        const data = (await res.json()) as { embedded: number; remaining: number; total_eligible: number };
        totalEmbedded += data.embedded;
        if (data.remaining === 0) {
          setBackfillStatus("done");
          setBackfillMessage(
            totalEmbedded === 0
              ? `Cache already warm (${data.total_eligible} eligible papers, all embedded).`
              : `Embedded ${totalEmbedded} papers. Cache is now warm.`,
          );
          return;
        }
        setBackfillMessage(`Embedded ${totalEmbedded} so far · ${data.remaining} remaining…`);
      }
      throw new Error("backfill did not converge after 50 batches");
    } catch (e) {
      setBackfillStatus("error");
      setBackfillMessage(`Backfill error: ${(e as Error).message}`);
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
            className="mt-1 block w-full rounded-sm border px-2 py-1 font-mono text-sm"
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
          className="rounded-sm bg-emerald-700 px-4 py-2 text-white disabled:opacity-50"
        >
          {status === "pending" ? "Working…" : "Submit"}
        </button>
      </form>

      {status === "pending" && <p className="mt-4 text-sm text-gray-600">⏳ {message}</p>}
      {status === "error" && <p className="mt-4 text-sm text-red-700">{message}</p>}

      <details className="mt-8 border-t pt-4 text-sm">
        <summary className="cursor-pointer text-gray-600">Cache warmup (admin)</summary>
        <p className="mt-2 text-xs text-gray-500">
          Pre-embed every paper that has an S2 ID. Run this once after a deploy or after
          adding many new papers — it makes future Suggest calls fast by hydrating the
          embedding cache instead of forcing a cold-start request to embed everything.
        </p>
        <button
          type="button"
          onClick={onBackfill}
          disabled={backfillStatus === "running"}
          className="mt-3 rounded-sm bg-slate-700 px-3 py-1.5 text-white text-sm disabled:opacity-50"
        >
          {backfillStatus === "running" ? "Embedding…" : "Warm embedding cache"}
        </button>
        {backfillStatus === "running" && <p className="mt-2 text-xs text-gray-600">⏳ {backfillMessage}</p>}
        {backfillStatus === "done" && <p className="mt-2 text-xs text-emerald-700">✓ {backfillMessage}</p>}
        {backfillStatus === "error" && <p className="mt-2 text-xs text-red-700">{backfillMessage}</p>}
      </details>

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
