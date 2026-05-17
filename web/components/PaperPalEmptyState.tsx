/**
 * Read-only card shown on /papers/<id> when the paper exists in the catalog
 * but no Paper Pal has been synthesized yet AND the viewer is not eligible
 * to synthesize. Names the leader so members know whom to nudge. Spec:
 * docs/superpowers/specs/2026-05-17-paper-pal-design.md §4.2.
 */
export function PaperPalEmptyState({
  paperTitle,
  leaderName,
}: {
  paperTitle: string;
  leaderName: string | null;
}) {
  return (
    <section
      className="card"
      style={{
        padding: 24,
        borderRadius: "var(--radius-xl, 16px)",
        background: "var(--color-paper-50, #fafaf7)",
        border: "1px solid var(--color-paper-200, #e5e3da)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "var(--color-sage-700)",
          marginBottom: 8,
        }}
      >
        Paper Pal · not synthesized yet
      </div>

      <h1
        className="text-xl font-semibold"
        style={{ color: "var(--color-paper-800)", marginBottom: 12 }}
      >
        {paperTitle}
      </h1>

      <p
        style={{
          color: "var(--color-paper-700)",
          marginBottom: 16,
          lineHeight: 1.55,
        }}
      >
        {leaderName
          ? `${leaderName} is leading this paper. They'll synthesize the Paper Pal before the meeting.`
          : "A leader hasn't been assigned yet. The Paper Pal will go up once it has."}
      </p>

      <a
        href="/"
        className="text-sm hover:underline"
        style={{ color: "var(--color-sage-700)" }}
      >
        ← Back to your dashboard
      </a>
    </section>
  );
}
