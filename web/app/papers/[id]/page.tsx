import { promises as fs } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { readPaperContent, listPaperContentIds } from "@/lib/paperContent";
import { PaperCompanion } from "@/components/PaperCompanion";
import { PaperPalSynthesizePrompt } from "@/components/PaperPalSynthesizePrompt";
import { PaperPalEmptyState } from "@/components/PaperPalEmptyState";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canSynthesizePaperPal, paperCatalogRow } from "@/lib/queries";

// Phase 7 will write new fixtures to web/content/papers/ after build.
// dynamicParams: true (the Next 14 default) renders unknown ids via SSR
// instead of 404, so newly-generated Paper Pals go live without a rebuild.
export const dynamicParams = true;
// The catalog + gate lookup is per-request — opt out of static rendering
// so signed-in viewers see the Synthesize CTA when eligible.
export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  const ids = await listPaperContentIds();
  return ids.map((id) => ({ id }));
}

export default async function PaperPage({
  params,
}: {
  params: { id: string };
}) {
  const paperIdNum = Number(params.id);
  const sb = createSupabaseServerClient();

  const [content, catalog, gate] = await Promise.all([
    readPaperContent(params.id),
    Number.isFinite(paperIdNum) ? paperCatalogRow(sb, paperIdNum) : Promise.resolve(null),
    Number.isFinite(paperIdNum)
      ? canSynthesizePaperPal(sb, paperIdNum)
      : Promise.resolve({ canSynthesize: false as const, reason: "none" as const }),
  ]);

  // No content AND no catalog row → real 404 (unknown paper id).
  if (!content && !catalog) notFound();

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

  // Synthesized content present → render Paper Pal.
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
