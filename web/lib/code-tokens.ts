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

function scanString(
  line: string,
  from: number,
  quote: string,
  fString = false,
): { end: number; closed: boolean } {
  let j = from;
  while (j < line.length) {
    if (line[j] === "\\") { j += 2; continue; }
    if (fString && line.startsWith("{{", j)) { j += 2; continue; }
    if (fString && line[j] === "{") { j = scanField(line, j + 1); continue; }
    if (line.startsWith(quote, j)) return { end: j + quote.length, closed: true };
    j++;
  }
  return { end: line.length, closed: false };
}

// An f-string replacement field from just after its "{": skips nested braces
// and nested strings (Python 3.12 allows the outer quote inside), and returns
// the index just after the matching "}".
function scanField(line: string, from: number): number {
  let depth = 1;
  let j = from;
  while (j < line.length && depth > 0) {
    const str = line.slice(j).match(STRING_START);
    if (str) {
      const prefixF = /[fF]/.test(str[0].slice(0, -str[1].length));
      j = scanString(line, j + str[0].length, str[1], prefixF).end;
      continue;
    }
    if (line[j] === "{") depth++;
    else if (line[j] === "}") depth--;
    j++;
  }
  return j;
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

// An operator run, stopping before ".5" so the number keeps its point.
function operatorEnd(line: string, from: number): number {
  let j = from;
  while (j < line.length && OPERATORS.includes(line[j])) {
    if (j > from && line[j] === "." && /[0-9]/.test(line[j + 1] ?? "")) break;
    j++;
  }
  return j;
}

function runWhile(line: string, from: number, re: RegExp): number {
  let j = from;
  while (j < line.length && re.test(line[j])) j++;
  return j;
}

// One scanner per token shape, tried in order at position i. Each returns the
// token's kind and end, or null when the text there isn't its shape.
type Scan = { kind: TokenKind; end: number; openQuote?: string };
// Whether position i can start a statement: not inside brackets left open on
// an earlier line, not after a backslash continuation, nothing before it.
type Context = { statementStart: boolean };
type Scanner = (line: string, i: number, ctx: Context) => Scan | null;

const scanners: Scanner[] = [
  (line, i) => (line[i] === " " || line[i] === "\t" ? { kind: "var", end: runOf(line, i, " \t") } : null),
  (line, i) => (line[i] === "#" ? { kind: "com", end: line.length } : null),
  (line, i) => {
    const m = line.slice(i).match(STRING_START);
    if (!m) return null;
    const quote = m[1];
    const fString = /[fF]/.test(m[0].slice(0, -quote.length));
    const { end, closed } = scanString(line, i + m[0].length, quote, fString);
    return { kind: "str", end, openQuote: !closed && quote.length === 3 ? quote : undefined };
  },
  (line, i, ctx) => (line[i] === "@" && ctx.statementStart && line.slice(0, i).trim() === ""
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
  (line, i) => (OPERATORS.includes(line[i]) ? { kind: "op", end: operatorEnd(line, i) } : null),
];

function scanAt(line: string, i: number, ctx: Context): Scan {
  for (const scan of scanners) {
    const hit = scan(line, i, ctx);
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
  let depth = 0; // brackets still open from earlier lines
  let continued = false; // the previous line ended in a backslash
  return code.split("\n").map((line) => {
    const row: Token[] = [];
    const ctx: Context = { statementStart: depth === 0 && !continued };
    let i = 0;
    if (openQuote) {
      const { end, closed } = scanString(line, 0, openQuote);
      if (end > 0) row.push({ kind: "str", text: line.slice(0, end) });
      if (closed) openQuote = undefined;
      i = end;
    }
    while (i < line.length) {
      const hit = scanAt(line, i, ctx);
      const text = line.slice(i, hit.end);
      row.push({ kind: hit.kind, text });
      if (hit.kind === "pun") depth = Math.max(0, depth + bracketDelta(text));
      if (hit.openQuote) openQuote = hit.openQuote;
      i = hit.end;
    }
    const last = row.at(-1);
    continued = !openQuote && last?.kind !== "com" && line.endsWith("\\");
    return row;
  });
}

function bracketDelta(text: string): number {
  let d = 0;
  for (const c of text) {
    if ("([{".includes(c)) d++;
    else if (")]}".includes(c)) d--;
  }
  return d;
}
