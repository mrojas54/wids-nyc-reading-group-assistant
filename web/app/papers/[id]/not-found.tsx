export default function PaperNotFound() {
  return (
    <div className="space-y-3 py-8">
      <h1
        className="text-2xl font-semibold"
        style={{ color: "var(--color-paper-800)" }}
      >
        Companion not found.
      </h1>
      <p style={{ color: "var(--color-paper-700)" }}>
        That paper doesn&apos;t have a companion page yet — either the link is wrong, or
        the companion hasn&apos;t been generated.
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
