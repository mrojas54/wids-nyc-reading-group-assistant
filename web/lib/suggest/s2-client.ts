import { S2AuthError, S2RequestError, type S2Result } from "./types";

const S2_BASE = "https://api.semanticscholar.org/graph/v1";
const FIELDS = "paperId,title,abstract,embedding.specter_v2";

async function fetchOnce(paperId: string, apiKey: string | null): Promise<Response> {
  const url = `${S2_BASE}/paper/${encodeURIComponent(paperId)}?fields=${FIELDS}`;
  const headers: Record<string, string> = {};
  if (apiKey) headers["x-api-key"] = apiKey;
  return fetch(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
}

// 429 is excluded: an unauthenticated S2 rate-limit window is per-minute, so a
// 500ms retry usually hits the same 429 and just burns a round-trip. Fall back
// to WASM immediately on 429.
const TRANSIENT_5XX = new Set([408, 500, 502, 503, 504]);

export async function fetchPaperWithEmbedding(paperId: string, apiKey: string | null): Promise<S2Result> {
  let res: Response;
  try {
    res = await fetchOnce(paperId, apiKey);
  } catch (e) {
    await new Promise(r => setTimeout(r, 500));
    try {
      res = await fetchOnce(paperId, apiKey);
    } catch {
      return { kind: "fallback_needed", paperId, reason: "s2_transient", title: "", abstract: "" };
    }
  }

  if (res.status === 429) {
    return { kind: "fallback_needed", paperId, reason: "rate_limited", title: "", abstract: "" };
  }

  if (TRANSIENT_5XX.has(res.status)) {
    await new Promise(r => setTimeout(r, 500));
    res = await fetchOnce(paperId, apiKey);
    if (res.status === 429) {
      return { kind: "fallback_needed", paperId, reason: "rate_limited", title: "", abstract: "" };
    }
    if (TRANSIENT_5XX.has(res.status)) {
      return { kind: "fallback_needed", paperId, reason: "s2_transient", title: "", abstract: "" };
    }
  }

  if (res.status === 401 || res.status === 403) throw new S2AuthError(`s2 ${res.status}`);
  if (res.status === 400) throw new S2RequestError(`s2 400 for ${paperId}`);
  if (res.status === 404) {
    return { kind: "fallback_needed", paperId, reason: "not_in_corpus", title: "", abstract: "" };
  }
  if (!res.ok) throw new Error(`s2 unexpected ${res.status}`);

  const data = await res.json() as { paperId: string; title: string; abstract: string; embedding: { vector: number[] } | null };
  if (!data.embedding?.vector?.length) {
    return { kind: "fallback_needed", paperId: data.paperId, reason: "no_embedding", title: data.title ?? "", abstract: data.abstract ?? "" };
  }
  return {
    kind: "hit",
    paperId: data.paperId,
    vector: Float32Array.from(data.embedding.vector),
    title: data.title ?? "",
    abstract: data.abstract ?? "",
  };
}
