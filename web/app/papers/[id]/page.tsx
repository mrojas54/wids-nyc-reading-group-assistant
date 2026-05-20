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
import TweaksPanel from "@/components/paperpal/TweaksPanel";
import { AssessmentPanel } from "@/components/paperpal/assessment/AssessmentPanel";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canSynthesizePaperPal, paperCatalogRow } from "@/lib/queries";
import type { ResearchPaperAnalysis } from "@/lib/paperpal/types";

export const dynamic = "force-dynamic";

export default async function PaperPage(props: {
  params: { id: string };
}) {
  try {
    return await renderPaperPage(props);
  } catch (err) {
    // TEMP: surface unminified server error so we can debug the
    // `Application error: server-side exception` (digest 3829607229).
    // Remove once /papers/[id] is stable.
    // eslint-disable-next-line no-console
    console.error("[/papers/[id]] render failed", {
      paperId: props.params.id,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
}

async function renderPaperPage({
  params,
}: {
  params: { id: string };
}) {
  const paperIdNum = Number(params.id);
  const hasNumericId = Number.isFinite(paperIdNum);
  const sb = createSupabaseServerClient();

  const [content, catalog, gate, companionRes, paperFullRes, meetingRes] =
    await Promise.all([
      readPaperContent(params.id),
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
    // TEMP DEBUG: binary-bisect for digest 3829607229. Raw dump only
    // (no PaperDashboard, no client components). If this renders, the
    // bug is downstream in PaperDashboard or its client children.
    // Revert this whole block once root cause is identified.
    return (
      <pre style={{ padding: 16, fontSize: 12, whiteSpace: "pre-wrap" }}>
        DEBUG /papers/{paperIdNum} — raw dump (PaperDashboard bypassed){"\n\n"}
        {JSON.stringify(
          {
            paperId: paperIdNum,
            catalogKeys: catalog ? Object.keys(catalog) : null,
            paperFullKeys: paperFull ? Object.keys(paperFull) : null,
            meetingKeys: meeting ? Object.keys(meeting) : null,
            payloadKeys: Object.keys(payload),
            payloadSample: {
              title: payload.title,
              authorsCount: payload.authors?.length ?? 0,
              terminologyCount: payload.terminology?.length ?? 0,
              mathCount: payload.mathExplanations?.length ?? 0,
              diagramsCount: payload.diagrams?.length ?? 0,
              codeSamplesCount: payload.codeSamples?.length ?? 0,
              hasAssessmentQuiz: !!payload.assessmentQuiz,
              socraticPromptsCount: payload.socraticPrompts?.length ?? 0,
              learningResourcesCount: payload.learningResources?.length ?? 0,
              keyTakeawaysCount: payload.keyTakeaways?.length ?? 0,
            },
          },
          null,
          2,
        )}
      </pre>
    );
    // NOTE: the real PaperDashboard render lives in commit ae2c8d5's parent.
    // `git revert ae2c8d5` restores it once digest 3829607229 is resolved —
    // it was deleted here only because TypeScript performs no narrowing in
    // code after an unconditional return, which broke the production build.
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
