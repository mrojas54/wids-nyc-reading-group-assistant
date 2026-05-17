export default function PaperNotFound() {
  return (
    <div className="space-y-3 py-8">
      <h1
        className="text-2xl font-semibold"
        style={{ color: "var(--color-paper-800)" }}
      >
        Paper Pal not found.
      </h1>
      <p style={{ color: "var(--color-paper-700)" }}>
        We couldn&apos;t find that paper. Either the link is wrong, or the
        paper isn&apos;t in the catalog yet.
      </p>
      <p>
        <a
          href="/"
          className="text-sm hover:underline"
          style={{ color: "var(--color-sage-700)" }}
        >
          ← Back to home
        </a>
      </p>
    </div>
  );
}
