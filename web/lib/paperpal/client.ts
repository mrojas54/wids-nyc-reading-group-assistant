// Shared transport for the JSON-over-POST Paper Pal Edge Functions
// (analyze-hint, analyze-socratic). analyze-paper streams SSE and does
// not use this path.

// Thrown on any non-2xx response. `code` is the server-supplied `error`
// string when present, otherwise a `<endpoint>_failed_<status>` fallback.
export type PaperPalFetchError = Error & {
  status: number;
  code: string;
  detail?: unknown;
};

export async function postPaperPalJson<T>(
  path: string,
  body: Record<string, unknown>,
  accessToken: string,
): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const raw = await res.json().catch(() => null);
    const parsed =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    // `/functions/v1/analyze-hint` -> `hint_failed_<status>`.
    const endpoint = path.split("/").pop()?.replace(/^analyze-/, "") || "request";
    const code =
      parsed && typeof parsed.error === "string"
        ? (parsed.error as string)
        : `${endpoint}_failed_${res.status}`;
    const err = new Error(code) as PaperPalFetchError;
    err.status = res.status;
    err.code = code;
    if (parsed?.detail !== undefined) err.detail = parsed.detail;
    throw err;
  }

  return (await res.json()) as T;
}
