import { promises as fs } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { readPaperContent, listPaperContentIds } from "@/lib/paperContent";
import { PaperCompanion } from "@/components/PaperCompanion";

// Phase 7 will write new fixtures to web/content/papers/ after build.
// dynamicParams: true (the Next 14 default) renders unknown ids via SSR
// instead of 404, so newly-generated companions go live without a rebuild.
export const dynamicParams = true;

export async function generateStaticParams() {
  const ids = await listPaperContentIds();
  return ids.map((id) => ({ id }));
}

export default async function PaperPage({
  params,
}: {
  params: { id: string };
}) {
  const content = await readPaperContent(params.id);
  if (!content) notFound();

  const repo = process.env.NEXT_PUBLIC_GITHUB_REPO;
  let colabUrl: string | null = null;
  if (repo) {
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

  return <PaperCompanion content={content} colabUrl={colabUrl} />;
}
