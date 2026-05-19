// /new — upload a paper PDF and trigger in-portal Paper Pal synthesis.
//
// Gated on can_synthesize_paper_pal(): operator/admin members, or the
// leader of the meeting that owns this paper. The actual upload + SSE
// flow lives in the NewPaperForm client component.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Brandmark } from "@/components/ui";
import { NewPaperForm } from "./NewPaperForm";

export const dynamic = "force-dynamic";

export default async function NewPaperPage({
  searchParams,
}: {
  searchParams: { paperId?: string };
}) {
  const sb = createSupabaseServerClient();
  const { data: memberId } = await sb.rpc("current_member_id");
  if (!memberId) redirect("/?next=/new");

  const paperIdRaw = searchParams.paperId;
  const paperId = paperIdRaw ? Number.parseInt(paperIdRaw, 10) : NaN;
  const paperIdValid = Number.isInteger(paperId) && paperId > 0;

  // The Edge Function enforces the real gate; this RPC is just a
  // best-effort UX check so the operator doesn't have to wait for an
  // upload to fail with 403.
  let canSynthesize = false;
  if (paperIdValid) {
    const { data: gate } = await sb.rpc("can_synthesize_paper_pal", {
      p_paper_id: paperId,
    });
    canSynthesize = (gate as { canSynthesize?: boolean } | null)?.canSynthesize === true;
  }

  return (
    <div className="min-h-screen bg-[var(--color-paper-50)] text-[var(--color-paper-800)]">
      <header
        className="border-b border-[var(--color-paper-200)] bg-white/60"
        style={{ backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      >
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <Brandmark />
          <Link
            href="/dashboard"
            className="text-sm hover:underline text-[var(--color-sage-700)]"
          >
            Back
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 space-y-6">
        <h1 className="text-2xl font-semibold">Generate Paper Pal companion</h1>

        {!paperIdValid ? (
          <p
            className="rounded-[var(--radius-lg)] border p-4"
            style={{
              background: "var(--bg-surface-sunken)",
              borderColor: "var(--border-1)",
              color: "var(--color-paper-700)",
            }}
          >
            Open this page from a paper card to choose which paper to
            synthesize. (Expects <code>?paperId=&lt;id&gt;</code>.)
          </p>
        ) : !canSynthesize ? (
          <p
            className="rounded-[var(--radius-lg)] border p-4"
            style={{
              background: "var(--bg-surface-sunken)",
              borderColor: "var(--border-1)",
              color: "var(--color-paper-700)",
            }}
          >
            Only the meeting leader (or an operator) can synthesize this paper.
          </p>
        ) : (
          <>
            <p style={{ color: "var(--color-paper-600)" }}>
              Upload the paper PDF. Synthesis runs in your browser as a
              5-stage stream and lands on the paper&apos;s companion page
              when finished.
            </p>
            <NewPaperForm paperId={paperId} />
          </>
        )}
      </main>
    </div>
  );
}
