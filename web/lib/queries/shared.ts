// Pieces the query modules share: status types, the error log line and the
// Paper Pal link rule. See index.ts for the typing rules every query follows.
import type { PostgrestError } from "@supabase/supabase-js";
import type { Tables } from "@/lib/database.types";

export type MeetingStatus = "prep" | "scheduled" | "done" | "cancelled" | "guide_failed";
export type RsvpStatus = "attending" | "declined" | "tentative" | "no_response";

// Shape of the `papers:paper_id(...)` embed used by nextMeeting/myHistory —
// built from the generated Row types so a renamed/dropped column on either
// table is a compile error here, not a silently-undefined field at runtime.
export type PaperCompanionEmbed = Pick<Tables<"papers">, "id" | "title" | "companion_url"> & {
  paper_companions: Pick<Tables<"paper_companions">, "paper_id">[] | Pick<Tables<"paper_companions">, "paper_id"> | null;
};

export function logQueryError(fn: string, error: PostgrestError | null): void {
  if (!error) return;
  console.error(JSON.stringify({ event: "query_failed", fn, message: error.message, code: error.code }));
}

// Paper Pal stores each companion in `paper_companions` and renders it at
// /papers/<paper_id>. The legacy `papers.companion_url` column holds a
// denormalised copy of that same path, left over from the retired
// /wids-make-companion flow — and the Paper Pal generator never writes it, so it
// is NULL for every Paper-Pal-era paper. Gating on the column therefore hid every
// Paper Pal companion. The companion row is the source of truth; fall back to the
// column only for pre-Paper-Pal papers that have one.
export function companionUrl(papers: PaperCompanionEmbed | null): string | null {
  // paper_companions.paper_id is both PK and FK, so PostgREST may collapse this
  // 1-to-1 embed to a bare object instead of a single-element array.
  const embed = papers?.paper_companions;
  const hasCompanion = Array.isArray(embed) ? embed.length > 0 : embed != null;

  if (hasCompanion && papers?.id != null) return `/papers/${papers.id}`;
  return papers?.companion_url ?? null;
}
