// Cyberdream-themed code block for the companion page.
// Chrome + palette come from the design bundle generated 2026-05-05; the small
// Python tokenizer below maps highlight categories to the cyberdream classes
// defined in globals.css.

import { Fragment, type ReactNode } from "react";

export type CodeBlockProps = {
  code: string;
  language?: string;
  notebookHref?: string | null;
};

type Tok = "kw" | "fn" | "cls" | "op" | "num" | "str" | "prop" | "com" | "pun" | "deco" | "var";

const PY_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally",
  "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
  "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
]);

const PY_BUILTINS = new Set([
  "abs", "all", "any", "bool", "dict", "enumerate", "filter", "float", "int",
  "len", "list", "map", "max", "min", "print", "range", "set", "sorted", "str",
  "sum", "tuple", "type", "zip",
]);

// Tokenize one line of Python into spans. Strings, comments, numbers, and
// identifiers are recognized; anything else falls through as a punctuation or
// operator span. Good enough for paper-companion code samples; not a full
// parser.
function tokenizePythonLine(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const push = (kind: Tok, text: string) => {
    if (!text) return;
    if (kind === "var") out.push(<Fragment key={key++}>{text}</Fragment>);
    else out.push(<span key={key++} className={`cb-${kind}`}>{text}</span>);
  };

  while (i < line.length) {
    const ch = line[i];

    if (ch === " " || ch === "\t") {
      let j = i;
      while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
      out.push(<Fragment key={key++}>{line.slice(i, j)}</Fragment>);
      i = j;
      continue;
    }

    if (ch === "#") {
      push("com", line.slice(i));
      i = line.length;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\" && j + 1 < line.length) { j += 2; continue; }
        if (line[j] === quote) { j++; break; }
        j++;
      }
      push("str", line.slice(i, j));
      i = j;
      continue;
    }

    if (ch === "@") {
      let j = i + 1;
      while (j < line.length && /[A-Za-z0-9_.]/.test(line[j])) j++;
      push("deco", line.slice(i, j));
      i = j;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(line[i + 1] ?? ""))) {
      let j = i + (ch === "-" ? 1 : 0);
      while (j < line.length && /[0-9eE_.+\-]/.test(line[j])) j++;
      push("num", line.slice(i, j));
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) j++;
      const word = line.slice(i, j);
      const prev = i > 0 ? line[i - 1] : "";
      const next = line[j] ?? "";

      if (PY_KEYWORDS.has(word)) push("kw", word);
      else if (prev === "." ) push("prop", word);
      else if (next === "(") {
        // ClassName(...) → class; otherwise function call.
        if (/^[A-Z]/.test(word)) push("cls", word);
        else if (PY_BUILTINS.has(word)) push("fn", word);
        else push("fn", word);
      }
      else if (/^[A-Z][A-Za-z0-9_]*$/.test(word)) push("cls", word);
      else push("var", word);
      i = j;
      continue;
    }

    if ("()[]{},:;".includes(ch)) {
      let j = i;
      while (j < line.length && "()[]{},:;".includes(line[j])) j++;
      push("pun", line.slice(i, j));
      i = j;
      continue;
    }

    if ("=+-*/%<>!&|^~@.".includes(ch)) {
      let j = i;
      while (j < line.length && "=+-*/%<>!&|^~@.".includes(line[j])) j++;
      push("op", line.slice(i, j));
      i = j;
      continue;
    }

    push("var", ch);
    i++;
  }

  return out;
}

export function CodeBlock({ code, language = "python", notebookHref }: CodeBlockProps) {
  const lines = code.replace(/\n+$/, "").split("\n");
  const isPython = language === "python";

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
            {isPython ? tokenizePythonLine(line) : line}
          </span>
        ))}
      </pre>
    </div>
  );
}
