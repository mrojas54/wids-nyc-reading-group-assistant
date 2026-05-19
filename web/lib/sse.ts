// Server-Sent Events frame parser for the analyze-paper response.
//
// The analyze-paper Edge Function emits SSE over a POST connection.
// EventSource can't consume that (it's GET-only), so the /new page uses
// fetch() + response.body and feeds the chunks through this generator.
//
// Frame format (matches supabase/functions/_shared/sse.ts emitter):
//   event: <name>\n
//   data: <json or raw>\n
//   \n
//
// Chunks from reader.read() can split mid-frame, so we keep a trailing
// buffer and only yield frames once a "\n\n" boundary is reached.

export type SseFrame = { event: string; data: unknown };

export async function* readSseFrames(res: Response): AsyncGenerator<SseFrame> {
  if (!res.body) throw new Error("sse: response body missing");

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const tail = buf.trim();
        if (tail) yield parseFrame(tail);
        return;
      }

      buf += value;
      const frames = buf.split("\n\n");
      // The last element is either an unterminated tail or "" after a clean
      // boundary — both are safe to carry into the next read.
      buf = frames.pop() ?? "";
      for (const raw of frames) {
        const trimmed = raw.trim();
        if (trimmed) yield parseFrame(trimmed);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(raw: string): SseFrame {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
    // Other SSE fields (id, retry, ":" comments) are not used by
    // analyze-paper and are silently ignored.
  }

  const joined = dataLines.join("\n");
  let data: unknown = null;
  if (joined) {
    try {
      data = JSON.parse(joined);
    } catch {
      data = joined;
    }
  }
  return { event, data };
}
