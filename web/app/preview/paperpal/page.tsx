import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { previewHarnessAllowed } from "@/lib/paperpal/preview-guard";
import { PreviewHarness } from "./PreviewHarness";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paper Pal preview checks", robots: { index: false, follow: false } };

export default async function PreviewPage({ searchParams }: {
  searchParams: Promise<{ run?: string; mode?: string }>;
}) {
  if (!previewHarnessAllowed((await headers()).get("host"))) notFound();
  const params = await searchParams;
  const run = typeof params.run === "string" && /^\d{1,10}$/.test(params.run) ? params.run : "1";
  return <PreviewHarness run={run} mode={params.mode === "tutor" ? "tutor" : "quiz"}
    commit={process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown"} />;
}
