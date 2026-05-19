import { describe, expect, it } from "vitest";
import { readSseFrames, type SseFrame } from "../sse";

// Build a Response whose body emits the given chunks in order. Each chunk
// is a string; the test exercises the parser's partial-frame buffering
// across `reader.read()` boundaries by splitting payloads mid-frame.
function makeResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream);
}

async function collect(res: Response): Promise<SseFrame[]> {
  const out: SseFrame[] = [];
  for await (const frame of readSseFrames(res)) out.push(frame);
  return out;
}

describe("readSseFrames", () => {
  it("parses a single well-formed frame", async () => {
    const res = makeResponse(['event: stage\ndata: {"stage":"parsing_pdf"}\n\n']);
    const frames = await collect(res);
    expect(frames).toEqual([
      { event: "stage", data: { stage: "parsing_pdf" } },
    ]);
  });

  it("parses multiple frames arriving in one chunk", async () => {
    const res = makeResponse([
      'event: stage\ndata: {"stage":"parsing_pdf"}\n\n' +
        'event: stage\ndata: {"stage":"generating_synthesis"}\n\n' +
        'event: complete\ndata: {"paper_id":42}\n\n',
    ]);
    const frames = await collect(res);
    expect(frames).toEqual([
      { event: "stage", data: { stage: "parsing_pdf" } },
      { event: "stage", data: { stage: "generating_synthesis" } },
      { event: "complete", data: { paper_id: 42 } },
    ]);
  });

  // The bug magnet. SSE chunks can split mid-frame; the parser must keep
  // the trailing-partial-frame in a buffer and join it with the next read.
  it("buffers a partial frame split mid-token across two reader.read()s", async () => {
    const res = makeResponse([
      'event: stage\ndata: {"stage":"par',
      'sing_pdf"}\n\n',
    ]);
    const frames = await collect(res);
    expect(frames).toEqual([
      { event: "stage", data: { stage: "parsing_pdf" } },
    ]);
  });

  it("handles event: lines with and without a leading space", async () => {
    const res = makeResponse([
      'event:stage\ndata: {"x":1}\n\n' + 'event: stage\ndata: {"x":2}\n\n',
    ]);
    const frames = await collect(res);
    expect(frames).toEqual([
      { event: "stage", data: { x: 1 } },
      { event: "stage", data: { x: 2 } },
    ]);
  });

  it("joins multi-line data: values with \\n", async () => {
    const res = makeResponse([
      "event: note\ndata: line one\ndata: line two\n\n",
    ]);
    const frames = await collect(res);
    expect(frames).toEqual([
      // "line one\nline two" is not valid JSON → falls through to raw string.
      { event: "note", data: "line one\nline two" },
    ]);
  });

  it("yields the raw string when data is not valid JSON (does not throw)", async () => {
    const res = makeResponse(["event: error\ndata: kaboom\n\n"]);
    const frames = await collect(res);
    expect(frames).toEqual([{ event: "error", data: "kaboom" }]);
  });

  it("defaults event name to 'message' when no event: line is present", async () => {
    const res = makeResponse(['data: {"hi":"there"}\n\n']);
    const frames = await collect(res);
    expect(frames).toEqual([{ event: "message", data: { hi: "there" } }]);
  });

  it("yields no frames for an empty body", async () => {
    const res = makeResponse([]);
    const frames = await collect(res);
    expect(frames).toEqual([]);
  });

  it("emits a trailing frame that arrives without a final blank line", async () => {
    // A producer that closes the stream without the terminating "\n\n"
    // shouldn't drop the last frame on the floor.
    const res = makeResponse(['event: complete\ndata: {"paper_id":7}']);
    const frames = await collect(res);
    expect(frames).toEqual([
      { event: "complete", data: { paper_id: 7 } },
    ]);
  });

  it("throws if the Response has no body", async () => {
    const res = new Response(null);
    await expect(collect(res)).rejects.toThrow(/sse: response body missing/);
  });
});
