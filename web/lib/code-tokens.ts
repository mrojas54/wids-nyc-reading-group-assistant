// Python highlighting for the companion's code samples: splits source into
// tokens whose kinds map to the cb-* classes in globals.css. Good enough for
// short paper samples; not a full Python lexer.

export type TokenKind =
  | "kw" | "fn" | "cls" | "op" | "num" | "str" | "prop" | "com" | "pun" | "deco" | "var";

export type Token = { kind: TokenKind; text: string };

const KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally",
  "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
  "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
]);

const PUNCTUATION = "()[]{},:;";
const OPERATORS = "=+-*/%<>!&|^~@.";

// String prefixes Python accepts (any case): f"", r"", b"", rb"", fr"" ...
const STRING_START = /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])?("""|'''|"|')/;
// Hex, octal and binary literals, then decimal/float with an optional exponent.
const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?[jJ]?)/;

function scanString(line: string, from: number, quote: string): { end: number; closed: boolean } {
  let j = from;
  while (j < line.length) {
    if (line[j] === "\\") { j += 2; continue; }
    if (line.startsWith(quote, j)) return { end: j + quote.length, closed: true };
    j++;
  }
  return { end: line.length, closed: false };
}

function runOf(line: string, from: number, chars: string): number {
  let j = from;
  while (j < line.length && chars.includes(line[j])) j++;
  return j;
}

function wordKind(word: string, prev: string, next: string): TokenKind {
  if (KEYWORDS.has(word)) return "kw";
  if (prev === ".") return "prop";
  if (/^[A-Z]/.test(word)) return "cls";
  if (next === "(") return "fn";
  return "var";
}

function runWhile(line: string, from: number, re: RegExp): number {
  let j = from;
  while (j < line.length && re.test(line[j])) j++;
  return j;
}

// One scanner per token shape, tried in order at position i. Each returns the
// token's kind and end, or null when the text there isn't its shape.
type Scan = { kind: TokenKind; end: number; openQuote?: string };
type Scanner = (line: string, i: number) => Scan | null;

const scanners: Scanner[] = [
  (line, i) => (line[i] === " " || line[i] === "\t" ? { kind: "var", end: runOf(line, i, " \t") } : null),
  (line, i) => (line[i] === "#" ? { kind: "com", end: line.length } : null),
  (line, i) => {
    const m = line.slice(i).match(STRING_START);
    if (!m) return null;
    const quote = m[1];
    const { end, closed } = scanString(line, i + m[0].length, quote);
    return { kind: "str", end, openQuote: !closed && quote.length === 3 ? quote : undefined };
  },
  (line, i) => (line[i] === "@" && line.slice(0, i).trim() === ""
    ? { kind: "deco", end: runWhile(line, i + 1, /[A-Za-z0-9_.]/) }
    : null),
  (line, i) => {
    const startsNumber = /[0-9]/.test(line[i]) || (line[i] === "." && /[0-9]/.test(line[i + 1] ?? ""));
    const m = startsNumber ? line.slice(i).match(NUMBER) : null;
    return m ? { kind: "num", end: i + m[0].length } : null;
  },
  (line, i) => {
    if (!/[A-Za-z_]/.test(line[i])) return null;
    const end = runWhile(line, i, /[A-Za-z0-9_]/);
    return { kind: wordKind(line.slice(i, end), line[i - 1] ?? "", line[end] ?? ""), end };
  },
  (line, i) => (PUNCTUATION.includes(line[i]) ? { kind: "pun", end: runOf(line, i, PUNCTUATION) } : null),
  (line, i) => (OPERATORS.includes(line[i]) ? { kind: "op", end: runOf(line, i, OPERATORS) } : null),
];

function scanAt(line: string, i: number): Scan {
  for (const scan of scanners) {
    const hit = scan(line, i);
    if (hit) return hit;
  }
  return { kind: "var", end: i + 1 };
}

/**
 * One token row per source line. A triple-quoted string that spans lines
 * stays a string on every line it covers.
 */
export function tokenizePython(code: string): Token[][] {
  let openQuote: string | undefined; // an unclosed triple quote from earlier lines
  return code.split("\n").map((line) => {
    const row: Token[] = [];
    let i = 0;
    if (openQuote) {
      const { end, closed } = scanString(line, 0, openQuote);
      if (end > 0) row.push({ kind: "str", text: line.slice(0, end) });
      if (closed) openQuote = undefined;
      i = end;
    }
    while (i < line.length) {
      const hit = scanAt(line, i);
      row.push({ kind: hit.kind, text: line.slice(i, hit.end) });
      if (hit.openQuote) openQuote = hit.openQuote;
      i = hit.end;
    }
    return row;
  });
}
