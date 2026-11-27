// Cyberdream-themed code block for the companion page.
// Chrome + palette come from the design bundle generated 2026-05-05; the small
// Python tokenizer in lib/code-tokens.ts maps highlight categories to the
// cyberdream classes defined in globals.css.

import { Fragment, type ReactNode } from "react";
import { tokenizePython, type Token } from "@/lib/code-tokens";

export type CodeBlockProps = {
  code: string;
  language?: string;
  notebookHref?: string | null;
};

function renderTokens(tokens: Token[]): ReactNode[] {
  return tokens.map((t, k) =>
    t.kind === "var"
      ? <Fragment key={k}>{t.text}</Fragment>
      : <span key={k} className={`cb-${t.kind}`}>{t.text}</span>,
  );
}

export function CodeBlock({ code, language = "python", notebookHref }: CodeBlockProps) {
  const source = code.replace(/\n+$/, "");
  const lines = source.split("\n");
  const rows = language === "python" ? tokenizePython(source) : null;

  return (
    <div className="cb">
      <div className="cb-head">
        <span className="cb-lang">{language}</span>
        {notebookHref && (
          <a
            className="cb-link"
            href={notebookHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            Run in Colab ↗
          </a>
        )}
      </div>
      <pre>
        {lines.map((line, idx) => (
          <span key={idx} className="cb-row">
            <span className="cb-ln">{idx + 1}</span>
            {rows ? renderTokens(rows[idx]) : line}
          </span>
        ))}
      </pre>
    </div>
  );
}
