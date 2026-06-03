import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Brandmark, Icon } from "@/components/ui";
import { AvailabilityForm } from "./AvailabilityForm";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams?: Promise<{ meeting?: string }>;
}) {
  const sb = await createSupabaseServerClient();

  // Resolution rule:
  // - `?meeting=<id>` provided → must resolve to a prep meeting, else 404.
  //   Don't silently redirect to "latest prep" when the user asked for a
  //   specific meeting — that would let an old email link to a now-scheduled
  //   meeting drop the user into the wrong paper's availability form.
  // - No `?meeting` param → fall back to the latest prep meeting (legacy
  //   behavior, used by the dashboard's "needed" CTA before per-meeting
  //   routing existed).
  const rawParam = (await searchParams)?.meeting;
  const hasParam = typeof rawParam === "string" && rawParam.length > 0;

  let prep: { id: number; type?: string } | null = null;

  if (hasParam) {
    const requestedId = Number(rawParam);
    if (!Number.isInteger(requestedId) || requestedId <= 0) notFound();
    const { data: requested } = await sb
      .from("meetings")
      .select("id, type, status")
      .eq("id", requestedId)
      .eq("status", "prep")
      .maybeSingle();
    if (!requested) notFound();
    prep = requested;
  } else {
    const { data: latestPrep } = await sb
      .from("meetings")
      .select("id, type")
      .eq("status", "prep")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    prep = latestPrep;
  }

  const {
    data: { user },
  } = await sb.auth.getUser();

  const { data: memberRow } = user
    ? await sb
        .from("members")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle()
    : { data: null };

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

  const { data: existing } = memberRow
    ? await sb
        .from("availability")
        .select("range_start")
        .eq("meeting_id", prep.id)
        .eq("member_id", memberRow.id)
    : { data: null };

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
