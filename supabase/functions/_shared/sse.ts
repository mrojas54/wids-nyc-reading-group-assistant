// Server-Sent Events writer for the analyze-paper streaming response.
//
// Why a custom mini-helper instead of `EventSourcePolyfill`:
//   - The Deno runtime already ships ReadableStream + TextEncoder; that's
//     all we need to emit SSE frames.
//   - We send the response over POST (not GET), which EventSource can't
//     consume on the client. The client uses fetch() + a chunked reader
//     (see spec §13.2). So all we owe the wire is the SSE frame format:
//     `event: <name>\ndata: <json>\n\n`.
//
// Spec headers (spec §13.1):
//   Content-Type: text/event-stream
//   Cache-Control: no-cache, no-transform
//   Connection: keep-alive
//   X-Accel-Buffering: no   (disables proxy buffering on hosted Supabase)
import { corsHeaders } from "./cors.ts";

export type SseStage =
  | "parsing_pdf"
  | "generating_synthesis"
  | "drafting_assessment"
  | "persisting";

export type SseEmitter = {
  stage(name: SseStage, extra?: Record<string, unknown>): Promise<void>;
  complete(payload: Record<string, unknown>): Promise<void>;
  error(message: string, extra?: Record<string, unknown>): Promise<void>;
  close(): void;
  response: Response;
};

export function startSseResponse(origin: string | null): SseEmitter {
  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      controller = null;
    },
  });

  function frame(event: string, data: Record<string, unknown>): Uint8Array {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function write(event: string, data: Record<string, unknown>): Promise<void> {
    if (!controller) return Promise.resolve();
    try {
      controller.enqueue(frame(event, data));
    } catch (e) {
      // Most commonly: client disconnected and the stream closed under us.
      // Log at warn level (not silent) so a genuine runtime/infra failure
      // — e.g., Supabase proxy killing the stream early — is visible in
      // logs. Remaining write attempts on this emitter become no-ops; the
      // background synthesis IIFE still runs to completion.
      const reason = e instanceof Error ? e.message : String(e);
      console.warn("[sse] enqueue failed, marking emitter closed:", reason);
      controller = null;
    }
    return Promise.resolve();
  }

  return {
    stage: (name, extra) =>
      write("stage", { stage: name, elapsed_ms: Date.now() - startedAt, ...extra }),
    complete: (payload) =>
      write("complete", { ...payload, duration_ms: Date.now() - startedAt }),
    error: (message, extra) => write("error", { message, ...extra }),
    close() {
      try {
        controller?.close();
      } catch (_e) {
        // Already closed.
      }
      controller = null;
    },
    response: new Response(stream, {
      status: 200,
      headers: {
        ...corsHeaders(origin),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    }),
  };
}
