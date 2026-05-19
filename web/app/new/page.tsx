// /new — operator-only Paper Pal onboarding (placeholder).
// Full Gemini analyze-paper Edge Function + PDF extraction lands in a
// follow-up; for now this page gates on operator role and tells the
// operator what to do.
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Brandmark } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewPaperPage({
  searchParams,
}: {
  searchParams: { paperId?: string };
}) {
  const sb = createSupabaseServerClient();
  const { data: memberId } = await sb.rpc("current_member_id");
  if (!memberId) redirect("/");

  const { data: member } = await sb
    .from("members")
    .select("role, name")
    .eq("id", memberId)
    .maybeSingle();

  // /new is operator+admin (no per-paper context to evaluate leadership).
  // The /papers/[id] CTA route uses canSynthesizePaperPal which also
  // includes leader-of-paper; the RLS policy in migration 015 matches.
  const canGenerate = member?.role === "operator" || member?.role === "admin";

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
        {!canGenerate ? (
          <p
            className="rounded-[var(--radius-lg)] border p-4"
            style={{
              background: "var(--bg-surface-sunken)",
              borderColor: "var(--border-1)",
              color: "var(--color-paper-700)",
            }}
          >
            Only operators or admins can add papers from this screen. If you
            were assigned as the leader for a specific paper, open
            <code> /papers/&lt;id&gt; </code> instead — you&apos;ll see a
            Generate companion button.
          </p>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">Generate companion</h1>
            <p style={{ color: "var(--color-paper-600)" }}>
              Paper Pal companions are stored in the{" "}
              <code>paper_companions</code> table as a structured JSON
              payload (<code>ResearchPaperAnalysis</code>). The
              upload-and-analyze flow that calls Gemini lives in a
              follow-up phase.
            </p>
            <p style={{ color: "var(--color-paper-600)" }}>
              In the interim: produce a payload manually (or via the
              old generator), then insert via the Supabase SQL editor:
            </p>
            <pre
              className="text-xs overflow-x-auto rounded-[var(--radius-md)] p-4"
              style={{
                background: "var(--bg-inverse-night)",
                color: "var(--color-indigo-100)",
                fontFamily: "var(--font-mono)",
              }}
            >{`insert into paper_companions (paper_id, payload, generated_by, model)
values (${searchParams.paperId ?? "<paper_id>"}, '{ ...payload }'::jsonb, ${memberId}, 'manual')
on conflict (paper_id) do update
  set payload = excluded.payload,
      generated_at = now(),
      generated_by = excluded.generated_by,
      model = excluded.model;`}</pre>
            {searchParams.paperId && (
              <p>
                <Link
                  href={`/papers/${searchParams.paperId}`}
                  className="underline text-[var(--color-sage-700)]"
                >
                  Open paper {searchParams.paperId} →
                </Link>
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
