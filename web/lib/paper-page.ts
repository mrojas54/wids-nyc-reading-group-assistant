// Data loader for /papers/<id>. It decides which of the four views the page
// renders, so app/papers/[id]/page.tsx only maps a view to its component:
//   • paper_companions.payload and a catalog row → "dashboard" (Paper Pal JSONB path)
//   • catalog row but no synthesized content → "synthesize" for the paper's
//     owner or meeting leader, "empty" (read-only) for everyone else
//   • static fixture at web/content/papers/<id>.json → "legacy" PaperCompanion
//   • none of these → "not_found"
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { readPaperContent, type PaperContent } from "@/lib/paperContent";
import { formatMeetingTime } from "@/lib/paperpal/meeting-time";
import type { ResearchPaperAnalysis } from "@/lib/paperpal/types";
import {
  canSynthesizePaperPal,
  paperCatalogRow,
  type PaperCatalogRow,
} from "@/lib/queries";

export type PaperPageView =
  | { kind: "not_found" }
  | {
      kind: "dashboard";
      paperId: number;
      payload: ResearchPaperAnalysis;
      paper: {
        title?: string;
        authors?: string[];
        venue?: string;
        pdf_drive_url: string | null;
        presentHref: string;
      };
      nextMeeting: { whenLabel: string; venue: string | null } | null;
    }
  | { kind: "synthesize"; catalog: PaperCatalogRow; reason: "owner" | "leader" }
  | { kind: "empty"; catalog: PaperCatalogRow }
  | { kind: "legacy"; content: PaperContent; colabUrl: string | null };

type PaperDetails = { venue: string | null; pdf_drive_url: string | null };
type UpcomingMeeting = { scheduled_at: string | null; location: string | null };

/** The database rows the page needs; all null for a non-numeric id. */
async function loadPaperRows(sb: SupabaseClient<Database>, paperId: number) {
  const [catalog, gate, companion, details, meeting] = await Promise.all([
    paperCatalogRow(sb, paperId),
    canSynthesizePaperPal(sb, paperId),
    sb
      .from("paper_companions")
      .select("payload")
      .eq("paper_id", paperId)
      .maybeSingle(),
    sb
      .from("papers")
      .select("venue, pdf_drive_url")
      .eq("id", paperId)
      .maybeSingle(),
    sb
      .from("meetings")
      .select("scheduled_at, location")
      .eq("paper_id", paperId)
      .in("status", ["prep", "scheduled"])
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const payload = (companion.data as { payload?: ResearchPaperAnalysis } | null)
    ?.payload;
  return {
    catalog,
    gate,
    payload,
    details: (details.data as PaperDetails | null) ?? null,
    meeting: (meeting.data as UpcomingMeeting | null) ?? null,
  };
}

/** Colab link for a legacy fixture's notebook, only when the notebook ships in web/public. */
async function colabUrlFor(content: PaperContent): Promise<string | null> {
  const repo = process.env.NEXT_PUBLIC_GITHUB_REPO;
  if (!repo) return null;
  const notebookFsPath = path.join(
    process.cwd(),
    "public",
    content.notebook_path.replace(/^\//, ""),
  );
  try {
    await fs.access(notebookFsPath);
  } catch {
    return null;
  }
  return `https://colab.research.google.com/github/${repo}/blob/main/web/public${content.notebook_path}`;
}

export async function loadPaperPage(
  sb: SupabaseClient<Database>,
  id: string,
): Promise<PaperPageView> {
  const paperId = Number(id);
  const [content, rows] = await Promise.all([
    readPaperContent(id),
    Number.isFinite(paperId) ? loadPaperRows(sb, paperId) : null,
  ]);
  const catalog = rows?.catalog ?? null;
  const payload = rows?.payload;

  if (rows && payload && catalog) {
    return {
      kind: "dashboard",
      paperId,
      payload,
      paper: {
        title: catalog.title ?? undefined,
        authors: catalog.authors ?? undefined,
        venue: rows.details?.venue ?? undefined,
        pdf_drive_url: rows.details?.pdf_drive_url ?? null,
        presentHref: `/papers/${paperId}/present`,
      },
      nextMeeting: rows.meeting?.scheduled_at
        ? {
            whenLabel: formatMeetingTime(rows.meeting.scheduled_at),
            venue: rows.meeting.location,
          }
        : null,
    };
  }

  if (!content && rows && catalog) {
    const { gate } = rows;
    if (gate.canSynthesize) {
      return { kind: "synthesize", catalog, reason: gate.reason };
    }
    return { kind: "empty", catalog };
  }

  // A companion payload without a catalog row (or no record at all) has no
  // view to render, so it is a 404 rather than a legacy page with no content.
  if (!content) return { kind: "not_found" };
  return { kind: "legacy", content, colabUrl: await colabUrlFor(content) };
}
