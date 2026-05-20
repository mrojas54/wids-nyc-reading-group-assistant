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
  let paperTitle: string | null = null;
  let paperAuthors: string[] | null = null;
  if (paperIdValid) {
    const [{ data: gate }, { data: paperRow, error: paperErr }] = await Promise.all([
      sb.rpc("can_synthesize_paper_pal", { p_paper_id: paperId }),
      sb.from("papers").select("title, authors").eq("id", paperId).maybeSingle(),
    ]);
    if (paperErr) {
      console.error(`[new/page] papers select failed for paperId=${paperId}:`, paperErr);
    }
    canSynthesize = (gate as { canSynthesize?: boolean } | null)?.canSynthesize === true;
    paperTitle = (paperRow as { title?: string } | null)?.title ?? null;
    paperAuthors = (paperRow as { authors?: string[] } | null)?.authors ?? null;
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
            {paperTitle && (
              <section
                className="rounded-[var(--radius-lg)] border p-4"
                style={{
                  background: "var(--color-paper-50, #fafaf7)",
                  borderColor: "var(--color-paper-200, #e5e3da)",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    color: "var(--color-sage-700)",
                    marginBottom: 6,
                  }}
                >
                  Synthesizing
                </div>
                <h2
                  className="text-lg font-semibold"
                  style={{ color: "var(--color-paper-800)", marginBottom: 4 }}
                >
                  {paperTitle}
                </h2>
                {paperAuthors && paperAuthors.length > 0 && (
                  <div style={{ color: "var(--color-paper-600)", fontSize: 14 }}>
                    {paperAuthors.slice(0, 4).join(", ")}
                    {paperAuthors.length > 4 && ` · +${paperAuthors.length - 4} more`}
                  </div>
                )}
              </section>
            )}
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
