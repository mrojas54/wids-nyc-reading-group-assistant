import { describe, expect, it } from "vitest";
import { tokenizePython, type Token } from "../code-tokens";

// Compact view of one line: "kind:text" per token, whitespace dropped.
const line = (src: string): string[] =>
  tokenizePython(src)[0].filter((t) => t.text.trim()).map((t) => `${t.kind}:${t.text}`);

const joined = (rows: Token[][]) => rows.map((r) => r.map((t) => t.text).join(""));

describe("tokenizePython", () => {
  it("keeps every character, one row per line", () => {
    const src = "def f(x):\n    return x  # done\n\n";
    expect(joined(tokenizePython(src))).toEqual(src.split("\n"));
  });

  it("names keywords, calls, classes, attributes and plain names", () => {
    expect(line("if mask is not None: return softmax(np.exp(x)), Linear(3), Tensor")).toEqual([
      "kw:if", "var:mask", "kw:is", "kw:not", "kw:None", "pun::", "kw:return",
      "fn:softmax", "pun:(", "var:np", "op:.", "prop:exp", "pun:(", "var:x", "pun:)),",
      "cls:Linear", "pun:(", "num:3", "pun:),", "cls:Tensor",
    ]);
  });

  it("reads comments to the end of the line", () => {
    expect(line("x = 1  # scale = 2")).toEqual(["var:x", "op:=", "num:1", "com:# scale = 2"]);
  });

  it("reads strings with escapes and prefixes", () => {
    expect(line(`print(f"n={n}", 'it\\'s', rb"\\x00")`)).toEqual([
      "fn:print", "pun:(", 'str:f"n={n}"', "pun:,", "str:'it\\'s'", "pun:,", 'str:rb"\\x00"', "pun:)",
    ]);
  });

  it("keeps a triple-quoted string a string across lines", () => {
    const rows = tokenizePython('def f():\n    """Scale x.\n\n    if x is None: return\n    """\n    return x');
    expect(rows[1].filter((t) => t.text.trim()).map((t) => t.kind)).toEqual(["str"]);
    expect(rows[2]).toEqual([]);
    expect(rows[3].map((t) => t.kind)).toEqual(["str"]);
    expect(rows[4].map((t) => t.kind)).toEqual(["str"]);
    expect(rows[5].filter((t) => t.text.trim()).map((t) => t.kind)).toEqual(["kw", "var"]);
  });

  it("closes a triple-quoted string on the line that opened it", () => {
    expect(line("doc = '''one line''' + x")).toEqual(["var:doc", "op:=", "str:'''one line'''", "op:+", "var:x"]);
  });

  it("reads numbers, including floats, exponents and hex, without swallowing operators", () => {
    expect(line("a = 1+2 - 3.5e-4 * 0x1F / .5 + 1_000 + 2j")).toEqual([
      "var:a", "op:=", "num:1", "op:+", "num:2", "op:-", "num:3.5e-4", "op:*", "num:0x1F",
      "op:/", "num:.5", "op:+", "num:1_000", "op:+", "num:2j",
    ]);
  });

  it("treats a leading minus as an operator", () => {
    expect(line("x.transpose(-2, dim=-1)")).toEqual([
      "var:x", "op:.", "prop:transpose", "pun:(", "op:-", "num:2", "pun:,", "var:dim", "op:=-", "num:1", "pun:)",
    ]);
  });

  it("reads @ as a decorator only at the start of a line", () => {
    expect(line("@torch.no_grad")).toEqual(["deco:@torch.no_grad"]);
    expect(line("    @property")).toEqual(["deco:@property"]);
    expect(line("y = q @ k")).toEqual(["var:y", "op:=", "var:q", "op:@", "var:k"]);
  });

  it("does not read names that end in a prefix letter as strings", () => {
    expect(line('elif x: buf = "a"')).toEqual(["kw:elif", "var:x", "pun::", "var:buf", "op:=", 'str:"a"']);
  });
});

describe("review fixes", () => {
  const kinds = (row: Token[]) => row.filter((t) => t.text.trim()).map((t) => `${t.kind}:${t.text}`);

  it("keeps .5 one number right after an operator", () => {
    expect(line("scale(x, alpha=.5)")).toEqual([
      "fn:scale", "pun:(", "var:x", "pun:,", "var:alpha", "op:=", "num:.5", "pun:)",
    ]);
    expect(line("y = x*.25")).toEqual(["var:y", "op:=", "var:x", "op:*", "num:.25"]);
  });

  it("reads @ on a continuation line as matrix multiply", () => {
    const rows = tokenizePython("scores = (\n    q\n    @ k.transpose(-2, -1)\n)\n@cache\ndef f(): pass");
    expect(kinds(rows[2])[0]).toBe("op:@");
    expect(kinds(rows[4])).toEqual(["deco:@cache"]);
  });

  it("reads @ after a backslash continuation as matrix multiply", () => {
    const rows = tokenizePython("y = a \\\n    @ b");
    expect(kinds(rows[1])[0]).toBe("op:@");
  });

  it("keeps quotes inside f-string replacement fields from ending or opening strings", () => {
    const rows = tokenizePython('message = f"{"""label"""}"\nprint(message)');
    expect(kinds(rows[0])).toEqual(["var:message", "op:=", 'str:f"{"""label"""}"']);
    expect(kinds(rows[1])).toEqual(["fn:print", "pun:(", "var:message", "pun:)"]);
    expect(line(`f"{d['k']}" + f"{{literal}}" + x`)).toEqual([
      `str:f"{d['k']}"`, "op:+", 'str:f"{{literal}}"', "op:+", "var:x",
    ]);
  });
});
