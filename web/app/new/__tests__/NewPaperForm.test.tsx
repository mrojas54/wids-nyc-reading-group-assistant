/** @vitest-environment jsdom */
//
// NewPaperForm — operator-/leader-triggered Paper Pal synthesis.
//
// Per spec §13.2, the client uses fetch() + readSseFrames on a POST to
// /functions/v1/analyze-paper. EventSource is not used (GET-only).
// These tests cover the file-pre-flight gates, error paths the user has
// to recover from, and the happy-path navigation to /papers/<id>.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { NewPaperForm } from "../NewPaperForm";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
}));

let uploadResult: { data: unknown; error: { message: string } | null } = {
  data: { path: "ok" },
  error: null,
};
let session: { access_token: string } | null = { access_token: "tok-1" };

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    storage: {
      from: () => ({
        upload: vi.fn(async () => uploadResult),
      }),
    },
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
    },
  }),
}));

// crypto.randomUUID is deterministic so we can assert the path.
const RANDOM_UUID = "11111111-2222-3333-4444-555555555555";
beforeEach(() => {
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => RANDOM_UUID });
  routerPush.mockReset();
  uploadResult = { data: { path: "ok" }, error: null };
  session = { access_token: "tok-1" };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePdf(bytes: number, name = "paper.pdf"): File {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

function sseStream(frames: string[]): Response {
  // Emit each frame as a separate chunk so the parser sees them in order.
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= frames.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(frames[i] + "\n\n"));
      i++;
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function stage(name: string) {
  return `event: stage\ndata: ${JSON.stringify({ stage: name, elapsed_ms: 100 })}`;
}
function complete(paperId: number) {
  return `event: complete\ndata: ${JSON.stringify({ paper_id: paperId, provider: "gemini", model: "x", provider_duration_ms: 1, duration_ms: 1 })}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NewPaperForm — pre-flight", () => {
  it("rejects a PDF larger than 32MB and skips network calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewPaperForm paperId={42} />);
    const input = screen.getByLabelText(/pdf/i);
    const oversize = makePdf(32 * 1024 * 1024 + 1);
    await userEvent.upload(input, oversize);
    expect(await screen.findByRole("alert")).toHaveTextContent(/32\s*MB/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-PDF MIME type", async () => {
    render(<NewPaperForm paperId={42} />);
    const input = screen.getByLabelText(/pdf/i);
    const txt = new File(["hi"], "n.txt", { type: "text/plain" });
    await userEvent.upload(input, txt);
    expect(await screen.findByRole("alert")).toHaveTextContent(/pdf/i);
  });
});

describe("NewPaperForm — submission paths", () => {
  it("happy path: drives stages, then router.push to /papers/<id> on complete", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseStream([
        stage("parsing_pdf"),
        stage("generating_synthesis"),
        stage("drafting_assessment"),
        stage("persisting"),
        complete(42),
      ]),
    );

    render(<NewPaperForm paperId={42} />);
    await userEvent.upload(screen.getByLabelText(/pdf/i), makePdf(1024));
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/papers/42"));
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe("/functions/v1/analyze-paper");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({
      paper_id: 42,
      pdf_storage_path: `42/${RANDOM_UUID}.pdf`,
    });
  });

  it("handles 429 by surfacing retry_after_seconds and not navigating", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: "rate_limited", retry_after_seconds: 87 }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    );
    render(<NewPaperForm paperId={42} />);
    await userEvent.upload(screen.getByLabelText(/pdf/i), makePdf(1024));
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/87/);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("handles 403 with the gate message and retains the form", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<NewPaperForm paperId={42} />);
    await userEvent.upload(screen.getByLabelText(/pdf/i), makePdf(1024));
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/own or lead/i);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("redirects to login on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } }),
    );
    render(<NewPaperForm paperId={42} />);
    await userEvent.upload(screen.getByLabelText(/pdf/i), makePdf(1024));
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/?next=/new"));
  });

  it("surfaces an SSE error event and does not navigate", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseStream([
        stage("parsing_pdf"),
        `event: error\ndata: ${JSON.stringify({ message: "provider failed" })}`,
      ]),
    );
    render(<NewPaperForm paperId={42} />);
    await userEvent.upload(screen.getByLabelText(/pdf/i), makePdf(1024));
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/provider failed/i);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("maps Storage RLS denials to a friendly permission message", async () => {
    uploadResult = {
      data: null,
      error: { message: "new row violates row-level security policy" },
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewPaperForm paperId={42} />);
    await userEvent.upload(screen.getByLabelText(/pdf/i), makePdf(1024));
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/permission/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// Used to silence the unused-import warning when act() isn't needed.
void act;
