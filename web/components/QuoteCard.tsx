import { getQuoteOfDay } from "@/lib/quotes";

/**
 * Quote of the day — a rotating quote from a pioneering woman in STEM history.
 * Server component: the selection is deterministic per calendar day and reads
 * the committed bundle (web/lib/quotes.generated.json) via @/lib/quotes.
 */
export function QuoteCard() {
  const { author, quote } = getQuoteOfDay();
  return (
    <section
      className="card"
      aria-labelledby="quote-card-eyebrow"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 24,
        borderRadius: "var(--radius-xl, 16px)",
        background: "var(--color-paper-50, #fafaf7)",
        border: "1px solid var(--color-paper-200, #e5e3da)",
      }}
    >
      <div
        id="quote-card-eyebrow"
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.10em",
          color: "var(--color-paper-600)",
        }}
      >
        Quote of the day
      </div>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 18,
          lineHeight: 1.5,
          color: "var(--color-paper-900)",
        }}
      >
        {"“"}
        {quote.text}
        {"”"}
      </p>
      <p style={{ margin: 0, fontSize: 13, color: "var(--color-paper-700)" }}>
        — <b>{author.name}</b>, {author.role}
      </p>
      {author.notable_contributions && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-paper-600)" }}>
          {author.notable_contributions}
        </p>
      )}
    </section>
  );
}
