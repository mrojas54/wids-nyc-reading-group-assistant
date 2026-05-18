// Provider-resolution precedence: env default unless caller is admin AND
// supplied a valid override (spec §13.5).
import { describe, it, expect } from "vitest";
import { resolveProvider } from "../index";

describe("resolveProvider", () => {
  it("falls back to gemini when env is unset and caller is non-admin", () => {
    expect(resolveProvider({ envDefault: undefined, callerIsAdmin: false })).toBe(
      "gemini",
    );
  });

  it("honors PAPER_PAL_PROVIDER=claude for non-admin", () => {
    expect(
      resolveProvider({
        envDefault: "claude",
        bodyProvider: "gemini",
        callerIsAdmin: false,
      }),
    ).toBe("claude");
  });

  it("ignores body.provider when caller is not admin", () => {
    expect(
      resolveProvider({
        envDefault: "gemini",
        bodyProvider: "claude",
        callerIsAdmin: false,
      }),
    ).toBe("gemini");
  });

  it("honors body.provider only when caller is admin", () => {
    expect(
      resolveProvider({
        envDefault: "gemini",
        bodyProvider: "claude",
        callerIsAdmin: true,
      }),
    ).toBe("claude");
  });

  it("rejects unknown body.provider even from admin and falls back to env default", () => {
    expect(
      resolveProvider({
        envDefault: "gemini",
        bodyProvider: "ollama",
        callerIsAdmin: true,
      }),
    ).toBe("gemini");
  });

  it("rejects unknown env default and falls back to gemini", () => {
    expect(resolveProvider({ envDefault: "ollama", callerIsAdmin: false })).toBe(
      "gemini",
    );
  });
});
