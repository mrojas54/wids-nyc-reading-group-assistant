// /papers/<id>/present — Paper Pal Presenter surface.
// Full-screen slide deck derived client-side from the companion payload.
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import PresenterScreen from "@/components/paperpal/presenter/PresenterScreen";
import { derivSlides } from "@/lib/paperpal/presenter";
import type { ResearchPaperAnalysis } from "@/lib/paperpal/types";

export const dynamic = "force-dynamic";

export default async function PresentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const paperId = Number(id);
  if (!Number.isFinite(paperId)) notFound();

  const sb = await createSupabaseServerClient();
  const { data } = await sb
    .from("paper_companions")
    .select("payload")
    .eq("paper_id", paperId)
    .maybeSingle();

  const payload = data?.payload as ResearchPaperAnalysis | undefined;
  if (!payload) notFound();

  const slides = derivSlides(payload);
  return <PresenterScreen paperId={String(paperId)} slides={slides} />;
}
