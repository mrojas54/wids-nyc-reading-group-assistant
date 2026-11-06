// /papers/<id> — Paper Pal Synthesis dashboard. lib/paper-page.ts decides
// which view applies (dashboard, synthesize CTA, read-only empty state,
// legacy fixture, or 404); this page only renders it.
import { notFound } from "next/navigation";
import { PaperCompanion } from "@/components/PaperCompanion";
import { PaperPalSynthesizePrompt } from "@/components/PaperPalSynthesizePrompt";
import { PaperPalEmptyState } from "@/components/PaperPalEmptyState";
import { PaperDashboard } from "@/components/paperpal/dashboard/PaperDashboard";
import { AssessmentPanel } from "@/components/paperpal/assessment/AssessmentPanel";
import { loadPaperPage } from "@/lib/paper-page";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PaperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createSupabaseServerClient();
  const view = await loadPaperPage(sb, id);

  switch (view.kind) {
    case "not_found":
      notFound();
    case "dashboard": {
      const { payload } = view;
      return (
        <>
          <PaperDashboard
            paperId={String(view.paperId)}
            payload={payload}
            paper={view.paper}
            nextMeeting={view.nextMeeting}
          />
          {payload.assessmentQuiz && (
            <section className="pp-page" id="assessment">
              <AssessmentPanel
                paperId={String(view.paperId)}
                quiz={payload.assessmentQuiz}
                socraticPrompts={payload.socraticPrompts}
              />
            </section>
          )}
        </>
      );
    }
    case "synthesize":
      return (
        <PaperPalSynthesizePrompt
          paperId={view.catalog.id}
          paperTitle={view.catalog.title}
          reason={view.reason}
        />
      );
    case "empty":
      return (
        <PaperPalEmptyState
          paperTitle={view.catalog.title}
          leaderName={view.catalog.leader_name}
        />
      );
    case "legacy":
      return <PaperCompanion content={view.content} colabUrl={view.colabUrl} />;
  }
}
