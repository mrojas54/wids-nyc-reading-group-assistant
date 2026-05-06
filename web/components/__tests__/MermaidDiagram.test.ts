import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_VARIABLES } from "../MermaidDiagram";

// Regression guard for the Mermaid theme key drop fixed in bd0efa6
// (introduced in f0506a9). The "base" theme uses `textColor` as the fallback
// for any element outside primary/secondary/tertiaryTextColor scope — untiered
// nodes, subgraph labels, edge label text. Same story for `nodeTextColor`.
// If either key goes missing or gets set to a light value, /papers/[id]
// companion diagrams render white-on-sage and become unreadable.

const here = dirname(fileURLToPath(import.meta.url));
const GLOBALS_CSS = resolve(here, "../../app/globals.css");

function readPaperInkFromGlobals(): string {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const match = css.match(/--color-paper-700:\s*(#[0-9a-fA-F]{3,8})\s*;/);
  if (!match) {
    throw new Error(
      `Could not find --color-paper-700 in ${GLOBALS_CSS}. ` +
        "Either the token was renamed or this test needs updating.",
    );
  }
  return match[1].toLowerCase();
}

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const KNOWN_LIGHT_OR_EMPTY = new Set([
  "",
  "transparent",
  "white",
  "#fff",
  "#ffff",
  "#ffffff",
  "#ffffffff",
]);

describe("MermaidDiagram THEME_VARIABLES — required dark text fallbacks", () => {
  describe.each(["textColor", "nodeTextColor"] as const)("%s", (key) => {
    const value = (THEME_VARIABLES as Record<string, unknown>)[key];

    it("is defined as a non-empty hex string", () => {
      expect(value, `${key} must be present on THEME_VARIABLES`).toBeDefined();
      expect(typeof value).toBe("string");
      expect(value as string).toMatch(HEX_RE);
    });

    it("is not white, transparent, or otherwise unreadable on light fills", () => {
      const lower = String(value).toLowerCase();
      expect(
        KNOWN_LIGHT_OR_EMPTY.has(lower),
        `${key} = ${String(value)} is too light to render against sage/paper fills`,
      ).toBe(false);
    });

    it("matches the design-system ink token (paper-700 in globals.css)", () => {
      const inkToken = readPaperInkFromGlobals();
      expect(String(value).toLowerCase()).toBe(inkToken);
    });
  });
});
