import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export const PAPERPAL_REQUEST_TIMEOUT_MS = 30_000;

// One deadline covers session lookup, fetch, and reading the response body.
// Racing explicitly also releases the UI when a client ignores AbortSignal.
export async function withPaperPalSession<T>(
  request: (token: string, signal: AbortSignal, timeoutMs: number) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const expiresAt = Date.now() + PAPERPAL_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  let rejectAbort!: (reason: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const cancel = () => { controller.abort(); rejectAbort(new Error("request_cancelled")); };
  const timer = setTimeout(() => {
    controller.abort(); rejectAbort(new Error("request_timeout"));
  }, PAPERPAL_REQUEST_TIMEOUT_MS);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    const run = async () => {
      const { data } = await createSupabaseBrowserClient().auth.getSession();
      if (controller.signal.aborted) throw new Error("request_cancelled");
      const token = data?.session?.access_token;
      if (!token) throw new Error("not_signed_in");
      return request(token, controller.signal, Math.max(0, expiresAt - Date.now() - 5_000));
    };
    return await Promise.race([run(), aborted]);
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", cancel);
  }
}
