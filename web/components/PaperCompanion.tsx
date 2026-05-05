import type { PaperContent } from "@/lib/paperContent";
import { CodeBlock } from "@/components/ui";
import { MermaidDiagram } from "./MermaidDiagram";

function paperLinkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "arxiv.org") return "arXiv";
    if (host === "doi.org") return "DOI";
    if (host === "openreview.net") return "OpenReview";
    return "Paper";
  } catch {
    return "Paper";
  }
}

export function PaperCompanion({
  content,
  colabUrl,
}: {
  content: PaperContent;
  colabUrl: string | null;
}) {
  const hasVocabulary = !!content.vocabulary && content.vocabulary.length > 0;

  return (
    <article className="space-y-10">
      <header className="space-y-3">
        <h1
          className="text-2xl font-semibold"
          style={{ color: "var(--color-paper-800)" }}
        >
          {content.title}
        </h1>
        <p
          className="text-sm"
          style={{ color: "var(--color-paper-600)" }}
        >
          {content.authors.join(", ")}
        </p>
        {content.paper_url && (
          <a
            href={content.paper_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm hover:underline"
            style={{ color: "var(--color-sage-700)" }}
          >
            {paperLinkLabel(content.paper_url)} ↗
          </a>
        )}
      </header>

      {colabUrl && (
        <div>
          <a
            href={colabUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            Open notebook in Colab ↗
          </a>
        </div>
      )}

      {content.sections.length > 0 && (
        <nav aria-labelledby="toc-heading" className="space-y-3">
          <h2
            id="toc-heading"
            className="text-lg font-semibold"
            style={{ color: "var(--color-paper-800)" }}
          >
            In this companion.
          </h2>
          <ol className="list-decimal list-inside space-y-1">
            {content.sections.map((s, i) => (
              <li key={i}>
                <a
                  href={`#section-${i + 1}`}
                  className="hover:underline"
                  style={{ color: "var(--color-sage-700)" }}
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {hasVocabulary && (
        <section aria-labelledby="vocab-heading" className="space-y-3">
          <h2
            id="vocab-heading"
            className="text-lg font-semibold"
            style={{ color: "var(--color-paper-800)" }}
          >
            Vocabulary.
          </h2>
          <dl className="space-y-2">
            {content.vocabulary!.map((v) => (
              <div key={v.term} className="flex flex-col sm:flex-row gap-1 sm:gap-3">
                <dt
                  className="font-semibold sm:min-w-[12rem]"
                  style={{ color: "var(--color-sage-700)" }}
                >
                  {v.term}
                </dt>
                <dd style={{ color: "var(--color-paper-700)" }}>
                  {v.definition}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {content.sections.map((s, i) => (
        <section
          key={i}
          id={`section-${i + 1}`}
          className="space-y-3 scroll-mt-24"
        >
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--color-paper-800)" }}
          >
            {i + 1}. {s.title}
          </h2>
          <p style={{ color: "var(--color-paper-700)" }}>{s.summary}</p>
          {s.mermaid && (
            <MermaidDiagram
              source={s.mermaid}
              caption={
                s.mermaid_caption ?? `Figure ${i + 1} · ${s.title}`
              }
            />
          )}
          {s.code && (
            <CodeBlock code={s.code} notebookHref={colabUrl} />
          )}
        </section>
      ))}

      <footer
        className="border-t pt-4 text-xs"
        style={{
          borderColor: "var(--color-paper-200)",
          color: "var(--color-paper-600)",
        }}
      >
        Generated{" "}
        {new Date(content.generated_at).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
        . The paper itself is the source of truth.
      </footer>
    </article>
  );
}
