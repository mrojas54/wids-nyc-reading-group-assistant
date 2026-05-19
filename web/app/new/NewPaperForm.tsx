"use client";

// NewPaperForm — client component for /new.
//
// Owns the upload → POST → SSE consumer flow that replaces the
// /wids-make-companion slash command. See spec §13.2 for the contract
// reason we use fetch() + readSseFrames instead of EventSource (POST
// bodies aren't supported by the EventSource API).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { readSseFrames } from "@/lib/sse";
import type {
  AnalyzePaperCompleteEvent,
  AnalyzePaperRateLimited,
  AnalyzePaperRequest,
  AnalyzePaperStage,
  AnalyzePaperStageEvent,
} from "@/lib/paperpal/wire";

const MAX_PDF_BYTES = 32 * 1024 * 1024;
const STAGES: readonly AnalyzePaperStage[] = [
  "parsing_pdf",
  "generating_synthesis",
  "drafting_assessment",
  "persisting",
];

type Phase = AnalyzePaperStage | "complete" | null;

export function NewPaperForm({ paperId }: { paperId: number }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(null);
  const [submitting, setSubmitting] = useState(false);

  const stepIdx =
    phase && phase !== "complete" ? STAGES.indexOf(phase) + 1 : 0;

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setFile(null);
      return;
    }
    if (f.type !== "application/pdf") {
      setError("Please choose a PDF file.");
      setFile(null);
      return;
    }
    if (f.size > MAX_PDF_BYTES) {
      setError("File is too large. Maximum is 32 MB.");
      setFile(null);
      return;
    }
    setFile(f);
  }

  function reset() {
    setSubmitting(false);
    setPhase(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || submitting) return;
    setError(null);
    setSubmitting(true);

    const sb = createSupabaseBrowserClient();
    const path = `${paperId}/${crypto.randomUUID()}.pdf`;

    const upload = await sb.storage.from("papers-pdfs").upload(path, file);
    if (upload.error) {
      reset();
      const msg = upload.error.message ?? "";
      if (/row-level security|policy|permission/i.test(msg)) {
        setError("You don't have permission to synthesize this paper.");
      } else {
        setError(`Upload failed: ${msg || "please retry."}`);
      }
      return;
    }

    const { data: sessionData } = await sb.auth.getSession();
    const session = sessionData?.session ?? null;
    if (!session) {
      reset();
      router.push("/?next=/new");
      return;
    }

    const body: AnalyzePaperRequest = {
      paper_id: paperId,
      pdf_storage_path: path,
    };

    let res: Response;
    try {
      res = await fetch("/functions/v1/analyze-paper", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      reset();
      setError(e instanceof Error ? e.message : "Network error.");
      return;
    }

    if (!res.ok) {
      reset();
      if (res.status === 401) {
        router.push("/?next=/new");
        return;
      }
      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as Partial<AnalyzePaperRateLimited>;
        const retry = data.retry_after_seconds;
        setError(
          retry != null
            ? `Rate-limited — try again in ${retry}s.`
            : "Rate-limited — please retry shortly.",
        );
        return;
      }
      if (res.status === 403) {
        setError("You can only synthesize papers you own or lead.");
        return;
      }
      setError("Synthesis failed — please retry.");
      return;
    }

    try {
      for await (const frame of readSseFrames(res)) {
        if (frame.event === "stage") {
          const data = frame.data as AnalyzePaperStageEvent;
          setPhase(data.stage);
        } else if (frame.event === "complete") {
          const data = frame.data as AnalyzePaperCompleteEvent;
          setPhase("complete");
          router.push(`/papers/${data.paper_id}`);
          return;
        } else if (frame.event === "error") {
          const data = (frame.data ?? {}) as { message?: string };
          reset();
          setError(data.message ?? "Synthesis failed.");
          return;
        }
      }
    } catch (e) {
      reset();
      setError(e instanceof Error ? e.message : "Stream failed.");
      return;
    }
    // Stream ended without `complete` — treat as failure, don't navigate.
    reset();
    setError("Synthesis ended unexpectedly. Please retry.");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <label
          htmlFor="paper-pdf"
          className="block text-sm font-medium"
          style={{ color: "var(--color-paper-700)" }}
        >
          Paper PDF (max 32 MB)
        </label>
        <input
          id="paper-pdf"
          type="file"
          accept="application/pdf"
          onChange={onFileChange}
          disabled={submitting}
          className="block w-full text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={!file || submitting}
        className="pp-btn pp-btn-primary"
      >
        {submitting
          ? `Synthesizing… (step ${Math.max(1, stepIdx)} / ${STAGES.length})`
          : "Generate companion"}
      </button>

      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border p-3 text-sm"
          style={{
            background: "var(--bg-surface-sunken)",
            borderColor: "var(--border-1)",
            color: "var(--color-magenta-700, #a13)",
          }}
        >
          {error}
        </p>
      )}
    </form>
  );
}
