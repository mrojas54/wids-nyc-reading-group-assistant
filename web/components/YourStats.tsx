import type { Stats } from "@/lib/queries";

export function YourStats({ stats }: { stats: Stats }) {
  return (
    <section>
      <div className="section-h-soft">Since you joined</div>
      <dl className="stats-v2">
        <Stat label="Attended" value={String(stats.meetingsAttended)} />
        <Stat label="Papers led" value={String(stats.papersLed)} />
        <Stat
          label="Availability"
          value={stats.availabilitySubmitted ? "In" : "Pending"}
        />
      </dl>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-cell">
      <dt className="stat-num">{value}</dt>
      <dd className="stat-lbl">{label}</dd>
    </div>
  );
}
