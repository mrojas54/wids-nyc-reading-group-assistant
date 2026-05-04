import type { Stats } from "@/lib/queries";

export function YourStats({ stats }: { stats: Stats }) {
  return (
    <section className="stats">
      <h3 className="section-eyebrow">Your year</h3>
      <dl className="stats-grid">
        <Stat label="Meetings attended" value={String(stats.meetingsAttended)} />
        <Stat label="Papers led" value={String(stats.papersLed)} />
        <Stat
          label="Availability"
          value={stats.availabilitySubmitted ? "Submitted" : "Pending"}
          tone={stats.availabilitySubmitted ? "ok" : "pending"}
        />
      </dl>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "pending";
}) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
