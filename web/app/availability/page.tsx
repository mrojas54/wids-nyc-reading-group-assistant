import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Brandmark, Icon } from "@/components/ui";
import { AvailabilityForm } from "./AvailabilityForm";

export const dynamic = "force-dynamic";

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
          <Link href="/dashboard" className="btn btn-ghost btn-sm" aria-label="Back to dashboard">
            <Icon name="chevronRight" size={14} style={{ transform: "rotate(180deg)" }} />
            Back
          </Link>
          <Brandmark />
        </header>
        <main className="shell-main">
          <div className="empty-state">
            <div className="es-glyph">
              <Icon name="calendar" size={22} />
            </div>
            <div className="es-title">Sit tight.</div>
            <div className="es-body">
              Nothing to schedule right now — check back when you get an email.
            </div>
          </div>
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

  return (
    <div className="shell">
      <header className="shell-header">
        <Link href="/dashboard" className="btn btn-ghost btn-sm" aria-label="Back to dashboard">
          <Icon name="chevronRight" size={14} style={{ transform: "rotate(180deg)" }} />
          Back
        </Link>
        <Brandmark />
      </header>
      <main className="shell-main">
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "var(--color-paper-900)",
              marginBottom: 4,
            }}
          >
            We&rsquo;re scheduling the next meeting.
          </h1>
          <p style={{ fontSize: 14, color: "var(--color-paper-600)", lineHeight: 1.5 }}>
            Your taps help us pick the date. We&rsquo;ll go with whatever works for the
            most people. Default window: 6–9 PM ET.
          </p>
        </div>

        <AvailabilityForm meetingId={prep.id} initialDays={initialDays} />
      </main>
    </div>
  );
}
