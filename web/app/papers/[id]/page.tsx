// /papers/<id> — Paper Pal Synthesis dashboard.
//
// Hybrid of two branches:
//   • main shipped a synthesis gate (canSynthesizePaperPal) plus an
//     owner/leader CTA + read-only empty state for ineligible viewers.
//   • this branch replaces the static-fixture renderer with a
//     paper_companions (jsonb) -backed PaperDashboard.
//
// Resolution: keep main's gate; route the synthesize CTA into /new
// (operator onboarding) instead of the deprecated slash-command
// clipboard pattern; render PaperDashboard when the jsonb payload
// exists; render main's PaperPalEmptyState when ineligible.
import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PaperDashboard } from "@/components/paperpal/dashboard/PaperDashboard";
import TweaksPanel from "@/components/paperpal/TweaksPanel";
import { AssessmentPanel } from "@/components/paperpal/assessment/AssessmentPanel";
import { PaperPalEmptyState } from "@/components/PaperPalEmptyState";
import { canSynthesizePaperPal, paperCatalogRow } from "@/lib/queries";
import type { ResearchPaperAnalysis } from "@/lib/paperpal/types";

export const dynamic = "force-dynamic";

type PaperRow = {
  id: number;
  title: string | null;
  authors: string[] | null;
  venue: string | null;
  pdf_drive_url: string | null;
  abstract: string | null;
  companion_url: string | null;
};

export default async function PaperPage({
  params,
}: {
  params: { id: string };
}) {
  const paperId = Number(params.id);
  if (!Number.isFinite(paperId)) notFound();

  const sb = createSupabaseServerClient();

  const [paperRes, companionRes, meetingRes, gate, catalog] = await Promise.all([
    sb
      .from("papers")
      .select("id, title, authors, venue, pdf_drive_url, abstract, companion_url")
      .eq("id", paperId)
      .maybeSingle(),
    sb
      .from("paper_companions")
      .select("payload")
      .eq("paper_id", paperId)
      .maybeSingle(),
    sb
      .from("meetings")
      .select("id, scheduled_at, location, type, status")
      .eq("paper_id", paperId)
      .in("status", ["prep", "scheduled"])
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    canSynthesizePaperPal(sb, paperId),
    paperCatalogRow(sb, paperId),
  ]);

  const paper = paperRes.data as PaperRow | null;
  if (!paper) notFound();

  const payload = companionRes.data?.payload as ResearchPaperAnalysis | undefined;
  const meeting = meetingRes.data ?? null;

  // Synthesized payload exists → full dashboard for everyone on the roster.
  if (payload) {
    return (
      <>
        <PaperDashboard
          paperId={String(paperId)}
          payload={payload}
          paper={{
            title: paper.title ?? undefined,
            authors: paper.authors ?? undefined,
            venue: paper.venue ?? undefined,
            pdf_drive_url: paper.pdf_drive_url,
            presentHref: `/papers/${paperId}/present`,
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
              paperId={String(paperId)}
              quiz={payload.assessmentQuiz}
              socraticPrompts={payload.socraticPrompts}
            />
          </section>
        )}
        <TweaksPanel />
      </>
    );
  }

  // No payload yet. Eligible viewer (operator/admin/leader) → CTA to /new.
  // Ineligible viewer (other members) → empty state naming the leader.
  if (gate.canSynthesize && (gate.reason === "owner" || gate.reason === "leader")) {
    return (
      <SynthesizeCta
        paperId={paperId}
        paperTitle={paper.title ?? `Paper ${paperId}`}
        reason={gate.reason}
      />
    );
  }

  return (
    <PaperPalEmptyState
      paperTitle={catalog?.title ?? paper.title ?? `Paper ${paperId}`}
      leaderName={catalog?.leader_name ?? null}
    />
  );
}

function SynthesizeCta({
  paperId,
  paperTitle,
  reason,
}: {
  paperId: number;
  paperTitle: string;
  reason: "owner" | "leader";
}) {
  const who =
    reason === "owner" ? "you're an operator" : "you're the leader for this paper";
  return (
    <section
      className="card"
      style={{
        padding: 24,
        borderRadius: "var(--radius-xl, 16px)",
        background: "var(--color-paper-50)",
        border: "1px solid var(--color-paper-200)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          letterSpacing: "var(--tr-eyebrow)",
          textTransform: "uppercase",
          color: "var(--color-sage-700)",
          marginBottom: 8,
        }}
      >
        Paper Pal · not synthesized yet
      </div>
      <h1
        className="text-xl font-semibold"
        style={{ color: "var(--color-paper-800)", marginBottom: 8 }}
      >
        {paperTitle}
      </h1>
      <p style={{ color: "var(--color-paper-700)", marginBottom: 16 }}>
        No companion has been generated yet. Because {who}, you can
        synthesize one now.
      </p>
      <Link
        href={`/new?paperId=${paperId}`}
        className="btn btn-primary"
        style={{ display: "inline-block" }}
      >
        Generate companion →
      </Link>
    </section>
  );
}
