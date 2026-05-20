// /papers/<id> — Paper Pal Synthesis dashboard.
// Rebase resolution (claude/implement-paper-pal-mvlis on top of #47):
//   • If paper_companions.payload exists → render the new PaperDashboard +
//     AssessmentPanel (the #45 JSONB path).
//   • Else if a static fixture exists at web/content/papers/<id>.json →
//     render the legacy PaperCompanion (the #47 path).
//   • Else if the catalog has the paper → owner/leader sees the Synthesize
//     CTA, everyone else sees the read-only PaperPalEmptyState (#47 gate).
//   • Else → real 404.
import { promises as fs } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { readPaperContent } from "@/lib/paperContent";
import { PaperCompanion } from "@/components/PaperCompanion";
import { PaperPalSynthesizePrompt } from "@/components/PaperPalSynthesizePrompt";
import { PaperPalEmptyState } from "@/components/PaperPalEmptyState";
import { PaperDashboard } from "@/components/paperpal/dashboard/PaperDashboard";
import { AssessmentPanel } from "@/components/paperpal/assessment/AssessmentPanel";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canSynthesizePaperPal, paperCatalogRow } from "@/lib/queries";
import type { ResearchPaperAnalysis } from "@/lib/paperpal/types";

export const dynamic = "force-dynamic";

export default async function PaperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const paperIdNum = Number(id);
  const hasNumericId = Number.isFinite(paperIdNum);
  const sb = await createSupabaseServerClient();

  const [content, catalog, gate, companionRes, paperFullRes, meetingRes] =
    await Promise.all([
      readPaperContent(id),
      hasNumericId ? paperCatalogRow(sb, paperIdNum) : Promise.resolve(null),
      hasNumericId
        ? canSynthesizePaperPal(sb, paperIdNum)
        : Promise.resolve({
            canSynthesize: false as const,
            reason: "none" as const,
          }),
      hasNumericId
        ? sb
            .from("paper_companions")
            .select("payload")
            .eq("paper_id", paperIdNum)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      hasNumericId
        ? sb
            .from("papers")
            .select("venue, pdf_drive_url")
            .eq("id", paperIdNum)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      hasNumericId
        ? sb
            .from("meetings")
            .select("scheduled_at, location")
            .eq("paper_id", paperIdNum)
            .in("status", ["prep", "scheduled"])
            .order("scheduled_at", { ascending: true })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const payload = (companionRes as { data: { payload?: ResearchPaperAnalysis } | null })
    ?.data?.payload as ResearchPaperAnalysis | undefined;

  // No content AND no catalog AND no payload → real 404 (unknown paper id).
  if (!content && !catalog && !payload) notFound();

  // JSONB payload present → render the new Paper Pal dashboard.
  if (payload && catalog) {
    const paperFull = (paperFullRes as { data: { venue: string | null; pdf_drive_url: string | null } | null })?.data ?? null;
    const meeting = (meetingRes as { data: { scheduled_at: string | null; location: string | null } | null })?.data ?? null;
    return (
      <>
        <PaperDashboard
          paperId={String(paperIdNum)}
          payload={payload}
          paper={{
            title: catalog.title ?? undefined,
            authors: catalog.authors ?? undefined,
            venue: paperFull?.venue ?? undefined,
            pdf_drive_url: paperFull?.pdf_drive_url ?? null,
            presentHref: `/papers/${paperIdNum}/present`,
          }}
          nextMeeting={
            meeting?.scheduled_at
              ? {
                  whenLabel: new Date(meeting.scheduled_at).toLocaleString(
                    undefined,
                    {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    },
                  ),
                  venue: meeting.location,
                }
              : null
          }
        />
        {payload.assessmentQuiz && (
          <section className="pp-page" id="assessment">
            <AssessmentPanel
              paperId={String(paperIdNum)}
              quiz={payload.assessmentQuiz}
              socraticPrompts={payload.socraticPrompts}
            />
          </section>
        )}
      </>
    );
  }

  // Catalog row exists but no synthesized content yet → CTA or read-only.
  if (!content && catalog) {
    if (gate.canSynthesize && (gate.reason === "owner" || gate.reason === "leader")) {
      return (
        <PaperPalSynthesizePrompt
          paperId={catalog.id}
          paperTitle={catalog.title}
          reason={gate.reason}
        />
      );
    }
    return (
      <PaperPalEmptyState
        paperTitle={catalog.title}
        leaderName={catalog.leader_name}
      />
    );
  }

  // Legacy static fixture present → render the original PaperCompanion.
  const repo = process.env.NEXT_PUBLIC_GITHUB_REPO;
  let colabUrl: string | null = null;
  if (repo && content) {
    const notebookFsPath = path.join(
      process.cwd(),
      "public",
      content.notebook_path.replace(/^\//, ""),
    );
    try {
      await fs.access(notebookFsPath);
      colabUrl = `https://colab.research.google.com/github/${repo}/blob/main/web/public${content.notebook_path}`;
    } catch {
      colabUrl = null;
    }
  }

  return <PaperCompanion content={content!} colabUrl={colabUrl} />;
}
