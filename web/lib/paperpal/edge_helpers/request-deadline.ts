// Leave five seconds of the client's 30-second budget for response delivery.
export const PROVIDER_REQUEST_BUDGET_MS = 25_000;

export function requestDeadline(request: Request): number {
  const raw = request.headers.get("x-paperpal-timeout-ms");
  const budget = raw === null ? PROVIDER_REQUEST_BUDGET_MS : Number(raw);
  return Date.now() + (Number.isFinite(budget)
    ? Math.max(0, Math.min(budget, PROVIDER_REQUEST_BUDGET_MS))
    : PROVIDER_REQUEST_BUDGET_MS);
}

export async function withDeadline<T>(
  deadline: number,
  parent: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const cancel = () => {
    controller.abort();
    rejectAbort(new Error("request_cancelled"));
  };
  const remaining = deadline - Date.now();
  if (parent.aborted || remaining <= 0) throw new Error("request_expired");
  const timer = setTimeout(cancel, remaining);
  parent.addEventListener("abort", cancel, { once: true });
  try {
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", cancel);
  }
}
