import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Brandmark, Icon } from "@/components/ui";
import { AvailabilityForm } from "./AvailabilityForm";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  admin: "admin",
  reading_group: "reading group",
};

export default async function AvailabilityPage() {
  const sb = createSupabaseServerClient();

  const { data: prep } = await sb
    .from("meetings")
    .select("id, type")
    .eq("status", "prep")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!prep) {
    return (
      <div className="shell">
        <header className="shell-header">
          <Brandmark />
        </header>
        <main className="shell-main availability">
          <header className="availability-head">
            <h1>Availability</h1>
            <p>Nothing to schedule right now — check back when you get an email.</p>
          </header>
          <Link href="/dashboard" className="back-link">
            <Icon name="chevronRight" size={14} style={{ transform: "rotate(180deg)" }} />
            Dashboard
          </Link>
        </main>
      </div>
    );
  }

  const { data: existing } = await sb
    .from("availability")
    .select("range_start")
    .eq("meeting_id", prep.id);

  const initialDays = (existing ?? []).map((r: { range_start: string }) =>
    new Date(r.range_start).toISOString().slice(0, 10),
  );

  const typeLabel = TYPE_LABEL[prep.type] ?? prep.type.replace("_", " ");

  return (
    <div className="shell">
      <header className="shell-header">
        <Brandmark />
      </header>
      <main className="shell-main availability">
        <header className="availability-head">
          <h1>Availability — {typeLabel}</h1>
          <p>Tap the days you can attend. We&rsquo;ll match against everyone&rsquo;s picks to land a date.</p>
        </header>

        <AvailabilityForm meetingId={prep.id} initialDays={initialDays} />

        <Link href="/dashboard" className="back-link">
          <Icon name="chevronRight" size={14} style={{ transform: "rotate(180deg)" }} />
          Dashboard
        </Link>
      </main>
    </div>
  );
}
