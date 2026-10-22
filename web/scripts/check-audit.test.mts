/**
 * Unit tests for audit-policy.mts: high/critical findings always block, lower
 * severities pass, and malformed reports fail closed.
 * Run with `node --experimental-strip-types --test scripts/check-audit.test.mts`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAudit } from "./audit-policy.mts";

// The chain that GHSA-vfj7-8cjw-p6xm was temporarily allowed through until
// 2026-10-10. It must now be rejected like any other high finding.
const formerBracesChain = {
  "@next/eslint-plugin-next": {
    severity: "high",
    via: ["fast-glob"],
    effects: ["eslint-config-next"],
    nodes: ["node_modules/@next/eslint-plugin-next"],
  },
  braces: {
    severity: "high",
    via: [
      {
        source: 1240992,
        name: "braces",
        dependency: "braces",
        severity: "high",
        url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
        range: "<=3.0.3",
      },
    ],
    effects: ["micromatch"],
    nodes: ["node_modules/braces"],
  },
  "eslint-config-next": {
    severity: "high",
    via: ["@next/eslint-plugin-next"],
    effects: [],
    nodes: ["node_modules/eslint-config-next"],
  },
  "fast-glob": {
    severity: "high",
    via: ["micromatch"],
    effects: ["@next/eslint-plugin-next"],
    nodes: ["node_modules/fast-glob"],
  },
  micromatch: {
    severity: "high",
    via: ["braces"],
    effects: ["fast-glob"],
    nodes: ["node_modules/micromatch"],
  },
};

test("passes an empty report", () => {
  const result = evaluateAudit({ vulnerabilities: {} });

  assert.equal(result.ok, true);
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.failures, []);
});

test("passes info, low, and moderate findings", () => {
  const result = evaluateAudit({
    vulnerabilities: {
      a: { severity: "info", via: [], effects: [], nodes: [] },
      katex: { severity: "low", via: [], effects: ["mermaid"], nodes: [] },
      c: { severity: "moderate", via: [], effects: [], nodes: [] },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("rejects the formerly allowed braces chain", () => {
  const result = evaluateAudit({ vulnerabilities: formerBracesChain });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failures.sort(),
    Object.keys(formerBracesChain)
      .map((name) => `${name}: high severity finding`)
      .sort(),
  );
});

test("rejects any single entry of the former braces chain", () => {
  for (const [name, entry] of Object.entries(formerBracesChain)) {
    const result = evaluateAudit({ vulnerabilities: { [name]: entry } });

    assert.equal(result.ok, false, name);
    assert.deepEqual(result.failures, [`${name}: high severity finding`]);
  }
});

test("rejects high and critical findings outside any chain", () => {
  for (const severity of ["high", "critical"]) {
    const result = evaluateAudit({
      vulnerabilities: {
        katex: { severity: "low", via: [], effects: [], nodes: [] },
        sharp: {
          severity,
          via: [],
          effects: ["@xenova/transformers"],
          nodes: ["node_modules/sharp"],
        },
      },
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, [`sharp: ${severity} severity finding`]);
    assert.deepEqual(result.blocking.map(([name]) => name), ["sharp"]);
  }
});

test("rejects malformed vulnerability entries with a clear diagnostic", () => {
  for (const entry of [null, "high", [], 1]) {
    const result = evaluateAudit({ vulnerabilities: { braces: entry } });

    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, ["braces: malformed audit entry"]);
  }
});

test("rejects audit entries without a recognized severity", () => {
  for (const severity of [undefined, "unknown", "HIGH"]) {
    const vulnerability: Record<string, unknown> = {
      ...formerBracesChain.braces,
    };
    if (severity === undefined) {
      delete vulnerability.severity;
    } else {
      vulnerability.severity = severity;
    }

    const result = evaluateAudit({
      vulnerabilities: { braces: vulnerability },
    });

    assert.equal(result.ok, false);
    assert.match(result.failures[0], /braces: malformed audit entry/);
  }
});

test("includes npm audit error payloads in malformed report diagnostics", () => {
  assert.throws(
    () =>
      evaluateAudit({
        error: { code: "ECONNRESET", summary: "registry unavailable" },
      }),
    /ECONNRESET/,
  );
});

test("rejects reports whose vulnerabilities field is not an object", () => {
  for (const vulnerabilities of [undefined, null, [], "none"]) {
    assert.throws(
      () => evaluateAudit({ vulnerabilities }),
      /npm audit did not return a vulnerability report/,
    );
  }
});

test("handles null, undefined, and non-object npm audit reports", () => {
  for (const report of [null, undefined, [], "report"]) {
    assert.throws(
      () => evaluateAudit(report),
      /npm audit did not return a vulnerability report/,
    );
  }
});
