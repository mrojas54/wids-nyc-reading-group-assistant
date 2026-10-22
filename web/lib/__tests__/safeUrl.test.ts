import { describe, expect, it } from "vitest";

import { externalHttpUrl, isExternalHttpUrl, safeHref } from "../safeUrl";

describe("externalHttpUrl", () => {
  it("passes http and https through unchanged", () => {
    expect(externalHttpUrl("https://arxiv.org/abs/1706.03762")).toBe(
      "https://arxiv.org/abs/1706.03762",
    );
    expect(externalHttpUrl("http://arxiv.org/abs/1706.03762")).toBe(
      "http://arxiv.org/abs/1706.03762",
    );
  });

  it("refuses javascript: and data: URLs", () => {
    expect(externalHttpUrl("javascript:alert(1)")).toBeNull();
    expect(externalHttpUrl("JavaScript:alert(1)")).toBeNull();
    expect(externalHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("refuses a scheme hidden behind whitespace or an embedded newline", () => {
    // `new URL` strips both, exactly as an href parser does, so neither
    // disguise survives the check.
    expect(externalHttpUrl("  javascript:alert(1)")).toBeNull();
    expect(externalHttpUrl("java\nscript:alert(1)")).toBeNull();
    expect(externalHttpUrl("\tjavascript:alert(1)")).toBeNull();
  });

  it("refuses other non-web schemes", () => {
    expect(externalHttpUrl("file:///etc/passwd")).toBeNull();
    expect(externalHttpUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("refuses anything that does not parse as an absolute URL", () => {
    expect(externalHttpUrl("arxiv.org/abs/1706.03762")).toBeNull();
    expect(externalHttpUrl("/papers/2")).toBeNull();
    expect(externalHttpUrl("")).toBeNull();
    expect(externalHttpUrl(null)).toBeNull();
    expect(externalHttpUrl(undefined)).toBeNull();
  });

  it("isExternalHttpUrl mirrors externalHttpUrl", () => {
    expect(isExternalHttpUrl("https://example.test/x")).toBe(true);
    expect(isExternalHttpUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("safeHref", () => {
  it("allows absolute http(s) URLs", () => {
    expect(safeHref("https://example.test/x")).toBe("https://example.test/x");
  });

  it("allows a site-relative path, as companion_url stores it", () => {
    expect(safeHref("/papers/2")).toBe("/papers/2");
  });

  it("refuses protocol-relative paths that only look same-origin", () => {
    expect(safeHref("//evil.example.com/x")).toBeNull();
    expect(safeHref("/\\evil.example.com/x")).toBeNull();
  });

  // An href parser strips tabs and newlines, so each of these lands on
  // `//evil.example.com/x` in the browser even though it opens with a single
  // `/`. Checking the leading characters alone would let them through.
  it.each(["/\t/evil.example.com/x", "/\n/evil.example.com/x", "/\r/evil.example.com/x"])(
    "refuses a path whose stripped form is protocol-relative (%j)",
    (value) => {
      expect(safeHref(value)).toBeNull();
    },
  );

  // These resolve on-origin, but normalizing collapses the dot segments and
  // *produces* a protocol-relative path, so the returned string has to be
  // checked as well as the input.
  it.each([
    "/.//evil.example.com/x",
    "/..//evil.example.com/x",
    "/a/../..//evil.example.com",
    "/./\\evil.example.com",
  ])("refuses a path that normalizes into a protocol-relative one (%j)", (value) => {
    expect(safeHref(value)).toBeNull();
  });

  it("keeps a dot inside a segment, which is not a dot segment", () => {
    expect(safeHref("/papers/2.pdf")).toBe("/papers/2.pdf");
  });

  it("normalizes the path it returns, so stripped characters never reach the href", () => {
    expect(safeHref("/papers/2?x=1#y")).toBe("/papers/2?x=1#y");
    expect(safeHref("/pap\ters/2")).toBe("/papers/2");
  });

  it("refuses a relative path with no leading slash", () => {
    expect(safeHref("papers/2")).toBeNull();
  });

  it("refuses javascript: and data: URLs", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("refuses empty and missing values", () => {
    expect(safeHref("")).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });
});
